// The UAT driver, `run.mjs auto`, run as a process against a fake `claude` on
// PATH (uat-fake-claude.mjs), which replays a scripted session and answers the
// judgement calls with scripted JSON. The permission host is tested only
// through it. No test runs the real Claude Code binary.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import { repoRoot } from './fixtures.mjs';
import { caseFile, git, makeRun, runScript } from './uat-fixtures.mjs';

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
  // No real key or token reaches a test: one that needs them sets its own.
  for (const key of ['ANTHROPIC_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN', 'UAT_GH_TOKEN']) delete env[key];
  // Quota thresholds no scripted reading reaches, unless a test sets its own.
  Object.assign(env, { UAT_MAX_FIVE_HOUR: '90', UAT_MAX_WEEKLY: '80' });
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = `${bin}${delimiter}${env[pathKey] ?? ''}`;
  const callsFile = join(dir, 'calls.jsonl');
  const calls = () => (existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []);
  const isLiveness = (call) => call.prompt.startsWith('# UAT liveness check');
  return {
    env,
    calls,
    liveness: () => calls().filter(isLiveness),
    sessions: () => calls().filter((call) => call.args.includes('stream-json') && !isLiveness(call)),
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
// A reply judgement that answers the turn's one question from the next turns
// entry, or from an answers entry.
const sendTurn = (message, reason) => ({ action: 'reply', message, questions: [{ question: "the agent's question", entry: 'turn', answer: message, reason }] });
const answerFrom = (entry, message, reason) => ({ action: 'reply', message, questions: [{ question: "the agent's question", entry, answer: message, reason }] });
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
      { reply: sendTurn('I approve the spec.', 'the next turn approves it') },
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
  // The continued case logs its permission prompts, and answers its questions, in its own step folder.
  const valueOf = (call, flag) => call.args[call.args.indexOf(flag) + 1];
  assert.equal(valueOf(continued, '--mcp-config'), join(run.runDir, 'steps', 'b', 'permission-host.json'));
  assert.equal(valueOf(continued, '--settings'), join(run.runDir, 'steps', 'b', 'settings.json'));
  const asFirst = (arg) => ({ [valueOf(continued, '--mcp-config')]: valueOf(first, '--mcp-config'), [valueOf(continued, '--settings')]: valueOf(first, '--settings') })[arg] ?? arg;
  assert.deepEqual(withoutResume(continued.args).map(asFirst), first.args);
  for (const flag of ['--plugin-dir', '--settings', '--mcp-config', '--permission-prompt-tool']) assert.ok(first.args.includes(flag), flag);
  const [hook] = JSON.parse(readText(valueOf(first, '--settings'))).hooks.PreToolUse;
  assert.equal(hook.matcher, 'AskUserQuestion');
  assert.equal(hook.hooks[0].onFailure, 'block');
  assert.ok(hook.hooks[0].timeout > 0, 'an explicit timeout');
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
      { reply: sendTurn('Use SQLite.', 'a turn') },
      { reply: answerFrom(0, 'Use SQLite.', 'the database entry fits') },
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

test('a prose round is answered question by question: an entry answers one question at most, a drift answer takes only a recommendation the agent wrote and is recorded, and the grade sees the replies sent', (t) => {
  const answers = [
    { when: 'In what order reservations are served', intent: 'Oldest first', reason: 'the ticket asks it' },
    { when: 'Whether the answer opens another decision', intent: 'No', reason: 'this ticket must clear the map' },
  ];
  const run = makeRun(t, [caseFile('a', { order: 1, answers }), caseFile('b', { order: 2, answers })]);
  const round = [
    '❓ **Q1** - **Serving a reservation**: hold the book for the head of the queue?',
    '',
    '➡️ Yes: the returned book is held for the first member in the queue.',
    '',
    '❓ **Q2** - **Order**: oldest first?',
    '',
    '➡️ Yes.',
    '',
    '❓ **Q3** - **How long a hold lasts**: publish it as a new ticket?',
    '',
    '➡️ Yes, as a new ticket.',
  ].join('\n');
  const hold = { question: 'Serving a reservation', entry: null, recommended: 'the returned book is held for the first member in the queue', answer: 'Yes, hold it for the head of the queue', reason: 'the case does not test how a reservation is served' };
  const order = { question: 'Order', entry: 0, answer: 'Oldest first', reason: 'entry 0' };
  const noTicket = { question: 'How long a hold lasts', entry: 1, answer: 'No, nothing else is left to decide', reason: 'entry 1 says no, against the recommendation' };
  const message = 'Q1: yes. Q2: oldest first. Q3: no, nothing else is left to decide.';
  const fake = fakeClaude(run, {
    turns: [{ text: round }, { text: 'Done: the map has cleared.' }, { text: round }, { text: 'Done: the map has cleared.' }],
    judgements: [
      { reply: { action: 'reply', message, questions: [{ ...hold, recommended: 'the book is lent to the head of the queue' }, order, noTicket] } },
      { reply: { action: 'reply', message, questions: [hold, order, noTicket] } },
      { grade: pass() },
      { reply: { action: 'reply', message, questions: [hold, order, { ...noTicket, entry: 0 }] } },
      { reply: { action: 'reply', message, questions: [hold, order, noTicket] } },
      { grade: pass() },
    ],
  });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const [invented, inventedRetry, twice, twiceRetry] = replyCalls(fake);
  assert.match(inventedRetry.prompt.slice(invented.prompt.length), /was refused[\s\S]*the book is lent to the head of the queue[\s\S]*is not in the agent's turn/);
  assert.match(twiceRetry.prompt.slice(twice.prompt.length), /was refused[\s\S]*answers entry 0 answers two questions/);
  assert.deepEqual(fake.sessions().map((call) => call.prompt), ['/a', message, '/b', message]);

  const saved = JSON.parse(readText(join(run.casesDir, 'a.json')));
  assert.deepEqual(saved.answers.at(-1), { when: hold.question, intent: hold.answer, reason: hold.reason, drift: true });
  assert.equal(saved.answers.length, 3, 'only the drift answer is added');

  const [logged] = readText(join(run.runDir, 'steps', 'a', 'replies.jsonl')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(logged.turn, 2);
  assert.equal(logged.message, message);
  assert.deepEqual(logged.questions, [hold, order, noTicket]);
  const [grade] = gradeCalls(fake);
  assert.match(grade.prompt, /## Replies the driver sent[\s\S]*Q3: no, nothing else is left to decide/);
  // Both entries were used, so the turn after the reply ends the step with no judgement.
  assert.match(grade.prompt, /Every `turns` and `answers` entry had been used/);
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

const choice = (question, labels, multiSelect = false) => ({ question, header: question.split(' ')[1], multiSelect, options: labels.map((label) => ({ label, description: `${label}, described` })) });
const askTool = (...questions) => ({ name: 'AskUserQuestion', input: { questions } });
const askCalls = (fake) => fake.judgements().filter((call) => kindOf(call) === 'ask');
// The tool results of a step's session turn, as its stream holds them.
const toolResults = (run, id, turn = 1) =>
  readLines(join(run.runDir, 'steps', id, `session-${turn}.jsonl`))
    .filter((event) => event.type === 'user' && Array.isArray(event.message.content))
    .flatMap((event) => event.message.content.filter((block) => block.type === 'tool_result'));
const tracker = choice('Which tracker does the app use?', ['GitHub', 'GitLab', 'Local files']);
const prefix = choice('Which branch prefix does the app use?', ['feat', 'fix']);
const labels = choice('Which labels does the app apply?', ['bug', 'docs', 'chore'], true);
const setupAnswers = [
  { when: 'Where tickets live', intent: 'GitLab', reason: 'the case checks the GitLab adapter' },
  { when: 'The branch prefix', intent: 'The one for fixes', reason: 'the case fixes a bug' },
  { when: 'The labels to apply', intent: 'Bug and documentation', reason: 'the case checks both labels' },
];

test('a scripted AskUserQuestion with several questions, one of them multiSelect, is answered in one call with this run\'s labels, in the shape #165 recorded', (t) => {
  const run = makeRun(t, [caseFile('a', { answers: setupAnswers })]);
  const answer = {
    action: 'answer',
    answers: [
      { question: tracker.question, labels: ['GitLab'], entry: 0, reason: 'tickets live in GitLab' },
      { question: prefix.question, labels: ['fix'], entry: 1, reason: 'the one for fixes' },
      { question: labels.question, labels: ['bug', 'docs'], entry: 2, reason: 'bug and documentation' },
    ],
  };
  const fake = fakeClaude(run, { turns: [{ tools: [askTool(tracker, prefix, labels)], text: 'Set up.' }], judgements: [{ ask: answer }, { grade: pass() }] });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const [result1] = toolResults(run, 'a');
  assert.equal(result1.is_error, false);
  assert.equal(
    result1.content,
    `Your questions have been answered: "${tracker.question}"="GitLab", "${prefix.question}"="fix", "${labels.question}"="bug, docs". You can now continue with these answers in mind.`,
  );
  const log = readLines(join(run.runDir, 'steps', 'a', 'session-1.jsonl'));
  assert.equal(log.filter((event) => event.type === 'user').length, 2, 'the prompt and one tool result: one call answered all three');
  const [ask] = askCalls(fake);
  assert.match(ask.prompt, /### Stop points/, 'the call follows ANSWERING.md');
  for (const text of [tracker.question, 'Local files', labels.question, '"multiSelect": true', 'Where tickets live', 'Bug and documentation']) assert.ok(ask.prompt.includes(text), text);
  // Every answers entry was used by the hook, so the turn that ended needs no reply.
  assert.deepEqual(fake.judgements().map(kindOf), ['ask', 'grade']);
  assert.match(gradeCalls(fake)[0].prompt, /Answering hook log[\s\S]*"decision":"allow"[\s\S]*"bug, docs"/);
  assert.equal(run.state().results.a.verdict, 'Pass');
});

test('a label that is not one of this run\'s options is refused and asked again once, and refused twice the question is denied with the reason, which keeps the step from a Pass', (t) => {
  const run = makeRun(t, [caseFile('retried', { order: 1, answers: [setupAnswers[0]] }), caseFile('denied', { order: 2, answers: [setupAnswers[0]] })]);
  const wrong = { action: 'answer', answers: [{ question: tracker.question, labels: ['Gitlab'], entry: 0, reason: 'tickets live in GitLab' }] };
  const right = { action: 'answer', answers: [{ question: tracker.question, labels: ['GitLab'], entry: 0, reason: 'tickets live in GitLab' }] };
  const notProven = { verdict: 'Not proven', line: 'The setup skill asked where tickets live, and the driver could not answer, so the setup never ran.', judge: [], findings: [{ kind: 'environment', text: 'The driver gave no valid answer.' }] };
  const fake = fakeClaude(run, {
    turns: [
      { tools: [askTool(tracker)], text: 'Set up.' },
      { tools: [askTool(tracker)], text: 'I could not get an answer.' },
    ],
    judgements: [{ ask: wrong }, { ask: right }, { grade: pass() }, { ask: wrong }, { ask: wrong }, { reply: { action: 'end', reason: 'not waiting' } }, { grade: pass() }, { grade: notProven }],
  });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const [first, retry, , secondRetry] = askCalls(fake);
  assert.ok(retry.prompt.startsWith(first.prompt), 'the retry asks the same question again');
  assert.match(retry.prompt.slice(first.prompt.length), /was refused[\s\S]*"Gitlab" is not an option[\s\S]*"GitHub", "GitLab", "Local files"/);
  assert.equal(toolResults(run, 'retried')[0].content.includes('"GitLab"'), true);
  assert.equal(run.state().results.retried.verdict, 'Pass');

  assert.match(secondRetry.prompt, /was refused/);
  const [denied] = toolResults(run, 'denied');
  assert.equal(denied.is_error, true);
  assert.match(denied.content, /could not answer[\s\S]*refused twice[\s\S]*"Gitlab" is not an option/);
  const deniedGrades = gradeCalls(fake).slice(1);
  assert.match(deniedGrades[1].prompt.slice(deniedGrades[0].prompt.length), /was refused[\s\S]*AskUserQuestion[\s\S]*refused twice[\s\S]*never a Pass/);
  assert.equal(run.state().results.denied.verdict, 'Not proven');
});

test('a question the answering hook fails on is refused by Claude Code, since the hook blocks on failure, and that refusal keeps the step from a Pass', (t) => {
  const run = makeRun(t, [caseFile('a', { answers: [setupAnswers[0]] })]);
  const notProven = { verdict: 'Not proven', line: 'The setup skill asked where tickets live, and the driver\'s answering hook failed, so the setup never ran.', judge: [], findings: [{ kind: 'environment', text: 'The answering hook failed.' }] };
  const fake = fakeClaude(run, {
    turns: [{ tools: [{ ...askTool(tracker), hookFails: true }], text: 'I got no answer.' }],
    judgements: [{ reply: { action: 'end', reason: 'not waiting' } }, { grade: pass() }, { grade: notProven }],
  });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const [blocked] = toolResults(run, 'a');
  assert.equal(blocked.is_error, true);
  assert.match(blocked.content, /blocking because onFailure is "block"/);
  const [first, retry] = gradeCalls(fake);
  assert.match(retry.prompt.slice(first.prompt.length), /was refused[\s\S]*AskUserQuestion: the answering hook gave no answer[\s\S]*the hook crashed[\s\S]*never a Pass/);
  assert.equal(run.state().results.a.verdict, 'Not proven');
});

test('a question no entry fits gets a drift answer among its options, written to the case file with drift: true, and a drift answer in free text is refused', (t) => {
  const run = makeRun(t, [caseFile('a', { answers: [setupAnswers[0]] })]);
  const colour = choice('Which colour does the app use?', ['Blue', 'Green']);
  const freeText = { action: 'answer', answers: [{ question: tracker.question, labels: ['GitLab'], entry: 0, reason: 'GitLab' }, { question: colour.question, other: 'Teal', entry: null, reason: 'the case does not test colour' }] };
  const drift = { action: 'answer', answers: [{ question: tracker.question, labels: ['GitLab'], entry: 0, reason: 'GitLab' }, { question: colour.question, labels: ['Blue'], entry: null, reason: 'the case does not test colour, and Blue is the first option' }] };
  const fake = fakeClaude(run, { turns: [{ tools: [askTool(tracker, colour)], text: 'Set up.' }], judgements: [{ ask: freeText }, { ask: drift }, { grade: pass() }] });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const [, retry] = askCalls(fake);
  assert.match(retry.prompt, /was refused[\s\S]*drift answer[\s\S]*among its options[\s\S]*not free text/);
  assert.match(toolResults(run, 'a')[0].content, /"Which colour does the app use\?"="Blue"/);
  const saved = JSON.parse(readText(join(run.casesDir, 'a.json')));
  assert.deepEqual(saved.answers.at(-1), { when: colour.question, intent: 'Blue', reason: 'the case does not test colour, and Blue is the first option', drift: true });
  assert.equal(saved.answers.length, 2, 'only the question no entry fitted is added');
  assert.match(readText(join(run.runDir, 'summary.md')), /1 question not in the case, added/);
});

test('an entry that says to type the answer in is answered with free text through "Other"', (t) => {
  const host = choice('Which GitLab host does the app use?', ['gitlab.com', 'Self-hosted']);
  const run = makeRun(t, [caseFile('a', { answers: [{ when: 'The GitLab host', intent: 'gitlab.internal.example, typed in if it is not an option', reason: 'the case checks a self-hosted GitLab' }] })]);
  const answer = { action: 'answer', answers: [{ question: host.question, other: 'gitlab.internal.example', entry: 0, reason: 'typed in, as the entry says' }] };
  const fake = fakeClaude(run, { turns: [{ tools: [askTool(host)], text: 'Set up.' }], judgements: [{ ask: answer }, { grade: pass() }] });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  assert.match(toolResults(run, 'a')[0].content, /^The user answered: "Which GitLab host does the app use\?"="gitlab\.internal\.example"/);
});

test('an AskUserQuestion at a stop point ends the step unanswered, with turns left unsent, as a person typing hecho ends it', (t) => {
  const approval = choice('Do you approve the spec?', ['Approve', 'Change it']);
  const run = makeRun(t, [
    caseFile('a', {
      answers: [{ when: 'Approval of the spec', intent: 'Accept what it proposes', reason: 'the case reads the spec' }],
      turns: [{ intent: 'Go on', reason: 'the case runs to the end' }],
      assertions: [{ name: 'left at draft', file: 'spec.md', frontmatter: { status: 'draft' } }],
    }),
  ]);
  const stopReason = 'a stop point: the case checks that the spec is left at draft, so its approval stays unanswered';
  const fake = fakeClaude(run, {
    turns: [{ tools: [write('{{CWD}}/spec.md', '---\nstatus: draft\n---\n'), askTool(approval)], text: 'Approved.' }],
    judgements: [{ ask: { action: 'end', reason: stopReason } }, { grade: pass() }],
  });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  assert.deepEqual(fake.sessions().map((call) => call.prompt), ['/a'], 'no turn was sent after the stop point');
  assert.deepEqual(fake.judgements().map(kindOf), ['ask', 'grade'], 'no reply was judged');
  assert.equal(toolResults(run, 'a').length, 1, 'the question has no tool result: only the Write ran');
  assert.ok(gradeCalls(fake)[0].prompt.includes(stopReason));
  assert.match(gradeCalls(fake)[0].prompt, /How the step ended[\s\S]*AskUserQuestion at a stop point/);
  assert.equal(run.state().results.a.verdict, 'Pass');
});

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
        tools: [write('{{CWD}}/inside.txt', 'in\n'), write(outside, 'out\n'), write('{{CWD}}/../escape.txt', 'out\n')],
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
  ]);
  assert.equal(log[1].detail, outside);
  assert.match(log[1].reason, /only inside the working copy/);
  const [grade] = gradeCalls(fake);
  assert.ok(grade.prompt.includes(JSON.stringify(log[1])), 'the grading call sees the denial as the host logged it');
  assert.equal(run.state().results.a.verdict, 'Not proven');
});

const SCRATCH = 'https://github.com/o/scratch.git';
const bash = (command) => ({ name: 'Bash', input: { command } });

// A run whose source clone's GitHub remote is the scratch repo, with the
// driver's token set, as the maintainer runs a case that writes to GitHub.
function githubRun(t, cases) {
  const run = makeRun(t, cases);
  git(run.source, 'remote', 'add', 'origin', SCRATCH);
  return run;
}

test('gh reads are allowed, and a gh write or a push or fetch aimed at a repo other than the scratch repo is denied and logged', (t) => {
  const run = githubRun(t, [caseFile('a', { setup: [{ remote: SCRATCH }] })]);
  const commands = [
    ['gh issue list --state open --json body --jq ".[].body"', 'allow'],
    ['gh pr view 7 -R someone/project', 'allow'],
    ['gh api repos/someone/project/issues', 'allow'],
    ['gh issue create --title "The map" --body "Type: wayfinder:map"', 'allow'],
    ['gh issue close 3 --repo o/scratch', 'allow'],
    ['gh api --method POST repos/{owner}/{repo}/issues/2/dependencies/blocked_by -F issue_id=7', 'allow'],
    ['gh api graphql -f query="query { viewer { login } }"', 'allow'],
    ['git push origin HEAD', 'allow'],
    ['git push ../origin.git HEAD:refs/heads/main', 'allow'],
    ["cat > notes.md <<'EOF'\ngh issue create -R someone/project --title x\nEOF", 'allow'],
    ['cat > notes.md <<EOF\n$(gh issue create -R someone/project --title x)\nEOF', 'deny'],
    ['gh issue create -R someone/project --title x', 'deny'],
    ['cd src && gh api -X POST repos/someone/project/issues -f title=x', 'deny'],
    ['gh api repos/someone/project/issues -f title=x', 'deny'],
    ['git push https://github.com/someone/project.git HEAD', 'deny'],
    ['git status; git fetch git@github.com:someone/project.git', 'deny'],
    ['git push https://gitlab.com/someone/project.git HEAD', 'deny'],
    ['gh api -XPOST repos/someone/project/issues', 'deny'],
    ['gh api graphql -f query="mutation { closeIssue(input: {}) { clientMutationId } }"', 'deny'],
    ['gh repo delete --yes', 'deny'],
    ['gh repo create someone/new --private', 'deny'],
    ['git remote add other https://github.com/someone/project.git && git push other HEAD', 'deny'],
  ];
  const fake = fakeClaude(run, {
    turns: [{ tools: commands.map(([command]) => bash(command)), text: 'Done.' }],
    judgements: [{ grade: { verdict: 'Not proven', line: 'The session was denied writes to another repo.', judge: [], findings: [{ kind: 'environment', text: 'Denied.' }] } }],
  });
  fake.env.UAT_GH_TOKEN = 'scratch-token';

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const log = readLines(join(run.runDir, 'steps', 'a', 'permissions.jsonl'));
  assert.deepEqual(log.map((entry) => [entry.detail, entry.decision]), commands);
  for (const entry of log.filter((e) => e.decision === 'deny')) assert.match(entry.reason, /o\/scratch/, entry.detail);
});

test('a case session and its shell lines get GH_TOKEN from UAT_GH_TOKEN, and git asks none of the stored credential helpers', (t) => {
  const run = makeRun(t, [caseFile('a', { shell: ['$env:UAT_PROBE = $env:GH_TOKEN.Substring(0, 7)'] })]);
  const fake = fakeClaude(run, { turns: [{ text: 'Done.' }], judgements: [{ grade: pass() }] });
  // The maintainer's own login: a stored helper and a token of their own.
  const leaked = join(run.root, 'leaked.txt');
  const globalConfig = join(run.root, 'global.gitconfig');
  writeFileSync(globalConfig, `[credential]\n\thelper = "!f() { echo leaked > '${leaked.replaceAll('\\', '/')}'; echo username=me; echo password=maintainer-password; }; f"\n`);
  Object.assign(fake.env, { GH_TOKEN: 'maintainer-token', GITHUB_TOKEN: 'maintainer-token', UAT_GH_TOKEN: 'scratch-token', GIT_CONFIG_GLOBAL: globalConfig });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const [session] = fake.sessions();
  assert.equal(session.env.GH_TOKEN, 'scratch-token');
  assert.equal(session.env.UAT_PROBE, 'scratch', 'the shell lines ran with the token too');
  assert.equal(session.env.GITHUB_TOKEN, undefined);
  assert.ok(session.env.GH_CONFIG_DIR.startsWith(join(run.runDir, 'steps', 'a')), 'gh reads no stored login of the maintainer');
  const fill = (host) => spawnSync('git', ['credential', 'fill'], { input: `protocol=https\nhost=${host}\n\n`, encoding: 'utf8', env: { ...fake.env, ...session.env } });
  const elsewhere = fill('example.com');
  assert.notEqual(elsewhere.status, 0, elsewhere.stdout);
  assert.doesNotMatch(elsewhere.stdout, /maintainer-password/);
  assert.equal(existsSync(leaked), false, 'the stored helper never ran');
  const github = fill('github.com');
  assert.equal(github.status, 0, github.stderr);
  assert.match(github.stdout, /^password=scratch-token$/m);
  assert.equal(existsSync(leaked), false);
  const stepDir = join(run.runDir, 'steps', 'a');
  const onDisk = readdirSync(stepDir).filter((name) => statSync(join(stepDir, name)).isFile() && readText(join(stepDir, name)).includes('scratch-token'));
  assert.deepEqual(onDisk, [], 'the token is written to no file of the step folder, which the grading call can read');
});

test('without UAT_GH_TOKEN, auto refuses to start a batch whose cases run gh or reach GitHub, naming them, before any step or call', (t) => {
  const run = githubRun(t, [
    caseFile('plain', { order: 1 }),
    caseFile('remote', { order: 2, setup: [{ remote: SCRATCH }] }),
    caseFile('cont', { order: 3, from: undefined, continues: 'remote' }),
    caseFile('reads', { order: 4, assertions: [{ name: 'the map is open', run: 'gh issue list --state open', stdout: 'map' }] }),
    caseFile('closes', { order: 5, cleanup: ['gh issue close 1'] }),
  ]);
  const fake = fakeClaude(run, { turns: [{ text: 'Done.' }], judgements: [{ grade: pass() }] });

  const result = auto(run, fake);

  assert.equal(result.status, 1);
  assert.equal(result.output.status, 'refused');
  assert.match(result.output.message, /UAT_GH_TOKEN/);
  assert.match(result.output.message, /remote, cont, reads, closes/);
  assert.doesNotMatch(result.output.message, /plain/);
  assert.deepEqual(fake.calls(), []);
  assert.equal(existsSync(join(run.runDir, 'steps')), false);
});

test('a step the permission host denied something in is never a Pass: the driver asks again for Not proven with an environment finding', (t) => {
  const run = githubRun(t, [caseFile('a', { setup: [{ remote: SCRATCH }] })]);
  const notProven = {
    verdict: 'Not proven',
    line: 'Asked to publish its tickets, the session was stopped from pushing to a repo other than the scratch repo, so the publishing never ran.',
    judge: [],
    findings: [{ kind: 'environment', text: 'The permission host denied a push to someone/project, which the case did not expect.' }],
  };
  const fake = fakeClaude(run, {
    turns: [{ tools: [bash('git push https://github.com/someone/project.git HEAD')], text: 'Pushed.' }],
    judgements: [{ grade: pass() }, { grade: notProven }],
  });
  fake.env.UAT_GH_TOKEN = 'scratch-token';

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const [first, retry] = gradeCalls(fake);
  assert.ok(retry.prompt.startsWith(first.prompt));
  assert.match(retry.prompt.slice(first.prompt.length), /was refused[\s\S]*denied[\s\S]*Not proven[\s\S]*environment/);
  const recorded = JSON.parse(readText(join(run.runDir, 'results', 'a.json')));
  assert.equal(recorded.verdict, 'Not proven');
  assert.deepEqual(recorded.findings.environment, [notProven.findings[0].text]);
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

test('before the first case, auto checks in one session it kills at init that the hook and the permission host are live, with the flags a case session gets', (t) => {
  const run = makeRun(t, [caseFile('a', { order: 1 }), caseFile('b', { order: 2 })]);
  const fake = fakeClaude(run, { turns: [{ text: 'Done.' }, { text: 'Done.' }], judgements: [{ grade: pass() }, { grade: pass() }] });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const [check, ...more] = fake.liveness();
  assert.deepEqual(more, [], 'one check per auto, however many cases');
  const [first] = fake.sessions();
  assert.ok(check.at < first.at);
  const flagsOf = (call) => call.args.filter((arg) => arg.startsWith('-'));
  assert.deepEqual(flagsOf(check), flagsOf(first));
  assert.deepEqual(Object.keys(run.state().results), ['a', 'b'], 'the check took no scripted turn');

  // clean deletes the check's folder and the session log Claude Code kept for it.
  const checkLogs = join(run.root, 'config', 'projects', join(run.runDir, 'liveness', 'repo').replace(/[^A-Za-z0-9]/g, '-'));
  assert.ok(existsSync(checkLogs));
  assert.equal(run.cli('clean').status, 0);
  assert.equal(existsSync(join(run.runDir, 'liveness')), false);
  assert.equal(existsSync(checkLogs), false);
});

test('with the hook or the permission host not live, auto stops before the first case and says which check failed', (t) => {
  const scenarios = [
    [{ hooks: false }, /hooks[\s\S]*--settings[\s\S]*did not run/],
    [{ tools: ['Read', 'Write', 'Bash'] }, /AskUserQuestion[\s\S]*not among the tools/],
    [{ mcp: 'failed' }, /permission host[\s\S]*failed, not connected/],
    [{ plugins: [] }, /plugin ai-workflow[\s\S]*not loaded/],
    [{ version: '2.1.290' }, /2\.1\.290[\s\S]*older than 2\.1\.295/],
  ];
  for (const [binary, why] of scenarios) {
    const run = makeRun(t, [caseFile('a')]);
    const fake = fakeClaude(run, { binary, turns: [{ text: 'Done.' }], judgements: [{ grade: pass() }] });

    const result = auto(run, fake);

    const label = JSON.stringify(binary);
    assert.equal(result.status, 1, label);
    assert.equal(result.output.status, 'refused', label);
    assert.match(result.output.message, /liveness check[\s\S]*before any case/, label);
    assert.match(result.output.message, why, label);
    assert.equal(fake.liveness().length, 1, label);
    assert.deepEqual(fake.sessions(), [], label);
    assert.deepEqual(fake.judgements(), [], label);
    assert.equal(existsSync(join(run.runDir, 'steps')), false, `${label}: no step started`);
  }
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

test('without quota thresholds, from flags or the environment, auto refuses to start, saying how to pass them, before any step or call', (t) => {
  const run = makeRun(t, [caseFile('a')]);
  const fake = fakeClaude(run, { turns: [{ text: 'Done.' }], judgements: [{ grade: pass() }] });
  delete fake.env.UAT_MAX_FIVE_HOUR;
  delete fake.env.UAT_MAX_WEEKLY;

  const neither = auto(run, fake);
  assert.equal(neither.status, 1);
  assert.equal(neither.output.status, 'refused');
  for (const way of ['--max-five-hour', '--max-weekly', 'UAT_MAX_FIVE_HOUR', 'UAT_MAX_WEEKLY']) assert.ok(neither.output.message.includes(way), way);

  const weeklyOnly = auto(run, fake, '--max-weekly', '80');
  assert.equal(weeklyOnly.status, 1);
  assert.match(weeklyOnly.output.message, /--max-five-hour/);
  assert.doesNotMatch(weeklyOnly.output.message, /--max-weekly/);

  const notPercent = auto(run, fake, '--max-five-hour', 'ninety', '--max-weekly', '80');
  assert.equal(notPercent.status, 1);
  assert.match(notPercent.output.message, /--max-five-hour[\s\S]*ninety/);

  assert.deepEqual(fake.calls(), []);
  assert.equal(existsSync(join(run.runDir, 'steps')), false);

  const fromFlags = auto(run, fake, '--max-five-hour', '90', '--max-weekly', '80');
  assert.equal(fromFlags.status, 0, fromFlags.report);
});

// The rate-limit reading a case session's turn printed, as its stream holds it.
const readingOf = (run, id, turn) =>
  readLines(join(run.runDir, 'steps', id, `session-${turn}.jsonl`)).find((event) => event.type === 'rate_limit_event').rate_limit_info.unifiedWindows;
const resetsAtMs = (window) => window.resetsAt * 1000;

test('a five-hour reading over its threshold makes auto wait until the window resets, before the next turn and before the next case, then go on', (t) => {
  const run = makeRun(t, [caseFile('a', { order: 1, turns: [{ intent: 'Go on', reason: 'the case runs to the end' }] }), caseFile('b', { order: 2 })]);
  const fake = fakeClaude(run, {
    turns: [
      { rateLimit: { five_hour: { utilization: 0.95, resetsIn: 2 }, seven_day: { utilization: 0.1, resetsIn: 86400 } }, text: 'Shall I go on?' },
      { rateLimit: { five_hour: { utilization: 0.91, resetsIn: 2 } }, text: 'Done.' },
      { text: 'Done.' },
    ],
    judgements: [{ reply: sendTurn('Go on.', 'the next turn') }, { grade: pass() }, { grade: pass() }],
  });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const [first, followUp, nextCase] = fake.sessions();
  const firstReset = resetsAtMs(readingOf(run, 'a', 1).five_hour);
  const secondReset = resetsAtMs(readingOf(run, 'a', 2).five_hour);
  assert.ok(first.at < firstReset);
  assert.ok(followUp.at >= firstReset, 'the follow-up turn waited for the reset');
  assert.ok(nextCase.at >= secondReset, 'the next case waited for the reset');
  assert.match(result.stderr, /five-hour window[\s\S]*waiting until/);
  assert.deepEqual(run.state().results, { a: { verdict: 'Pass', line: pass().line }, b: { verdict: 'Pass', line: pass().line } });
});

test('a weekly reading over its threshold makes auto stop and exit before the next case, and the run resumes from where it stopped', (t) => {
  const run = makeRun(t, [caseFile('a', { order: 1 }), caseFile('b', { order: 2 })]);
  const fake = fakeClaude(run, {
    turns: [{ rateLimit: { five_hour: { utilization: 0.2, resetsIn: 3600 }, seven_day: { utilization: 0.85, resetsIn: 86400 } }, text: 'Done.' }, { text: 'Done.' }],
    judgements: [{ grade: pass() }, { grade: pass() }],
  });

  const stopped = auto(run, fake);
  assert.equal(stopped.status, 1);
  assert.equal(stopped.output.status, 'refused');
  assert.match(stopped.output.message, /weekly window[\s\S]*--max-weekly[\s\S]*before case b[\s\S]*auto --run/);
  assert.doesNotMatch(stopped.report, /0\.85|85 ?%|85 percent/, 'no quota figure in what auto prints');
  assert.deepEqual(fake.sessions().map((call) => call.prompt), ['/a']);
  assert.deepEqual(Object.keys(run.state().results), ['a']);

  // Resumed while the week has not reset, it stops again, before any call.
  const callsBefore = fake.calls().length;
  const again = auto(run, fake);
  assert.equal(again.status, 1);
  assert.match(again.output.message, /weekly window/);
  assert.equal(fake.calls().length, callsBefore);

  const resumedRun = auto(run, fake, '--max-weekly', '90');
  assert.equal(resumedRun.status, 0, resumedRun.report);
  assert.deepEqual(fake.sessions().map((call) => call.prompt), ['/a', '/b']);
  assert.deepEqual(Object.keys(run.state().results), ['a', 'b']);
});

test('a weekly reading over its threshold mid-step stops the run before any call for the next turn, and the resumed run starts that step again from its restore point', (t) => {
  const run = makeRun(t, [caseFile('a', { turns: [{ intent: 'Go on', reason: 'the case runs to the end' }] })]);
  const fake = fakeClaude(run, {
    turns: [
      { rateLimit: { seven_day: { utilization: 0.85, resetsIn: 86400 } }, tools: [write('{{CWD}}/first.txt', 'first\n')], text: 'Shall I go on?' },
      { text: 'Shall I go on?' },
      { text: 'Done.' },
    ],
    judgements: [{ reply: sendTurn('Go on.', 'the next turn') }, { grade: pass() }],
  });

  const stopped = auto(run, fake);
  assert.equal(stopped.status, 1);
  assert.match(stopped.output.message, /weekly window[\s\S]*before turn 2 of a/);
  assert.deepEqual(fake.judgements(), [], 'not even the reply is judged once the week is over its threshold');
  assert.deepEqual(run.state().results, {});

  const resumedRun = auto(run, fake, '--max-weekly', '90');
  assert.equal(resumedRun.status, 0, resumedRun.report);
  assert.deepEqual(fake.sessions().map((call) => call.prompt), ['/a', '/a', 'Go on.']);
  assert.equal(fake.sessions()[1].args.includes('--resume'), false, 'the step starts a new session');
  assert.equal(existsSync(join(run.runDir, 'steps', 'a', 'repo', 'first.txt')), false, 'a fresh working copy');
});

test('a turn that ends in a rate-limit error mid-step stops the run, and the next auto waits for the window, resets that step and runs it from its restore point', (t) => {
  const run = makeRun(t, [caseFile('a', { order: 1, turns: [{ intent: 'Go on', reason: 'the case runs to the end' }] }), caseFile('b', { order: 2 })]);
  const goOn = { reply: sendTurn('Go on.', 'the next turn') };
  const fake = fakeClaude(run, {
    turns: [
      { tools: [write('{{CWD}}/first.txt', 'first\n')], text: 'Shall I go on?' },
      { rateLimit: { status: 'rejected', five_hour: { utilization: 1, resetsIn: 2 } }, tools: [write('{{CWD}}/half.txt', 'half\n')], error: 'API Error: 429' },
      { text: 'Shall I go on?' },
      { text: 'Done.' },
      { text: 'Done.' },
    ],
    judgements: [goOn, goOn, { grade: pass() }, { grade: pass() }],
  });

  const stopped = auto(run, fake);
  assert.equal(stopped.status, 1);
  assert.match(stopped.output.message, /^a: the case session hit the plan's rate limit on turn 2[\s\S]*auto again[\s\S]*restore point/);
  assert.deepEqual(run.state().results, {});
  assert.ok(existsSync(join(run.runDir, 'steps', 'a', 'repo', 'half.txt')));
  const reset = resetsAtMs(readingOf(run, 'a', 2).five_hour);

  const resumedRun = auto(run, fake);
  assert.equal(resumedRun.status, 0, resumedRun.report);
  assert.deepEqual(fake.sessions().map((call) => call.prompt), ['/a', 'Go on.', '/a', 'Go on.', '/b']);
  const restarted = fake.sessions()[2];
  assert.equal(restarted.args.includes('--resume'), false, 'the step starts a new session');
  assert.ok(restarted.at >= reset, 'the resumed run waited for the five-hour window first');
  for (const name of ['first.txt', 'half.txt']) assert.equal(existsSync(join(run.runDir, 'steps', 'a', 'repo', name)), false, `${name}: a fresh working copy`);
  assert.deepEqual(Object.keys(run.state().results), ['a', 'b']);
});

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]));
}

test('each case\'s readings, before and after, are written in its step folder and nowhere else: not the summary, the review, the ledger, a judgement call or what auto prints', (t) => {
  const run = makeRun(t, [caseFile('a', { order: 1, assertions: [{ judge: 'It wrote a note' }] }), caseFile('b', { order: 2 })]);
  const grades = { verdict: 'Pass', line: 'It wrote the note.', judge: [{ criterion: 'It wrote a note', result: 'pass', evidence: 'the note is there' }], findings: [] };
  const fake = fakeClaude(run, {
    turns: [{ rateLimit: { five_hour: { utilization: 0.4321, resetsIn: 3600 }, seven_day: { utilization: 0.1234, resetsIn: 86400 } }, text: 'Done.' }, { text: 'Done.' }],
    judgements: [{ grade: grades }, { grade: pass() }],
  });

  const result = auto(run, fake);
  assert.equal(result.status, 0, result.report);

  const quotaOf = (id) => JSON.parse(readText(join(run.runDir, 'steps', id, 'quota.json')));
  const a = quotaOf('a');
  assert.equal(a.before, null, 'nothing was read before the first case');
  assert.equal(a.after.five_hour.utilization, 0.4321);
  assert.equal(a.after.seven_day.utilization, 0.1234);
  assert.equal(a.after.five_hour.resetsAt, new Date(resetsAtMs(readingOf(run, 'a', 1).five_hour)).toISOString());
  assert.deepEqual(quotaOf('b').before, a.after, 'b starts from the reading a left');
  assert.deepEqual(quotaOf('b').after, a.after, 'b\'s session printed no reading');

  const figures = /0\.4321|43\.21|0\.1234|12\.34/;
  const scripted = join(run.root, 'fake');
  const holding = filesUnder(run.root).filter((file) => !file.startsWith(scripted) && figures.test(readFileSync(file, 'latin1')));
  // A step folder's path with its trailing separator, so that `a` never matches `ab`.
  const stepFolder = (id) => join(run.runDir, 'steps', id, '_').slice(0, -1);
  const inStepFolder = (file) => ['a', 'b'].some((id) => file.startsWith(stepFolder(id)));
  assert.deepEqual(
    holding.filter((file) => !inStepFolder(file)),
    [],
    'only the step folders hold a figure',
  );
  assert.ok(holding.includes(join(run.runDir, 'steps', 'a', 'quota.json')));
  for (const call of fake.calls()) assert.doesNotMatch(call.prompt, figures);
  assert.doesNotMatch(result.report, figures);
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

test('cleanup lines run in the working copy after the step is graded, on a pass and on a fail, with {{STARTED}} expanded, and one that fails stops the run', (t) => {
  // Each line writes down when the step started and whether its result was already recorded.
  const cleanup = (id) => [`Set-Content -Path cleanup.txt -Value ('{{STARTED}} ' + (Test-Path ../../../results/${id}.json))`];
  const run = makeRun(t, [
    caseFile('passes', { order: 1, cleanup: cleanup('passes') }),
    caseFile('fails', { order: 2, cleanup: cleanup('fails') }),
    caseFile('breaks', { order: 3, cleanup: ['exit 4'] }),
    caseFile('after', { order: 4 }),
  ]);
  const fail = { verdict: 'Fail', line: 'The skill skipped the step the case checks.', judge: [], findings: [{ kind: 'skill', text: 'It skipped the step.' }] };
  const fake = fakeClaude(run, {
    turns: [{ text: 'Done.' }, { text: 'Done.' }, { text: 'Done.' }, { text: 'Done.' }],
    judgements: [{ grade: pass() }, { grade: fail }, { grade: pass() }, { grade: pass() }],
  });

  const stopped = auto(run, fake);
  assert.equal(stopped.status, 1);
  assert.match(stopped.output.message, /^breaks: its cleanup lines failed[\s\S]*exit 4/);
  assert.deepEqual(Object.keys(run.state().results), ['passes', 'fails', 'breaks'], 'the result is recorded before its cleanup runs');
  assert.deepEqual(fake.sessions().map((call) => call.prompt), ['/passes', '/fails', '/breaks']);
  for (const id of ['passes', 'fails']) {
    const { startedAt } = JSON.parse(readText(join(run.runDir, 'steps', id, 'step.json')));
    const started = startedAt.replace(/\.\d+Z$/, 'Z');
    assert.equal(readText(join(run.runDir, 'steps', id, 'repo', 'cleanup.txt')).trim(), `${started} True`, id);
  }

  const resumedRun = auto(run, fake);
  assert.equal(resumedRun.status, 0, resumedRun.report);
  assert.deepEqual(fake.sessions().map((call) => call.prompt), ['/passes', '/fails', '/breaks', '/after']);
});

test('a step cut short runs its cleanup lines, for what that attempt started, before auto restarts it from its restore point', (t) => {
  // The log sits in the run folder, which outlives the working copy that reset deletes.
  const run = makeRun(t, [caseFile('a', { cleanup: ["Add-Content -Path ../../../cleanup.log -Value '{{STARTED}}'"] })]);
  const fake = fakeClaude(run, {
    turns: [{ error: 'API Error: the session was cut short' }, { text: 'Done.' }],
    judgements: [{ grade: pass() }],
  });
  const startOf = () => JSON.parse(readText(join(run.runDir, 'steps', 'a', 'step.json'))).startedAt.replace(/\.\d+Z$/, 'Z');

  assert.equal(auto(run, fake).status, 1);
  const cutShort = startOf();
  assert.equal(existsSync(join(run.runDir, 'cleanup.log')), false, 'a step cut short is not graded, so no cleanup yet');

  const resumedRun = auto(run, fake);
  assert.equal(resumedRun.status, 0, resumedRun.report);
  assert.deepEqual(readText(join(run.runDir, 'cleanup.log')).trim().split(/\r?\n/), [cutShort, startOf()]);
});

test('a shell line that fails stops the run before the session starts, naming the case', (t) => {
  const run = makeRun(t, [caseFile('a', { shell: ['exit 3'] })]);
  const fake = fakeClaude(run, { turns: [{ text: 'Done.' }], judgements: [{ grade: pass() }] });

  const result = auto(run, fake);

  assert.equal(result.status, 1);
  assert.match(result.output.message, /^a: its shell lines failed[\s\S]*exit 3/);
  assert.deepEqual(fake.sessions(), []);
  assert.deepEqual(fake.judgements(), []);
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

test('the driver, the permission host, the answering hook and the Claude Code launcher are dependency-free Node ESM', () => {
  for (const name of ['driver.mjs', 'permission-host.mjs', 'ask-hook.mjs', 'claude.mjs']) {
    const text = readText(join(repoRoot, '.claude', 'skills', 'uat', 'scripts', name));
    const imports = [...text.matchAll(/^import [^;]* from '([^']+)';$/gm)].map(([, from]) => from);
    assert.ok(imports.length > 0, name);
    assert.deepEqual(imports.filter((from) => !from.startsWith('node:') && !from.startsWith('./')), [], name);
    assert.doesNotMatch(text, /\brequire\(/, name);
  }
});
