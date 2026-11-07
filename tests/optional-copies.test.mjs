// The optional copies from Pocock that ticket #75 adds. The sync `check` and
// validate-kit hold what every copy owes: its license, its rename, its pin in
// NOTICE.md and its plugin.json line. These tests hold what is particular to
// these copies: where each comes from, the invocation mode each keeps from
// upstream, and that they stay optional.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './fixtures.mjs';

const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
const { upstreams } = JSON.parse(read('upstreams.json'));
const everyCopy = Object.values(upstreams).flatMap(({ skills }) => Object.keys(skills).map((name) => `aw-${name}`));

const OPTIONAL_COPIES = [
  { name: 'wizard', upstreamPath: 'skills/engineering/wizard', userInvoked: false },
  { name: 'to-questionnaire', upstreamPath: 'skills/productivity/to-questionnaire', userInvoked: true },
  { name: 'wait-what', upstreamPath: 'skills/productivity/wait-what', userInvoked: true },
];

for (const { name, upstreamPath, userInvoked } of OPTIONAL_COPIES) {
  const skill = `aw-${name}`;

  test(`${skill} comes from ${upstreamPath} in Pocock's repo, in upstreams.json and in NOTICE.md`, () => {
    assert.equal(upstreams.mattpocock.skills[name], upstreamPath);
    const row = read('NOTICE.md').split('\n').find((line) => line.startsWith(`| \`${skill}\` |`));
    assert.ok(row, 'no NOTICE.md row');
    assert.ok(row.includes(`\`${upstreamPath}\``), row);
  });

  test(`${skill} stays ${userInvoked ? 'user-invoked' : 'model-invoked'}, as upstream has it`, () => {
    const frontmatterFlag = /^disable-model-invocation: true$/m.test(read(`skills/${skill}/SKILL.md`));
    const yamlFlag = /allow_implicit_invocation: false/.test(read(`skills/${skill}/agents/openai.yaml`));
    assert.equal(frontmatterFlag, userInvoked);
    assert.equal(yamlFlag, userInvoked);
  });
}

test("ADR 0010's list of phase-free copies names every copy in upstreams.json", () => {
  const adr = read('docs/adr/0010-one-owner-per-phase-and-slices-in-the-spec.md');
  const list = adr.split('\n').find((line) => line.startsWith('Phase-free copies sit outside the table:'));
  assert.ok(list, 'no list of phase-free copies');
  for (const copy of everyCopy) assert.ok(list.includes(`\`${copy}\``), `the list leaves out ${copy}`);
});

test('no kit skill names these copies, so no phase, route or gate depends on them', () => {
  const kitSkills = readdirSync(join(repoRoot, 'skills')).filter((skill) => !everyCopy.includes(skill));
  assert.ok(kitSkills.includes('aw-ship'), 'the kit skills were not found');
  for (const skill of kitSkills) {
    for (const entry of readdirSync(join(repoRoot, 'skills', skill), { recursive: true })) {
      if (!entry.endsWith('.md')) continue;
      const text = read(join('skills', skill, entry));
      for (const { name } of OPTIONAL_COPIES) assert.ok(!text.includes(`aw-${name}`), `${skill}/${entry} names aw-${name}`);
    }
  }
});
