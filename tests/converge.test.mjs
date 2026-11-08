// aw-converge and the phase procedures it runs (ADR 0016, ticket #95). The
// command is the skills' text, so these tests hold that text: each stop
// condition, what each round runs where, and the report lines one step reads
// from another.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { repoRoot } from './fixtures.mjs';

const read = (path) => readFileSync(join(repoRoot, path), 'utf8').replaceAll('\r\n', '\n');
const converge = read('skills/aw-converge/SKILL.md');
const buildSteps = read('skills/aw-build-steps/SKILL.md');
const verifySteps = read('skills/aw-verify-steps/SKILL.md');
const reviewSteps = read('skills/aw-review-steps/SKILL.md');

// The text from a heading up to the next heading of its level or above.
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `no heading "${heading}"`);
  const level = heading.match(/^#+/)[0].length;
  const end = lines.findIndex((line, i) => i > start && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

// The first line of the text that opens with these words.
function line(text, start) {
  const found = text.split('\n').find((candidate) => candidate.startsWith(start));
  assert.ok(found, `no line starting "${start}"`);
  return found;
}

const refusals = section(converge, '### 2. Refuse what cannot converge');
const round = section(converge, '### 3. Run the rounds');
const fixRunReading = section(converge, '#### The fix run');
const verifyReading = section(converge, '#### Verify');
const reviewReading = section(converge, '#### The review');
const report = section(converge, '### 4. Report');
const fixRun = section(buildSteps, '## The fix run');
const fixReport = fixRun.slice(fixRun.indexOf('**Report.**'));
const verifyReport = section(verifySteps, '### 7. Report');

for (const [procedure, door, text] of [
  ['aw-build-steps', 'aw-build', buildSteps],
  ['aw-verify-steps', 'aw-verify', verifySteps],
  ['aw-review-steps', 'aw-review', reviewSteps],
]) {
  test(`${procedure} is limited to its callers by its description`, () => {
    const description = line(text, 'description: ');
    assert.match(description, new RegExp(`calls from /${door} and aw-converge only`));
    assert.match(description, /do not load it by your own choice/);
  });

  test(`${procedure} opens by refusing a call that names no caller`, () => {
    const first = section(text, '## First step: check the caller');
    assert.equal(text.split('\n').find((candidate) => candidate.startsWith('## ')), '## First step: check the caller');
    assert.match(first, new RegExp(`\`caller: ${door}\` or \`caller: aw-converge\``));
    assert.match(first, /stop, change nothing/);
    assert.match(first, new RegExp(`\`/${door}\``));
  });

  test(`${door} is a door that names itself as the caller of ${procedure}`, () => {
    const body = read(`skills/${door}/SKILL.md`);
    assert.match(body, new RegExp(`Call the Skill tool with "${procedure}", with \`caller: ${door}\` as the arguments`));
    assert.match(body, /^disable-model-invocation: true$/m);
  });
}

test('the fix run and aw-verify cannot ask from a subagent: a question ends the run with a Stop line', () => {
  for (const text of [buildSteps, verifySteps]) {
    const first = section(text, '## First step: check the caller');
    assert.match(first, /With `caller: aw-converge` you run in a subagent/);
    assert.match(first, /`Stop:` line/);
  }
});

test('under aw-converge the build procedure takes the spec from its arguments and runs a fix run', () => {
  const first = section(buildSteps, '## First step: check the caller');
  assert.match(first, /arguments ask for a fix run/);
  assert.match(line(buildSteps, 'Take the spec the user names'), /or the arguments name/);
});

test('the fix run report closes with Stop, Question and Next lines a later command reads', () => {
  assert.match(fixReport, /^- `Stop: <reason>`/m);
  assert.match(fixReport, /^- `Question: /m);
  assert.match(fixReport, /^- `Next: <skill>`/m);
});

for (const [reason, where] of [
  ['no review report', '- **No report:**'],
  ['report out of date', '- **Another commit:**'],
  ['nothing to fix', '- **No introduced defect:**'],
  ['spec change needed', '- **A defect that shows a criterion is wrong:**'],
  ['criterion correction needed', '- **A defect that shows a criterion is wrong:**'],
]) {
  test(`the fix run names its stop as "${reason}"`, () => {
    assert.match(line(fixRun, where), new RegExp(`\`Stop: ${reason}\``));
  });
}

