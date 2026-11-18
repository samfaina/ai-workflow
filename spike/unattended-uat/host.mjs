// The permission host of an unattended UAT case session: a stdio MCP server
// with one tool, `approve`, named by --permission-prompt-tool. Declaring a host
// is what makes `claude -p` offer AskUserQuestion at all. The same tool answers
// the permission prompts a person approves in an assisted run.
//
// Policy: allow, except a file tool writing outside the working copy
// (UAT_WORKDIR), and AskUserQuestion itself: reaching the host means hook.mjs
// did not answer, and that has to show in the run, not pass silently.
// Every decision is appended to UAT_HOST_LOG when it is set.

import { appendFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const workdir = resolve(process.env.UAT_WORKDIR ?? process.cwd());
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function inside(path) {
  const rel = relative(workdir, resolve(workdir, path));
  const norm = process.platform === 'win32' ? rel.toLowerCase() : rel;
  return !norm.startsWith('..') && !isAbsolute(norm);
}

function decide(toolName, input) {
  if (toolName === 'AskUserQuestion') return { behavior: 'deny', message: 'hook.mjs did not answer this question' };
  if (FILE_TOOLS.has(toolName)) {
    const path = input.file_path ?? input.notebook_path;
    if (path && !inside(path)) return { behavior: 'deny', message: `writes outside the working copy: ${path}` };
  }
  return { behavior: 'allow', updatedInput: input };
}

const TOOL = {
  name: 'approve',
  description: 'Answers a permission prompt for an unattended UAT case session.',
  inputSchema: {
    type: 'object',
    properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
    required: ['tool_name', 'input'],
  },
};

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

function handle({ id, method, params }) {
  if (method === 'initialize') {
    return { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'uathost', version: '0.0.0' } };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: [TOOL] };
  if (method === 'tools/call' && params?.name === 'approve') {
    const { tool_name: toolName, input = {} } = params.arguments ?? {};
    const decision = decide(toolName, input);
    if (process.env.UAT_HOST_LOG) {
      appendFileSync(process.env.UAT_HOST_LOG, `${JSON.stringify({ at: new Date().toISOString(), tool: toolName, input, behavior: decision.behavior, message: decision.message })}\n`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(decision) }] };
  }
  throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id === undefined) return; // a notification
  try {
    send({ id: message.id, result: handle(message) });
  } catch (error) {
    send({ id: message.id, error: { code: error.code ?? -32603, message: error.message } });
  }
});
