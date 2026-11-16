// Seam 4: the fast route's public contract, the text aw-intake classifies from
// and the text aw-build refuses from. These tests hold the contract ticket #64
// names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './fixtures.mjs';

function skillText(skill) {
  return readFileSync(join(repoRoot, 'skills', skill, 'SKILL.md'), 'utf8');
}

function repoFile(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function skillLine(skill, start) {
  const line = skillText(skill).split('\n').find((candidate) => candidate.startsWith(start));
  assert.ok(line, `${skill} has no line starting "${start}"`);
  return line;
}

const intakeDefinition = skillLine('aw-intake', '- **fast**:');
const buildRefusal = skillLine('aw-build-steps', 'Refuse to go on, and tell the user to run `/aw-intake` again');
const buildMidBuildStop = skillLine('aw-build-steps', 'When building shows that a done-when criterion is wrong');

test('the Standards axis does not prove as a breach the criterion a test name must quote', () => {
  assert.match(skillLine('aw-build-steps', '- Name each test so that it quotes the criterion'), /quotes the criterion/);
  assert.match(skillText('aw-review-steps'), /A test name that quotes a done-when criterion keeps the criterion's words/);
});

test('the Spec axis keeps scope creep a risk unless a run shows it breaks something', () => {
  const review = skillText('aw-review-steps');
  assert.match(review, /Scope creep is a risk, even when a run shows the change is in the diff/);
  assert.match(review, /It is a defect only when a run shows it breaks a criterion or a check/);
});

// Each Ask First item of aw-security-and-hardening, and the wording that names
// the work behind it.
const askFirstWording = [
  ['Adding new authentication flows or changing auth logic', /authentication/],
  ['Storing new categories of sensitive data (PII, payment info)', /stored data/],
  ['Adding new external service integrations', /a new external service integration/],
  ['Changing CORS configuration', /CORS/],
  ['Adding file upload handlers', /input from outside/],
  ['Modifying rate limiting or throttling', /rate limiting or throttling/],
  ['Granting elevated permissions or roles', /permissions/],
];

test('every Ask First item has its wording here', () => {
  const lines = skillText('aw-security-and-hardening').split('\n');
  const start = lines.indexOf('### Ask First');
  const end = lines.indexOf('### Never Do');
  const items = lines
    .slice(start, end)
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).replace(' **(web)**', ''));
  assert.deepEqual(items, askFirstWording.map(([item]) => item));
});

for (const [skill, text] of [['aw-intake', intakeDefinition], ['aw-build-steps', buildRefusal]]) {
  for (const [item, wording] of askFirstWording) {
    test(`${skill} keeps "${item}" off the fast route`, () => {
      assert.match(text, wording);
    });
  }

  test(`${skill} keeps adding a dependency off the fast route`, () => {
    assert.match(text, /adding a dependency/);
  });

  test(`${skill} keeps a change to how personal data is collected, handled or shared off the fast route`, () => {
    assert.match(text, /how personal data is collected, handled or shared/);
  });

  test(`${skill} says upgrading an existing dependency does not keep a task off the fast route on its own`, () => {
    assert.match(
      skillText(skill),
      /Upgrading an existing dependency does not, on its own, keep a task off the fast route, major versions included/,
    );
  });
}

test('aw-intake says a fast-route diff still goes through the Security axis', () => {
  assert.match(skillText('aw-intake'), /A fast-route diff still goes through `aw-review`'s Security axis/);
});

// What a skill lists in parentheses in its contract and security rules, so that
// an item added to one skill alone fails.
function excludedWork(text) {
  const contract = text.match(/contract \(([^)]*)\)/);
  const security = text.match(/security-related \(([^)]*)\)/);
  assert.ok(contract && security, `no contract or security list in: ${text}`);
  return { contract: contract[1], security: security[1] };
}

test('aw-build refuses the same work aw-intake keeps off the fast route', () => {
  assert.deepEqual(excludedWork(buildRefusal), excludedWork(intakeDefinition));
});

