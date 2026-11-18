// aw-setup's Confirm step shows the person the set it will write, then asks
// them to approve it (#151). The behaviour is the skill's text, so these tests
// hold that text, in the terms aw-wayfinder's local-markdown setup uses.

import assert from 'node:assert/strict';
import test from 'node:test';

import { skillSection } from './fixtures.mjs';

const confirm = skillSection('aw-setup', '### 3. Confirm', '### 4. Write');

test('the Confirm step shows the set before the confirmation question', () => {
  assert.match(confirm, /Show the user the whole set you will write, before you ask them to confirm:/);
  assert.match(confirm, /Then ask\./);
});

test('the Confirm step puts the set in chat or the question\'s preview, and a tool call does not count', () => {
  assert.match(confirm, /Put it in your chat text or in the confirmation question's preview\./);
  assert.match(confirm, /Output inside a tool call does not count\./);
});

test('the Confirm step shows the block change as a diff, or a new block whole, with the file it goes into', () => {
  assert.match(confirm, /the `## Agent skills` block change \(step 4\) as a diff or, when the block is new, the whole block, with the file it goes into;/);
});

test('the Confirm step shows each adapter and the domain doc with its path, in full when new or replaced, else as a diff', () => {
  assert.match(confirm, /the three adapters and the domain doc, each with its path:/);
  assert.match(confirm, /in full, as it will be written, when the file is new or is replaced from another kind's template;/);
  assert.match(confirm, /when an existing file is edited in place, only the lines that change, as a diff;/);
});

test('the Confirm step still shows the housekeeping changes', () => {
  assert.match(confirm, /the housekeeping changes from \[`HOUSEKEEPING\.md`\]\(HOUSEKEEPING\.md\)\./);
});

test('the Confirm step writes nothing until the person confirms, then step 4 writes the approved set', () => {
  assert.match(confirm, /Write nothing until they confirm, and once they do, step 4 writes the approved set\./);
});

test('the Confirm step lets the person edit and shows each edit before they confirm, and keeps its Done when line', () => {
  assert.match(confirm, /Let them edit, and show each edit the same way before they confirm\./);
  assert.match(confirm, /Done when the user approves the set\./);
});
