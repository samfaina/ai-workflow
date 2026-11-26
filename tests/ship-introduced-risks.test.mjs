// An introduced risk never blocks the merge at merge: write, and aw-ship never
// asks anyone to accept one (#129). Its pre-ship checklist item says what
// happened to it: merged without a person's acceptance when aw-ship merges by
// itself, listed for the person who merges otherwise. The decision is the
// skill's text and ADR 0013, so these tests hold that text.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { repoRoot, skillSection, textLine } from './fixtures.mjs';

const read = (...path) => readFileSync(join(repoRoot, ...path), 'utf8').replaceAll('\r\n', '\n');
const skill = read('skills', 'aw-ship', 'SKILL.md');

const stepFive = skillSection('aw-ship', '### 5. Write the review request body', '### 6. Push and open the review request');

// The two meanings of the item, each true in its own case.
const PERSON_MERGES = 'listed for the person who merges to accept';
const SHIP_MERGED = "merged by `aw-ship` without a person's acceptance, left to review after the merge";

// The rule of the pre-ship checklist on the introduced-risk item.
const riskRule = textLine(stepFive, '- each introduced risk');

test('the checklist item of an introduced risk keeps its text, likelihood and cost, and is never ticked', () => {
  assert.ok(riskRule, 'step 5 lists the introduced-risk item');
  assert.match(riskRule, /likelihood/);
  assert.match(riskRule, /cost/);
  assert.match(riskRule, /always `\[ \]`/);
  assert.match(riskRule, /never tick/i);
});

// The paragraph that words the item, and its bullet for each case.
const wording = stepFive.slice(stepFive.indexOf('**Introduced risks.**'), stepFive.indexOf('**Rollback plan.**'));
function wordingFor(label) {
  return textLine(wording, `- **${label}`);
}

test('a risk never blocks the merge, and aw-ship never asks anyone to accept it', () => {
  assert.match(wording, /A risk never blocks the merge, and this skill never asks the user to accept one, at either merge level \(ADR 0013\)/);
  assert.match(wording, /<what may go wrong>; likelihood <…>; cost <…>/);
});

test('with no review host, the item is for the person who merges until step 7 merges locally', () => {
  const local = wordingFor('With no review host, or at `merge: draft`:');
  assert.ok(local.includes(`write "${PERSON_MERGES}"`), local);
  assert.ok(local.includes(`step 7 replaces those words with "${SHIP_MERGED}"`), local);
  assert.match(local, /When the merge is drafted or fails, they stay true/);
});

test('with a review host, the published item stays true whether aw-ship or a person merges', () => {
  const host = wordingFor('With a review host at `merge: write`:');
  assert.match(host, /when a merge condition already fails, or `push` or `open-review` is at `draft`, a person merges/);
  assert.ok(host.includes(`"${SHIP_MERGED}, if \`aw-ship\` merges this request; ${PERSON_MERGES}, if a person does"`), host);
});

const stepSeven = skillSection('aw-ship', '### 7. Merge', '### 8. Report');
const localMerge = textLine(stepSeven, '- **With no review host:**');

test('after a local merge, step 7 words each risk item as merged without acceptance, in the body and its copy', () => {
  assert.ok(localMerge, 'step 7 has the local merge');
  assert.ok(localMerge.includes(`In each introduced-risk item, replace "${PERSON_MERGES}", or its translation, with "${SHIP_MERGED}", translated the same way`), localMerge);
  assert.match(localMerge, /edit the body file from step 5 and its copy in `\.aw\/drafts\/<yyyymmdd-hhmmss>-open-review\.md`, when step 6 wrote one\. In both, replace/);
  assert.match(localMerge, /The items stay `\[ \]`/);
});

const mergeConditions = skillSection('aw-ship', '## Merge conditions', '## Steps');

test('the merge conditions are unchanged, and say introduced risks are not one of them', () => {
  const conditions = mergeConditions.split('\n').filter((line) => /^\d+\. /.test(line));
  assert.deepEqual(conditions.map((line) => line.match(/^\d+\. \*\*([^*]+)\*\*/)?.[1]), ['No proven defect.', '`full` passed.', 'The spec is proven.']);
  for (const condition of conditions) assert.doesNotMatch(condition, /risk/i);
  assert.match(mergeConditions, /\nIntroduced risks are not a condition: one never blocks the merge, and the checklist and step 8 report it instead\.\n/);
});

const stepEight = skillSection('aw-ship', '### 8. Report');

test('step 8 reports each introduced risk and what happened to it, or that there were none', () => {
  const risks = textLine(stepEight, '- each introduced risk');
  assert.match(risks, /likelihood and cost/);
  assert.match(risks, /merged without a person's acceptance, when this skill merged/);
  assert.match(risks, /left for the person who merges to accept, when the merge was drafted or failed, or `merge` is at `draft`/);
  assert.match(risks, /"no introduced risks"/);
});

const adr = read('docs', 'adr', '0013-routes-and-the-single-fixed-human-gate.md');
const [adrBody, adrOptions] = adr.split('## Considered Options');

test('ADR 0013 records that an introduced risk never blocks the merge, and rejects the two other options of #129', () => {
  assert.match(adrBody, /An introduced risk never blocks the merge at `merge: write`: `aw-ship` reports it instead/);
  const option = (title) => textLine(adrOptions, `- **${title}`);
  for (const title of ['An unaccepted introduced risk drafts the merge', 'Asking the user to accept each introduced risk before the merge']) {
    const line = option(title);
    assert.ok(line, `ADR 0013 considers "${title}"`);
    assert.match(line, /\(#129\): rejected/);
  }
});

test('no wording in aw-ship ticks a risk item or asks the user to accept a risk', () => {
  assert.doesNotMatch(skill, /listed for the user to accept/);
  for (const [ask] of skill.matchAll(/\S+ asks? the user to accept/gi)) assert.match(ask, /^never /, ask);
  assert.doesNotMatch(skill, /\[x\] Introduced risk/);
});
