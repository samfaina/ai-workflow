// aw-wayfinder sets up a local-markdown tracker when none is configured. Before
// it writes the adapter and the block, the person sees both, then confirms
// (#147). The behaviour is the skill's text, so these tests hold that text.

import assert from 'node:assert/strict';
import test from 'node:test';

import { skillSection } from './fixtures.mjs';

const tracker = skillSection('aw-wayfinder', '## The tracker', '## The map');

// The local-markdown setup's numbered step that shows the change and asks.
function showStep() {
  const line = tracker.split('\n').find((candidate) => /^\d+\. Show the user/.test(candidate));
  assert.ok(line, 'The tracker has no "Show the user" step');
  return line;
}

test('the show step names the filled adapter in full with its path, and the block diff or new block with its file', () => {
  const step = showStep();
  assert.match(step, /the filled adapter in full, as it will be written, with its path/);
  assert.match(step, /the block change as a diff/);
  assert.match(step, /when the block is new, the whole block/);
  assert.match(step, /with the file it goes into/);
});

test('the show step puts it in chat or the question\'s preview, and a tool call alone does not count', () => {
  const step = showStep();
  assert.match(step, /in your chat text or in the confirmation question's preview/);
  assert.match(step, /inside a tool call does not count/);
});

test('the show step comes before the confirmation question, and nothing is written until the person confirms', () => {
  const step = showStep();
  assert.match(step, /before you ask them to confirm/);
  assert.match(step, /nor does anything shown after the question/);
  assert.match(step, /write nothing until they confirm/);
});
