// The committed UAT case files: complete, and covering the #49 results and the
// routes #55 runs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { repoRoot, skillSection } from './fixtures.mjs';
import { skillDir } from './uat-fixtures.mjs';

const casesDir = join(skillDir, 'cases');
const cases = readdirSync(casesDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ name, ...JSON.parse(readFileSync(join(casesDir, name), 'utf8')) }))
  .sort((a, b) => a.order - b.order);
const byId = new Map(cases.map((c) => [c.id, c]));
const assertionNamed = (c, name) => c.assertions.find((a) => a.name === name);
const judgedText = (c) => c.assertions.filter((a) => a.judge).map((a) => a.judge).join('\n');

// One entry per result line of the #49 comment, plus what it left unproven, then
// the fast and epic routes of #55.
const EXPECTED = [
  'aw-setup-none', 'aw-setup-local', 'aw-setup-gitlab', 'aw-setup-other', 'aw-setup-github', 'aw-setup-node-warning', 'aw-setup-pocock',
  'aw-intake-bug', 'aw-intake-performance', 'aw-intake-refactor', 'aw-intake-investigation', 'aw-intake-feature',
  'aw-spec-approval-traps', 'aw-slices', 'aw-build-contradiction', 'aw-build-slice-1', 'aw-build-slice-2', 'aw-build-slice-3',
  'aw-verify-no-skill', 'aw-create-verify', 'aw-verify-generated', 'aw-review-route',
  'aw-ship-guard-failed', 'aw-ship-guard-inconclusive', 'aw-ship-default', 'aw-ship-write-uncovered', 'aw-ship-checks-uncovered', 'aw-ship-write', 'aw-ship-merge-write', 'aw-ship-merge-review-host',
  'aw-review-planted', 'aw-ship-planted', 'aw-review-clean',
  'aw-retro-run', 'aw-retro-approval',
  'aw-build-fix-standard', 'aw-build-fix-fast',
  'aw-converge-clean', 'aw-converge-limit',
  'aw-implement-clean', 'aw-implement-hitl', 'aw-implement-stop', 'aw-implement-relaunch',
  'aw-fast-build', 'aw-fast-verify-skipped', 'aw-fast-review', 'aw-fast-ship', 'aw-fast-build-repro-committed', 'aw-fast-ship-uncommitted',
  'aw-fast-verified-build', 'aw-fast-verified-verify', 'aw-fast-verified-review', 'aw-fast-merge-write', 'aw-fast-merge-unproven',
  'aw-intake-contract', 'aw-intake-stored-data', 'aw-intake-security', 'aw-build-refuses-contract',
  'aw-intake-spec-contradiction', 'aw-spec-change-contradicted', 'aw-build-spec-contradiction',
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

test('after a local merge, the body\'s rollback plan names the merge commit; a drafted merge leaves the placeholder', () => {
  for (const id of ['aw-ship-merge-write', 'aw-fast-merge-write']) {
    const checks = byId.get(id).assertions;
    assert.ok(checks.some((a) => a.run === 'node {{KIT}}/.claude/skills/uat/scripts/rollback-names-merge.mjs'), id);
  }
  const drafted = byId.get('aw-fast-merge-unproven').assertions.filter((a) => a.file === '.aw/review-requests/*-review-request.md');
  assert.ok(drafted.some((a) => a.matches === 'git revert -m 1 <merge commit>' && a.count === undefined), 'the drafted merge keeps the placeholder');
});

test('the fast merge judges that each introduced risk is merged without acceptance, never ticked, and named in the chat report', () => {
  const judged = judgedText(byId.get('aw-fast-merge-write'));
  assert.match(judged, /introduced-risk item/);
  assert.match(judged, /merged without a person's acceptance/);
  assert.match(judged, /not ticked/);
  assert.match(judged, /chat report names each introduced risk/);
});

// At merge: write with a review host, aw-ship merges the review request on the
// host and leaves its body as step 5 wrote it (#128, #129). The merge lands on
// the GitHub scratch repo, on a base branch of the case's own.
const hostMerge = byId.get('aw-ship-merge-review-host');
const HOST_BASE = 'uat/ship-review-host';
const hostRun = (field) => `gh pr view feat/renew-loan --json ${field} --jq .${field}`;
const readFixture = (path) => readFileSync(join(skillDir, path), 'utf8').replaceAll('\r\n', '\n');

// The words step 5 writes in each introduced-risk item for a review host at
// merge: write, taken from the skill so that the case follows it.
const hostRiskWording = skillSection('aw-ship', '### 5. Write the review request body', '### 6. Push and open the review request')
  .split('\n')
  .find((line) => line.startsWith('- **With a review host at `merge: write`:**'))
  .match(/"([^"]+)"\.$/)[1];

test('the review-host merge sits next to the local one, on its restore point', () => {
  const local = byId.get('aw-ship-merge-write');
  assert.equal(hostMerge.group, local.group);
  assert.equal(hostMerge.order, local.order + 1);
  assert.deepEqual(hostMerge.from, local.from);
  assert.equal(hostMerge.command, '/ai-workflow:aw-ship');
});

test('the review-host merge points origin at the scratch repo, with GitHub at write and merge commits into a base of its own', () => {
  assert.ok(hostMerge.setup.some((op) => op.remote === 'https://github.com/samfaina/aw-scratch.git'));
  const adapter = hostMerge.setup.find((op) => op.to === 'docs/agents/vcs.md');
  const vcs = readFixture(adapter.copy);
  assert.ok(vcs.includes(`- **Base branch:** \`${HOST_BASE}\``), vcs);
  assert.match(vcs, /- \*\*Review host:\*\* pull requests on GitHub/);
  assert.ok(vcs.includes(`\`gh pr create --base ${HOST_BASE} --head <branch>`), 'the review request targets the case\'s base');
  assert.ok(vcs.includes('| `merge` | `gh pr merge <n> --merge` | `write` |'), 'a merge commit, so the rollback plan reverts it with -m 1');
  for (const op of ['push', 'open-review']) assert.match(vcs, new RegExp(`^\\| \`${op}\` \\|.*\\| \`write\` \\|$`, 'm'), op);
  assert.doesNotMatch(vcs, /\| `draft` \|/);
  assert.doesNotMatch(vcs, /\{\{/, 'no unfilled template placeholder');
  const agents = hostMerge.setup.find((op) => op.replace === 'AGENTS.md');
  assert.ok(agents.with.includes(HOST_BASE) && /GitHub/.test(agents.with), agents.with);
});

test('the review-host merge resets its base and drops the work branch on the host before each run, so a rerun starts clean', () => {
  const reset = hostMerge.shell.findIndex((line) => line === `git push --force origin main:refs/heads/${HOST_BASE} HEAD:refs/heads/feat/renew-loan`);
  const dropped = hostMerge.shell.indexOf('git push origin --delete feat/renew-loan');
  assert.ok(reset !== -1 && dropped > reset, 'the delete never fails: the reset has just created the branch');
  assert.match(hostMerge.source, new RegExp(`${HOST_BASE}.*rerun`), 'the case says how a rerun starts clean');
});

test('the review-host merge plants a report with no proven defect and an introduced risk, after the last commit', () => {
  const lastCommit = hostMerge.setup.findLastIndex((op) => op.commit);
  const reviewed = hostMerge.setup.findIndex((op) => op.to === '.aw/reviews/29991231-235959-review.md');
  assert.ok(reviewed > lastCommit, 'the report must name HEAD');
  const report = readFixture(hostMerge.setup[reviewed].copy);
  assert.match(report, /Proven defects: 0 introduced, 0 pre-existing/);
  assert.match(report, /### Risks introduced\n\n\*\*[^*]+\*\*/);
  assert.match(report, new RegExp(`- Diff base: ${HOST_BASE}`));
});

test('the review-host merge checks the request merged on the host, and the body keeps the placeholder and the wording for either merger', () => {
  const checks = hostMerge.assertions;
  assert.ok(checks.some((a) => a.run === hostRun('state') && a.stdout === '^MERGED$'), 'merged on the host');
  assert.ok(checks.some((a) => a.run === hostRun('baseRefName') && a.stdout === `^${HOST_BASE}$`), 'into the case\'s base');
  assert.ok(checks.some((a) => a.run === 'git branch --merged main --list feat/renew-loan' && a.stdout === '^$'), 'never merged locally');
  assert.ok(!checks.some((a) => /rollback-names-merge/.test(a.run ?? '')), 'nothing fills in the placeholder');

  const report = readFixture(hostMerge.setup.find((op) => op.to === '.aw/reviews/29991231-235959-review.md').copy);
  const risks = report.split('### Risks introduced').slice(1).join('').match(/^\*\*/gm).length;
  const body = checks.filter((a) => a.file === '.aw/review-requests/*-review-request.md');
  assert.ok(body.some((a) => a.matches === 'git revert -m 1 <merge commit>'), 'the body keeps the placeholder');
  assert.ok(body.some((a) => a.matches === hostRiskWording && a.count === risks), 'one item per introduced risk, in step 5\'s words');
  const onHost = checks.filter((a) => a.run === hostRun('body'));
  assert.ok(onHost.some((a) => a.stdout === 'git revert -m 1 <merge commit>'), 'the request on the host keeps the placeholder');
  assert.ok(onHost.some((a) => a.stdout === hostRiskWording), 'the request on the host words each risk for either merger');

  const judged = judgedText(hostMerge);
  assert.match(judged, /not ticked/);
  assert.match(judged, /never asked the user to accept a risk/);
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

// A spec contradiction (#111): the due-day fee, against the renew-loan spec that
// uat/audit-fixed holds at implemented.
test('intake catches the due-day fee as a spec contradiction of renew-loan', () => {
  const intake = byId.get('aw-intake-spec-contradiction');
  assert.equal(intake.from.ref, 'uat/audit-fixed', 'the renew-loan spec is implemented there');
  assert.match(intake.command, /vencimiento/);
  assert.ok(intake.assertions.some((a) => a.run === 'git status --porcelain' && a.stdout === '^$'));
  const judged = judgedText(intake);
  assert.match(judged, /Type: feature \(reported as a bug\)/);
  assert.match(judged, /Route: standard/);
  assert.match(judged, /renew-loan/);
  assert.match(judged, /AC-\d/);
  assert.match(judged, /\/aw-spec/);
});

test('aw-spec, run after that report, sets renew-loan back to draft and starts no new spec', () => {
  const spec = byId.get('aw-spec-change-contradicted');
  assert.equal(spec.continues, 'aw-intake-spec-contradiction');
  assert.ok(spec.assertions.some((a) => a.file === 'docs/specs/renew-loan/spec.md' && a.frontmatter?.status === 'draft'));
  assert.ok(spec.assertions.some((a) => a.run?.includes("readdirSync('docs/specs')") && a.stdout === String.raw`^renew-loan\s*$`));
});

test("aw-build stops on a spec contradiction that shows only during the build, and leaves the branch's commits alone", () => {
  const build = byId.get('aw-build-spec-contradiction');
  assert.equal(build.from.ref, 'uat/audit-fixed');
  assert.match(build.from.branch, /\//, 'a work branch');
  const commits = build.setup.filter((op) => op.commit);
  assert.equal(commits.length, 1);
  assert.match(commits[0].commit, /\n\nDone when: /);
  assert.ok(!build.setup.some((op) => /docs\/specs/.test(op.write ?? op.replace ?? op.to ?? '')), 'the commit is on the fast route');
  const subject = commits[0].commit.split('\n')[0];
  assert.ok(build.assertions.some((a) => a.run === 'git log --format=%s -1' && a.stdout === `^${subject}$`), 'no commit is made');
  assert.ok(build.assertions.some((a) => a.run === 'git rev-list --count main..HEAD' && a.stdout === '^1$'), 'the commit is kept');
  const judged = judgedText(build);
  assert.match(judged, /renew-loan/);
  assert.match(judged, /AC-\d/);
  assert.match(judged, /\/aw-intake/);
  assert.match(judged, /named the branch and its commit/);
});

test('the fast route with a verify skill fixes a real bug that contradicts no spec', () => {
  const group = cases.filter((c) => c.group === 'Fast route, with a verify skill');
  assert.deepEqual(group.map((c) => c.id), ['aw-fast-verified-build', 'aw-fast-verified-verify', 'aw-fast-verified-review', 'aw-fast-merge-write', 'aw-fast-merge-unproven']);
  for (const c of group) {
    assert.doesNotMatch(JSON.stringify(c), /vencimiento|due[- ]day|renew-loan|\/aw-spec/i, c.id);
    assert.ok(!c.answers.some((answer) => answer.drift), `${c.id}: a drift answer about the old bug`);
  }
  assert.match(byId.get('aw-fast-verified-build').command, /\/stats\/popular/);
});

// #114: a bug's reproduction ends the fast build committed or deleted, and the
// review request cites no test that is absent from the diff and the base.

// Runs a case's command in a working copy and returns its exit status and
// trimmed stdout.
function spawnIn(workdir, command) {
  const result = spawnSync(command, { cwd: workdir, shell: true, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

// As spawnIn, for a command that must succeed: returns its trimmed stdout.
function runIn(workdir, command) {
  const result = spawnIn(workdir, command);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

// Runs a case's command in a working copy whose .aw/ holds the given files.
function runWithAw(command, files) {
  const workdir = mkdtempSync(join(tmpdir(), 'uat-aw-'));
  try {
    for (const file of files) {
      mkdirSync(dirname(join(workdir, '.aw', file)), { recursive: true });
      writeFileSync(join(workdir, '.aw', file), '');
    }
    return runIn(workdir, command);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

test('aw-fast-build checks that no runnable reproduction is left in .aw/ after the build', () => {
  const build = byId.get('aw-fast-build');
  const left = build.assertions.find((a) => a.name === 'no reproduction left in .aw/');
  assert.ok(left, 'no assertion on what the build left in .aw/');
  assert.equal(left.stdout, '^$');
  assert.match(runWithAw(left.run, ['repro/due-day/fees.test.ts', 'reviews/r.md']), /repro\/due-day\/fees\.test\.ts/);
  assert.match(runWithAw(left.run, ['scratch/fees.spec.ts']), /scratch\/fees\.spec\.ts/);
  assert.equal(runWithAw(left.run, ['reviews/r.md', 'verify/v.md']), '');
  assert.equal(runWithAw(left.run, []), '');
  assert.ok(build.assertions.some((a) => a.judge && /reproduction/.test(a.judge) && /committed test/.test(a.judge) && /deleted/.test(a.judge)));
});

// #115: intake's report, not only the build's, must leave /aw-verify out of its
// Next line in a repo with no verify skill.
test("aw-fast-build judges that intake's Next line does not name /aw-verify, since the repo has no verify skill", () => {
  const build = byId.get('aw-fast-build');
  assert.equal(build.group, 'Fast route, no verify skill');
  const judged = build.assertions.filter((a) => a.judge).map((a) => a.judge);
  assert.ok(
    judged.some((j) => /^Intake's `Next:` line does not name \/aw-verify/.test(j) && /no verify skill/.test(j)),
    judged.join('\n'),
  );
});

test('aw-fast-ship checks that no Criteria line cites a test absent from the diff and the base', () => {
  const ship = byId.get('aw-fast-ship');
  const judged = judgedText(ship);
  assert.match(judged, /No `- \*\*Criteria:\*\*` line cites as evidence a test that is absent from both the diff and the base/);
  assert.ok(ship.assertions.some((a) => a.file === '.aw/review-requests/*-review-request.md' && a.matches === String.raw`\.aw/repro/` && a.count === 0));
});

// #119: the two #114 behaviours that the cases above never reach.

// Runs a case's command in a git repo whose origin/main is an empty commit and
// whose HEAD adds the given files on top of it, with the given message, and
// returns the command's exit status and trimmed stdout.
function spawnOnCommit(command, files, message = 'build') {
  const workdir = mkdtempSync(join(tmpdir(), 'uat-git-'));
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.name=uat', '-c', 'user.email=uat@example.invalid', ...args], { cwd: workdir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const commit = (message) => git('commit', '--quiet', '--allow-empty', '-m', message);
  try {
    git('init', '--quiet');
    commit('base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(workdir, file)), { recursive: true });
      writeFileSync(join(workdir, file), text);
    }
    git('add', '--all');
    commit(message);
    return spawnIn(workdir, command);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

// As spawnOnCommit, for a command that must succeed: returns its trimmed stdout.
function runOnCommit(command, files) {
  const result = spawnOnCommit(command, files);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("a fast build whose seam answer takes the reproduction's seam commits the reproduction outside .aw/", () => {
  const committedRepro = byId.get('aw-fast-build-repro-committed');
  const build = byId.get('aw-fast-build');
  assert.ok(committedRepro, 'no case where the build commits the reproduction');
  assert.equal(committedRepro.group, 'Fast route, no verify skill');
  assert.deepEqual(committedRepro.from, build.from);
  assert.equal(committedRepro.command, build.command, 'the same due-day fee task');
  const seam = committedRepro.answers.find((answer) => /seam/i.test(answer.when));
  assert.match(seam.intent, /when it also proposes the seam the reproduction exercises, the fees endpoint, take that seam too/, 'the build, not the answer, proposes the endpoint');
  assert.doesNotMatch(seam.intent, /keep only the unit seam/);

  const committed = assertionNamed(committedRepro, 'the reproduction is a committed test outside .aw/');
  assert.ok(committed, 'no assertion that the reproduction is committed');
  const committedIn = (files) => new RegExp(committed.stdout, 'm').test(runOnCommit(committed.run, files));
  assert.ok(committedIn({ 'tests/fees-endpoint.test.ts': 'const res = await request(app).get("/members/ada/fees");\n' }));
  assert.ok(committedIn({ 'tests/fees-endpoint.test.ts': 'it("done when: GET /members/ada/fees da 0", async () => {\n  const res = await fetch(base + "/members/ada/fees");\n' }));
  assert.ok(!committedIn({ 'tests/fees.test.ts': 'import { lateFeeCents } from "../src/fees.js";\nconst loan = { member: "ada" };\n' }), 'a unit test alone is not the reproduction');
  assert.ok(!committedIn({ 'tests/fees.test.ts': '  it("done when: GET /members/ada/fees da 0", () => {\n    expect(lateFeeCents(loan, "2026-11-01")).toBe(0);\n' }), 'a unit test named after the criterion is not the reproduction');
  assert.ok(!committedIn({ 'tests/members/fees.test.ts': 'expect(lateFeeCents(loan, "2026-11-01")).toBe(0);\n' }), 'a path is not a request');
  assert.ok(!committedIn({ 'src/routes.ts': 'app.get("/members/:member/fees", handler);\n' }), 'a test outside tests/ is not counted');

  assert.deepEqual(assertionNamed(committedRepro, 'no reproduction left in .aw/'), assertionNamed(build, 'no reproduction left in .aw/'));
  assert.ok(committedRepro.assertions.some((a) => a.run === 'npm test'), 'the tests pass');
  const judged = judgedText(committedRepro);
  assert.match(judged, /fees endpoint/);
  assert.match(judged, /committed/);
  assert.match(judged, /not .*deleted/);
});

test('a ship whose full run picks up a test under .aw/repro/ marks it uncommitted and counts it for no criterion', () => {
  const ship = byId.get('aw-fast-ship-uncommitted');
  assert.ok(ship, "no case for ship's uncommitted marking");
  assert.equal(ship.group, 'Fast route, no verify skill');
  assert.equal(ship.from.case, 'aw-fast-review', 'a built and reviewed branch');
  assert.match(ship.command, /^\/ai-workflow:aw-ship$/);
  const file = '.aw/repro/due-day/fees.test.ts';
  const written = ship.shell.find((line) => line.includes(file));
  assert.ok(written, `the shell writes no ${file}`);
  assert.match(written, /from "vitest"/, 'the file is a test the full check runs');

  const matches = (assertion, text) => new RegExp(assertion.matches, 'gm').test(text);
  const checks = assertionNamed(ship, 'the Checks line notes the uncommitted test');
  assert.equal(checks.file, '.aw/review-requests/*-review-request.md');
  assert.ok(matches(checks, `- **Checks:** \`npm test\` passed at abc1234. The local run included uncommitted test files \`${file}\`.`));
  assert.ok(!matches(checks, '- **Checks:** `npm test` passed at abc1234.'));
  assert.ok(!matches(checks, `- **Criteria:**\n  - returned on the due date: \`${file}\` (uncommitted, not counted)`), 'only the Checks line counts');

  const criteria = assertionNamed(ship, 'the Criteria line marks the uncommitted test');
  assert.equal(criteria.file, '.aw/review-requests/*-review-request.md');
  // The Evidence section of a review request, with the given Criteria line,
  // and the marking once more in the section after it.
  const evidence = (criteriaLine) => `## Evidence\n\n- **Checks:** \`npm test\` passed at abc1234.\n${criteriaLine}\n\n## Merge Danger\n\n**Door:** two-way, as \`${file}\` (uncommitted, not counted) stays local.\n`;
  assert.ok(matches(criteria, evidence(`- **Criteria:** returned on the due date: \`tests/fees.test.ts\`; \`${file}\` (uncommitted, not counted)`)));
  assert.ok(matches(criteria, evidence(`- **Criteria:**\n  - returned early: \`tests/fees.test.ts\`\n  - returned on the due date: \`tests/fees.test.ts\`; \`${file} (uncommitted, not counted)\``)));
  assert.ok(!matches(criteria, evidence(`- **Criteria:** returned on the due date: \`${file}\``)), 'cited as evidence, unmarked, and marked only outside the Criteria line');
  assert.ok(!matches(criteria, `- **Checks:** included \`${file}\` (uncommitted, not counted)`), 'the Checks line is not the Criteria line');

  assert.match(judgedText(ship), /No criterion is proven only by/);
});

// #123: on the fast route each done-when test name quotes its criterion whole,
// in intake's words and language.
test("aw-fast-verified-build checks that each done when: test name quotes a Done when: line of the commit, verbatim", () => {
  const build = byId.get('aw-fast-verified-build');
  const namesCheck = assertionNamed(build, 'each done when: test name quotes a Done when: line verbatim');
  assert.ok(namesCheck, 'no assertion on the done when: test names');
  const seam = build.answers.find((answer) => /seam/i.test(answer.when));
  assert.match(seam.intent, /when it also proposes a seam for a part of a criterion the unit test cannot reach, decline it and keep only the unit seam/, 'the build, not the answer, proposes the wider seam');
  assert.match(judgedText(build), /a `Test exception:` line that names that part/);
  const command = namesCheck.run.replaceAll('{{KIT}}', repoRoot.replaceAll('\\', '/'));
  const criteria = [
    'Done when: `GET /stats/popular` lista solo los libros con algún préstamo, de más a menos préstamos, en ese orden.',
    'Done when: sin préstamos, `popularBooks` devuelve `[]`.',
  ];
  const message = ['fix: popular books list unborrowed books', '', ...criteria].join('\n');
  // A test file whose tests are named by the given source literals.
  const testFile = (...tests) => ({ 'tests/stats.test.ts': tests.map((name) => `  it(${name}, () => {});\n`).join('') });
  const check = (files) => spawnOnCommit(command, files, message);

  const whole = check(testFile(
    '"done when: `GET /stats/popular` lista solo los libros con algún préstamo, de más a menos préstamos, en ese orden."',
    "'done when: sin préstamos, `popularBooks` devuelve `[]`.'",
  ));
  assert.equal(whole.status, 0, whole.stdout);
  assert.equal(whole.stdout, '');
  assert.equal(check(testFile('`done when: sin préstamos, \\`popularBooks\\` devuelve \\`[]\\``')).status, 0, 'a template literal, with no final period');
  assert.equal(check(testFile('"done when: sin préstamos, `popularBooks` devuelve `[]`. (unit seam)"')).status, 0, 'a suffix that names the part');
  assert.equal(check(testFile('"done when: sin préstamos, `popularBooks` devuelve `[]`: unit seam"')).status, 0, 'a suffix after a colon');
  assert.equal(check({ ...testFile('"done when: sin préstamos, `popularBooks` devuelve `[]`."'), 'docs/notes.md': '- `done when: popular lists only borrowed books`\n' }).status, 0, 'a file that is not a test');

  const paraphrase = check(testFile('"done when: popular books lists only borrowed books"'));
  assert.notEqual(paraphrase.status, 0, 'an English paraphrase');
  assert.match(paraphrase.stdout, /done when: popular books lists only borrowed books/);
  assert.notEqual(check(testFile('"done when: `GET /stats/popular` lista solo los libros con algún préstamo, de más a menos préstamos"')).status, 0, 'a dropped clause');
  assert.notEqual(check(testFile('"done when: sin préstamos, `popularBooks` devuelve un array vacío"')).status, 0, 'a reworded criterion');
  assert.notEqual(check(testFile('"stats lists the most borrowed books"')).status, 0, 'no done when: test name at all');
  assert.notEqual(spawnOnCommit(command, testFile('"done when: sin préstamos, `popularBooks` devuelve `[]`."')).status, 0, 'a commit with no Done when: lines');
});
