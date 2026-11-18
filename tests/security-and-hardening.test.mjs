// Seam 3: aw-security-and-hardening's public contract, the text aw-review loads
// and hands to the Security axis's subagent, plus its NOTICE.md row. These
// tests hold the contract ticket #57 names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, textSection } from './fixtures.mjs';

const skillDir = join(repoRoot, 'skills/aw-security-and-hardening');
const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');

test('it states that it is phase-free and the guidance aw-review hands to the Security axis', () => {
  const body = textSection(skill, '## In the Kit', { withHeading: false });
  assert.match(body, /phase-free/);
  assert.match(body, /`aw-review` hands to its Security axis/);
});

test('during a review, findings follow the Findings rules of aw-review', () => {
  const body = textSection(skill, '## In the Kit', { withHeading: false });
  assert.match(body, /`aw-review`'s Findings rules/);
  assert.match(body, /unchecked checklist item or a red flag is a risk unless a run proves a defect/);
});

test('it counts as security what the Security axis counts', () => {
  assert.match(skill, /trust boundaries, secrets, dependencies and personal data/);
});

test('"Ask First" is no human gate: its items go to the spec or back to intake', () => {
  assert.doesNotMatch(skill, /Requires Human Approval/);
  const body = textSection(skill, '### Ask First', { withHeading: false });
  assert.match(body, /the spec's Boundaries section/);
  assert.match(body, /is not fast-route work and goes back to `\/aw-intake`/);
});

test('the "Ask First" items stay', () => {
  const body = textSection(skill, '### Ask First', { withHeading: false });
  for (const item of [
    'Adding new authentication flows or changing auth logic',
    'Storing new categories of sensitive data (PII, payment info)',
    'Adding new external service integrations',
    'Changing CORS configuration',
    'Adding file upload handlers',
    'Modifying rate limiting or throttling',
    'Granting elevated permissions or roles',
  ]) {
    assert.ok(body.includes(`- ${item}`), `missing "${item}"`);
  }
});

test('its scope is any repo, not web applications', () => {
  assert.doesNotMatch(textSection(skill, '## Overview', { withHeading: false }), /for web applications/);
  assert.match(textSection(skill, '## Overview', { withHeading: false }), /any repo, CLIs included/);
  assert.match(textSection(skill, '## Overview', { withHeading: false }), /trust boundaries, secrets, dependencies and destructive operations/);
});

// Each of these lines applies only to web code, so it carries the tag the
// overview defines. Uploads and rate limiting also protect services that are not
// web code, so they stay untagged.
test('web-only lines are tagged, and the core ones are not', () => {
  assert.match(textSection(skill, '## Overview', { withHeading: false }), /tagged \*\*\(web\)\*\* apply when the change touches web code/);
  const assertTagged = (text) => assert.ok(
    skill.split('\n').some((line) => line.includes(text) && line.includes('**(web)**')),
    `no line with "${text}" is tagged`,
  );
  for (const text of [
    '**Encode output**',
    '**Set security headers**',
    '**Use httpOnly, secure, sameSite cookies**',
    'Changing CORS configuration',
    '**Never disable security headers**',
    '**Never store sessions in client-accessible storage**',
    'Encode output through the framework',
    'Session cookies are',
    'Security headers on every response',
    'CORS restricted to an explicit origin list',
    'Missing CORS configuration',
    'Security headers present in response',
    'Reject with 422',
  ]) {
    assertTagged(text);
  }
  for (const line of skill.split('\n')) {
    if (/\*\*(Validate all external input|Parameterize all database queries|Never commit secrets)|upload|rate limit/i.test(line)) {
      assert.doesNotMatch(line, /\(web\)/);
    }
  }
});

test('the review checklist is scoped to the boundaries, since its reference is worded for the web', () => {
  const body = textSection(skill, '## Review Checklist', { withHeading: false });
  assert.match(body, /`references\/security-checklist\.md`/);
  assert.match(body, /worded for web applications/);
  assert.match(body, /trust boundaries, secrets, dependencies, personal data and destructive operations/);
});

test('it asks for no manual browser check', () => {
  assert.doesNotMatch(skill, /DevTools/);
});

test('the dependency audit is a run or a check level, tied to no release and adding no phase or hook', () => {
  assert.doesNotMatch(skill, /every release/);
  const body = textSection(skill, '### Dependencies and supply chain', { withHeading: false });
  assert.match(body, /a run on `aw-review`'s Security axis/);
  assert.match(body, /a check level the repo configures/);
  assert.match(body, /adds no phase and no hook \(ADR 0009\)/);
});

test('the post-implementation list is a self-check, not a gate of its own', () => {
  assert.doesNotMatch(skill, /^## Verification$/m);
  assert.match(textSection(skill, '## Self-Check', { withHeading: false }).trim(), /^After implementing security-relevant code/);
  assert.doesNotMatch(skill, /sign-off/);
});

// GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens.
const anchor = (heading) =>
  heading.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');

test('every link into the references resolves, anchors included', () => {
  const links = [...skill.matchAll(/\]\((references\/[^)#]+)(?:#([^)]+))?\)/g)];
  assert.ok(links.length > 0);
  for (const [, path, fragment] of links) {
    assert.ok(existsSync(join(skillDir, path)), `missing ${path}`);
    if (!fragment) continue;
    const anchors = readFileSync(join(skillDir, path), 'utf8')
      .split('\n')
      .filter((line) => /^#{1,6} /.test(line))
      .map((line) => anchor(line.replace(/^#+ /, '')));
    assert.ok(anchors.includes(fragment), `no anchor #${fragment} in ${path}`);
  }
});

test('the paths aw-review passes to the Security axis exist', () => {
  for (const path of ['references/security-checklist.md', 'references/hardening-patterns.md']) {
    assert.ok(skill.includes(path), `SKILL.md does not name ${path}`);
    assert.ok(existsSync(join(skillDir, path)), `missing ${path}`);
  }
});

test('it keeps its name, stays model-invocable and keeps its triggers', () => {
  const frontmatter = skill.split('---')[1];
  assert.match(frontmatter, /^name: aw-security-and-hardening$/m);
  assert.doesNotMatch(frontmatter, /disable-model-invocation/);
  for (const trigger of [
    'auditing an input handler for vulnerabilities',
    'handling user input, authentication, data storage, or external integrations',
    'checking a login flow is safe against the OWASP Top Ten',
    'accepts untrusted data, manages user sessions or session cookies, or interacts with third-party services',
    'auditing dependencies for known vulnerabilities',
    'triaging package-manager audit findings',
    'assessing supply-chain risk in a new package',
    'personal data or privacy compliance (GDPR, CCPA)',
  ]) {
    assert.ok(frontmatter.includes(trigger), `missing trigger "${trigger}"`);
  }
});

test('the threat model, hardening controls, rationalizations and red flags keep their sections', () => {
  for (const heading of [
    '## Process: Threat Model First',
    '### Always Do (No Exceptions)',
    '### Never Do',
    '### Injection, XSS, and access control',
    '### Authentication and sessions',
    '### Headers, CORS, and responses',
    '### Input validation and uploads',
    '### Server-side fetches (SSRF)',
    '### Destructive operations on derived paths',
    '### Rate limiting',
    '### Secrets',
    '### Dependencies and supply chain',
    '### Personal data and privacy',
    '### AI / LLM features',
    '## Common Rationalizations',
    '## Red Flags',
  ]) {
    assert.ok(textSection(skill, heading, { withHeading: false }).trim().length > 0, `empty section "${heading}"`);
  }
});

test('its NOTICE row stays an adaptation and says what it takes and what it changes', () => {
  const notice = readFileSync(join(repoRoot, 'NOTICE.md'), 'utf8');
  const row = notice.split('\n').find((line) => line.startsWith('| `aw-security-and-hardening` |'));
  assert.ok(row, 'no NOTICE row');
  assert.match(row, /\| adaptation \|$/);
  assert.doesNotMatch(row, /the whole text/);
  for (const taken of ['threat-modeling process', 'hardening controls', 'rationalizations', 'red flags', 'both references']) {
    assert.ok(row.includes(taken), `does not say it takes the ${taken}`);
  }
  for (const changed of ['`aw-review`', 'Ask First', 'web', 'Findings rules', 'dependency audit', 'Self-Check', 'browser check']) {
    assert.ok(row.includes(changed), `does not say what it changes about ${changed}`);
  }
});
