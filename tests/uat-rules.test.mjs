// The UAT conductor's rules for proposing answers and for grading live in two
// reference files beside the /uat skill, so a caller that never sees the
// conductor's procedure can follow them too (#156). The behaviour is each
// file's text, so these tests hold that text.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { textSection } from './fixtures.mjs';
import { makeRun, skillDir } from './uat-fixtures.mjs';

const read = (name) => readFileSync(join(skillDir, name), 'utf8').replaceAll('\r\n', '\n');

const skill = read('SKILL.md');
const answering = read('ANSWERING.md');
const grading = read('GRADING.md');

// Every place `pattern` matches across the skill's Markdown files, one file
// name per match.
function copies(pattern) {
  const files = { 'SKILL.md': skill, 'ANSWERING.md': answering, 'GRADING.md': grading, 'CASE-FORMAT.md': read('CASE-FORMAT.md') };
  return Object.entries(files).flatMap(([name, text]) => (text.match(new RegExp(pattern, 'gi')) ?? []).map(() => name));
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
    'drift --when <the question> --intent <the answer used> --reason <why>',
    'reader.mjs peek --step <stepDir>',
    'check',
    'reader.mjs summary --step <stepDir>',
    'record --grades <file>',
    'report',
    'clean',
  ]);
});

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
      assert.deepEqual(copies(rule.source), ['ANSWERING.md'], rule.source);
    }
  });

  test('says what a drift answer is recorded with', () => {
    assert.match(answering, /`when`: the question as asked/);
    assert.match(answering, /`intent`: the answer used/);
    assert.match(answering, /`reason`: why/);
  });

  test('reads without the conductor\'s procedure: no person, hecho, pregunta or peek', () => {
    assert.doesNotMatch(answering, /\bperson\b|hecho|pregunta|peek/i);
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
      assert.deepEqual(copies(rule.source), ['GRADING.md'], rule.source);
    }
  });

  test('CASE-FORMAT.md sends a judge criterion to it instead of restating how it is graded', () => {
    const judge = read('CASE-FORMAT.md').split('\n').find((line) => line.startsWith('- `{ "judge": criterion }`'));
    assert.match(judge, /\[GRADING\.md\]\(GRADING\.md\)/);
    assert.doesNotMatch(judge, /apart|transcript/);
  });

  test('holds the verdict table, and the skill body no longer does', () => {
    const table = /^\| Verdict \| When \|$/m;
    assert.match(grading, table);
    assert.doesNotMatch(skill, table);
    for (const row of ['Pass', 'Fail', 'Not proven']) {
      assert.deepEqual(copies(`\\n\\| ${row} \\| `), ['GRADING.md'], row);
    }
  });

  test('holds the grades JSON example, and the skill body no longer does', () => {
    assert.doesNotMatch(skill, /```json/);
    const example = gradesExample();
    assert.deepEqual(Object.keys(example), ['verdict', 'line', 'judge', 'findings']);
    assert.deepEqual(example.findings.map((f) => f.kind), ['skill', 'environment']);
  });

  test('the grades JSON example is what record --grades takes', (t) => {
    const example = gradesExample();
    const run = makeRun(t, [{
      id: 'c1', title: 'c1', group: 'g', from: { ref: 'uat/start' }, command: '/c1', shell: [], answers: [], turns: [],
      assertions: example.judge.map((g) => ({ judge: g.criterion })),
    }]);
    run.cli('next');
    run.cli('check');
    const file = join(run.runDir, 'grades.json');
    writeFileSync(file, JSON.stringify(example));

    const { status, stdout } = run.cli('record', '--grades', file);

    assert.equal(status, 0, stdout);
    const saved = JSON.parse(readFileSync(join(run.runDir, 'results', 'c1.json'), 'utf8'));
    assert.deepEqual(saved.findings, { skill: ['...'], environment: ['...'] });
  });

  test('reads without the conductor\'s procedure: no person, hecho, pregunta or peek', () => {
    assert.doesNotMatch(grading, /\bperson\b|hecho|pregunta|peek/i);
  });
});
