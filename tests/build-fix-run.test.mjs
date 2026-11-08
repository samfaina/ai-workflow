// aw-build's fix run fixes the introduced defects of the latest review report.
// The run is the skill's text, so these tests hold that text, its two inputs and
// outputs (the report's headings, the fix run's own report), and run the git
// command it names on a real repo. Ticket #94.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { repoRoot, writeFiles } from './fixtures.mjs';
import { git, tempDir } from './uat-fixtures.mjs';

const read = (path) => readFileSync(join(repoRoot, path), 'utf8').replaceAll('\r\n', '\n');
const skill = read('skills/aw-build/SKILL.md');

// The text from a heading up to the next heading of its level or above.
function section(heading) {
  const lines = skill.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `no heading "${heading}"`);
  const level = heading.match(/^#+/)[0].length;
  const end = lines.findIndex((line, i) => i > start && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

const fixRun = section('## The fix run');
const stepOne = section('### 1. Take the spec and the slice');
const fastRoute = section('## The fast route');

// The paragraph that opens with these words, in the given text.
function paragraph(text, start) {
  const found = text.split('\n').find((line) => line.startsWith(start));
  assert.ok(found, `no line starting "${start}"`);
  return found;
}

// The step or item of the fix run with this bold name.
const step = (name) => paragraph(fixRun, `**${name}`);
const item = (name) => paragraph(fixRun, `- **${name}`);

test('with every slice done, an introduced defect in a report at HEAD starts a fix run instead of naming /aw-verify', () => {
  const pick = paragraph(stepOne, 'Pick the slice');
  assert.match(pick, /When every slice is done, and the latest review report names `HEAD` and holds an introduced defect, go to \*\*The fix run\*\*/);
  assert.match(pick, /Otherwise, when every slice is done, say so and name `\/aw-verify`/);
});

test('a user who asks for a fix run gets one, whatever is left to build', () => {
  assert.match(paragraph(stepOne, 'Pick the slice'), /When the user asks for a fix run, go to \*\*The fix run\*\*/);
});

test('on the fast route, with no slices to wait for, the report alone starts a fix run', () => {
  const start = paragraph(fastRoute, '**Fix run.**');
  assert.match(start, /the user asks for one/);
  assert.match(start, /latest review report names `HEAD` and holds an introduced defect/);
  assert.match(start, /go to \*\*The fix run\*\*/);
});

function commit(dir, name) {
  writeFiles(dir, { [name]: name });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', name);
  return git(dir, 'rev-parse', '--short', 'HEAD');
}

// Whether the fix run takes a report headed with this short hash as covering
// HEAD, by the command the skill names for it.
function reportCoversHead(dir, shortHash) {
  const named = fixRun.match(/`(git rev-parse --verify <short hash>\^\{commit\})`/);
  assert.ok(named, 'the fix run names no command that resolves the short hash');
  const resolved = git(dir, ...named[1].replace('<short hash>', shortHash).split(' ').slice(1));
  return resolved === git(dir, 'rev-parse', 'HEAD');
}

test('the report the run reads is the last in name order under .aw/reviews/', () => {
  assert.match(step('Read the report'), /`\.aw\/reviews\/\*-review\.md`/);
  assert.match(step('Read the report'), /last in name order/);
});

test('a report that names another commit stops the fix run and names /aw-review', () => {
  const stale = item('Another commit');
  assert.match(stale, /out of date/);
  assert.match(stale, /stop/i);
  assert.match(stale, /`\/aw-review`/);
});

test('the stop on another commit makes no exception for adapter commits', () => {
  assert.match(item('Another commit'), /`\/aw-ship`'s exemption for adapters does not apply/);
});

test('a report headed with HEAD covers HEAD, and one headed with an older commit does not', (t) => {
  const dir = tempDir(t);
  git(dir, 'init', '-q', '-b', 'main');
  const older = commit(dir, 'older');
  const head = commit(dir, 'head');
  assert.equal(reportCoversHead(dir, head), true);
  assert.equal(reportCoversHead(dir, older), false);
});

test('with no report, or none with an introduced defect, there is nothing to fix and the run says what comes next', () => {
  assert.match(item('No report'), /`\/aw-review`/);
  assert.match(item('No introduced defect'), /nothing to fix/);
});

test('the input is every defect under Defects introduced, from any axis, also those no slice covers', () => {
  const input = step('Take the defects');
  assert.match(input, /`Defects introduced`/);
  assert.match(input, /every axis/);
  assert.match(input, /Standards or Security/);
  assert.match(input, /no slice covers/);
});

test('pre-existing findings and risks are left alone', () => {
  assert.match(step('Take the defects'), /Leave `Risks introduced` and `Pre-existing` as they are/);
});

test('each defect is fixed through aw-tdd: its run becomes a failing test at an agreed seam, red before the fix', () => {
  const fix = step('Fix test-first');
  assert.match(fix, /"aw-tdd"/);
  assert.match(fix, /its run becomes a failing test at an agreed seam/);
  assert.match(fix, /fails before the fix/);
});

test('a seam nothing agreed yet needs the user, and changes no spec here', () => {
  const seams = step('Agree the seams');
  assert.match(seams, /no agreed seam reaches/i);
  assert.match(seams, /what it catches and what it misses/);
  assert.match(seams, /spec change to report/);
});

test('a defect against a criterion gets its test exception under the rules aw-build already has', () => {
  const exception = step('Test exception');
  assert.match(exception, /step 4's rule/);
  assert.match(exception, /in the slice that covers it/);
  assert.match(exception, /\*\*Step 4\*\* of \*\*The fast route\*\*/);
});

test('a defect no criterion covers gets a test exception in the commit, with manual: evidence, and the glossary says so', () => {
  const exception = step('Test exception');
  assert.match(exception, /no criterion covers/);
  assert.match(exception, /line of the commit message/);
  assert.match(exception, /proven by `manual:` evidence instead/);
  const glossary = read('GLOSSARY.md').split('\n');
  const definition = glossary[glossary.indexOf('**Test exception**:') + 1];
  assert.match(definition, /fix run/);
  assert.match(definition, /no criterion covers/);
});

test('a test exception leaves Traceability alone: only a new test adds to it', () => {
  assert.match(step('Test exception'), /Leave Traceability as it is/);
});

test('the fix run runs the task check level', () => {
  assert.match(step('Run the `task` checks'), /run-check task/);
});

test('one local commit holds the fix and names every defect it fixes', () => {
  const commitStep = step('Commit');
  assert.match(commitStep, /one local commit/i);
  assert.match(commitStep, /`Fixes: <file:line>: <what was wrong> \(<axis>\)`/);
});

test('no done marker changes, and Traceability grows only when a new test proves a criterion', () => {
  const record = step('Record in the spec');
  assert.match(record, /Tick and untick no done marker/);
  assert.match(record, /only when a new test proves a criterion/);
});

test('the fix run edits the spec no further than the skill says it may', () => {
  const rule = paragraph(skill, 'This skill edits only three things in the spec');
  assert.match(rule, /A fix run edits the spec only as \*\*The fix run\*\* says/);
});

test('on the fast route the commit writes the whole current set of Done when lines', () => {
  assert.match(step('Commit'), /whole current set of `Done when:` lines/);
});

test('the fix run works on the work branch, as a slice does', () => {
  assert.match(step('The work branch'), /step 2/);
});

test('a defect that shows a criterion is wrong stops the run with a proposed spec change and no commit', () => {
  const stop = item('A defect that shows a criterion is wrong');
  assert.match(stop, /\*\*When the spec is wrong\*\*/);
  assert.match(stop, /no commit/);
  assert.match(stop, /proposed spec change/);
});

test('on the fast route that stop follows When the criteria are wrong', () => {
  assert.match(item('A defect that shows a criterion is wrong'), /\*\*When the criteria are wrong\*\*/);
});

test('a spec at any status but approved is refused, and every refusal names /aw-spec', () => {
  const refusals = stepOne.split('\n').filter((line) => /^- `(draft|implemented|superseded)`:/.test(line));
  assert.equal(refusals.length, 3);
  for (const refusal of refusals) assert.match(refusal, /`\/aw-spec`/, refusal);
  assert.match(fixRun, /every refusal there holds/);
});

test('the report gives each defect one regular line, fixed or not fixed, and the commit', () => {
  const report = fixRun.slice(fixRun.indexOf('**Report.**'));
  assert.match(report, /^- `Fixed: <file:line>: <what was wrong> \(<axis>\)\. Evidence: /m);
  assert.match(report, /^- `Not fixed: <file:line>: <what was wrong> \(<axis>\)\. Reason: /m);
  assert.match(report, /^- `Commit: /m);
  assert.match(report, /one line per defect/);
});

test('the report names /aw-verify when the fix touches a criterion with verify: evidence, and /aw-review otherwise', () => {
  const next = step('Then name the next skill');
  assert.match(next, /`\/aw-verify` when the fix touches a criterion whose Traceability row holds a `verify:` entry/);
  assert.match(next, /on the fast route when the repo has a verify skill/);
  assert.match(next, /`\/aw-review` otherwise/);
});

test('the fix run never starts a review or a verify run itself', () => {
  assert.match(step('Then name the next skill'), /this skill never runs it/);
});

for (const [skillName, start] of [
  ['aw-review', '- **An introduced defect:**'],
  ['aw-ship', '- **An introduced defect:**'],
]) {
  test(`${skillName} sends an introduced defect to the fix run`, () => {
    const line = read(`skills/${skillName}/SKILL.md`).split('\n').find((candidate) => candidate.startsWith(start));
    assert.ok(line, `${skillName} has no line "${start}"`);
    assert.match(line, /fix run of `\/aw-build`/);
  });
}

test('the glossary defines the fix run', () => {
  assert.match(read('GLOSSARY.md'), /^\*\*Fix run\*\*:/m);
});

test('the skill description and the README mention the fix run', () => {
  assert.match(skill.split('---')[1], /introduced defects/);
  assert.match(read('README.md'), /`aw-build`[^;]*introduced defects/);
});

test('ADR 0010 says the fix run keeps building and reviewing apart', () => {
  assert.match(read('docs/adr/0010-one-owner-per-phase-and-slices-in-the-spec.md'), /fix run/);
});
