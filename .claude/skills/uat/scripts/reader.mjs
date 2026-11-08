#!/usr/bin/env node
// Reads the Claude Code session of one UAT step from its log, so the conductor
// never has to load the log itself. A step folder holds step.json, written by
// run.mjs, and watch.json, the reader's memory of what it already reported.
//
//   node reader.mjs watch   --step <dir> [--timeout <s>] [--interval <ms>]
//   node reader.mjs peek    --step <dir>
//   node reader.mjs summary --step <dir> | --file <session.jsonl>
//   node reader.mjs pick    --step <dir> --session <id>
//
// watch exits as soon as something needs the person and prints it as JSON:
// status is question, turn_end, ambiguous or timeout. peek prints the same for
// the current moment, whatever watch already reported, and writes nothing.
//
// Exit codes: 0 reported, 2 usage or missing step, 3 unrecognized log format.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const EXIT_USAGE = 2;
const EXIT_UNRECOGNIZED = 3;
const AGENT_TURN_LIMIT = 2000;
const TOOL_ERROR_LIMIT = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

class UnrecognizedLog extends Error {}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(EXIT_USAGE);
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || args[i + 1] === undefined) fail(`bad argument: ${args[i]}`);
    options[args[i].slice(2)] = args[i + 1];
  }
  return options;
}

