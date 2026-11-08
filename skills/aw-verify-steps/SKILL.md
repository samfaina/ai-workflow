---
name: aw-verify-steps
description: "The steps of /aw-verify: prove each criterion on the real app through the repo's verify skill and record the results. A phase procedure for calls from /aw-verify and aw-converge only: do not load it by your own choice."
user-invocable: false
---

# Verify steps

## First step: check the caller

This is the phase procedure of `/aw-verify` (ADR 0016). Read the arguments before anything else. Unless they name the caller, as `caller: aw-verify` or `caller: aw-converge`, stop, change nothing and say that a person starts this phase with `/aw-verify`.

With `caller: aw-converge` you run in a subagent and no user can answer you. The arguments name the spec, or say the task is on the fast route. A journey that needs something from the user is inconclusive. Wherever a step says to ask the user anything else, end the run with a `Stop:` line that says what you would have asked. `.aw/` is local state: its files are not changes in the working tree.

Prove each acceptance criterion of a spec on the **real app**, through the repo's verify skill at `.claude/skills/verify-<app>/` (ADR 0011), and record each result as `verify:` evidence in the spec's Traceability. The result files under `docs/specs/<slug>/verify/` and the Traceability rows that point to them are this phase's artifact; on the fast route, which has no spec, it proves intake's done-when criteria instead, as **The fast route** says.

This skill observes; it never fixes. It changes no code and no test. In the spec it edits only the Traceability rows, and the done marker of a slice whose criterion failed, which it sets back to `[ ]` so that `/aw-build` builds the slice again. A criterion the app does not meet is recorded as failed and reported, never patched here.

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

## Results

Each journey ends in one of three results:

- **passed**: the run observed the criterion's "then", quoted in the result file.
- **failed**: the run reached the criterion's "when" and observed something other than its "then". The result file holds what was expected and what was observed.
- **inconclusive**: the run could not tell: the app did not start, the "given" state could not be set up, the feature map has no way to drive or observe the behaviour, or what was observed fits both outcomes. The result file says which.

A result is **passed** only from an observation made in this run. Never infer it from the code, the tests or an earlier run; when in doubt, it is inconclusive.

## Steps

### 1. Take the spec

On the fast route there is no spec: follow **The fast route** below instead of this step, and read the later steps with the changes it lists.

Take the spec the user names or the arguments name, or the one `/aw-build` finished in this conversation. When neither is clear, list the specs under `docs/specs/` with their `status` and ask which one.

Read the spec's frontmatter. **Refuse to go on unless `status` is `approved`**, and say why:

- `draft`: the spec has not passed spec approval. Tell the user to finish it with `/aw-spec` and approve it there.
- `implemented`: the spec is built and shipped. To change it, run `/aw-spec`, which sets it back to `draft` for the change and asks for approval again.
- `superseded`: name the spec its `superseded-by` points to.

Never set or change `status` yourself. Refuse as well while a slice in the Slice plan is not done (its marker is not `[x]`): name those slices and tell the user to build them with `/aw-build`. Refuse, too, on a protected branch (the base branch or another the VCS adapter names): the results are committed on the spec's work branch, where `/aw-build` committed its slices; tell the user to switch to it.

Then call the Skill tool with "aw-check-spec" and run it on the repo. When it reports a finding on this spec, stop: report the findings; fixing them is a spec change for `/aw-spec`. When it reports `Result: not script-verified`, Node is missing: say so, and go on.

Done when you can name the spec, its criteria, that every slice is done, and the work branch you are on.

### 2. Find the verify skill

Look for `.claude/skills/verify-*/SKILL.md` at the repo root, whatever the harness.

- **One:** use it.
- **Several:** use the one whose app the spec's Design touches; when that is unclear, ask the user.
- **None:** go to **Without a verify skill**.

Read the verify skill whole. Follow it as written: its Start, Diagnose, Drive, Observe and Clean up sections, and its feature map. When it is out of date, such as a command that no longer exists, stop and tell the user to run `/aw-create-verify` again; do not fix it here.

Done when you have read the one verify skill this spec is proven through.

### 3. Plan a journey per criterion

For each `AC-n`, write the **journey** that proves it, from its Given/When/Then and the feature map:

