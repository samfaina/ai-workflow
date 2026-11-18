// Sums the tokens every local Claude Code session spent in a time window,
// from the transcripts under ~/.claude/projects, so a /usage delta can be
// split between the spike and whatever else ran meanwhile.
//
//   node meter.mjs mark
//   node meter.mjs window --from <iso> --to <iso> [--spike <spike.json,...>] [--sessions a,b] [--pct <delta>]
//
// --spike and --sessions name the sessions to count apart. --pct is how many
// points /usage rose over the window: the spike's share of it is estimated
// from its share of the tokens, once per token kind, since how each kind
// weighs against the quota is not documented.
//
// Only this machine's sessions are on disk. claude.ai, the desktop app's chat
// and cloud sessions spend the same quota and are missing from the sum.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KINDS = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];

const options = {};
const [mode, ...rest] = process.argv.slice(2);
for (let i = 0; i < rest.length; i += 2) options[rest[i].replace(/^--/, '')] = rest[i + 1];

// The statusline logs each quota reading Claude Code hands it to this file
// (see ~/.claude/statusline.ps1). The percentages come as whole points.
const READINGS = join(homedir(), '.claude', 'rate-limits.jsonl');

function readingAt(time) {
  let found = null;
  for (const line of readFileSync(READINGS, 'utf8').replace(/^﻿/, '').split('\n')) {
    const clean = line.replace(/^﻿/, '').trim();
    if (!clean) continue;
    const reading = JSON.parse(clean);
    if (Date.parse(reading.at) <= time) found = reading;
  }
  return found;
}

if (mode === 'mark') {
  const at = new Date().toISOString();
  console.log(JSON.stringify({ at, reading: readingAt(Date.parse(at)) }));
  process.exit(0);
}
if (mode !== 'window' || !options.from || !options.to) {
  process.stderr.write('usage: node meter.mjs mark | window --from <iso> --to <iso> [--spike <files>] [--sessions <ids>] [--pct <delta>]\n');
  process.exit(2);
}

const from = Date.parse(options.from);
const to = Date.parse(options.to);
const spike = new Set(options.sessions ? options.sessions.split(',') : []);
for (const file of options.spike ? options.spike.split(',') : []) {
  for (const id of JSON.parse(readFileSync(file, 'utf8')).sessions) spike.add(id);
}

function* transcripts(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* transcripts(path);
    else if (entry.name.endsWith('.jsonl') && statSync(path).mtimeMs >= from) yield path;
  }
}

// One API response is written as several lines, one per content block, each
// carrying the same usage: count each message id once.
const messages = new Map();
let files = 0;
for (const file of transcripts(join(homedir(), '.claude', 'projects'))) {
  files += 1;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const usage = entry.message?.usage;
    const at = Date.parse(entry.timestamp);
    if (entry.type !== 'assistant' || !usage || !(at >= from && at <= to)) continue;
    const model = entry.message.model;
    if (!model || model === '<synthetic>') continue;
    messages.set(entry.message.id ?? entry.uuid, { model, usage, session: entry.sessionId });
  }
}

const empty = () => Object.fromEntries(KINDS.map((k) => [k, 0]));
function add(target, model, usage) {
  target[model] ??= empty();
  for (const k of KINDS) target[model][k] += usage[k] ?? 0;
}
const all = {};
const mine = {};
for (const { model, usage, session } of messages.values()) {
  add(all, model, usage);
  if (spike.has(session)) add(mine, model, usage);
}
const total = (byModel) => Object.values(byModel).reduce((acc, u) => {
  for (const k of KINDS) acc[k] += u[k];
  return acc;
}, empty());

const allTotal = total(all);
const spikeTotal = total(mine);
const share = Object.fromEntries(KINDS.map((k) => [k, allTotal[k] ? spikeTotal[k] / allTotal[k] : 0]));
const out = {
  window: { from: options.from, to: options.to },
  transcripts: files,
  messages: messages.size,
  all: { byModel: all, total: allTotal },
  spike: { sessions: [...spike], byModel: mine, total: spikeTotal },
  share,
};
const first = readingAt(from);
const last = readingAt(to);
if (first && last) {
  out.readings = { from: first, to: last, risen: { five_hour: last.five_hour - first.five_hour, seven_day: last.seven_day - first.seven_day } };
  if (last.resets !== first.resets) out.readings.warning = 'the weekly limit reset inside the window: the rise is meaningless';
}
const pctGiven = options.pct ?? (out.readings && !out.readings.warning ? out.readings.risen.seven_day : undefined);
if (pctGiven !== undefined) {
  const pct = Number(pctGiven);
  const points = Object.values(share).filter((s) => s > 0).map((s) => s * pct);
  out.spikePoints = { byKind: Object.fromEntries(KINDS.map((k) => [k, share[k] * pct])), range: points.length ? [Math.min(...points), Math.max(...points)] : [0, 0] };
}
console.log(JSON.stringify(out, null, 2));
