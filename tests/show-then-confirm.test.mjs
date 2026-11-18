// Steps that show the person something and then ask them to confirm it say
// where to show it: in the chat text or the confirmation question's preview,
// never only inside a tool call (#152). aw-wayfinder's show step and aw-setup's
// Confirm step hold the same sentences (#147, #151). The behaviour is each
// skill's text, so these tests hold that text, one block per skill.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { skillSection } from './fixtures.mjs';

const WHERE = /Put it in your chat text or in the confirmation question's preview\./;
const NOT_A_TOOL_CALL = /Output inside a tool call does not count\./;
const THEN_ASK = /Then ask\b/;
const EDITS = /show each edit the same way before they confirm\./i;

// The text of `section` from the paragraph that starts with `from` up to, but
// not including, the one that starts with `to`.
function paragraphs(section, from, to) {
  const start = section.indexOf(from);
  assert.notEqual(start, -1, `The section has no paragraph starting "${from}"`);
  const end = section.indexOf(to, start + 1);
  assert.notEqual(end, -1, `The section has no paragraph starting "${to}" after "${from}"`);
  return section.slice(start, end);
}

function assertShownBeforeAsking(text) {
  assert.match(text, WHERE);
  assert.match(text, NOT_A_TOOL_CALL);
  assert.match(text, THEN_ASK);
  assert.ok(
    text.search(WHERE) < text.search(THEN_ASK),
    'The step asks before it says where to show the content',
  );
}

describe('aw-setup, interview section C. Checks', () => {
  const checks = paragraphs(
    skillSection('aw-setup', '### 2. Interview', '### 3. Confirm'),
    '**C. Checks.**',
    '**D. Domain docs.**',
  );

  test('shows the proposed commands and where each came from in chat or the question\'s preview, then asks', () => {
    assert.match(checks, /Show the proposed commands and where each came from\./);
    assertShownBeforeAsking(checks);
  });

  test('lets the person confirm or edit each command, and shows each edit the same way before they confirm', () => {
    assert.match(checks, /let the user confirm or edit each one/);
    assert.match(checks, EDITS);
  });

  test('keeps the rest of the step', () => {
    assert.match(checks, /A level with no command is recorded as `none`; it is reported as not run, never as passed\./);
  });
});

describe('aw-slices, step 5. Agree the plan and the seams', () => {
  const agree = skillSection('aw-slices', '### 5. Agree the plan and the seams', '### 6. Write them into the spec');

  test('shows the plan and the seams in chat or the question\'s preview, then asks', () => {
    assert.match(agree, /Show the plan and the seams before you ask\./);
    assertShownBeforeAsking(agree);
  });

  test('shows each edit the same way before the person confirms it, while iterating', () => {
    assert.match(agree, /Iterate until the user agrees the plan and every seam/);
    assert.match(agree, EDITS);
  });

  test('keeps the rest of the step', () => {
    assert.match(agree, /A seam the user has not agreed is not written down\./);
    assert.match(agree, /Done when the user has agreed the plan and the seams in this conversation\./);
  });
});

describe('aw-wizard, step 1. Scope the procedure', () => {
  const scope = skillSection('aw-wizard', '### 1. Scope the procedure', '### 2. Map each stage\'s journey');

  test('shows the ordered stages and their values in chat or the question\'s preview, then asks', () => {
    assert.match(scope, /Then show the user the ordered list of stages and the values each produces\./);
    assertShownBeforeAsking(scope);
  });

  test('lets the person add, drop or reorder stages, and shows each edit the same way before they confirm', () => {
    assert.match(scope, /they may add, drop, or reorder/);
    assert.match(scope, EDITS);
  });

  test('keeps the rest of the step', () => {
    assert.match(scope, /\*\*Done when:\*\* every stage is named in order/);
  });
});

describe('aw-tdd, Seams: where tests go', () => {
  const seams = skillSection('aw-tdd', '## Seams: where tests go', '## Anti-patterns');

  test('writes down the seams in chat or the question\'s preview before confirming them', () => {
    assert.match(seams, /Before writing any test, write down the seams under test and show the list to the user\./);
    assertShownBeforeAsking(seams);
    assert.match(seams, /Then ask the user to confirm the seams\./);
  });

  test('keeps the rest of the section', () => {
    assert.match(seams, /No test is written at an unconfirmed seam\./);
    assert.match(seams, /Ask: "What's the public interface, and which seams should we test\?"/);
  });
});
