---
name: aw-build-steps
description: "The steps of /aw-build: one slice of an approved spec, the fast route, or a fix run of the latest review report. A phase procedure for calls from /aw-build, the convergence procedure and aw-implement only: do not load it by your own choice."
user-invocable: false
---

# Build steps

## First step: check the caller

This is the phase procedure of `/aw-build` (ADR 0016). Read the arguments before anything else. Unless they name the caller, as `caller: aw-build`, `caller: aw-converge` or `caller: aw-implement`, stop, change nothing and say that a person starts this phase with `/aw-build`.

With `caller: aw-converge` you run in a subagent and no user can answer you. The arguments ask for a fix run and name the spec, or say the task is on the fast route. Wherever a step says to ask the user, end the run with a `Stop:` line that says what you would have asked, as the fix run's **Report** says. The one exception is the question in **Agree the seams**. `.aw/` is local state: its files are not changes in the working tree.

With `caller: aw-implement` the arguments say `afk` or `hitl`, and name the spec as `spec: <path>` or say `fast route` with intake's whole report as `intake: <the report>`. In the `afk` variant you run in a subagent and no user can answer you: wherever a step says to ask the user, end the run with a `Stop:` line that says what you would have asked; the one exception is **A seam to agree in the `afk` variant**. The `hitl` variant runs in the main session and asks as the steps say. In both, seams the arguments name as `agreed seams:` count as agreed, `.aw/` is local state as above, and step 8 ends with **Closing lines for `aw-implement`**.

Build **one slice** of an approved spec per call, on a work branch: test-first at the seams the spec's Test strategy agrees, then run the `task` check level, tick the slice, update Traceability and make one local commit. The commits and the spec's Traceability are this phase's artifact. Building never starts a review: review is a phase of its own. On the fast route there is no spec, and one call builds the whole task from intake's done-when criteria, as **The fast route** says.

