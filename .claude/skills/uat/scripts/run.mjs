// Keeps the state of a UAT run: restores each UAT case's restore point into a
// working copy, grades what can be graded by a script, saves the results and
// writes the summary and the review. The conductor (SKILL.md), or in an
// unattended run the driver (driver.mjs), does the rest.
//
//   node run.mjs init   --run <dir> --source <repo> [--cases a,b] [--cases-dir <dir>]
//   node run.mjs next   --run <dir>
//   node run.mjs check  --run <dir> [--turn <n>]
//   node run.mjs record --run <dir> --grades <file> [--keep-point yes]
//   node run.mjs skip   --run <dir> --reason <text>
//   node run.mjs reset  --run <dir> --case <id>
//   node run.mjs drift  --run <dir> --when <question> --intent <answer> --reason <why>
//   node run.mjs report --run <dir> [--issue <n>]
//   node run.mjs clean  --run <dir>
//   node run.mjs due    [--cases-dir <dir>] [--release]
//   node run.mjs auto   --run <dir> [--source <repo>] [--cases a,b] [--cases-dir <dir>] [--judge-model <m>] [--max-five-hour <pct>] [--max-weekly <pct>]
//
// Each command takes only the options on its line, and any other option is a
// usage error that names it. These lines copy the usage lines of COMMANDS,
// which parseArgs reads, and a test holds the two the same.
//
// --source defaults to UAT_SOURCE. For init and auto only, --run defaults to
// <UAT_TARGET>/<yyyymmdd>; every other command needs the run folder by name,
// except due, which reads only the case files and the UAT ledger, and with
// --release the release tags of the repo that holds them.
//
// auto is the UAT driver (driver.mjs): it runs one UAT batch unattended,
// through the other commands, and resumes the run folder's state, or starts a
// run there from --source. See driver.mjs.
//
// Everything lives in the run folder, outside this repo, except what a run
// changes in the case files (drift) and the UAT ledger, `ledger.json` beside
// the cases folder, which report updates. The source repo is only ever read:
// its commits are fetched once, into the run's own store.
//
// Exit codes: 0 done, 1 refused or failed (with a JSON message), 2 usage,
// 3 due --release listed a case (with its usual output).

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auto } from './driver.mjs';
import { fingerprint, fixtureFile, skillFolderOf } from './fingerprint.mjs';
import { logFolder } from './log-folder.mjs';
import { Refused } from './refused.mjs';

const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const kitRoot = join(skillDir, '..', '..', '..').replaceAll('\\', '/');
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;
const EXIT_DUE = 3;

const IDENTITY = { GIT_AUTHOR_NAME: 'uat', GIT_AUTHOR_EMAIL: 'uat@local', GIT_COMMITTER_NAME: 'uat', GIT_COMMITTER_EMAIL: 'uat@local' };

const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function usage(message) {
  process.stderr.write(`${message}\n`);
  process.exit(EXIT_USAGE);
}

// Options that take no value.
const FLAGS = new Set(['release']);

