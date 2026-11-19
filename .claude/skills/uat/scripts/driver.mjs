// The UAT driver: `run.mjs auto` conducts an unattended run of one UAT batch,
// playing the person of an assisted run. For each case it runs run.mjs's own
// commands (next, check, record, skip, reset, report) and reader.mjs's, so both
// flows keep the same state, refusals and files:
//
//   next → shell lines → case session in `claude -p` → follow-up turns →
//   check → grading → record, until next is done, then report.
//
// A case session runs in the working copy with the kit loaded from this
// checkout, and its permission prompts go to the permission host
// (permission-host.mjs). Every turn after the first, and every case that
// `continues` an earlier one, resumes the session by id with the same flags.
// A turn that ends in prose gets one judgement call by ANSWERING.md, unless no
// `turns` or `answers` entry is left, and each step one by GRADING.md.
//
// The driver never runs with ANTHROPIC_API_KEY set, so a run is never billed
// to the API. A run it stops can be resumed with `auto --run <dir>`: a step
// left without a result is reset and run again from its restore point.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Refused } from './refused.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const skillDir = join(scriptsDir, '..');
const kitRoot = join(skillDir, '..', '..', '..').replaceAll('\\', '/');
const runScript = join(scriptsDir, 'run.mjs');
const readerScript = join(scriptsDir, 'reader.mjs');
const hostScript = join(scriptsDir, 'permission-host.mjs');

const HOST_SERVER = 'uat';
const HOST_TOOL = `mcp__${HOST_SERVER}__approve`;
export const DEFAULT_JUDGE_MODEL = 'sonnet';
const OUTPUT_LIMIT = 600;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const tail = (text) => (text ?? '').trim().slice(-OUTPUT_LIMIT);

