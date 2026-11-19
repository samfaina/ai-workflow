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
// outside it, and denies AskUserQuestion, which no case of an unattended run
// asks. In a shell command it allows `gh` reads, and denies a `gh` write, or a
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
const workdir = realpathSync(workdirOption);
const stepDir = dirname(workdir);
const scratch = scratchOption ? scratchOption.toLowerCase() : null;
const onlyScratch = scratch
  ? `a case session writes to GitHub only on the scratch repo ${scratch}`
  : 'a case session writes to GitHub only on the scratch repo, and the source clone has no GitHub remote to name one';

// The path with its existing part resolved through any link, so that a link
// inside the working copy cannot lead a write out of it.
function realPath(path) {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(realPath(parent), basename(path));
}

function isInside(path, root = workdir, from = workdir) {
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = relative(fold(root), fold(realPath(resolve(from, path))));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// The commands of a shell line, each as its words with quotes removed: the line
// is split at ; & | ( ) { } ` and line ends outside quotes. Best effort, for
// bash and PowerShell alike, so a backslash outside quotes stays as it is.
function commandsOf(line) {
  const commands = [[]];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) commands.at(-1).push(word);
    word = null;
  };
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && line[i + 1] === '"') word += line[(i += 1)];
      else word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      word ??= '';
    } else if (/[;&|(){}`\n]/.test(ch)) {
      endWord();
      if (commands.at(-1).length > 0) commands.push([]);
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word = (word ?? '') + ch;
    }
  }
  endWord();
  return commands.filter((words) => words.length > 0);
}

function gitOut(dir, args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

// The GitHub repo the working copy's origin names: where gh goes by default.
const originRepo = () => githubRepo(gitOut(workdir, ['remote', 'get-url', 'origin']) ?? '');

const GH_READ_COMMANDS = new Set(['search', 'status', 'browse', 'help', 'version', 'completion', '--version', '--help', '-h']);
const GH_READ_SUBCOMMANDS = new Set(['list', 'view', 'status', 'diff', 'checks', 'clone', 'checkout', 'download', 'watch']);
// Flags whose value is the next word, so that it is not read as an argument.
const GH_VALUED = new Set(['-H', '--header', '-q', '--jq', '-t', '--template', '--title', '-b', '--body', '--body-file', '--hostname', '--cache', '-p', '--preview', '-l', '--label', '-a', '--assignee', '-m', '--milestone', '-s', '--state', '-L', '--limit', '--json', '-B', '--base', '--head', '-A', '--author', '-S', '--search', '-c', '--comment', '-r', '--reason']);
const GH_FIELDS = new Set(['-f', '-F', '--field', '--raw-field', '--input']);

// Why a gh call is denied, or null: a read goes anywhere, a write only to the
// scratch repo. Its target is the repo -R, GH_REPO, a github.com URL or the API
// path names, or else the working copy's origin.
function ghDenial(words, assigned) {
  let repo = assigned.GH_REPO ?? null;
  let method = null;
  let fields = false;
  const args = [];
  for (let i = 0; i < words.length; i += 1) {
    const eq = words[i].startsWith('--') ? words[i].indexOf('=') : -1;
    const flag = eq === -1 ? words[i] : words[i].slice(0, eq);
    const value = () => (eq === -1 ? words[(i += 1)] : words[i].slice(eq + 1));
    if (flag === '-R' || flag === '--repo') repo = value();
    else if (flag === '-X' || flag === '--method') method = value();
    else if (GH_FIELDS.has(flag)) fields = value() !== undefined;
    else if (GH_VALUED.has(flag)) value();
    else if (!flag.startsWith('-')) args.push(words[i]);
  }
  const [group, sub] = args;
  const api = group === 'api';
  const read = api
    ? ['GET', 'HEAD'].includes((method ?? (fields ? 'POST' : 'GET')).toUpperCase())
    : GH_READ_COMMANDS.has(group) || (group === 'auth' && sub === 'status') || GH_READ_SUBCOMMANDS.has(sub);
  if (read) return null;
  const target = ghTarget(repo, args);
  if (target !== null && target === scratch) return null;
  const what = `gh ${args.slice(0, 2).join(' ')}`;
  return target === null ? `${what} is a write whose repo cannot be told: ${onlyScratch}` : `${what} writes to ${target}: ${onlyScratch}`;
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
// origin a case starts with.
function gitDenial(words) {
  let dir = workdir;
  let i = 0;
  for (; i < words.length && words[i].startsWith('-'); i += 1) {
    if (words[i] === '-C') dir = resolve(dir, words[(i += 1)] ?? '.');
    else if (words[i] === '-c') i += 1;
  }
  const sub = words[i];
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
  const urls = repos.flatMap((repo) => (remotes.includes(repo) ? (gitOut(dir, ['remote', 'get-url', ...(push ? ['--push'] : []), '--all', repo]) ?? repo).split('\n') : [repo]));
  const denied = urls.find((url) => !gitTargetAllowed(dir, url));
  return denied === undefined ? null : `git ${sub} to ${denied} denied: ${onlyScratch}, and pushes or fetches elsewhere only from the repos of its step folder`;
}

function gitTargetAllowed(dir, url) {
  const repo = githubRepo(url);
  if (repo !== null) return repo === scratch;
  if (/^file:\/\//i.test(url)) return isInside(url.replace(/^file:\/\/\/?/i, process.platform === 'win32' ? '' : '/'), stepDir, dir);
  // Any other URL, or the scp-like user@host:path, reaches another host.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^([^@/\\:]+@)?[^/\\:]{2,}:/.test(url)) return false;
  return isInside(url, stepDir, dir);
}

const WRAPPERS = new Set(['command', 'exec', 'env', 'sudo', 'time', 'nohup']);

// Why a shell command is denied, or null: the first of its commands that is a
// gh write or a git push or fetch out of bounds.
function shellDenial(line) {
  for (const command of commandsOf(line)) {
    const assigned = {};
    let at = 0;
    for (; at < command.length; at += 1) {
      const assignment = command[at].match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (assignment) assigned[assignment[1]] = assignment[2];
      else if (!WRAPPERS.has(command[at])) break;
    }
    const program = (command[at] ?? '').split(/[/\\]/).pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
    const words = command.slice(at + 1);
    const denial = program === 'gh' ? ghDenial(words, assigned) : program === 'git' ? gitDenial(words) : null;
    if (denial) return denial;
  }
  return null;
}

function decide(toolName, input) {
  if (toolName === 'AskUserQuestion') {
    return { behavior: 'deny', message: 'AskUserQuestion reached the permission host: no case of an unattended run asks it, so nobody can answer' };
  }
  const key = WRITES[toolName];
  if (key && !(typeof input?.[key] === 'string' && isInside(input[key]))) {
    return { behavior: 'deny', message: `${toolName} writes only inside the working copy ${workdir}, not to ${input?.[key]}` };
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
