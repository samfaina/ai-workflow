---
name: uat
description: "Conduct a UAT run of the aw- skills from this session: restore each UAT case into a working copy, watch the person's separate Claude Code session through its log, propose each answer, and grade the step when the person says hecho. Run with the path of the scratch app's clone, or a run folder to resume."
disable-model-invocation: true
---

# UAT conductor

A person runs each **UAT case** in its own fresh Claude Code session. You are the **UAT conductor**: a second session that prepares the step, watches that session's log, proposes answers and grades the result. This chat is the only interface. You never type into the case session, and you never write to the source repo.

Every command below is `node <this skill>/scripts/<script> <mode> --run <run>` for `run.mjs`, and `--step <stepDir>` for `reader.mjs`. Both print JSON. Speak to the person in their language.

## Start

The argument is a run folder to resume, or the path of the scratch app's clone. The clone may also be in `UAT_SOURCE`. Its path stays out of this repo: never write it to a committed file.

- **A folder holding `state.json`:** resume it. `next` returns the first step without a result, and a step already under way comes back with `resumed: true`, its working copy untouched.
- **A clone:** `init --run <run> --source <clone>`, with `<run>` a new short folder outside any repo, such as `~/aw-uat/<yyyymmdd>`. `--cases a,b` runs a subset.
- **Neither reachable:** stop and ask. The run needs this machine's clone.

Done when `next` can run against a run folder.

## Each step

### 1. Prepare

Run `next`.

- `ready`: give the person `paste.shell` to run outside the agent, then `paste.command` to type inside it, and list `answers` and `turns` so they know what is coming. Tell them to type `hecho` here when the step is over.
- `blocked`: the case needs the restore point of `needs`, which did not pass. Ask whether to `skip --reason <text>` it, then run `next` again.
- `done`: go to **Finish**.

Done when the person has the commands, and the first watch is running.

### 2. Watch

Run `reader.mjs watch --step <stepDir>` in the background, so you are woken when it exits. Launch a new one after handling each report, until the person types `hecho`. It remembers what it already reported.

| `status` | What to do |
| --- | --- |
| `question` | Show every question as asked, with its options and your proposed answer (step 3). |
| `turn_end` | The agent is waiting. Its text is often a question in plain prose: treat it like one, and propose the next reply from `turns`. |
| `ambiguous` | Show the `candidates` and ask which session is the step's. Then `reader.mjs pick --step <stepDir> --session <id>`. |
| `timeout` | Say nothing is happening yet, and launch another watch. |

Exit code 3 means Claude Code changed its log format. Stop and report the file named in stderr: grading a log the reader cannot read proves nothing.

When a `turn_end` follows a turn that has `assertions` in the case, run `check --turn <n>` (counting from 1) before proposing the next reply, and report the result. A later edit can overwrite what that turn left.

### 3. Propose answers

Answers are intents, and option labels change between runs. Match the question to an entry's `when`, then pick the option of **this run** that fulfils its `intent`. Show the reason.

When no entry fits, the question is **drift**. Choose an answer from what the case is testing, show it marked as drift with your reason, and once the person has answered, record it: `drift --when <the question> --intent <the answer used> --reason <why>`.

Done when every question and turn end got a proposal.

### 4. Wait for `hecho`

The person types the answers in the case session. If they type `pregunta`, run `reader.mjs peek --step <stepDir>` and show what it finds: this is the fallback for a watcher that missed something.

### 5. Grade

Run `check`, then `reader.mjs summary --step <stepDir>`. Report the two apart: deterministic assertions first, then judgement.

Grade each criterion in `judge` against the summary and the working copy: pass, fail or not_proven, with evidence a reader can check (a quote, a file and line, a command's output). Reach for the session log only for a detail the summary leaves out.

Sort every problem into a **skill defect** or an **environment problem** (a missing dependency, the clone's state, the network).

| Verdict | When |
| --- | --- |
| Pass | Every assertion and criterion passed. |
| Fail | The skill did the wrong thing. |
| Not proven | The path under test never ran, or the environment got in the way. |

Done when every assertion and criterion has its result and evidence.

### 6. Save

Write the grades to a file in the run folder, and `record --grades <file>`:

```json
{
  "verdict": "Pass",
  "line": "what was checked, in one sentence, for the summary",
  "judge": [{ "criterion": "the text", "result": "pass", "evidence": "..." }],
  "findings": [{ "kind": "skill", "text": "..." }, { "kind": "environment", "text": "..." }]
}
```

`record` refuses a Pass with anything failing. A passed step leaves a **UAT restore point** and a copy of `.aw/`. When a step did not pass and later cases depend on its state, ask the person whether to go on from it: add `--keep-point yes` only if they say so.

Show the verdict with its evidence per criterion, then go back to step 1.

## Finish

Run `report`. It writes `summary.md` in the run folder, one line per case. Show it to the person. Case files changed by drift are the only changes to this repo: tell them to review and commit those.

To change or add a case, read [CASE-FORMAT.md](CASE-FORMAT.md).