function loadStep(stepDir) {
  const file = join(stepDir ?? '', 'step.json');
  if (!stepDir || !existsSync(file)) fail(`no step.json in ${stepDir}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function logFolder(workdir) {
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return join(config, 'projects', workdir.replace(/[^A-Za-z0-9]/g, '-'));
}

function checkEntry(entry, file) {
  const known = entry !== null && typeof entry === 'object' && typeof entry.type === 'string';
  if (!known) throw new UnrecognizedLog(`${file}: an entry has no type`);
  if (entry.type !== 'user' && entry.type !== 'assistant') return;
  const content = entry.message?.content;
  const fits = entry.type === 'user' ? typeof content === 'string' || Array.isArray(content) : Array.isArray(content);
  if (!fits) throw new UnrecognizedLog(`${file}: a ${entry.type} entry has no message content`);
}

// Claude Code does not document this format. Every complete line must look as
// expected; only the last line may be unfinished, since the file is live.
function readEntries(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.pop(); // what follows the last newline: empty, or half-written
  const entries = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new UnrecognizedLog(`${file}: a line is not JSON`);
    }
    checkEntry(entry, file);
    if (!entry.isSidechain && !entry.isMeta) entries.push(entry);
  }
  return entries;
}

const isDialogue = (entry) => entry.type === 'user' || entry.type === 'assistant';
const after = (entries, since) => entries.filter((e) => isDialogue(e) && Date.parse(e.timestamp) >= since);

function plainText(content) {
  if (typeof content === 'string') return content;
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function commandIn(content) {
  const text = plainText(content);
  const name = text.match(/<command-name>([^<]*)<\/command-name>/)?.[1];
  if (!name) return null;
  const args = text.match(/<command-args>([^<]*)<\/command-args>/)?.[1]?.trim();
  return args ? `${name} ${args}` : name;
}

function firstPrompt(entries) {
  const first = entries.find((e) => e.type === 'user');
  return first ? (commandIn(first.message.content) ?? plainText(first.message.content)).slice(0, 200) : '';
}

function loadSessions(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => ({ id: name.slice(0, -'.jsonl'.length), entries: readEntries(join(folder, name)) }));
}

// The session of this step: the pinned one, or the one in the working copy's
// log folder that began after the step did. A continued session began before
// it, so there the test is that it has been active since.
function findSession(stepDir, step, { pin }) {
  const folder = logFolder(step.workdir);
  const since = Date.parse(step.startedAt);
  const all = loadSessions(folder);
  if (step.session) {
    const pinned = all.find((s) => s.id === step.session);
    return pinned ? { session: pinned } : { none: folder };
  }
  const startTime = (s) => Date.parse(s.entries.find((e) => e.timestamp)?.timestamp ?? '');
  const qualifies = step.continues ? (s) => after(s.entries, since).length > 0 : (s) => startTime(s) >= since;
  const candidates = all.filter(qualifies);
  if (candidates.length === 0) return { none: folder };
  if (candidates.length > 1) {
    return {
      ambiguous: {
        status: 'ambiguous',
        candidates: candidates.map((s) => ({
          session: s.id,
          startedAt: new Date(startTime(s)).toISOString(),
          firstPrompt: firstPrompt(s.entries),
        })),
      },
    };
  }
  if (pin) writeJson(join(stepDir, 'step.json'), { ...step, session: candidates[0].id });
  return { session: candidates[0] };
}

function openQuestions(entries) {
  const open = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry.message.content)) continue;
    for (const block of entry.message.content) {
      if (entry.type === 'assistant' && block.type === 'tool_use' && block.name === 'AskUserQuestion') {
        open.set(block.id, block.input.questions);
      }
      if (entry.type === 'user' && block.type === 'tool_result') open.delete(block.tool_use_id);
    }
  }
  return [...open];
}

// The turn the agent has finished, when no user entry follows it. One message
// can span several entries, so its text is gathered by message id.
function waitingTurn(entries) {
  const last = entries.at(-1);
  if (last?.type !== 'assistant' || last.message.stop_reason !== 'end_turn') return null;
  return { id: last.message.id, text: messageText(entries, last.message.id) };
}

function messageText(entries, messageId) {
  return entries
    .filter((e) => e.type === 'assistant' && e.message.id === messageId)
    .map((e) => plainText(e.message.content))
    .filter(Boolean)
    .join('\n');
}

const shapeQuestion = (q) => ({
  header: q.header,
  question: q.question,
  multiSelect: Boolean(q.multiSelect),
  options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description })),
});

// What needs the person now, leaving out the ids in `shown`.
function pending(session, since, shown) {
  const entries = after(session.entries, since);
  const open = openQuestions(entries).find(([id]) => !shown.has(id));
  if (open) {
    const [toolUseId, questions] = open;
    return { status: 'question', session: session.id, toolUseId, questions: questions.map(shapeQuestion) };
  }
  const turn = waitingTurn(entries);
  if (turn && !shown.has(turn.id)) return { status: 'turn_end', session: session.id, messageId: turn.id, text: turn.text };
  return null;
}

function loadShown(stepDir) {
  const file = join(stepDir, 'watch.json');
  return new Set(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).shown : []);
}

async function watch(options) {
  const shown = loadShown(options.step);
  const deadline = Date.now() + Number(options.timeout ?? 1800) * 1000;
  const interval = Number(options.interval ?? 1000);
  let settling = null;
  for (;;) {
    const step = loadStep(options.step);
    const { session, ambiguous } = findSession(options.step, step, { pin: true });
    if (ambiguous) return print(ambiguous);
    const found = session ? pending(session, Date.parse(step.startedAt), shown) : null;
    // A turn end is reported only once it has stayed the same for one more
    // poll: its text may still be arriving in a later entry of the message.
    const key = found?.status === 'turn_end' ? `${found.messageId}:${found.text.length}` : null;
    if (found && (found.status !== 'turn_end' || key === settling)) {
      shown.add(found.toolUseId ?? found.messageId);
      writeJson(join(options.step, 'watch.json'), { shown: [...shown] });
      return print(found);
    }
    settling = key;
    if (Date.now() >= deadline) return print({ status: 'timeout', session: session?.id ?? null });
    await sleep(interval);
  }
}

function peek(options) {
  const step = loadStep(options.step);
  const { session, ambiguous, none } = findSession(options.step, step, { pin: false });
  if (ambiguous) return print(ambiguous);
  if (!session) return print({ status: 'no_session', folder: none });
  print(pending(session, Date.parse(step.startedAt), new Set()) ?? { status: 'working', session: session.id });
}

function summarize(id, entries) {
  const asked = [];
  const answers = new Map();
  const toolNames = new Map();
  const toolCalls = {};
  const toolErrors = [];
  const userTurns = [];
  const agentTurnIds = [];
  let command = null;
  let lastAgentText = '';

  for (const entry of entries) {
    const { content } = entry.message;
    if (entry.type === 'assistant') {
      const text = plainText(content);
      if (text.trim()) lastAgentText = text;
      if (entry.message.stop_reason === 'end_turn' && !agentTurnIds.includes(entry.message.id)) agentTurnIds.push(entry.message.id);
      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        if (block.name === 'AskUserQuestion') {
          asked.push(block);
        } else {
          toolNames.set(block.id, block.name);
          toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1;
        }
      }
      continue;
    }
    const results = Array.isArray(content) ? content.filter((b) => b.type === 'tool_result') : [];
    for (const result of results) {
      if (toolNames.has(result.tool_use_id)) {
        if (result.is_error) {
          const text = typeof result.content === 'string' ? result.content : plainText(result.content ?? []);
          toolErrors.push({ tool: toolNames.get(result.tool_use_id), text: text.slice(0, TOOL_ERROR_LIMIT) });
        }
      } else {
        answers.set(result.tool_use_id, { values: entry.toolUseResult?.answers ?? {}, rejected: Boolean(result.is_error) });
      }
    }
    if (results.length > 0) continue;
    const found = commandIn(content);
    const text = plainText(content).trim();
    if (found && command === null) command = found;
    else if (found) userTurns.push(found);
    else if (text && !text.startsWith('<')) userTurns.push(text);
  }

  const questions = asked.flatMap((block) =>
    block.input.questions.map((q) => {
      const answer = answers.get(block.id);
      return {
        header: q.header,
        question: q.question,
        multiSelect: Boolean(q.multiSelect),
        options: (q.options ?? []).map((o) => o.label),
        answer: answer?.values[q.question] ?? null,
        ...(answer?.rejected ? { rejected: true } : {}),
      };
    }),
  );
  const agentTurns = agentTurnIds.map((messageId) => messageText(entries, messageId).slice(0, AGENT_TURN_LIMIT));
  return { session: id, command, questions, userTurns, toolCalls, toolErrors, agentTurns, lastAgentText };
}

function summary(options) {
  if (options.file) {
    const entries = readEntries(options.file).filter(isDialogue);
    return print(summarize(basename(options.file, '.jsonl'), entries));
  }
  const step = loadStep(options.step);
  const { session, ambiguous, none } = findSession(options.step, step, { pin: false });
  if (ambiguous) return print(ambiguous);
  if (!session) return print({ status: 'no_session', folder: none });
  print(summarize(session.id, after(session.entries, Date.parse(step.startedAt))));
}

function pick(options) {
  if (!options.session) fail('pick needs --session <id>');
  writeJson(join(options.step, 'step.json'), { ...loadStep(options.step), session: options.session });
  print({ status: 'picked', session: options.session });
}

const MODES = { watch, peek, summary, pick };
const [mode, ...rest] = process.argv.slice(2);
if (!Object.hasOwn(MODES, mode ?? '')) fail('usage: reader.mjs watch|peek|summary|pick --step <dir> [options]');
try {
  await MODES[mode](parseArgs(rest));
} catch (error) {
  if (!(error instanceof UnrecognizedLog)) throw error;
  process.stderr.write(`unrecognized session log: ${error.message}\n`);
  process.exit(EXIT_UNRECOGNIZED);
}
