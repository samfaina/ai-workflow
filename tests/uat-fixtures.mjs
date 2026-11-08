// Helpers shared by the UAT tests: synthetic session-log entries, a fake
// Claude Code config folder, and steps for the reader to look at. Not a test
// file itself. No real session log is ever committed.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { json, repoRoot } from './fixtures.mjs';

export const skillDir = join(repoRoot, '.claude', 'skills', 'uat');
export const readerCli = join(skillDir, 'scripts', 'reader.mjs');
export const runCli = join(skillDir, 'scripts', 'run.mjs');

export const EXIT_UNRECOGNIZED = 3;

export function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'uat-')));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

// One line of a session log per helper. Timestamps default to well after the
// step's start, so a test only states one when the order against it matters.
const AFTER = '2026-01-01T10:00:00.000Z';
export const STEP_START = '2026-01-01T09:00:00.000Z';
export const BEFORE = '2026-01-01T08:00:00.000Z';

const base = (type, at = AFTER, extra = {}) => ({ type, timestamp: at, isSidechain: false, uuid: `${type}-${Math.random()}`, ...extra });

export const log = {
  command: (name, args = '', at) =>
    base('user', at, { message: { role: 'user', content: `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>` } }),
  userText: (text, at, extra) => base('user', at, { message: { role: 'user', content: text }, ...extra }),
  ask: (id, questions, at, extra) =>
    base('assistant', at, {
      message: { id: `msg-${id}`, role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] },
      ...extra,
    }),
  answer: (id, answers, at) =>
    base('user', at, {
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] },
      toolUseResult: { answers },
    }),
  tool: (id, name, input, at) =>
    base('assistant', at, { message: { id: `msg-${id}`, role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } }),
  toolResult: (id, content, isError = false, at) =>
    base('user', at, { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } }),
  endTurn: (messageId, text, at, extra) =>
    base('assistant', at, { message: { id: messageId, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] }, ...extra }),
  housekeeping: () => ({ type: 'last-prompt', leafUuid: 'x', sessionId: 's' }),
};

export const question = (header, labels = ['A', 'B']) => ({
  header,
  question: `${header}?`,
  multiSelect: false,
  options: labels.map((label) => ({ label, description: `${label} described` })),
});

export const lines = (...entries) => entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n';

// A working copy's folder and its log folder under a fake config dir, with a
// step.json pointing at it. `session` writes one log named `<id>.jsonl`.
export function makeStep(t, { startedAt = STEP_START, continues = false } = {}) {
  const root = tempDir(t);
  const workdir = join(root, 'work_dir.x');
  const stepDir = join(root, 'step');
  const configDir = join(root, 'config');
  mkdirSync(workdir, { recursive: true });
  mkdirSync(stepDir, { recursive: true });
  const projectDir = join(configDir, 'projects', workdir.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(stepDir, 'step.json'), json({ case: 'c', workdir, startedAt, continues }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  return {
    stepDir,
    workdir,
    projectDir,
    env,
    writeSession: (id, content) => writeFileSync(join(projectDir, `${id}.jsonl`), content),
    appendSession: (id, content) => appendFileSync(join(projectDir, `${id}.jsonl`), content),
  };
}

export function reader(step, ...args) {
  const result = spawnSync(process.execPath, [readerCli, ...args], { encoding: 'utf8', env: step.env });
  let output = null;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    // Left null: the test asserts on status and stderr instead.
  }
  return { status: result.status, output, stdout: result.stdout, stderr: result.stderr };
}

// Starts a watch that keeps running; resolves when it exits.
export function startWatch(step, ...args) {
  const child = spawn(process.execPath, [readerCli, 'watch', '--step', step.stepDir, ...args], { env: step.env });
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  return new Promise((resolve) => {
    child.on('close', (status) => resolve({ status, output: JSON.parse(stdout), at: Date.now() }));
  });
}

export function git(dir, ...args) {
  const result = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

// A throwaway source repo: main with a tag, a branch forked from it, a commit
// on main after the fork, a remote-tracking ref, and uncommitted work. Then a
// run initialised over it with the given UAT case files.
export function makeRun(t, cases, { allCases = false } = {}) {
  const root = tempDir(t);
  const source = join(root, 'source');
  mkdirSync(source);
  spawnSync('git', ['init', '-q', '-b', 'main', source]);
  writeFileSync(join(source, 'README.md'), 'hello\n');
  writeFileSync(join(source, '.gitignore'), '.aw/\n');
  git(source, 'add', '-A');
  git(source, 'commit', '-q', '-m', 'first');
  git(source, 'tag', 'uat/start');
  const startCommit = git(source, 'rev-parse', 'HEAD');
  git(source, 'switch', '-q', '-c', 'feature/x');
  writeFileSync(join(source, 'feature.txt'), 'feature\n');
  git(source, 'add', '-A');
  git(source, 'commit', '-q', '-m', 'on the branch');
  const branchCommit = git(source, 'rev-parse', 'HEAD');
  git(source, 'update-ref', 'refs/remotes/origin/main', branchCommit);
  git(source, 'switch', '-q', 'main');
  writeFileSync(join(source, 'wip.txt'), 'not committed\n');

  const casesDir = join(root, 'cases');
  mkdirSync(casesDir);
  for (const c of cases) writeFileSync(join(casesDir, `${c.id}.json`), json(c));

  const runDir = join(root, 'run');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(root, 'config') };
  const cli = (command, ...args) => {
    const result = spawnSync(process.execPath, [runCli, command, '--run', runDir, ...args], { encoding: 'utf8', env });
    let output = null;
    try {
      output = JSON.parse(result.stdout);
    } catch {
      // Left null: the test asserts on status and stdout instead.
    }
    return { status: result.status, output, stdout: result.stdout, stderr: result.stderr };
  };
  const selection = allCases ? [] : ['--cases', cases.map((c) => c.id).join(',')];
  const init = cli('init', '--source', source, '--cases-dir', casesDir, ...selection);
  if (init.status !== 0) throw new Error(`init failed: ${init.stdout}${init.stderr}`);

  return {
    runDir,
    source,
    casesDir,
    startCommit,
    branchCommit,
    cli,
    readCase: (id) => JSON.parse(readFileSync(join(casesDir, `${id}.json`), 'utf8')),
    sourceState: () => ({
      status: git(source, 'status', '--porcelain'),
      head: git(source, 'rev-parse', 'HEAD'),
      refs: git(source, 'for-each-ref', '--format=%(refname) %(objectname)'),
    }),
  };
}