test('a done-when criterion is behaviour a run can show, never a doc, a test edit or a check', () => {
  const never = /never a doc's wording, an edit to an existing test or a check passing/i;
  assert.match(skillText('aw-intake'), /Each one states behaviour of the code that a run can show/);
  assert.match(skillText('aw-intake'), never);
  assert.match(repoFile('GLOSSARY.md'), /A doc's wording, an edit to an existing test or a check passing is never one/);
  const explore = skillLine('aw-build-steps', '**Step 3: explore the task.**');
  assert.match(explore, /states behaviour a run can show, as `\/aw-intake` defines it/);
  assert.match(explore, /go to \*\*When the criteria are wrong\*\*/);
});

test("aw-build writes manual: for a test exception the verify skill's feature map cannot reach", () => {
  assert.match(skillText('aw-build-steps'), /`manual:`, naming what to check by hand, when it has none or its feature map cannot/);
});

test("aw-build's stop during the build applies the same refusal", () => {
  assert.match(buildMidBuildStop, /needs a change Step 1 refuses/);
});

// A spec contradiction (#111): a task that asks for behaviour other than what an
// approved or implemented spec states as intended takes the standard route.

test('the fast route needs no spec contradiction', () => {
  assert.match(intakeDefinition, /no spec contradiction/);
});

test('intake looks for a spec contradiction in the specs whose Traceability points at what the task touches', () => {
  const explore = skillLine('aw-intake', 'Read the specs under `docs/specs/`');
  assert.match(explore, /`status: approved` or `implemented`/);
  assert.match(explore, /whose Traceability points at the tests or code the task touches/);
  assert.match(explore, /against their `AC-n`/);
  assert.match(explore, /Ignore `draft` and `superseded` specs/);
});

// The wording intake reports a spec contradiction in, which aw-build repeats.
const contradictionType = '**Type:** feature (reported as a bug), because spec `<slug>` states it as intended: <AC-n, quoted>. Changing it changes intended behaviour, which is not a bug.';
const contradictionRoute = '**Route:** standard, because the change contradicts spec `<slug>`, which changes through `/aw-spec`.';

test('intake reports a spec contradiction as a feature on the standard route, quoting the spec and the criterion', () => {
  const lines = skillText('aw-intake').split('\n');
  assert.ok(lines.includes(contradictionType));
  assert.ok(lines.includes(contradictionRoute));
  assert.match(skillText('aw-intake'), /A spec contradiction is a \*\*feature\*\*, even when it is reported as a bug/);
});

test('a bug whose fix makes a spec true again is not a spec contradiction, and may stay fast', () => {
  assert.match(
    skillText('aw-intake'),
    /A bug where the code differs from what a spec states is not a spec contradiction: fixing it makes the spec true again, and the task may stay on the fast route/,
  );
});

test("intake's Next names /aw-spec with the contradicted spec", () => {
  assert.match(skillLine('aw-intake', '- **standard**: `/aw-spec`'), /for a spec contradiction, `\/aw-spec docs\/specs\/<slug>\/spec\.md`, which changes that spec/);
});

test('aw-spec changes the spec an intake report names as contradicted, and starts no new slug', () => {
  const start = skillLine('aw-spec', 'Take the task, its type, its route');
  assert.match(start, /When intake's report names a spec contradiction, or the user names an existing spec, go to \*\*Changing a spec\*\* below for that spec/);
  const changing = skillLine('aw-spec', 'A spec is a living document');
  assert.match(changing, /set it back to `status: draft`/);
  assert.match(changing, /keeps its slug and its folder: step 4 edits it in place and chooses no new slug/);
});

test('aw-build refuses a spec contradiction on the fast route, in the wording intake reports it in', () => {
  const stop = skillLine('aw-build-steps', '**A spec contradiction.**');
  assert.match(stop, /commit nothing/);
  assert.match(stop, /spec `<slug>` states it as intended: <AC-n, quoted>/);
  assert.match(stop, /run `\/aw-intake` again/);
  assert.match(stop, /name the branch and those commits, and leave them as they are: delete and reuse nothing/);
  assert.match(buildRefusal, /a spec contradiction/);
  assert.match(buildMidBuildStop, /is a spec contradiction/);
  assert.match(buildMidBuildStop, /stop as \*\*A spec contradiction\*\* in Step 1 says/);
});

test('aw-build looks for a spec contradiction the way intake does', () => {
  const explore = skillLine('aw-build-steps', '**Step 3: explore the task.**');
  assert.match(explore, /the specs with `status: approved` or `implemented` whose Traceability points at the tests or code the task touches/);
});

// The fast-route recognition rule every phase after intake reads the branch by.
const recognisers = ['aw-build-steps', 'aw-verify-steps', 'aw-review-steps', 'aw-ship', 'aw-implement'];

for (const skill of recognisers) {
  test(`${skill} still recognises a fast-route change that edits only a spec's Traceability`, () => {
    assert.match(skillText(skill), /`Done when:` lines[^.]*and change no spec outside its Traceability section/);
    assert.doesNotMatch(skillText(skill), /touch(es)? no spec under/);
  });
}

test("a fast-route build may edit a spec's Traceability, only that section, and checks each spec it edits", () => {
  const traceability = skillLine('aw-build-steps', "**Step 6: a spec's Traceability, and nothing else.**");
  assert.match(traceability, /may edit a spec's Traceability section, and only that section, to keep its evidence pointing at the right files/);
  assert.match(traceability, /Call the Skill tool with "aw-check-spec" on each spec it edits this way/);
});

test("no skill or ADR names a spec contradiction by one of the glossary's Avoid terms", () => {
  const avoid = repoFile('GLOSSARY.md').match(/\*\*Spec contradiction\*\*:\n[^\n]*\n_Avoid_: ([^\n]*)/)[1].split(', ');
  assert.ok(avoid.length > 0);
  const files = [
    ...readdirSync(join(repoRoot, 'skills')).map((skill) => join(repoRoot, 'skills', skill, 'SKILL.md')),
    ...readdirSync(join(repoRoot, 'docs', 'adr')).map((adr) => join(repoRoot, 'docs', 'adr', adr)),
  ];
  for (const file of files) {
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const term of avoid) assert.ok(!text.includes(term), `${file} says "${term}"`);
  }
});

// A bug's reproduction (#114): build promotes it to a committed test at an
// agreed seam or deletes it, and ship counts only committed tests as evidence.

const reproduction = skillLine('aw-build-steps', '- **The reproduction.**');

test("on the fast route a bug's reproduction ends the build as a committed test at an agreed seam, or deleted from .aw/", () => {
  assert.match(reproduction, /A bug's reproduction ends the build as a committed test at an agreed seam, or deleted from `\.aw\/`/);
  assert.match(reproduction, /The build never leaves a runnable test file in `\.aw\/` after its commit/);
});

test('the build report names a deleted reproduction and the behaviour no committed test now covers', () => {
  assert.match(reproduction, /delete the reproduction's files from `\.aw\/` and name it in step 8/);
  const report = skillLine('aw-build-steps', '**Step 8: report each criterion.**');
  assert.match(report, /When step 4 deleted a bug's reproduction, name its file and the behaviour it exercised that no committed test now covers/);
});

test('when the agreed seams do not reach the reproduction, build proposes its seam in the one seam question, hitl and afk', () => {
  assert.match(reproduction, /When no agreed seam reaches that behaviour[^.]*, propose the reproduction's seam as an additional one in the seam question above/);
  assert.match(reproduction, /In the `afk` variant, propose it in the `Question:` line of `Stop: seam to agree`, even when the arguments' `agreed seams:` cover every criterion, unless they say the user declined it/);
});

test('aw-ship proves a fast-route criterion only by a committed test, never an uncommitted one', () => {
  const condition = skillLine('aw-ship', '3. **The spec is proven.**');
  assert.match(condition, /proven by a test committed on the work branch or present on the base that passed in step 3's run/);
  assert.match(condition, /A test file that is not committed is never evidence, even when step 3's run ran it/);
  assert.match(skillLine('aw-ship', '- on the standard and epic routes, the spec is `implemented`'), /proven by a committed test, a verify result or a check by hand/);
});

test("aw-ship's review request marks an uncommitted test on its Criteria line and notes it on its Checks line", () => {
  assert.match(skillLine('aw-ship', '- **Criteria:**'), /An uncommitted test file that touches the criterion appears as `<file> \(uncommitted, not counted\)`/);
  assert.match(skillLine('aw-ship', '- **Checks:**'), /<The local run included uncommitted test files <files>, when step 3 found any\.>/);
  const step3 = skillText('aw-ship').split('\n### ').find((section) => section.startsWith('3. Run the full check level'));
  assert.match(step3, /the test files it ran, from its whole output, that `git cat-file -e HEAD:<file>` does not find/);
  assert.match(step3, /When the output names no files, check each untracked or ignored file `git status --porcelain --ignored` lists against the files the project's test configuration selects/);
});

test('aw-build-steps, aw-ship, aw-intake, its pre-steps and the glossary name no test runner and no glob', () => {
  const texts = [skillText('aw-build-steps'), skillText('aw-ship'), skillText('aw-intake'), repoFile('skills/aw-intake/PRE-STEPS.md'), repoFile('GLOSSARY.md')];
  for (const text of texts) assert.doesNotMatch(text, /vitest|jest|mocha|pytest|\*\*\/|\*\.test\./i);
});

test("intake's bug pre-step writes the reproduction under .aw/ and says it lasts until aw-build promotes or deletes it", () => {
  const bug = repoFile('skills/aw-intake/PRE-STEPS.md').split('\n## ').find((section) => section.startsWith('Bug: reproduce'));
  assert.ok(bug, 'PRE-STEPS.md has no "Bug: reproduce" section');
  assert.match(bug, /When the red command runs a test file, write it under `\.aw\/repro\/<slug>\/` and commit nothing/);
  assert.match(bug, /It is temporary: `aw-build` turns it into a committed test at an agreed seam or deletes it/);
  assert.match(repoFile('GLOSSARY.md'), /\*\*Reproduction\*\*:\nThe one command a bug's pre-step builds that goes red on the bug, with any test file it runs kept under `\.aw\/repro\/` until `aw-build` commits it as a test or deletes it\.\n/);
});
