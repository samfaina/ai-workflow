// The shared helper that reads a section of a skill's text: what skillSection
// returns, and that it fails naming the heading it could not find (#136).

import assert from 'node:assert/strict';
import test from 'node:test';

import { skillSection, textSection } from './fixtures.mjs';

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

// textSection cuts a text at its own headings (#141).
const outline = [
  '# Title',
  'intro',
  '## First',
  'one',
  '### Deeper',
  'deep',
  '## Second',
  'two',
  '### Last',
  'last',
  '',
].join('\n');

test('textSection returns a text from a heading line up to the next heading of its level or above, or to the end', () => {
  assert.equal(textSection(outline, '## First'), '## First\none\n### Deeper\ndeep');
  assert.equal(textSection(outline, '### Deeper'), '### Deeper\ndeep');
  assert.equal(textSection(outline, '### Last'), '### Last\nlast\n');
  assert.equal(textSection(outline, '# Title'), outline);
});

test('textSection never ends at a heading-like line inside a code fence', () => {
  const fenced = ['## Process', 'step', '```markdown', '# Runbook', '## Inside', '```', 'after', '## Next', 'next'].join('\n');
  assert.equal(textSection(fenced, '## Process'), '## Process\nstep\n```markdown\n# Runbook\n## Inside\n```\nafter');
});

test('textSection leaves the heading line out with withHeading: false', () => {
  assert.equal(textSection(outline, '## First', { withHeading: false }), 'one\n### Deeper\ndeep');
  assert.equal(textSection(outline, '### Last', { withHeading: false }), 'last\n');
});

test('textSection normalizes line endings to \\n', () => {
  assert.equal(textSection('## A\r\na\r\n## B\r\nb\r\n', '## A'), '## A\na');
});

test('textSection throws, naming the heading, when the heading is not found', () => {
  assert.throws(() => textSection(outline, '## Third'), /"## Third"/);
  // A heading is a whole line: a prefix of one is not found.
  assert.throws(() => textSection(outline, '## Fir'), /"## Fir"/);
});
