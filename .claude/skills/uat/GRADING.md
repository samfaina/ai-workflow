# Grading a UAT case

How to grade one step of a **UAT case** once it is over, and the grades file that `run.mjs record --grades <file>` takes.

## What you get

- **The assertion results** from `run.mjs check`: the case's deterministic `assertions`, checked at the end of the step, and those of each turn that has its own, checked when that turn ended.
- **The step summary** from `reader.mjs summary`: what the case session asked, answered and did.
- **The working copy** the step ran in.
- **The session log**, for a detail the summary leaves out.
- **The case's `judge` criteria**: each `{ "judge": criterion }` in its `assertions`.

## Rules

Report deterministic assertions and judgement apart: the assertions first, then the judgement.

Grade each criterion in `judge` against the summary and the working copy: pass, fail or not_proven, with evidence a reader can check (a quote, a file and line, a command's output). Reach for the session log only for a detail the summary leaves out.

Sort every problem into a **skill defect** or an **environment problem** (a missing dependency, the clone's state, the network).

| Verdict | When |
| --- | --- |
| Pass | Every assertion and criterion passed, every turn with assertions included. |
| Fail | The skill did the wrong thing. |
| Not proven | The path under test never ran, or the environment got in the way. |

### Clarity

Every text written for review must make sense to someone who does not know the kit: a case's `line`, each criterion's evidence, the review of a run and the batch's results comment. Each says what the skill is for, what was expected and what happened, and leaves no internal identifier unexplained, such as an `AC-n`, a short commit or "condition 3".

## The grades file

```json
{
  "verdict": "Pass",
  "line": "what was checked, in one sentence, for the summary",
  "judge": [{ "criterion": "the text", "result": "pass", "evidence": "..." }],
  "findings": [{ "kind": "skill", "text": "..." }, { "kind": "environment", "text": "..." }]
}
```

- `verdict`: `Pass`, `Fail` or `Not proven`, from the table above.
- `line`: what was checked, in one sentence.
- `judge`: one entry per criterion, its text as the case states it, with its result and evidence.
- `findings`: one entry per problem, `kind` set to `skill` or `environment` by the sort above.

`record` refuses a verdict outside the table, a missing `line`, and a criterion left ungraded or without evidence. It refuses a Pass with anything failing: an assertion that failed, a turn with assertions that was never checked, or a criterion whose result is not `pass`.
