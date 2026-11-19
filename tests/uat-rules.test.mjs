// The UAT conductor's rules for proposing answers and for grading live in two
// reference files beside the /uat skill, so a caller that never sees the
// conductor's procedure can follow them too (#156). The behaviour is each
// file's text, so these tests hold that text.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { textSection } from './fixtures.mjs';
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
  const commands = [...skill.matchAll(/`((?:reader\.mjs )?(?:init|next|skip|watch|pick|check|drift|peek|summary|record|report|clean)(?![.\w])[^`]*)`/g)]
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
    'check',
    'reader.mjs summary --step <stepDir>',
    'record --grades <file>',
    'report',
    'clean',
  ]);
});

for (const name of ['ANSWERING.md', 'GRADING.md']) {
  test(`${name} reads without the conductor's procedure: no person, hecho, pregunta or peek`, () => {
    assert.doesNotMatch(files[name], /\bperson\b|hecho|pregunta|peek/i);
  });
}

describe('ANSWERING.md', () => {
  test('step 3 links it and tells the model to read it', () => {
    const propose = textSection(skill, '### 3. Propose answers');
    assert.match(propose, /Read \[ANSWERING\.md\]\(ANSWERING\.md\)/);
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
    assert.match(answering, /the first entry of `turns` not sent yet/);
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
    const judge = files['CASE-FORMAT.md'].split('\n').find((line) => line.startsWith('- `{ "judge": criterion }`'));
    assert.match(judge, /\[GRADING\.md\]\(GRADING\.md\)/);
    assert.doesNotMatch(judge, /apart|transcript/);
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
