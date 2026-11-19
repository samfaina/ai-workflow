// A UAT run, driven as the conductor drives it: run.mjs as a process over a
// throwaway source repo and throwaway UAT case files.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import test from 'node:test';

import { repoRoot } from './fixtures.mjs';
import { caseFile, git, makeKit, makeRun, runScript } from './uat-fixtures.mjs';

const kitRoot = repoRoot.replaceAll('\\', '/');

test('next restores a point into a clone whose origin is a local repo holding only that commit', (t) => {
  const run = makeRun(t, [caseFile('c1')]);

  const { status, output } = run.cli('next');

  assert.equal(status, 0, output?.message);
  assert.equal(output.status, 'ready');
  const { workdir } = output;
  assert.equal(git(workdir, 'rev-parse', 'HEAD'), run.startCommit);
  assert.equal(git(workdir, 'branch', '--show-current'), 'main');
  assert.equal(git(workdir, 'rev-list', '--count', 'main..origin/main'), '0');
  const origin = git(workdir, 'remote', 'get-url', 'origin');
  assert.ok(isAbsolute(origin), origin);
  assert.ok(existsSync(origin), origin);
  assert.equal(git(workdir, 'for-each-ref', '--format=%(refname)', 'refs/remotes/origin'), 'refs/remotes/origin/HEAD\nrefs/remotes/origin/main');
  assert.equal(git(workdir, 'tag'), '');
  assert.equal(git(origin, 'rev-parse', 'main'), run.startCommit);
});

test('restoring leaves the source repo as it was, work in progress included', (t) => {
  const run = makeRun(t, [caseFile('c1')]);
  const before = run.sourceState();

  assert.equal(run.cli('next').status, 0);

  assert.deepEqual(run.sourceState(), before);
  assert.match(before.status, /wip\.txt/);
});

test('next starts from a source branch, with main at where the branch forked', (t) => {
  const run = makeRun(t, [caseFile('c1', { from: { ref: 'feature/x' } })]);

  const { workdir } = run.cli('next').output;

  assert.equal(git(workdir, 'branch', '--show-current'), 'feature/x');
  assert.equal(git(workdir, 'rev-parse', 'HEAD'), run.branchCommit);
  assert.equal(git(workdir, 'rev-parse', 'main'), run.startCommit);
  assert.equal(git(workdir, 'rev-parse', 'origin/main'), run.startCommit);
  assert.equal(git(workdir, 'rev-list', '--count', 'main..origin/main'), '0');
});

test('next applies the case setup in order, and shows what to paste', (t) => {
  const run = makeRun(t, [
    caseFile('c1', {
      shell: ['npm ci'],
      setup: [
        { write: 'note.md', text: 'status: failed\n' },
        { replace: 'note.md', pattern: 'failed', with: 'inconclusive' },
        { commit: 'fixture commit' },
        { write: '.aw/reviews/1-review.md', text: '# Review: {{BRANCH}} at {{SHORT}}\n' },
      ],
    }),
  ]);

  const { output } = run.cli('next');
  const { workdir } = output;

  assert.equal(readFileSync(join(workdir, 'note.md'), 'utf8'), 'status: inconclusive\n');
  assert.equal(git(workdir, 'log', '-1', '--format=%s'), 'fixture commit');
  assert.equal(git(workdir, 'status', '--porcelain'), '');
  assert.equal(readFileSync(join(workdir, '.aw/reviews/1-review.md'), 'utf8'), `# Review: main at ${git(workdir, 'rev-parse', '--short', 'HEAD')}\n`);
  assert.deepEqual(output.paste, { shell: [`cd "${workdir}"`, 'npm ci', `claude --plugin-dir "${kitRoot}"`], command: '/c1' });
});

test('a setup that cannot apply stops the run with its reason', (t) => {
  const run = makeRun(t, [caseFile('c1', { setup: [{ replace: 'README.md', pattern: 'not there', with: 'x' }] })]);

  const { status, output } = run.cli('next');

  assert.equal(status, 1);
  assert.match(output.message, /not there/);
});

test('a setup deletes a whole folder, and the deletion can be committed', (t) => {
  const run = makeRun(t, [
    caseFile('c1', {
      setup: [
        { write: 'tools/inner/a.md', text: 'a\n' },
        { commit: 'add tools' },
        { delete: 'tools' },
        { commit: 'remove tools' },
      ],
    }),
  ]);

  const { workdir } = run.cli('next').output;

  assert.equal(existsSync(join(workdir, 'tools')), false);
  assert.equal(git(workdir, 'status', '--porcelain'), '');
  assert.equal(git(workdir, 'log', '-1', '--format=%s'), 'remove tools');
});

test('a setup that deletes a path that is not there stops the run, so a renamed path does not go unnoticed', (t) => {
  const run = makeRun(t, [caseFile('c1', { setup: [{ delete: 'no-such-folder' }] })]);

  const { status, output } = run.cli('next');

  assert.equal(status, 1);
  assert.match(output.message, /no-such-folder/);
});

const CHECKS = [
  { name: 'clean tree', run: 'git status --porcelain', stdout: '^$' },
  { name: 'exit code', run: 'git rev-parse --verify no-such-ref', exit: 128 },
  { name: 'file matches', file: 'README.md', matches: '^hello$' },
  { name: 'file absent', file: 'missing.txt', exists: false },
  { name: 'frontmatter', file: 'spec.md', frontmatter: { status: 'draft' } },
];
const spec = (status) => ({ write: 'spec.md', text: `---\nstatus: ${status}\n---\n\n# Spec\n` });

test('check runs shell, file and frontmatter assertions in the working copy and lists judge criteria apart', (t) => {
  const run = makeRun(t, [
    caseFile('c1', {
      setup: [spec('draft'), { commit: 'add spec' }],
      assertions: [...CHECKS, { judge: 'Asked only what the code could not answer' }],
    }),
  ]);
  run.cli('next');

  const { status, output } = run.cli('check');

  assert.equal(status, 0);
  assert.deepEqual(output.results.map((r) => [r.name, r.ok]), CHECKS.map((c) => [c.name, true]));
  assert.equal(output.failed, 0);
  assert.deepEqual(output.judge, ['Asked only what the code could not answer']);
});

test('check reports what failed and why, without stopping at the first', (t) => {
  const run = makeRun(t, [
    caseFile('c1', {
      setup: [spec('approved'), { commit: 'add spec' }],
      assertions: [
        { name: 'draft', file: 'spec.md', frontmatter: { status: 'draft' } },
        { name: 'gone', file: 'README.md', exists: false },
        { name: 'prints', run: 'git log -1 --format=%s', stdout: 'something else' },
      ],
    }),
  ]);
  run.cli('next');

  const { output } = run.cli('check');

  assert.equal(output.failed, 3);
  assert.match(output.results[0].detail, /status.*approved/);
  assert.match(output.results[2].detail, /add spec/);
});

