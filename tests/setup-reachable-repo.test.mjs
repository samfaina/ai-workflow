// aw-setup records a GitHub or GitLab tracker even when the repo is not
// reachable from the clone, and warns the user what stands between them and a
// working tracker (#223). The behaviour is the skill's text, so these tests
// hold that text.

import assert from 'node:assert/strict';
import test from 'node:test';

import { skillSection } from './fixtures.mjs';

const interview = skillSection('aw-setup', '### 2. Interview', '### 3. Confirm');
const from = interview.indexOf('A GitHub or GitLab tracker needs the repo reachable');
const to = interview.indexOf('**B. VCS.**');
assert.notEqual(from, -1, 'aw-setup Interview has no reachable-repo paragraph');
assert.notEqual(to, -1, 'aw-setup Interview has no B. VCS. section');
const reachable = interview.slice(from, to);

test('an unreachable repo still gets its tracker recorded', () => {
  assert.match(reachable, /`gh repo view` or `glab repo view` prints the project from this directory\./);
  assert.match(reachable, /record the tracker anyway/);
});

test('the warning ties every tracker operation failing to the steps, not to repo view alone', () => {
  assert.match(reachable, /warn the user that every tracker operation fails until they have done each of these steps, in this order, and `gh repo view` or `glab repo view` prints the project:/);
});

test('the steps are install, log in, add a remote, in the order the user does them, for gh and glab', () => {
  const steps = [
    /1\. The CLI installed: `gh` or `glab`\./,
    /2\. Logged in to the host: `gh auth login` or `glab auth login`\./,
    /3\. A remote in this clone on that host, naming the project recorded\./,
  ];
  const at = steps.map((step) => reachable.search(step));
  at.forEach((index, i) => assert.notEqual(index, -1, `step ${i + 1} is missing: ${steps[i]}`));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('the warning names every step not yet done, and a step that cannot be checked counts as not done', () => {
  assert.match(reachable, /Name every step not yet done in the warning; a step you cannot check, such as logging in while the CLI is missing, is not done\./);
});
