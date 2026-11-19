// The UAT driver: `run.mjs auto` conducts an unattended run of one UAT batch,
// playing the person of an assisted run. For each case it runs run.mjs's own
// commands (next, check, record, skip, reset, report) and reader.mjs's, so both
// flows keep the same state, refusals and files:
//
//   next → shell lines → case session in `claude -p` → follow-up turns →
//   check → grading → record → cleanup lines, until next is done, then report.
//
// A case session runs in the working copy with the kit loaded from this
// checkout, and its permission prompts go to the permission host
// (permission-host.mjs). Every turn after the first, and every case that
// `continues` an earlier one, resumes the session by id with the same flags.
// A turn that ends in prose gets one judgement call by ANSWERING.md, unless no
// `turns` or `answers` entry is left, and each step one by GRADING.md.
//
// A case writes to GitHub only on the scratch repo, the source clone's GitHub
// remote: the permission host filters the session's gh and git commands, and
// the session's only credential is the token in UAT_GH_TOKEN, which reaches
// that repo alone. A batch whose cases need GitHub does not start without it.
//
// The driver never runs with ANTHROPIC_API_KEY set, so a run is never billed
// to the API. It stays inside the plan's quota by the rate-limit readings in
// the case sessions' own streams, before each case and each turn: the
// five-hour window over --max-five-hour waits until it resets, and the weekly
// window over --max-weekly stops the run, as does a turn the rate limit
// refuses. Both thresholds are required, from the flags or UAT_MAX_FIVE_HOUR
// and UAT_MAX_WEEKLY, since no default is committed. A run it stops can be
// resumed with `auto --run <dir>`: a step left without a result is reset and
// run again from its restore point.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { githubRepo } from './github-repo.mjs';
import { Refused } from './refused.mjs';
import { callsOf } from './shell-commands.mjs';

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

// The driver's own variable for the fine-grained token limited to the scratch
// repo (CASE-FORMAT.md says what it needs).
const TOKEN_VARIABLE = 'UAT_GH_TOKEN';

// The git config that keeps the maintainer's stored credentials out: an empty
// credential.helper resets the helpers every config file names, and the one
// helper left gives github.com the session's GH_TOKEN. SSH URLs to github.com
// go over HTTPS, so that no SSH key of the maintainer's is used either.
const GIT_CREDENTIALS = [
  ['credential.helper', ''],
  ['credential.https://github.com.helper', '!f() { test "$1" = get && test -n "$GH_TOKEN" && echo username=x-access-token && echo "password=$GH_TOKEN"; }; f'],
  ['url.https://github.com/.insteadOf', 'git@github.com:'],
  ['url.https://github.com/.insteadOf', 'ssh://git@github.com/'],
  ['core.askPass', ''],
];

// The environment a step's shell lines and case session start from: GH_TOKEN
// from the driver's variable, and none of the maintainer's own GitHub
// credentials, no other token, no gh login and no git credential helper.
function githubEnv(stepDir) {
  const env = { ...process.env };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', TOKEN_VARIABLE, 'GIT_ASKPASS', 'SSH_ASKPASS']) delete env[key];
  if (process.env[TOKEN_VARIABLE]) env.GH_TOKEN = process.env[TOKEN_VARIABLE];
  env.GH_CONFIG_DIR = join(stepDir, 'gh-config');
  env.GIT_TERMINAL_PROMPT = '0';
  env.GCM_INTERACTIVE = 'never';
  const first = Number(env.GIT_CONFIG_COUNT) || 0;
  GIT_CREDENTIALS.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${first + index}`] = key;
    env[`GIT_CONFIG_VALUE_${first + index}`] = value;
  });
  env.GIT_CONFIG_COUNT = String(first + GIT_CREDENTIALS.length);
  return env;
}

// A case's `shell` or `cleanup` lines, run in one PowerShell session in the
// working copy, as the person runs them in a terminal: the cases write them for
// PowerShell. `where` says where they run: the working copy, the step folder
// that keeps their script, and the environment they start from. Returns the
// environment the lines leave. A line that fails stops the run, naming the
// case. The token stays out of the file that carries that environment back,
// since the step folder is readable by the grading call.
function runLines(id, field, lines, where) {
  const { workdir, stepDir, env } = where;
  const envFile = join(stepDir, `${field}-env.json`);
  const quote = (text) => `'${text.replaceAll("'", "''")}'`;
  const body = [
    "$ErrorActionPreference = 'Stop'",
    ...lines.flatMap((line) => ['$global:LASTEXITCODE = 0', line, 'if ($LASTEXITCODE) { exit $LASTEXITCODE }']),
    '$uatLeft = [Environment]::GetEnvironmentVariables()',
    "$uatLeft.Remove('GH_TOKEN')",
    `[IO.File]::WriteAllText(${quote(envFile)}, ($uatLeft | ConvertTo-Json -Compress))`,
  ];
  const file = join(stepDir, `${field}.ps1`);
  const bom = String.fromCharCode(0xfeff); // so Windows PowerShell reads the file as UTF-8
  writeFileSync(file, `${bom}${body.join('\n')}\n`);
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { cwd: workdir, env, encoding: 'utf8' });
  if (result.error || result.status !== 0 || !existsSync(envFile)) {
    const why = result.error ? result.error.message : `exit ${result.status}: ${tail(`${result.stdout}${result.stderr}`)}`;
    throw new Refused(`${id}: its ${field} lines failed in ${workdir}: ${why}`);
  }
  const left = readJson(envFile);
  if (env.GH_TOKEN) left.GH_TOKEN = env.GH_TOKEN;
  return left;
}

