// The committed UAT case files: complete, and covering the #49 results.

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

// One entry per result line of the #49 comment, plus what it left unproven.
const EXPECTED = [
  'aw-setup-none', 'aw-setup-local', 'aw-setup-gitlab', 'aw-setup-other', 'aw-setup-github', 'aw-setup-node-warning', 'aw-setup-pocock',
  'aw-intake-bug', 'aw-intake-performance', 'aw-intake-refactor', 'aw-intake-investigation', 'aw-intake-feature',
  'aw-spec-approval-traps', 'aw-slices', 'aw-build-contradiction', 'aw-build-slice-1', 'aw-build-slice-2', 'aw-build-slice-3',
  'aw-verify-no-skill', 'aw-create-verify', 'aw-verify-generated', 'aw-review-route',
  'aw-ship-guard-failed', 'aw-ship-guard-inconclusive', 'aw-ship-default', 'aw-ship-write-uncovered', 'aw-ship-checks-uncovered', 'aw-ship-write', 'aw-ship-merge-write',
  'aw-review-planted', 'aw-ship-planted', 'aw-review-clean',
  'aw-retro-run', 'aw-retro-approval',
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
  assert.ok(uncovered.assertions.some((a) => a.file?.includes('review-requests') && /only adapters/.test(a.matches)));
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
