// A UAT run, driven as the conductor drives it: run.mjs as a process over a
// throwaway source repo and throwaway UAT case files.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';

import { git, makeRun } from './uat-fixtures.mjs';

const caseFile = (id, extra = {}) => ({
  id,
  title: id,
  group: 'g',
  from: { ref: 'uat/start' },
  command: `/${id}`,
  shell: [],
  answers: [],
  turns: [],
  assertions: [],
  ...extra,
});

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
  assert.deepEqual(output.paste, { shell: [`cd "${workdir}"`, 'npm ci', 'claude'], command: '/c1' });
});

test('a setup that cannot apply stops the run with its reason', (t) => {
  const run = makeRun(t, [caseFile('c1', { setup: [{ replace: 'README.md', pattern: 'not there', with: 'x' }] })]);

  const { status, output } = run.cli('next');

  assert.equal(status, 1);
  assert.match(output.message, /not there/);
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
  assert.equal(git(second.workdir, 'status', '--porcelain'), '');
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

test('a case that continues a session reuses that step\'s working copy and restores nothing', (t) => {
  const run = makeRun(t, [caseFile('intake'), caseFile('spec', { from: undefined, continues: 'intake' })]);
  const intake = run.cli('next').output;
  writeFileSync(join(intake.workdir, 'report.txt'), 'intake findings\n');
  run.cli('check');
  record(run, pass());

  const spec2 = run.cli('next').output;

  assert.equal(spec2.workdir, intake.workdir);
  assert.ok(existsSync(join(spec2.workdir, 'report.txt')));
  assert.equal(spec2.paste.shell.at(-1), 'claude --continue');
  const step = JSON.parse(readFileSync(join(spec2.stepDir, 'step.json'), 'utf8'));
  assert.equal(step.continues, true);
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
