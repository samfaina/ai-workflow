// Keeps the state of a UAT run: restores each UAT case's restore point into a
// working copy, grades what can be graded by a script, saves the results and
// writes the summary. The conductor (SKILL.md) does the rest.
//
//   node run.mjs init   --run <dir> --source <repo> [--cases a,b] [--cases-dir <dir>]
//   node run.mjs next   --run <dir>
//   node run.mjs check  --run <dir> [--turn <n>]
//   node run.mjs record --run <dir> --grades <file> [--keep-point yes]
//   node run.mjs skip   --run <dir> --reason <text>
//   node run.mjs drift  --run <dir> --when <question> --intent <answer> --reason <why>
//   node run.mjs report --run <dir>
//   node run.mjs clean  --run <dir>
//
// Everything lives in the run folder, outside this repo. The source repo is
// only ever read: its commits are fetched once, into the run's own store.
//
// Exit codes: 0 done, 1 refused or failed (with a JSON message), 2 usage.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logFolder } from './log-folder.mjs';

const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const kitRoot = join(skillDir, '..', '..', '..').replaceAll('\\', '/');
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;

const IDENTITY = { GIT_AUTHOR_NAME: 'uat', GIT_AUTHOR_EMAIL: 'uat@local', GIT_COMMITTER_NAME: 'uat', GIT_COMMITTER_EMAIL: 'uat@local' };

class Refused extends Error {}

const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function usage(message) {
  process.stderr.write(`${message}\n`);
  process.exit(EXIT_USAGE);
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || args[i + 1] === undefined) usage(`bad argument: ${args[i]}`);
    options[args[i].slice(2)] = args[i + 1];
  }
  return options;
}

