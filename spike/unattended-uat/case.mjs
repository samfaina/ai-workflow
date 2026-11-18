// Runs the next UAT case of a run with nobody at the keyboard, to measure what
// one case costs. It drives the same run.mjs as /uat: `next` restores the
// working copy, the case runs in `claude -p`, hook.mjs answers its questions,
// a short model call writes each follow-up turn, and `check` plus one grading
// call close the step.
//
//   node case.mjs --run <dir> [--model <m>] [--judge-model <m>] [--max-turns <n>] [--record]
//
// --model is the case session's model (default: your default). --judge-model
// is for the answering, turn and grading calls (default: sonnet). --record
// saves the grades with `run.mjs record`, so the next case can run. Drift, on
// AskUserQuestion only, is logged in spike-calls.jsonl, never written to a case.
//
// Writes into the step folder: spike.json (sessions, usage, the window to
// give meter.mjs), spike-calls.jsonl, spike-host.jsonl, spike-stream-<n>.jsonl.

import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { ask, callsLog, jsonIn, kitRoot, readerScript, readJson, readText, runScript, spikeDir, uatDir } from './lib.mjs';

const options = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const name = argv[i].replace(/^--/, '');
  if (name === 'record') options.record = true;
  else options[name] = argv[(i += 1)];
}
if (!options.run) {
  process.stderr.write('usage: node case.mjs --run <dir> [--model <m>] [--judge-model <m>] [--max-turns <n>] [--record]\n');
  process.exit(2);
}
if (process.env.ANTHROPIC_API_KEY) {
  process.stderr.write('ANTHROPIC_API_KEY is set: this run would be billed to the API, not measured against the plan. Unset it.\n');
  process.exit(1);
}
const judgeModel = options['judge-model'] ?? 'sonnet';
const maxTurns = Number(options['max-turns'] ?? 12);
const log = (text) => process.stderr.write(`[spike] ${text}\n`);

function node(script, args) {
  const child = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  if (child.status !== 0) throw new Error(`${script} ${args[0]} exited ${child.status}: ${child.stderr || child.stdout}`);
  return JSON.parse(child.stdout);
}

// --- prepare ---------------------------------------------------------------

const brief = node(runScript, ['next', '--run', options.run]);
if (brief.status !== 'ready') {
  console.log(JSON.stringify(brief, null, 2));
  process.exit(brief.status === 'done' ? 0 : 1);
}
const { stepDir, workdir } = brief;
if (existsSync(join(stepDir, 'spike.json'))) {
  log(`${brief.case} already ran in this step: record or skip it with run.mjs first`);
  process.exit(1);
}
const caseFile = join(uatDir, 'cases', `${brief.case}.json`);
const uatCase = readJson(caseFile);
const startedAt = new Date().toISOString();
log(`case ${brief.case} in ${workdir}`);

for (const line of uatCase.shell ?? []) {
  log(`shell: ${line}`);
  const child = spawnSync(line, { cwd: workdir, shell: true, stdio: ['ignore', 'ignore', 'inherit'] });
  if (child.status !== 0) {
    log(`shell step failed (${child.status}): an environment problem, not the skill's`);
    process.exit(1);
  }
}

const settingsFile = join(stepDir, 'spike-settings.json');
writeFileSync(settingsFile, JSON.stringify({
  hooks: {
    PreToolUse: [{
      matcher: 'AskUserQuestion',
      hooks: [{ type: 'command', command: `node "${join(spikeDir, 'hook.mjs').replaceAll('\\', '/')}"`, timeout: 300, onFailure: 'block' }],
    }],
  },
}, null, 2));
const mcpFile = join(stepDir, 'spike-mcp.json');
writeFileSync(mcpFile, JSON.stringify({
  mcpServers: {
    uathost: { command: process.execPath, args: [join(spikeDir, 'host.mjs')], env: { UAT_WORKDIR: workdir, UAT_HOST_LOG: join(stepDir, 'spike-host.jsonl') } },
  },
}, null, 2));

// A resume restores none of these, so every turn passes them again.
const flags = [
  '--plugin-dir', kitRoot,
  '--settings', settingsFile,
  '--mcp-config', mcpFile,
  '--permission-prompts', 'host',
  '--permission-prompt-tool', 'mcp__uathost__approve',
  '--output-format', 'stream-json', '--verbose',
  ...(options.model ? ['--model', options.model] : []),
];
const env = { ...process.env, UAT_CASE_FILE: caseFile, UAT_STEP_DIR: stepDir, UAT_JUDGE_MODEL: judgeModel };