// The case's shell lines, run before the session starts. What they leave in
// the environment, such as a changed PATH, is the environment the case session
// runs in.
function runShell(uatCase, where) {
  const lines = uatCase.shell ?? [];
  return lines.length === 0 ? where.env : runLines(uatCase.id, 'shell', lines, where);
}

// The step's start time for {{STARTED}}, in UTC to the second, a form gh's
// search and its createdAt fields both compare with: rounded down, so that it
// never comes after anything the step created.
const startedStamp = (startedAt) => new Date(startedAt).toISOString().replace(/\.\d{3}Z$/, 'Z');

// The case's cleanup lines, so that it leaves the scratch repo as later runs
// expect: run once the step is graded and recorded, whatever its verdict, and
// before a step cut short starts again, for what that attempt created. A
// cleanup that fails stops the run, since the next case would start from a
// host left dirty. `next` says how the run goes on once it is undone by hand.
function runCleanup(uatCase, startedAt, where, next) {
  const lines = (uatCase.cleanup ?? []).map((line) => line.replaceAll('{{STARTED}}', startedStamp(startedAt)));
  if (lines.length === 0) return;
  try {
    runLines(uatCase.id, 'cleanup', lines, where);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    throw new Refused(`${error.message}. Undo by hand what the step left, then run auto again: ${next}`);
  }
}

// Pacing on the plan's quota. A case session's stream carries
// `rate_limit_event`s, whose `rate_limit_info.unifiedWindows` hold the
// five-hour and the weekly window, each with its `utilization`, a fraction of
// the window, and `resetsAt`, in epoch seconds. The driver keeps the latest
// reading of the run, window by window, and paces on it before each case and
// each turn. Each case's readings, before and after, stay in its step folder,
// in quota.json beside the session streams they came from: no utilization
// figure reaches the summary, the review, the ledger, a judgement call or what
// auto prints.
const WINDOW_LENGTH_MS = { five_hour: 5 * 3600_000, seven_day: 7 * 24 * 3600_000 };
const QUOTA_FILE = 'quota.json';
// The text of a turn the plan's limit refused, when no rejected reading says so.
const RATE_LIMITED = /rate.?limit|usage limit|hit your limit/i;

// The reading `previous` becomes with a turn's stream events, and whether the
// turn was refused for the plan's rate limit. A window that gives no reset
// time is taken to reset one window's length after it was read, the latest it
// can, so that a run is never stopped for good.
function readQuota(events, previous) {
  let reading = previous;
  let rejected = false;
  for (const event of events.filter((e) => e.type === 'rate_limit_event')) {
    const info = event.rate_limit_info ?? {};
    if (info.status === 'rejected') rejected = true;
    if (info.unifiedWindows === null || typeof info.unifiedWindows !== 'object') continue;
    const now = Date.now();
    const next = { ...reading, at: new Date(now).toISOString() };
    for (const [name, length] of Object.entries(WINDOW_LENGTH_MS)) {
      const { utilization, resetsAt } = info.unifiedWindows[name] ?? {};
      if (typeof utilization !== 'number') continue;
      const resets = typeof resetsAt === 'number' ? resetsAt * 1000 : now + length;
      next[name] = { utilization, resetsAt: new Date(resets).toISOString() };
    }
    reading = next;
  }
  return { reading, rejected };
}

