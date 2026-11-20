// PROTOTYPE for #165, not part of the kit. A PreToolUse hook whose behaviour
// the probe sets per scenario through the plan file PROBE_PLAN names. It logs
// every input it receives to PROBE_LOG, one JSON line each.
//
// plan.mode: answer (allow + updatedInput with plan.answers / plan.annotations),
// exit1, exit2, sleep (plan.sleepSeconds, then answer), garbage (invalid JSON).
import { appendFileSync, readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const plan = JSON.parse(readFileSync(process.env.PROBE_PLAN, 'utf8'));
appendFileSync(process.env.PROBE_LOG, `${JSON.stringify({ at: new Date().toISOString(), event: input.hook_event_name, tool: input.tool_name, input: input.tool_input })}\n`);

if (input.hook_event_name !== 'PreToolUse') process.exit(0);

const answer = () => {
  const updatedInput = { ...input.tool_input, answers: plan.answers };
  if (plan.annotations) updatedInput.annotations = plan.annotations;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } }));
  process.exit(0);
};

switch (plan.mode) {
  case 'answer':
    answer();
    break;
  case 'exit1':
    process.stderr.write('probe hook: failing with exit 1');
    process.exit(1);
    break;
  case 'exit2':
    process.stderr.write('probe hook: blocking with exit 2');
    process.exit(2);
    break;
  case 'sleep':
    setTimeout(answer, plan.sleepSeconds * 1000);
    break;
  case 'garbage':
    process.stdout.write('{not json');
    process.exit(0);
    break;
  default:
    process.exit(0);
}
