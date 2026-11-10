// The committed UAT case files: complete, and covering the #49 results and the
// routes #55 runs.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { repoRoot } from './fixtures.mjs';
import { skillDir } from './uat-fixtures.mjs';

const casesDir = join(skillDir, 'cases');
const cases = readdirSync(casesDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ name, ...JSON.parse(readFileSync(join(casesDir, name), 'utf8')) }))
  .sort((a, b) => a.order - b.order);
const byId = new Map(cases.map((c) => [c.id, c]));

// One entry per result line of the #49 comment, plus what it left unproven, then
// the fast and epic routes of #55.
const EXPECTED = [
  'aw-setup-none', 'aw-setup-local', 'aw-setup-gitlab', 'aw-setup-other', 'aw-setup-github', 'aw-setup-node-warning', 'aw-setup-pocock',
  'aw-intake-bug', 'aw-intake-performance', 'aw-intake-refactor', 'aw-intake-investigation', 'aw-intake-feature',
  'aw-spec-approval-traps', 'aw-slices', 'aw-build-contradiction', 'aw-build-slice-1', 'aw-build-slice-2', 'aw-build-slice-3',
  'aw-verify-no-skill', 'aw-create-verify', 'aw-verify-generated', 'aw-review-route',
  'aw-ship-guard-failed', 'aw-ship-guard-inconclusive', 'aw-ship-default', 'aw-ship-write-uncovered', 'aw-ship-checks-uncovered', 'aw-ship-write', 'aw-ship-merge-write',
  'aw-review-planted', 'aw-ship-planted', 'aw-review-clean',
  'aw-retro-run', 'aw-retro-approval',
  'aw-build-fix-standard', 'aw-build-fix-fast',
  'aw-converge-clean', 'aw-converge-limit',
  'aw-implement-clean', 'aw-implement-hitl', 'aw-implement-stop', 'aw-implement-relaunch',
  'aw-fast-build', 'aw-fast-verify-skipped', 'aw-fast-review', 'aw-fast-ship',
  'aw-fast-verified-build', 'aw-fast-verified-verify', 'aw-fast-verified-review', 'aw-fast-merge-write', 'aw-fast-merge-unproven',
  'aw-intake-contract', 'aw-intake-stored-data', 'aw-intake-security', 'aw-build-refuses-contract',
  'aw-wayfinder-github-write', 'aw-wayfinder-github-draft', 'aw-wayfinder-none-declined', 'aw-wayfinder-none-accepted',
  'aw-wayfinder-handoff', 'aw-epic-spec', 'aw-epic-slices', 'aw-epic-build', 'aw-epic-review', 'aw-epic-ship',
];

test('there is a case file for every result of #49 and for what it left unproven', () => {
  assert.deepEqual(cases.map((c) => c.id), EXPECTED);
});

test('every case file is named after its id and has what a run needs', () => {
  for (const c of cases) {
    assert.equal(c.name, `${c.id}.json`);
    for (const field of ['title', 'group', 'source', 'command']) assert.ok(c[field], `${c.id}: ${field}`);
    assert.ok(Array.isArray(c.shell) && Array.isArray(c.answers) && Array.isArray(c.turns), c.id);
    assert.ok(c.assertions.length > 0, `${c.id}: no assertions`);
    assert.ok(c.assertions.some((a) => a.judge), `${c.id}: no judge criterion`);
  }
});

test('answers and turns are intents with a reason, never option labels', () => {
  for (const c of cases) {
    for (const answer of c.answers) {
      assert.ok(answer.when && answer.intent && answer.reason, `${c.id}: ${JSON.stringify(answer)}`);
      assert.equal(answer.label, undefined, c.id);
    }
    for (const turn of c.turns) assert.ok(turn.intent && turn.reason, `${c.id}: ${JSON.stringify(turn)}`);
  }
});

test('each case starts from a restore point or continues an earlier session', () => {
  for (const c of cases) {
    assert.ok(Boolean(c.from) !== Boolean(c.continues), `${c.id}: needs exactly one of from and continues`);
    const earlier = c.continues ?? c.from.case;
    if (earlier) assert.ok(byId.get(earlier)?.order < c.order, `${c.id} depends on ${earlier}, which must come first`);
  }
});

