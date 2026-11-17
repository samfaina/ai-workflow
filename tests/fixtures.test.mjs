// The shared helper that reads a section of a skill's text: what skillSection
// returns, and that it fails naming the heading it could not find (#136).

import assert from 'node:assert/strict';
import test from 'node:test';

import { skillSection } from './fixtures.mjs';

test('skillSection returns a skill\'s text from one heading line up to the next named one, or to the end', () => {
  const conditions = skillSection('aw-ship', '## Merge conditions', '## Steps');
  assert.ok(conditions.startsWith('## Merge conditions\n'), conditions);
  assert.ok(conditions.includes('\n1. **No proven defect.**'), conditions);
  assert.ok(conditions.endsWith('never bypass the host with an admin or force option.\n\n'), conditions);
  assert.ok(!conditions.includes('## Steps'), conditions);
  assert.ok(!conditions.includes('\r'), 'line endings are normalized');

  const report = skillSection('aw-ship', '### 8. Report');
  assert.ok(report.startsWith('### 8. Report\n'), report);
  assert.ok(!report.includes('### 7. Merge'), report);

  const template = skillSection('aw-create-verify/VERIFY-TEMPLATE.md', '# Verify <app>', '## Start');
  assert.ok(template.startsWith('# Verify <app>\n'), template);
});

test('skillSection throws, naming the heading, when a heading is not found', () => {
  assert.throws(() => skillSection('aw-ship', '### 9. Celebrate', '### 8. Report'), /"### 9\. Celebrate"/);
  assert.throws(() => skillSection('aw-ship', '### 7. Merge', '### 9. Celebrate'), /"### 9\. Celebrate"/);
  // A heading counts only after the one it ends, never before it.
  assert.throws(() => skillSection('aw-ship', '### 8. Report', '### 7. Merge'), /"### 7\. Merge"/);
  // A heading is a whole line: a prefix of one is not found.
  assert.throws(() => skillSection('aw-ship', '### 7. Mer'), /"### 7\. Mer"/);
});