This skill edits only three things in the spec: done markers (the slice's own, and the unset markers a plan without any needs, as **The done marker** says), a **test exception** in the slice it builds, and the Traceability rows of the criteria that slice covers. Anything else the spec needs is a **spec change**: stop, as **When the spec is wrong** says. A fix run edits the spec only as **The fix run** says.

## Configuration

Find the repo's `## Agent skills` block: look in `AGENTS.md`, then `CLAUDE.md`, then `.claude/CLAUDE.md`, and follow its pointers to the tracker, VCS and checks adapters and the domain doc. Use each operation the way the adapter's Operations table says, at its access level: a write at `draft` is not performed; write its exact command or text to `.aw/drafts/<yyyymmdd-hhmmss>-<operation>.md` and tell the user the path. Where the block or an adapter is missing, use the defaults below.

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

## The done marker

Each slice in the spec's Slice plan opens with a checkbox, its **done marker**: `[ ]` until the slice is built, `[x]` once this skill has built it:

```markdown
1. [x] <Slice name> (AC-1, AC-3). AFK.
   - Delivers: <the end-to-end behaviour this slice makes work>
   - Blocked by: none.
2. [ ] <Slice name> (AC-2). HITL.
   - Delivers: <…>
   - Blocked by: 1.
```

A slice is **done** when its marker is `[x]`. `/aw-slices` writes every slice with the marker unset. A slice plan written before the marker existed has no checkboxes: add `[ ]` to every slice when you tick the first one.

## Steps

### 1. Take the spec and the slice

On the fast route there is no spec: follow **The fast route** below instead of this step, and read the later steps with the changes it lists.

Take the spec the user names or the arguments name, or the one `/aw-slices` planned in this conversation. When neither is clear, list the specs under `docs/specs/` with their `status` and ask which one.

Read the spec's frontmatter. **Refuse to go on unless `status` is `approved`**, and say why:

- `draft`: the spec has not passed spec approval. Tell the user to finish it with `/aw-spec` and approve it there.
- `implemented`: the spec is built. To change it, run `/aw-spec`, which sets it back to `draft` for the change and asks for approval again.
- `superseded`: name the spec its `superseded-by` points to, where `/aw-spec` makes any change.

Never set or change `status` yourself. Refuse as well when the Slice plan holds no numbered slices: tell the user to run `/aw-slices`.

Then call the Skill tool with "aw-check-spec" and run it on the repo. When it reports a finding on this spec, stop: report the findings; fixing them is a spec change. When it reports `Result: not script-verified`, Node is missing: say so, and go on.

Pick the slice: the one the user names, or else the first slice in plan order that is not done and whose blockers are all done. Refuse a slice whose blockers are not all done, and name them. When the user asks for a fix run, go to **The fix run**. When every slice is done, and the latest review report names `HEAD` and holds an introduced defect, go to **The fix run**. Otherwise, when every slice is done, say so and name `/aw-verify` as the next skill.

With `caller: aw-implement` pick the first slice in plan order that is not done and whose blockers are all done, and never go to **The fix run**. When every slice is done, end with `Stop: every slice is done`, `Commit: none` and `Next: /aw-verify`.

In the `afk` variant, when the slice is **HITL**, change nothing, commit nothing, and end with `Stop: HITL slice <n>: <its name>`, `Commit: none` and `Next: /aw-build`: `aw-implement` builds it in the main session.

When the slice is **HITL**, tell the user now what they will be needed for, from the slice's name and Delivers line, and ask before the step that needs them.

Done when you can name the spec, the one slice this call builds, its criteria, and AFK or HITL.

### 2. Start the work branch

Check the working tree for changes. When it has changes this skill did not make, ask the user whether to commit, set aside or keep them before going on: they must not land in this slice's commit.

A slice is built on a work branch, never on a protected one (the base branch or another the VCS adapter names). When the current branch is protected, use `start-branch` to create the work branch, named by the adapter's branch naming from the spec's slug, such as `feat/<slug>`. When the current branch is already a work branch for this spec, from an earlier slice, stay on it.

When `start-branch` is at `draft`, write the draft, tell the user to create the branch with it and run `/aw-build` again, and stop. This is the one write at `draft` after which this skill does not go on: every later step would land on the protected branch.

In the `afk` variant, read as step 3 says and make the check in **A seam to agree in the `afk` variant** first: a run that stops on a seam must not have created a branch.

Done when you are on a work branch that is not protected, with no change in the working tree that this slice did not make.

### 3. Explore

Read the whole spec: the criteria the slice covers, the Boundaries, the Design, the seams in the Test strategy and the evidence it plans for each criterion, and the slices already done. Read the glossary and the ADRs the domain doc points to, and the code and tests the slice touches. Use the glossary's terms in test names and code.

Keep to the Boundaries throughout: do what **Always** says on every step, stop and ask the user before anything under **Ask first**, and leave alone what **Never** names.

Before writing code, check that the slice can be built as the spec states it. When a criterion contradicts the Design, the code or another criterion, or the agreed seam cannot reach the behaviour, go to **When the spec is wrong**.

Done when you know the seams the slice is tested at, the files it changes, and that nothing in the spec contradicts it.

### 4. Build test-first

Call the Skill tool with "aw-tdd" and build the slice through its red-green loop, one behaviour at a time. The seams in the spec's Test strategy are the pre-agreed seams `aw-tdd` asks for: the user agreed them in `/aw-slices`, so do not ask again. A test at any other seam needs the user's agreement first; when they agree, the Test strategy needs updating, which is a spec change to report in step 8, not to make.

**A seam to agree in the `afk` variant.** No one can answer here, so check before the first test, and before step 2 creates a work branch, that an agreed seam reaches every behaviour. When none does, change nothing and commit nothing, and end with `Stop: seam to agree`, `Question: <the one question, with each seam you propose and one line on what it catches and what it misses>`, `Commit: none` and `Next: none`. When it only shows later, first undo what this run changed in the working tree. `aw-implement` asks the user and starts the run again.

- Name each test so that it mentions the `AC-n` it proves, such as `AC-2: a wrong password shows an error`: at `implemented`, `aw-check-spec` checks that each `test:` file mentions its criterion.
- When you are unsure how an API, framework or library behaves, call the Skill tool with "aw-source-driven-development" and ground the code in its official documentation before writing it.
- Run `run-check fast` as you go.
- Build only what the slice's criteria need. Behaviour that belongs to a later slice waits for it.

A criterion the Test strategy already plans to prove by `verify:` or `manual:` evidence gets no test: its evidence was agreed.

**Test exception.** When a test at the agreed seam would cost far more than it is worth, such as a real browser, device or third-party account the tests cannot drive, or a timing they cannot control, record a test exception instead, as the last item of the slice:

```markdown
   - Test exception: AC-2. <why a test at the agreed seam would cost too much>; proven by `verify:` evidence instead.
```

The evidence it relies on depends on whether the repo has a verify skill, at `.claude/skills/verify-<app>/` (ADR 0011):

- **A verify skill exists:** `verify:` evidence, which `/aw-verify` gathers on the real app.
- **No verify skill:** every criterion then needs `test:` or `manual:` evidence, so write "proven by `manual:` evidence instead" in the exception, and name what is to be checked by hand.

Step 6 points the criterion's Traceability row at that evidence. Test whatever else in the slice is cheap to test. A test exception covers one criterion; when a criterion is still tested in part, keep its `test:` entry beside the other.

Done when every behaviour of the slice's criteria has a passing test at an agreed seam, planned `verify:` or `manual:` evidence, or a recorded test exception.

### 5. Run the `task` checks

Run `run-check task`, filling `<files>` with the test files the slice added or changed. When the checks adapter has no `task` command, propose one from the project's manifest and run it. Report the level as passed only when you ran it in this session and it exited 0.

When it fails, fix what this slice broke and run it again. When it fails on something the slice did not touch, stop and report the failure with its output: commit nothing until the user decides.

Done when `run-check task` passed in this session.

### 6. Record the slice in the spec

Edit the spec, and nothing else in it:

- **Tick the slice:** change its done marker from `[ ]` to `[x]`.
- **Test exceptions:** the `Test exception:` items step 4 recorded, in this slice.
- **Traceability:** for each criterion the slice covers, set its row to the evidence where it landed: `` test: `<path>` `` for each test file that proves it. For a criterion with a test exception, keep a `verify:` path the row already plans, or else write `` verify: `docs/specs/<slug>/verify/` `` as the planned path, which `/aw-verify` replaces with its result's path; with no verify skill, write `manual: <what to check by hand, and why no test>`. Keep the entries earlier slices recorded, separated by `;`, and replace only planned entries this slice made untrue.

Leave the frontmatter, the criteria, every other slice and every other section as they are. Then run `aw-check-spec` again. Fix a finding your edits caused; any other finding on this spec is a spec change: report it, and commit nothing.

Done when the slice is ticked, Traceability names the slice's evidence, and the check reports no finding on this spec, or ran by reading only and you said so.

### 7. Commit locally

Use `commit` for the slice's code, tests and spec edits, together, with a message in the VCS adapter's commit convention that names the slice, such as `feat: <slice name> (AC-1, AC-3)`. Stage only the paths this slice changed.

When a commit hook fails, fix what it reports (`--no-verify` is never allowed), run `run-check task` again when the fix touched code, and commit again.

The commit stays local: `push` and `open-review` belong to `/aw-ship`.

Done when the slice is in one local commit on the work branch, or in a draft whose path you gave the user.

### 8. Report

Report in chat:

- the spec's path and the slice built: name, criteria, AFK or HITL;
- the work branch and the commit's hash and subject, or the draft path;
- the tests added, one line each, with the criteria they prove;
- each test exception, with its reason, or "no test exceptions";
- the `run-check task` result, and the `aw-check-spec` result;
- any spec change step 4 or 6 found, for the user to make with `/aw-spec`.

Then name the next skill: `/aw-build` again for the next slice whose blockers are all done, or `/aw-verify` when every slice is done. Tell the user to run it; this skill never runs it, and review waits for `/aw-review`.

**Closing lines for `aw-implement`.** With `caller: aw-implement`, close the report with these lines, and no other line that opens with them: `aw-implement` reads them.

- `Commit: <hash> <subject>`, `Commit: draft <path>` or `Commit: none`
- `Spec change: <the change>`, one line for each spec change the run found
- `Stop: <reason>`, when the run ended before its commit: a refusal of step 1, a stop above, `Stop: spec change needed`, on the fast route `Stop: criterion correction needed`, `Stop: check failed on code the slice did not touch`, or what you would have asked
- `Question: <the question>`, only with `Stop: seam to agree`
- `Next: <skill>`, the skill named above or the one a stop names, or `Next: none`

## When the spec is wrong

When building shows that the spec is wrong (a criterion cannot be built as stated, contradicts the Design or the code, or needs behaviour the spec rules out), stop at once:

1. Commit nothing, and write no more code. List the files this slice changed and tell the user to discard them, or keep them aside for after the spec change; the next `/aw-build` asks about any it finds in the working tree.
2. Leave the spec as it is: changing it is `/aw-spec`'s, which sets it back to `draft` and asks for approval again.
3. Propose the spec change: the section and the text as it stands, the text you propose, and the evidence that the spec is wrong, such as a failing test's output or the code that contradicts it.

Tell the user to make the change with `/aw-spec`, then to run `/aw-slices` when the change alters the slice plan, and `/aw-build` again after that. Done when the user has the proposed change and no commit was made.

## The fast route

On the fast route (ADR 0013) there is no spec and no slice plan. `/aw-intake` stated 1 to 3 **done-when criteria**, and they are the definition of done: this call builds the whole task until each one holds, and never creates a spec. The phase's artifact is then the commits alone, which carry the criteria, in place of the commits and Traceability that ADR 0010 names. Follow the steps above with these changes; where a step or its "Done when" line names the spec, a slice or Traceability, read the task and its criteria.

**Step 1: take the task, not a spec.** The task is on the fast route when `/aw-intake` reported `Route: fast` for it in this conversation, or when the work branch's commits since the diff base carry `Done when:` lines and touch no spec under `docs/specs/`. Take the task, its type, its pre-step result and its done-when criteria from intake's report, the arguments' `intake:` included, or else the criteria from the latest of those commits that carries `Done when:` lines (`git log <base>..HEAD --format=%B`), or else ask the user to paste intake's report or to run `/aw-intake` first. Never write the criteria yourself. There is no `status` to check, no slice to pick and no `aw-check-spec` run.

Refuse to go on, and tell the user to run `/aw-intake` again, when there are no done-when criteria, or when meeting a criterion would change a contract (a public API, schema, file format, CLI flag or event), stored data or anything security-related (authentication, permissions, secrets, input from outside, a new external service integration, CORS, rate limiting or throttling, adding a dependency, or how personal data is collected, handled or shared): such a task is not on the fast route, and intake sends it to the standard route. Upgrading an existing dependency does not, on its own, keep a task off the fast route, major versions included.

**Fix run.** When the user asks for one, or when the latest review report names `HEAD` and holds an introduced defect, go to **The fix run**: with no slices, there is nothing else to wait for. With `caller: aw-implement` there is no fix run: build the task.

Done when you can name the task, its type and its done-when criteria, and whether this call is a fix run.

**Step 2: the work branch.** Name it by the adapter's branch naming from a slug of the task, such as `fix/<slug>`. On a rerun, stay on the work branch the earlier call made.

**Step 3: explore the task.** There is no spec to read and no Boundaries to keep. Read the pre-step's evidence along with the code: a bug's reproduction, a refactor's characterization tests, a performance baseline. Check that each criterion is observable and can be met within the task; when one cannot, go to **When the criteria are wrong**.

Done when you know the seams to propose, the files the task changes, and that every criterion can be met.

**Step 4: test-first.** No Test strategy agreed the seams, so agree them now, before the first test: propose a seam for each criterion, with one line on what it catches and what it misses, and ask the user to confirm them in one question. In the `afk` variant no one can answer: unless the arguments' `agreed seams:` cover them, end with `Stop: seam to agree` as step 4 says. Then build through `aw-tdd` at those seams, one behaviour at a time.

- Name each test so that it quotes the criterion it proves, such as `done when: a wrong password shows an error`.
- The pre-step's evidence comes first: a bug's reproduction becomes the first failing test, a refactor's characterization tests pass before and after every change, and a performance change is measured again against the baseline.
- **Test exception:** record it in the commit message (step 7), not in a spec, as a line such as ``Test exception: <criterion>. <why a test at the agreed seam would cost too much>; proven by `verify:` evidence instead``. Write `verify:` when the repo has a verify skill at `.claude/skills/verify-<app>/`, and `manual:`, naming what to check by hand, when it has none.

Done when every criterion has a passing test at an agreed seam or a recorded test exception.

**Step 6: no spec to record in.** Skip it.

**Step 7: the commit carries the criteria.** The commit message names the task, such as `fix: <task>`, and its body holds one `Done when: <criterion>` line per criterion, in intake's words, followed by any `Test exception:` lines. Every commit this route makes writes the whole current set, so the latest commit that carries `Done when:` lines holds the criteria: a rerun after review repeats them, and one after a correction writes the corrected set. `/aw-verify`, `/aw-review` and `/aw-ship` read the criteria back from that commit when the conversation no longer holds intake's report.

Done when the task is in a local commit on the work branch whose message carries every criterion, or in a draft whose path you gave the user.

**Step 8: report each criterion.** In place of the slice, report the task and each done-when criterion with what proves it: its tests, or its test exception. Then name the next skill: `/aw-verify` when the repo has a verify skill at `.claude/skills/verify-<app>/`, and `/aw-review` when it has none. With no verify skill, a criterion with a test exception needs the user to check it by hand: name what to check, and say that `/aw-ship` asks for it and records what they report. With `caller: aw-implement`, end with **Closing lines for `aw-implement`**.

### When the criteria are wrong

When building shows that a done-when criterion is wrong (it cannot be met as stated, contradicts the code, or needs a change Step 1 refuses), stop as **When the spec is wrong** says: commit nothing, write no more code, and list the files changed. Then propose the corrected criterion with the evidence that the old one is wrong. The fast route has no spec to change: the user agrees the new criteria in the conversation, and the next `/aw-build` builds from them and writes them into its commit. When the correction moves the task off the fast route, tell the user to run `/aw-intake` again, which sends it to `/aw-spec`.

## The fix run

A **fix run** fixes the introduced defects of the latest review report and builds no slice: one call, one commit, every defect it can fix. Step 1 has taken the spec, or **The fast route** the task, and every refusal there holds. These steps replace steps 2 to 8.

**Read the report.** List `.aw/reviews/*-review.md` and take the last in name order: the file names start with `<yyyymmdd-hhmmss>`. Its heading reads `# Review: <branch> at <short hash>`, and `git rev-parse --verify <short hash>^{commit}` gives the commit it names.

- **No report:** stop with `Stop: no review report`, and name `/aw-review`.
- **Another commit:** when the hash does not resolve, or resolves to anything but `HEAD`, the report is out of date. Stop with `Stop: report out of date`, change nothing, and name `/aw-review`. `/aw-ship`'s exemption for adapters does not apply: a fix starts from the code the report ran on.
- **No introduced defect:** when the report's `Proven defects:` line counts 0 introduced, say there is nothing to fix, and stop with `Stop: nothing to fix`.

**Take the defects.** The input is every defect under a `Defects introduced` heading, in every axis of the report, each with its file and line, what is wrong, its run and its quoted output. A defect from the Standards or Security axis, which no slice covers, is fixed like any other. Leave `Risks introduced` and `Pre-existing` as they are: they are not this run's.

Done when you can list every introduced defect with its axis and its run.

**The work branch.** Follow step 2. The fix lands on the branch the report reviewed.

**Explore.** Read each defect's run and quoted output, the code at its file and line, and the criterion it names, if any: step 3's reading, for the defects alone. Keep to the spec's Boundaries as step 3 says. Then check each defect against the criteria:

- **A defect that shows a criterion is wrong:** fixing it would break or contradict the criterion, or the criterion cannot be met as stated. Stop as **When the spec is wrong** says, with no commit and a proposed spec change; on the fast route, follow **When the criteria are wrong**. The report says `Stop: spec change needed`, or on the fast route `Stop: criterion correction needed`. No defect of this run is fixed then: report each as not fixed.

Done when you know, for each defect, the code it changes and that no criterion stands against the fix.

**Agree the seams.** The seams in the spec's Test strategy are agreed; on the fast route, the seams the user agreed for this task are. When no agreed seam reaches a defect, as with most Standards or Security defects, propose one with one line on what it catches and what it misses, and ask the user, in one question for all such defects. When they agree on the standard route, the Test strategy needs updating: a spec change to report, not to make. With `caller: aw-converge` no one can answer here: change nothing, commit nothing, and end the run with `Stop: seam to agree` and `Question: <the one question, with each seam you propose and one line on what it catches and what it misses>`. `aw-converge` asks the user and starts the run again; the seams the arguments name as agreed count as agreed.

**Fix test-first.** Call the Skill tool with "aw-tdd" and take one defect at a time: its run becomes a failing test at an agreed seam, one that fails before the fix with the wrong behaviour the review quoted, and passes after it. Fix what the defect needs and no more. A test for a defect against a criterion names it as step 4 says, or on the fast route quotes it; any other test names the defect. Run `run-check fast` as you go. When neither a failing test nor the review's run shows the defect at `HEAD`, report it as not fixed, with the output.

**Test exception.** When step 4's rule applies, record a test exception instead of the test. A defect against a criterion: in the slice that covers it, as step 4 says, or on the fast route as a line of the commit message, as **Step 4** of **The fast route** says. A defect no criterion covers, on either route: a line of the commit message, ``Test exception: <file:line>. <why a test at the agreed seam would cost too much>; proven by `manual:` evidence instead: <the review's run, and what it must now show>``; make that run and put its output in the report. Leave Traceability as it is: only a new test adds to it.

Done when every defect has a test that failed before its fix and passes now, a test exception, or a reason it is not fixed.

**Run the `task` checks.** Run `run-check task` as step 5 says, on the test files this run added or changed. Step 5's rules on a failure hold. When it fails on something this run did not touch, the report says `Stop: check failed on code the fix did not touch`.

Done when `run-check task` passed in this session.

**Record in the spec.** Tick and untick no done marker, and leave the spec as it is but for two edits: a test exception in the slice that covers its criterion, and in Traceability a `test:` entry beside the row's others, only when a new test proves a criterion. Run `aw-check-spec` again when you edited the spec, as step 6 says. On the fast route there is no spec: skip this.

Done when the spec holds only those edits and the check reports no finding on it, or ran by reading only and you said so.

**Commit.** Use `commit` for one local commit with the fix, its tests and any spec edit, staging only the paths this run changed, as step 7 says. The message names the fix, such as `fix: <what the defects had in common>`, and its body holds one `Fixes: <file:line>: <what was wrong> (<axis>)` line per defect fixed, then any `Test exception:` lines. On the fast route the body also writes the whole current set of `Done when:` lines, in intake's words, as **Step 7** of **The fast route** says, ahead of the `Fixes:` lines. With no defect fixed, commit nothing.

Done when the fixes are in one local commit on the work branch, or in a draft whose path you gave the user, or no defect was fixed.

**Report.** Report in chat in this shape, with one line per defect, in the report's order, and no other line that opens with `Fixed:`, `Not fixed:`, `Commit:`, `Spec change:`, `Stop:`, `Question:` or `Next:`: a later command reads them.

- `Fix run: <the spec's path, or on the fast route the task>`
- `Review report: <its path>`
- `Fixed: <file:line>: <what was wrong> (<axis>). Evidence: <the test that failed before the fix, or its test exception>`
- `Not fixed: <file:line>: <what was wrong> (<axis>). Reason: <why>`
- `Commit: <hash> <subject>`, `Commit: draft <path>` or `Commit: none`
- `Task checks: <result>`, and `Spec check: <result>` when it ran
- `Spec change: <the change>`, one line for each spec change the run found, for the user to make with `/aw-spec`
- `Stop: <reason>`, when the run ended before its commit: one of the reasons this section names, or else what stopped it, such as a refusal of step 1 or a question no one could answer
- `Question: <the question>`, only with `Stop: seam to agree`
- `Next: <skill>`, the skill named below, the skill a refusal of step 1 names, or `Next: none` after any stop that names no skill, such as `Stop: nothing to fix`, `Stop: seam to agree` or `Stop: check failed on code the fix did not touch`

**Then name the next skill:** `/aw-verify` when the fix touches a criterion whose Traceability row holds a `verify:` entry, or on the fast route when the repo has a verify skill at `.claude/skills/verify-<app>/`, and `/aw-review` otherwise. Tell the user to run it; this skill never runs it (ADR 0010). After a stop on a wrong criterion, name what **When the spec is wrong** or **When the criteria are wrong** names instead: `/aw-spec`, or on the fast route `/aw-build` once the corrected criterion is agreed.