test('the two cases #49 left unproven exist and test what #86 asks', () => {
  const failed = JSON.stringify(byId.get('aw-ship-guard-failed'));
  assert.match(failed, /\(failed\)/);
  const inconclusive = JSON.stringify(byId.get('aw-ship-guard-inconclusive'));
  assert.match(inconclusive, /AC-2 \| verify/);
  const merge = byId.get('aw-ship-merge-write');
  assert.ok(merge.assertions.some((a) => a.run === 'git branch --merged main'));
});

test('a later commit that changes only the VCS adapter goes on, and takes the access levels from its Operations table', () => {
  const uncovered = byId.get('aw-ship-write-uncovered');
  assert.ok(uncovered.setup.some((op) => op.to === 'docs/agents/vcs.md'));
  assert.ok(!uncovered.setup.some((op) => op.replace === 'AGENTS.md'), 'the commit must change the adapter alone');
  assert.ok(uncovered.assertions.some((a) => a.frontmatter?.status === 'implemented'));
  assert.ok(uncovered.assertions.some((a) => a.run === 'git ls-remote --heads origin' && a.stdout));
  assert.ok(uncovered.assertions.some((a) => a.file?.includes('review-requests') && /only .*adapter/.test(a.matches)));
  assert.doesNotMatch(JSON.stringify(uncovered), /Stopped/);
});

test('a later commit to the checks adapter keeps the stop', () => {
  const checks = byId.get('aw-ship-checks-uncovered');
  const edited = checks.setup.findIndex((op) => op.replace === 'docs/agents/checks.md');
  const reviewed = checks.setup.findIndex((op) => op.to === '.aw/reviews/29991231-235959-review.md');
  const committed = checks.setup.findIndex((op) => op.commit);
  assert.ok(reviewed !== -1 && reviewed < edited && edited < committed, 'the report must name the commit before the adapter change');
  assert.equal(checks.setup.filter((op) => op.replace || op.write).length, 1, 'the commit must change the checks adapter alone');
  assert.ok(checks.assertions.some((a) => a.frontmatter?.status === 'approved'));
  assert.ok(checks.assertions.some((a) => a.file === '.aw/drafts/*-push.md' && a.exists === false));
  assert.match(JSON.stringify(checks.assertions), /\/aw-review/);
});

// A fix-run case plants its defect in a commit and then writes a report, so that
// the report names HEAD and the defect is real at it.
function assertReportCopiedAfterCommit(fix) {
  const planted = fix.setup.findIndex((op) => op.commit);
  const reviewed = fix.setup.findIndex((op) => op.to === '.aw/reviews/29991231-235959-review.md');
  assert.ok(planted !== -1 && reviewed > planted, `${fix.id}: the report must name the commit that plants the defect`);
}

const oneCommitOnTop = (fix) => fix.assertions.some((a) => a.run === 'git log --format=%s -2' && a.stdout);

// The defect's own run, made again after the fix: a commit that only says it
// fixed the defect does not pass.
const defectIsGone = (fix) => fix.assertions.some((a) => a.run?.startsWith('node -e') && a.stdout);

