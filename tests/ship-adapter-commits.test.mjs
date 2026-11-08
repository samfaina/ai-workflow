// aw-ship accepts commits after the review that change only the tracker, VCS or
// domain adapters. The decision is the skill's text, so these tests hold that
// text, and run the git commands it names on a real repo.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { repoRoot } from './fixtures.mjs';

const skill = readFileSync(join(repoRoot, 'skills', 'aw-ship', 'SKILL.md'), 'utf8').replaceAll('\r\n', '\n');

const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@local', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@local' };

function git(dir, ...args) {
  return spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...IDENTITY } });
}

function ok(dir, ...args) {
  const result = git(dir, ...args);
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function write(dir, path, text) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

function commit(dir, message) {
  ok(dir, 'add', '-A');
  ok(dir, 'commit', '-q', '-m', message);
  return ok(dir, 'rev-parse', 'HEAD');
}

// A repo at its reviewed commit, which holds the VCS adapter and one code file.
function reviewedRepo(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ship-')));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  ok(dir, 'init', '-q', '-b', 'main');
  ok(dir, 'config', 'core.autocrlf', 'false');
  write(dir, 'docs/agents/vcs.md', 'vcs\n');
  write(dir, 'src/app.js', 'app\n');
  return { dir, reviewed: commit(dir, 'Reviewed') };
}

// The command the skill names, with its placeholder filled in, as argv.
function namedCommand(pattern, reviewed) {
  const found = skill.match(pattern);
  assert.ok(found, `the skill names no command matching ${pattern}`);
  return found[1].replace('<short hash>', reviewed).split(' ').slice(1);
}

const stepTwo = skill.slice(skill.indexOf('### 2. Read the latest review report'), skill.indexOf('### 3. Run the full check level'));
const stepThree = skill.slice(skill.indexOf('### 3. Run the full check level'), skill.indexOf('### 4. Set the spec to implemented'));

// One of the numbered checks or bulleted items of the step, by its bold name.
function item(name) {
  const line = stepTwo.split('\n').find((candidate) => candidate.includes(`**${name}`));
  assert.ok(line, `step 2 has no item "${name}"`);
  return line;
}

test('every file left in the set must be an exempt adapter, found through the block', () => {
  const check = item('Every file left');
  assert.match(check, /taken as one set/);
  assert.match(item('Exempt adapters'), /`## Agent skills` block/);
  assert.match(item('Exempt adapters'), /tracker adapter, the VCS adapter and the domain doc/);
  assert.doesNotMatch(skill, /docs\/agents\//, 'no skill names a docs/agents file directly (ADR 0006)');
});

test('an exempt adapter is an exact path, read at HEAD', () => {
  assert.match(item('Exempt adapters'), /at `HEAD`/);
  assert.match(item('Exempt adapters'), /exact paths/);
});

test('a repo with no block has no exempt adapters', () => {
  assert.match(item('Exempt adapters'), /With no block there are none/);
});

test('the checks adapter is never exempt, and the skill says why', () => {
  const never = item('The checks adapter');
  assert.match(never, /command of the `full` level/);
  assert.match(never, /needs a review/);
  assert.match(never, /also when a pointer names it as another adapter/);
});

test('the file holding the block is never exempt', () => {
  assert.match(item('The file that holds the block'), /which files are adapters/);
});

test('only this skill\'s own spec commit is set aside; any other change to the spec is not exempt', () => {
  const setAside = item('Set aside this skill');
  assert.match(setAside, /`status: approved`/);
  assert.match(setAside, /`status: implemented`/);
  assert.match(setAside, /whole change/);
  assert.match(item('The spec'), /frontmatter/);
});

test('the list is closed against a later edit', () => {
  assert.match(item('Not exempt'), /stays closed/);
});

test('code in the set stops the skill and names /aw-review', () => {
  assert.match(item('Every other file'), /needs a review/);
  assert.match(item('The report names another commit'), /stop, and tell the user to run `\/aw-review` again/);
});

test('the full level still runs on HEAD, also after accepted commits', () => {
  assert.match(stepThree, /Run `run-check full` on `HEAD` from the repo root, with every commit step 2 accepted/);
  assert.doesNotMatch(stepThree, /the reviewed commit, or on a rerun/);
});

test('step 2 keeps the commits after the reviewed one for the Evidence section', () => {
  assert.match(stepTwo, /Done when you have the report's path, its counts, its introduced risks and the commits after the reviewed one/);
});

test('the review request\'s Evidence names each commit the review did not cover', () => {
  const evidence = skill.split('\n').find((line) => line.startsWith('- **After the review:**'));
  assert.ok(evidence, 'the Evidence template has no "After the review" line');
  assert.match(evidence, /one line per commit in `<short hash>\.\.HEAD`/);
  assert.match(evidence, /`<short hash>` <subject>/);
  assert.match(evidence, /changed only adapters/);
  assert.match(evidence, /changed only the spec's status/);
});

const changedFiles = (dir, reviewed) => ok(dir, ...namedCommand(/`(git log [^`]*--name-only[^`]*)`/, reviewed)).split('\n');
const isAncestor = (dir, reviewed) => git(dir, ...namedCommand(/`(git merge-base --is-ancestor [^`]*)`/, reviewed)).status === 0;

test('a rename counts under both its old and its new path', (t) => {
  const { dir, reviewed } = reviewedRepo(t);
  ok(dir, 'mv', 'docs/agents/vcs.md', 'docs/agents/vcs-renamed.md');
  commit(dir, 'Rename the adapter');
  const files = changedFiles(dir, reviewed);
  assert.ok(files.includes('docs/agents/vcs.md'), files.join('|'));
  assert.ok(files.includes('docs/agents/vcs-renamed.md'), files.join('|'));
});

test('a file changed and changed back is still in the set', (t) => {
  const { dir, reviewed } = reviewedRepo(t);
  write(dir, 'src/app.js', 'changed\n');
  commit(dir, 'Change the code');
  write(dir, 'src/app.js', 'app\n');
  commit(dir, 'Change it back');
  assert.ok(changedFiles(dir, reviewed).includes('src/app.js'));
});

test('a change made inside a merge commit is in the set', (t) => {
  const { dir, reviewed } = reviewedRepo(t);
  ok(dir, 'switch', '-q', '-c', 'side');
  write(dir, 'docs/agents/vcs.md', 'side\n');
  commit(dir, 'Change the adapter on the side');
  ok(dir, 'switch', '-q', 'main');
  write(dir, 'docs/agents/tracker.md', 'tracker\n');
  commit(dir, 'Add the tracker adapter');
  ok(dir, 'merge', '-q', '--no-commit', '--no-ff', 'side');
  write(dir, 'src/hidden.js', 'hidden\n');
  commit(dir, 'Merge side');
  assert.ok(changedFiles(dir, reviewed).includes('src/hidden.js'));
});

test('each file is listed under the commit that changed it', (t) => {
  const { dir, reviewed } = reviewedRepo(t);
  write(dir, 'docs/agents/vcs.md', 'write\n');
  commit(dir, 'Set push to write');
  const lines = changedFiles(dir, reviewed);
  assert.match(lines[0], /Set push to write$/);
  assert.equal(lines[1], 'docs/agents/vcs.md');
});

test('the reviewed commit stops being an ancestor after an amend, and is one otherwise', (t) => {
  const { dir, reviewed } = reviewedRepo(t);
  write(dir, 'docs/agents/vcs.md', 'write\n');
  commit(dir, 'Set push to write');
  assert.equal(isAncestor(dir, reviewed), true);

  ok(dir, 'reset', '-q', '--hard', reviewed);
  ok(dir, 'commit', '-q', '--amend', '-m', 'Reviewed, amended');
  assert.equal(isAncestor(dir, reviewed), false);
});
