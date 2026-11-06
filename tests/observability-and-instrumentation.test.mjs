// Seam 5: aw-observability-and-instrumentation's public contract, the text an
// agent loads when the skill triggers and the places in the kit that name it.
// These tests hold the contract ticket #58 names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './fixtures.mjs';

const skillDir = join(repoRoot, 'skills/aw-observability-and-instrumentation');
const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');

// The body of the `## ` section with this exact heading.
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `no heading "${heading}"`);
  const end = lines.findIndex((line, i) => i > start && /^#{1,2} /.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

test('it states that it is phase-free: no phase requires it and it creates no gate', () => {
  const body = section(skill, '## In the Kit');
  assert.match(body, /phase-free/);
  assert.match(body, /no phase requires it/i);
  assert.match(body, /creates no gate/);
});

const checklist = readFileSync(join(skillDir, 'references/observability-checklist.md'), 'utf8');

test('neither file names an upstream skill the kit does not ship, or the shared references', () => {
  for (const text of [skill, checklist]) {
    for (const name of ['debugging-and-error-recovery', 'performance-optimization', 'shipping-and-launch', '../../references/']) {
      assert.ok(!text.includes(name), `still names ${name}`);
    }
  }
});

test('its own name and the security skill carry the aw- prefix in both files', () => {
  // The credit line names the upstream skill, as it should.
  for (const text of [skill.split('## Credits')[0], checklist]) {
    assert.doesNotMatch(text, /(?<!aw-)observability-and-instrumentation/);
    assert.doesNotMatch(text, /(?<!aw-)security-and-hardening/);
    assert.match(text, /`aw-security-and-hardening`/);
  }
  assert.match(checklist, /`aw-observability-and-instrumentation`/);
});

test('debugging goes to aw-diagnosing-bugs, whose instrumentation is temporary while this telemetry stays', () => {
  const body = section(skill, '## When to Use');
  assert.match(body, /`aw-diagnosing-bugs`/);
  assert.match(body, /`\[DEBUG-\.\.\.\]` instrumentation is temporary and gets removed/);
  assert.match(body, /the telemetry this skill adds stays/);
});

test('performance goes to a performance task through /aw-intake, whose pre-step measures the baseline', () => {
  assert.match(section(skill, '## When to Use'), /performance task through `\/aw-intake`, whose pre-step measures the baseline/);
});

test('rollback triggers go to the rollback plan of /aw-ship, and launch-day monitoring is gone', () => {
  assert.match(section(skill, '## When to Use'), /Rollback triggers.*`\/aw-ship`'s rollback plan/);
  assert.match(checklist, /`\/aw-ship`'s rollback plan/);
  for (const text of [skill, checklist]) {
    assert.doesNotMatch(text, /launch-day/i);
  }
});

test('the checklist has a self-check for repos that run in production, not a gate before shipping', () => {
  assert.doesNotMatch(checklist, /\bgate\b/i);
  assert.doesNotMatch(checklist, /Before a feature ships/);
  for (const text of [skill, checklist]) {
    assert.doesNotMatch(text, /pre-launch/i);
  }
  assert.match(checklist, /^- \[Self-Check\]\(#self-check\)$/m);
  const body = section(checklist, '## Self-Check');
  assert.match(body.trim(), /^For a repo that runs in production/);
  for (const item of [
    'Structured logs flowing to the log aggregator',
    'At least one symptom-based alert configured, with runbook, test-fired',
    'On-call knows where the runbooks are',
  ]) {
    assert.ok(body.includes(`- [ ] ${item}`), `missing "${item}"`);
  }
});

test('SKILL.md points at the checklist in its own references', () => {
  assert.match(section(skill, '## Verification'), /`references\/observability-checklist\.md`/);
});

const frontmatter = skill.split('---')[1];

test('it is model-invoked: no invocation flag in the frontmatter and no agents/openai.yaml', () => {
  assert.match(frontmatter, /^name: aw-observability-and-instrumentation$/m);
  assert.doesNotMatch(frontmatter, /disable-model-invocation/);
  assert.ok(!existsSync(join(skillDir, 'agents/openai.yaml')));
});

test('its triggers cover changing telemetry and an incident the existing telemetry could not explain', () => {
  assert.match(frontmatter, /adding or changing logs, metrics, traces, or alerts/);
  assert.match(frontmatter, /a production incident the existing telemetry couldn't explain/);
  const body = section(skill, '## When to Use');
  assert.match(body, /Adding or changing logs, metrics, traces, or alerts/);
  assert.match(body, /A production incident the existing telemetry couldn't explain/);
});

test('it drops the triggers that compete with phase owners or aw-diagnosing-bugs', () => {
  const triggers = `${frontmatter}\n${section(skill, '## When to Use')}`;
  for (const dropped of [
    /shipping any feature/i,
    /production issues are reported/i,
    /reviewing a PR/i,
    /building any feature that will run in production/i,
  ]) {
    assert.doesNotMatch(triggers, dropped);
  }
});

test('it carries the upstream license, and the sections it keeps from upstream stay', () => {
  assert.match(readFileSync(join(skillDir, 'LICENSE.upstream'), 'utf8'), /MIT License[\s\S]*Addy Osmani/);
  for (const heading of ['## Process', '## Common Rationalizations', '## Red Flags', '## Verification']) {
    assert.ok(section(skill, heading).trim().length > 0, `empty section "${heading}"`);
  }
  for (const heading of ['### 1. Define "working" before instrumenting', '### 3. Structured logging', '### 6. Alerting', '### 7. Verify the telemetry itself']) {
    assert.ok(skill.split('\n').includes(heading), `missing "${heading}"`);
  }
});

test('it credits its upstream', () => {
  assert.match(section(skill, '## Credits'), /Adapted from Addy Osmani's `observability-and-instrumentation` \(MIT\)/);
});

const repoText = (path) => readFileSync(join(repoRoot, path), 'utf8');
const noticeRow = (name) => {
  const row = repoText('NOTICE.md').split('\n').find((line) => line.startsWith(`| \`${name}\` |`));
  assert.ok(row, `no NOTICE row for ${name}`);
  return row;
};

test('plugin.json lists it', () => {
  assert.ok(JSON.parse(repoText('.claude-plugin/plugin.json')).skills.includes('./skills/aw-observability-and-instrumentation'));
});

test('it says "review request" or "change", not the "PR" the glossary avoids', () => {
  for (const text of [skill, checklist]) {
    assert.doesNotMatch(text, /\bPR\b/);
  }
});

test('aw-security-and-hardening points to it on the telemetry line, and not to the debugging skill', () => {
  const security = repoText('skills/aw-security-and-hardening/SKILL.md');
  const line = security.split('\n').find((candidate) => candidate.includes('Keep PII out of telemetry'));
  assert.match(line, /`aw-observability-and-instrumentation`/);
  assert.doesNotMatch(security, /debugging-and-error-recovery/);
});

test('the NOTICE row of aw-security-and-hardening no longer says the kit does not ship this skill', () => {
  const row = noticeRow('aw-security-and-hardening');
  assert.doesNotMatch(row, /observability-and-instrumentation/);
  assert.match(row, /`debugging-and-error-recovery`, which it does not ship/);
});

test('its NOTICE row is an adaptation at the pin and says what it takes and what it changes', () => {
  const row = noticeRow('aw-observability-and-instrumentation');
  assert.match(row, /\| adaptation \|$/);
  assert.match(row, /`skills\/observability-and-instrumentation`/);
  assert.match(row, /`references\/observability-checklist\.md`/);
  assert.match(row, /\[`301b02b`\]/);
  for (const taken of ['process', 'rationalizations', 'red flags', 'checklist']) {
    assert.ok(row.includes(taken), `does not say it takes the ${taken}`);
  }
  for (const changed of ['phase-free', '`aw-diagnosing-bugs`', '`/aw-intake`', '`/aw-ship`', 'launch-day monitoring', 'Self-Check', 'triggers']) {
    assert.ok(row.includes(changed), `does not say what it changes about ${changed}`);
  }
});

test('the NOTICE opening names it among the adaptations that carry the license', () => {
  const opening = repoText('NOTICE.md').split('\n').find((line) => line.startsWith('This file lists every skill'));
  assert.match(opening, /`aw-observability-and-instrumentation`[^.]*LICENSE.upstream/);
});

test('the glossary defines a phase-free skill in the wording of the decision', () => {
  const glossary = repoText('GLOSSARY.md');
  assert.match(glossary, /^\*\*Phase-free skill\*\*:$/m);
  const definition = glossary.split('**Phase-free skill**:\n')[1].split('\n\n')[0];
  assert.match(definition, /an optional skill/);
  assert.match(definition, /no route, phase or gate requires it/);
  assert.match(definition, /no ship or merge condition depends on it having run/);
  assert.match(definition, /no install switch and no `aw-setup` question/);
});

test('ADR 0010 lists it among the phase-free adaptations', () => {
  const adr = repoText('docs/adr/0010-one-owner-per-phase-and-slices-in-the-spec.md');
  assert.match(adr, /`aw-observability-and-instrumentation`[^.]*phase-free adaptation/);
});

test('the README status paragraph describes it', () => {
  const status = repoText('README.md').split('\n').find((line) => line.startsWith('> Status:'));
  assert.match(status, /`aw-observability-and-instrumentation`, /);
});
