// The permission host of an unattended UAT run: a stdio MCP server whose one
// tool, `approve`, answers the case session's permission prompts in place of
// the person who approves them in an assisted run. The UAT driver starts the
// session with `--permission-prompts host` and `--permission-prompt-tool
// mcp__uat__approve`, and Claude Code starts this server from the driver's
// `--mcp-config`.
//
//   node permission-host.mjs --workdir <dir> --log <file>
//
// It allows any tool inside the working copy, denies a file tool's write
// outside it, and denies AskUserQuestion, which no case of an unattended run
// asks. Every decision is appended to the log, one JSON line each, and the
// driver hands the log to the grading call.

import { appendFileSync, existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const TOOL = 'approve';
const DETAIL_LIMIT = 300;

// The file tools and the input that names the file each one writes.
const WRITES = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };

const USAGE = 'node permission-host.mjs --workdir <dir> --log <file>';

function usage(message) {
  process.stderr.write(`${message}: ${USAGE}\n`);
  process.exit(2);
}

// Both options, and no other: an option it does not take is a usage error that
// names it, as in run.mjs and reader.mjs.
function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].startsWith('--') ? args[i].slice(2) : null;
    if (name !== 'workdir' && name !== 'log') usage(`takes no option ${args[i]}`);
    if (args[i + 1] === undefined) usage(`--${name} needs a value`);
    options[name] = args[i + 1];
  }
  if (!options.workdir || !options.log) usage('needs --workdir and --log');
  return options;
}

const { workdir: workdirOption, log } = parseArgs(process.argv.slice(2));
const workdir = realpathSync(workdirOption);

// The path with its existing part resolved through any link, so that a link
// inside the working copy cannot lead a write out of it.
function realPath(path) {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(realPath(parent), basename(path));
}

function isInside(path) {
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = relative(fold(workdir), fold(realPath(resolve(workdir, path))));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function decide(toolName, input) {
  if (toolName === 'AskUserQuestion') {
    return { behavior: 'deny', message: 'AskUserQuestion reached the permission host: no case of an unattended run asks it, so nobody can answer' };
  }
  const key = WRITES[toolName];
  if (key && !(typeof input?.[key] === 'string' && isInside(input[key]))) {
    return { behavior: 'deny', message: `${toolName} writes only inside the working copy ${workdir}, not to ${input?.[key]}` };
  }
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