test('check with --turn runs that turn\'s assertions, as a later edit can overwrite them', (t) => {
  const run = makeRun(t, [
    caseFile('c1', {
      setup: [spec('draft'), { commit: 'add spec' }],
      turns: [{ intent: 'approve with a pending change', reason: 'trap', assertions: [{ name: 'still draft', file: 'spec.md', frontmatter: { status: 'draft' } }] }],
    }),
  ]);
  run.cli('next');

  const { output } = run.cli('check', '--turn', '1');

  assert.deepEqual(output.results.map((r) => [r.name, r.ok]), [['still draft', true]]);
});

const pass = (extra = {}) => ({ verdict: 'Pass', line: 'wrote the block and four adapters', judge: [], findings: [], ...extra });

function record(run, grades, ...args) {
  const file = join(run.runDir, `grades-${Math.random()}.json`);
  writeFileSync(file, JSON.stringify(grades));
  return run.cli('record', '--grades', file, ...args);
}

test('a passed step leaves a restore point and its .aw copy, which the next case starts from', (t) => {
  const run = makeRun(t, [
    caseFile('first'),
    caseFile('second', { from: { case: 'first' } }),
  ]);
  const first = run.cli('next').output;
  writeFileSync(join(first.workdir, 'written-by-skill.md'), 'left uncommitted\n');
  mkdirSync(join(first.workdir, '.aw', 'reviews'), { recursive: true });
  writeFileSync(join(first.workdir, '.aw', 'reviews', 'r.md'), 'report\n');
  run.cli('check');

  const recorded = record(run, pass());
  assert.equal(recorded.status, 0, recorded.stdout);
  assert.equal(recorded.output.verdict, 'Pass');

  const headBefore = git(first.workdir, 'rev-parse', 'HEAD');
  assert.equal(headBefore, run.startCommit, 'recording must not move the session\'s own HEAD');
  assert.match(git(first.workdir, 'status', '--porcelain'), /written-by-skill/);

  const second = run.cli('next').output;
  assert.equal(second.case, 'second');
  assert.notEqual(second.workdir, first.workdir);
  assert.match(readFileSync(join(second.workdir, 'written-by-skill.md'), 'utf8'), /^left uncommitted\r?\n$/); // git may convert line endings
  assert.equal(readFileSync(join(second.workdir, '.aw', 'reviews', 'r.md'), 'utf8'), 'report\n');
  assert.match(git(second.workdir, 'status', '--porcelain'), /\?\? written-by-skill\.md/, 'uncommitted work stays uncommitted');
  assert.equal(git(second.workdir, 'rev-parse', 'HEAD'), run.startCommit);
  assert.equal(git(second.workdir, 'rev-parse', 'origin/main'), run.startCommit);
  assert.equal(git(second.workdir, 'rev-list', '--count', 'main..origin/main'), '0');
});

test('a point keeps the branch the step ended on, and where main was', (t) => {
  const run = makeRun(t, [caseFile('first'), caseFile('second', { from: { case: 'first' } })]);
  const first = run.cli('next').output;
  git(first.workdir, 'switch', '-q', '-c', 'feat/made-by-skill');
  writeFileSync(join(first.workdir, 'x.txt'), 'x\n');
  git(first.workdir, 'add', '-A');
  git(first.workdir, 'commit', '-q', '-m', 'work');
  run.cli('check');
  record(run, pass());

  const second = run.cli('next').output;

  assert.equal(git(second.workdir, 'branch', '--show-current'), 'feat/made-by-skill');
  assert.equal(git(second.workdir, 'rev-parse', 'main'), run.startCommit);
  assert.equal(git(second.workdir, 'rev-parse', 'origin/main'), run.startCommit);
});

test('a step that did not pass leaves no point, and a case that needs it is blocked', (t) => {
  const run = makeRun(t, [caseFile('first'), caseFile('second', { from: { case: 'first' } })]);
  run.cli('next');
  run.cli('check');
  record(run, { verdict: 'Fail', line: 'stopped too early', judge: [], findings: [{ kind: 'skill', text: 'x' }] });

  const { status, output } = run.cli('next');

  assert.equal(status, 0);
  assert.equal(output.status, 'blocked');
  assert.equal(output.case, 'second');
  assert.equal(output.needs, 'first');
});

test('the person can keep the state of a step that did not pass, so the route goes on', (t) => {
  const run = makeRun(t, [caseFile('first'), caseFile('second', { from: { case: 'first' } })]);
  run.cli('next');
  run.cli('check');
  record(run, { verdict: 'Fail', line: 'two proven defects', judge: [], findings: [{ kind: 'skill', text: 'x' }] }, '--keep-point', 'yes');

  assert.equal(run.cli('next').output.status, 'ready');
});

test('a case can be skipped with its reason', (t) => {
  const run = makeRun(t, [caseFile('first'), caseFile('second', { from: { case: 'first' } }), caseFile('third')]);
  run.cli('next');
  run.cli('check');
  record(run, { verdict: 'Fail', line: 'x', judge: [], findings: [{ kind: 'skill', text: 'x' }] });
  run.cli('next');

  const skipped = run.cli('skip', '--reason', 'needs the point of first');
  assert.equal(skipped.status, 0, skipped.stdout);

  assert.equal(run.cli('next').output.case, 'third');
});

test('record refuses a Pass while any assertion failed', (t) => {
  const run = makeRun(t, [caseFile('c1', { assertions: [{ name: 'nope', file: 'missing.txt' }] })]);
  run.cli('next');
  run.cli('check');

  const { status, output } = record(run, pass());

  assert.equal(status, 1);
  assert.match(output.message, /nope/);
});

test('record refuses a Pass while a turn\'s assertion failed', (t) => {
  const run = makeRun(t, [caseFile('c1', { turns: [{ intent: 'x', reason: 'y', assertions: [{ name: 'turn check', file: 'missing.txt' }] }] })]);
  run.cli('next');
  run.cli('check', '--turn', '1');
  run.cli('check');

  assert.equal(record(run, pass()).status, 1);
});

test('record refuses without a check, and with a judge criterion left ungraded', (t) => {
  const run = makeRun(t, [caseFile('c1', { assertions: [{ judge: 'Criterion A' }] })]);
  run.cli('next');
  assert.match(record(run, pass()).output.message, /check/);

  run.cli('check');
  assert.match(record(run, pass()).output.message, /Criterion A/);
  assert.match(record(run, pass({ judge: [{ criterion: 'Criterion A', result: 'pass', evidence: '' }] })).output.message, /evidence/);

  const graded = record(run, pass({ judge: [{ criterion: 'Criterion A', result: 'pass', evidence: 'asked one question, cited at line 4' }] }));
  assert.equal(graded.status, 0, graded.stdout);
});

test('a Not proven verdict cannot hide behind a Pass from the judge', (t) => {
  const run = makeRun(t, [caseFile('c1', { assertions: [{ judge: 'Criterion A' }] })]);
  run.cli('next');
  run.cli('check');

  const graded = { criterion: 'Criterion A', result: 'not_proven', evidence: 'the path never ran' };

  assert.equal(record(run, pass({ judge: [graded] })).status, 1);
  assert.equal(record(run, { ...pass({ judge: [graded] }), verdict: 'Not proven' }).status, 0);
});

