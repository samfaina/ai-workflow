// Seam 4: the fast route's public contract, the text aw-intake classifies from
// and the text aw-build refuses from. These tests hold the contract ticket #64
// names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './fixtures.mjs';

function skillText(skill) {
  return readFileSync(join(repoRoot, 'skills', skill, 'SKILL.md'), 'utf8');
}

function skillLine(skill, start) {
  const line = skillText(skill).split('\n').find((candidate) => candidate.startsWith(start));
  assert.ok(line, `${skill} has no line starting "${start}"`);
  return line;
}

const intakeDefinition = skillLine('aw-intake', '- **fast**:');
const buildRefusal = skillLine('aw-build', 'Refuse to go on, and tell the user to run `/aw-intake` again');
const buildMidBuildStop = skillLine('aw-build', 'When building shows that a done-when criterion is wrong');

// Each Ask First item of aw-security-and-hardening, and the wording that names
// the work behind it.
const askFirstWording = [
  ['Adding new authentication flows or changing auth logic', /authentication/],
  ['Storing new categories of sensitive data (PII, payment info)', /stored data/],
  ['Adding new external service integrations', /a new external service integration/],
  ['Changing CORS configuration', /CORS/],
  ['Adding file upload handlers', /input from outside/],
  ['Modifying rate limiting or throttling', /rate limiting or throttling/],
  ['Granting elevated permissions or roles', /permissions/],
];

test('every Ask First item has its wording here', () => {
  const lines = skillText('aw-security-and-hardening').split('\n');
  const start = lines.indexOf('### Ask First');
  const end = lines.indexOf('### Never Do');
  const items = lines
    .slice(start, end)
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).replace(' **(web)**', ''));
  assert.deepEqual(items, askFirstWording.map(([item]) => item));
});

for (const [skill, text] of [['aw-intake', intakeDefinition], ['aw-build', buildRefusal]]) {
  for (const [item, wording] of askFirstWording) {
    test(`${skill} keeps "${item}" off the fast route`, () => {
      assert.match(text, wording);
    });
  }

  test(`${skill} keeps adding a dependency off the fast route`, () => {
    assert.match(text, /adding a dependency/);
  });

  test(`${skill} keeps a change to how personal data is collected, handled or shared off the fast route`, () => {
    assert.match(text, /how personal data is collected, handled or shared/);
  });

  test(`${skill} says upgrading an existing dependency does not keep a task off the fast route on its own`, () => {
    assert.match(
      skillText(skill),
      /Upgrading an existing dependency does not, on its own, keep a task off the fast route, major versions included/,
    );
  });
}

test('aw-intake says a fast-route diff still goes through the Security axis', () => {
  assert.match(skillText('aw-intake'), /A fast-route diff still goes through `aw-review`'s Security axis/);
});

// What a skill lists in parentheses in its contract and security rules, so that
// an item added to one skill alone fails.
function excludedWork(text) {
  const contract = text.match(/contract \(([^)]*)\)/);
  const security = text.match(/security-related \(([^)]*)\)/);
  assert.ok(contract && security, `no contract or security list in: ${text}`);
  return { contract: contract[1], security: security[1] };
}

test('aw-build refuses the same work aw-intake keeps off the fast route', () => {
  assert.deepEqual(excludedWork(buildRefusal), excludedWork(intakeDefinition));
});

test("aw-build's stop during the build applies the same refusal", () => {
  assert.match(buildMidBuildStop, /needs a change Step 1 refuses/);
});
