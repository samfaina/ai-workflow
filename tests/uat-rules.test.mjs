// The UAT conductor's rules for proposing answers and for grading live in two
// reference files beside the /uat skill, so a caller that never sees the
// conductor's procedure can follow them too (#156), the UAT driver of an
// unattended run included (#163). The behaviour is each file's text, so these
// tests hold that text.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { markdownFiles, repoRoot, textLine, textSection } from './fixtures.mjs';
import { caseFile, makeRun, skillDir } from './uat-fixtures.mjs';

const read = (name) => readFileSync(join(skillDir, name), 'utf8').replaceAll('\r\n', '\n');

const files = {
  'SKILL.md': read('SKILL.md'),
  'ANSWERING.md': read('ANSWERING.md'),
  'GRADING.md': read('GRADING.md'),
  'CASE-FORMAT.md': read('CASE-FORMAT.md'),
};
const { 'SKILL.md': skill, 'ANSWERING.md': answering, 'GRADING.md': grading } = files;

// The /uat Markdown files `pattern` matches in, one file name per match, so a
// rule written twice in one file shows up twice.
function filesMatching(pattern) {
  const all = new RegExp(pattern.source, `${pattern.flags}g`);
  return Object.entries(files).flatMap(([name, text]) => (text.match(all) ?? []).map(() => name));
}

// The one JSON block of GRADING.md, parsed.
function gradesExample() {
  const blocks = [...grading.matchAll(/^```json\n([\s\S]*?)^```$/gm)];
  assert.equal(blocks.length, 1, 'GRADING.md holds one JSON block');
  return JSON.parse(blocks[0][1]);
}

test('the skill body runs the commands it ran before the rules moved, in the same order', () => {
  const commands = [...skill.matchAll(/`((?:reader\.mjs )?(?:init|next|skip|watch|pick|check|drift|peek|reset|summary|record|report|clean)(?![.\w])[^`]*)`/g)]
    .map((m) => m[1]);
  assert.deepEqual(commands, [
    'next',
    'init --run <that folder> --source <clone>',
    'init',
    'next',
    'next',
    'skip --reason <text>',
    'next',
    'reader.mjs watch --step <stepDir>',
    'reader.mjs pick --step <stepDir> --session <id>',
    'check --turn <n>',
    'drift --when <when> --intent <intent> --reason <reason>',
    'reader.mjs peek --step <stepDir>',
    'reset --case <id>',
    'next',
    'check',
    'reader.mjs summary --step <stepDir>',
    'record --grades <file>',
    'report',
    'clean',
  ]);
});

test('a step that has to start over is reset, and the person hears which cases run again', () => {
  const wait = textSection(skill, '### 4. Wait for `hecho`');
  assert.match(wait, /has to start over/);
  assert.match(wait, /`reset --case <id>`/);
  assert.match(wait, /`continues`/);
  assert.match(wait, /name every case it lists/);
});

// The section of ANSWERING.md for each flow when no entry fits.
const CONDUCTOR_SECTION = '### With the UAT conductor';
const UNATTENDED_SECTION = '### In an unattended run';

for (const name of ['ANSWERING.md', 'GRADING.md']) {
  test(`${name} reads without the conductor's procedure: no hecho, pregunta or peek`, () => {
    assert.doesNotMatch(files[name], /hecho|pregunta|peek/i);
  });
}

test('a person appears only in the section of ANSWERING.md for a run with the UAT conductor', () => {
  assert.doesNotMatch(grading, /\bperson\b/i);
  assert.doesNotMatch(answering.replace(textSection(answering, CONDUCTOR_SECTION), ''), /\bperson\b/i);
});

