// A fake `claude` for the UAT driver's tests: it replays a scripted session
// and answers the judgement calls with scripted JSON. Not a test file itself.
// The tests put it on PATH as `claude` (see fakeClaude in uat-auto.test.mjs).
//
// It writes down the contract with Claude Code that `run.mjs auto` relies on:
//
// - A case session is `claude -p` with the prompt on stdin, `--plugin-dir`,
//   `--mcp-config`, `--permission-prompts host`, `--permission-prompt-tool
//   mcp__<server>__<tool>`, `--output-format stream-json` and `--verbose`, and
//   `--resume <id>` for every turn after the first. It prints stream-json
//   events, the `system`/`init` one holding the session id, and keeps the
//   session log where reader.mjs reads it. A turn may print a
//   `rate_limit_event` after init, as Claude Code does for a plan's session:
//   `rate_limit_info.unifiedWindows` holds `five_hour` and `seven_day`, each
//   with its `utilization` as a fraction of the window and `resetsAt` in epoch
//   seconds, and `status` is `rejected` when the turn hit the limit. Each tool
//   call it makes is first
//   put to the permission host, over MCP, as Claude Code does for a tool that
//   would prompt, and runs only when the host allows it.
// - A judgement call is `claude -p` with the prompt on stdin, `--model` and
//   `--output-format json`. It prints one `result` event whose `result` is the
//   judgement's text.
//
// FAKE_CLAUDE names the script, a JSON file:
//
//   { "turns": [{ "rateLimit", "tools": [{ "name", "input" }], "text" } | { "rateLimit", "tools", "error" }],
//     "judgements": [{ "reply": {...} } | { "grade": {...} }] }
//
// Each case-session call takes the next entry of `turns`, and each judgement
// call the next entry of `judgements`, whose key must be the kind of call the
// prompt's first line names. A turn with `error` ends in that error after its
// tools ran. A turn's `rateLimit` is `{ status?, five_hour?, seven_day? }`,
// each window `{ utilization, resetsIn }`, `resetsIn` being the seconds from
// now its `resetsAt` lies. `{{CWD}}` in a tool's input becomes the session's
// working directory. Every call is appended to calls.jsonl beside the script,
// with the time it started.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const VALUED = new Set(['--plugin-dir', '--mcp-config', '--permission-prompts', '--permission-prompt-tool', '--output-format', '--resume', '--model', '--tools']);
const BARE = new Set(['-p', '--verbose', '--no-session-persistence']);

function fail(message) {
  process.stderr.write(`fake claude: ${message}\n`);
  process.exit(1);
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    if (BARE.has(args[i])) options[args[i]] = true;
    else if (VALUED.has(args[i]) && args[i + 1] !== undefined) options[args[i]] = args[++i];
    else fail(`unexpected argument ${args[i]}: the prompt goes on stdin`);
  }
  if (!options['-p']) fail('not called with -p');
  return options;
}

const scriptFile = process.env.FAKE_CLAUDE;
if (!scriptFile) fail('FAKE_CLAUDE is not set');
const script = JSON.parse(readFileSync(scriptFile, 'utf8'));
const progressFile = `${scriptFile}.progress.json`;
const progress = existsSync(progressFile) ? JSON.parse(readFileSync(progressFile, 'utf8')) : { turns: 0, judgements: 0 };
const takeNext = (queue) => {
  const entry = (script[queue] ?? [])[progress[queue]];
  if (entry === undefined) fail(`no scripted ${queue} entry left`);
  progress[queue] += 1;
  writeFileSync(progressFile, JSON.stringify(progress));
  return entry;
};

const options = parseArgs(process.argv.slice(2));
const prompt = readFileSync(0, 'utf8');
const cwd = process.cwd();
// The environment variables a test may ask about: the probe the shell lines
// set, and what reaches GitHub and git's credentials.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(UAT_|GH_|GITHUB_|GIT_|GCM_)/i.test(key)));
appendFileSync(join(dirname(scriptFile), 'calls.jsonl'), `${JSON.stringify({ at: Date.now(), args: process.argv.slice(2), cwd, prompt, env })}\n`);
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

