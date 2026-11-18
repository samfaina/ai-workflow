// aw-setup's Confirm step shows the person the set it will write, then asks
// them to approve it (#151). The behaviour is the skill's text, so these tests
// hold that text, in the terms aw-wayfinder's local-markdown setup uses.

import assert from 'node:assert/strict';
import test from 'node:test';

import { skillSection } from './fixtures.mjs';

const confirm = skillSection('aw-setup', '### 3. Confirm', '### 4. Write');

test('the Confirm step shows the set before the confirmation question', () => {
  assert.match(confirm, /Show the user what you will write, together, before you ask them to confirm:/);
  assert.match(confirm, /Then ask\./);
});

test('the Confirm step puts the set in chat or the question\'s preview, and a tool call does not count', () => {
  assert.match(confirm, /Put it in your chat text or in the confirmation question's preview\./);
  assert.match(confirm, /Output inside a tool call does not count\./);
});

test('the Confirm step shows each file with its path, in full when new and as a diff on a re-run', () => {
  assert.match(confirm, /the `## Agent skills` block \(step 4\), with the file it goes into;/);
  assert.match(confirm, /the three adapters and the domain doc in full, as they will be written, each with its path/);
  assert.match(confirm, /on a re-run, only the lines that change, as a diff with the file's path;/);
  assert.match(confirm, /the housekeeping changes from \[`HOUSEKEEPING\.md`\]\(HOUSEKEEPING\.md\)\./);
});

test('the Confirm step writes nothing until the person confirms, then step 4 writes the approved set', () => {
  assert.match(confirm, /Write nothing until they confirm, and once they do, step 4 writes the approved set\./);
});

test('the Confirm step keeps letting the person edit, and its Done when line', () => {
  assert.match(confirm, /Let them edit\./);
  assert.match(confirm, /Done when the user approves the set\./);
});