// The latest reading the run folder holds, so that a resumed run paces on what
// the run it resumes last read.
function latestReading(runDir) {
  const steps = join(runDir, 'steps');
  if (!existsSync(steps)) return null;
  const readings = readdirSync(steps)
    .map((id) => join(steps, id, QUOTA_FILE))
    .filter((file) => existsSync(file))
    .flatMap((file) => {
      const { before, after } = readJson(file);
      return [before, after].filter(Boolean);
    });
  return readings.reduce((latest, reading) => (latest === null || reading.at > latest.at ? reading : latest), null);
}

// Whether a window of the reading is over its threshold. A window whose reset
// time has passed has reset, and so is not.
function overThreshold(quota, name) {
  const window = quota.reading?.[name];
  if (!window || Date.parse(window.resetsAt) <= Date.now()) return false;
  return window.utilization * 100 > quota.thresholds[name];
}

// The cell Atomics.wait blocks on, so that the driver sleeps without spinning.
const sleepCell = new Int32Array(new SharedArrayBuffer(4));
function sleepUntil(time) {
  for (let left = time - Date.now(); left > 0; left = time - Date.now()) Atomics.wait(sleepCell, 0, 0, Math.min(left, 60_000));
}

// Paces the run before `what` (the next case or turn): the weekly window over
// its threshold stops the run, so that it never eats the quota needed for
// daily work, and the five-hour window over its own waits until it resets.
// The messages name the reset time but no utilization figure.
const RESET_MARGIN_MS = 1_000;
function paceOnQuota(run, what) {
  const { quota, runDir } = run;
  for (;;) {
    if (overThreshold(quota, 'seven_day')) {
      throw new Refused(
        `the weekly window is over the threshold --max-weekly sets, so the run stops before ${what}, to keep the quota for daily work. Run auto --run ${runDir} again once it resets at ${quota.reading.seven_day.resetsAt}, or with a higher --max-weekly: a step left without a result starts again from its restore point`,
      );
    }
    if (!overThreshold(quota, 'five_hour')) return;
    const resets = quota.reading.five_hour.resetsAt;
    process.stderr.write(`auto: the five-hour window is over the threshold --max-five-hour sets: waiting until ${resets} before ${what}\n`);
    sleepUntil(Date.parse(resets) + RESET_MARGIN_MS);
  }
}

