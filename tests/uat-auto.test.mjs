// The UAT driver, `run.mjs auto`, run as a process against a fake `claude` on
// PATH (uat-fake-claude.mjs), which replays a scripted session and answers the
// judgement calls with scripted JSON. The permission host is tested only
// through it. No test runs the real Claude Code binary.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import { repoRoot } from './fixtures.mjs';
import { caseFile, makeRun, runScript } from './uat-fixtures.mjs';

const fakeScript = join(repoRoot, 'tests', 'uat-fake-claude.mjs');

// Puts a fake `claude` that replays `script` first on PATH, for `auto` only.
function fakeClaude(run, script) {
  const dir = join(run.root, 'fake');
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const scriptFile = join(dir, 'script.json');
  writeFileSync(scriptFile, JSON.stringify(script));
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'claude.cmd'), `@"${process.execPath}" "${fakeScript}" %*\r\n`);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(run.root, 'config'), FAKE_CLAUDE: scriptFile };
  delete env.ANTHROPIC_API_KEY;
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = `${bin}${delimiter}${env[pathKey] ?? ''}`;
  const callsFile = join(dir, 'calls.jsonl');
  const calls = () => (existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []);
  return {
    env,
    calls,
    sessions: () => calls().filter((call) => call.args.includes('stream-json')),
    judgements: () => calls().filter((call) => !call.args.includes('stream-json')),
  };
}

function auto(run, fake, ...args) {
  const result = spawnSync(process.execPath, [runScript, 'auto', '--run', run.runDir, ...args], { encoding: 'utf8', env: fake.env });
  let output = null;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    // Left null: the test asserts on status and stdout instead.
  }
  return { status: result.status, output, stdout: result.stdout, stderr: result.stderr, report: `${result.stdout}${result.stderr}` };
}

const write = (file_path, content) => ({ name: 'Write', input: { file_path, content } });
const readText = (file) => readFileSync(file, 'utf8');

test('auto runs a scripted batch to done and leaves the results, ledger entries and summary an assisted run of the same cases leaves', (t) => {
  const cases = [caseFile('a', { order: 1, assertions: [{ name: 'note written', file: 'note.md', matches: '^hi$' }, { judge: 'It wrote a note' }] })];
  const grades = {
    verdict: 'Pass',
    line: 'Asked to leave a note, the skill wrote note.md with the text it was given.',
    judge: [{ criterion: 'It wrote a note', result: 'pass', evidence: 'note.md holds the line "hi"' }],
    findings: [],
  };

  const unattended = makeRun(t, cases);
  const fake = fakeClaude(unattended, { turns: [{ tools: [write('{{CWD}}/note.md', 'hi\n')], text: 'I wrote the note.' }], judgements: [{ grade: grades }] });
  const result = auto(unattended, fake);
  assert.equal(result.status, 0, result.report);
  assert.equal(result.output.status, 'done');

  const assisted = makeRun(t, cases);
  const { workdir } = assisted.cli('next').output;
  writeFileSync(join(workdir, 'note.md'), 'hi\n');
  assisted.cli('check');
  const gradesFile = join(assisted.root, 'grades.json');
  writeFileSync(gradesFile, JSON.stringify(grades));
  assert.equal(assisted.cli('record', '--grades', gradesFile).status, 0);
  assisted.cli('report');

  assert.deepEqual(unattended.state().results, assisted.state().results);
  const resultOf = (run) => JSON.parse(readText(join(run.runDir, 'results', 'a.json')));
  assert.deepEqual(resultOf(unattended), resultOf(assisted));
  assert.equal(readText(join(unattended.runDir, 'summary.md')), readText(join(assisted.runDir, 'summary.md')));
  const entry = (run) => {
    const { verdict, fingerprint, kitCommit } = run.ledger().a;
    return { verdict, fingerprint, kitCommit };
  };
  assert.deepEqual(entry(unattended), entry(assisted));
  assert.equal(entry(unattended).verdict, 'Pass');
});

