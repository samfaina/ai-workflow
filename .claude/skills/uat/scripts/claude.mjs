// Claude Code as the UAT driver runs it: the command line that starts
// `claude`, and the judgement calls, which the driver makes for prose turns and
// grades and the answering hook (ask-hook.mjs) makes for AskUserQuestion.

import { closeSync, existsSync, openSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';

import { Refused } from './refused.mjs';

const OUTPUT_LIMIT = 600;
export const tail = (text) => (text ?? '').trim().slice(-OUTPUT_LIMIT);

// The file PATH runs for `name`, as a shell finds it, with PATHEXT on Windows.
function onPath(name) {
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH');
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of (process.env[pathKey] ?? '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const file = join(dir, `${name}${extension}`);
      if (existsSync(file) && statSync(file).isFile()) return file;
    }
  }
  return null;
}

// cmd.exe parses a batch file's command line twice, once for /c and once when
// the batch expands %*, so each argument is quoted and its metacharacters
// escaped twice, the way npm's own tooling does it.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
function cmdArgument(arg) {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

// How to start `claude` with `args`, for spawn or spawnSync: through cmd.exe
// when PATH finds a batch file, as npm installs it on Windows.
export function claudeCommand(args) {
  const file = onPath('claude');
  if (!file) throw new Refused('no claude on PATH: the driver runs each case session and judgement call in Claude Code');
  const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
  if (!batch) return { command: file, argv: args, windowsVerbatimArguments: false };
  const line = `"${[file.replace(CMD_META, '^$1'), ...args.map(cmdArgument)].join(' ')}"`;
  return { command: process.env.ComSpec ?? 'cmd.exe', argv: ['/d', '/s', '/c', line], windowsVerbatimArguments: true };
}

// Runs `claude` with the prompt on stdin, so that no prompt meets a shell's
// quoting or a command line's length limit.
export function claude(args, { cwd, input, env = process.env, stdoutFile }) {
  const { command, argv, windowsVerbatimArguments } = claudeCommand(args);
  const out = stdoutFile ? openSync(stdoutFile, 'w') : 'pipe';
  try {
    const result = spawnSync(command, argv, { cwd, env, input, encoding: 'utf8', stdio: ['pipe', out, 'pipe'], windowsVerbatimArguments, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw new Refused(`claude did not start: ${result.error.message}`);
    return result;
  } finally {
    if (stdoutFile) closeSync(out);
  }
}

// The first JSON object in a judgement's text, fenced or not.
function jsonIn(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// One judgement call for the step `{ id, workdir, judgeModel }`. `accept`
// returns why a value is refused, or null. A refused value is asked again once,
// with the refusal, and refused twice it stops with that refusal.
export function judgement(step, kind, prompt, accept) {
  const tools = kind === 'grade' ? 'Read,Grep,Glob' : '';
  const args = ['-p', '--model', step.judgeModel, '--output-format', 'json', '--no-session-persistence', '--tools', tools];
  let ask = prompt;
  for (let attempt = 1; ; attempt += 1) {
    const result = claude(args, { cwd: step.workdir, input: ask });
    let text = null;
    try {
      text = JSON.parse(result.stdout).result;
    } catch {
      // Left null: refused below.
    }
    if (result.status !== 0 || typeof text !== 'string') {
      throw new Refused(`${step.id}: the ${kind} judgement call failed: exit ${result.status}: ${tail(result.stderr) || tail(result.stdout)}`);
    }
    const value = jsonIn(text);
    const refusal = value === null ? 'the reply holds no JSON object' : accept(value);
    if (refusal === null) return value;
    if (attempt === 2) throw new Refused(`${step.id}: the ${kind} judgement was refused twice: ${refusal}`);
    ask = `${prompt}\n\n## Your last reply was refused\n\n${refusal}\n\nReply again with one JSON object.`;
  }
}

// The parts a judgement's prompt is built of.
export const section = (title, body) => `## ${title}\n\n${body}\n`;
export const asJson = (value) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
