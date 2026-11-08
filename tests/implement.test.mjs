// aw-implement and what it asks of the procedures it runs (ADR 0017, ticket
// #98). The command is the skills' text, so these tests hold that text: each
// refusal, each way the run ends, where each step runs, and the lines one
// step reads from another.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { repoRoot } from './fixtures.mjs';

const read = (path) => readFileSync(join(repoRoot, path), 'utf8').replaceAll('\r\n', '\n');
const implement = read('skills/aw-implement/SKILL.md');
const converge = read('skills/aw-converge-steps/SKILL.md');
const buildSteps = read('skills/aw-build-steps/SKILL.md');
const verifySteps = read('skills/aw-verify-steps/SKILL.md');
const reviewSteps = read('skills/aw-review-steps/SKILL.md');

// The text from a heading up to the next heading of its level or above. A line
// inside a code fence is never a heading.
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `no heading "${heading}"`);
  const level = heading.match(/^#+/)[0].length;
  let fenced = false;
  const end = lines.findIndex((candidate, i) => {
    if (i <= start) return false;
    if (candidate.startsWith('```')) fenced = !fenced;
    return !fenced && new RegExp(`^#{1,${level}} `).test(candidate);
  });
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

// The first line of the text that opens with these words.
function line(text, start) {
  const found = text.split('\n').find((candidate) => candidate.startsWith(start));
  assert.ok(found, `no line starting "${start}"`);
  return found;
}

const journal = section(implement, '## The journal');
const input = section(implement, '### 1. Take the input');
const refusals = section(implement, '### 2. Refuse what cannot run');
const opening = section(implement, '### 3. Open the journal and announce');
const build = section(implement, '### 4. Build what is left');
const verify = section(implement, '### 5. Verify');
const review = section(implement, '### 6. The first review');
const rounds = section(implement, '### 7. Converge');
const report = section(implement, '### 8. Report');
const buildFirst = section(buildSteps, '## First step: check the caller');
const pick = section(buildSteps, '### 1. Take the spec and the slice');
const buildReport = section(buildSteps, '### 8. Report');
const fastRoute = section(buildSteps, '## The fast route');
const underImplement = section(converge, '## Called by `aw-implement`');

test('aw-implement is user-invoked on both harnesses and phase-free', () => {
  assert.match(implement, /^disable-model-invocation: true$/m);
  assert.match(read('skills/aw-implement/agents/openai.yaml'), /allow_implicit_invocation: false/);
  assert.match(implement, /belongs to no phase and has no artifact/);
});

test('its unit is one spec and one review request, and it takes no ticket', () => {
  assert.match(implement, /one spec and one review request/);
  assert.match(implement, /takes no ticket/);
  assert.match(implement, /does not use the tracker/);
});

test('it never ships', () => {
  assert.match(implement, /never pushes, opens a review request or merges/);
  assert.match(line(implement, 'description: '), /Never pushes, opens a review request or merges/);
});

test('a spec path picks the standard route, and without one the fast route comes from the conversation', () => {
  assert.match(line(input, '- **A spec path:**'), /standard route/);
  assert.match(line(input, '- **No spec path, and `/aw-intake`'), /`Route: fast`/);
});

test('a relaunch on the fast route finds its source in the journal or the Done when lines', () => {
  const source = line(input, '- **No spec path, on a branch');
  assert.match(source, /journal/);
  assert.match(source, /`Done when:`/);
});

test('a journal still at pending is a source on a protected branch, since a seam stop makes no branch', () => {
  assert.match(line(input, '- **No spec path, on a branch'), /still at `pending` while this branch is protected/);
});

test('the journal learns the work branch after any build, not only after a commit', () => {
  assert.match(line(build, 'After every build'), /`pending`/);
  assert.match(line(build, 'After every build'), /`Work branch: /);
});

test('an AFK seam stop makes no branch, because the seam check comes before start-branch', () => {
  const branch = section(buildSteps, '### 2. Start the work branch');
  assert.match(branch, /In the `afk` variant[^\n]*\*\*A seam to agree in the `afk` variant\*\*/);
  assert.match(line(section(buildSteps, '### 4. Build test-first'), '**A seam to agree in the `afk` variant.**'), /before step 2 creates a work branch/);
});

test('a fast-route build for aw-implement never turns into a fix run', () => {
  assert.match(line(fastRoute, '**Fix run.**'), /With `caller: aw-implement` there is no fix run/);
});

test('a seam agreed during a HITL slice reaches the journal too', () => {
  assert.match(line(build, '2. **`Stop: HITL slice'), /`Agreed seam: /);
});

test('a verify that stops still prints its progress line', () => {
  assert.match(line(verify, '1. **Any `Stop:` line**'), /`Verify: stopped: /);
});

test('with no source at all it asks which spec', () => {
  assert.match(line(input, '- **Otherwise:**'), /ask which one/);
});

test('the limit is three rounds, raised per call, and a repo cannot change it', () => {
  const limit = line(input, '**The limit.**');
  assert.match(limit, /Three rounds/);
  assert.match(limit, /above 3/);
  assert.match(limit, /can only raise the limit/);
  assert.match(limit, /A repo cannot change it/);
  assert.doesNotMatch(read('docs/configuration.md'), /aw-implement.*limit/);
});

for (const [name, where, wording] of [
  ['no subagents', '- **No subagents.**', /refuse/i],
  ['commit at draft', '- **`commit` at `draft`.**', /no slice can land/],
  ['uncommitted changes', '- **Uncommitted changes.**', /outside `\.aw\/`/],
  ['a protected branch with start-branch at draft', '- **A protected branch and `start-branch` at `draft`.**', /no work branch can be made/],
  ['a spec that is not approved', '- **A spec that is not `approved`.**', /`\/aw-spec`/],
  ['a spec with no slice plan', '- **No slice plan.**', /`\/aw-slices`/],
  ['a fast-route task with no source', '- **No fast-route source.**', /`\/aw-intake`/],
]) {
  test(`it refuses on ${name}, before any work`, () => {
    assert.match(line(refusals, where), wording);
    assert.match(refusals, /before any work/);
  });
}

test('a refused run changes nothing and creates no journal', () => {
  assert.match(refusals, /change nothing, and create no journal/);
});

test('the journal is opened only once the refusals have passed', () => {
  assert.ok(implement.indexOf('### 2. Refuse what cannot run') < implement.indexOf('### 3. Open the journal and announce'));
  assert.match(opening, /Create or continue the journal/);
});

test('the start of the run names the HITL slices', () => {
  assert.match(opening, /Name each HITL slice not yet done/);
});

test('the journal lives under .aw, is append-only, and is never committed', () => {
  assert.match(journal, /`\.aw\/implement\/<slug>\.md`/);
  assert.match(journal, /append-only/);
  assert.match(journal, /never committed/);
  assert.match(journal, /nothing deletes it/);
});

test('only an implementation run reads the journal, and it never decides the position', () => {
  assert.match(journal, /Only this skill reads it, and the convergence procedure it starts/);
  assert.match(read('docs/adr/0017-aw-implement-takes-one-spec-to-a-clean-review.md'), /Only `aw-implement` and the convergence procedure it starts read it/);
  assert.match(journal, /never decides the position/);
  assert.match(journal, /done markers, commits and review reports/);
});

test('the main session reads the journal again before each step, and a missing one changes nothing', () => {
  assert.match(journal, /Read it again before each step/);
  assert.match(line(journal, '**When it is gone**'), /goes on/);
});

test('each call opens a heading, and the round count looks only at the latest', () => {
  assert.match(journal, /Each call opens a heading with its date and time/);
  assert.match(journal, /round count looks only at the latest heading/);
});

test('a journal naming another work branch is replaced, and one on the same branch continues', () => {
  const relaunch = line(journal, '**A relaunch.**');
  assert.match(relaunch, /same work branch continues/);
  assert.match(relaunch, /names another work branch is replaced/);
});

test('the agreed seams of every call are applied, and the journal holds what the ticket names', () => {
  for (const field of ['Agreed seam', 'Spec change', 'Intake', 'Work branch', 'Limit']) {
    assert.match(journal, new RegExp(`^${field}: `, 'm'), field);
  }
  assert.match(journal, /Every `Agreed seam:` line counts, under any heading/);
  assert.match(build, /every `Agreed seam:` line of the journal/);
  assert.match(rounds, /every `Agreed seam:` line of the journal/);
});

test('slices are built in series, each AFK slice in a subagent of its own, in the foreground', () => {
  assert.match(line(build, 'Start a subagent'), /in the foreground/);
  assert.match(line(build, 'Start a subagent'), /"aw-build-steps"/);
  assert.match(line(build, 'Start a subagent'), /`caller: aw-implement; afk; /);
  assert.match(build, /in series/);
  assert.match(build, /reports and none of their reasoning/);
});

test('the fast route passes the whole of intake\'s report to its one build', () => {
  assert.match(line(build, 'Start a subagent'), /fast route; intake: <intake's whole report: task, type, pre-step result and criteria>/);
});

test('with every slice done at the start it goes straight to verify', () => {
  assert.match(line(build, '- **Nothing left to build, standard route:**'), /go to \*\*5\. Verify\*\*/);
  assert.match(line(build, '- **Nothing left to build, fast route:**'), /`Done when:`/);
});

test('a seam to agree reaches the user as a question, and the answer passes to every later build and fix run', () => {
  const seam = line(build, '1. **`Stop: seam to agree`**');
  assert.match(seam, /Ask the user/);
  assert.match(seam, /start the build again/);
  assert.match(seam, /`Agreed seam: /);
  assert.match(seam, /every later build and fix run/);
  assert.match(seam, /When they decline, end the run/);
});

test('a HITL slice runs in the main session and does not end the run', () => {
  const hitl = line(build, '2. **`Stop: HITL slice');
  assert.match(hitl, /in this session/);
  assert.match(hitl, /`caller: aw-implement; hitl; /);
  assert.match(hitl, /does not end the run/);
});

for (const [name, where] of [
  ['any other Stop line', '3. **Any other `Stop:` line**'],
  ['Commit: none', '4. **`Commit: none`**'],
  ['Commit: draft', '5. **`Commit: draft <path>`**'],
]) {
  test(`a build ending in ${name} ends the run`, () => {
    assert.match(line(build, where), /ends the run/);
  });
}

test('a failed criterion is never rebuilt automatically', () => {
  assert.match(line(verify, '1. **Any `Stop:` line**'), /`Stop: criterion failed`/);
  assert.match(line(verify, '1. **Any `Stop:` line**'), /never rebuilt/);
});

test('a commit that is not HEAD and any output not recognised end the run, and the report quotes it', () => {
  assert.match(build, /a commit that is not `HEAD`/);
  for (const text of [build, verify, review, rounds]) {
    assert.match(text, /not recognised/);
  }
  assert.match(build, /Quote it in the report/);
});

test('the run follows each report\'s Next line until it is no longer /aw-build', () => {
  assert.match(build, /`Next: \/aw-build` starts the next build/);
  assert.match(build, /`Next: \/aw-verify` goes to \*\*5\. Verify\*\*/);
  assert.match(build, /`Next: \/aw-review` goes to \*\*6\. The first review\*\*/);
});

test('verify runs in a subagent and the first review in the main session', () => {
  assert.match(line(verify, 'Start a subagent'), /"aw-verify-steps"/);
  assert.match(line(verify, 'Start a subagent'), /`caller: aw-implement; /);
  assert.match(review, /in this session, never in a subagent/);
  assert.match(review, /"aw-review-steps"/);
  assert.match(review, /`caller: aw-implement; /);
});

test('a review with no introduced defect ends the run clean, and one with a defect starts the rounds', () => {
  assert.match(line(review, '- **0 introduced:**'), /ends the run clean/);
  assert.match(line(review, '- **More:**'), /\*\*7\. Converge\*\*/);
});

test('the rounds run through the convergence procedure with the limit and the journal', () => {
  assert.match(rounds, /"aw-converge-steps"/);
  assert.match(rounds, /`caller: aw-implement; limit: <the limit>; journal: <its path>/);
  for (const ending of ['Converge: clean', 'Converge: limit reached', 'Converge: stopped']) {
    assert.ok(rounds.includes(ending), ending);
  }
});

for (const [name, sample] of [
  ['a built slice', '`Slice 2/4 built: a1b2c3d`'],
  ['verify', '`Verify: passed`'],
  ['the first review', '`Review 1: 2 introduced defects`'],
]) {
  test(`${name} prints one progress line`, () => {
    assert.ok(implement.includes(sample), sample);
  });
}

test('a finished round prints one progress line', () => {
  assert.match(underImplement, /`Round 1\/3: fix e4f5a6b, clean review`/);
});

test('the final report gives the state, what is left, every Spec change line and the next command', () => {
  assert.match(report, /the state/);
  assert.match(report, /what is left/);
  assert.match(report, /every `Spec change:` line/);
  assert.match(report, /\(from an earlier call\)/);
  assert.match(line(report, '  - **Clean:**'), /`\/aw-ship`/);
  assert.match(line(report, '  - **Limit reached:**'), /defects left/);
  const stopped = line(report, '  - **Stopped:**');
  assert.match(stopped, /at which point/);
  assert.match(stopped, /why/);
  assert.match(stopped, /`\/aw-implement` again/);
});

test('the report never runs what comes next', () => {
  assert.match(report, /this skill never runs it/);
});

test('aw-build-steps accepts caller: aw-implement in an AFK and a HITL variant', () => {
  assert.match(buildFirst, /`caller: aw-implement`/);
  assert.match(buildFirst, /`afk`/);
  assert.match(buildFirst, /`hitl`/);
});

test('in the AFK variant a question ends the run with a Stop line, and in the HITL variant it asks', () => {
  const variants = line(buildFirst, 'With `caller: aw-implement`');
  assert.match(variants, /`afk` variant you run in a subagent/);
  assert.match(variants, /end the run with a `Stop:` line/);
  assert.match(variants, /`hitl` variant runs in the main session and asks/);
});

test('aw-build-steps keeps choosing the slice, and never makes a fix run for aw-implement', () => {
  const chosen = line(pick, 'With `caller: aw-implement`');
  assert.match(chosen, /first slice in plan order/);
  assert.match(chosen, /never go to \*\*The fix run\*\*/);
});

test('the AFK variant on a HITL slice changes nothing and names the slice', () => {
  const hitl = line(pick, 'In the `afk` variant, when the slice is **HITL**');
  assert.match(hitl, /change nothing, commit nothing/);
  assert.match(hitl, /`Stop: HITL slice <n>: <its name>`/);
  assert.match(hitl, /`Commit: none`/);
  assert.match(hitl, /`Next: \/aw-build`/);
});

test('an AFK seam stop changes nothing, on both routes, and agreed seams count', () => {
  const seam = line(section(buildSteps, '### 4. Build test-first'), '**A seam to agree in the `afk` variant.**');
  assert.match(seam, /`Stop: seam to agree`/);
  assert.match(seam, /`Question: /);
  assert.match(seam, /change nothing and commit nothing/);
  assert.match(seam, /before the first test/);
  assert.match(seam, /undo what this run changed/);
  assert.match(buildFirst, /`agreed seams:` count as agreed/);
  assert.match(line(fastRoute, '**Step 4: test-first.**'), /`afk` variant[^.]*`Stop: seam to agree`/);
});

test('the fast route takes intake\'s report, pre-step result included, from the arguments', () => {
  assert.match(line(fastRoute, '**Step 1: take the task, not a spec.**'), /`intake:`/);
  assert.match(buildFirst, /intake's whole report/);
});

test('a slice or a fast-route build closes with the lines aw-implement reads', () => {
  const closing = buildReport.slice(buildReport.indexOf('**Closing lines for `aw-implement`.**'));
  for (const opener of ['- `Commit: <hash> <subject>`', '- `Spec change: <the change>`', '- `Stop: <reason>`', '- `Question: <the question>`', '- `Next: <skill>`']) {
    assert.ok(closing.includes(opener), opener);
  }
  assert.match(line(fastRoute, '**Step 8: report each criterion.**'), /\*\*Closing lines for `aw-implement`\*\*/);
});

test('the fix run keeps its own closing lines, so aw-converge reads them as before', () => {
  const fixRun = section(buildSteps, '## The fix run');
  assert.match(fixRun, /^- `Commit: <hash> <subject>`/m);
  assert.match(fixRun, /`caller: aw-converge`/);
});

test('a slice\'s steps stay inside the part of aw-build-steps that survives compaction', () => {
  const end = buildSteps.indexOf('## When the spec is wrong');
  assert.notEqual(end, -1);
  assert.ok(end <= 20000, `slice steps end at character ${end}`);
});

test('aw-verify-steps accepts caller: aw-implement and behaves as with aw-converge', () => {
  assert.match(section(verifySteps, '## First step: check the caller'), /With `caller: aw-converge` or `caller: aw-implement` you run in a subagent and no user can answer you/);
});

test('aw-review-steps accepts caller: aw-implement and behaves as with aw-converge', () => {
  assert.match(section(reviewSteps, '## First step: check the caller'), /With `caller: aw-converge` or `caller: aw-implement` you run in the main session/);
  assert.match(section(reviewSteps, '### 5. Run the three axes in parallel'), /`caller: aw-converge` or `caller: aw-implement`/);
  assert.match(section(reviewSteps, '### 8. Report'), /`aw-converge` or `aw-implement`/);
});

test('under aw-implement the convergence procedure takes its limit, journal and seams from the arguments', () => {
  assert.match(line(underImplement, '- **The limit**'), /`limit:`/);
  assert.match(line(underImplement, '- **The journal.**'), /`journal:`/);
  assert.match(line(underImplement, '- **Seams.**'), /`agreed seams:`/);
  assert.match(line(underImplement, '- **Seams.**'), /`Agreed seam: /);
});

test('under aw-implement a round number survives compaction, and a new call starts a new count', () => {
  assert.match(line(underImplement, '- **The round number.**'), /latest heading/);
});

test('under aw-implement every Spec change line reaches the journal', () => {
  assert.match(line(underImplement, '- **Spec changes.**'), /journal/);
});

test('under aw-implement the rounds end with one line that aw-implement reads, a refusal included', () => {
  const end = line(underImplement, '- **The end.**');
  assert.match(end, /`Converge: clean`/);
  assert.match(end, /`Converge: limit reached`/);
  assert.match(end, /`Converge: stopped: /);
  assert.match(end, /refusal/);
});

for (const [skill, where, wording] of [
  ['aw-slices', 'Then name the next skill:', /`\/aw-implement`/],
  ['aw-intake', '- **fast**: `/aw-build`', /`\/aw-implement`/],
]) {
  test(`${skill} names /aw-implement beside /aw-build, and the manual path stays`, () => {
    const named = line(read(`skills/${skill}/SKILL.md`), where);
    assert.match(named, wording);
    assert.match(named, /`\/aw-build`/);
  });
}

test('the new skills are listed in the plugin manifest', () => {
  const skills = JSON.parse(read('.claude-plugin/plugin.json')).skills;
  for (const name of ['aw-implement', 'aw-converge-steps']) {
    assert.ok(skills.includes(`./skills/${name}`), name);
    assert.ok(existsSync(join(repoRoot, 'skills', name, 'SKILL.md')), name);
  }
});

test('the README and the configuration page list the new skills', () => {
  const readme = read('README.md');
  assert.match(readme, /`aw-implement`, which/);
  assert.match(readme, /`aw-converge-steps`, which/);
  const configuration = read('docs/configuration.md');
  assert.match(configuration, /`aw-implement`/);
  assert.match(configuration, /`aw-converge-steps`/);
});

test('the glossary and ADR 0017 define the terms the skills use', () => {
  const glossary = read('GLOSSARY.md');
  assert.match(glossary, /^\*\*Implementation run\*\*:/m);
  assert.match(glossary, /^\*\*Convergence procedure\*\*:/m);
  assert.ok(existsSync(join(repoRoot, 'docs/adr/0017-aw-implement-takes-one-spec-to-a-clean-review.md')));
});
