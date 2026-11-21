// The answering hook of an unattended UAT run: the PreToolUse hook on
// AskUserQuestion that the UAT driver gives each case session through
// `--settings`, so that the driver answers the agent's questions with options
// in place of the person of an assisted run.
//
//   node ask-hook.mjs --run <dir> --case <id> --judge-model <m>   (the event on stdin)
//   node ask-hook.mjs --live <file>
//
// It makes one judgement call by ANSWERING.md, with the case's `answers` and
// checks, and returns one of three things to Claude Code:
//
// - an answer: `permissionDecision: "allow"` with an `updatedInput` that
//   repeats `questions` and adds `answers`, keyed by each question's text. Each
//   value is a label of this call's options, a multiSelect question's labels
//   joined with ", ", or the free text an entry says to type in, which Claude
//   Code carries as the question's "Other" (#165). A question no entry fits
//   gets a drift answer among its options, recorded in the case file through
//   `run.mjs drift`, with `drift: true`.
// - the end of the step, at a stop point: `continue: false` with the reason,
//   as a person typing `hecho` ends it.
// - a denial with the reason, when the judgement call failed, or its answer
//   was refused twice: a label that is not an option, or a question left out.
//   The judgement names each question by its index in the call, not its text,
//   which it can miscopy.
//
// Claude Code never checks a value against the options, so the hook does,
// before it answers. Each decision is appended to asks.jsonl in the step
// folder, which the driver reads after each turn and hands to the grading
// call. --live writes the file it names, and nothing else: the liveness check
// runs it as a SessionStart hook, to see that hooks from --settings run.

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asJson, judgement, section } from './claude.mjs';
import { Refused } from './refused.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const skillDir = join(scriptsDir, '..');
const runScript = join(scriptsDir, 'run.mjs');
// The driver reads it under the same name.
const ASKS_FILE = 'asks.jsonl';

const USAGE = 'node ask-hook.mjs --run <dir> --case <id> --judge-model <m> | --live <file>';
const OPTIONS = ['run', 'case', 'judge-model', 'live'];

function usage(message) {
  process.stderr.write(`${message}: ${USAGE}\n`);
  process.exit(2);
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].startsWith('--') ? args[i].slice(2) : null;
    if (!OPTIONS.includes(name)) usage(`takes no option ${args[i]}`);
    if (args[i + 1] === undefined) usage(`--${name} needs a value`);
    options[name] = args[i + 1];
  }
  if (!options.live && !(options.run && options.case && options['judge-model'])) usage('needs --run, --case and --judge-model, or --live');
  return options;
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const labelsOf = (question) => (question.options ?? []).map((option) => option.label);

function askPrompt(uatCase, questions) {
  return [
    '# UAT judgement: ask\n',
    'You stand in for the person in an unattended run of a UAT case: a Claude Code session running one of the kit\'s skills asked the questions below through AskUserQuestion, with options to choose from. Decide by the rules below what the person answers, or whether the step ends here. Follow the rules of an unattended run for a question asked with options.\n',
    section('Rules (ANSWERING.md)', readFileSync(join(skillDir, 'ANSWERING.md'), 'utf8')),
    section('The case', `${uatCase.title}: the person typed \`${uatCase.command}\`.`),
    section("The case's checks, which say where it expects the agent to stop", asJson(uatCase.assertions ?? [])),
    section('`answers` entries', asJson((uatCase.answers ?? []).map((entry, index) => ({ index, ...entry })))),
    section('The questions, with the options of this run', asJson(questions.map((q, index) => ({ index, ...q })))),
    section(
      'Your reply',
      [
        'One JSON object and nothing else, either:',
        '',
        '- `{ "action": "answer", "answers": [...] }` with one answer per question, each `{ "question": <its index above>, "labels": ["<option label>", ...], "entry": <index>, "reason": "..." }`: one label, or one or more for a multiSelect question, each copied exactly from that question\'s options. `entry` is the index of the `answers` entry that fits, or `null` for a drift answer when none fits. When the entry that fits says to type the answer in and no option fulfils it, give `"other": "<the text>"` in place of `labels`; a drift answer is always among the options.',
        '- `{ "action": "end", "reason": "..." }` at a stop point.',
      ].join('\n'),
    ),
  ].join('\n');
}

// The question an answer is for: its index in the call, which a long question
// cannot be miscopied into, or else its exact text. -1 when it names none.
function questionIndex(answer, questions) {
  const named = answer?.question;
  if (Number.isInteger(named)) return named >= 0 && named < questions.length ? named : -1;
  return questions.findIndex((q) => q.question === named);
}

