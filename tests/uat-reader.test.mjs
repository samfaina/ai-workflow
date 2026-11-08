// The UAT reader, driven as the conductor drives it: a process given a step
// folder, reading synthetic session logs.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { BEFORE, EXIT_UNRECOGNIZED, log, lines, makeStep, question, reader, startWatch } from './uat-fixtures.mjs';

const watch = (step, ...args) => reader(step, 'watch', '--step', step.stepDir, '--timeout', '3', '--interval', '50', ...args);

test('watch reports a question that is still open, as asked', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.command('aw-setup'), log.ask('q1', [question('Tracker', ['None', 'GitHub'])])));

  const { status, output } = watch(step);

  assert.equal(status, 0);
  assert.equal(output.status, 'question');
  assert.equal(output.session, 's1');
  assert.deepEqual(output.questions, [
    {
      header: 'Tracker',
      question: 'Tracker?',
      multiSelect: false,
      options: [
        { label: 'None', description: 'None described' },
        { label: 'GitHub', description: 'GitHub described' },
      ],
    },
  ]);
});

test('watch does not report a question that already has its answer', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.ask('q1', [question('Tracker')]), log.answer('q1', { 'Tracker?': 'A' })));

  const { status, output } = watch(step, '--timeout', '0');

  assert.equal(status, 0);
  assert.equal(output.status, 'timeout');
});

test('watch reports every question of one AskUserQuestion call together', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.ask('q1', [question('One'), question('Two'), question('Three')])));

  const { output } = watch(step);

  assert.deepEqual(output.questions.map((q) => q.header), ['One', 'Two', 'Three']);
});

test('watch ignores sidechain and meta entries', (t) => {
  const step = makeStep(t);
  step.writeSession(
    's1',
    lines(
      log.ask('sub', [question('Subagent')], undefined, { isSidechain: true }),
      log.ask('meta', [question('Meta')], undefined, { isMeta: true }),
    ),
  );

  assert.equal(watch(step, '--timeout', '0').output.status, 'timeout');
});

test('watch tolerates a half-written last line', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', `${lines(log.ask('q1', [question('Tracker')]))}{"type":"assistant","mess`);

  const { status, output } = watch(step);

  assert.equal(status, 0);
  assert.equal(output.toolUseId, 'q1');
});

test('watch exits with its own code on a line in the middle that is not JSON', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.command('aw-setup'), 'not json at all', log.ask('q1', [question('X')])));

  const { status, stderr } = watch(step);

  assert.equal(status, EXIT_UNRECOGNIZED);
  assert.match(stderr, /s1\.jsonl/);
});

test('watch exits with its own code on entries it does not know the shape of', (t) => {
  for (const entry of [{ kind: 'no type' }, { type: 'assistant', timestamp: 'x' }, { type: 'user', message: {} }]) {
    const step = makeStep(t);
    step.writeSession('s1', lines(entry));
    assert.equal(watch(step, '--timeout', '0').status, EXIT_UNRECOGNIZED, JSON.stringify(entry));
  }
});

test('watch accepts entry types it has never seen, as new Claude Code versions add them', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.housekeeping(), { type: 'brand-new-thing', anything: 1 }, log.ask('q1', [question('X')])));

  assert.equal(watch(step).output.status, 'question');
});

test('a question already shown is not reported again by the next watch', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.ask('q1', [question('First')])));
  assert.equal(watch(step).output.toolUseId, 'q1');

  assert.equal(watch(step, '--timeout', '0').output.status, 'timeout');

  step.appendSession('s1', lines(log.answer('q1', { 'First?': 'A' }), log.ask('q2', [question('Second')])));
  assert.equal(watch(step).output.toolUseId, 'q2');
});

