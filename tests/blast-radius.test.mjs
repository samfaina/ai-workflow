// aw-blast-radius's public contract, the text an agent loads when the skill
// triggers and the places in the kit that name it. These tests hold the contract
// ticket #77 names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './fixtures.mjs';

const skillDir = join(repoRoot, 'skills/aw-blast-radius');
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

// The report's template holds `## ` headings of its own, so this section runs up
// to the heading after the template.
const report = skill.slice(skill.indexOf('\n## Report\n'), skill.indexOf('\n## Credits\n'));

test('it is model-invoked: no invocation flag and no agents/openai.yaml', () => {
  assert.match(frontmatter, /^name: aw-blast-radius$/m);
  assert.doesNotMatch(frontmatter, /disable-model-invocation/);
  assert.ok(!existsSync(join(skillDir, 'agents/openai.yaml')));
});

test('its description triggers narrowly, on the two phrases the ticket names', () => {
  const description = frontmatter.split('\n').find((line) => line.startsWith('description:'));
  assert.match(description, /blast radius of X/);
  assert.match(description, /what could this break/);
  assert.doesNotMatch(description, /small diff|review/i);
});

test('it states that it is phase-free and optional: no phase requires it and it creates no gate', () => {
  const body = section(skill, '## In the Kit');
  assert.match(body, /phase-free and optional/);
  assert.match(body, /no phase requires it, nor does any route/i);
  assert.match(body, /no ship or merge condition depends on it having run/);
  assert.match(body, /creates no gate/);
});

test('it names no pstack skill, and no step runs an arena', () => {
  assert.doesNotMatch(skill, /`(how|why|arena|unslop|blast-radius)`/);
  assert.doesNotMatch(skill, /\b(arena|unslop)\b/i);
  assert.doesNotMatch(skill, /(?<!aw-)(?<!\.aw\/)(?<!-)blast-radius(?!\.md)/);
});

