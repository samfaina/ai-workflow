// aw-benchmark-checklist's public contract, the text an agent loads when the
// skill triggers and the places in the kit that name it. These tests hold the
// contract ticket #78 names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './fixtures.mjs';

const skillDir = join(repoRoot, 'skills/aw-benchmark-checklist');
const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
const frontmatter = skill.split('---')[1];

// The body of the `## ` section with this exact heading.
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `no heading "${heading}"`);
  const end = lines.findIndex((line, i) => i > start && /^#{1,2} /.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

test('it is model-invoked: no invocation flag and no agents/openai.yaml', () => {
  assert.match(frontmatter, /^name: aw-benchmark-checklist$/m);
  assert.doesNotMatch(frontmatter, /disable-model-invocation/);
  assert.ok(!existsSync(join(skillDir, 'agents/openai.yaml')));
});

test('it states that it is phase-free and optional: no phase calls it and it creates no gate', () => {
  const body = section(skill, '## In the Kit');
  assert.match(body, /This skill is phase-free and optional\./);
  assert.match(body, /No phase calls it, nor does any route/);
  assert.match(body, /no ship or merge condition depends on it having run/);
  assert.match(body, /It creates no gate\./);
});

test('its description fires as the agent is about to give a number it measured', () => {
  const description = frontmatter.split('\n').find((line) => line.startsWith('description:'));
  assert.match(description, /before you report or act on it/);
  assert.match(description, /Use when you run a benchmark or report a speedup or regression you measured\./);
});

test('it keeps the seven questions, in order', () => {
  const body = section(skill, '## The questions');
  const questions = [...body.matchAll(/^(\d)\. \*\*(.+?)\*\*/gm)].map((match) => [Number(match[1]), match[2]]);
  assert.deepEqual(questions, [
    [1, 'Why not double?'],
    [2, 'Was it tuned?'],
    [3, 'Did it break limits?'],
    [4, 'Did it error?'],
    [5, 'Does it reproduce?'],
    [6, 'Does it matter?'],
    [7, 'Did it even happen?'],
  ]);
  assert.match(body, /Run each side at least 5 times, alternating/);
  assert.match(body, /A gap smaller than the run-to-run variation is no measurable difference\./);
  assert.match(body, /Removing a piece that takes 10% of the run can make the run at most about 11% faster\./);
});

test('a ballpark still checks questions 4 and 7, and a choice between options is never one', () => {
  assert.match(skill, /Still check questions 4 and 7, and say that it is one run\./);
  assert.match(skill, /A choice between options is never a ballpark\./);
});

test('it keeps the report rules: verdict first, the number with its evidence, and when it is inconclusive', () => {
  const body = section(skill, '## Report');
  assert.match(body, /Lead with the verdict: faster, slower, no measurable difference, or inconclusive\./);
  assert.match(body, /Give the number with its unit, the run count, the range, and the limiter\./);
  assert.match(body, /Call the verdict inconclusive when you claim a difference but cannot name the limiter, when a side ran untuned, or when you could not check questions 4 and 7\./);
});

test('a review request body carries one primary number, with the evidence linked', () => {
  const body = section(skill, '## Report');
  assert.match(body, /Keep a review request body to one primary number\./);
  assert.match(body, /Put the runs, range, and limiter evidence in a linked artifact or notes file\./);
  assert.doesNotMatch(skill, /\bPRs?\b/);
});

test('it names no pstack playbook or skill', () => {
  assert.doesNotMatch(skill, /playbook|Other perf material|Opening a PR|Perf issue|hillclimb/i);
  assert.doesNotMatch(skill, /`(how|why|arena|unslop|blast-radius|benchmark-checklist)`/);
  assert.doesNotMatch(skill, /(?<!aw-)benchmark-checklist/);
});

test('it keeps the Linux commands as examples, and says to use the platform\'s equivalent', () => {
  for (const command of ['`uptime`', '`nproc`', '`top`', '`pidstat`', '`strace -c` on Linux']) {
    assert.ok(skill.includes(command), `it drops ${command}`);
  }
  assert.match(skill, /\(`uptime`, `nproc`, `top`, `pidstat`, `strace`\) are Linux examples\. On another platform, such as Windows or macOS, use its equivalent\./);
});

test('it uses the glossary\'s words, not the ones the glossary avoids', () => {
  assert.doesNotMatch(skill, /\bbugs?\b/i);
  assert.doesNotMatch(skill, /\bharness/i);
});

test('it carries pstack\'s license, since it keeps almost all of the upstream text (ADR 0004)', () => {
  const license = readFileSync(join(skillDir, 'LICENSE.upstream'), 'utf8');
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Lauren Tan\n/);
});

test('it credits pstack without naming the upstream skill', () => {
  assert.match(section(skill, '## Credits'), /^Adapted from Lauren Tan's pstack \(MIT\), as listed in the kit's `NOTICE\.md`\.$/m);
});

const repoText = (path) => readFileSync(join(repoRoot, path), 'utf8');

test('plugin.json lists it', () => {
  const plugin = JSON.parse(repoText('.claude-plugin/plugin.json'));
  assert.ok(plugin.skills.includes('./skills/aw-benchmark-checklist'));
});

test('its NOTICE row credits pstack by repo, folder and pin, and says what it takes and what it changes', () => {
  const row = repoText('NOTICE.md').split('\n').find((line) => line.startsWith('| `aw-benchmark-checklist` |'));
  assert.ok(row, 'no NOTICE row');
  assert.match(row, /\| adaptation \|$/);
  assert.match(row, /Lauren Tan/);
  assert.match(row, /\[`cursor\/plugins`\]\(https:\/\/github\.com\/cursor\/plugins\)/);
  assert.match(row, /`pstack\/skills\/benchmark-checklist\/SKILL\.md`/);
  assert.match(row, /\[`c742dd6`\]\(https:\/\/github\.com\/cursor\/plugins\/tree\/c742dd61706fbacc1b95f1a20b7b988cf096ce6c\/pstack\)/);
  for (const changed of ['seven questions', 'invocation flag', 'Other perf material', 'playbooks', '"review request" for "PR"', 'Linux examples', 'phase-free and optional']) {
    assert.ok(row.includes(changed), `does not say what it takes or changes about ${changed}`);
  }
});

test('the NOTICE opening names it among the adaptations that carry the license', () => {
  const opening = repoText('NOTICE.md').split('\n').find((line) => line.startsWith('This file lists every skill'));
  assert.match(opening, /`aw-benchmark-checklist`[^.]*LICENSE.upstream/);
});

test('ADR 0010 lists it among the phase-free adaptations', () => {
  const adr = repoText('docs/adr/0010-one-owner-per-phase-and-slices-in-the-spec.md');
  assert.match(adr, /`aw-benchmark-checklist`, a phase-free adaptation of pstack's `benchmark-checklist`/);
});

test('the README status paragraph describes it and counts it', () => {
  const status = repoText('README.md').split('\n').find((line) => line.startsWith('> Status:'));
  assert.match(status, /seventeen kit skills/);
  assert.match(status, /`aw-benchmark-checklist`, [^;]*which no phase requires/);
});

test('no other skill names it, so no phase calls it', () => {
  for (const other of readdirSync(join(repoRoot, 'skills'))) {
    if (other === 'aw-benchmark-checklist') continue;
    for (const entry of readdirSync(join(repoRoot, 'skills', other), { recursive: true })) {
      const path = join(repoRoot, 'skills', other, entry);
      if (statSync(path).isDirectory()) continue;
      assert.ok(!readFileSync(path, 'utf8').includes('aw-benchmark-checklist'), `${other}/${entry} names it`);
    }
  }
});