test('watch reports a turn that ended with no user entry after it, once', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.command('aw-spec'), log.endTurn('m1', 'Here is the draft. Approve?'), log.housekeeping()));

  const { status, output } = watch(step);

  assert.equal(status, 0);
  assert.equal(output.status, 'turn_end');
  assert.equal(output.text, 'Here is the draft. Approve?');
  assert.equal(watch(step, '--timeout', '0').output.status, 'timeout');
});

test('a turn the person already replied to is not waiting', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.endTurn('m1', 'Approve?'), log.userText('Looks good, but...')));

  assert.equal(watch(step, '--timeout', '0').output.status, 'timeout');
});

test('watch reports each later turn end of the same session', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.endTurn('m1', 'First')));
  assert.equal(watch(step).output.text, 'First');

  step.appendSession('s1', lines(log.userText('More'), log.endTurn('m2', 'Second')));

  assert.equal(watch(step).output.text, 'Second');
});

test('a turn end written in several entries reports all of its text', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.endTurn('m1', 'Part one.'), log.endTurn('m1', 'Part two.')));

  assert.equal(watch(step).output.text, 'Part one.\nPart two.');
});

test('an open question wins over the turn end before it', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.endTurn('m1', 'Earlier'), log.userText('go on'), log.ask('q1', [question('Now')])));

  assert.equal(watch(step).output.status, 'question');
});

test('a session that started before the step is not the step\'s session', (t) => {
  const step = makeStep(t);
  step.writeSession('old', lines(log.command('aw-setup', '', BEFORE), log.ask('q1', [question('Old')], BEFORE)));

  assert.equal(watch(step, '--timeout', '0').output.status, 'timeout');
});

test('two sessions started after the step are reported as ambiguous until one is picked', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.command('aw-setup'), log.ask('q1', [question('One')])));
  step.writeSession('s2', lines(log.userText('something else'), log.ask('q2', [question('Two')])));

  const ambiguous = watch(step);
  assert.equal(ambiguous.status, 0);
  assert.equal(ambiguous.output.status, 'ambiguous');
  assert.deepEqual(ambiguous.output.candidates.map((c) => c.session).sort(), ['s1', 's2']);
  assert.match(JSON.stringify(ambiguous.output.candidates), /something else/);

  assert.equal(reader(step, 'pick', '--step', step.stepDir, '--session', 's2').status, 0);
  assert.equal(watch(step).output.toolUseId, 'q2');
});

test('the session is kept once found, even if another one appears later', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.ask('q1', [question('One')])));
  assert.equal(watch(step).output.session, 's1');

  step.writeSession('s2', lines(log.ask('q2', [question('Other')])));
  step.appendSession('s1', lines(log.answer('q1', { 'One?': 'A' }), log.ask('q3', [question('Three')])));

  assert.equal(watch(step).output.toolUseId, 'q3');
});

test('a step that continues a session only looks at what happened after it began', (t) => {
  const step = makeStep(t, { continues: true });
  step.writeSession('s1', lines(log.command('aw-intake', '', BEFORE), log.ask('old', [question('Old')], BEFORE), log.endTurn('m0', 'Old end', BEFORE)));

  assert.equal(watch(step, '--timeout', '0').output.status, 'timeout');

  step.appendSession('s1', lines(log.command('aw-spec'), log.endTurn('m1', 'New end')));
  const { output } = watch(step);
  assert.equal(output.status, 'turn_end');
  assert.equal(output.text, 'New end');
});

test('watch reports a question appended to a live file within 10 seconds', async (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.command('aw-setup')));
  const watching = startWatch(step, '--timeout', '20');
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const appendedAt = Date.now();
  step.appendSession('s1', lines(log.ask('q1', [question('Live')])));
  const { output, at } = await watching;

  assert.equal(output.toolUseId, 'q1');
  assert.ok(at - appendedAt < 10000, `took ${at - appendedAt} ms`);
});

test('watch reports a turn end appended to a live file', async (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.command('aw-spec')));
  const watching = startWatch(step, '--timeout', '20');
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const appendedAt = Date.now();
  step.appendSession('s1', lines(log.endTurn('m1', 'Waiting for you')));
  const { output, at } = await watching;

  assert.equal(output.status, 'turn_end');
  assert.ok(at - appendedAt < 10000, `took ${at - appendedAt} ms`);
});