// One command of a script beside this one, as a process. A refusal stops the
// run with the command's own message.
function callScript(file, command, ...args) {
  const result = spawnSync(process.execPath, [file, command, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    let message = tail(result.stderr) || tail(result.stdout);
    try {
      message = JSON.parse(result.stdout).message ?? message;
    } catch {
      // Not JSON: the usage message on stderr stands.
    }
    throw new Refused(`${command} failed: ${message}`);
  }
  return result.stdout;
}
const runMjs = (command, runDir, ...args) => JSON.parse(callScript(runScript, command, '--run', runDir, ...args));
const readerMjs = (command, stepDir, ...args) => JSON.parse(callScript(readerScript, command, '--step', stepDir, ...args));

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

// Runs `claude` with the prompt on stdin, so that no prompt meets a shell's
// quoting or a command line's length limit.
function claude(args, { cwd, input, env = process.env, stdoutFile }) {
  const file = onPath('claude');
  if (!file) throw new Refused('no claude on PATH: the driver runs each case session and judgement call in Claude Code');
  const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
  const command = batch ? (process.env.ComSpec ?? 'cmd.exe') : file;
  const argv = batch ? ['/d', '/s', '/c', `"${[file.replace(CMD_META, '^$1'), ...args.map(cmdArgument)].join(' ')}"`] : args;
  const out = stdoutFile ? openSync(stdoutFile, 'w') : 'pipe';
  try {
    const result = spawnSync(command, argv, { cwd, env, input, encoding: 'utf8', stdio: ['pipe', out, 'pipe'], windowsVerbatimArguments: batch, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw new Refused(`claude did not start: ${result.error.message}`);
    return result;
  } finally {
    if (stdoutFile) closeSync(out);
  }
}

// The case's shell lines, run in the working copy before the session starts,
// as the person runs them in a terminal. The cases write them for PowerShell.
// What they leave in the environment, such as a changed PATH, is the
// environment the case session runs in.
function runShell(uatCase, workdir, stepDir) {
  const lines = uatCase.shell ?? [];
  if (lines.length === 0) return process.env;
  const envFile = join(stepDir, 'shell-env.json');
  const quote = (text) => `'${text.replaceAll("'", "''")}'`;
  const body = [
    "$ErrorActionPreference = 'Stop'",
    ...lines.flatMap((line) => ['$global:LASTEXITCODE = 0', line, 'if ($LASTEXITCODE) { exit $LASTEXITCODE }']),
    `[IO.File]::WriteAllText(${quote(envFile)}, ([Environment]::GetEnvironmentVariables() | ConvertTo-Json -Compress))`,
  ];
  const file = join(stepDir, 'shell.ps1');
  const bom = String.fromCharCode(0xfeff); // so Windows PowerShell reads the file as UTF-8
  writeFileSync(file, `${bom}${body.join('\n')}\n`);
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { cwd: workdir, encoding: 'utf8' });
  if (result.error || result.status !== 0 || !existsSync(envFile)) {
    const why = result.error ? result.error.message : `exit ${result.status}: ${tail(`${result.stdout}${result.stderr}`)}`;
    throw new Refused(`${uatCase.id}: its shell lines failed in ${workdir}: ${why}`);
  }
  return readJson(envFile);
}

// One turn of the case session: the prompt sent, and the turn's stream saved
// in the step folder. The session id comes from the stream's init event.
function sessionTurn(step, prompt, sessionId) {
  const number = step.turnsRun + 1;
  const streamFile = join(step.stepDir, `session-${number}.jsonl`);
  const args = [
    '-p',
    '--plugin-dir', kitRoot,
    '--mcp-config', step.mcpConfig,
    '--permission-prompts', 'host',
    '--permission-prompt-tool', HOST_TOOL,
    '--output-format', 'stream-json',
    '--verbose',
    ...(sessionId ? ['--resume', sessionId] : []),
  ];
  const result = claude(args, { cwd: step.workdir, input: prompt, env: step.env, stdoutFile: streamFile });
  step.turnsRun = number;
  const events = readFileSync(streamFile, 'utf8')
    .split('\n')
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const id = events.find((e) => e.type === 'system' && e.subtype === 'init')?.session_id ?? sessionId;
  const end = events.findLast((e) => e.type === 'result');
  if (result.status !== 0 || !end || end.is_error || !id) {
    const why = end?.is_error ? (end.result ?? end.subtype) : `exit ${result.status}: ${tail(result.stderr)}`;
    throw new Refused(`${step.id}: the case session failed on turn ${number}: ${why}. Run auto again: it restarts the step from its restore point`);
  }
  return { sessionId: id, text: end.result ?? '' };
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

// One judgement call. `accept` returns why a value is refused, or null. A
// refused value is asked again once, with the refusal.
function judgement(step, kind, prompt, accept) {
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

const section = (title, body) => `## ${title}\n\n${body}\n`;
const asJson = (value) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

// The reply to a turn that ended, by ANSWERING.md: the next `turns` entry or an
// `answers` entry, or the end of the step.
function replyPrompt(step, text) {
  const { uatCase } = step;
  const turns = uatCase.turns ?? [];
  const nextTurn = turns[step.turnsSent];
  return [
    '# UAT judgement: reply\n',
    'You stand in for the person in an unattended run of a UAT case: a Claude Code session running one of the kit\'s skills just ended its turn. Decide by the rules below whether the agent is waiting for the person, and what the person replies. The agent asked in prose: follow the rules of an unattended run for a question in prose.\n',
    section('Rules (ANSWERING.md)', readFileSync(join(skillDir, 'ANSWERING.md'), 'utf8')),
    section('The case', `${uatCase.title}: the person typed \`${uatCase.command}\`.`),
    section("The case's checks, which say where it expects the agent to stop", asJson(uatCase.assertions ?? [])),
    section('`answers` entries not used yet', asJson(step.unusedAnswers().map((index) => ({ index, ...uatCase.answers[index] })))),
    section(
      'The next `turns` entry',
      nextTurn ? `Entry ${step.turnsSent + 1} of ${turns.length}, the first not sent yet:\n\n${asJson(nextTurn)}` : 'None: every turn has been sent.',
    ),
    section("The agent's turn", text || '(no text)'),
    section(
      'Your reply',
      [
        'One JSON object and nothing else, either:',
        '',
        '- `{ "action": "reply", "entry": "turn", "message": "...", "reason": "..." }` to send the next `turns` entry,',
        '- `{ "action": "reply", "entry": "answer", "index": <n>, "message": "...", "reason": "..." }` to answer from an `answers` entry, or',
        '- `{ "action": "end", "reason": "..." }` when the agent is not waiting, at a stop point, or when no entry fits.',
        '',
        '`message` is what the person types: the entry\'s intent, written for this turn.',
      ].join('\n'),
    ),
  ].join('\n');
}

function acceptReply(step) {
  return (value) => {
    if (value.action === 'end') return typeof value.reason === 'string' && value.reason.trim() ? null : 'an end needs its reason';
    if (value.action !== 'reply') return '"action" must be "reply" or "end"';
    if (typeof value.message !== 'string' || !value.message.trim()) return 'a reply needs the message the person types';
    if (value.entry === 'turn') return step.turnsSent < (step.uatCase.turns ?? []).length ? null : 'every turn has been sent';
    if (value.entry === 'answer') return step.unusedAnswers().includes(value.index) ? null : `answers entry ${value.index} is not one left`;
    return '"entry" must be "turn" or "answer"';
  };
}

function gradePrompt(step, ended, checks, summary) {
  const hostLog = existsSync(step.hostLog) ? readFileSync(step.hostLog, 'utf8').trim() : '';
  return [
    '# UAT judgement: grade\n',
    'You grade one step of an unattended run of a UAT case, by the rules below. Your working directory is the working copy the step ran in: read it with your tools when the evidence needs it. Reply with the grades file, one JSON object and nothing else.\n',
    section('Rules (GRADING.md)', readFileSync(join(skillDir, 'GRADING.md'), 'utf8')),
    section('The case', asJson(step.uatCase)),
    section('How the step ended', ended),
    section('Assertion results', asJson(checks)),
    section('Step summary (reader.mjs summary)', asJson(summary)),
    section(
      'Permission host log',
      `Each permission prompt of the case session and the host's decision. A denial the case did not expect is an environment problem.\n\n${hostLog ? `\`\`\`\n${hostLog}\n\`\`\`` : 'No permission prompt reached the host.'}`,
    ),
  ].join('\n');
}

// The session a `continues` case resumes: the one its earlier case picked.
function continuedSession(runDir, uatCase) {
  const earlier = join(runDir, 'steps', uatCase.continues, 'step.json');
  const session = existsSync(earlier) ? readJson(earlier).session : undefined;
  if (!session) throw new Refused(`${uatCase.id}: continues ${uatCase.continues}, whose session is not known`);
  return session;
}

function runStep(runDir, judgeModel, uatCase, brief) {
  const { stepDir, workdir } = brief;
  const step = {
    id: uatCase.id,
    uatCase,
    stepDir,
    workdir,
    judgeModel,
    hostLog: join(stepDir, 'permissions.jsonl'),
    mcpConfig: join(stepDir, 'permission-host.json'),
    turnsRun: 0,
    turnsSent: 0,
    used: new Set(),
    unusedAnswers: () => (uatCase.answers ?? []).map((_, index) => index).filter((index) => !step.used.has(index)),
  };
  writeJson(step.mcpConfig, { mcpServers: { [HOST_SERVER]: { command: process.execPath, args: [hostScript, '--workdir', workdir, '--log', step.hostLog] } } });
  step.env = runShell(uatCase, workdir, stepDir);

  const continues = readJson(join(stepDir, 'step.json')).continues;
  let { sessionId, text } = sessionTurn(step, brief.paste.command, continues ? continuedSession(runDir, uatCase) : null);
  readerMjs('pick', stepDir, '--session', sessionId);
  let ended;
  for (;;) {
    if (step.turnsSent === (uatCase.turns ?? []).length && step.unusedAnswers().length === 0) {
      ended = 'Every `turns` and `answers` entry had been used when the agent ended its turn, so the step ended there.';
      break;
    }
    const reply = judgement(step, 'reply', replyPrompt(step, text), acceptReply(step));
    if (reply.action === 'end') {
      ended = `The agent ended its turn and the step ended there, unanswered: ${reply.reason}`;
      break;
    }
    if (reply.entry === 'turn') step.turnsSent += 1;
    else step.used.add(reply.index);
    ({ sessionId, text } = sessionTurn(step, reply.message, sessionId));
    const turn = step.turnsSent;
    if (reply.entry === 'turn' && (uatCase.turns[turn - 1].assertions ?? []).length > 0) runMjs('check', runDir, '--turn', String(turn));
  }

  runMjs('check', runDir);
  const checks = readJson(join(stepDir, 'checks.json'));
  const summary = readerMjs('summary', stepDir);
  const gradesFile = join(stepDir, 'grades.json');
  judgement(step, 'grade', gradePrompt(step, ended, checks, summary), (grades) => {
    writeJson(gradesFile, grades);
    try {
      runMjs('record', runDir, '--grades', gradesFile);
      return null;
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return error.message;
    }
  });
}

// Runs the batch of the run folder, a new one when `source` is given, until
// next is done, then writes the report. Returns what auto prints.
export function auto(options) {
  if (process.env.ANTHROPIC_API_KEY) {
    throw new Refused('ANTHROPIC_API_KEY is set: an unattended run spends the plan, never the API. Unset it and run auto again');
  }
  const runDir = resolve(options.run);
  const stateFile = join(runDir, 'state.json');
  if (!existsSync(stateFile)) {
    if (!options.source) throw new Refused(`no run in ${runDir}: give --source <clone> to start one`);
    const chosen = ['cases', 'cases-dir'].filter((name) => options[name]).flatMap((name) => [`--${name}`, options[name]]);
    callScript(runScript, 'init', '--run', runDir, '--source', options.source, ...chosen);
  } else if (options.cases || options['cases-dir']) {
    throw new Refused(`${runDir} already holds a run, whose cases were chosen when it started: drop --cases and --cases-dir to resume it`);
  }
  const judgeModel = options['judge-model'] ?? DEFAULT_JUDGE_MODEL;

  for (;;) {
    const state = readJson(stateFile);
    const id = state.cases.find((caseId) => !state.results[caseId]);
    if (!id) break;
    const uatCase = readJson(join(state.casesDir, `${id}.json`));
    if (uatCase.assisted !== undefined) {
      runMjs('skip', runDir, '--reason', `An assisted case, which only runs with a person: ${uatCase.assisted}`);
      continue;
    }
    const brief = runMjs('next', runDir);
    if (brief.status === 'blocked') {
      runMjs('skip', runDir, '--reason', `Blocked: it starts from ${brief.needs}, which did not pass and so left no restore point.`);
    } else if (brief.resumed) {
      // A step cut short cannot be resumed half-way: it starts again from its restore point.
      runMjs('reset', runDir, '--case', id);
    } else {
      runStep(runDir, judgeModel, uatCase, brief);
    }
  }

  callScript(runScript, 'report', '--run', runDir);
  const { cases, results } = readJson(stateFile);
  return {
    status: 'done',
    run: runDir,
    summary: join(runDir, 'summary.md'),
    review: join(runDir, 'review.md'),
    cases: cases.map((caseId) => ({ case: caseId, verdict: results[caseId].verdict })),
  };
}
