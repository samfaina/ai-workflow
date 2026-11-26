// The skills that route a clean review to /aw-ship say what happens there to
// an introduced risk (#135). Since #129 (ADR 0013) a risk never blocks the
// merge: aw-ship lists it for the person who merges, or, when it merges by
// itself at merge: write, reports it as merged without a person's acceptance.
// The routing line is a copy in each skill, so these tests hold it word for
// word, and a change to one copy fails until the others follow.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { markdownFiles, repoRoot, skillSection, textLine } from './fixtures.mjs';

const read = (...path) => readFileSync(join(repoRoot, ...path), 'utf8').replaceAll('\r\n', '\n');

const RISK_ROUTING =
  "An introduced risk never blocks the merge. `/aw-ship` lists each one for the person who merges to accept. When `/aw-ship` merges by itself at `merge: write`, it reports each one as merged without a person's acceptance instead.";

// Each skill that routes a clean review to /aw-ship, and the start of its routing line.
const ROUTERS = [
  { skill: 'aw-review-steps', line: '- **No proven defect:** `/aw-ship`.' },
  { skill: 'aw-implement', line: '  - **Clean:** the latest review report holds no introduced defect. Name `/aw-ship`.' },
  { skill: 'aw-converge-steps', line: '  - **Clean:** the latest review report holds no introduced defect. Name `/aw-ship`.' },
];

for (const { skill, line } of ROUTERS) {
  test(`${skill} routes a clean review to /aw-ship with the shared introduced-risk sentence`, () => {
    const text = read('skills', skill, 'SKILL.md');
    const routing = textLine(text, line);
    assert.equal(routing, `${line} ${RISK_ROUTING}`);
  });
}

test("the shared sentence uses aw-ship's own words for both outcomes of an introduced risk", () => {
  const report = skillSection('aw-ship', '### 8. Report');
  const risks = textLine(report, '- each introduced risk');
  for (const words of ['the person who merges to accept', "without a person's acceptance"]) {
    assert.ok(risks.includes(words), `aw-ship step 8 says "${words}"`);
    assert.ok(RISK_ROUTING.includes(words), `the routing sentence says "${words}"`);
  }
});

test('no file in the kit says introduced risks are accepted or fixed before shipping', () => {
  const files = [...markdownFiles('skills'), ...markdownFiles('docs'), 'GLOSSARY.md', 'README.md'];
  assert.ok(files.some((file) => file.includes('aw-review-steps')), 'the skills were not found');
  for (const file of files) {
    for (const line of read(file).split('\n')) {
      if (!/risk/i.test(line)) continue;
      assert.doesNotMatch(line, /accept(ed)? or fix(ed)? before (shipping|the merge)/i, file);
      assert.doesNotMatch(line, /risks? (are|is|must be) (for the user )?(to )?(be )?accept(ed)? .*before (shipping|the merge)/i, file);
    }
  }
});
