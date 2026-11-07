// aw-unslop's public contract, the text an agent loads when a person invokes
// the skill and the places in the kit that name it or its upstream. These tests
// hold the contract ticket #76 names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './fixtures.mjs';

const skillDir = join(repoRoot, 'skills/aw-unslop');
const skillFile = join(skillDir, 'SKILL.md');
const skill = existsSync(skillFile) ? readFileSync(skillFile, 'utf8') : '';
const frontmatter = skill.split('---')[1] ?? '';

// The body of the `## ` section with this exact heading.
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `no heading "${heading}"`);
  const end = lines.findIndex((line, i) => i > start && /^#{1,2} /.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

test('it is user-invoked: the frontmatter flag and agents/openai.yaml both say so', () => {
  assert.match(frontmatter, /^name: aw-unslop$/m);
  assert.match(frontmatter, /^disable-model-invocation: true$/m);
  const yaml = readFileSync(join(skillDir, 'agents/openai.yaml'), 'utf8');
  assert.match(yaml, /^policy:\n {2}allow_implicit_invocation: false$/m);
});

test("it carries pstack's license", () => {
  const license = readFileSync(join(skillDir, 'LICENSE.upstream'), 'utf8');
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Lauren Tan\n/);
});

test("it keeps upstream's rules under their stable numbers, gaps included", () => {
  const patterns = section(skill, '## Patterns to detect and fix');
  const numbers = [...patterns.matchAll(/^(\d+)\. \*\*/gm)].map((match) => Number(match[1]));
  assert.deepEqual(numbers, [3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33]);
  assert.match(patterns, /^13\. \*\*Em dash overuse\.\*\*/m);
  assert.match(patterns, /^26\. \*\*Abstract metaphor nouns\.\*\*.*harness as a metaphor/m);
  for (const heading of ['### Content', '### Language', '### Style', '### Communication artifacts', '### Filler', '### Jargon', '### Plain speech']) {
    assert.ok(patterns.split('\n').includes(heading), `missing "${heading}"`);
  }
});

test('plugin.json lists it', () => {
  const plugin = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin/plugin.json'), 'utf8'));
  assert.ok(plugin.skills.includes('./skills/aw-unslop'));
});

test('it states that it is phase-free and optional, and why a person decides when it runs', () => {
  const body = section(skill, '## In the Kit');
  assert.match(body, /phase-free and optional/);
  assert.match(body, /no phase requires it, nor does any route/i);
  assert.match(body, /no ship or merge condition depends on it having run/);
  assert.match(body, /creates no gate/);
  assert.match(body, /rewriting prose changes what a text says, so a person decides when it runs/i);
});

test('its target is what the user names, or else the last document generated in this conversation', () => {
  const body = section(skill, '## Target');
  assert.match(body, /The file or text the user names\./);
  assert.match(body, /With no argument, the last document generated in this conversation\./);
});

test('it rewrites only prose a person reads, and leaves glossary terms, code and quotations alone', () => {
  const body = section(skill, '## What it rewrites');
  assert.match(body, /Only prose a person reads\./);
  assert.match(body, /a term defined in the repo's `GLOSSARY\.md`, even when a rule would flag it/);
  assert.match(body, /`harness` under rule 26/);
  assert.match(body, /the en dash in `expand–contract` under rule 13/);
  for (const kept of ['a code identifier', 'a command', 'a path', 'a quotation', 'command output']) {
    assert.ok(body.includes(kept), `does not protect ${kept}`);
  }
});

test('in a text not written in English, it applies the rules that carry over', () => {
  const body = section(skill, '## What it rewrites');
  assert.match(body, /In a text not written in English, apply the rules that carry over; the word lists are English\./);
});

test('its table states what stays exact in each document the rest of the kit reads literally', () => {
  const rows = section(skill, '## What stays exact')
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) => line.replace(/^\| /, '').replace(/ \|$/, '').split(' | '));
  assert.deepEqual(Object.fromEntries(rows), {
    Spec: 'Frontmatter, headings, `AC-n` numbering, the Traceability table, the slice plan and its done markers, `BLOCKS:` items',
    'Review request body': 'Section headings, the bold labels in Evidence, Merge Danger and the Rollback plan, the closing line. It is the file under `.aw/review-requests/`',
    'Commit message': 'The conventional-commit title, `Done when:` and `Test exception:` lines',
    'Map, map update, decision ticket': 'Section headings and the shape of their lines',
    Adapter: 'The Operations and Levels tables, `**Default access:**`',
    '`GLOSSARY.md`': 'Bold terms and `_Avoid_:` lines',
    Skill: 'Frontmatter, and the `## Never allowed` and `## Defaults when unconfigured` sections, which `validate-kit` compares with `docs/configuration.md`',
  });
});

