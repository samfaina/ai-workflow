---
name: aw-converge
description: "Take a work branch from a review report with introduced defects to a review report with none: repeat the fix run of /aw-build, /aw-verify when the fix calls for it, and /aw-review, up to 3 rounds, which a call can raise, as in /aw-converge 5. Reports the defects left at the limit and stops with its reason on anything a round cannot resolve. Never pushes, opens a review request or merges. Run after /aw-review reports an introduced defect."
disable-model-invocation: true
---

# Converge

Take a work branch from a review report with introduced defects to one with none. A **convergence run** repeats **rounds**: the fix run of `/aw-build`, `/aw-verify` when the fix calls for it, and `/aw-review`. It runs those phases through their phase procedures (ADR 0016), and each phase keeps its one owner.

This skill belongs to no phase and has no artifact: beyond the commits and review reports the phases write, it leaves only its report in chat. It builds no slice and never pushes, opens a review request or merges: those belong to `/aw-ship`. Pre-existing defects and risks never keep a run going. Only the defects under `Defects introduced` do.

## Configuration

Find the repo's `## Agent skills` block: look in `AGENTS.md`, then `CLAUDE.md`, then `.claude/CLAUDE.md`, and follow its pointer to the VCS adapter. This skill reads only the access level of `commit`. Where the block or the adapter is missing, use the defaults below.

## Defaults when unconfigured

When the block or an adapter is missing, a skill keeps going on these defaults and says once per session: "using defaults, run `/aw-setup`".

| Adapter | Default |
| --- | --- |
| Tracker | `none`: the task arrives as free text, reads find nothing, and every write leaves a draft. `aw-wayfinder`, which needs a tracker, offers to create a local-markdown one. |
| VCS | git. The base branch and diff base are the default branch (`git symbolic-ref refs/remotes/origin/HEAD`, else `main` or `master`), which is also the one protected branch. `start-branch` and `commit` are at `write`; `push`, `open-review` and `merge` are at `draft`. |
| Checks | No configured commands. A skill proposes commands from the project's manifest, runs them when it needs a level, and never reports a level as passed unless it ran it. |
| Domain | Single-context: `GLOSSARY.md` and `docs/adr/` at the root, read when present. |

## Never allowed

Whatever the access levels say, the agent never force-pushes (`--force`, `--force-with-lease`, a `+` refspec), never deletes a branch, local or remote, never pushes directly to a protected branch, and never passes `--no-verify`. These are not configurable.

## Steps

### 1. Take the limit

Three rounds. When the arguments hold a whole number above 3, as in `/aw-converge 5`, that number is the limit for this call. Refuse any other argument, and say that a call can only raise the limit. A repo cannot change it. Running the command again starts a new count: no state is kept between calls.

Done when you know the limit.

### 2. Refuse what cannot converge

Check these before any work. When one holds, refuse, say which and what to do, and change nothing.

- **No subagents.** Refuse when this harness cannot start subagents: the fix run and `/aw-verify` each need one of their own.
- **No report at `HEAD`.** List `.aw/reviews/*-review.md` and take the last in name order. Its heading reads `# Review: <branch> at <short hash>`. When there is no report, or `git rev-parse --verify <short hash>^{commit}` gives anything but `HEAD`, name `/aw-review`.
- **No introduced defect.** When the report's `Proven defects:` line counts 0 introduced, there is nothing to converge: name `/aw-ship`.
- **`commit` at `draft`.** When the VCS adapter has `commit` at `draft`, no fix can land: tell the user to raise it, or to run the phases by hand.
- **Uncommitted changes.** When `git status --porcelain` shows anything outside `.aw/`, tell the user to commit it or set it aside first.

Take the report's `Spec axis judged against:` line. When it names a spec's path, each procedure's arguments below carry `spec: <path>`; otherwise they carry `fast route`.

Done when none of these holds, and you know the limit, the report and the arguments.

### 3. Run the rounds

Number the rounds from 1. Each round runs these three in order. The fix run and `/aw-verify` each run in a subagent of their own, and this session takes their reports and none of their reasoning: the context that confirms a defect has not seen how it was fixed.

#### The fix run

Start a subagent, in the foreground, with this brief: call the Skill tool with "aw-build-steps", with `caller: aw-converge; fix run; <spec or fast route>` as the arguments, adding `agreed seams: <the user's answer>` once there is one; follow it to its end; return its report with every line as written.

Keep every `Spec change:` line for the report in step 4: a run that ends clean still owes the user that change. Then read the report, in this order:

1. **`Stop: seam to agree`** with a `Question:` line: this is the one question inside a convergence run. Ask the user the question. When they answer, start the fix run again in the same round with the answer in its arguments, and pass that answer to every later fix run of this call. When they decline, end the run with the reason.
2. **Any other `Stop:` line** ends the run with that reason, such as a spec change, a done-when criterion to correct, or a check that fails on code the fix did not touch.
3. **`Commit: none`** ends the run: the round changed nothing, so another review would find the same.
4. **`Commit: draft <path>`** ends the run: the fix did not land.
5. **`Commit: <hash> <subject>`**, with a hash that resolves to `HEAD`: the fix landed. `Not fixed:` lines beside it go on, and the next review judges them.

Then follow its `Next:` line: `Next: /aw-verify` goes to **Verify**, and `Next: /aw-review` to **The review**. Output that is not recognised ends the run: a report with no `Commit:` or `Next:` line, a commit that is not `HEAD`, or any other `Next:`. Quote it in the report.

Done when the fix is in a commit at `HEAD` and you know what comes next, or the run has ended.

#### Verify

Start a subagent, in the foreground, with this brief: call the Skill tool with "aw-verify-steps", with `caller: aw-converge; <spec or fast route>` as the arguments; follow it to its end; return its report with every line as written.

Read the report:

1. **Any `Stop:` line** ends the run with that reason, such as `Stop: criterion failed`, which unticks a slice a fix run cannot rebuild, or `Stop: verify journey needs a person`.
2. **`Next: /aw-review`** goes to **The review**.

Output that is not recognised ends the run, and the report quotes it.

Done when the review comes next, or the run has ended.

#### The review

Run it in this session, never in a subagent: each axis needs a subagent of its own, and the axes need no nesting. Call the Skill tool with "aw-review-steps", with `caller: aw-converge; <spec or fast route>` as the arguments, and follow it. The reviewers get the brief of a first review and the whole diff from the diff base.

Then read the latest review report's heading and `Proven defects:` line. A report that does not name `HEAD`, or a line not recognised, ends the run, and the report quotes it. Otherwise:

- **0 introduced:** ends the run clean.
- **More, with rounds left:** go on to the next round. There is no check for a defect that comes back: the limit is the cap.
- **More, at the limit:** ends the run with the defects left.

Done when the run has ended or the next round has started.

### 4. Report

Report in chat:

- one line per round: its fix commit, its `/aw-verify` result or "not run", and its review report's path with its count of introduced defects;
- every `Spec change:` line the fix runs reported, for the user to make with `/aw-spec` before shipping;
- how the run ended, and which of these holds:
  - **Clean:** the latest review report holds no introduced defect. Name `/aw-ship`; introduced risks are for the user to accept or fix before shipping.
  - **Limit reached:** list the defects left, from the latest review report's `Defects introduced`, each with its file and line. Say that running `/aw-converge` again starts a new count, and that a call can raise the limit.
  - **Stopped:** give its reason and the line that ended the run, quoted, with the defects left in the latest review report, and name the skill its `Next:` line names, if any.

Tell the user to run what comes next; this skill never runs it.

Done when the user has how the run ended, what is left, and what comes next.