test('it keeps what grep will not show as the job, and proves the safety fact by running code', () => {
  assert.match(skill, /Listing the callers is not the job\./);
  assert.match(skill, /The job is the breakage grep won't show you\./);
  const steps = section(skill, '## Steps');
  assert.match(steps, /safety fact/i);
  assert.match(steps, /Look where grep stops\./);
  assert.match(steps, /a wire format/);
  assert.match(steps, /Write a script or test that runs the real code, run it, and paste what happened\./);
});

test('its first step reads the change with git directly', () => {
  const first = section(skill, '## Steps').split(/^2\. /m)[0];
  assert.match(first, /`git diff <base>\.\.\.HEAD`/);
  assert.match(first, /`git log <base>\.\.HEAD`/);
});

test('its proof levels run from a bare claim to a reproduction in the running app, in the kit\'s words', () => {
  const body = section(skill, '## Proof levels');
  const levels = [...body.matchAll(/^(\d)\. (.*)$/gm)].map((match) => [Number(match[1]), match[2]]);
  assert.deepEqual(levels.map(([number]) => number), [1, 2, 3, 4, 5]);
  assert.match(levels[0][1], /^You said so\./);
  assert.match(levels[3][1], /^You ran it\./);
  assert.match(levels[4][1], /^You reproduced it in the running app\./);
  assert.doesNotMatch(skill, /\b(ladder|rung)\b/i);
});

test('a breakage a run proves is a defect, and any other is a risk with its likelihood and cost', () => {
  const body = section(skill, '## Findings');
  assert.match(body, /\*\*Defect\*\*: a breakage a run made by this skill demonstrates\./);
  assert.match(body, /names its run \(the exact command and the commit it ran on\) and quotes the output/);
  assert.match(body, /\*\*Risk\*\*: any other breakage/);
  assert.match(body, /\*\*likelihood\*\*/);
  assert.match(body, /\*\*cost\*\*/);
  assert.match(body, /It is never worded as a defect\./);
  assert.match(body, /\*\*Cleared\*\*: what you checked/);
  assert.match(body, /\*\*pre-existing\*\*/);
});

test('every run happens in a detached worktree outside the repo, and the user\'s working tree stays as it is', () => {
  const body = section(skill, '## Where runs happen');
  assert.match(body, /Every run is made in a detached worktree outside the repo, never in the user's working tree/);
  assert.match(body, /must stay as it is/);
  assert.match(body, /`git worktree add --detach <tmp>\/head HEAD`/);
  assert.match(body, /`git worktree add --detach <tmp>\/base <merge-base>`/);
  assert.match(body, /under the system's temporary directory/);
  assert.match(body, /`git worktree remove --force <dir>`/);
});

test('it writes only its report, commits nothing, and fixes nothing', () => {
  const body = section(skill, '## What it writes');
  assert.match(body, /The only file it writes in the repo is its report/);
  assert.match(body, /It commits nothing\./);
  assert.match(body, /It fixes nothing:/);
});

test('its report goes under .aw/blast-radius/ and is never committed', () => {
  assert.match(report, /`\.aw\/blast-radius\/<yyyymmdd-hhmmss>-blast-radius\.md`/);
  assert.match(report, /The report stays in `\.aw\/`, which is local state: never commit it\./);
});

test('its report holds the conclusion, the findings and the proof script', () => {
  for (const heading of ['## Conclusion', '## What it does', '## Safety fact', '## Defects', '## Risks', '## Cleared', '## Before you merge', '## Proof script']) {
    assert.ok(report.split('\n').includes(heading), `the report has no "${heading}"`);
  }
  assert.match(report, /unproven/);
  assert.match(report, /Proof level: <1 to 5>/);
});

test('its conclusion can be quoted on the remote: no script and no path to the report', () => {
  assert.match(report, /\*\*Conclusion\.\*\*[^\n]*can be quoted where the remote shows it: no script, and no path to this report/);
});

test('a proven defect stays open until it is fixed and /aw-review runs again', () => {
  const body = section(skill, '## A proven defect');
  assert.match(body, /says? plainly/);
  assert.match(body, /the defect stays open until it is fixed and `\/aw-review` runs again/);
  assert.ok(section(skill, '## Steps').includes('**A proven defect**'));
});

test('it credits pstack without naming the upstream skill', () => {
  assert.match(section(skill, '## Credits'), /Adapted from Lauren Tan's pstack \(MIT\), as listed in the kit's `NOTICE\.md`\./);
});

test('it carries pstack\'s license, since it keeps most of the upstream text (ADR 0004)', () => {
  const license = readFileSync(join(skillDir, 'LICENSE.upstream'), 'utf8');
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Lauren Tan\n/);
});

const repoText = (path) => readFileSync(join(repoRoot, path), 'utf8');
const glossary = repoText('GLOSSARY.md');

// A glossary entry: the line after the bold term, and its `_Avoid_:` line.
function term(name) {
  const lines = glossary.split('\n');
  const start = lines.indexOf(`**${name}**:`);
  assert.notEqual(start, -1, `the glossary has no term "${name}"`);
  return { definition: lines[start + 1], avoid: lines[start + 2] };
}

test('the glossary defines blast radius, and Merge Danger refers to it instead of defining it', () => {
  assert.equal(term('Blast radius').definition, 'What a change can affect outside itself.');
  assert.match(term('Blast radius').avoid, /^_Avoid_: /);
  const danger = term('Merge Danger').definition;
  assert.match(danger, /plus its blast radius\.$/);
  assert.doesNotMatch(danger, /what it can affect/);
});

test('the glossary defines the safety fact', () => {
  assert.match(term('Safety fact').definition, /^The one fact that a risky-looking change is safe because of\./);
  assert.match(term('Safety fact').avoid, /^_Avoid_: /);
});

test('the glossary defines the proof level, and keeps ladder and rung for controls', () => {
  assert.match(term('Proof level').definition, /^How far a safety fact has been proven, from a bare claim to a reproduction in the running app\./);
  assert.match(term('Proof level').avoid, /^_Avoid_: ladder, rung\b/);
  assert.match(term('Proof level').avoid, /\*\*Ladder\*\* already names the rungs of a control/);
});

test('Defect and Risk cover this skill\'s findings as well as the review\'s', () => {
  for (const name of ['Defect', 'Risk']) {
    const { definition } = term(name);
    assert.doesNotMatch(definition, /^A review finding/);
    assert.match(definition, /`aw-review`/);
    assert.match(definition, /`aw-blast-radius`/);
  }
  assert.match(term('Defect').definition, /named with the command and its output/);
  assert.match(term('Risk').definition, /stated with its likelihood and its cost if it happens/);
  assert.match(term('Risk').definition, /Every code smell is a risk\./);
});

const ship = repoText('skills/aw-ship/SKILL.md');

test('aw-ship\'s Blast Radius line suggests the skill and cites only its conclusion', () => {
  const line = ship.split('\n').find((candidate) => candidate.startsWith('**Blast Radius:**'));
  assert.ok(line, 'no Blast Radius line');
  assert.match(line, /what the change can affect outside the review request/);
  assert.match(line, /When the scope is not evident, suggest `\/aw-blast-radius`/);
  assert.match(line, /cite its conclusion, never its script or its report's path/);
  assert.match(line, /this body reaches the remote/);
});

test('aw-ship neither requires the skill nor reads its report for a merge condition', () => {
  assert.doesNotMatch(section(ship, '## Merge conditions'), /blast|safety fact|proof level/i);
  const line = ship.split('\n').find((candidate) => candidate.startsWith('**Blast Radius:**'));
  const others = ship.split('\n').filter((candidate) => candidate !== line).join('\n');
  assert.doesNotMatch(others, /aw-blast-radius/);
  assert.doesNotMatch(ship, /\.aw\/blast-radius/);
});

test('plugin.json lists it', () => {
  const plugin = JSON.parse(repoText('.claude-plugin/plugin.json'));
  assert.ok(plugin.skills.includes('./skills/aw-blast-radius'));
});

test('its NOTICE row credits pstack by repo, folder and pin, and says what it takes and what it changes', () => {
  const row = repoText('NOTICE.md').split('\n').find((line) => line.startsWith('| `aw-blast-radius` |'));
  assert.ok(row, 'no NOTICE row');
  assert.match(row, /\| adaptation \|$/);
  assert.match(row, /Lauren Tan/);
  assert.match(row, /\[`cursor\/plugins`\]\(https:\/\/github\.com\/cursor\/plugins\)/);
  assert.match(row, /`pstack\/skills\/blast-radius\/SKILL\.md`/);
  assert.match(row, /\[`c742dd6`\]\(https:\/\/github\.com\/cursor\/plugins\/tree\/c742dd61706fbacc1b95f1a20b7b988cf096ce6c\/pstack\)/);
  for (const changed of ['`how`', '`why`', '`arena`', '`unslop`', 'git directly', 'phase-free', 'detached worktree', '`.aw/blast-radius/`', 'proof script', '`/aw-review`']) {
    assert.ok(row.includes(changed), `does not say what it changes about ${changed}`);
  }
});

test('the NOTICE opening names it among the adaptations that carry the license', () => {
  const opening = repoText('NOTICE.md').split('\n').find((line) => line.startsWith('This file lists every skill'));
  assert.match(opening, /`aw-blast-radius`[^.]*LICENSE.upstream/);
});

test('ADR 0010 lists it among the phase-free adaptations', () => {
  const adr = repoText('docs/adr/0010-one-owner-per-phase-and-slices-in-the-spec.md');
  assert.match(adr, /`aw-blast-radius`, a phase-free adaptation of pstack's `blast-radius`/);
});

test('the README status paragraph describes it and counts it', () => {
  const status = repoText('README.md').split('\n').find((line) => line.startsWith('> Status:'));
  assert.match(status, /sixteen kit skills/);
  assert.match(status, /`aw-blast-radius`, [^;]*which no phase requires/);
});

test('among the skills, only aw-ship names it, so no phase depends on it', () => {
  for (const other of readdirSync(join(repoRoot, 'skills'))) {
    if (other === 'aw-blast-radius' || other === 'aw-ship') continue;
    for (const entry of readdirSync(join(repoRoot, 'skills', other), { recursive: true })) {
      const path = join(repoRoot, 'skills', other, entry);
      if (statSync(path).isDirectory()) continue;
      assert.ok(!readFileSync(path, 'utf8').includes('aw-blast-radius'), `${other}/${entry} names it`);
    }
  }
});
