// The permission host of an unattended UAT run: a stdio MCP server whose one
// tool, `approve`, answers the case session's permission prompts in place of
// the person who approves them in an assisted run. The UAT driver starts the
// session with `--permission-prompts host` and `--permission-prompt-tool
// mcp__uat__approve`, and Claude Code starts this server from the driver's
// `--mcp-config`.
//
//   node permission-host.mjs --workdir <dir> --log <file> [--scratch <owner/name>]
//
// It allows any tool inside the working copy, denies a file tool's write
// outside it and the worktrees added to its repository, and denies
// AskUserQuestion, which the driver's answering hook (ask-hook.mjs) answers
// before any prompt: reaching the host means that hook did not run. In a shell command it allows `gh` reads, and denies a `gh` write, or a
// `git push`, `fetch` or `pull`, aimed at a repo other than the scratch repo
// that --scratch names or a repo in the step folder, the working copy's parent.
// That filter is best effort: the guarantee is the token the driver gives the
// session, which reaches the scratch repo alone. Every decision is appended to
// the log, one JSON line each, and the driver hands the log to the grading
// call.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { githubRepo } from './github-repo.mjs';
import { callsOf } from './shell-commands.mjs';

const TOOL = 'approve';
const DETAIL_LIMIT = 300;

// The file tools and the input that names the file each one writes.
const WRITES = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
// The tools that run a shell command.
const SHELLS = new Set(['Bash', 'PowerShell']);

const USAGE = 'node permission-host.mjs --workdir <dir> --log <file> [--scratch <owner/name>]';
const OPTIONS = ['workdir', 'log', 'scratch'];

function usage(message) {
  process.stderr.write(`${message}: ${USAGE}\n`);
  process.exit(2);
}

// Its options, and no other: an option it does not take is a usage error that
// names it, as in run.mjs and reader.mjs.
function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].startsWith('--') ? args[i].slice(2) : null;
    if (!OPTIONS.includes(name)) usage(`takes no option ${args[i]}`);
    if (args[i + 1] === undefined) usage(`--${name} needs a value`);
    options[name] = args[i + 1];
  }
  if (!options.workdir || !options.log) usage('needs --workdir and --log');
  return options;
}

const { workdir: workdirOption, log, scratch: scratchOption } = parseArgs(process.argv.slice(2));
const workdir = realpathSync.native(workdirOption);
const stepDir = dirname(workdir);
const scratch = scratchOption ? scratchOption.toLowerCase() : null;
// The rule a denial of a gh or git command cites.
const scratchRule = scratch
  ? `a case session writes to GitHub only on the scratch repo ${scratch}`
  : 'a case session writes to GitHub only on the scratch repo, and the source clone has no GitHub remote to name one';

// The path with its existing part resolved through any link, so that a link
// inside the working copy cannot lead a write out of it. The native call also
// expands a Windows short name, such as RUNNER~1, into the long one git lists.
function realPath(path) {
  if (existsSync(path)) return realpathSync.native(path);
  const parent = dirname(path);
  return parent === path ? path : join(realPath(parent), basename(path));
}

