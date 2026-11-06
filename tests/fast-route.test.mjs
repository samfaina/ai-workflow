// The fast route's public contract: the text aw-intake classifies from and the
// text aw-build refuses from. These tests hold the contract ticket #64 names.

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

// Each Ask First item of aw-security-and-hardening, and the words that name the
// work behind it.
const askFirstWork = [
  ['Adding new authentication flows or changing auth logic', /authentication/],
  ['Storing new categories of sensitive data (PII, payment info)', /stored data/],
  ['Adding new external service integrations', /a new external service integration/],
  ['Changing CORS configuration', /CORS/],
  ['Adding file upload handlers', /input from outside/],
  ['Modifying rate limiting or throttling', /rate limiting or throttling/],
  ['Granting elevated permissions or roles', /permissions/],
];

for (const [item, work] of askFirstWork) {
  test(`aw-intake keeps "${item}" off the fast route`, () => {
    assert.match(intakeDefinition, work);
  });
}

test('aw-intake keeps adding a dependency off the fast route', () => {
  assert.match(intakeDefinition, /adding a dependency/);
});

test('aw-intake keeps a change to how personal data is collected, handled or shared off the fast route', () => {
  assert.match(intakeDefinition, /how personal data is collected, handled or shared/);
});

test('aw-intake says upgrading an existing dependency does not keep a task off the fast route on its own', () => {
  const intake = skillText('aw-intake');
  assert.match(intake, /Upgrading an existing dependency does not, on its own, keep a task off the fast route/);
  assert.match(intake, /major versions included/);
});

test('aw-intake says a fast-route diff still goes through the Security axis', () => {
  assert.match(skillText('aw-intake'), /a fast-route diff still goes through `aw-review`'s Security axis/);
});

const buildRefusal = skillLine('aw-build', 'Refuse to go on, and tell the user to run `/aw-intake` again');

for (const [item, work] of askFirstWork) {
  test(`aw-build refuses a fast-route task that reaches "${item}"`, () => {
    assert.match(buildRefusal, work);
  });
}

test('aw-build refuses a fast-route task that adds a dependency', () => {
  assert.match(buildRefusal, /adding a dependency/);
});

test('aw-build refuses a fast-route task that changes how personal data is collected, handled or shared', () => {
  assert.match(buildRefusal, /how personal data is collected, handled or shared/);
});

test('aw-build does not refuse a fast-route task only for upgrading an existing dependency', () => {
  assert.match(buildRefusal, /Upgrading an existing dependency does not, on its own, keep a task off the fast route/);
});

// What each skill lists in parentheses after "security-related" and in its
// contract rule, so that an item added to one skill alone fails.
function excludedWork(text) {
  const contract = text.match(/contract \(([^)]*)\)/);
  const security = text.match(/security-related \(([^)]*)\)/);
  assert.ok(contract && security, `no contract or security list in: ${text}`);
  return { contract: contract[1], security: security[1] };
}

test('aw-build refuses the same work aw-intake keeps off the fast route', () => {
  assert.deepEqual(excludedWork(buildRefusal), excludedWork(intakeDefinition));
});