const pass = (line = 'The skill did what the case asked.') => ({ verdict: 'Pass', line, judge: [], findings: [] });
const gradeCalls = (fake) => fake.judgements().filter((call) => kindOf(call) === 'grade');
const replyCalls = (fake) => fake.judgements().filter((call) => kindOf(call) === 'reply');
const kindOf = (call) => call.prompt.match(/^# UAT judgement: (\w+)/)?.[1];
const withoutResume = (args) => args.filter((arg, i) => arg !== '--resume' && args[i - 1] !== '--resume');
const resumed = (call) => call.args[call.args.indexOf('--resume') + 1];

test('a follow-up turn and a continues case resume the same session, with the flags passed again, and a turn\'s assertions are checked when it ends', (t) => {
  const run = makeRun(t, [
    caseFile('a', {
      order: 1,
      command: '/aw-spec a library app',
      turns: [{ intent: 'Approve the spec', reason: 'the case checks the approved spec', assertions: [{ name: 'approved', file: 'approved.md', matches: '^yes$' }] }],
    }),
    caseFile('b', { order: 2, from: undefined, continues: 'a', command: '/aw-slices' }),
  ]);
  const fake = fakeClaude(run, {
    turns: [
      { text: 'The spec is ready. Do you approve it?' },
      { tools: [write('{{CWD}}/approved.md', 'yes\n')], text: 'Approved.' },
      { text: 'Sliced.' },
    ],
    judgements: [
      { reply: { action: 'reply', entry: 'turn', message: 'I approve the spec.', reason: 'the next turn approves it' } },
      { grade: pass() },
      { grade: pass() },
    ],
  });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const [first, followUp, continued] = fake.sessions();
  assert.equal(first.args.includes('--resume'), false);
  assert.equal(first.prompt, '/aw-spec a library app');
  assert.equal(followUp.prompt, 'I approve the spec.');
  assert.equal(continued.prompt, '/aw-slices');
  const session = JSON.parse(readText(join(run.runDir, 'steps', 'a', 'step.json'))).session;
  assert.ok(session);
  assert.equal(resumed(followUp), session);
  assert.equal(resumed(continued), session);
  assert.equal(JSON.parse(readText(join(run.runDir, 'steps', 'b', 'step.json'))).session, session);
  assert.deepEqual(withoutResume(followUp.args), first.args);
  // The continued case logs its permission prompts in its own step folder.
  const hostConfigOf = (call) => call.args[call.args.indexOf('--mcp-config') + 1];
  assert.equal(hostConfigOf(continued), join(run.runDir, 'steps', 'b', 'permission-host.json'));
  assert.deepEqual(withoutResume(continued.args).map((arg) => (arg === hostConfigOf(continued) ? hostConfigOf(first) : arg)), first.args);
  for (const flag of ['--plugin-dir', '--mcp-config', '--permission-prompt-tool']) assert.ok(first.args.includes(flag), flag);
  assert.deepEqual(first.args.slice(first.args.indexOf('--permission-prompts'), first.args.indexOf('--permission-prompts') + 2), ['--permission-prompts', 'host']);
  assert.ok(first.args.includes('--verbose'));

  const checks = JSON.parse(readText(join(run.runDir, 'steps', 'a', 'checks.json')));
  assert.deepEqual(checks.turns['1'], [{ name: 'approved', ok: true }]);
  // b has no turns or answers, and a none left after its follow-up: neither asks for a reply.
  assert.deepEqual(fake.judgements().map(kindOf), ['reply', 'grade', 'grade']);
  assert.deepEqual(run.state().results, { a: { verdict: 'Pass', line: pass().line }, b: { verdict: 'Pass', line: pass().line } });
});

test('a stop point ends the step with the turn unsent, a prose question no entry fits ends it unanswered, and one an answers entry fits is answered from it, by ANSWERING.md', (t) => {
  const run = makeRun(t, [
    caseFile('stop', {
      order: 1,
      turns: [{ intent: 'Accept what it proposes', reason: 'the case reads the spec it wrote' }],
      assertions: [{ name: 'left at draft', file: 'spec.md', frontmatter: { status: 'draft' } }],
    }),
    caseFile('nofit', { order: 2, answers: [{ when: 'Which database to use', intent: 'SQLite', reason: 'the app has no server' }] }),
    caseFile('answered', { order: 3, answers: [{ when: 'Which database to use', intent: 'SQLite', reason: 'the app has no server' }] }),
  ]);
  const stopReason = 'a stop point: the case checks that the spec is left at draft, so its approval stays unanswered';
  const noFitReason = 'no entry fits a question in prose about the colour of a button';
  const fake = fakeClaude(run, {
    turns: [
      { tools: [write('{{CWD}}/spec.md', '---\nstatus: draft\n---\n')], text: 'The spec is written. Shall I approve it?' },
      { text: 'What colour should the button be?' }, { text: 'Which database should I use?' }, { text: 'Using SQLite.' }],
    judgements: [
      { reply: { action: 'end', reason: stopReason } },
      { grade: pass() },
      { reply: `Here it is: ${JSON.stringify({ action: 'end', reason: noFitReason })}` },
      { grade: pass() },
      { reply: { action: 'reply', entry: 'turn', message: 'Use SQLite.', reason: 'a turn' } },
      { reply: { action: 'reply', entry: 'answer', index: 0, message: 'Use SQLite.', reason: 'the database entry fits' } },
      { grade: pass() },
    ],
  });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  assert.deepEqual(fake.sessions().map((call) => call.prompt), ['/stop', '/nofit', '/answered', 'Use SQLite.']);
  const [stopReply, noFitReply, refusedReply, retriedReply] = replyCalls(fake);
  assert.match(stopReply.prompt, /### Stop points/, 'the call follows ANSWERING.md');
  assert.match(stopReply.prompt, /"status": "draft"/, 'the call sees the checks that say where the agent must stop');
  assert.match(stopReply.prompt, /Accept what it proposes/, 'the call sees the next turn');
  assert.match(stopReply.prompt, /Shall I approve it\?/, 'the call sees the agent\'s turn');
  assert.match(noFitReply.prompt, /Which database to use/);
  assert.doesNotMatch(refusedReply.prompt, /was refused/);
  assert.ok(retriedReply.prompt.startsWith(refusedReply.prompt), 'the retry asks the same question again');
  assert.match(retriedReply.prompt.slice(refusedReply.prompt.length), /was refused[\s\S]*every turn has been sent/);
  const [stopGrade, noFitGrade] = gradeCalls(fake);
  assert.ok(stopGrade.prompt.includes(stopReason));
  assert.ok(noFitGrade.prompt.includes(noFitReason));
  assert.deepEqual(Object.keys(run.state().results), ['stop', 'nofit', 'answered']);
});

test('a turn that ends with no turns or answers entry left ends the step without a judgement call', (t) => {
  const run = makeRun(t, [caseFile('a', { answers: [] , turns: [] })]);
  const fake = fakeClaude(run, { turns: [{ text: 'Anything else I can do?' }], judgements: [{ grade: pass() }] });

  const result = auto(run, fake);

  assert.equal(result.status, 0, result.report);
  assert.deepEqual(fake.judgements().map(kindOf), ['grade']);
  assert.match(gradeCalls(fake)[0].prompt, /Every `turns` and `answers` entry had been used/);
});

const readLines = (file) => readText(file).trim().split('\n').map((line) => JSON.parse(line));

test('a write outside the working copy is denied and logged in the step folder, and the grading call sees the log', (t) => {
  const criterion = 'It wrote its notes only inside the working copy';
  const run = makeRun(t, [caseFile('a', { assertions: [{ judge: criterion }] })]);
  const outside = join(run.root, 'outside.txt');
  const grades = {
    verdict: 'Not proven',
    line: 'Asked to write notes, the session also tried to write a file outside its working copy, which the permission host denied.',
    judge: [{ criterion, result: 'not_proven', evidence: `the permission host denied a Write to ${outside}` }],
    findings: [{ kind: 'environment', text: 'An unexpected denial by the permission host.' }],
  };
  const fake = fakeClaude(run, {
    turns: [
      {
        tools: [write('{{CWD}}/inside.txt', 'in\n'), write(outside, 'out\n'), write('{{CWD}}/../escape.txt', 'out\n'), { name: 'AskUserQuestion', input: { questions: [] } }],
        text: 'Done.',
      },
    ],
    judgements: [{ grade: grades }],
  });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const stepDir = join(run.runDir, 'steps', 'a');
  assert.equal(readText(join(stepDir, 'repo', 'inside.txt')), 'in\n');
  assert.equal(existsSync(outside), false);
  assert.equal(existsSync(join(stepDir, 'escape.txt')), false);
  const log = readLines(join(stepDir, 'permissions.jsonl'));
  assert.deepEqual(log.map((entry) => [entry.tool, entry.decision]), [
    ['Write', 'allow'],
    ['Write', 'deny'],
    ['Write', 'deny'],
    ['AskUserQuestion', 'deny'],
  ]);
  assert.equal(log[1].detail, outside);
  assert.match(log[1].reason, /only inside the working copy/);
  const [grade] = gradeCalls(fake);
  assert.ok(grade.prompt.includes(JSON.stringify(log[1])), 'the grading call sees the denial as the host logged it');
  assert.equal(run.state().results.a.verdict, 'Not proven');
});

test('an assisted case is skipped with its reason and stays due, and a case blocked by one that did not pass is skipped with its reason', (t) => {
  const run = makeRun(t, [
    caseFile('x', { order: 1, assisted: 'its checks read what the terminal shows' }),
    caseFile('f', { order: 2 }),
    caseFile('y', { order: 3, from: { case: 'f' } }),
    caseFile('z', { order: 4 }),
  ]);
  const fail = { verdict: 'Fail', line: 'The skill skipped the step the case checks.', judge: [], findings: [{ kind: 'skill', text: 'It skipped the step.' }] };
  const fake = fakeClaude(run, { turns: [{ text: 'Done.' }, { text: 'Done.' }], judgements: [{ grade: fail }, { grade: pass() }] });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  assert.deepEqual(fake.sessions().map((call) => call.prompt), ['/f', '/z']);
  const { results } = run.state();
  assert.equal(results.x.verdict, 'Not run');
  assert.match(results.x.line, /assisted[\s\S]*its checks read what the terminal shows/i);
  assert.equal(results.y.verdict, 'Not run');
  assert.match(results.y.line, /\bf\b[\s\S]*did not pass/);
  assert.deepEqual(Object.keys(run.ledger()).sort(), ['f', 'z']);
  assert.deepEqual(run.due().output.due.find((entry) => entry.case === 'x'), { case: 'x', reason: 'new' });
});

test('auto refuses to start while ANTHROPIC_API_KEY is set, before any step or call', (t) => {
  const run = makeRun(t, [caseFile('a')]);
  const fake = fakeClaude(run, { turns: [{ text: 'Done.' }], judgements: [{ grade: pass() }] });
  fake.env.ANTHROPIC_API_KEY = 'sk-ant-test';

  const result = auto(run, fake);

  assert.equal(result.status, 1);
  assert.equal(result.output.status, 'refused');
  assert.match(result.output.message, /ANTHROPIC_API_KEY/);
  assert.deepEqual(fake.calls(), []);
  assert.equal(existsSync(join(run.runDir, 'steps')), false);
});

test('a run stopped by a failed session resumes with auto, which restarts that step from its restore point', (t) => {
  const run = makeRun(t, [caseFile('a', { order: 1 }), caseFile('b', { order: 2 })]);
  const fake = fakeClaude(run, {
    turns: [{ text: 'Done.' }, { tools: [write('{{CWD}}/half.txt', 'half\n')], error: 'API Error: the session was cut short' }, { text: 'Done.' }],
    judgements: [{ grade: pass() }, { grade: pass() }],
  });

  const stopped = auto(run, fake);
  assert.equal(stopped.status, 1);
  assert.match(stopped.output.message, /\bb\b[\s\S]*cut short[\s\S]*auto again/);
  assert.deepEqual(Object.keys(run.state().results), ['a']);
  assert.ok(existsSync(join(run.runDir, 'steps', 'b', 'repo', 'half.txt')));

  const resumedRun = auto(run, fake);
  assert.equal(resumedRun.status, 0, resumedRun.report);
  assert.equal(existsSync(join(run.runDir, 'steps', 'b', 'repo', 'half.txt')), false, 'b ran again in a fresh working copy');
  assert.equal(fake.sessions()[2].args.includes('--resume'), false);
  assert.deepEqual(fake.sessions().map((call) => call.prompt), ['/a', '/b', '/b']);
  assert.deepEqual(Object.keys(run.state().results), ['a', 'b']);
});

test('the case\'s shell lines run in the working copy before the session, which runs in the environment they leave', (t) => {
  const run = makeRun(t, [caseFile('a', { shell: ["$env:UAT_PROBE = 'set by the shell lines'", "Set-Content -Path shell.txt -Value 'ran'"] })]);
  const fake = fakeClaude(run, { turns: [{ text: 'Done.' }], judgements: [{ grade: pass() }] });

  const result = auto(run, fake);

  assert.equal(result.status, 0, result.report);
  assert.equal(fake.sessions()[0].env.UAT_PROBE, 'set by the shell lines');
  assert.equal(readText(join(run.runDir, 'steps', 'a', 'repo', 'shell.txt')).trim(), 'ran');
});

test('a shell line that fails stops the run before the session starts, naming the case', (t) => {
  const run = makeRun(t, [caseFile('a', { shell: ['exit 3'] })]);
  const fake = fakeClaude(run, { turns: [{ text: 'Done.' }], judgements: [{ grade: pass() }] });

  const result = auto(run, fake);

  assert.equal(result.status, 1);
  assert.match(result.output.message, /^a: its shell lines failed[\s\S]*exit 3/);
  assert.deepEqual(fake.calls(), []);
});

test('report writes a review of the run beside the summary, with every criterion and finding, and no quota or cost figure', (t) => {
  const criterion = 'It explained why the build stopped';
  const run = makeRun(t, [caseFile('a', { order: 1, title: 'Build stops at a contradiction', assertions: [{ name: 'readme kept', file: 'README.md', matches: '^hello$' }, { judge: criterion }] }), caseFile('x', { order: 2, assisted: 'it reads the terminal' })]);
  const grades = {
    verdict: 'Fail',
    line: 'The build skill should stop when the spec contradicts itself and say why; it stopped but gave no reason.',
    judge: [{ criterion, result: 'fail', evidence: 'its last turn reads "Stopping." and names no contradiction' }],
    findings: [{ kind: 'skill', text: 'The build skill stops without naming the contradiction it found.' }],
  };
  const fake = fakeClaude(run, { turns: [{ text: 'Stopping.' }], judgements: [{ grade: grades }] });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const review = readText(join(run.runDir, 'review.md'));
  assert.equal(result.output.review, join(run.runDir, 'review.md'));
  for (const text of ['Build stops at a contradiction', 'Fail', grades.line, criterion, grades.judge[0].evidence, grades.findings[0].text, 'readme kept', 'it reads the terminal']) {
    assert.ok(review.includes(text), `the review holds: ${text}`);
  }
  assert.doesNotMatch(review, /cost|usage|token|quota|0\.4567|1234|567/i);
});

test('auto given --source starts a run of the chosen cases in a new run folder, and makes its judgement calls with the model --judge-model names, Sonnet by default', (t) => {
  const run = makeRun(t, [caseFile('a', { order: 1 }), caseFile('b', { order: 2 })]);
  const fake = fakeClaude(run, { turns: [{ text: 'Done.' }, { text: 'Done.' }, { text: 'Done.' }], judgements: [{ grade: pass() }, { grade: pass() }, { grade: pass() }] });
  const runDir = join(run.root, 'second');
  const start = (...args) => spawnSync(process.execPath, [runScript, 'auto', '--run', runDir, ...args], { encoding: 'utf8', env: fake.env });

  const started = start('--source', run.source, '--cases-dir', run.casesDir, '--cases', 'b', '--judge-model', 'opus');
  assert.equal(started.status, 0, `${started.stdout}${started.stderr}`);
  assert.deepEqual(JSON.parse(started.stdout).cases, [{ case: 'b', verdict: 'Pass' }]);
  assert.deepEqual(fake.sessions().map((call) => call.prompt), ['/b']);
  const modelOf = (call) => call.args[call.args.indexOf('--model') + 1];
  assert.deepEqual(fake.judgements().map(modelOf), ['opus']);

  const resumedRun = auto(run, fake);
  assert.equal(resumedRun.status, 0, resumedRun.report);
  assert.deepEqual(fake.judgements().slice(1).map(modelOf), ['sonnet', 'sonnet']);

  const again = start('--cases', 'a');
  assert.equal(again.status, 1);
  assert.match(JSON.parse(again.stdout).message, /already holds a run/);

  const unknownDir = join(run.root, 'third');
  const unknown = spawnSync(process.execPath, [runScript, 'auto', '--run', unknownDir, '--source', run.source, '--cases-dir', run.casesDir, '--cases', 'nosuch'], { encoding: 'utf8', env: fake.env });
  assert.equal(unknown.status, 1);
  assert.match(JSON.parse(unknown.stdout).message, /no case nosuch/);
  assert.equal(existsSync(unknownDir), false);
});

test('the driver and the permission host are dependency-free Node ESM', () => {
  for (const name of ['driver.mjs', 'permission-host.mjs']) {
    const text = readText(join(repoRoot, '.claude', 'skills', 'uat', 'scripts', name));
    const imports = [...text.matchAll(/^import [^;]* from '([^']+)';$/gm)].map(([, from]) => from);
    assert.ok(imports.length > 0, name);
    assert.deepEqual(imports.filter((from) => !from.startsWith('node:') && !from.startsWith('./')), [], name);
    assert.doesNotMatch(text, /\brequire\(/, name);
  }
});