test('a fix on the standard route fixes a defect no slice covers, and changes no marker', () => {
  const fix = byId.get('aw-build-fix-standard');
  assert.equal(fix.from.case, 'aw-review-route', 'every slice is done there');
  assertReportCopiedAfterCommit(fix);
  assert.ok(oneCommitOnTop(fix));
  assert.ok(defectIsGone(fix));
  assert.ok(fix.assertions.some((a) => a.run === 'git log -1 --format=%B' && /Fixes:/.test(a.stdout)));
  assert.ok(fix.assertions.some((a) => a.file === 'docs/specs/renew-loan/spec.md' && a.count === 0), 'every marker stays ticked');
  assert.ok(fix.assertions.some((a) => /--exit-code/.test(a.run ?? '') && /retry-delay/.test(a.run)), 'the risk is left alone');
  assert.match(readFileSync(join(skillDir, 'fixtures/review-introduced.md'), 'utf8'), /## Security\n\n### Defects introduced/);
});

test('a fix on the fast route writes every Done when line into its commit', () => {
  const fix = byId.get('aw-build-fix-fast');
  assertReportCopiedAfterCommit(fix);
  assert.ok(oneCommitOnTop(fix));
  assert.ok(defectIsGone(fix));
  const message = fix.setup.find((op) => op.commit).commit;
  assert.match(message, /\n\nDone when: /);
  assert.doesNotMatch(message, /member|personal/i, 'a criterion on personal data is refused off the fast route');
  assert.ok(fix.assertions.some((a) => a.run === 'git log -1 --format=%B' && /Done when:/.test(a.stdout)));
});

// A later review report must sort after the planted one, or the command would
// keep reading the planted one as the latest.
for (const [id, fixCommits] of [['aw-converge-clean', 1], ['aw-converge-limit', 3]]) {
  test(`${id} plants a report that a later review sorts after, and counts ${fixCommits} fix commit(s)`, () => {
    const converge = byId.get(id);
    const planted = converge.setup.findIndex((op) => op.commit);
    const reviewed = converge.setup.findIndex((op) => op.to === '.aw/reviews/20000101-000000-review.md');
    assert.ok(planted !== -1 && reviewed > planted, `${id}: the report must name the commit that plants the defect`);
    assert.doesNotMatch(converge.setup[planted].commit, /^[a-z]+(\([^)]*\))?: /, `${id}: the scratch app's commit convention forbids a type prefix, and a review would prove it`);
    assert.ok(converge.assertions.some((a) => a.run === 'git rev-list --count --grep=Fixes: HEAD' && a.stdout === `^${fixCommits}$`));
  });
}

test('aw-converge-limit has no verify skill, or a test that does not prove the criterion would stop round 1 at verify', () => {
  const limit = byId.get('aw-converge-limit');
  const removed = limit.setup.findIndex((op) => op.delete === '.claude/skills/verify-api');
  const reviewed = limit.setup.findIndex((op) => op.to === '.aw/reviews/20000101-000000-review.md');
  assert.ok(removed !== -1, 'the verify skill must be removed');
  assert.ok(limit.setup.slice(removed, reviewed).some((op) => op.commit), 'the run refuses uncommitted changes, so the removal must be committed before the report');
});

test('aw-converge-limit plants more independent defects than it has rounds, and its answer fixes one per round', () => {
  const limit = byId.get('aw-converge-limit');
  const message = limit.setup.find((op) => op.commit?.includes('Done when:')).commit;
  assert.ok(message.match(/^Done when: /gm).length > 3, 'with a criterion each, a review cannot group the defects, and a round cannot clear them');
  assert.match(limit.answers[0].intent, /first defect/);
  assert.ok(limit.assertions.some((a) => a.judge && /planted/.test(a.judge)), 'a limit reached on findings about the setup proves nothing');
});

test('aw-implement-clean ends with every slice ticked and no introduced defect', () => {
  const clean = byId.get('aw-implement-clean');
  assert.ok(clean.setup.some((op) => op.commit), 'the run refuses uncommitted changes, so the spec must be committed first');
  assert.ok(clean.assertions.some((a) => a.count === 0 && a.file === 'docs/specs/renew-loan/spec.md'), 'no unset marker is left');
  assert.ok(clean.assertions.some((a) => a.file === '.aw/reviews/*-review.md' && /0 introduced/.test(a.matches)));
  assert.ok(clean.assertions.some((a) => a.judge && /\/aw-ship/.test(a.judge)));
});

test('aw-implement-hitl turns the first slice HITL and checks it ran in the main session', () => {
  const hitl = byId.get('aw-implement-hitl');
  const planted = hitl.setup.find((op) => op.replace === 'docs/specs/renew-loan/spec.md');
  assert.match(planted.with, /HITL\.$/);
  assert.ok(hitl.setup.some((op) => op.commit));
  assert.ok(hitl.assertions.some((a) => a.judge && /main session/.test(a.judge)));
  assert.ok(hitl.assertions.some((a) => a.judge && /start of the run named/.test(a.judge)));
});