test('a result is saved with its evidence per criterion and its findings split by cause', (t) => {
  const run = makeRun(t, [caseFile('c1', { assertions: [{ name: 'readme', file: 'README.md' }, { judge: 'Criterion A' }] })]);
  run.cli('next');
  run.cli('check');
  record(run, pass({
    judge: [{ criterion: 'Criterion A', result: 'pass', evidence: 'seen in turn 2' }],
    findings: [{ kind: 'environment', text: 'npm was offline' }, { kind: 'skill', text: 'wrong citation' }],
  }));

  const saved = JSON.parse(readFileSync(join(run.runDir, 'results', 'c1.json'), 'utf8'));

  assert.equal(saved.verdict, 'Pass');
  assert.deepEqual(saved.assertions.map((a) => [a.name, a.ok]), [['readme', true]]);
  assert.equal(saved.judge[0].evidence, 'seen in turn 2');
  assert.deepEqual(saved.findings.skill, ['wrong citation']);
  assert.deepEqual(saved.findings.environment, ['npm was offline']);
});

test('a new conductor resumes at the first step without a result, keeping a step under way', (t) => {
  const run = makeRun(t, [caseFile('c1'), caseFile('c2')]);
  const first = run.cli('next').output;
  run.cli('check');
  record(run, pass());
  const second = run.cli('next').output;
  writeFileSync(join(second.workdir, 'work-in-progress.txt'), 'the agent wrote this\n');

  const resumed = run.cli('next').output;

  assert.equal(resumed.case, 'c2');
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.startedAt, second.startedAt);
  assert.ok(existsSync(join(second.workdir, 'work-in-progress.txt')));
  assert.notEqual(resumed.workdir, first.workdir);
});

test('next says when the run is over', (t) => {
  const run = makeRun(t, [caseFile('c1')]);
  run.cli('next');
  run.cli('check');
  record(run, pass());

  assert.equal(run.cli('next').output.status, 'done');
});

function finishedRun(t) {
  const run = makeRun(t, [caseFile('intake'), caseFile('spec', { from: undefined, continues: 'intake' })]);
  const { workdir, stepDir } = run.cli('next').output;
  run.cli('check');
  record(run, pass());
  run.cli('next');
  run.cli('check');
  record(run, pass());
  run.cli('report');
  const projects = join(dirname(run.runDir), 'config', 'projects');
  const caseLogs = join(projects, workdir.replace(/[^A-Za-z0-9]/g, '-'));
  const otherLogs = join(projects, 'some-other-project');
  for (const dir of [caseLogs, otherLogs]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session.jsonl'), '{}\n');
  }
  return { run, workdir, stepDir, caseLogs, otherLogs };
}

test('clean deletes the working copies, restore points and case logs, and keeps the record of the run', (t) => {
  const { run, stepDir, caseLogs, otherLogs } = finishedRun(t);
  const before = run.sourceState();

  const { status, output } = run.cli('clean');

  assert.equal(status, 0, output?.message);
  assert.equal(output.status, 'cleaned');
  for (const gone of [stepDir, join(run.runDir, 'steps'), join(run.runDir, 'points.git'), join(run.runDir, 'points'), caseLogs]) {
    assert.equal(existsSync(gone), false, gone);
  }
  for (const kept of ['summary.md', 'state.json', join('results', 'intake.json'), join('results', 'spec.json')]) {
    assert.ok(existsSync(join(run.runDir, kept)), kept);
  }
  assert.ok(existsSync(join(otherLogs, 'session.jsonl')));
  assert.deepEqual(run.sourceState(), before);
});

test('a cleaned run can be cleaned again and still reports', (t) => {
  const { run } = finishedRun(t);
  run.cli('clean');

  assert.equal(run.cli('clean').status, 0);
  assert.equal(run.cli('next').output.status, 'done');
  assert.equal(run.cli('report').status, 0);
});

test('clean refuses while a case has no result, and deletes nothing', (t) => {
  const run = makeRun(t, [caseFile('c1'), caseFile('c2')]);
  const { workdir } = run.cli('next').output;
  run.cli('check');
  record(run, pass());

  const { status, output } = run.cli('clean');

  assert.equal(status, 1);
  assert.match(output.message, /c2/);
  assert.ok(existsSync(workdir));
  assert.ok(existsSync(join(run.runDir, 'points.git')));
});

test('a case that continues a session reuses that step\'s working copy and restores nothing', (t) => {
  const run = makeRun(t, [caseFile('intake'), caseFile('spec', { from: undefined, continues: 'intake' })]);
  const intake = run.cli('next').output;
  writeFileSync(join(intake.workdir, 'report.txt'), 'intake findings\n');
  run.cli('check');
  record(run, pass());

  const spec2 = run.cli('next').output;

  assert.equal(spec2.workdir, intake.workdir);
  assert.ok(existsSync(join(spec2.workdir, 'report.txt')));
  assert.equal(spec2.paste.shell.at(-1), `claude --continue --plugin-dir "${kitRoot}"`);
  const step = JSON.parse(readFileSync(join(spec2.stepDir, 'step.json'), 'utf8'));
  assert.equal(step.continues, true);
});

test('after reset, next restores the step under way fresh from its restore point', (t) => {
  const run = makeRun(t, [caseFile('c1', { setup: [{ write: 'note.md', text: 'from the setup\n' }] })]);
  const first = run.cli('next').output;
  writeFileSync(join(first.workdir, 'half-run.txt'), 'the agent wrote this\n');
  writeFileSync(join(first.workdir, 'note.md'), 'changed by the agent\n');

  const reset = run.cli('reset', '--case', 'c1');

  assert.equal(reset.status, 0, reset.stdout);
  assert.deepEqual(reset.output, { status: 'reset', case: 'c1', reset: ['c1'] });
  const again = run.cli('next').output;
  assert.equal(again.status, 'ready');
  assert.equal(again.case, 'c1');
  assert.equal(again.resumed, false);
  assert.equal(existsSync(join(again.workdir, 'half-run.txt')), false);
  assert.equal(readFileSync(join(again.workdir, 'note.md'), 'utf8'), 'from the setup\n');
  assert.equal(git(again.workdir, 'rev-parse', 'HEAD'), run.startCommit);
});

test('reset refuses a case that has not started, and one the run does not hold, and changes nothing; without --case it is a usage error', (t) => {
  const run = makeRun(t, [caseFile('c1'), caseFile('c2')]);
  const first = run.cli('next').output;
  const before = run.state();

  const notStarted = run.cli('reset', '--case', 'c2');
  const unknown = run.cli('reset', '--case', 'nope');

  assert.equal(notStarted.status, 1);
  assert.match(notStarted.output.message, /c2 has not started/);
  assert.equal(unknown.status, 1);
  assert.match(unknown.output.message, /no case nope in this run/);
  assert.deepEqual(run.state(), before);
  assert.ok(existsSync(first.workdir));
  assert.equal(run.cli('reset').status, 2);
});

