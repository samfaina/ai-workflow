---
name: aw-implement
description: "Take an approved spec or a fast-route task from what is left to build to a review with no introduced defect: build each slice in series, verify, review, and repeat fix rounds when the review holds an introduced defect. Takes an optional spec path and a limit of rounds above 3, as in /aw-implement docs/specs/renew-loan/spec.md 5. Asks only during a HITL slice or to agree a test seam. Stops with its reason, and running it again resumes. Never pushes, opens a review request or merges. Run after /aw-slices, or after /aw-intake on the fast route."
disable-model-invocation: true
---

# Implement

Take an approved spec, or a fast-route task, from what is left to build to a review with no introduced defect. An **implementation run** builds what is left, verifies it, reviews it, and starts a convergence run when that review holds an introduced defect (ADR 0017). It runs those phases through their procedures, and each phase keeps its one owner.

This skill belongs to no phase and has no artifact: beyond the commits and reports its phases write, it leaves only its journal and its report in chat. Its unit is one spec and one review request, and a slice is one part of that. It takes no ticket, does not use the tracker, and never pushes, opens a review request or merges: those belong to `/aw-ship`. Pre-existing defects and risks never keep a run going. Only the defects under `Defects introduced` do.

## Configuration

Find the repo's `## Agent skills` block: look in `AGENTS.md`, then `CLAUDE.md`, then `.claude/CLAUDE.md`, and follow its pointer to the VCS adapter. This skill reads only the access levels of `commit` and `start-branch`, and which branches are protected. Where the block or the adapter is missing, use the defaults below.

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

## The journal

`.aw/implement/<slug>.md`, from the spec's slug, or on the fast route a slug of the task. It holds what exists only in this conversation, so that it survives compaction. Only this skill reads it, and the convergence procedure it starts. It is append-only and never committed, and nothing deletes it, short of the replacement **A relaunch** describes.

The journal **never decides the position**: which slice comes next, and whether a review is due, always come from the done markers, commits and review reports. Read it again before each step.

```markdown
# Implementation run

Route: <standard or fast>
Spec: <its path>, or Task: <the task>
Work branch: <the branch>, or pending while the current branch is protected

## <yyyy-mm-dd hh:mm:ss>

Limit: <the limit>
Intake: <fast route only: intake's whole report>
Agreed seam: <the user's answer>
Spec change: <the line, as written>
<each progress line>
```

Each call opens a heading with its date and time, so the round count looks only at the latest heading. Every `Agreed seam:` line counts, under any heading. When a build creates the work branch, append `Work branch: <the branch>`; the last such line counts.

**A relaunch.** A journal on the same work branch continues, as does one still at `pending`. A journal that names another work branch is replaced.

**When it is gone** in the middle of a run, the run goes on from what this conversation still holds, and starts the file again at the next line it appends. What it builds next does not change.

## Steps

### 1. Take the input

The arguments are an optional spec path and an optional limit.

**The limit.** Three rounds. A whole number above 3, as in `/aw-implement 5`, raises it for this call. Refuse any other argument, and say that a call can only raise the limit. A repo cannot change it.

**The route**, the first of these that holds:

- **A spec path:** the standard route, from that spec.
- **No spec path, and `/aw-intake` reported `Route: fast` for a task in this conversation:** the fast route, from that report.
- **No spec path, on a branch with a fast-route source:** the fast route, from a journal under `.aw/implement/` that says `Route: fast` and names this branch, or is still at `pending` while this branch is protected, for the `Intake:` report it holds, or else from the work branch's commits since the diff base, when they carry `Done when:` lines and touch no spec under `docs/specs/`.
- **Otherwise:** list the specs under `docs/specs/` with their `status` and ask which one.

Done when you know the limit and the route, with its spec or its source.

### 2. Refuse what cannot run

Check these before any work. When one holds, refuse, say which and what to do, change nothing, and create no journal.

- **No subagents.** Refuse when this harness cannot start subagents: AFK slices and `/aw-verify` each need one of their own.
- **`commit` at `draft`.** When the VCS adapter has `commit` at `draft`, no slice can land: tell the user to raise it, or to run the phases by hand.
- **Uncommitted changes.** When `git status --porcelain` shows anything outside `.aw/`, tell the user to commit it or set it aside first.
- **A protected branch and `start-branch` at `draft`.** When the current branch is protected and `start-branch` is at `draft`, no work branch can be made: tell the user to create the branch and run this again.
- **A spec that is not `approved`.** Read the spec's frontmatter. At any other `status`, name `/aw-spec`: approving a spec stays a person's decision.
- **No slice plan.** When the spec's Slice plan holds no numbered slices, name `/aw-slices`.
- **No fast-route source.** When there is no spec to choose from, or the user names none, and none of the sources in step 1 exists, name `/aw-intake`.

Done when none of these holds.

### 3. Open the journal and announce

Create or continue the journal as **The journal** says, opening this call's heading with its limit and, on the fast route, intake's whole report when you have it.

On the standard route, read the Slice plan. Name each HITL slice not yet done, and what the user will be needed for, from its name and Delivers line, so they know when they will be needed. With none, say so.

Done when the journal holds this call's heading, and the user knows which slices will need them.

### 4. Build what is left

Skip the build when nothing is left:

- **Nothing left to build, standard route:** when every slice's done marker is `[x]`, go to **5. Verify**.
- **Nothing left to build, fast route:** when the work branch's commits since the diff base carry `Done when:` lines, go to **5. Verify** when the repo has a verify skill at `.claude/skills/verify-<app>/`, and otherwise to **6. The first review**.