test('it refuses a copy, the three records of what happened, and a draft, each with its reason', () => {
  const body = section(skill, '## What it refuses');
  assert.match(body, /A copy, since `sync-upstreams check` fails on any hand edit\./);
  assert.match(body, /A review report, verify result or retro report, since each records what happened/);
  assert.match(body, /`aw-ship` reads the review report's `Proven defects:` line for its merge conditions/);
  assert.match(body, /A draft under `\.aw\/drafts\/`, since it holds an exact command or text for a person to apply/);
});

test('the one draft it takes is the review request body inside a drafted open-review, command left as it is', () => {
  const body = section(skill, '## What it refuses');
  assert.match(body, /except the review request body inside a drafted `open-review`/);
  assert.match(body, /leave the command as it is/);
});

test('on a spec not at draft, it stops and names the change process in aw-spec', () => {
  const body = section(skill, '## On a spec');
  assert.match(body, /When its `status` is not `draft`, stop/);
  assert.match(body, /\*\*Changing a spec\*\* in `\/aw-spec`/);
  assert.ok(readFileSync(join(repoRoot, 'skills/aw-spec/SKILL.md'), 'utf8').split('\n').includes('## Changing a spec'), 'aw-spec has no such section');
});

test('after rewriting a draft spec, it runs aw-check-spec and fixes what its own edit caused', () => {
  const body = section(skill, '## On a spec');
  assert.match(body, /After rewriting a draft, call the Skill tool with "aw-check-spec"/);
  assert.match(body, /fix what your edit caused/);
  assert.match(body, /`Result: not script-verified`/);
});

test('it warns that aw-ship at open-review: write leaves no moment to run it on the body', () => {
  const body = section(skill, '## On a review request body');
  assert.match(body, /`aw-ship` at `open-review: write` opens the review request right after writing the body/);
  assert.match(body, /a person who wants to run this skill first keeps `open-review` at `draft`/);
});

test('its steps send the agent through the refusals before any rewrite, and every rule is applied', () => {
  const body = section(skill, '## Steps');
  const at = (text) => {
    const index = body.indexOf(text);
    assert.notEqual(index, -1, `the steps do not mention ${text}`);
    return index;
  };
  assert.ok(at('**Target**') < at('**What it refuses**'));
  assert.ok(at('**What it refuses**') < at('**Patterns to detect and fix**'));
  assert.match(body, /Done when every rule has been applied/);
});

test('it credits its upstream', () => {
  assert.match(section(skill, '## Credits'), /Adapted from Lauren Tan's `unslop` in pstack \(MIT\), as listed in the kit's `NOTICE\.md`\./);
});

const repoText = (path) => readFileSync(join(repoRoot, path), 'utf8');

test('no other skill names it, so no phase refers to it', () => {
  for (const other of readdirSync(join(repoRoot, 'skills'))) {
    if (other === 'aw-unslop') continue;
    for (const entry of readdirSync(join(repoRoot, 'skills', other), { recursive: true })) {
      const path = join(repoRoot, 'skills', other, entry);
      if (statSync(path).isDirectory()) continue;
      assert.ok(!readFileSync(path, 'utf8').includes('unslop'), `${other}/${entry} names it`);
    }
  }
});

test('its NOTICE row credits pstack by repo, folder and pin, and says what it takes and what it changes', () => {
  const row = repoText('NOTICE.md').split('\n').find((line) => line.startsWith('| `aw-unslop` |'));
  assert.ok(row, 'no NOTICE row');
  assert.match(row, /\| adaptation \|$/);
  assert.match(row, /Lauren Tan/);
  assert.match(row, /\[`cursor\/plugins`\]\(https:\/\/github\.com\/cursor\/plugins\)/);
  assert.match(row, /`pstack\/skills\/unslop\/SKILL\.md`/);
  assert.match(row, /\[`c742dd6`\]\(https:\/\/github\.com\/cursor\/plugins\/tree\/c742dd61706fbacc1b95f1a20b7b988cf096ce6c\/pstack\)/);
  for (const taken of ['patterns', 'rule numbers']) {
    assert.ok(row.includes(taken), `does not say it takes the ${taken}`);
  }
  for (const changed of ['phase-free', 'target', 'prose', 'stays exact', 'refuses', 'spec', '`open-review']) {
    assert.ok(row.includes(changed), `does not say what it changes about ${changed}`);
  }
});

test('the NOTICE opening names it among the adaptations that carry the license', () => {
  const opening = repoText('NOTICE.md').split('\n').find((line) => line.startsWith('This file lists every skill'));
  assert.match(opening, /`aw-unslop`[^.]*LICENSE.upstream/);
});

test('nothing syncs pstack: neither upstreams.json nor its lock mentions it', () => {
  for (const path of ['upstreams.json', 'upstreams.lock.json']) {
    assert.doesNotMatch(repoText(path), /pstack|cursor\/plugins/i, path);
  }
});

test('ADR 0004 says what was read at the source in place of the pending license check', () => {
  const adr = repoText('docs/adr/0004-upstream-license-travels-with-each-copy.md');
  assert.doesNotMatch(adr, /At the time of writing that applies to pstack/);
  const line = adr.split('\n').find((candidate) => candidate.includes('pstack'));
  assert.ok(line, 'ADR 0004 no longer mentions pstack');
  for (const fact of ['`pstack/LICENSE`', '`cursor/plugins`', '`c742dd6`', 'MIT', 'Lauren Tan', 'adaptations and inspired skills', '`NOTICE.md`', '`upstreams.json`']) {
    assert.ok(line.includes(fact), `does not say ${fact}`);
  }
});

test('ADR 0014 names pstack among the public upstreams', () => {
  assert.match(repoText('docs/adr/0014-kit-skills-written-from-scratch.md'), /public upstream \(Matt Pocock, Addy Osmani, pstack\)/);
});

test('ADR 0010 lists it among the phase-free adaptations', () => {
  const adr = repoText('docs/adr/0010-one-owner-per-phase-and-slices-in-the-spec.md');
  assert.match(adr, /`aw-unslop`, a phase-free adaptation of pstack's `unslop`/);
});

test('the README says upstreams.json pins the upstreams the kit copies from, and that pstack is not one', () => {
  const readme = repoText('README.md');
  assert.match(readme, /`upstreams\.json` pins each upstream the kit copies from to a commit/);
  const line = readme.split('\n').find((candidate) => candidate.startsWith('`upstreams.json` pins'));
  assert.match(line, /pstack \(`cursor\/plugins`, folder `pstack`\)/);
  assert.match(line, /only adaptations and inspired skills/);
  assert.match(line, /nothing syncs it/);
  assert.match(line, /`NOTICE\.md`/);
});

test('the README status paragraph describes it and counts it', () => {
  const status = repoText('README.md').split('\n').find((line) => line.startsWith('> Status:'));
  assert.match(status, /fifteen kit skills/);
  assert.match(status, /`aw-unslop`, [^;]*which no phase requires/);
});