function isInside(path, root = workdir, from = workdir) {
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = relative(fold(root), fold(realPath(resolve(from, path))));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function gitOut(dir, args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

// The worktrees added to the working copy's repository, as git lists them at
// the time of the write: aw-review makes its runs in worktrees of its own,
// under the system's temporary directory. None when the working copy is not
// the repository's main worktree, since the list would then name another's.
function addedWorktrees() {
  const listed = (gitOut(workdir, ['worktree', 'list', '--porcelain']) ?? '')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => realPath(resolve(line.slice('worktree '.length))));
  const [main, ...added] = listed;
  return main !== undefined && isInside(main) && isInside(workdir, main) ? added : [];
}

const writable = (path) => isInside(path) || addedWorktrees().some((root) => isInside(path, root));

// The GitHub repo the working copy's origin names: where gh goes by default.
const originRepo = () => githubRepo(gitOut(workdir, ['remote', 'get-url', 'origin']) ?? '');

const GH_READ_COMMANDS = new Set(['search', 'status', 'browse', 'help', 'version', 'completion']);
// The flags that, given to gh with no command, print its version or its help.
const GH_READ_FLAGS = new Set(['--version', '--help', '-h']);
const GH_READ_SUBCOMMANDS = new Set(['list', 'view', 'status', 'diff', 'checks', 'clone', 'checkout', 'download', 'watch', 'get']);
// Writes no case makes, whatever repo they name: on the account, a gist or
// gh's own setup, or making, forking, renaming or doing away with a repo.
const GH_NEVER = new Set(['auth', 'config', 'extension', 'alias', 'gist', 'ssh-key', 'gpg-key', 'codespace', 'org']);
const GH_REPO_NEVER = new Set(['create', 'fork', 'delete', 'rename', 'archive', 'unarchive', 'edit']);
// Flags whose value is the next word, so that it is not read as an argument.
const GH_VALUED = new Set(['-H', '--header', '-q', '--jq', '-t', '--template', '--title', '-b', '--body', '--body-file', '--hostname', '--cache', '-p', '--preview', '-l', '--label', '-a', '--assignee', '-m', '--milestone', '-s', '--state', '-L', '--limit', '--json', '-B', '--base', '--head', '-A', '--author', '-S', '--search', '-c', '--comment', '-r', '--reason']);
const GH_FIELDS = new Set(['-f', '-F', '--field', '--raw-field']);
// Short flags whose value may come attached, as in -XPOST.
const GH_ATTACHED = /^-[RXfF]./;

// Why a gh call is denied, or null: a read goes anywhere, a write only to the
// scratch repo. Its target is the repo -R, GH_REPO, a github.com URL or the API
// path names, or else the working copy's origin. A GraphQL mutation names no
// repo, so it is denied.
function ghDenial(words, assigned) {
  let repo = assigned.GH_REPO ?? null;
  let method = null;
  const fields = [];
  const args = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const split = word.startsWith('--') ? word.indexOf('=') : GH_ATTACHED.test(word) ? 2 : -1;
    const flag = split === -1 ? word : word.slice(0, split);
    const value = () => (split === -1 ? words[(i += 1)] : word.slice(word[split] === '=' ? split + 1 : split));
    if (flag === '-R' || flag === '--repo') repo = value();
    else if (flag === '-X' || flag === '--method') method = value();
    else if (GH_FIELDS.has(flag)) fields.push(value() ?? '');
    else if (flag === '--input') fields.push(`@${value() ?? ''}`);
    else if (GH_VALUED.has(flag)) value();
    else if (!flag.startsWith('-')) args.push(word);
  }
  const [group, sub] = args;
  const graphql = group === 'api' && sub === 'graphql';
  let read;
  if (args.length === 0) read = words.length > 0 && words.every((word) => GH_READ_FLAGS.has(word));
  else if (graphql) read = !fields.some((field) => /\bmutation\b|^(query=)?@/.test(field));
  else if (group === 'api') read = ['GET', 'HEAD'].includes((method ?? (fields.length > 0 ? 'POST' : 'GET')).toUpperCase());
  else read = GH_READ_COMMANDS.has(group) || (group === 'auth' && sub === 'status') || GH_READ_SUBCOMMANDS.has(sub);
  if (read) return null;
  const what = `gh ${args.slice(0, 2).join(' ')}`;
  if (GH_NEVER.has(group) || (group === 'repo' && GH_REPO_NEVER.has(sub))) return `${what} is not a write a case makes: ${scratchRule}`;
  const target = graphql ? null : ghTarget(repo, args);
  if (target !== null && target === scratch) return null;
  return target === null ? `${what} is a write whose repo cannot be told: ${scratchRule}` : `${what} writes to ${target}: ${scratchRule}`;
}

// `owner/name`, `github.com/owner/name` or a github.com URL, as githubRepo
// names it; null for a repo on another host.
const asRepo = (text) => githubRepo(`https://github.com/${text.replace(/^(?:https?:\/\/)?github\.com\//i, '')}`);

