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
- **A clone:** ask the person where to create the run, and suggest `<UAT_TARGET>/<yyyymmdd>` when `UAT_TARGET` is set, or `~/aw-uat/<yyyymmdd>` in their home folder. It must be a new folder with a short path, outside any repo. Then `init --run <that folder> --source <clone>`; `init` without `--run` creates `<UAT_TARGET>/<yyyymmdd>` and prints it as `run`. `--cases a,b` runs a subset. It records this checkout's commit as the one the run tests. When it prints a `warning`, show it to the person: this checkout has uncommitted changes, so the recorded commit is not exactly the code the run tests.
- **Neither reachable:** stop and ask. The run needs this machine's clone.

When the person asks what to run, run `run.mjs due`, which takes no `--run`. It lists each **Due UAT case** with its reason, the **UAT batches** with the `--cases` list that starts each one's run, and apart from them the assisted cases, grouped the same way, each with its reason. Each batch or group goes in a run folder of its own. Before a release, run `run.mjs due --release` instead: it also lists every case with no pass since the latest `vX.Y.Z` tag, and the release waits until it lists nothing.

A batch can also run as an **Unattended run**, which the person starts in a terminal, never from this session: `run.mjs auto --run <run> --source <clone> --cases a,b`, or `auto --run <run>` to resume one. The **UAT driver** runs each case in `claude -p` with the kit loaded from this checkout and its permission prompts answered by the **Permission host**. It answers each `AskUserQuestion` through a `PreToolUse` hook, with this run's option labels or a drift answer it records in the case file, ends the step at a stop point, and replies to prose turns, all by [ANSWERING.md](ANSWERING.md). Before the first case it checks, in a session it stops before anything reaches the model, that the hook and the permission host are live, and stops when they are not. Your own hooks and plugins load in each case session too, so a hook of yours that answers or denies `AskUserQuestion` first changes what a case sees. It grades each step by [GRADING.md](GRADING.md) with Sonnet unless `--judge-model` names another model. It skips assisted cases, which stay due, and refuses to start while `ANTHROPIC_API_KEY` is set. It paces on the plan's quota by the rate-limit readings in each case session's stream, before each case and each turn: when the five-hour window is over `--max-five-hour` it waits until the window resets, and when the weekly window is over `--max-weekly`, or a turn ends in a rate-limit error, it stops, and `auto --run <run>` resumes it, starting a step left without a result again from its restore point. Both thresholds are percents, passed as those flags or as `UAT_MAX_FIVE_HOUR` and `UAT_MAX_WEEKLY`; without them it refuses to start, since no default figure is committed. Each case's readings stay in its step folder, in `quota.json` beside the session streams they came from, and no utilization figure reaches the summary, the review or the ledger. A case may write to GitHub only on the scratch repo, with the token in `UAT_GH_TOKEN`, without which the driver refuses a batch whose cases run `gh` or reach GitHub, and it runs each case's `cleanup` lines once the step is graded ([CASE-FORMAT.md](CASE-FORMAT.md)). It finishes by writing the report as below, and its review is what the person reads before committing the ledger.

Done when `next` can run against a run folder.

## Each step

### 1. Prepare

Run `next`.

- `ready`: give the person `paste.shell` to run in a terminal, then `paste.command` to type in Claude Code, and list `answers` and `turns` so they know what is coming. Tell them to type `hecho` here when the step is over. Its `claude` loads the kit from this checkout with `--plugin-dir`, so the case runs the code under test: never have the person install the plugin or run `/aw-setup` to make a skill appear.
- `blocked`: the case needs the restore point of `needs`, which did not pass. Ask whether to `skip --reason <text>` it, then run `next` again.
- `done`: go to **Finish**.

Done when the person has the commands, and the first watch is running.

### 2. Watch

Run `reader.mjs watch --step <stepDir>` in the background, so you are woken when it exits. Launch a new one after handling each report, until the person types `hecho`. It remembers what it already reported.

| `status` | What to do |
| --- | --- |
| `question` | Show every question as asked, with its options and your proposed answer (step 3). |
| `turn_end` | The agent is waiting. Propose the next reply (step 3). |
| `ambiguous` | Show the `candidates` and ask which session is the step's. Then `reader.mjs pick --step <stepDir> --session <id>`. |
| `timeout` | Say nothing is happening yet, and launch another watch. |

Exit code 3 means Claude Code changed its log format. Stop and report the file named in stderr: grading a log the reader cannot read proves nothing.

When a `turn_end` follows a turn that has `assertions` in the case, run `check --turn <n>` (counting from 1) before proposing the next reply, and report the result. A later edit can overwrite what that turn left.

### 3. Propose answers

Read [ANSWERING.md](ANSWERING.md) and follow it for each question and turn end, with the case's `answers` and `turns`. Show the person each proposal with its reason, and a drift answer marked as drift. At a stop point, propose that the person type `hecho` here instead of answering, so the step ends where an unattended run ends it.

Once the person has answered a drift question, record it with the three values ANSWERING.md gives: `drift --when <when> --intent <intent> --reason <reason>`.

Done when every question and turn end got a proposal.

### 4. Wait for `hecho`

The person types the answers in the case session. If they type `pregunta`, run `reader.mjs peek --step <stepDir>` and show what it finds: this is the fallback for a watcher that missed something.

When a step has to start over, such as when the case session went off course or the run resumed a step cut short, ask the person to close the case session, then run `reset --case <id>` and go back to step 1 with `next`. It discards the step's working copy, its result, the session picked for it and the restore point it left, so the step comes back fresh from the **UAT restore point** it starts from instead of resumed. A session cannot be replayed half-way, so for a case that `continues` one it also resets the earlier cases back to the one that restored the working copy, and every other case that has started in that working copy: name every case it lists to the person, since each runs again.

### 5. Grade

Run `check`, then `reader.mjs summary --step <stepDir>`. Read [GRADING.md](GRADING.md) and grade the step by it, from the assertion results, the summary, the working copy and the case's `judge` criteria.

Done when every assertion and criterion has its result and evidence.

### 6. Save

Write the grades to a file in the run folder, in the shape [GRADING.md](GRADING.md) gives, and `record --grades <file>`. A passed step leaves a **UAT restore point** and a copy of `.aw/`. When a step did not pass and later cases depend on its state, ask the person whether to go on from it: add `--keep-point yes` only if they say so.

Show the verdict with its evidence per criterion, then go back to step 1.

## Finish

Run `report`, adding `--issue <n>` when the person names the issue that reports this run. It writes `summary.md` in the run folder, one line per case, and `review.md` beside it: each case's verdict and line, its assertions, every criterion with its result and evidence, and the findings, for the person to check the grades against. It also updates the **UAT ledger**, `ledger.json` beside this skill. Each case with a result gets an entry with its verdict, the commit recorded at the start, the run's date and the issue. The entry also holds a fingerprint of the case and the fixtures it copies as they are now, so the drift this run added counts as part of the case. A skipped case keeps the entry it had. Show the summary to the person. The ledger and the case files changed by drift are the only changes to this repo: tell them to check the grades in the review, then review both and commit them together, in the pull request that closes the batch issue.

Then offer to clean up, and run `clean` only if the person says yes. It deletes the working copies, the restore points and the case sessions' logs in `~/.claude/projects`, and keeps `summary.md`, `review.md`, `results/` and `state.json`. Name any case that did not pass first, since whoever investigates it will lose its working copy and log. If it reports a folder it could not delete, ask them to close the case sessions still open and run it again.

To change or add a case, read [CASE-FORMAT.md](CASE-FORMAT.md).