test('reset discards a recorded step\'s result and restore point, and the step can be recorded again', (t) => {
  const run = makeRun(t, [caseFile('c1'), caseFile('c2')]);
  const first = run.cli('next').output;
  mkdirSync(join(first.workdir, '.aw'), { recursive: true });
  writeFileSync(join(first.workdir, '.aw', 'old.md'), 'first try\n');
  run.cli('check');
  record(run, pass());
  run.cli('next');
  run.cli('check');
  record(run, pass());
  const c2Point = run.state().points.c2;

  const reset = run.cli('reset', '--case', 'c1');

  assert.equal(reset.status, 0, reset.stdout);
  const state = run.state();
  assert.deepEqual(Object.keys(state.results), ['c2']);
  assert.deepEqual(Object.keys(state.points), ['c2']);
  assert.deepEqual(state.points.c2, c2Point);
  assert.equal(existsSync(join(run.runDir, 'results', 'c1.json')), false);
  assert.ok(existsSync(join(run.runDir, 'results', 'c2.json')));
  assert.equal(existsSync(join(run.runDir, 'points', 'c1')), false);
  const store = join(run.runDir, 'points.git');
  assert.equal(git(store, 'tag', '--list', 'point/*'), 'point/c2');

  const again = run.cli('next').output;
  assert.equal(again.case, 'c1');
  assert.equal(again.resumed, false);
  writeFileSync(join(again.workdir, 'second-try.txt'), 'x\n');
  run.cli('check');
  const recorded = record(run, pass());
  assert.equal(recorded.status, 0, recorded.stdout);
  assert.equal(run.cli('next').output.status, 'done');
});

test('resetting a case that continues a session resets its chain back to the case that restored the working copy, and no other case', (t) => {
  const run = makeRun(t, [
    caseFile('apart'),
    caseFile('root'),
    caseFile('branch', { from: { case: 'root' } }),
    caseFile('mid', { from: undefined, continues: 'root' }),
    caseFile('leaf', { from: undefined, continues: 'mid' }),
  ]);
  for (const id of ['apart', 'root', 'branch', 'mid']) {
    const step = run.cli('next').output;
    assert.equal(step.case, id);
    if (id === 'root') writeFileSync(join(step.workdir, 'first-session.txt'), 'x\n');
    run.cli('check');
    record(run, pass());
  }
  run.cli('next');
  const before = run.state();

  const reset = run.cli('reset', '--case', 'leaf');

  assert.equal(reset.status, 0, reset.stdout);
  assert.deepEqual(reset.output.reset, ['root', 'mid', 'leaf']);
  const state = run.state();
  assert.deepEqual(Object.keys(state.results), ['apart', 'branch']);
  assert.deepEqual(state.points, { apart: before.points.apart, branch: before.points.branch });
  for (const id of ['mid', 'leaf']) assert.equal(existsSync(join(run.runDir, 'steps', id)), false, id);

  const root = run.cli('next').output;
  assert.equal(root.case, 'root');
  assert.equal(root.resumed, false);
  assert.equal(existsSync(join(root.workdir, 'first-session.txt')), false);
  run.cli('check');
  record(run, pass());
  const mid = run.cli('next').output;
  assert.equal(mid.case, 'mid');
  assert.equal(mid.resumed, false);
  assert.equal(mid.workdir, root.workdir);
});

test('resetting a case also resets a step under way that continues its session, since that step loses its working copy', (t) => {
  const run = makeRun(t, [caseFile('root'), caseFile('mid', { from: undefined, continues: 'root' })]);
  run.cli('next');
  run.cli('check');
  record(run, pass());
  run.cli('next');

  const reset = run.cli('reset', '--case', 'root');

  assert.deepEqual(reset.output.reset, ['root', 'mid']);
  run.cli('next');
  run.cli('check');
  record(run, pass());
  const mid = run.cli('next').output;
  assert.equal(mid.case, 'mid');
  assert.equal(mid.resumed, false);
});

test('a step under way further down the session resets with its whole chain, recorded cases on it included', (t) => {
  const run = makeRun(t, [
    caseFile('root'),
    caseFile('mid', { from: undefined, continues: 'root' }),
    caseFile('leaf', { from: undefined, continues: 'mid' }),
  ]);
  for (const id of ['root', 'mid']) {
    run.cli('next');
    run.cli('check');
    record(run, pass());
  }
  run.cli('next');

  const reset = run.cli('reset', '--case', 'root');

  assert.deepEqual(reset.output.reset, ['root', 'mid', 'leaf']);
  assert.deepEqual(run.state().results, {});
  for (const id of ['root', 'mid', 'leaf']) {
    const step = run.cli('next').output;
    assert.equal(step.case, id);
    assert.equal(step.resumed, false);
    run.cli('check');
    record(run, pass());
  }
});

test('a recorded case that continued a reset session resets too, so a later case never continues the wrong session', (t) => {
  const run = makeRun(t, [
    caseFile('root'),
    caseFile('mid', { from: undefined, continues: 'root' }),
    caseFile('leaf', { from: undefined, continues: 'mid' }),
  ]);
  for (const id of ['root', 'mid']) {
    run.cli('next');
    run.cli('check');
    record(run, pass());
  }

  const reset = run.cli('reset', '--case', 'root');

  assert.deepEqual(reset.output.reset, ['root', 'mid']);
  run.cli('next');
  run.cli('check');
  record(run, pass());
  assert.equal(run.cli('next').output.case, 'mid');
});

test('drift is added to the case file with the answer used, once', (t) => {
  const run = makeRun(t, [caseFile('c1', { answers: [{ when: 'Tracker', intent: 'no tracker', reason: 'the case' }] })]);
  run.cli('next');
  const args = ['--when', 'Asks which base branch', '--intent', 'keep local main', '--reason', 'the case tests a first setup'];

  assert.equal(run.cli('drift', ...args).status, 0);
  run.cli('drift', ...args);

  const { answers } = run.readCase('c1');
  assert.equal(answers.length, 2);
  assert.deepEqual(answers[1], { when: 'Asks which base branch', intent: 'keep local main', reason: 'the case tests a first setup', drift: true });
});

test('the summary has one line per case in the shape of the #49 comment, grouped', (t) => {
  const run = makeRun(t, [
    caseFile('a', { title: 'none (first run)', group: 'aw-setup' }),
    caseFile('b', { title: 'aw-create-verify', group: 'Feature route' }),
    caseFile('c', { title: 'aw-ship guard', group: 'Feature route' }),
    caseFile('d', { title: 'merge', group: 'Feature route' }),
  ]);
  run.cli('next');
  run.cli('check');
  record(run, pass({ line: 'wrote the block and four adapters' }));
  run.cli('next');
  run.cli('drift', '--when', 'extra', '--intent', 'i', '--reason', 'r');
  run.cli('check');
  record(run, { verdict: 'Fail', line: 'two proven defects', judge: [], findings: [{ kind: 'skill', text: 'x' }] });
  run.cli('next');
  run.cli('check');
  record(run, { verdict: 'Not proven', line: 'stopped before the guard', judge: [], findings: [{ kind: 'environment', text: 'x' }] });

  const { status, stdout } = run.cli('report');

  assert.equal(status, 0);
  assert.equal(
    stdout,
    [
      '**aw-setup**',
      '',
      '- Pass: none (first run): wrote the block and four adapters',
      '',
      '**Feature route**',
      '',
      '- **Fail: aw-create-verify**: two proven defects (1 question not in the case, added)',
      '- **Not proven: aw-ship guard**: stopped before the guard',
      '- Not run: merge',
      '',
    ].join('\n'),
  );
  assert.equal(readFileSync(join(run.runDir, 'summary.md'), 'utf8'), stdout);
});