function git(dir, args, env = {}) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Refused(`git ${args.join(' ')} failed in ${dir}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function tryGit(dir, args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

const paths = (runDir) => ({
  state: join(runDir, 'state.json'),
  store: join(runDir, 'points.git'),
  steps: join(runDir, 'steps'),
  step: (id) => join(runDir, 'steps', id),
  points: join(runDir, 'points'),
  aw: (id) => join(runDir, 'points', id, 'aw'),
  result: (id) => join(runDir, 'results', `${id}.json`),
  summary: join(runDir, 'summary.md'),
});

function loadState(runDir) {
  const { state } = paths(runDir);
  if (!existsSync(state)) throw new Refused(`no run in ${runDir}: run init first`);
  return readJson(state);
}

function init(options) {
  if (!options.source) usage('init needs --source <repo>, or the UAT_SOURCE environment variable');
  const runDir = resolve(options.run);
  const source = realpathSync(options.source);
  const casesDir = resolve(options['cases-dir'] ?? join(skillDir, 'cases'));
  const { state, store } = paths(runDir);
  if (existsSync(state)) throw new Refused(`${runDir} already holds a run`);
  const cases = options.cases ? options.cases.split(',') : allCaseIds(casesDir);
  mkdirSync(store, { recursive: true });
  git(store, ['init', '-q', '--bare', '-b', 'main']);
  git(store, ['fetch', '-q', source, '+refs/heads/*:refs/source/heads/*', '+refs/tags/*:refs/source/tags/*']);
  writeJson(state, { source, casesDir, cases, results: {}, points: {}, drift: {}, createdAt: new Date().toISOString() });
  print({ status: 'created', run: runDir, cases: cases.length });
}

function allCaseIds(casesDir) {
  return readdirSync(casesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(join(casesDir, name)))
    .sort((a, b) => a.order - b.order)
    .map((uatCase) => uatCase.id);
}

function resolveInStore(store, ref) {
  for (const candidate of [`refs/source/heads/${ref}`, `refs/source/tags/${ref}`, ref]) {
    const commit = tryGit(store, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
    if (commit) return { commit, isBranch: candidate.startsWith('refs/source/heads/') };
  }
  throw new Refused(`no ref or commit named ${ref} in the source repo`);
}

function pointFromRef(store, from) {
  const { commit, isBranch } = resolveInStore(store, from.ref);
  const branch = from.branch ?? (isBranch ? from.ref : 'main');
  if (branch === 'main') return { commit, branch, main: commit };
  const main = from.base
    ? resolveInStore(store, from.base).commit
    : git(store, ['merge-base', commit, 'refs/source/heads/main']);
  return { commit, branch, main };
}

// A clone of the restore point whose origin holds nothing but main at the
// point's base. Remote refs inherited from the source would contaminate the
// case: agents read them and ask about them.
function restore(store, point, stepDir, awCopy) {
  const origin = join(stepDir, 'origin.git');
  const workdir = join(stepDir, 'repo');
  mkdirSync(origin, { recursive: true });
  git(origin, ['init', '-q', '--bare', '-b', 'main']);
  git(store, ['push', '-q', origin, `${point.main}:refs/heads/main`]);
  git(stepDir, ['clone', '-q', origin, workdir]);
  if (point.branch !== 'main') {
    git(store, ['push', '-q', workdir, `${point.commit}:refs/heads/${point.branch}`]);
    git(workdir, ['switch', '-q', point.branch]);
  }
  if (point.snapshot && point.snapshot !== point.commit) {
    git(store, ['push', '-q', workdir, `${point.snapshot}:refs/uat/snapshot`]);
    git(workdir, ['restore', '--source=refs/uat/snapshot', '--worktree', '--', ':/']);
    git(workdir, ['update-ref', '-d', 'refs/uat/snapshot']);
  }
  if (awCopy && existsSync(awCopy)) cpSync(awCopy, join(workdir, '.aw'), { recursive: true });
  return workdir;
}

// Saves the working copy as a restore point without touching it: a continued
// session must find its HEAD, index and uncommitted files as it left them. The
// uncommitted files go in a snapshot commit that no branch points to, and come
// back uncommitted, since whether a skill committed its work is part of a case.
function savePoint(runDir, state, id, workdir) {
  const { store, step, aw } = paths(runDir);
  const index = join(step(id), 'point.index');
  const withIndex = { GIT_INDEX_FILE: index };
  git(workdir, ['read-tree', 'HEAD'], withIndex);
  git(workdir, ['add', '-A'], withIndex);
  const tree = git(workdir, ['write-tree'], withIndex);
  rmSync(index, { force: true });
  const head = git(workdir, ['rev-parse', 'HEAD']);
  const unchanged = tree === git(workdir, ['rev-parse', 'HEAD^{tree}']);
  const snapshot = unchanged ? head : git(workdir, ['commit-tree', tree, '-p', head, '-m', `uat: ${id}`], IDENTITY);
  const branch = tryGit(workdir, ['symbolic-ref', '--short', '-q', 'HEAD']) ?? 'main';
  const main = branch === 'main' ? head : (tryGit(workdir, ['rev-parse', '--verify', '-q', 'refs/heads/main']) ?? head);
  git(workdir, ['push', '-q', store, `${snapshot}:refs/tags/point/${id}`]);
  if (main !== snapshot) git(workdir, ['push', '-q', store, `${main}:refs/tags/point-base/${id}`]);
  const awDir = join(workdir, '.aw');
  if (existsSync(awDir)) cpSync(awDir, aw(id), { recursive: true });
  state.points[id] = { commit: head, snapshot, branch, main };
}

function expand(text, workdir) {
  return text
    .replaceAll('{{SHORT}}', git(workdir, ['rev-parse', '--short', 'HEAD']))
    .replaceAll('{{BRANCH}}', git(workdir, ['branch', '--show-current']));
}

function writeInto(workdir, relative, text) {
  const target = join(workdir, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

function applySetup(workdir, setup = []) {
  for (const op of setup) {
    if (op.write !== undefined) {
      writeInto(workdir, op.write, expand(op.text, workdir));
    } else if (op.copy !== undefined) {
      writeInto(workdir, op.to, expand(readFileSync(join(skillDir, op.copy), 'utf8'), workdir));
    } else if (op.replace !== undefined) {
      const file = join(workdir, op.replace);
      const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
      const pattern = new RegExp(op.pattern, 'gm');
      if (!pattern.test(before)) throw new Refused(`setup: "${op.pattern}" not found in ${op.replace}`);
      writeFileSync(file, before.replace(new RegExp(op.pattern, 'gm'), op.with));
    } else if (op.delete !== undefined) {
      const target = join(workdir, op.delete);
      if (!existsSync(target)) throw new Refused(`setup: ${op.delete} not found`);
      rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } else if (op.commit !== undefined) {
      git(workdir, ['add', '-A']);
      git(workdir, ['commit', '-q', '-m', op.commit], IDENTITY);
    } else if (op.remote !== undefined) {
      git(workdir, ['remote', 'set-url', 'origin', op.remote]);
    } else {
      throw new Refused(`setup: unknown operation ${JSON.stringify(op)}`);
    }
  }
}

function loadCase(state, id) {
  return readJson(join(state.casesDir, `${id}.json`));
}

const nextId = (state) => state.cases.find((id) => !state.results[id]);

function briefing(runDir, uatCase, step, stepDir, resumed) {
  const shell = [`cd "${step.workdir}"`, ...(uatCase.shell ?? []), step.continues ? 'claude --continue' : 'claude'];
  return {
    status: 'ready',
    case: uatCase.id,
    title: uatCase.title,
    stepDir,
    workdir: step.workdir,
    startedAt: step.startedAt,
    resumed,
    paste: { shell, command: uatCase.command.replaceAll('{{RUN}}', runDir) },
    answers: uatCase.answers ?? [],
    turns: uatCase.turns ?? [],
  };
}

function startWorkdir(runDir, state, uatCase, stepDir) {
  const { store, step: stepOf, aw } = paths(runDir);
  if (uatCase.continues) {
    const earlier = join(stepOf(uatCase.continues), 'step.json');
    if (!existsSync(earlier)) return { blocked: uatCase.continues };
    return { workdir: readJson(earlier).workdir, continues: true };
  }
  const { from } = uatCase;
  if (from.case && !state.points[from.case]) return { blocked: from.case };
  const point = from.case ? state.points[from.case] : pointFromRef(store, from);
  mkdirSync(stepDir, { recursive: true });
  try {
    const workdir = realpathSync(restore(store, point, stepDir, from.case ? aw(from.case) : null));
    applySetup(workdir, uatCase.setup);
    return { workdir, continues: false };
  } catch (error) {
    rmSync(stepDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // so next can retry
    throw error;
  }
}

function next(options) {
  const runDir = resolve(options.run);
  const state = loadState(runDir);
  const id = nextId(state);
  if (!id) return print({ status: 'done' });
  const uatCase = loadCase(state, id);
  const stepDir = paths(runDir).step(id);
  const stepFile = join(stepDir, 'step.json');
  if (existsSync(stepFile)) return print(briefing(runDir, uatCase, readJson(stepFile), stepDir, true));

  const { workdir, continues, blocked } = startWorkdir(runDir, state, uatCase, stepDir);
  if (blocked) return print({ status: 'blocked', case: id, title: uatCase.title, needs: blocked });
  mkdirSync(stepDir, { recursive: true });
  const step = { case: id, workdir, startedAt: new Date().toISOString(), continues };
  writeJson(stepFile, step);
  print(briefing(runDir, uatCase, step, stepDir, false));
}

function frontmatterOf(text) {
  const block = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  return Object.fromEntries(block.split('\n').map((line) => line.split(/:\s*/, 2)).filter(([, value]) => value !== undefined));
}

// A * in the last path segment means the last file in name order, the rule
// the kit uses for its dated reports. The result may not exist.
function locate(workdir, relative) {
  if (!relative.includes('*')) return join(workdir, relative);
  const folder = join(workdir, dirname(relative));
  const pattern = new RegExp(`^${relative.split('/').pop().split('*').map(escapeRegExp).join('.*')}$`);
  const matches = existsSync(folder) ? readdirSync(folder).filter((name) => pattern.test(name)).sort() : [];
  return join(folder, matches.at(-1) ?? relative.split('/').pop());
}

const escapeRegExp = (text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

function checkFile(workdir, assertion) {
  const file = locate(workdir, assertion.file);
  if (assertion.exists === false) return existsSync(file) ? 'the file exists' : null;
  if (!existsSync(file)) return 'the file does not exist';
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (assertion.matches) {
    const found = text.match(new RegExp(assertion.matches, 'gm'))?.length ?? 0;
    if (assertion.count === undefined ? found === 0 : found !== assertion.count) {
      return `found ${found} matches of /${assertion.matches}/${assertion.count === undefined ? '' : `, expected ${assertion.count}`}`;
    }
  }
  for (const [key, expected] of Object.entries(assertion.frontmatter ?? {})) {
    const actual = frontmatterOf(text)[key];
    if (actual !== expected) return `${key} is ${actual}, expected ${expected}`;
  }
  return null;
}

function checkCommand(workdir, assertion) {
  const result = spawnSync(assertion.run.replaceAll('{{KIT}}', kitRoot), { cwd: workdir, shell: true, encoding: 'utf8' });
  const output = `${result.stdout}${result.stderr}`.trim().slice(-400);
  if (result.status !== (assertion.exit ?? 0)) return `exit ${result.status}: ${output}`;
  if (assertion.stdout && !new RegExp(assertion.stdout, 'm').test(result.stdout.trim())) return `no match for /${assertion.stdout}/ in: ${output}`;
  return null;
}

function runAssertions(workdir, assertions) {
  return assertions.filter((a) => !a.judge).map((a) => {
    const detail = a.run ? checkCommand(workdir, a) : checkFile(workdir, a);
    return { name: a.name ?? a.run ?? a.file, ok: detail === null, ...(detail === null ? {} : { detail }) };
  });
}

// The step under way, or a refusal when none has been started.
function currentStep(runDir, state) {
  const id = nextId(state);
  const stepDir = id ? paths(runDir).step(id) : null;
  if (!stepDir || !existsSync(join(stepDir, 'step.json'))) throw new Refused('no step under way: run next first');
  return { id, stepDir, step: readJson(join(stepDir, 'step.json')), uatCase: loadCase(state, id) };
}

const loadChecks = (stepDir) => {
  const file = join(stepDir, 'checks.json');
  return existsSync(file) ? readJson(file) : { turns: {} };
};

function check(options) {
  const runDir = resolve(options.run);
  const { id, stepDir, step, uatCase } = currentStep(runDir, loadState(runDir));
  const turn = options.turn;
  const assertions = turn ? (uatCase.turns?.[Number(turn) - 1]?.assertions ?? []) : (uatCase.assertions ?? []);
  const results = runAssertions(step.workdir, assertions);
  const checks = loadChecks(stepDir);
  if (turn) checks.turns[turn] = results;
  else checks.final = results;
  writeJson(join(stepDir, 'checks.json'), checks);
  print({
    case: id,
    ...(turn ? { turn: Number(turn) } : {}),
    results,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    judge: assertions.filter((a) => a.judge).map((a) => a.judge),
  });
}

const VERDICTS = ['Pass', 'Fail', 'Not proven'];

function validateGrades(grades, uatCase, assertionResults, checks) {
  if (!VERDICTS.includes(grades.verdict)) throw new Refused(`verdict must be one of ${VERDICTS.join(', ')}`);
  if (!grades.line) throw new Refused('grades need a line: what was checked, in one sentence');
  const judged = new Map((grades.judge ?? []).map((g) => [g.criterion, g]));
  for (const { judge } of (uatCase.assertions ?? []).filter((a) => a.judge)) {
    const grade = judged.get(judge);
    if (!grade) throw new Refused(`judge criterion not graded: ${judge}`);
    if (!grade.evidence) throw new Refused(`no evidence for criterion: ${judge}`);
  }
  if (grades.verdict !== 'Pass') return;
  (uatCase.turns ?? []).forEach((turn, index) => {
    if (turn.assertions && !checks.turns[index + 1]) throw new Refused(`cannot be Pass: turn ${index + 1} was never checked`);
  });
  const failed = assertionResults.filter((r) => !r.ok).map((r) => r.name);
  if (failed.length > 0) throw new Refused(`cannot be Pass: failed assertions: ${failed.join(', ')}`);
  const unproven = (grades.judge ?? []).filter((g) => g.result !== 'pass').map((g) => g.criterion);
  if (unproven.length > 0) throw new Refused(`cannot be Pass: criteria not passed: ${unproven.join('; ')}`);
}

function record(options) {
  const runDir = resolve(options.run);
  const state = loadState(runDir);
  const { id, stepDir, step, uatCase } = currentStep(runDir, state);
  const grades = readJson(options.grades);
  const checks = loadChecks(stepDir);
  if (!checks.final) throw new Refused('run check before record');
  const assertionResults = [...Object.values(checks.turns).flat(), ...checks.final];
  validateGrades(grades, uatCase, assertionResults, checks);

  const keepsPoint = grades.verdict === 'Pass' || options['keep-point'] === 'yes';
  if (keepsPoint) savePoint(runDir, state, id, step.workdir);
  const findings = { skill: [], environment: [] };
  for (const finding of grades.findings ?? []) (finding.kind === 'environment' ? findings.environment : findings.skill).push(finding.text);
  const result = { case: id, verdict: grades.verdict, line: grades.line, assertions: assertionResults, judge: grades.judge ?? [], findings, point: keepsPoint };
  mkdirSync(join(runDir, 'results'), { recursive: true });
  writeJson(paths(runDir).result(id), result);
  state.results[id] = { verdict: grades.verdict, line: grades.line };
  writeJson(paths(runDir).state, state);
  print({ status: 'recorded', case: id, verdict: grades.verdict, point: keepsPoint });
}

function skip(options) {
  if (!options.reason) usage('skip needs --reason <text>');
  const runDir = resolve(options.run);
  const state = loadState(runDir);
  const id = nextId(state);
  if (!id) throw new Refused('nothing left to skip');
  state.results[id] = { verdict: 'Not run', line: options.reason };
  writeJson(paths(runDir).state, state);
  print({ status: 'skipped', case: id });
}

function drift(options) {
  for (const required of ['when', 'intent', 'reason']) if (!options[required]) usage(`drift needs --${required}`);
  const runDir = resolve(options.run);
  const state = loadState(runDir);
  const { id, uatCase } = currentStep(runDir, state);
  uatCase.answers ??= [];
  if (!uatCase.answers.some((a) => a.when === options.when)) {
    uatCase.answers.push({ when: options.when, intent: options.intent, reason: options.reason, drift: true });
    writeJson(join(state.casesDir, `${id}.json`), uatCase);
    state.drift[id] = (state.drift[id] ?? 0) + 1;
    writeJson(paths(runDir).state, state);
  }
  print({ status: 'drift-recorded', case: id });
}

function reportLine(state, uatCase) {
  const result = state.results[uatCase.id];
  if (!result) return `- Not run: ${uatCase.title}`;
  const count = state.drift[uatCase.id] ?? 0;
  const added = count === 0 ? '' : ` (${count} question${count === 1 ? '' : 's'} not in the case, added)`;
  const text = `${result.line}${added}`;
  if (result.verdict === 'Pass' || result.verdict === 'Not run') return `- ${result.verdict}: ${uatCase.title}: ${text}`;
  return `- **${result.verdict}: ${uatCase.title}**: ${text}`;
}

function report(options) {
  const runDir = resolve(options.run);
  const state = loadState(runDir);
  const groups = new Map();
  for (const id of state.cases) {
    const uatCase = loadCase(state, id);
    if (!groups.has(uatCase.group)) groups.set(uatCase.group, []);
    groups.get(uatCase.group).push(reportLine(state, uatCase));
  }
  const text = `${[...groups].map(([group, lines]) => `**${group}**\n\n${lines.join('\n')}\n`).join('\n')}`;
  writeFileSync(paths(runDir).summary, text);
  process.stdout.write(text);
}

// Deletes what a finished run no longer needs and keeps its record. Each log
// folder's name is built from a working copy under this run folder, so no other
// project's logs can match. It can run again after a failure.
function clean(options) {
  const runDir = resolve(options.run);
  const state = loadState(runDir);
  const pending = state.cases.filter((id) => !state.results[id]);
  if (pending.length > 0) throw new Refused(`cases without a result: ${pending.join(', ')}`);
  const { steps, store, points } = paths(runDir);
  const logs = state.cases.map((id) => logFolder(join(realpathSync(runDir), 'steps', id, 'repo')));
  const failed = [];
  for (const target of [...logs, steps, store, points]) {
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      failed.push(`${target} (${error.code})`);
    }
  }
  if (failed.length > 0) throw new Refused(`could not delete: ${failed.join(', ')}`);
  print({ status: 'cleaned', run: runDir });
}

const COMMANDS = { init, next, check, record, skip, drift, report, clean };
const [command, ...rest] = process.argv.slice(2);
if (!Object.hasOwn(COMMANDS, command ?? '')) usage(`usage: run.mjs ${Object.keys(COMMANDS).join('|')} --run <dir> [options]`);
try {
  const options = parseArgs(rest);
  if (!options.run) usage('--run <dir> is required');
  options.source ??= process.env.UAT_SOURCE;
  COMMANDS[command](options);
} catch (error) {
  if (!(error instanceof Refused)) throw error;
  print({ status: 'refused', message: error.message });
  process.exit(EXIT_REFUSED);
}
