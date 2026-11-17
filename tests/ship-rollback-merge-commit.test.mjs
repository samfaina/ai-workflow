// After a local merge with no review host, aw-ship fills the `<merge commit>`
// placeholder of the rollback plan it wrote in step 5 (#128). The decision is
// the skill's text, so these tests hold that text, and run the commands it names
// on a real repo.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { repoRoot, writeFiles } from './fixtures.mjs';
import { tempDir } from './uat-fixtures.mjs';

const skill = readFileSync(join(repoRoot, 'skills', 'aw-ship', 'SKILL.md'), 'utf8').replaceAll('\r\n', '\n');

const between = (from, to) => skill.slice(skill.indexOf(from), skill.indexOf(to));
const stepFive = between('### 5. Write the review request body', '### 6. Push and open the review request');
const stepSeven = between('### 7. Merge', '### 8. Report');

const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@local', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@local' };

function gitOutput(dir, ...args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...IDENTITY } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(dir, files, message) {
  writeFiles(dir, files);
  gitOutput(dir, 'add', '-A');
  gitOutput(dir, 'commit', '-q', '-m', message);
}

// The paragraph of step 7 that starts with the given bold label.
function paragraph(label) {
  const found = stepSeven.split('\n').find((line) => line.includes(`**${label}`));
  assert.ok(found, `step 7 has no paragraph "${label}"`);
  return found;
}

const localMerge = () => paragraph('With no review host:');

test('the rollback plan step 5 writes names the merge commit as a placeholder', () => {
  assert.match(stepFive, /`git revert -m 1 <merge commit>` once it is merged/);
});

test('after a local merge, the merge commit replaces the placeholder in the body and its open-review copy', () => {
  const fill = localMerge();
  assert.match(fill, /replace `<merge commit>`/);
  assert.match(fill, /body file from step 5/);
  assert.match(fill, /`\.aw\/drafts\/<yyyymmdd-hhmmss>-open-review\.md`/);
});

test('the hash the skill takes after a local merge fills a rollback plan that undoes the merge', (t) => {
  const dir = tempDir(t);
  gitOutput(dir, 'init', '-q', '-b', 'main');
  gitOutput(dir, 'config', 'core.autocrlf', 'false');
  commit(dir, { 'src/app.js': 'old\n' }, 'Base');
  gitOutput(dir, 'switch', '-q', '-c', 'fix/app');
  commit(dir, { 'src/app.js': 'new\n' }, 'Change the app');

  const merge = localMerge().match(/`(git switch <base>)` then `(git merge --no-ff <branch>)`/);
  assert.ok(merge, 'step 7 names the local merge commands');
  gitOutput(dir, ...merge[1].replace('<base>', 'main').split(' ').slice(1));
  gitOutput(dir, ...merge[2].replace('<branch>', 'fix/app').split(' ').slice(1));

  const named = localMerge().match(/the merge commit's hash with `(git [^`]+)`/);
  assert.ok(named, 'step 7 names the command that takes the merge commit');
  const hash = gitOutput(dir, ...named[1].split(' ').slice(1));
  assert.match(hash, /^[0-9a-f]{7,}$/);

  const steps = stepFive.match(/`(git revert -m 1 <merge commit>)`/)[1].replace('<merge commit>', hash);
  gitOutput(dir, ...steps.split(' ').slice(1), '--no-edit');
  assert.equal(readFileSync(join(dir, 'src/app.js'), 'utf8'), 'old\n', 'the filled rollback plan undoes the change');
});

test('with a review host, or when the merge is drafted or fails, the body is left as step 5 wrote it', () => {
  assert.doesNotMatch(paragraph('With a review host:'), /<merge commit>/);
  assert.match(stepSeven, /With a review host, or when the merge is drafted or fails, leave the body file and its copy as step 5 wrote them/);
});