if (options['--output-format'] === 'json') {
  if (!options['--model']) fail('a judgement call names no --model');
  const kind = prompt.match(/^# UAT judgement: (\w+)/)?.[1];
  const entry = takeNext('judgements');
  if (!kind || !Object.hasOwn(entry, kind)) fail(`the next judgement is ${Object.keys(entry)[0]}, the call asks for ${kind}`);
  const value = entry[kind];
  emit({ type: 'result', subtype: 'success', is_error: false, result: typeof value === 'string' ? value : JSON.stringify(value), total_cost_usd: 0.0123 });
  process.exit(0);
}

for (const flag of ['--plugin-dir', '--mcp-config', '--permission-prompt-tool']) if (!options[flag]) fail(`a case session without ${flag}`);
if (options['--permission-prompts'] !== 'host') fail('a case session without --permission-prompts host');
if (options['--output-format'] !== 'stream-json' || !options['--verbose']) fail('a case session without --output-format stream-json --verbose');

const logDir = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
const sessionId = options['--resume'] ?? randomUUID();
const logFile = join(logDir, `${sessionId}.jsonl`);
if (options['--resume'] && !existsSync(logFile)) fail(`no conversation found with session id ${sessionId}`);
mkdirSync(logDir, { recursive: true });
const record = (type, message, extra = {}) => {
  const entry = { type, timestamp: new Date().toISOString(), isSidechain: false, uuid: randomUUID(), sessionId, message, ...extra };
  appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
  emit({ type, message, session_id: sessionId });
};

const turn = takeNext('turns');
emit({ type: 'system', subtype: 'init', session_id: sessionId, cwd, tools: ['Read', 'Write', 'Bash'], mcp_servers: [{ name: 'uat', status: 'connected' }] });
if (turn.rateLimit) {
  const { status = 'allowed', ...windows } = turn.rateLimit;
  const unifiedWindows = Object.fromEntries(
    Object.entries(windows).map(([name, { utilization, resetsIn }]) => [name, { utilization, resetsAt: Math.ceil(Date.now() / 1000) + resetsIn }]),
  );
  emit({ type: 'rate_limit_event', rate_limit_info: { status, unifiedWindows }, uuid: randomUUID(), session_id: sessionId });
}
const command = prompt.match(/^\/(\S+)\s*([\s\S]*)$/);
record('user', {
  role: 'user',
  content: command ? `<command-message>${command[1]}</command-message>\n<command-name>/${command[1]}</command-name>\n<command-args>${command[2].trim()}</command-args>` : prompt,
});

const host = (turn.tools ?? []).length > 0 ? await connectHost(options['--mcp-config'], options['--permission-prompt-tool']) : null;
for (const [index, tool] of (turn.tools ?? []).entries()) {
  const input = JSON.parse(JSON.stringify(tool.input).replaceAll('{{CWD}}', cwd.replaceAll('\\', '\\\\')));
  const id = `toolu_${index}_${randomUUID().slice(0, 8)}`;
  record('assistant', { id: `msg_${id}`, role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: tool.name, input }] });
  const decision = await host.approve({ tool_name: tool.name, input, tool_use_id: id });
  if (decision.behavior === 'allow') runTool(tool.name, decision.updatedInput ?? input);
  const content = decision.behavior === 'allow' ? 'done' : decision.message;
  record('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: decision.behavior !== 'allow' }] });
}
host?.close();

if (turn.error !== undefined) {
  emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: turn.error, session_id: sessionId });
  process.exit(1);
}
const messageId = `msg_${randomUUID().slice(0, 8)}`;
record('assistant', { id: messageId, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: turn.text }] });
emit({ type: 'result', subtype: 'success', is_error: false, result: turn.text, session_id: sessionId, total_cost_usd: 0.4567, usage: { input_tokens: 1234, output_tokens: 567 } });

function runTool(name, input) {
  if (name === 'Write') {
    mkdirSync(dirname(input.file_path), { recursive: true });
    writeFileSync(input.file_path, input.content);
  }
}

// The permission host, started from --mcp-config as Claude Code starts an MCP
// server, and asked through the tool --permission-prompt-tool names.
async function connectHost(configFile, toolName) {
  const [, server, tool] = toolName.match(/^mcp__(.+)__([^_].*)$/) ?? fail(`--permission-prompt-tool ${toolName} names no MCP tool`);
  const config = JSON.parse(readFileSync(configFile, 'utf8')).mcpServers?.[server] ?? fail(`${configFile} has no server ${server}`);
  const child = spawn(config.command, config.args ?? [], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...config.env } });
  const waiting = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  let nextId = 0;
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = (nextId += 1);
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-claude', version: '0' } });
  if (init.error) fail(`the permission host refused initialize: ${init.error.message}`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const listed = await request('tools/list', {});
  if (!listed.result?.tools?.some((t) => t.name === tool)) fail(`the permission host lists no tool ${tool}`);
  return {
    approve: async (args) => {
      const reply = await request('tools/call', { name: tool, arguments: args });
      if (reply.error) fail(`the permission host failed: ${reply.error.message}`);
      return JSON.parse(reply.result.content[0].text);
    },
    close: () => child.stdin.end(),
  };
}