- **Given:** the state to set up, through the app's own interface where the verify skill's Drive section says how.
- **When:** the action, as the feature map's Drive column states it.
- **Then:** what to observe, as its Observe column states it, and what result the criterion expects.

Every criterion gets a journey, those already proven by tests included: a test proves the code, a journey proves the running app. A criterion the feature map gives no way to drive or observe, or one that needs an account or a judgement only the user has, still gets one: ask the user for what it needs. When they cannot supply it, its result is inconclusive, and its other evidence stands.

Done when every criterion has a journey, or a reason why its result will be inconclusive.

### 4. Run the journeys

**Start** the app and **Diagnose** it until it reports healthy, as the verify skill says. When it does not come up, every result is inconclusive: record why, and go to step 5.

Run each journey in turn. Keep for each one the commands you ran, what they returned, and any screenshot or log excerpt, taken as the verify skill's Observe section says and saved under `docs/specs/<slug>/verify/` as `ac-<n>-<what>.<ext>`. Decide its result as **Results** says.

**Clean up** after the last journey, as the verify skill says, and also when a journey stops the run: nothing this skill started stays running.

Done when every journey has a result and the app is cleaned up.

### 5. Record the results

Write one result file per criterion, `docs/specs/<slug>/verify/ac-<n>.md`, replacing the files an earlier run left for that criterion, its `ac-<n>-<what>.<ext>` files included:

```markdown
# AC-<n>: <passed, failed or inconclusive>

- Criterion: <the criterion's text, as the spec states it>
- Run: <date and time>, on commit <short hash>, through `.claude/skills/verify-<app>/`

## Journey

1. <Step, with its command or action.>

## Observed

<What the run returned, quoted: a response, an output, a log line, or a link to a saved screenshot. For failed, also what was expected. For inconclusive, why the run could not tell.>
```

Then edit the spec:

- **Traceability:** in each criterion's row, put `` verify: `docs/specs/<slug>/verify/ac-<n>.md` (<result>) `` in place of any `verify:` entry it held, such as the planned `` verify: `docs/specs/<slug>/verify/` `` that `/aw-build` writes. Keep its `test:` and `manual:` entries, separated by `;`.
- **Failed criteria:** set the done marker of each slice that covers a failed criterion back to `[ ]`.

Leave everything else in the spec as it is. Run `aw-check-spec` again. Fix a finding your edits caused; any other finding on this spec is a spec change: report it, and commit nothing. The check resolves `verify:` paths only at `implemented`, so also check that each result file you named exists.

Done when every criterion has a result file and a `verify:` entry naming it and its result, each failed criterion's slice is unticked, and the check reports no finding on this spec, or ran by reading only and you said so.

### 6. Commit locally

When the working tree holds changes this skill did not make, ask the user whether to commit, set aside or keep them first: they must not land in this commit. Stay on the spec's work branch; never commit on a protected branch.

Use `commit` for the result files and the spec's edits, together, with a message in the VCS adapter's commit convention, such as `test: verify <slug> on the real app (AC-1 passed, AC-2 failed)`. At `draft`, write the draft and tell the user the path. The commit stays local: `push` and `open-review` belong to `/aw-ship`.

Done when the results are in one local commit, or in a draft whose path you gave the user.

### 7. Report

Report in chat:

- the spec's path and the verify skill used;
- each criterion's result, one line each, with its result file;
- for each failed criterion, what was expected and what was observed, and the slice that covers it;
- for each inconclusive one, why, and the other evidence its row holds, or "no other evidence";
- the commit's hash and subject, or the draft path, and the `aw-check-spec` result.

Then name the next skill, and tell the user to run it; this skill never runs it. The report closes with its `Next:` line, and with a `Stop:` line above it when the case below has one: a later command reads them. A refusal in step 1, or any other stop, ends with `Stop: <the reason>` and `Next: <the skill it names>`, or `Next: none`.

- **every criterion passed**, or is inconclusive with `test:` or `manual:` evidence beside it: `/aw-review`, as `Next: /aw-review`;
- **a criterion failed**, as `Stop: criterion failed` and `Next: /aw-build`: the slice that covers it is not done, and its marker is unset again. Name the slice; the user fixes it with `/aw-build`, which builds it again, or with `/aw-spec` when the criterion itself is wrong, then runs `/aw-verify` again;
- **a criterion is inconclusive with no other evidence**, as `Stop: verify journey needs a person` and `Next: /aw-build`: it needs `test:` or `manual:` evidence, as **Without a verify skill** says for every criterion.

