// aw-tdd and aw-wizard were copies of Pocock's tdd and wizard. #152 adds the
// show-then-confirm rule to their text, an edit a copy cannot take, so both
// became adaptations, the way aw-security-and-hardening did. These tests hold
// what that move owes: out of the copied skills and the lock, mapped under
// `replaced` so a copy's reference to either points at the kit skill, credited in
// NOTICE.md as adaptations that keep their upstream license, and listed as
// adaptations wherever the docs list copies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './fixtures.mjs';

const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
const { upstreams } = JSON.parse(read('upstreams.json'));
const lock = JSON.parse(read('upstreams.lock.json')).upstreams;
const notice = read('NOTICE.md');
const readmeStatus = () => read('README.md').split('\n').find((line) => line.startsWith('> Status:'));

const ADAPTED = [
  { name: 'tdd', upstreamPath: 'skills/engineering/tdd' },
  { name: 'wizard', upstreamPath: 'skills/engineering/wizard' },
];

for (const { name, upstreamPath } of ADAPTED) {
  const skill = `aw-${name}`;

  test(`${skill} is no copy: upstreams.json and the lock no longer list ${name}`, () => {
    assert.equal(upstreams.mattpocock.skills[name], undefined);
    assert.equal(lock.mattpocock.skills[name], undefined);
  });

  test(`${skill} replaces Pocock's ${name}, so a copy's reference to ${name} points at it`, () => {
    assert.equal(upstreams.mattpocock.replaced[name], skill);
  });

  test(`${skill}'s NOTICE row is an adaptation of ${upstreamPath} that says what it adds`, () => {
    const row = notice.split('\n').find((line) => line.startsWith(`| \`${skill}\` |`));
    assert.ok(row, 'no NOTICE.md row');
    assert.ok(row.includes(`\`${upstreamPath}\``), row);
    assert.match(row, /\| adaptation \|$/);
    assert.match(row, /the chat text or the confirmation question's preview/);
  });

  test(`${skill} keeps almost all of its upstream's text, so it still carries LICENSE.upstream`, () => {
    assert.ok(existsSync(join(repoRoot, 'skills', skill, 'LICENSE.upstream')));
    const sentence = notice.split('\n').find((line) => line.startsWith('This file lists every skill'));
    assert.ok(sentence.includes(`\`${skill}\``), `NOTICE.md does not say ${skill} carries LICENSE.upstream`);
  });

  test(`ADR 0010 lists ${skill} as a phase-free adaptation, not a copy`, () => {
    const adr = read('docs/adr/0010-one-owner-per-phase-and-slices-in-the-spec.md');
    const line = adr.split('\n').find((candidate) => candidate.startsWith('Phase-free copies sit outside the table:'));
    const [copies, rest] = line.split('(from Addy Osmani).');
    assert.ok(!copies.includes(`\`${skill}\``), `ADR 0010 still lists ${skill} as a copy`);
    assert.ok(rest.includes(`\`${skill}\``), `ADR 0010 does not list ${skill} as an adaptation`);
  });

  test(`the README describes ${skill} among the kit skills`, () => {
    assert.ok(readmeStatus().includes(`\`${skill}\`, adapted from`), `the README does not describe ${skill}`);
  });
}

test('the README counts both among the kit skills, not the copies', () => {
  assert.equal(Object.keys(upstreams.mattpocock.skills).length, 12);
  assert.match(readmeStatus(), /twelve copies of Matt Pocock's skills/);
  assert.match(readmeStatus(), /twenty-five kit skills/);
});

test('aw-wizard stays model-invoked, as upstream has it', () => {
  assert.doesNotMatch(read('skills/aw-wizard/SKILL.md'), /^disable-model-invocation: true$/m);
  assert.doesNotMatch(read('skills/aw-wizard/agents/openai.yaml'), /allow_implicit_invocation: false/);
});

test('aw-wizard stays optional: no other kit skill names it, so no phase, route or gate depends on it', () => {
  for (const skill of readdirSync(join(repoRoot, 'skills')).filter((folder) => folder !== 'aw-wizard')) {
    for (const entry of readdirSync(join(repoRoot, 'skills', skill), { recursive: true })) {
      if (!entry.endsWith('.md')) continue;
      assert.ok(!read(join('skills', skill, entry)).includes('aw-wizard'), `${skill}/${entry} names aw-wizard`);
    }
  }
});