test('a stop and its relaunch: the same session goes on under a new journal heading', () => {
  const stop = byId.get('aw-implement-stop');
  const relaunch = byId.get('aw-implement-relaunch');
  assert.equal(relaunch.continues, 'aw-implement-stop');
  assert.ok(stop.assertions.some((a) => a.exists === false), 'the stopped build changes nothing');
  assert.ok(relaunch.assertions.some((a) => a.count === 2 && /##/.test(a.matches)), 'one heading per call');
  assert.ok(relaunch.assertions.some((a) => /Agreed seam/.test(a.matches ?? '')));
});

test('only the GitHub write case of #55 can reach GitHub: its issues are real and no restore point takes them back', () => {
  const route = cases.filter((c) => c.source.startsWith('#55'));
  const remotes = route.filter((c) => c.setup?.some((op) => op.remote));
  assert.deepEqual(remotes.map((c) => c.id), ['aw-wayfinder-github-write']);
});

test('the draft case leaves no tracker operation at write', () => {
  const draft = byId.get('aw-wayfinder-github-draft');
  const access = draft.setup.filter((op) => op.replace === 'docs/agents/tracker.md');
  assert.ok(access.some((op) => /Default access/.test(op.pattern)));
  assert.ok(access.some((op) => op.with === '`draft` |'), 'every row of the Operations table');
  assert.ok(draft.setup.at(-1).commit, 'the run must start from a clean tree');
});

test('every #55 case that installs dependencies from a ref starts where npm audit is clean', () => {
  const installs = cases.filter((c) => c.source.startsWith('#55') && c.from?.ref && c.shell.includes('npm ci'));
  assert.ok(installs.length > 0);
  for (const c of installs) assert.match(c.from.ref, /audit-fixed$/, c.id);
});

test('the fast merge runs on the real review: a pre-existing defect alone refuses it', () => {
  assert.equal(byId.get('aw-fast-merge-write').setup, undefined);
  assert.ok(byId.get('aw-fast-verified-review').assertions.some((a) => a.matches === 'Proven defects: 0 introduced, 0 pre-existing'));
});

test('the unproven merge plants its review report after the last commit, so that the report names HEAD', () => {
  const unproven = byId.get('aw-fast-merge-unproven');
  const lastCommit = unproven.setup.findLastIndex((op) => op.commit);
  const reviewed = unproven.setup.findIndex((op) => op.to === '.aw/reviews/29991231-235959-review.md');
  assert.ok(reviewed > lastCommit);
  assert.match(unproven.setup[lastCommit].commit, /\n\nDone when: [^\n]+\nTest exception: /);
  assert.equal(unproven.setup[reviewed].copy, 'fixtures/review-clean-fast.md');
  assert.match(readFileSync(join(skillDir, 'fixtures/review-clean-fast.md'), 'utf8'), /Proven defects: 0 introduced, 0 pre-existing/);
});

test('the map of the hand-off case clears with its one open ticket', () => {
  const read = (name) => readFileSync(join(skillDir, 'fixtures/wayfinder-map', name), 'utf8');
  const update = read('01-member-reservations.md').split('**Map update**')[1];
  assert.equal(update.match(/^- .*: grilling, blocked by none$/gm).length, 1);
  assert.match(update, /#### Not yet specified\n\nNone\./);
  assert.match(read('02-who-may-reserve.md'), /^Status: done$/m);
  assert.match(read('03-reservation-order.md'), /^Status: open$/m);
});

test('fixtures named by the case files exist', () => {
  for (const c of cases) {
    for (const op of c.setup ?? []) {
      if (op.copy) assert.ok(existsSync(join(skillDir, op.copy)), `${c.id}: ${op.copy}`);
    }
  }
});

test('no case file commits a local path of the maintainer\'s machine', () => {
  for (const c of cases) assert.doesNotMatch(JSON.stringify(c), /[A-Z]:\\\\|\/Users\//, c.id);
});

test('the skill stays out of the plugin and the kit tree', () => {
  const plugin = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.ok(!plugin.skills.some((path) => path.includes('uat')));
  assert.ok(!existsSync(join(repoRoot, 'skills', 'uat')));
});

test('the glossary defines the UAT terms', () => {
  const glossary = readFileSync(join(repoRoot, 'GLOSSARY.md'), 'utf8');
  for (const term of ['UAT case', 'UAT restore point', 'UAT conductor']) assert.match(glossary, new RegExp(`^\\*\\*${term}\\*\\*:`, 'm'), term);
});