// Why an ask judgement is refused, or null.
function refusalOf(value, questions, entries) {
  if (value.action === 'end') return typeof value.reason === 'string' && value.reason.trim() ? null : 'an end needs its reason';
  if (value.action !== 'answer') return '"action" must be "answer" or "end"';
  if (!Array.isArray(value.answers)) return '"answers" must list one answer per question';
  for (const answer of value.answers) {
    if (questionIndex(answer, questions) === -1) return `${JSON.stringify(answer?.question)} is not the index of a question of this call, from 0 to ${questions.length - 1}`;
  }
  for (const [index, q] of questions.entries()) {
    const given = value.answers.filter((answer) => questionIndex(answer, questions) === index);
    if (given.length !== 1) return `the question "${q.question}" needs exactly one answer, not ${given.length}`;
    const [answer] = given;
    const drift = answer.entry === null;
    if (!drift && !(Number.isInteger(answer.entry) && answer.entry >= 0 && answer.entry < entries)) return `${answer.entry} is not the index of an answers entry, nor null for a drift answer`;
    if (typeof answer.reason !== 'string' || !answer.reason.trim()) return `the answer to "${q.question}" needs its reason`;
    const choices = labelsOf(q).map((label) => `"${label}"`).join(', ');
    if (answer.other !== undefined) {
      if (drift) return `the drift answer to "${q.question}" must be among its options, ${choices}, not free text`;
      if (typeof answer.other !== 'string' || !answer.other.trim()) return `the free text answering "${q.question}" is empty`;
      if (answer.labels !== undefined) return `the answer to "${q.question}" gives labels or free text, not both`;
      continue;
    }
    if (!Array.isArray(answer.labels) || answer.labels.length === 0) return `the answer to "${q.question}" needs its labels`;
    if (!q.multiSelect && answer.labels.length !== 1) return `"${q.question}" takes one label, not ${answer.labels.length}`;
    const unknown = answer.labels.find((label) => !labelsOf(q).includes(label));
    if (unknown !== undefined) return `"${unknown}" is not an option of "${q.question}": this run's options are ${choices}`;
  }
  return null;
}

// Records a drift answer in the case file, as the conductor does.
function recordDrift(runDir, when, intent, reason) {
  const result = spawnSync(process.execPath, [runScript, 'drift', '--run', runDir, '--when', when, '--intent', intent, '--reason', reason], { encoding: 'utf8' });
  if (result.status !== 0) throw new Refused(`run.mjs drift failed: ${(result.stdout || result.stderr).trim()}`);
}

const hookOutput = (decision, reason, extra = {}) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason, ...extra },
});

function answer(options, event) {
  const runDir = options.run;
  const caseId = options.case;
  const state = readJson(join(runDir, 'state.json'));
  const uatCase = readJson(join(state.casesDir, `${caseId}.json`));
  const asks = join(runDir, 'steps', caseId, ASKS_FILE);
  const input = event.tool_input ?? {};
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const log = (entry) => appendFileSync(asks, `${JSON.stringify({ at: new Date().toISOString(), tool_use_id: event.tool_use_id, questions: questions.map((q) => q.question), ...entry })}\n`);

  const step = { id: caseId, workdir: event.cwd ?? process.cwd(), judgeModel: options['judge-model'] };
  const entries = (uatCase.answers ?? []).length;
  let value;
  try {
    value = judgement(step, 'ask', askPrompt(uatCase, questions), (reply) => refusalOf(reply, questions, entries));
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    log({ decision: 'deny', reason: error.message });
    return hookOutput('deny', `The UAT driver could not answer: ${error.message}`);
  }
  if (value.action === 'end') {
    log({ decision: 'stop', reason: value.reason });
    return { continue: false, stopReason: `A stop point of the UAT case, so the step ends here: ${value.reason}`, ...hookOutput('deny', 'The step ends here, at a stop point.') };
  }

  const answers = {};
  const drift = [];
  for (const [index, q] of questions.entries()) {
    const given = value.answers.find((a) => questionIndex(a, questions) === index);
    answers[q.question] = given.other ?? given.labels.join(', ');
    if (given.entry !== null) continue;
    try {
      recordDrift(runDir, q.question, answers[q.question], given.reason);
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      log({ decision: 'deny', reason: error.message });
      return hookOutput('deny', `The UAT driver could not record its drift answer: ${error.message}`);
    }
    drift.push(q.question);
  }
  const used = [...new Set(value.answers.map((a) => a.entry).filter((entry) => entry !== null))];
  log({ decision: 'allow', answers, entries: used, drift });
  return hookOutput('allow', 'Answered by the UAT driver from the case.', { updatedInput: { ...input, questions, answers } });
}

const options = parseArgs(process.argv.slice(2));
if (options.live) {
  writeFileSync(options.live, `${new Date().toISOString()}\n`);
} else {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  process.stdout.write(`${JSON.stringify(answer(options, event))}\n`);
}