Otherwise build in series, one at a time, and take the reports and none of their reasoning. `aw-build-steps` chooses the slice, so the rule for which comes next stays in one place. On the fast route one build covers the whole task.

Start a subagent, in the foreground, with this brief: call the Skill tool with "aw-build-steps", with `caller: aw-implement; afk; spec: <its path>`, or on the fast route `caller: aw-implement; afk; fast route; intake: <intake's whole report: task, type, pre-step result and criteria>`, as the arguments, adding `agreed seams: <the seams>` from every `Agreed seam:` line of the journal once there is one; follow it to its end; return its report with every line as written.

After every build, when the journal's work branch is `pending` and the current branch is no longer protected, append `Work branch: <the current branch>`, whatever the report says.

Append every `Spec change:` line to the journal as it arrives: a run that ends clean still owes the user that change. Then read the report, in this order:

1. **`Stop: seam to agree`** with a `Question:` line: this is the one question that interrupts an AFK build. Ask the user the question. When they answer, append `Agreed seam: <the answer>` to the journal and start the build again with the answer in its arguments: it passes to every later build and fix run. When they decline, end the run with the reason.
2. **`Stop: HITL slice <n>: <its name>`:** build that slice in this session, because the need for a person arises in the middle of a slice and a subagent cannot ask. Call the Skill tool with "aw-build-steps", with `caller: aw-implement; hitl; spec: <its path>` as the arguments, and the agreed seams as above, and follow it, asking the user as it says. Append each seam the user agrees during the slice as `Agreed seam: <the answer>`. Then read its closing lines by this same list. This stop does not end the run.
3. **Any other `Stop:` line** ends the run with that reason, such as a spec change or a check that fails on code the slice did not touch.
4. **`Commit: none`** ends the run: the build changed nothing.
5. **`Commit: draft <path>`** ends the run: the slice did not land.
6. **`Commit: <hash> <subject>`**, with a hash that resolves to `HEAD`: the slice landed. Print one line and append it to the journal, such as `Slice 2/4 built: a1b2c3d`, counting from the done markers, or on the fast route `Task built: a1b2c3d`.

Then follow its `Next:` line: `Next: /aw-build` starts the next build, `Next: /aw-verify` goes to **5. Verify**, and `Next: /aw-review` goes to **6. The first review**. Output that is not recognised ends the run: a report with no `Commit:` or `Next:` line, a commit that is not `HEAD`, or any other `Next:`. Quote it in the report.

Done when `Next:` is no longer `/aw-build`, or the run has ended.

### 5. Verify

Start a subagent, in the foreground, with this brief: call the Skill tool with "aw-verify-steps", with `caller: aw-implement; spec: <its path>`, or `caller: aw-implement; fast route`, as the arguments; follow it to its end; return its report with every line as written.

Read the report:

1. **Any `Stop:` line** ends the run with that reason, after one line printed and appended to the journal, as `Verify: stopped: <the reason>`. `Stop: criterion failed` unticks a slice and is never rebuilt automatically: running this command again resumes from it.
2. **`Next: /aw-review`** goes to **6. The first review**. Print one line and append it to the journal: `Verify: passed`, or the results it reports in as few words.

Output that is not recognised ends the run, and the report quotes it.

Done when the review comes next, or the run has ended.

### 6. The first review

Run it in this session, never in a subagent: each axis needs a subagent of its own, and the axes need no nesting. Call the Skill tool with "aw-review-steps", with `caller: aw-implement; spec: <its path>`, or `caller: aw-implement; fast route`, as the arguments, and follow it.

Then read the latest review report's heading and `Proven defects:` line. A report that does not name `HEAD`, or a line not recognised, ends the run, and the report quotes it. Otherwise print one line and append it to the journal, such as `Review 1: 2 introduced defects` or `Review 1: clean`, and:

- **0 introduced:** ends the run clean.
- **More:** go to **7. Converge**.

Done when the run has ended or the rounds come next.

### 7. Converge

Call the Skill tool with "aw-converge-steps", with `caller: aw-implement; limit: <the limit>; journal: <its path>` as the arguments, adding `agreed seams: <the seams>` from every `Agreed seam:` line of the journal once there is one, and follow it, in this session. It closes with one of these lines:

- `Converge: clean` ends the run clean.
- `Converge: limit reached` ends the run with the defects left.
- `Converge: stopped: <the line that ended it>` ends the run with that reason.

Output that is not recognised ends the run, and the report quotes it.

Done when the run has ended.

### 8. Report

Read the journal once more, then report in chat:

- the state: the slices done of how many, the verify result, and the latest review report's path with its count of introduced defects;
- what is left: any slice not done, and the defects left in the latest review report, each with its file and line;
- every `Spec change:` line in the journal, for the user to make with `/aw-spec` before shipping, with those under an earlier heading marked `(from an earlier call)`;
- how the run ended, and which of these holds:
  - **Clean:** the latest review report holds no introduced defect. Name `/aw-ship`; introduced risks are for the user to accept or fix before shipping.
  - **Limit reached:** list the defects left. Say that running `/aw-implement` again starts a new count of rounds, and that a call can raise the limit.
  - **Stopped:** say at which point it stopped, why, with the line that ended the run quoted, and what to run to continue: the skill its `Next:` line names, if any, then `/aw-implement` again, which resumes from the first slice not done.

Tell the user to run what comes next; this skill never runs it.

Done when the user has the state, what is left, and the next command.
