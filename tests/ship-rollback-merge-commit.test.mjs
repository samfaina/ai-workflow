// After a local merge with no review host, aw-ship fills the `<merge commit>`
// placeholder of the rollback plan it wrote in step 5 (#128). The decision is
// the skill's text, so these tests hold that text, and run the commands it names
// on a real repo. The UAT cases check a real run with rollback-names-merge.mjs,
// tested here too.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { repoRoot, writeFiles } from './fixtures.mjs';
import { skillDir, tempDir } from './uat-fixtures.mjs';

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

// A git command the skill names, as the arguments after `git`.
const argv = (command) => command.split(' ').slice(1);

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

const localMerge = paragraph('With no review host:');

// A repo whose work branch fix/app is merged into main with the commands step 7
// names, and the hash the skill takes for the merge commit.
function mergedRepo(t) {
  const dir = tempDir(t);
  gitOutput(dir, 'init', '-q', '-b', 'main');
  gitOutput(dir, 'config', 'core.autocrlf', 'false');
  commit(dir, { 'src/app.js': 'old\n' }, 'Base');
  gitOutput(dir, 'switch', '-q', '-c', 'fix/app');
  commit(dir, { 'src/app.js': 'new\n' }, 'Change the app');

  const merge = localMerge.match(/`(git switch <base>)` then `(git merge --no-ff <branch>)`/);
  assert.ok(merge, 'step 7 names the local merge commands');
  gitOutput(dir, ...argv(merge[1].replace('<base>', 'main')));
  gitOutput(dir, ...argv(merge[2].replace('<branch>', 'fix/app')));

  const named = localMerge.match(/the merge commit's hash with `(git [^`]+)`/);
  assert.ok(named, 'step 7 names the command that takes the merge commit');
  return { dir, hash: gitOutput(dir, ...argv(named[1])) };
}

const placeholder = stepFive.match(/`(git revert -m 1 <merge commit>)`/)?.[1];

test('the rollback plan step 5 writes names the merge commit as a placeholder', () => {
  assert.match(stepFive, /`git revert -m 1 <merge commit>` once it is merged/);
  assert.ok(placeholder);
});

test('after a local merge, the merge commit replaces the placeholder in the body and its open-review copy', () => {
  assert.match(localMerge, /replace `<merge commit>`/);
  assert.match(localMerge, /body file from step 5/);
  assert.match(localMerge, /`\.aw\/drafts\/<yyyymmdd-hhmmss>-open-review\.md`/);
});

test('the hash the skill takes after a local merge fills a rollback plan that undoes the merge', (t) => {
  const { dir, hash } = mergedRepo(t);
  assert.match(hash, /^[0-9a-f]{7,}$/);
  const rollback = placeholder.replace('<merge commit>', hash);
  gitOutput(dir, ...argv(rollback), '--no-edit');
  assert.equal(readFileSync(join(dir, 'src/app.js'), 'utf8'), 'old\n', 'the filled rollback plan undoes the change');
});

test('with a review host, or when the merge is drafted or fails, the body is left as step 5 wrote it', () => {
  assert.doesNotMatch(paragraph('With a review host:'), /<merge commit>/);
  assert.match(stepSeven, /With a review host, or when the merge is drafted or fails, leave the body file and its copy as step 5 wrote them/);
});

// rollback-names-merge.mjs, which the merge UAT cases run in their working copy.

const BODY = '.aw/review-requests/29991231-235959-review-request.md';
const COPY = '.aw/drafts/29991231-235959-open-review.md';
const plan = (target) => `## Rollback plan\n\n- **Steps:** \`git revert -m 1 ${target}\` en una rama nueva.\n`;

function namesMerge(dir) {
  const result = spawnSync(process.execPath, [join(skillDir, 'scripts', 'rollback-names-merge.mjs')], { cwd: dir, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test('the UAT check passes when the body and its copy name the merge commit on main', (t) => {
  const { dir, hash } = mergedRepo(t);
  writeFiles(dir, { [BODY]: plan(hash), [COPY]: plan(hash) });
  assert.deepEqual(namesMerge(dir), { status: 0, output: '' });
});

test('the UAT check passes on a body with no open-review copy', (t) => {
  const { dir, hash } = mergedRepo(t);
  writeFiles(dir, { [BODY]: plan(hash) });
  assert.equal(namesMerge(dir).status, 0);
});

test('the UAT check fails when the body names another commit than the merge', (t) => {
  const { dir } = mergedRepo(t);
  const tip = gitOutput(dir, 'rev-parse', '--short', 'fix/app');
  writeFiles(dir, { [BODY]: plan(tip), [COPY]: plan(tip) });
  const { status, output } = namesMerge(dir);
  assert.equal(status, 1);
  assert.match(output, /review-request\.md names .*, not the merge commit/);
});

test('the UAT check fails when the open-review copy keeps the placeholder', (t) => {
  const { dir, hash } = mergedRepo(t);
  writeFiles(dir, { [BODY]: plan(hash), [COPY]: plan('<merge commit>') });
  const { status, output } = namesMerge(dir);
  assert.equal(status, 1);
  assert.match(output, /open-review\.md still holds <merge commit>/);
});

test('the UAT check fails when main is not a merge commit', (t) => {
  const { dir, hash } = mergedRepo(t);
  gitOutput(dir, 'reset', '-q', '--hard', 'fix/app');
  writeFiles(dir, { [BODY]: plan(hash) });
  const { status, output } = namesMerge(dir);
  assert.equal(status, 1);
  assert.match(output, /main is not a merge commit/);
});