test('a check that fails on code the fix did not touch stops the fix run with its reason', () => {
  assert.match(line(fixRun, '**Run the `task` checks.**'), /`Stop: check failed on code the fix did not touch`/);
});

test('a seam no agreed seam reaches comes back as the one question, and the answer counts as agreed', () => {
  const seams = line(fixRun, '**Agree the seams.**');
  assert.match(seams, /`Stop: seam to agree`/);
  assert.match(seams, /`Question: /);
  assert.match(seams, /commit nothing/);
  assert.match(seams, /seams the arguments name as agreed/);
});

test('every aw-verify ending has its Next line, and those a round cannot resolve a Stop line', () => {
  assert.match(verifyReport, /\*\*every criterion passed\*\*[^\n]*`Next: \/aw-review`/);
  assert.match(verifyReport, /\*\*a criterion failed\*\*[^\n]*`Stop: criterion failed`[^\n]*`Next: \/aw-build`/);
  assert.match(verifyReport, /\*\*a criterion is inconclusive with no other evidence\*\*[^\n]*`Stop: verify journey needs a person`/);
});

test('on the fast route an inconclusive criterion with no test also needs a person', () => {
  const fast = section(verifySteps, '## The fast route');
  assert.match(fast, /\*\*a criterion is inconclusive with no test\*\*[^\n]*`Stop: verify journey needs a person`[^\n]*`Next: \/aw-review`/);
  assert.match(fast, /\*\*a criterion failed\*\*[^\n]*`Stop: criterion failed`/);
});

test('a refusal of aw-verify and a repo with no verify skill end with Stop and Next too', () => {
  assert.match(verifyReport, /A refusal in step 1, or any other stop, ends with `Stop: <the reason>`/);
  assert.match(section(verifySteps, '## Without a verify skill'), /`Stop: criteria need test: or manual: evidence`/);
  assert.match(section(verifySteps, '## The fast route'), /no verify skill means no phase[^\n]*`Next: \/aw-review`/);
});

test('every reviewer brief starts from the diff, not from an earlier report', () => {
  assert.match(section(reviewSteps, '### 5. Run the three axes in parallel'), /instruction not to read `\.aw\/reviews\/`/);
});

test('under aw-converge the review ends with the report and leaves what comes next to the command', () => {
  assert.match(section(reviewSteps, '### 8. Report'), /caller is `aw-converge`, give the report's path and end here/);
});

test('aw-review names /aw-converge first for an introduced defect, and the manual path as the alternative', () => {
  const next = line(reviewSteps, '- **An introduced defect:**');
  assert.ok(next.indexOf('`/aw-converge`') !== -1 && next.indexOf('`/aw-converge`') < next.indexOf('fix run of `/aw-build`'), next);
  assert.match(next, /Or take the steps by hand/);
});

test('aw-converge is user-invoked on both harnesses', () => {
  assert.match(converge, /^disable-model-invocation: true$/m);
  assert.match(read('skills/aw-converge/agents/openai.yaml'), /allow_implicit_invocation: false/);
});

test('the limit is three rounds, raised per call, with no repo setting and no state', () => {
  const limit = section(converge, '### 1. Take the limit');
  assert.match(limit, /Three rounds/);
  assert.match(limit, /`\/aw-converge 5`/);
  assert.match(limit, /no state is kept between calls/);
  assert.doesNotMatch(read('docs/configuration.md'), /aw-converge.*limit/);
});

for (const [name, where, wording] of [
  ['no subagents', '- **No subagents.**', /refuse/i],
  ['a latest report that does not name HEAD', '- **No report at `HEAD`.**', /`\/aw-review`/],
  ['a latest report with no introduced defect', '- **No introduced defect.**', /`\/aw-ship`/],
  ['commit at draft', '- **`commit` at `draft`.**', /no fix can land/],
  ['uncommitted changes', '- **Uncommitted changes.**', /outside `\.aw\/`/],
]) {
  test(`it refuses to start on ${name}, before any work`, () => {
    assert.match(line(refusals, where), wording);
    assert.match(refusals, /before any work/);
  });
}

test('the fix run and aw-verify each run in a subagent of their own, the review in the main session', () => {
  assert.match(line(fixRunReading, 'Start a subagent'), /"aw-build-steps"/);
  assert.match(line(verifyReading, 'Start a subagent'), /"aw-verify-steps"/);
  assert.match(reviewReading, /in this session, never in a subagent/);
  assert.match(reviewReading, /"aw-review-steps"/);
  assert.match(reviewReading, /`caller: aw-converge; /);
});

