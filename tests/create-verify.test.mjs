// aw-create-verify's public contract, the text an agent follows to write a repo's
// verify skill, and the UAT case that grades a real run of it. These tests hold
// the contract ticket #88 names. Only that UAT case proves a generated skill.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './fixtures.mjs';

const skillDir = join(repoRoot, 'skills/aw-create-verify');
const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
const template = readFileSync(join(skillDir, 'VERIFY-TEMPLATE.md'), 'utf8');

// The text under this exact heading, up to the next heading of the same or a
// higher level.
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `no heading "${heading}"`);
  const level = heading.match(/^#+/)[0].length;
  const end = lines.findIndex((line, i) => i > start && (line.match(/^#+(?= )/)?.[0].length ?? 99) <= level);
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

const introduction = skill.slice(skill.indexOf('# Create verify'), skill.indexOf('## Configuration'));
const step1 = section(skill, '### 1. Find the app');
const step3 = section(skill, '### 3. Write the verify skill');
const step4 = section(skill, '### 4. Run it once end to end');
const templateIntro = template.slice(template.indexOf('# Verify <app>'), template.indexOf('## Start'));
const templateStart = section(template, '## Start');
const templateCleanUp = section(template, '## Clean up');

// The bullet of step 2 that describes this operation.
function operation(name) {
  const line = skill.split('\n').find((candidate) => candidate.startsWith(`- **${name}:**`));
  assert.ok(line, `step 2 has no operation "${name}"`);
  return line;
}

test('a citation is opened and confirmed before it is written, and carries the text it cites', () => {
  assert.match(introduction, /open the file and confirm the line holds what you cite/i);
  assert.match(introduction, /quoted/i);
  assert.match(step3, /each citation quotes its text/i);
  assert.match(templateIntro, /every `file:line` citation quotes the text it cites/i);
});

test('updating a verify skill re-checks the citations it keeps', () => {
  assert.match(step1, /re-check every citation it keeps against its file/i);
});

test('step 4 re-reads every citation against its file before the commit', () => {
  assert.match(step4, /re-read every citation in the skill against its file/i);
  assert.match(step4.split('\n').filter((line) => line.startsWith('Done when')).join(''), /every citation matched its file/i);
});

test('Start records a process identity: the process id with its command line or start time', () => {
  for (const text of [operation('Start'), templateStart]) {
    assert.match(text, /process identity/i);
    assert.match(text, /command line or start time/i);
  }
});

test('Clean up signals a process only when its identity matches, and reports a mismatch', () => {
  for (const text of [operation('Clean up'), templateCleanUp]) {
    assert.match(text, /signal only on a match/i);
    assert.match(text, /on a mismatch, signal nothing and report it/i);
    assert.match(text, /same kind of process id/i);
  }
});

test('the template warns that a Git Bash PID is not the PID taskkill expects', () => {
  assert.match(templateCleanUp, /`\$!` is an MSYS PID/);
  assert.match(templateCleanUp, /`taskkill` expects a Windows PID/);
});

test('neither file ties stopping a process to its port', () => {
  for (const text of [skill, template]) {
    for (const sentence of text.split(/(?<=[.:;])\s/)) {
      assert.doesNotMatch(sentence, /\b(kill|taskkill|fuser)\b.*\bport\b|\bport\b.*\b(kill|taskkill|fuser)\b/i, sentence);
    }
  }
});

test('the fix for a port in use leaves the process holding it alone', () => {
  for (const text of [operation('Diagnose'), section(template, '## Diagnose')]) {
    assert.match(text, /port in use leaves the process holding it alone/i);
    assert.match(text, /report what holds it and stop, or use another port where the app allows one/i);
  }
});

test('Start checks the port first and records the ports this run took', () => {
  for (const text of [operation('Start'), templateStart]) {
    assert.match(text, /checks? the port (first|before)/i);
    assert.match(text, /ports this run took/i);
  }
});

test('the end-of-run port check covers only the ports this run took', () => {
  assert.match(step4, /no port this run took is still held/i);
  assert.match(step4, /a dev server the user already had running does not fail the check/i);
  assert.match(templateCleanUp, /no port this run took is still held/i);
  assert.doesNotMatch(step4, /no port it used/i);
  assert.doesNotMatch(templateCleanUp, /no port is still held/i);
});

test('a port held by something else, with no other port to use, stops the run', () => {
  assert.match(step4, /when the port Start needs is held by something this run did not start and the app allows no other/i);
});

test('a skill that writes shell scripts gets a .gitattributes in its own folder that keeps them LF', () => {
  assert.match(step3, /`\.claude\/skills\/verify-<app>\/\.gitattributes`/);
  assert.match(step3, /`\*\.sh text eol=lf`/);
  assert.match(step3, /leave its root `\.gitattributes` alone/i);
  assert.match(step3.split('\n').filter((line) => line.startsWith('Done when')).join(''), /\.gitattributes/);
});

test('the UAT case judges quoted citations, port handling and LF scripts on a real run', () => {
  const uatCase = JSON.parse(readFileSync(join(repoRoot, '.claude/skills/uat/cases/aw-create-verify.json'), 'utf8'));
  const judges = uatCase.assertions.filter((a) => a.judge).map((a) => a.judge);
  assert.ok(judges.some((j) => /citation/i.test(j) && /quot/i.test(j)), 'no judge for quoted citations');
  assert.ok(judges.some((j) => /by (its )?port/i.test(j)), 'no judge for killing by port');
  assert.ok(judges.some((j) => /shell script/i.test(j) && /eol: lf/.test(j)), 'no judge for LF shell scripts');
});