## Without a verify skill

With no verify skill, no criterion can be proven on the real app here: every criterion needs `test:` or `manual:` evidence instead (ADR 0011). Start nothing. Read the Traceability table and sort the criteria:

- **Has evidence:** the row holds a `test:` entry whose file mentions the criterion's `AC-n`, or a `manual:` entry with its reason.
- **Needs evidence:** anything else: the row is empty, holds only `verify:` entries, such as the planned path `/aw-build` writes for a test exception, or names a test file that does not mention the criterion.

Report in chat:

- that the repo has no verify skill at `.claude/skills/verify-<app>/`;
- each criterion that needs evidence, one line each: `AC-n: needs test: or manual: evidence (the row holds <what it holds>)`;
- the criteria that have evidence, with it.

Close the report with `Stop: criteria need test: or manual: evidence` and `Next: /aw-create-verify`, or with `Next: /aw-review` alone when no criterion needs evidence. Then name the ways forward, and tell the user to run what they choose:

- `/aw-create-verify`, to write a verify skill, then `/aw-verify` again;
- for a criterion a test can prove: `/aw-build` on the slice that covers it;
- for one only a person can check: they check it by hand on the running app and tell you what they did and saw.

When the user reports a check by hand, record it in that criterion's row as `manual: <what they checked, what they saw, and why no test proves it>`, in place of the row's `verify:` entries, which no verify skill can resolve, and beside its `test:` entries. Then run `aw-check-spec` and commit as steps 5 and 6 say. Record only what the user reports, never a check nobody made. When every criterion has evidence, name `/aw-review` as the next skill.

## The fast route

On the fast route (ADR 0013) there is no spec: this skill proves `/aw-intake`'s done-when criteria on the real app, and runs only when the repo has a verify skill. Its artifact is then local result files under `.aw/verify/`, in place of the `verify:` evidence in Traceability that ADR 0010 names. Follow the steps above with these changes; where a step or its "Done when" line names the spec, a slice or Traceability, read the task and its criteria.

**Step 1: take the criteria, not a spec.** The task is on the fast route when `/aw-intake` reported `Route: fast` for it in this conversation, or when the work branch's commits since the diff base carry the `Done when:` lines `/aw-build` writes and touch no spec under `docs/specs/`. Take the criteria from intake's report, or else from the latest of those commits that carries `Done when:` lines (`git log <base>..HEAD --format=%B`), or else ask the user for them. There is no `status`, slice plan or `aw-check-spec` run to check. Refuse on a protected branch, as for a spec.

Done when you can name the done-when criteria and the work branch you are on.

**Step 2: no verify skill means no phase.** When the repo has no verify skill, the fast route skips this phase, and **Without a verify skill** does not apply: say so, and name `/aw-review` as the next skill, as `Next: /aw-review`. A criterion that `/aw-build` gave a test exception is then checked by hand when `/aw-ship` asks for it.

**Step 3: a journey per criterion.** Read each done-when criterion as its "given", "when" and "then", and plan its journey through the feature map, as for an `AC-n`.

**Steps 4 and 5: results stay local.** Save each journey's captures, and one result file per criterion, `done-when-<n>.md` for the criterion's place in the list, under `.aw/verify/<yyyymmdd-hhmmss>-<branch>/`, with `/` in the branch name made `-`. The result file has the shape of step 5's, headed `# Done when <n>: <result>`. There is no spec to edit and no Traceability: `.aw/` is local state, and the results reach the review request through `/aw-ship`'s Evidence.

Done when every criterion has a result file and the app is cleaned up.

**Step 6: no commit.** Nothing this skill wrote is committed on the fast route. Skip the step.

**Step 7: report.** Report each criterion's result with its result file, then name the next skill:

- **every criterion passed**, or is inconclusive with a test that proves it: `/aw-review`, as `Next: /aw-review`;
- **a criterion failed**, as `Stop: criterion failed` and `Next: /aw-build`: the task is not done. The user fixes it with `/aw-build`, then runs `/aw-verify` again;
- **a criterion is inconclusive with no test**, as `Stop: verify journey needs a person` and `Next: /aw-review`: it needs a check by hand, which `/aw-ship` asks the user for; name `/aw-review`.