// --- run the session -------------------------------------------------------

const turns = [];
let costBaseline = 0;

function runTurn(n, prompt, resumeId) {
  const args = ['-p', prompt, ...(resumeId ? ['--resume', resumeId] : []), ...flags];
  const raw = createWriteStream(join(stepDir, `spike-stream-${n}.jsonl`));
  const child = spawn('claude', args, { cwd: workdir, env, stdio: ['ignore', 'pipe', 'inherit'] });
  const turn = { n, prompt, startedAt: new Date().toISOString() };
  createInterface({ input: child.stdout }).on('line', (line) => {
    raw.write(`${line}\n`);
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.type === 'system' && event.subtype === 'init') turn.session_id = event.session_id;
    if (event.type === 'assistant') {
      for (const block of event.message?.content ?? []) if (block.type === 'tool_use') log(`  tool: ${block.name}`);
    }
    if (event.type === 'result') {
      Object.assign(turn, {
        session_id: event.session_id ?? turn.session_id,
        is_error: event.is_error,
        subtype: event.subtype,
        num_turns: event.num_turns,
        duration_ms: event.duration_ms,
        usage: event.usage,
        // On a --resume, total_cost_usd covers the whole session so far.
        session_cost_usd: event.total_cost_usd,
        total_cost_usd: (event.total_cost_usd ?? 0) - costBaseline,
        result: event.result,
      });
    }
  });
  return new Promise((done) => child.on('close', (code) => {
    raw.end();
    if (turn.session_cost_usd !== undefined) costBaseline = turn.session_cost_usd;
    turn.exit = code;
    turn.endedAt = new Date().toISOString();
    turns.push(turn);
    done(turn);
  }));
}

// A turn that ends in prose is a question like any other: it is answered from
// an `answers` entry whose `when` fits, or from the next entry of `turns`.
// When none fits, or the question is where the case expects the agent to
// stop, the step ends, as it does when a person types `hecho`: a reply
// invented for an open prose question can take the agent past the case.
// Drift stays with AskUserQuestion, whose options bound it (hook.mjs).
function nextReply(lastText, sent) {
  const pending = (uatCase.turns ?? []).slice(sent);
  const answers = uatCase.answers ?? [];
  if (!pending.length && !answers.length) return { waiting: false, reply: null, turn: null, reason: 'no answers or turns left: the step ends' };
  const prompt = `You stand in for the person in an unattended UAT run. The agent under test has just ended its turn. Decide whether it is waiting for the person, and if so whether the case says what to reply.

<rules>
${readText(join(uatDir, 'ANSWERING.md'))}
</rules>

<case_answers>
${JSON.stringify(answers, null, 2)}
</case_answers>

<next_turn index="${sent}">
${pending.length ? JSON.stringify(pending[0], null, 2) : 'none left'}
</next_turn>

<case_checks>
${JSON.stringify((uatCase.assertions ?? []).map((a) => a.judge ?? a.name ?? a.file ?? a.run), null, 2)}
</case_checks>

<agent_turn_end>
${lastText ?? ''}
</agent_turn_end>

The agent is waiting only when its turn ends by asking the person something. A final report, a recommendation of the next command, or a note on something to confirm later is not waiting.
When it asks one or more questions, answer each from the case_answers entry whose "when" fits it; an entry can answer several questions. When it asks for what next_turn's intent covers, use next_turn. An intent may hold a condition ("If it asks for X: ..."): it fits only when the condition holds, and the condition is never part of the reply.
End the step instead (fits: false) when the question is where case_checks expect the agent to stop, such as an approval it must only ask for, or when some question has no fitting entry. Never write a reply that no entry covers.
Write the reply as the person would type it, in the language the agent uses, carrying the intents' content, one line per question when there are several.
Reply with one JSON object and nothing else:
{"waiting": <bool>, "fits": <bool>, "reply": "<the message, or null>", "used": "answers" | "turn" | null, "reason": "<why>"}`;
  const decision = jsonIn(ask(prompt, { kind: 'turn', stepDir, model: judgeModel, cwd: stepDir }));
  const send = decision.waiting && decision.fits && decision.reply;
  const usedTurn = send && decision.used === 'turn' && pending.length;
  return { ...decision, reply: send ? decision.reply : null, turn: usedTurn ? sent : null };
}