// The command's options, from the command line. An option the command does not
// take is a usage error, so a typo is never dropped without a word.
function parseArgs(command, args) {
  const takes = optionsOf(command);
  const options = {};
  let i = 0;
  while (i < args.length) {
    const name = args[i].startsWith('--') ? args[i].slice(2) : null;
    if (name !== null && !takes.includes(name)) usage(`${command} takes no option --${name}: ${usageLine(command)}`);
    if (FLAGS.has(name)) {
      options[name] = true;
      i += 1;
    } else {
      if (name === null || args[i + 1] === undefined) usage(`bad argument: ${args[i]}`);
      options[name] = args[i + 1];
      i += 2;
    }
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
  review: join(runDir, 'review.md'),
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
  const known = allCaseIds(casesDir);
  const cases = options.cases ? options.cases.split(',') : known;
  // A mistyped id would otherwise surface only when next reaches it, as a crash.
  const unknown = cases.filter((id) => !known.includes(id));
  if (unknown.length > 0) throw new Refused(`no case ${unknown.join(', ')} in ${casesDir}`);
  const kitCommit = git(kitRoot, ['rev-parse', 'HEAD']);
  mkdirSync(store, { recursive: true });
  git(store, ['init', '-q', '--bare', '-b', 'main']);
  git(store, ['fetch', '-q', source, '+refs/heads/*:refs/source/heads/*', '+refs/tags/*:refs/source/tags/*']);
  writeJson(state, { source, casesDir, cases, kitCommit, results: {}, points: {}, drift: {}, createdAt: new Date().toISOString() });
  const dirty = git(kitRoot, ['status', '--porcelain']) !== '';
  const warning = dirty
    ? `the kit checkout has uncommitted changes: the ledger will say this run tested commit ${kitCommit}, which does not hold them`
    : undefined;
  print({ status: 'created', run: runDir, cases: cases.length, kitCommit, ...(warning ? { warning } : {}) });
}

// Every case file in the folder, in the order they declare.
function allCases(casesDir) {
  return readdirSync(casesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(join(casesDir, name)))
    .sort((a, b) => a.order - b.order);
}

const allCaseIds = (casesDir) => allCases(casesDir).map((uatCase) => uatCase.id);

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

function applySetup(casesDir, workdir, setup = []) {
  for (const op of setup) {
    if (op.write !== undefined) {
      writeInto(workdir, op.write, expand(op.text, workdir));
    } else if (op.copy !== undefined) {
      writeInto(workdir, op.to, expand(readFileSync(fixtureFile(casesDir, op.copy), 'utf8'), workdir));
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

// The case session loads the kit from this checkout, never from an installed
// copy or a marketplace the source repo's settings name: the run grades the
// code under test, and a path in those settings is only valid on one machine.
function briefing(runDir, uatCase, step, stepDir, resumed) {
  const claude = `claude${step.continues ? ' --continue' : ''} --plugin-dir "${kitRoot}"`;
  const shell = [`cd "${step.workdir}"`, ...(uatCase.shell ?? []), claude];
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
    applySetup(state.casesDir, workdir, uatCase.setup);
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
const SKIPPED = 'Not run'; // the verdict skip records

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
  state.results[id] = { verdict: SKIPPED, line: options.reason };
  writeJson(paths(runDir).state, state);
  print({ status: 'skipped', case: id });
}

// Deletes each target, and returns the ones it could not delete, with why: a
// case session still open holds its working copy on some systems.
function deleteAll(targets) {
  const failed = [];
  for (const target of targets) {
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      failed.push(`${target} (${error.code})`);
    }
  }
  return failed;
}

// Discards a case's step (its working copy, result and session pick) and the
// restore point it left, so next restores it fresh from the restore point it
// starts from. A session cannot be replayed half-way, so a case that continues
// one resets its chain back to the case that restored the working copy. Every
// case that has started in that working copy goes too, since it continued a
// session that no longer exists. Every other case keeps its result and restore
// point.
function reset(options) {
  if (!options.case) usage('reset needs --case <id>');
  const runDir = resolve(options.run);
  const state = loadState(runDir);
  const id = options.case;
  if (!state.cases.includes(id)) throw new Refused(`no case ${id} in this run`);
  const { store, step, aw, result } = paths(runDir);
  const started = (caseId) => state.results[caseId] !== undefined || existsSync(step(caseId));
  if (!started(id)) throw new Refused(`${id} has not started: next restores it fresh as it is`);
  const continuesOf = new Map(state.cases.map((caseId) => [caseId, loadCase(state, caseId).continues]));
  // The case that restored the working copy a case runs in.
  const restorerOf = (caseId) => {
    const seen = [caseId];
    for (let at = continuesOf.get(caseId); continuesOf.has(at) && !seen.includes(at); at = continuesOf.get(at)) seen.push(at);
    return seen.at(-1);
  };
  const restorer = restorerOf(id);
  const ids = state.cases.filter((caseId) => started(caseId) && restorerOf(caseId) === restorer);
  const failed = [];
  for (const caseId of ids) {
    for (const tag of [`point/${caseId}`, `point-base/${caseId}`]) tryGit(store, ['update-ref', '-d', `refs/tags/${tag}`]);
    delete state.results[caseId];
    delete state.points[caseId];
    const left = deleteAll([result(caseId), dirname(aw(caseId)), step(caseId)]);
    if (left.length > 0) failed.push({ caseId, left });
  }
  writeJson(paths(runDir).state, state);
  // A step folder left behind still counts as started, so that reset can run again.
  if (failed.length > 0) {
    const left = failed.flatMap((f) => f.left).join(', ');
    throw new Refused(`could not delete: ${left}: close the case session and run reset --case ${failed[0].caseId} again`);
  }
  print({ status: 'reset', case: id, reset: ids });
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
  if (result.verdict === 'Pass' || result.verdict === SKIPPED) return `- ${result.verdict}: ${uatCase.title}: ${text}`;
  return `- **${result.verdict}: ${uatCase.title}**: ${text}`;
}

// The review of the run, for the person who checks its grades before they
// commit the ledger: each case's verdict and line, its assertions, every
// criterion with its result and evidence, and the findings. It holds only what
// record saved, so no quota or cost figure.
function reviewOf(runDir, state) {
  const sections = state.cases.map((id) => {
    const uatCase = loadCase(state, id);
    const outcome = state.results[id];
    const file = paths(runDir).result(id);
    const lines = [`## ${uatCase.title}`, '', `Case \`${id}\`. Verdict: **${outcome?.verdict ?? SKIPPED}**.`, '', outcome?.line ?? 'The run never reached this case.'];
    if (!existsSync(file)) return lines.join('\n');
    const result = readJson(file);
    const list = (title, items) => (items.length === 0 ? [] : ['', `${title}:`, '', ...items]);
    lines.push(
      ...list('Assertions', result.assertions.map((a) => `- ${a.ok ? 'pass' : 'fail'}: ${a.name}${a.detail ? `: ${a.detail}` : ''}`)),
      ...list('Criteria', result.judge.map((g) => `- ${g.result}: ${g.criterion}\n  Evidence: ${g.evidence}`)),
      ...list('Findings', [...result.findings.skill.map((f) => `- Skill defect: ${f}`), ...result.findings.environment.map((f) => `- Environment problem: ${f}`)]),
    );
    return lines.join('\n');
  });
  return `# Review of the UAT run\n\nCheck each grade against its evidence before committing the ledger: no Pass reaches it unreviewed.\n\n${sections.join('\n\n')}\n`;
}

const ledgerFile = (casesDir) => join(skillFolderOf(casesDir), 'ledger.json');
function loadLedger(casesDir) {
  const file = ledgerFile(casesDir);
  return existsSync(file) ? readJson(file) : {};
}

// One entry per case with a result in this run. A skipped case keeps the entry
// an earlier run left, and so does every case outside this run.
function writeLedger(state, issue) {
  const file = ledgerFile(state.casesDir);
  const ledger = loadLedger(state.casesDir);
  for (const id of state.cases) {
    const result = state.results[id];
    if (!result || result.verdict === SKIPPED) continue;
    const entry = { verdict: result.verdict, fingerprint: fingerprint(state.casesDir, id), kitCommit: state.kitCommit, date: state.createdAt };
    ledger[id] = issue === undefined ? entry : { ...entry, issue };
  }
  writeJson(file, Object.fromEntries(Object.entries(ledger).sort(([a], [b]) => (a < b ? -1 : 1))));
}

function report(options) {
  if (options.issue !== undefined && !/^[1-9]\d*$/.test(options.issue)) usage('report --issue takes the number of the issue that reports the run');
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
  writeFileSync(paths(runDir).review, reviewOf(runDir, state));
  writeLedger(state, options.issue === undefined ? undefined : Number(options.issue));
  process.stdout.write(text);
}

// The id of the case whose restore point or session a case starts from, if any.
const startsFrom = (uatCase) => uatCase.continues ?? uatCase.from?.case;

// Why the ledger holds no passing run for what the case holds now, or null.
// With a release date, a pass is also due unless it is dated on or after it.
function ownReason(casesDir, entry, id, releaseDate) {
  if (!entry) return 'new';
  if (entry.fingerprint !== fingerprint(casesDir, id)) return 'changed';
  if (entry.verdict !== 'Pass') return 'not-passed';
  if (releaseDate && !(new Date(entry.date) >= releaseDate)) return 'before-release';
  return null;
}

// The date of the most recently dated vX.Y.Z tag in the repo that holds the
// cases folder, or null when it has none: an annotated tag's tagger date, a
// lightweight tag's commit date. Dates, not commit ancestry, so a squash merge
// does not hide a pass.
function latestReleaseDate(casesDir) {
  const tags = git(casesDir, ['for-each-ref', '--sort=-creatordate', '--format=%(refname:strip=2) %(creatordate:iso-strict)', 'refs/tags/v*']);
  const latest = tags
    .split('\n')
    .map((line) => line.split(' '))
    .find(([name]) => /^v\d+\.\d+\.\d+$/.test(name));
  return latest ? new Date(latest[1]) : null;
}

function due(options) {
  const casesDir = resolve(options['cases-dir'] ?? join(skillDir, 'cases'));
  const releaseDate = options.release ? latestReleaseDate(casesDir) : null;
  const ledger = loadLedger(casesDir);
  const cases = allCases(casesDir);
  const byId = new Map(cases.map((uatCase) => [uatCase.id, uatCase]));
  const reasons = new Map();
  const reasonOf = (id) => {
    if (!reasons.has(id)) {
      reasons.set(id, null); // a chain that loops back cannot recurse forever
      const start = startsFrom(byId.get(id));
      const startIsDue = byId.has(start) && reasonOf(start) !== null;
      reasons.set(id, ownReason(casesDir, ledger[id], id, releaseDate) ?? (startIsDue ? 'upstream-due' : null));
    }
    return reasons.get(id);
  };
  const dueCases = cases.filter((uatCase) => reasonOf(uatCase.id) !== null);
  const chains = new Map(dueCases.map((uatCase) => [uatCase.id, chainOf(byId, uatCase)]));
  // A case that starts from an assisted case runs only with a person too: a
  // batch cannot hold the case it needs the restore point or session of.
  const assistedOn = (uatCase) => chains.get(uatCase.id).find((member) => member.assisted !== undefined);
  const assistedWhy = (uatCase) => {
    const assistedCase = assistedOn(uatCase);
    return assistedCase === uatCase ? uatCase.assisted : `starts from ${assistedCase.id}: ${assistedCase.assisted}`;
  };
  print({
    due: dueCases.map((uatCase) => ({ case: uatCase.id, reason: reasonOf(uatCase.id) })),
    batches: batchesOf(chains, dueCases.filter((uatCase) => !assistedOn(uatCase))),
    assisted: batchesOf(chains, dueCases.filter(assistedOn)).map((batch) => ({
      ...batch,
      assisted: batch.due.map((id) => ({ case: id, reason: assistedWhy(byId.get(id)) })),
    })),
  });
  // The release gate: tagging waits until every case has passed since the last release.
  if (options.release && dueCases.length > 0) process.exitCode = EXIT_DUE;
}

// The case's chain back to the case that starts from a ref: itself first.
function chainOf(byId, uatCase) {
  const chain = [uatCase];
  for (let next = byId.get(startsFrom(uatCase)); next && !chain.includes(next); next = byId.get(startsFrom(next))) chain.push(next);
  return chain;
}

// A case starts from at most one case, so the cases joined by from.case and
// continues form trees, and a batch is the part of one tree that its due cases
// need: each due case and every case on its chain, in `order`, with the
// `--cases` list that starts its run.
function batchesOf(chains, dueCases) {
  const trees = new Map();
  for (const uatCase of dueCases) {
    const chain = chains.get(uatCase.id);
    const root = chain.at(-1).id;
    if (!trees.has(root)) trees.set(root, new Set());
    for (const member of chain) trees.get(root).add(member);
  }
  const dueIds = new Set(dueCases.map((uatCase) => uatCase.id));
  return [...trees.values()].map((members) => {
    const ids = [...members].sort((a, b) => a.order - b.order).map((member) => member.id);
    return { cases: ids, due: ids.filter((id) => dueIds.has(id)), paste: `--cases ${ids.join(',')}` };
  });
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
  const failed = deleteAll([...logs, steps, store, points]);
  if (failed.length > 0) throw new Refused(`could not delete: ${failed.join(', ')}`);
  print({ status: 'cleaned', run: runDir });
}

// The local date as yyyymmdd, the name of a run folder made under UAT_TARGET.
function today() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

// Each command and its usage line, the only place that says which options it
// takes: parseArgs refuses any option its line does not name, and the usage
// message shows the lines.
const COMMANDS = {
  init: { action: init, usage: '--run <dir> --source <repo> [--cases a,b] [--cases-dir <dir>]' },
  next: { action: next, usage: '--run <dir>' },
  check: { action: check, usage: '--run <dir> [--turn <n>]' },
  record: { action: record, usage: '--run <dir> --grades <file> [--keep-point yes]' },
  skip: { action: skip, usage: '--run <dir> --reason <text>' },
  reset: { action: reset, usage: '--run <dir> --case <id>' },
  drift: { action: drift, usage: '--run <dir> --when <question> --intent <answer> --reason <why>' },
  report: { action: report, usage: '--run <dir> [--issue <n>]' },
  clean: { action: clean, usage: '--run <dir>' },
  due: { action: due, usage: '[--cases-dir <dir>] [--release]' },
  auto: { action: (options) => print(auto(options)), usage: '--run <dir> [--source <repo>] [--cases a,b] [--cases-dir <dir>] [--judge-model <m>] [--max-five-hour <pct>] [--max-weekly <pct>]' },
};
const usageLine = (command) => `node run.mjs ${command} ${COMMANDS[command].usage}`;
const optionsOf = (command) => [...COMMANDS[command].usage.matchAll(/--([a-z-]+)/g)].map(([, name]) => name);

const [command, ...rest] = process.argv.slice(2);
if (!Object.hasOwn(COMMANDS, command ?? '')) usage(`usage:\n${Object.keys(COMMANDS).map((name) => `  ${usageLine(name)}`).join('\n')}`);
try {
  const options = parseArgs(command, rest);
  const startsRuns = command === 'init' || command === 'auto';
  if (startsRuns && !options.run && process.env.UAT_TARGET) options.run = join(process.env.UAT_TARGET, today());
  if (!options.run && command !== 'due') usage(startsRuns ? '--run <dir> is required, or the UAT_TARGET environment variable' : '--run <dir> is required');
  options.source ??= process.env.UAT_SOURCE;
  COMMANDS[command].action(options);
} catch (error) {
  if (!(error instanceof Refused)) throw error;
  print({ status: 'refused', message: error.message });
  process.exit(EXIT_REFUSED);
}