const fullSession = () =>
  lines(
    log.housekeeping(),
    log.command('ai-workflow:aw-setup', 'quick'),
    log.tool('t1', 'Bash', { command: 'git status --porcelain' }),
    log.toolResult('t1', 'ok'),
    log.tool('t2', 'Read', { file_path: 'missing.md' }),
    log.toolResult('t2', 'no such file', true),
    log.ask('q1', [question('Tracker', ['None', 'GitHub']), question('Access', ['draft', 'write'])]),
    log.answer('q1', { 'Tracker?': 'None', 'Access?': 'draft' }),
    log.tool('t3', 'Bash', { command: 'npm test' }),
    log.toolResult('t3', 'ok'),
    log.endTurn('m1', 'Draft ready'),
    log.userText('Looks good, but one more thing'),
    log.ask('q2', [question('Still open')]),
    log.endTurn('m2', 'All done'),
  );

test('summary gives the command, the questions with answers, turns, tools, errors and last text', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', fullSession());

  const { status, output } = reader(step, 'summary', '--step', step.stepDir);

  assert.equal(status, 0);
  assert.equal(output.session, 's1');
  assert.equal(output.command, '/ai-workflow:aw-setup quick');
  assert.deepEqual(output.questions, [
    { header: 'Tracker', question: 'Tracker?', multiSelect: false, options: ['None', 'GitHub'], answer: 'None' },
    { header: 'Access', question: 'Access?', multiSelect: false, options: ['draft', 'write'], answer: 'draft' },
    { header: 'Still open', question: 'Still open?', multiSelect: false, options: ['A', 'B'], answer: null },
  ]);
  assert.deepEqual(output.userTurns, ['Looks good, but one more thing']);
  assert.deepEqual(output.toolCalls, { Bash: 2, Read: 1 });
  assert.deepEqual(output.toolErrors, [{ tool: 'Read', text: 'no such file' }]);
  assert.deepEqual(output.agentTurns, ['Draft ready', 'All done']);
  assert.equal(output.lastAgentText, 'All done');
});

test('summary leaves subagent work out', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.command('aw-review'), { ...log.tool('s', 'Grep', { pattern: 'x' }), isSidechain: true }, log.endTurn('m1', 'Done')));

  assert.deepEqual(reader(step, 'summary', '--step', step.stepDir).output.toolCalls, {});
});

test('summary reads a log named directly, for logs of an earlier run', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', fullSession());

  const { output } = reader(step, 'summary', '--file', join(step.projectDir, 's1.jsonl'));

  assert.equal(output.command, '/ai-workflow:aw-setup quick');
});

test('summary exits with its own code on an unrecognized file', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines('garbage', log.command('x')));

  assert.equal(reader(step, 'summary', '--step', step.stepDir).status, EXIT_UNRECOGNIZED);
});

test('peek shows what is pending even if watch already reported it, and changes nothing', (t) => {
  const step = makeStep(t);
  step.writeSession('s1', lines(log.ask('q1', [question('Tracker')])));
  watch(step);

  const first = reader(step, 'peek', '--step', step.stepDir);
  assert.equal(first.status, 0);
  assert.equal(first.output.status, 'question');

  assert.equal(watch(step, '--timeout', '0').output.status, 'timeout');
  assert.equal(reader(step, 'peek', '--step', step.stepDir).output.toolUseId, 'q1');
});

test('peek says when the agent is working or no session exists yet', (t) => {
  const step = makeStep(t);
  assert.equal(reader(step, 'peek', '--step', step.stepDir).output.status, 'no_session');

  step.writeSession('s1', lines(log.command('aw-setup')));
  assert.equal(reader(step, 'peek', '--step', step.stepDir).output.status, 'working');
});