let sessionId = null;
if (brief.paste.shell.at(-1).includes('--continue')) {
  const earlier = join(options.run, 'steps', uatCase.continues, 'spike.json');
  if (!existsSync(earlier)) throw new Error(`${uatCase.continues} did not run through the spike: no session to resume`);
  const earlierReport = readJson(earlier);
  sessionId = earlierReport.caseSession;
  costBaseline = earlierReport.caseTurns.at(-1)?.session_cost_usd ?? 0;
}

let turn = await runTurn(0, brief.paste.command, sessionId);
sessionId = turn.session_id;
log(`turn 0: ${turn.subtype ?? 'no result'}, session ${sessionId}`);
let sent = 0;
for (let n = 1; n <= maxTurns && !turn.is_error && turn.exit === 0; n += 1) {
  const decision = nextReply(turn.result, sent);
  turn.followUp = decision;
  if (!decision.reply) {
    log(`step ends: ${decision.reason}`);
    break;
  }
  if (decision.turn !== null) sent = decision.turn + 1;
  log(`turn ${n} (${decision.used}): ${decision.reply.replaceAll('\n', ' / ')}`);
  turn = await runTurn(n, decision.reply, sessionId);
  const assertions = decision.turn !== null && uatCase.turns?.[decision.turn]?.assertions;
  if (assertions) turn.check = node(runScript, ['check', '--run', options.run, '--turn', String(decision.turn + 1)]);
}

// --- grade -----------------------------------------------------------------

node(readerScript, ['pick', '--step', stepDir, '--session', sessionId]);
const checks = node(runScript, ['check', '--run', options.run]);
const summary = node(readerScript, ['summary', '--step', stepDir]);
const criteria = (uatCase.assertions ?? []).filter((a) => a.judge).map((a) => a.judge);

const gradePrompt = `Grade one step of a UAT case by these rules. The working copy is your current directory: read it when a criterion needs it.

<rules>
${readText(join(uatDir, 'GRADING.md'))}
</rules>

<case>
${JSON.stringify(uatCase, null, 2)}
</case>

<assertion_results>
${JSON.stringify(checks, null, 2)}
</assertion_results>

<step_summary>
${JSON.stringify(summary, null, 2)}
</step_summary>

<judge_criteria>
${JSON.stringify(criteria, null, 2)}
</judge_criteria>

Reply with the grades file as one JSON object and nothing else.`;
const grades = jsonIn(ask(gradePrompt, { kind: 'grade', stepDir, model: judgeModel, cwd: workdir, tools: ['Read', 'Grep', 'Glob'] }));
const gradesFile = join(stepDir, 'spike-grades.json');
writeFileSync(gradesFile, `${JSON.stringify(grades, null, 2)}\n`);
if (options.record) node(runScript, ['record', '--run', options.run, '--grades', gradesFile]);

// --- report ----------------------------------------------------------------

const endedAt = new Date().toISOString();
const calls = existsSync(callsLog(stepDir))
  ? readText(callsLog(stepDir)).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.session_id)
  : [];
const sum = (items) => items.reduce((acc, { usage = {}, total_cost_usd = 0 }) => {
  for (const [k, v] of Object.entries(usage)) if (typeof v === 'number') acc[k] = (acc[k] ?? 0) + v;
  acc.total_cost_usd += total_cost_usd ?? 0;
  return acc;
}, { total_cost_usd: 0 });

const report = {
  case: brief.case,
  startedAt,
  endedAt,
  caseSession: sessionId,
  sessions: [sessionId, ...calls.map((c) => c.session_id)],
  verdict: grades.verdict,
  recorded: Boolean(options.record),
  caseTurns: turns.map(({ result, ...t }) => t),
  calls,
  totals: { caseSession: sum(turns), judgement: sum(calls), all: sum([...turns, ...calls]) },
  meter: `node ${join(spikeDir, 'meter.mjs')} window --from ${startedAt} --to ${endedAt} --spike ${join(stepDir, 'spike.json')}`,
};
writeFileSync(join(stepDir, 'spike.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ case: report.case, verdict: report.verdict, totals: report.totals, meter: report.meter }, null, 2));