describe('ANSWERING.md', () => {
  test('step 3 links it and tells the model to read it', () => {
    const propose = textSection(skill, '### 3. Propose answers');
    assert.match(propose, /Read \[ANSWERING\.md\]\(ANSWERING\.md\)/);
  });

  test('step 3 proposes hecho at a stop point, which it leaves ANSWERING.md to define', () => {
    const propose = textSection(skill, '### 3. Propose answers');
    assert.match(propose, /At a stop point, propose that the person type `hecho` here instead of answering/);
  });

  test('holds the answering rules, and the skill body no longer does', () => {
    for (const rule of [
      /option labels change between runs/,
      /fulfils its `intent`/,
      /question in plain prose/,
      /\*\*drift\*\*/,
    ]) {
      assert.deepEqual(filesMatching(rule), ['ANSWERING.md'], rule.source);
    }
  });

  test('takes a turn end\'s reply from the first turn not sent yet, and says it needs that count', () => {
    assert.match(answering, /how many of them have been sent so far/);
    assert.match(answering, /the first entry of `turns` not sent yet that fits it\. The `turns` entries before that one are skipped, unless one has checks of its own\./);
    assert.match(answering, /An `answers` entry that fits it comes first, even when the next `turns` entry would also do/);
  });

  test('settles whether an entry fits from the question and its when alone, and a drift answer names the closest entry', () => {
    assert.match(textSection(answering, '## Rules'), /Whether an entry fits is settled by the question and the `when` alone, before you look at this run's options or at the answer the agent recommends\./);
    assert.match(textSection(answering, '## When no entry fits'), /with the entry whose `when` comes closest and why it does not fit/);
  });

  test('names a stop point by the check that expects it, so an approval a check expects given is answered', () => {
    const stops = textSection(answering, '### Stop points');
    assert.match(stops, /A stop point is named by the check that expects the agent to stop there\./);
    assert.match(stops, /An approval that a check expects given, such as a spec checked at `approved`, is answered\./);
  });

  test('states the shared matching rule once, for a question asked with options or in prose', () => {
    const shared = textSection(answering, '## Rules');
    assert.match(shared, /Match each question, whether the agent asked it with options or in prose, to an entry's `when`/);
    assert.deepEqual(filesMatching(/to an entry's `when`/), ['ANSWERING.md']);
  });

  test('states the stop points once among the shared rules: the step ends unanswered, even when an entry could be stretched to fit', () => {
    const stops = textSection(answering, '### Stop points');
    assert.match(textSection(answering, '## Rules'), /### Stop points/, 'the stop points are a shared rule');
    assert.match(stops, /where the case's checks expect the agent to stop, such as an approval it must only ask for/i);
    assert.match(stops, /the step ends with the question unanswered/);
    assert.match(stops, /even when an entry such as "accept what it proposes" could be stretched to fit, and even when `turns` has entries not sent yet/);
    for (const rule of [/expect the agent to stop/i, /stretched to fit/]) {
      assert.deepEqual(filesMatching(rule), ['ANSWERING.md'], rule.source);
    }
  });

  test('when no entry fits, each flow has its own short section after the shared rules', () => {
    const noFit = textSection(answering, '## When no entry fits');
    assert.ok(answering.indexOf('## When no entry fits') > answering.indexOf('### Stop points'));
    assert.match(noFit, /the question is \*\*drift\*\*/);
    assert.match(noFit, new RegExp(`^${CONDUCTOR_SECTION}$`, 'm'));
    assert.match(noFit, new RegExp(`^${UNATTENDED_SECTION}$`, 'm'));
  });

  test('with the UAT conductor, a drift answer is proposed for the person to confirm', () => {
    const conductor = textSection(answering, CONDUCTOR_SECTION);
    assert.match(conductor, /the conductor proposes a drift answer for the person to confirm/i);
    assert.doesNotMatch(conductor, /drift: true|the step ends/);
  });

  test('in an unattended run, a question with options gets a drift answer among them recorded with drift: true, and a prose question takes an entry, the agent\'s recommendation as drift, or ends the step', () => {
    const unattended = textSection(answering, UNATTENDED_SECTION);
    assert.match(unattended, /\*\*A question asked with options:\*\* choose a drift answer among its options[^\n]*recorded with `drift: true`/);
    assert.match(unattended, /\*\*A question in prose:\*\*[^\n]*answers each question of the turn, and nothing else/);
    assert.match(unattended, /one an entry fits is answered from that entry, even where the agent recommends otherwise/);
    assert.match(unattended, /recommended answer, takes that recommendation as its drift answer[^\n]*recorded with `drift: true`/);
    assert.match(unattended, /with no recommendation ends the step[^\n]*an invented reply can take the agent past the case/);
    assert.doesNotMatch(unattended, /\bperson\b|confirm/);
  });

  test('states each no-entry-fits case in one file only', () => {
    for (const rule of [/drift answer for the person to confirm/, /drift answer among its options/, /invented reply/]) {
      assert.deepEqual(filesMatching(rule), ['ANSWERING.md'], rule.source);
    }
  });

  test('says what a drift answer is recorded with', () => {
    assert.match(answering, /`when`: the question as asked/);
    assert.match(answering, /`intent`: the answer used/);
    assert.match(answering, /`reason`: why/);
  });
});

describe('the UAT ledger', () => {
  test('Finish names the issue to report, and has the ledger committed together with the run\'s drift', () => {
    const finish = textSection(skill, '## Finish');
    assert.match(finish, /`--issue <n>`/);
    assert.match(finish, /\*\*UAT ledger\*\*, `ledger\.json`/);
    assert.match(finish, /the ledger and the case files changed by drift[^.]*commit them together/i);
    assert.doesNotMatch(skill, /Case files changed by drift are the only changes/);
  });

  test('Start shows the warning init gives for a kit checkout with uncommitted changes', () => {
    const start = textSection(skill, '## Start');
    assert.match(start, /When it prints a `warning`, show it to the person: this checkout has uncommitted changes/);
  });
});

describe('GRADING.md', () => {
  test('step 5 links it and tells the model to read it', () => {
    const grade = textSection(skill, '### 5. Grade');
    assert.match(grade, /Read \[GRADING\.md\]\(GRADING\.md\)/);
  });

  test('step 6 links it for the shape of the grades', () => {
    const save = textSection(skill, '### 6. Save');
    assert.match(save, /\[GRADING\.md\]\(GRADING\.md\)/);
  });

  test('holds the grading rules, and the skill body no longer does', () => {
    for (const rule of [
      /not_proven/,
      /evidence a reader can check/,
      /session log only for a detail the summary leaves out/,
      /skill defect/,
      /environment problem/,
      /deterministic assertions and judgement apart/i,
    ]) {
      assert.deepEqual(filesMatching(rule), ['GRADING.md'], rule.source);
    }
  });

  test('CASE-FORMAT.md sends a judge criterion to it instead of restating how it is graded', () => {
    const judge = textLine(files['CASE-FORMAT.md'], '- `{ "judge": criterion }`');
    assert.match(judge, /\[GRADING\.md\]\(GRADING\.md\)/);
    assert.doesNotMatch(judge, /apart|transcript/);
  });

  test('states the clarity rule among its rules and names every text written for review', () => {
    const clarity = textSection(grading, '### Clarity');
    assert.match(textSection(grading, '## Rules'), /### Clarity/, 'the clarity rule is a grading rule');
    for (const text of [/a case's `line`/, /each criterion's evidence/, /the review of a run/, /the batch's results comment/]) {
      assert.match(clarity, text, text.source);
    }
    assert.match(clarity, /make sense to someone who does not know the kit/);
    assert.match(clarity, /what the skill is for, what was expected and what happened/);
    assert.match(clarity, /no internal identifier unexplained, such as an `AC-n`, a short commit or "condition 3"/);
    assert.deepEqual(filesMatching(/does not know the kit/), ['GRADING.md']);
  });

  test('grades a denial by the permission host that the case did not expect as an environment problem, and never a step with a denial as a Pass', () => {
    const rules = textSection(grading, '## Rules');
    assert.match(rules, /A denial the case did not expect makes the step Not proven, with an environment finding that names it/);
    assert.match(rules, /A step with a denial is never a Pass/);
    assert.deepEqual(filesMatching(/did not expect/), ['GRADING.md']);
    assert.match(files['CASE-FORMAT.md'], /denial[^\n]*\[GRADING\.md\]\(GRADING\.md\)/, 'CASE-FORMAT.md sends a denial to it');
  });

  test('holds the verdict table, and the skill body no longer does', () => {
    assert.deepEqual(filesMatching(/^\| Verdict \| When \|$/m), ['GRADING.md']);
    for (const row of ['Pass', 'Fail', 'Not proven']) {
      assert.deepEqual(filesMatching(new RegExp(`^\\| ${row} \\| `, 'm')), ['GRADING.md'], row);
    }
  });

  test('holds the grades JSON example, and the skill body no longer does', () => {
    assert.deepEqual(filesMatching(/^```json$/m), ['GRADING.md']);
    const example = gradesExample();
    assert.deepEqual(Object.keys(example), ['verdict', 'line', 'judge', 'findings']);
    assert.deepEqual(example.findings.map((f) => f.kind), ['skill', 'environment']);
  });

  test('the grades JSON example is what record --grades takes', (t) => {
    const example = gradesExample();
    const run = makeRun(t, [caseFile('c1', { assertions: example.judge.map((g) => ({ judge: g.criterion })) })]);
    run.cli('next');
    run.cli('check');
    const file = join(run.runDir, 'grades.json');
    writeFileSync(file, JSON.stringify(example));

    const { status, stdout } = run.cli('record', '--grades', file);

    assert.equal(status, 0, stdout);
    const saved = JSON.parse(readFileSync(join(run.runDir, 'results', 'c1.json'), 'utf8'));
    assert.deepEqual(saved.findings, { skill: ['...'], environment: ['...'] });
  });
});

test('the stop points, the no-entry-fits cases and the clarity rule have no copies under skills/', () => {
  const markdown = markdownFiles('skills').map((path) => [path, readFileSync(join(repoRoot, path), 'utf8')]);
  assert.ok(markdown.length > 0, 'the kit has Markdown files to search');
  for (const rule of [
    /expect the agent to stop/i,
    /stretched to fit/,
    /drift answer for the person to confirm/,
    /drift answer among its options/,
    /invented reply/,
    /does not know the kit/,
    /internal identifier/,
  ]) {
    assert.deepEqual(markdown.filter(([, text]) => rule.test(text)).map(([path]) => path), [], rule.source);
  }
});

test("the README's release section names the release gate: due --release must list nothing before tagging", () => {
  const release = textSection(readFileSync(join(repoRoot, 'README.md'), 'utf8'), '### Releases');
  assert.match(release, /semver tag `vX\.Y\.Z`/, 'the section is the one ADR 0015 describes');
  assert.match(release, /[Bb]efore tagging, run `node \.claude\/skills\/uat\/scripts\/run\.mjs due --release`: it must list nothing\./);
});