const fail = { verdict: 'Fail', line: 'two proven defects', judge: [], findings: [{ kind: 'skill', text: 'x' }] };

// Runs the next cases of the run, one per grades given: next, check, then
// record with those grades. Returns each step's working copy.
function runCases(run, ...grades) {
  return grades.map((g) => {
    const { workdir } = run.cli('next').output;
    run.cli('check');
    const recorded = record(run, g);
    assert.equal(recorded.status, 0, recorded.stdout);
    return workdir;
  });
}

test('report writes a ledger entry for every case with a result, and the issue that reports it', (t) => {
  const run = makeRun(t, [caseFile('a'), caseFile('b'), caseFile('c')]);
  runCases(run, pass(), fail);

  const { status, stdout } = run.cli('report', '--issue', '42');

  assert.equal(status, 0, stdout);
  const ledger = run.ledger();
  const { kitCommit, createdAt } = run.state();
  assert.deepEqual(Object.keys(ledger), ['a', 'b']);
  for (const [id, verdict] of [['a', 'Pass'], ['b', 'Fail']]) {
    const { fingerprint, ...rest } = ledger[id];
    assert.match(fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(rest, { verdict, kitCommit, date: createdAt, issue: 42 });
  }
});

test('without --issue a ledger entry names no issue', (t) => {
  const run = makeRun(t, [caseFile('a')]);
  runCases(run, pass());

  run.cli('report');

  assert.equal('issue' in run.ledger().a, false);
});

test('report keeps the entry of a case outside the run, and of a case this run skipped', (t) => {
  const run = makeRun(t, [caseFile('a'), caseFile('b')]);
  const earlier = (verdict) => ({ verdict, fingerprint: 'f'.repeat(64), kitCommit: '0'.repeat(40), date: '2026-01-01T00:00:00.000Z', issue: 7 });
  const before = { b: earlier('Pass'), outside: earlier('Fail') };
  writeFileSync(run.ledgerFile, JSON.stringify(before));
  runCases(run, pass());
  run.cli('next');
  run.cli('skip', '--reason', 'no time');

  run.cli('report');

  const ledger = run.ledger();
  assert.deepEqual(Object.keys(ledger), ['a', 'b', 'outside']);
  assert.equal(ledger.a.verdict, 'Pass');
  assert.deepEqual(ledger.b, before.b);
  assert.deepEqual(ledger.outside, before.outside);
});

test('the fingerprint changes with a case field or a fixture it copies, and not with line endings alone', (t) => {
  const withFixture = caseFile('a', { setup: [{ copy: 'fixtures/review.md', to: 'review.md' }] });
  const run = makeRun(t, [withFixture], { fixtures: { 'fixtures/review.md': 'Proven defects: 0\n', 'fixtures/other.md': 'other\n' } });
  const [workdir] = runCases(run, pass());
  const fingerprintAfter = (change) => {
    change();
    run.cli('report');
    return run.ledger().a.fingerprint;
  };
  const caseText = readFileSync(join(run.casesDir, 'a.json'), 'utf8');
  const crlf = (text) => text.replace(/\n/g, '\r\n');

  const first = fingerprintAfter(() => {});
  assert.equal(readFileSync(join(workdir, 'review.md'), 'utf8'), 'Proven defects: 0\n', 'the step copied the fixture');
  assert.equal(fingerprintAfter(() => writeFileSync(join(run.casesDir, 'a.json'), crlf(caseText))), first);
  assert.equal(fingerprintAfter(() => run.writeFixture('fixtures/review.md', crlf('Proven defects: 0\n'))), first);
  assert.equal(fingerprintAfter(() => run.writeFixture('fixtures/other.md', 'changed\n')), first, 'a fixture the case does not copy');

  const fixtureChanged = fingerprintAfter(() => run.writeFixture('fixtures/review.md', 'Proven defects: 1\n'));
  assert.notEqual(fixtureChanged, first);
  const caseChanged = fingerprintAfter(() => run.writeCase({ ...withFixture, title: 'renamed' }));
  assert.notEqual(caseChanged, fixtureChanged);
});

test('the fingerprint does not change with the case\'s order alone, since inserting a case renumbers every later one', (t) => {
  const numbered = caseFile('a', { order: 3 });
  const run = makeRun(t, [numbered]);
  runCases(run, pass());
  run.cli('report');
  const first = run.ledger().a.fingerprint;

  run.writeCase({ ...numbered, order: 4 });
  run.cli('report');

  assert.equal(run.ledger().a.fingerprint, first);
});

test('the fingerprint counts what the case file parses to, not its formatting, and keeps the order of its keys', (t) => {
  const original = caseFile('a', { setup: [{ write: 'note.md', text: 'x\n' }] });
  const run = makeRun(t, [original]);
  runCases(run, pass());
  const fingerprintAfter = (text) => {
    writeFileSync(join(run.casesDir, 'a.json'), text);
    run.cli('report');
    return run.ledger().a.fingerprint;
  };

  const first = fingerprintAfter(JSON.stringify(original, null, 2) + '\n');
  assert.equal(fingerprintAfter(JSON.stringify(original)), first, 'no indentation');
  assert.equal(fingerprintAfter(JSON.stringify(original, null, '\t').replace(/": /g, '":   ') + '\n\n'), first, 'other whitespace');

  const { title, id, ...rest } = original;
  assert.notEqual(fingerprintAfter(JSON.stringify({ title, id, ...rest }, null, 2)), first, 'two keys swapped');
});

test('the fingerprint report writes holds the drift the run added, and no path', (t) => {
  const original = caseFile('a');
  const drifted = makeRun(t, [original]);
  drifted.cli('next');
  drifted.cli('drift', '--when', 'Asks which base branch', '--intent', 'keep local main', '--reason', 'first setup');
  drifted.cli('check');
  record(drifted, pass());
  drifted.cli('report');
  const asDrifted = makeRun(t, [drifted.readCase('a')]);
  runCases(asDrifted, pass());
  asDrifted.cli('report');
  const undrifted = makeRun(t, [original]);
  runCases(undrifted, pass());
  undrifted.cli('report');

  const fingerprint = drifted.ledger().a.fingerprint;
  assert.equal(drifted.readCase('a').answers.at(-1).drift, true);
  assert.equal(asDrifted.ledger().a.fingerprint, fingerprint, 'the same case content gives the same fingerprint, in another folder');
  assert.notEqual(undrifted.ledger().a.fingerprint, fingerprint);
  const text = readFileSync(drifted.ledgerFile, 'utf8');
  for (const path of [basename(drifted.root), kitRoot, repoRoot]) assert.equal(text.includes(path), false, path);
});

test('report refuses an issue that is not a number', (t) => {
  const run = makeRun(t, [caseFile('a')]);
  runCases(run, pass());

  assert.equal(run.cli('report', '--issue', '#42').status, 2);
  assert.equal(existsSync(run.ledgerFile), false);
});

test('without --cases a run takes every case file, in the order they declare', (t) => {
  const run = makeRun(t, [caseFile('zeta', { order: 1 }), caseFile('alpha', { order: 2 })], { allCases: true });

  assert.equal(run.cli('next').output.case, 'zeta');
});

test('a file assertion with a wildcard reads the last file in name order, as aw-ship picks a review', (t) => {
  const run = makeRun(t, [
    caseFile('c1', {
      setup: [
        { write: '.aw/reviews/20260101-review.md', text: 'Proven defects: 1 introduced\n' },
        { write: '.aw/reviews/20260202-review.md', text: 'Proven defects: 0 introduced\n' },
      ],
      assertions: [
        { name: 'latest', file: '.aw/reviews/*-review.md', matches: '0 introduced' },
        { name: 'not the old one', file: '.aw/reviews/*-review.md', matches: '1 introduced' },
        { name: 'none', file: '.aw/drafts/*-merge.md', exists: false },
      ],
    }),
  ]);
  run.cli('next');

  const { output } = run.cli('check');

  assert.deepEqual(output.results.map((r) => r.ok), [true, false, true]);
});

test('commands can reach the kit, and the slash command can name the run folder', (t) => {
  const run = makeRun(t, [
    caseFile('c1', {
      command: '/aw-retro read the logs under {{RUN}}',
      assertions: [{ name: 'kit script', run: 'node {{KIT}}/skills/aw-check-spec/scripts/check-spec.mjs' }],
    }),
  ]);

  const { output } = run.cli('next');
  assert.equal(output.paste.command, `/aw-retro read the logs under ${run.runDir}`);

  const checked = run.cli('check').output;
  assert.deepEqual(checked.results.map((r) => [r.name, r.ok]), [['kit script', true]], JSON.stringify(checked.results));
});

test('record refuses a Pass when a turn with assertions was never checked', (t) => {
  const run = makeRun(t, [caseFile('c1', { turns: [{ intent: 'x', reason: 'y', assertions: [{ name: 'still draft', file: 'README.md' }] }] })]);
  run.cli('next');
  run.cli('check');

  const refused = record(run, pass());
  assert.equal(refused.status, 1);
  assert.match(refused.output.message, /turn 1/);

  run.cli('check', '--turn', '1');
  assert.equal(record(run, pass()).status, 0);
});

test('a setup that failed can be retried once the case is fixed', (t) => {
  const broken = { setup: [{ replace: 'README.md', pattern: 'not there', with: 'x' }] };
  const run = makeRun(t, [caseFile('c1', broken)]);
  run.cli('next');

  const again = run.cli('next');
  assert.equal(again.status, 1);
  assert.match(again.output.message, /not there/, 'the original reason, not a clone error');

  run.writeCase(caseFile('c1', { setup: [{ replace: 'README.md', pattern: 'hello', with: 'bye' }] }));
  const fixed = run.cli('next');
  assert.equal(fixed.status, 0, fixed.stdout);
  assert.match(readFileSync(join(fixed.output.workdir, 'README.md'), 'utf8'), /^bye/);
});

test('a file assertion can require an exact number of matches, on files with either line ending', (t) => {
  const run = makeRun(t, [
    caseFile('c1', {
      setup: [{ write: 'ignore.txt', text: '.aw/\r\nnode_modules/\r\n.aw/\r\n' }],
      assertions: [
        { name: 'twice', file: 'ignore.txt', matches: '^\\.aw/$', count: 2 },
        { name: 'not once', file: 'ignore.txt', matches: '^\\.aw/$', count: 1 },
      ],
    }),
  ]);
  run.cli('next');

  const { output } = run.cli('check');

  assert.deepEqual(output.results.map((r) => r.ok), [true, false]);
  assert.match(output.results[1].detail, /2/);
});

test('init without --run creates the run in UAT_TARGET, in a folder named after the date', (t) => {
  const run = makeRun(t, [caseFile('a')]);
  const target = join(dirname(run.runDir), 'target');
  const env = { ...process.env, UAT_TARGET: target, UAT_SOURCE: run.source };
  const result = spawnSync(process.execPath, [runScript, 'init', '--cases-dir', run.casesDir], { encoding: 'utf8', env });

  assert.equal(result.status, 0, result.stdout);
  const { run: runDir } = JSON.parse(result.stdout);
  assert.equal(dirname(runDir), target);
  assert.match(basename(runDir), /^\d{8}$/);
  assert.ok(existsSync(join(runDir, 'state.json')));
});

test('init records the commit of the kit checkout the run tests', (t) => {
  const run = makeRun(t, [caseFile('a')]);

  assert.equal(run.state().kitCommit, git(repoRoot, 'rev-parse', 'HEAD'));
});

test('init warns when the kit checkout has uncommitted changes, and still creates the run', (t) => {
  const kit = makeKit(t);
  writeFileSync(kit.script, `${readFileSync(kit.script, 'utf8')}// changed by hand\n`);

  const run = makeRun(t, [caseFile('a')], { script: kit.script });

  assert.equal(run.init.status, 'created');
  assert.match(run.init.warning, /uncommitted changes/);
  assert.match(run.init.warning, new RegExp(kit.commit));
  assert.equal(run.state().kitCommit, kit.commit);
});

test('init over a committed kit checkout gives no warning', (t) => {
  const kit = makeKit(t);

  const run = makeRun(t, [caseFile('a')], { script: kit.script });

  assert.equal(run.init.warning, undefined);
  assert.equal(run.state().kitCommit, kit.commit);
});

// The ids of `due`'s due cases with their reasons.
const reasons = (output) => Object.fromEntries(output.due.map((d) => [d.case, d.reason]));

test('due lists a case with no ledger entry as new, and not a case whose run passed', (t) => {
  const run = makeRun(t, [caseFile('a', { order: 1 }), caseFile('b', { order: 2 })]);
  runCases(run, pass());
  run.cli('report');

  const { status, output } = run.due();

  assert.equal(status, 0, output?.message);
  assert.deepEqual(output.due, [{ case: 'b', reason: 'new' }]);
});

test('due lists a case as changed when its file or a fixture it copies changed since its run', (t) => {
  const copies = caseFile('copies', { order: 2, setup: [{ copy: 'fixtures/review.md', to: 'review.md' }] });
  const edited = caseFile('edited', { order: 1 });
  const run = makeRun(t, [edited, copies, caseFile('same', { order: 3 })], { fixtures: { 'fixtures/review.md': 'Proven defects: 0\n' } });
  runCases(run, pass(), pass(), pass());
  run.cli('report');

  run.writeCase({ ...edited, title: 'renamed' });
  run.writeFixture('fixtures/review.md', 'Proven defects: 1\n');

  assert.deepEqual(run.due().output.due, [{ case: 'edited', reason: 'changed' }, { case: 'copies', reason: 'changed' }]);
});

test('due lists a case whose last run did not pass as not-passed, whatever the verdict', (t) => {
  const run = makeRun(t, [caseFile('failed', { order: 1 }), caseFile('unproven', { order: 2 })]);
  runCases(run, fail, { verdict: 'Not proven', line: 'stopped early', judge: [], findings: [{ kind: 'environment', text: 'x' }] });
  run.cli('report');

  assert.deepEqual(run.due().output.due, [{ case: 'failed', reason: 'not-passed' }, { case: 'unproven', reason: 'not-passed' }]);
});

// A route of passed cases, in its ledger: `root` starts from a ref, `point`
// from root's restore point, `session` continues point's session, and `apart`
// shares nothing with them.
function passedRoute(t, extra = {}) {
  const route = {
    root: caseFile('root', { order: 1, ...extra.root }),
    point: caseFile('point', { order: 2, from: { case: 'root' }, ...extra.point }),
    session: caseFile('session', { order: 3, from: undefined, continues: 'point', ...extra.session }),
    apart: caseFile('apart', { order: 4, ...extra.apart }),
  };
  const run = makeRun(t, Object.values(route));
  runCases(run, pass(), pass(), pass(), pass());
  run.cli('report');
  return { run, route };
}

test('a case that starts from a due case is due as upstream-due, through from.case and through continues', (t) => {
  const { run, route } = passedRoute(t);

  run.writeCase({ ...route.root, title: 'renamed' });

  assert.deepEqual(reasons(run.due().output), { root: 'changed', point: 'upstream-due', session: 'upstream-due' });
});

test('a case keeps its own reason when the case it starts from is due too', (t) => {
  const { run, route } = passedRoute(t);

  run.writeCase({ ...route.root, title: 'renamed' });
  run.writeCase({ ...route.session, title: 'renamed' });

  assert.deepEqual(reasons(run.due().output), { root: 'changed', point: 'upstream-due', session: 'changed' });
});

test('a batch holds the cases its due cases start from, and cases with no chain between them land in separate batches', (t) => {
  const { run, route } = passedRoute(t);

  run.writeCase({ ...route.session, title: 'renamed' });
  run.writeCase({ ...route.apart, title: 'renamed' });

  assert.deepEqual(run.due().output.batches, [
    { cases: ['root', 'point', 'session'], due: ['session'], paste: '--cases root,point,session' },
    { cases: ['apart'], due: ['apart'], paste: '--cases apart' },
  ]);
});

test('due cases that start from the same case share its batch, in order', (t) => {
  const run = makeRun(t, [
    caseFile('root', { order: 1 }),
    caseFile('late', { order: 3, from: { case: 'root' } }),
    caseFile('early', { order: 2, from: { case: 'root' } }),
  ]);
  runCases(run, pass());
  run.cli('report');

  assert.deepEqual(run.due().output.batches, [{ cases: ['root', 'early', 'late'], due: ['early', 'late'], paste: '--cases root,early,late' }]);
});

const TERMINAL = 'its checks read what the terminal shows';

test('an assisted case is listed apart with its reason and the cases it starts from, never inside a batch', (t) => {
  const { run, route } = passedRoute(t, { session: { assisted: TERMINAL } });

  run.writeCase({ ...route.point, title: 'renamed' });

  const { output } = run.due();
  assert.deepEqual(reasons(output), { point: 'changed', session: 'upstream-due' });
  assert.deepEqual(output.batches, [{ cases: ['root', 'point'], due: ['point'], paste: '--cases root,point' }]);
  assert.deepEqual(output.assisted, [
    { cases: ['root', 'point', 'session'], due: ['session'], paste: '--cases root,point,session', assisted: [{ case: 'session', reason: TERMINAL }] },
  ]);
});

test('a due case that starts from an assisted case is listed apart too, since no batch can hold what it starts from', (t) => {
  const { run, route } = passedRoute(t, { point: { assisted: TERMINAL } });

  run.writeCase({ ...route.session, title: 'renamed' });

  const { output } = run.due();
  assert.deepEqual(output.batches, []);
  assert.deepEqual(output.assisted, [
    { cases: ['root', 'point', 'session'], due: ['session'], paste: '--cases root,point,session', assisted: [{ case: 'session', reason: `starts from point: ${TERMINAL}` }] },
  ]);
});

test('an assisted case and the due cases that start from it are listed apart as one run, as a batch is', (t) => {
  const { run, route } = passedRoute(t, { point: { assisted: TERMINAL } });

  run.writeCase({ ...route.point, title: 'renamed' });

  const { output } = run.due();
  assert.deepEqual(output.batches, []);
  assert.deepEqual(output.assisted, [
    {
      cases: ['root', 'point', 'session'],
      due: ['point', 'session'],
      paste: '--cases root,point,session',
      assisted: [{ case: 'point', reason: TERMINAL }, { case: 'session', reason: `starts from point: ${TERMINAL}` }],
    },
  ]);
});

test('a pass on another kit commit still counts: a change to a kit skill alone makes no case due', (t) => {
  const run = makeRun(t, [caseFile('a', { order: 1 })]);
  runCases(run, pass());
  run.cli('report');
  const ledger = run.ledger();
  writeFileSync(run.ledgerFile, JSON.stringify({ a: { ...ledger.a, kitCommit: '0'.repeat(40) } }));

  assert.deepEqual(run.due().output.due, []);
});

// Dates each case's ledger entry, as if its last run had started then.
function datePasses(run, dates) {
  const ledger = run.ledger();
  for (const [id, date] of Object.entries(dates)) ledger[id] = { ...ledger[id], date };
  writeFileSync(run.ledgerFile, JSON.stringify(ledger));
}

// Makes the folder that holds the cases a git repo, as the kit is, and adds
// a commit dated `date`.
function commitKit(run, date) {
  if (!existsSync(join(run.root, '.git'))) git(run.root, 'init', '-q', '-b', 'main');
  git(run.root, 'commit', '-q', '--allow-empty', '-m', date, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}

// Tags a release in that repo on a commit dated `date`. An annotated tag is
// dated `taggedAt`, by default the commit's date.
function tagRelease(run, name, date, { annotated = false, taggedAt = date } = {}) {
  commitKit(run, date);
  git(run.root, 'tag', ...(annotated ? ['-a', '-m', name] : []), name, { GIT_COMMITTER_DATE: taggedAt });
}

test('due --release lists as due a case whose last pass predates the latest release tag, and plain due does not', (t) => {
  const run = makeRun(t, [caseFile('old', { order: 1 }), caseFile('fresh', { order: 2 })]);
  runCases(run, pass(), pass());
  run.cli('report');
  datePasses(run, { old: '2026-01-01T10:00:00.000Z', fresh: '2026-03-01T10:00:00.000Z' });
  tagRelease(run, 'v1.0.0', '2026-02-01T10:00:00Z');

  assert.deepEqual(run.due().output.due, []);
  assert.deepEqual(run.due('--release').output.due, [{ case: 'old', reason: 'before-release' }]);
});

test('with no release tag, due --release lists the same cases as due', (t) => {
  const run = makeRun(t, [caseFile('passed', { order: 1 }), caseFile('failed', { order: 2 }), caseFile('unrun', { order: 3 })]);
  runCases(run, pass(), fail);
  run.cli('report');
  datePasses(run, { passed: '2026-01-01T10:00:00.000Z' });
  commitKit(run, '2026-02-01T10:00:00Z');
  git(run.root, 'tag', 'uat/start');

  const plain = run.due().output;
  assert.deepEqual(reasons(plain), { failed: 'not-passed', unrun: 'new' });
  assert.deepEqual(run.due('--release').output, plain);
});

test('due --release exits non-zero while any case is due, an assisted case included, and zero when none is', (t) => {
  const run = makeRun(t, [caseFile('plain', { order: 1 }), caseFile('assisted', { order: 2, assisted: TERMINAL })]);
  runCases(run, pass(), pass());
  run.cli('report');
  tagRelease(run, 'v1.0.0', '2026-02-01T10:00:00Z');
  datePasses(run, { plain: '2026-03-01T10:00:00.000Z', assisted: '2026-01-01T10:00:00.000Z' });

  const blocked = run.due('--release');
  assert.equal(blocked.status, 3, 'its own exit code, apart from a refusal');
  assert.deepEqual(blocked.output.batches, []);
  assert.deepEqual(blocked.output.assisted.map((batch) => batch.assisted), [[{ case: 'assisted', reason: TERMINAL }]]);
  assert.equal(run.due().status, 0, 'plain due lists what is due and does not fail');

  datePasses(run, { assisted: '2026-03-01T10:00:00.000Z' });
  const clear = run.due('--release');
  assert.equal(clear.status, 0, clear.stdout);
  assert.deepEqual(clear.output.due, []);
});

test('the latest release is the most recently dated vX.Y.Z tag, a hotfix of an older line included, and other tags do not count', (t) => {
  const run = makeRun(t, [caseFile('between', { order: 1 }), caseFile('after', { order: 2 })]);
  runCases(run, pass(), pass());
  run.cli('report');
  tagRelease(run, 'v1.1.0', '2026-02-01T10:00:00Z');
  tagRelease(run, 'v1.0.1', '2026-04-01T10:00:00Z');
  tagRelease(run, 'v2.0.0-rc.1', '2026-06-01T10:00:00Z');
  tagRelease(run, 'uat/late', '2026-07-01T10:00:00Z');
  datePasses(run, { between: '2026-03-01T10:00:00.000Z', after: '2026-05-01T10:00:00.000Z' });

  assert.deepEqual(run.due('--release').output.due, [{ case: 'between', reason: 'before-release' }]);
});

test('an annotated release tag counts from when it was tagged, not from its commit', (t) => {
  const run = makeRun(t, [caseFile('a', { order: 1 })]);
  runCases(run, pass());
  run.cli('report');
  tagRelease(run, 'v1.0.0', '2026-01-15T10:00:00Z', { annotated: true, taggedAt: '2026-03-15T10:00:00Z' });

  datePasses(run, { a: '2026-02-01T10:00:00.000Z' });
  assert.deepEqual(run.due('--release').output.due, [{ case: 'a', reason: 'before-release' }]);
  datePasses(run, { a: '2026-04-01T10:00:00.000Z' });
  assert.deepEqual(run.due('--release').output.due, []);
});

test('due --release refuses a cases folder outside a git repo, since it cannot read the release tags', (t) => {
  const run = makeRun(t, [caseFile('a', { order: 1 })]);
  runCases(run, pass());
  run.cli('report');

  const { status, output } = run.due('--release');
  assert.equal(status, 1);
  assert.equal(output.status, 'refused');
  assert.match(output.message, /git for-each-ref/);
});

test('--release belongs to due: another command given it is a usage error', (t) => {
  const run = makeRun(t, [caseFile('a')]);

  assert.equal(run.cli('next', '--release').status, 2);
});

test('an option the command does not take is a usage error that names the option and the command, and the command does not run', (t) => {
  const run = makeRun(t, [caseFile('a'), caseFile('b')]);
  const result = run.cli('clean', '--case', 'a');

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--case/);
  assert.match(result.stderr, /\bclean\b/);
  assert.equal(result.stdout, '');
  assert.ok(existsSync(join(run.runDir, 'points.git')));
});

test('init given an option it does not take is a usage error and creates no run folder, rather than running every case', (t) => {
  const run = makeRun(t, [caseFile('a'), caseFile('b')]);
  const runDir = join(run.root, 'second-run');
  const result = spawnSync(process.execPath, [runScript, 'init', '--run', runDir, '--source', run.source, '--cases-dir', run.casesDir, '--case', 'a'], { encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /init takes no option --case/);
  assert.equal(existsSync(runDir), false);
});

test('init refuses a --cases list naming a case the cases folder does not hold, and creates no run folder', (t) => {
  const run = makeRun(t, [caseFile('a'), caseFile('b')]);
  const runDir = join(run.root, 'second-run');
  const result = spawnSync(process.execPath, [runScript, 'init', '--run', runDir, '--source', run.source, '--cases-dir', run.casesDir, '--cases', 'a,nosuch,other'], { encoding: 'utf8' });

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'refused');
  assert.match(output.message, /no case nosuch, other in /);
  assert.equal(existsSync(runDir), false);
});

test('due takes only --cases-dir and --release: --run and an unknown option are usage errors', (t) => {
  const run = makeRun(t, [caseFile('a')]);

  const bogus = run.due('--bogus', 'x');
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /due takes no option --bogus/);
  assert.equal(bogus.stdout, '');
  assert.equal(run.due('--run', run.runDir).status, 2);
});

test('--source belongs to init, while UAT_SOURCE still gives init its source', (t) => {
  const run = makeRun(t, [caseFile('a')]);

  const result = run.cli('next', '--source', run.source);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /next takes no option --source/);

  const runDir = join(run.root, 'from-env');
  const env = { ...process.env, UAT_SOURCE: run.source };
  const init = spawnSync(process.execPath, [runScript, 'init', '--run', runDir, '--cases-dir', run.casesDir], { encoding: 'utf8', env });
  assert.equal(init.status, 0, init.stderr);
  assert.equal(JSON.parse(init.stdout).status, 'created');
});

test('the usage message lists each command with the options it takes, as the script\'s header comment does', () => {
  const squeeze = (line) => line.trim().replace(/\s+/g, ' ');
  const header = readFileSync(runScript, 'utf8').split('\n').filter((line) => line.startsWith('//   node run.mjs ')).map((line) => squeeze(line.slice(2)));
  const result = spawnSync(process.execPath, [runScript], { encoding: 'utf8' });
  const listed = result.stderr.split('\n').filter((line) => line.trim().startsWith('node run.mjs ')).map(squeeze);

  assert.equal(result.status, 2);
  assert.equal(header.length, 11);
  assert.deepEqual(listed, header);
});

test('only init falls back to UAT_TARGET: another command without --run is a usage error', (t) => {
  const run = makeRun(t, [caseFile('a')]);
  const env = { ...process.env, UAT_TARGET: dirname(run.runDir) };
  const result = spawnSync(process.execPath, [runScript, 'next'], { encoding: 'utf8', env });

  assert.equal(result.status, 2);
});
