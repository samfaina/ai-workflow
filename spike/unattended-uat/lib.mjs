// Shared by the spike's scripts: the paths they agree on, and the short
// `claude -p` calls that stand in for the person's judgement.

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const spikeDir = dirname(fileURLToPath(import.meta.url));
export const kitRoot = join(spikeDir, '..', '..').replaceAll('\\', '/');
export const uatDir = join(kitRoot, '.claude', 'skills', 'uat');
export const runScript = join(uatDir, 'scripts', 'run.mjs');
export const readerScript = join(uatDir, 'scripts', 'reader.mjs');

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const readText = (file) => readFileSync(file, 'utf8');

// Every judgement call is logged here, one JSON line each, so meter.mjs can
// tell the spike's sessions from the rest.
export const callsLog = (stepDir) => join(stepDir, 'spike-calls.jsonl');

export function logCall(stepDir, entry) {
  appendFileSync(callsLog(stepDir), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

// The JSON object in a model reply, fenced or not.
export function jsonIn(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`no JSON object in reply: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

// One short `claude -p` call. The prompt goes through stdin, since a Windows
// command line stops at 32k characters. Tools are off unless named.
export function ask(prompt, { kind, stepDir, model, cwd, tools = [] }) {
  const args = ['-p', '--output-format', 'json', '--permission-prompts', 'none', '--tools', tools.join(',')];
  if (model) args.push('--model', model);
  const started = Date.now();
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('UAT_')) delete env[name];
  const child = spawnSync('claude', args, { cwd, input: prompt, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  if (child.error) throw child.error;
  let result;
  try {
    result = JSON.parse(child.stdout);
  } catch {
    throw new Error(`claude -p (${kind}) exited ${child.status}: ${(child.stderr || child.stdout).slice(0, 500)}`);
  }
  logCall(stepDir, {
    kind,
    session_id: result.session_id,
    model: model ?? null,
    usage: result.usage,
    total_cost_usd: result.total_cost_usd,
    duration_ms: Date.now() - started,
    is_error: result.is_error,
  });
  if (result.is_error) throw new Error(`claude -p (${kind}) failed: ${result.result}`);
  return result.result;
}