function ghTarget(repo, args) {
  if (repo) return asRepo(repo);
  const [group, , third] = args;
  const url = args.map((arg) => arg.match(/^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)/i)?.[1]).find(Boolean);
  if (url) return asRepo(url);
  if (group === 'repo' && /^[^/\s]+\/[^/\s]+$/.test(third ?? '')) return asRepo(third);
  const path = group === 'api' ? args[1]?.match(/^\/?repos\/([^/{}:]+\/[^/?#{}]+)/) : null;
  if (path) return asRepo(path[1]);
  return originRepo();
}

const GIT_VALUED = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--upload-pack', '--depth', '--deepen', '-j', '--jobs', '--refmap', '--server-option', '--shallow-since', '--shallow-exclude', '--negotiation-tip']);

// The remote a push or fetch with no repository named goes to, as git picks it.
function defaultRemote(dir, push) {
  const branch = gitOut(dir, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const config = (key) => gitOut(dir, ['config', '--get', key]) || null;
  const pushRemote = push ? (branch && config(`branch.${branch}.pushRemote`)) || config('remote.pushDefault') : null;
  return pushRemote || (branch && config(`branch.${branch}.remote`)) || 'origin';
}

// Why a git push, fetch or pull is denied, or null: it may reach only the
// scratch repo on GitHub, or a repo inside the step folder, such as the local
// origin a case starts with. `added` holds the remotes an earlier command of
// the same line adds or points elsewhere, which git does not know yet.
function gitDenial(words, added) {
  let dir = workdir;
  let i = 0;
  for (; i < words.length && words[i].startsWith('-'); i += 1) {
    if (words[i] === '-C') dir = resolve(dir, words[(i += 1)] ?? '.');
    else if (words[i] === '-c') i += 1;
  }
  const sub = words[i];
  if (sub === 'remote' && ['add', 'set-url'].includes(words[i + 1])) {
    const [name, url] = words.slice(i + 2).filter((word, j, rest) => !word.startsWith('-') && !['-t', '-m'].includes(rest[j - 1]));
    if (name && url) added.set(name, url);
    return null;
  }
  if (!['push', 'fetch', 'pull'].includes(sub)) return null;
  const push = sub === 'push';
  let repoOption = null;
  let allRemotes = false;
  let multiple = false;
  const args = [];
  for (let j = i + 1; j < words.length; j += 1) {
    const word = words[j];
    if (word === '--all' && !push) allRemotes = true;
    else if (word === '--multiple') multiple = true;
    else if (word.startsWith('--repo=')) repoOption = word.slice('--repo='.length);
    else if (word === '--repo') repoOption = words[(j += 1)];
    else if (GIT_VALUED.has(word)) j += 1;
    else if (!word.startsWith('-')) args.push(word);
  }
  const remotes = (gitOut(dir, ['remote']) ?? '').split('\n').filter(Boolean);
  const repos = allRemotes ? remotes : multiple ? args : [args[0] ?? repoOption ?? defaultRemote(dir, push)];
  const urlsOf = (repo) => {
    if (added.has(repo)) return [added.get(repo)];
    if (!remotes.includes(repo)) return [repo];
    return (gitOut(dir, ['remote', 'get-url', ...(push ? ['--push'] : []), '--all', repo]) ?? repo).split('\n');
  };
  const denied = repos.flatMap(urlsOf).find((url) => !gitTargetAllowed(dir, url));
  return denied === undefined ? null : `git ${sub} to ${denied} denied: ${scratchRule}, and pushes or fetches elsewhere only from the repos of its step folder`;
}

function gitTargetAllowed(dir, url) {
  const repo = githubRepo(url);
  if (repo !== null) return repo === scratch;
  if (/^file:\/\//i.test(url)) return isInside(url.replace(/^file:\/\/\/?/i, process.platform === 'win32' ? '' : '/'), stepDir, dir);
  // Any other URL, or the scp-like user@host:path, reaches another host.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^([^@/\\:]+@)?[^/\\:]{2,}:/.test(url)) return false;
  return isInside(url, stepDir, dir);
}

// Why a shell command is denied, or null: the first of its calls that is a gh
// write or a git push or fetch out of bounds.
function shellDenial(line) {
  const added = new Map();
  for (const { program, args, assigned } of callsOf(line)) {
    const denial = program === 'gh' ? ghDenial(args, assigned) : program === 'git' ? gitDenial(args, added) : null;
    if (denial) return denial;
  }
  return null;
}

function decide(toolName, input) {
  if (toolName === 'AskUserQuestion') {
    return { behavior: 'deny', message: 'AskUserQuestion reached the permission host: the UAT driver\'s answering hook should have answered it, so that hook did not run' };
  }
  const key = WRITES[toolName];
  if (key && !(typeof input?.[key] === 'string' && writable(input[key]))) {
    return { behavior: 'deny', message: `${toolName} writes only inside the working copy ${workdir} and the worktrees added to its repository, not to ${input?.[key]}` };
  }
  const denial = SHELLS.has(toolName) && typeof input?.command === 'string' ? shellDenial(input.command) : null;
  if (denial) return { behavior: 'deny', message: denial };
  return { behavior: 'allow', updatedInput: input };
}

// What the log keeps of a call: the file a file tool names, or a command.
function detailOf(toolName, input) {
  const value = input?.[WRITES[toolName]] ?? input?.file_path ?? input?.command ?? input?.pattern;
  return typeof value === 'string' ? { detail: value.slice(0, DETAIL_LIMIT) } : {};
}

function approve(args) {
  const { tool_name: toolName, input } = args ?? {};
  const decision = decide(toolName, input);
  const entry = { at: new Date().toISOString(), tool: toolName, ...detailOf(toolName, input), decision: decision.behavior };
  appendFileSync(log, `${JSON.stringify(decision.behavior === 'deny' ? { ...entry, reason: decision.message } : entry)}\n`);
  return decision;
}

const TOOLS = [
  {
    name: TOOL,
    description: 'Answers a permission prompt of a UAT case session.',
    inputSchema: {
      type: 'object',
      properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
      required: ['tool_name', 'input'],
    },
  },
];

function handle(message) {
  const { method, params } = message;
  if (method === 'initialize') {
    return { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'uat-permission-host', version: '1' } };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: TOOLS };
  if (method === 'tools/call' && params?.name === TOOL) return { content: [{ type: 'text', text: JSON.stringify(approve(params.arguments)) }] };
  return { error: { code: -32601, message: `no method ${method}${params?.name ? ` for ${params.name}` : ''}` } };
}

const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return send({ id: null, error: { code: -32700, message: 'not JSON' } });
  }
  if (message.id === undefined) return; // a notification needs no answer
  const result = handle(message);
  send(result.error ? { id: message.id, error: result.error } : { id: message.id, result });
});
