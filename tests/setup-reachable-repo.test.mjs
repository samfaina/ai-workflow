// aw-setup records a GitHub or GitLab tracker even when the repo is not
// reachable from the clone, and warns the user what stands between them and a
// working tracker (#223). The behaviour is the skill's text, so these tests
// hold that text.

import assert from 'node:assert/strict';
import test from 'node:test';

import { skillSection } from './fixtures.mjs';

const interview = skillSection('aw-setup', '### 2. Interview', '### 3. Confirm');
const reachable = interview.slice(
  interview.indexOf('A GitHub or GitLab tracker needs the repo reachable'),
  interview.indexOf('**B. VCS.**'),
);

test('an unreachable repo still gets its tracker recorded, with a warning that every tracker operation fails until repo view prints the project', () => {
  assert.match(reachable, /`gh repo view` or `glab repo view` prints the project from this directory\./);
  assert.match(reachable, /record the tracker anyway/);
  assert.match(reachable, /every tracker operation fails until `repo view` prints the project/);
});

test('the warning names each step to a working tracker, in the order the user does them: install, log in, add a remote', () => {
  const steps = [
    /1\. The CLI installed, `gh` or `glab`, when it is not on the PATH\./,
    /2\. Logged in to the host: `gh auth login` or `glab auth login`\./,
    /3\. A remote in this clone on that host, naming the project recorded\./,
  ];
  const at = steps.map((step) => reachable.search(step));
  at.forEach((index, i) => assert.notEqual(index, -1, `step ${i + 1} is missing: ${steps[i]}`));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('a step that cannot be checked, such as logging in while the CLI is missing, is named as not done', () => {
  assert.match(reachable, /Name every step not yet done; a step you cannot check, such as logging in while the CLI is missing, is not done\./);
});