test('the main session takes the reports and none of the reasoning', () => {
  assert.match(round, /reports and none of their reasoning/);
});

for (const [name, where, wording] of [
  ['a Stop line, such as a spec change or a check outside the fix', '2. **Any other `Stop:` line**', /ends the run with that reason/],
  ['Commit: none', '3. **`Commit: none`**', /ends the run/],
  ['Commit: draft', '4. **`Commit: draft <path>`**', /ends the run/],
]) {
  test(`the fix run ending in ${name} stops the run with its reason`, () => {
    assert.match(line(fixRunReading, where), wording);
  });
}

test('a seam to agree stays inside the loop: the main session asks and starts the fix run again', () => {
  const seam = line(fixRunReading, '1. **`Stop: seam to agree`**');
  assert.match(seam, /Ask the user/);
  assert.match(seam, /start the fix run again/);
  assert.match(seam, /same round/);
});

test('a partial Not fixed with a commit goes on, and the next review judges it', () => {
  assert.match(line(fixRunReading, '5. **`Commit: <hash> <subject>`**'), /`Not fixed:`[^.]*go on[^.]*next review/);
});

test('any step output the command does not recognise stops the run', () => {
  for (const text of [fixRunReading, verifyReading, reviewReading]) {
    assert.match(text, /not recognised/);
  }
});

test('a Stop line from aw-verify ends the run, a failed criterion and a journey needing a person among them', () => {
  assert.match(line(verifyReading, '1. **Any `Stop:` line**'), /ends the run with that reason/);
  assert.match(verifyReading, /`Stop: criterion failed`/);
  assert.match(verifyReading, /`Stop: verify journey needs a person`/);
});

test('verify runs only when the fix run names it', () => {
  assert.match(fixRunReading, /`Next: \/aw-verify`/);
  assert.match(fixRunReading, /`Next: \/aw-review`/);
});

test('zero introduced defects ends the run clean, and the limit ends it with what is left', () => {
  assert.match(line(reviewReading, '- **0 introduced:**'), /ends the run clean/);
  assert.match(line(reviewReading, '- **More, with rounds left:**'), /next round/);
  assert.match(line(reviewReading, '- **More, at the limit:**'), /ends the run/);
});

test('pre-existing defects and risks never keep the loop going', () => {
  assert.match(converge, /Pre-existing defects and risks never keep a run going/);
});

test('the report names /aw-ship only for a clean run, and lists the defects left at the limit', () => {
  assert.match(line(report, '  - **Clean:**'), /`\/aw-ship`/);
  assert.match(line(report, '  - **Limit reached:**'), /defects left/);
  assert.match(line(report, '  - **Stopped:**'), /its reason/);
});

test('the command never pushes, opens a review request or merges', () => {
  assert.match(converge, /never pushes, opens a review request or merges/);
});

test('the three procedures and aw-converge are listed in the plugin manifest', () => {
  const skills = JSON.parse(read('.claude-plugin/plugin.json')).skills;
  for (const name of ['aw-build-steps', 'aw-verify-steps', 'aw-review-steps', 'aw-converge']) {
    assert.ok(skills.includes(`./skills/${name}`), name);
    assert.ok(existsSync(join(repoRoot, 'skills', name, 'SKILL.md')), name);
  }
});

test('the README states the kit ships aw-converge and the phase procedures', () => {
  const readme = read('README.md');
  assert.match(readme, /`aw-converge`, which/);
  assert.match(readme, /phase procedures/);
});

test('the glossary and ADR 0016 agree on what the command does', () => {
  assert.match(read('GLOSSARY.md'), /^\*\*Convergence run\*\*:/m);
  assert.match(read('docs/adr/0016-aw-converge-runs-phases-through-phase-procedures.md'), /`aw-converge`/);
});
