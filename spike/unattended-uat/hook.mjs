// PreToolUse hook on AskUserQuestion: answers each question the way /uat
// would propose it, by ANSWERING.md and the case's `answers`, through one
// short model call. It returns the documented shape: permissionDecision
// "allow" with an updatedInput that repeats `questions` and adds `answers`
// (question text -> option label).
//
// Environment, set by case.mjs: UAT_CASE_FILE, UAT_STEP_DIR, UAT_JUDGE_MODEL.

import { join } from 'node:path';

import { ask, jsonIn, logCall, readJson, readText, uatDir } from './lib.mjs';

const stdin = await new Promise((done) => {
  let data = '';
  process.stdin.setEncoding('utf8').on('data', (chunk) => (data += chunk)).on('end', () => done(data));
});
const event = JSON.parse(stdin);
const toolInput = event.tool_input ?? {};
const questions = toolInput.questions ?? [];
const stepDir = process.env.UAT_STEP_DIR;
const uatCase = readJson(process.env.UAT_CASE_FILE);

const prompt = `You stand in for the person in an unattended UAT run. Answer the questions below by these rules.

<rules>
${readText(join(uatDir, 'ANSWERING.md'))}
</rules>

<case_answers>
${JSON.stringify(uatCase.answers ?? [], null, 2)}
</case_answers>

<case_checks>
${JSON.stringify((uatCase.assertions ?? []).map((a) => a.judge ?? a.name ?? a.file ?? a.run), null, 2)}
</case_checks>

<questions>
${JSON.stringify(questions, null, 2)}
</questions>

A person in an assisted run sometimes answers nothing and types "hecho": when the question is where the case's checks expect the agent to stop (an approval it must only ask for, for example), or when any answer would take the agent past what the case tests. Then end the step instead of answering, even when an answers entry such as "accept what it proposes" could be stretched to fit.
Otherwise every label must be copied exactly from that question's options. For a multiSelect question, join the labels with ", ".
Reply with one JSON object and nothing else, either
{"answers": [{"question": "<the question text, exactly>", "label": "<option label>", "drift": <true when no case answer fits>, "intent": "<the answer used>", "reason": "<why>"}]}
or
{"end": true, "reason": "<why the step ends at this question>"}`;

function validate(reply) {
  const answers = {};
  for (const q of questions) {
    const found = reply.answers?.find((a) => a.question === q.question);
    if (!found) throw new Error(`no answer for: ${q.question}`);
    const labels = q.multiSelect ? found.label.split(', ') : [found.label];
    for (const label of labels) {
      if (!q.options.some((o) => o.label === label)) throw new Error(`not an option of "${q.question}": ${label}`);
    }
    answers[q.question] = found.label;
  }
  return answers;
}

const respond = (output) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...output } }));

let lastError;
for (let attempt = 0; attempt < 2; attempt += 1) {
  try {
    const extra = lastError ? `\n\nYour previous reply was refused: ${lastError}` : '';
    const reply = jsonIn(ask(prompt + extra, { kind: 'answer', stepDir, model: process.env.UAT_JUDGE_MODEL, cwd: stepDir }));
    if (reply.end) {
      // What a person typing "hecho" does: the question stays unanswered and the session stops.
      logCall(stepDir, { kind: 'ended', questions: questions.map((q) => q.question), reason: reply.reason });
      process.stdout.write(JSON.stringify({
        continue: false,
        stopReason: `UAT step ends at this question: ${reply.reason}`,
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'the UAT step ends here' },
      }));
      process.exit(0);
    }
    const answers = validate(reply);
    logCall(stepDir, { kind: 'answered', questions: questions.map((q) => q.question), answers: reply.answers });
    respond({ permissionDecision: 'allow', updatedInput: { ...toolInput, answers } });
    process.exit(0);
  } catch (error) {
    lastError = error.message;
  }
}
logCall(stepDir, { kind: 'answer_failed', error: lastError });
respond({ permissionDecision: 'deny', permissionDecisionReason: `the UAT hook could not answer: ${lastError}` });