// Saves the case's readings in its step folder: the run's latest when the
// case started, and the latest since.
function saveQuota({ stepDir, quotaBefore, run }) {
  writeJson(join(stepDir, QUOTA_FILE), { before: quotaBefore, after: run.quota.reading });
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
  const { quota } = step.run;
  const { reading, rejected } = readQuota(events, quota.reading);
  quota.reading = reading;
  saveQuota(step);
  const id = events.find((e) => e.type === 'system' && e.subtype === 'init')?.session_id ?? sessionId;
  const end = events.findLast((e) => e.type === 'result');
  if (result.status !== 0 || !end || end.is_error || !id) {
    const why = end?.is_error ? (end.result ?? end.subtype) : `exit ${result.status}: ${tail(result.stderr)}`;
    // A turn the plan's rate limit refused stops the run like any other failure,
    // and on resume the run paces on the reading the refusal carried.
    const limited = rejected || (end?.is_error && RATE_LIMITED.test(why));
    const failed = limited ? "hit the plan's rate limit" : 'failed';
    const resume = limited ? 'it waits for the window to reset if its threshold says so, and restarts the step' : 'it restarts the step';
    throw new Refused(`${step.id}: the case session ${failed} on turn ${number}: ${why}. Run auto again: ${resume} from its restore point`);
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
      `Each permission prompt of the case session and the host's decision, graded by the rules above.\n\n${hostLog ? `\`\`\`\n${hostLog}\n\`\`\`` : 'No permission prompt reached the host.'}`,
    ),
  ].join('\n');
}

// The permission host's denials in the step, as it logged them.
function hostDenials(hostLog) {
  if (!existsSync(hostLog)) return [];
  return readFileSync(hostLog, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.decision === 'deny');
}

// By GRADING.md, a denial the case did not expect is an environment problem:
// a step with a denial is never a Pass, and a Not proven one names it in an
// environment finding. Why the grades are refused, or null.
function denialRefusal(grades, denials) {
  if (denials.length === 0) return null;
  const listed = denials.map((entry) => `${entry.tool}${entry.detail ? ` (${entry.detail})` : ''}: ${entry.reason}`).join('; ');
  const rule = 'a denial the case did not expect makes the step Not proven, with an environment finding that names it';
  if (grades.verdict === 'Pass') return `the permission host denied ${listed}. A step with a denial is never a Pass: ${rule}`;
  if (grades.verdict === 'Not proven' && !(grades.findings ?? []).some((finding) => finding.kind === 'environment')) {
    return `the permission host denied ${listed}, and the grades hold no environment finding: ${rule}`;
  }
  return null;
}

// The session a `continues` case resumes: the one its earlier case picked.
function continuedSession(runDir, uatCase) {
  const earlier = join(runDir, 'steps', uatCase.continues, 'step.json');
  const session = existsSync(earlier) ? readJson(earlier).session : undefined;
  if (!session) throw new Refused(`${uatCase.id}: continues ${uatCase.continues}, whose session is not known`);
  return session;
}

// Whether a case runs gh or reaches GitHub, so that it needs the token: its
// shell lines, cleanup lines or `run` assertions run gh or name github.com, or
// its setup, or that of a case whose session it continues, points origin there.
function needsGitHub(loadCase, uatCase, seen = new Set()) {
  const checks = [...(uatCase.assertions ?? []), ...(uatCase.turns ?? []).flatMap((turn) => turn.assertions ?? [])];
  const lines = [...(uatCase.shell ?? []), ...(uatCase.cleanup ?? []), ...checks.map((check) => check.run).filter(Boolean)];
  const runsGh = (line) => callsOf(line).some(({ program }) => program === 'gh');
  if (lines.some((line) => runsGh(line) || /github\.com/i.test(line))) return true;
  if ((uatCase.setup ?? []).some((op) => op.remote !== undefined && githubRepo(op.remote))) return true;
  seen.add(uatCase.id);
  return Boolean(uatCase.continues) && !seen.has(uatCase.continues) && needsGitHub(loadCase, loadCase(uatCase.continues), seen);
}

const gitOut = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).stdout?.trim() ?? '';

// The scratch repo, as `owner/name`: the GitHub repo the source clone's remote
// names, origin first. Null when it has no GitHub remote.
function scratchRepo(source) {
  const remotes = gitOut(source, 'remote').split('\n').filter(Boolean);
  for (const remote of [...remotes.filter((name) => name === 'origin'), ...remotes.filter((name) => name !== 'origin')]) {
    const repo = githubRepo(gitOut(source, 'remote', 'get-url', remote));
    if (repo) return repo;
  }
  return null;
}

function runStep(run, uatCase, brief) {
  const { runDir, judgeModel, scratch } = run;
  const { stepDir, workdir } = brief;
  const step = {
    id: uatCase.id,
    run,
    quotaBefore: run.quota.reading,
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
  const hostArgs = [hostScript, '--workdir', workdir, '--log', step.hostLog, ...(scratch ? ['--scratch', scratch] : [])];
  writeJson(step.mcpConfig, { mcpServers: { [HOST_SERVER]: { command: process.execPath, args: hostArgs } } });
  saveQuota(step);
  step.env = runShell(uatCase, { workdir, stepDir, env: githubEnv(stepDir) });

  const { continues, startedAt } = readJson(join(stepDir, 'step.json'));
  let { sessionId, text } = sessionTurn(step, brief.paste.command, continues ? continuedSession(runDir, uatCase) : null);
  readerMjs('pick', stepDir, '--session', sessionId);
  let ended;
  for (;;) {
    if (step.turnsSent === (uatCase.turns ?? []).length && step.unusedAnswers().length === 0) {
      ended = 'Every `turns` and `answers` entry had been used when the agent ended its turn, so the step ended there.';
      break;
    }
    // The next turn starts with the call that judges the reply, so the quota is
    // paced before it.
    paceOnQuota(run, `turn ${step.turnsRun + 1} of ${uatCase.id}`);
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
  const denials = hostDenials(step.hostLog);
  judgement(step, 'grade', gradePrompt(step, ended, checks, summary), (grades) => {
    const refusal = denialRefusal(grades, denials);
    if (refusal) return refusal;
    writeJson(gradesFile, grades);
    try {
      runMjs('record', runDir, '--grades', gradesFile);
      return null;
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return error.message;
    }
  });
  runCleanup(uatCase, startedAt, { workdir, stepDir, env: step.env }, 'the result is recorded, so it goes on with the next case');
}

// The quota thresholds, in percent of each window, from the flags or else the
// environment. No default is committed, so a run without both does not start.
const THRESHOLDS = [
  { window: 'five_hour', option: 'max-five-hour', variable: 'UAT_MAX_FIVE_HOUR' },
  { window: 'seven_day', option: 'max-weekly', variable: 'UAT_MAX_WEEKLY' },
];
function thresholdsOf(options) {
  const passed = THRESHOLDS.map((threshold) => ({ ...threshold, given: options[threshold.option] ?? process.env[threshold.variable] ?? '' }));
  const missing = passed.filter(({ given }) => given === '');
  if (missing.length > 0) {
    const ways = missing.map(({ option, variable }) => `--${option} <pct> or ${variable}`).join(', and ');
    throw new Refused(`auto needs a quota threshold for each window, in percent of it, and commits no default: pass ${ways}`);
  }
  const thresholds = {};
  for (const { window, option, variable, given } of passed) {
    const pct = Number(given);
    if (!/^\d+(\.\d+)?$/.test(given.trim()) || !(pct > 0 && pct <= 100)) {
      throw new Refused(`--${option} (or ${variable}) is a percent of the window, above 0 and at most 100, not ${given}`);
    }
    thresholds[window] = pct;
  }
  return thresholds;
}

// Runs the batch of the run folder, a new one when `source` is given, until
// next is done, then writes the report. Returns what auto prints.
export function auto(options) {
  if (process.env.ANTHROPIC_API_KEY) {
    throw new Refused('ANTHROPIC_API_KEY is set: an unattended run spends the plan, never the API. Unset it and run auto again');
  }
  const thresholds = thresholdsOf(options);
  const runDir = resolve(options.run);
  const stateFile = join(runDir, 'state.json');
  if (!existsSync(stateFile)) {
    if (!options.source) throw new Refused(`no run in ${runDir}: give --source <clone> to start one`);
    const chosen = ['cases', 'cases-dir'].filter((name) => options[name]).flatMap((name) => [`--${name}`, options[name]]);
    callScript(runScript, 'init', '--run', runDir, '--source', options.source, ...chosen);
  } else if (options.cases || options['cases-dir']) {
    throw new Refused(`${runDir} already holds a run, whose cases were chosen when it started: drop --cases and --cases-dir to resume it`);
  }
  const begun = readJson(stateFile);
  if (!process.env[TOKEN_VARIABLE]) {
    const loadCase = (caseId) => readJson(join(begun.casesDir, `${caseId}.json`));
    const pending = begun.cases.filter((caseId) => !begun.results[caseId]);
    const needing = pending.filter((caseId) => loadCase(caseId).assisted === undefined && needsGitHub(loadCase, loadCase(caseId)));
    if (needing.length > 0) {
      throw new Refused(`${needing.join(', ')} run gh or reach GitHub, and ${TOKEN_VARIABLE} is not set: set it to the fine-grained token limited to the scratch repo that CASE-FORMAT.md describes, and run auto again`);
    }
  }
  const run = {
    runDir,
    judgeModel: options['judge-model'] ?? DEFAULT_JUDGE_MODEL,
    scratch: scratchRepo(begun.source),
    quota: { thresholds, reading: latestReading(runDir) },
  };

  for (;;) {
    const state = readJson(stateFile);
    const id = state.cases.find((caseId) => !state.results[caseId]);
    if (!id) break;
    const uatCase = readJson(join(state.casesDir, `${id}.json`));
    if (uatCase.assisted !== undefined) {
      runMjs('skip', runDir, '--reason', `An assisted case, which only runs with a person: ${uatCase.assisted}`);
      continue;
    }
    paceOnQuota(run, `case ${id}`);
    const brief = runMjs('next', runDir);
    if (brief.status === 'blocked') {
      runMjs('skip', runDir, '--reason', `Blocked: it starts from ${brief.needs}, which did not pass and so left no restore point.`);
    } else if (brief.resumed) {
      // A step cut short cannot be resumed half-way: it starts again from its
      // restore point, once its cleanup has closed what that attempt created.
      const where = { workdir: brief.workdir, stepDir: brief.stepDir, env: githubEnv(brief.stepDir) };
      runCleanup(uatCase, brief.startedAt, where, 'it starts the step again from its restore point');
      runMjs('reset', runDir, '--case', id);
    } else {
      runStep(run, uatCase, brief);
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
