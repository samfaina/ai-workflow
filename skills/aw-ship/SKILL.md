---
name: aw-ship
description: "Ship a reviewed change: run the full check level, set the spec to implemented once aw-check-spec passes, write the review request body (Summary, Evidence, Merge Danger, pre-ship checklist, rollback plan), then push, open the review request and merge as the VCS adapter's access levels allow. Merges by itself only at merge: write, when the latest review report shows no proven defect and the full level passed. Run after /aw-review."
disable-model-invocation: true
---

# Ship

Take the reviewed change on the work branch to a **review request** and, when the VCS adapter allows it, to a merge (ADR 0013). This phase's artifact is the review request body and, on the standard and epic routes, the spec set to `implemented` in the same change.

This skill runs `run-check full` itself; nobody has to remember to. It fixes nothing: a failing check, a failed criterion or a proven defect sends the change back to the phase that owns it, and nothing is pushed.

Accepting the change is not a fixed human gate. `merge` is at `draft` by default, so a person merges. Only at `merge: write` does this skill merge, and only when every condition in **Merge conditions** holds.

## Configuration

Find the repo's `## Agent skills` block: look in `AGENTS.md`, then `CLAUDE.md`, then `.claude/CLAUDE.md`, and follow its pointers to the tracker, VCS and checks adapters and the domain doc. Use each operation the way the adapter's Operations table says, at its access level: a write at `draft` is not performed; write its exact command or text to `.aw/drafts/<yyyymmdd-hhmmss>-<operation>.md` and tell the user the path. Where the block or an adapter is missing, use the defaults below. This skill uses `diff-base`, `fetch-ticket`, `run-check`, `commit`, `push`, `open-review` and `merge`.

On the defaults, the only write this skill performs is the local commit that sets the spec to `implemented`. `push`, `open-review` and `merge` each land as a draft in `.aw/drafts/`, and nothing is pushed.

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

## Merge conditions

At `merge: write`, merge only when all of these hold; otherwise leave the merge as a draft and say which condition failed:

1. **No proven defect.** The latest review report, step 2's, says `Proven defects: 0 introduced, 0 pre-existing`. A pre-existing defect still blocks the merge by itself: the user may ship it, but a person merges.
2. **`full` passed.** `run-check full` passed in this session, in step 3, on `HEAD` as it was then, and the only commit since is this skill's spec commit. A level with no command is not run, so it never counts as passed.
3. **The spec is proven.** On the standard and epic routes, the spec is `implemented` and `aw-check-spec` passed on it, script-verified, in step 4 of this session. On the fast route there is no spec: instead, each done-when criterion is proven by a test that passed in step 3's run, a `passed` verify result, or a check by hand the user reported in this session, and its pre-ship checklist item is ticked.

With a review host, there is nothing to merge until `push` and `open-review` were performed in step 6: when either was drafted, the merge is drafted too.

The host may refuse the merge, for instance while required CI checks are pending or failing. Report its output, leave the merge as a draft, and never bypass the host with an admin or force option.

## Steps

### 1. Take the change

Use `diff-base` for the base. Run `git status --porcelain`, `git branch --show-current` and `git log <base>..HEAD --oneline`.

- **Protected branch:** stop. The change ships from its work branch; tell the user to switch to it.
- **No commits ahead of the base:** stop; there is nothing to ship.
- **Uncommitted changes:** they are outside the review and outside this ship. Ask the user whether to commit them through the earlier phases, set them aside or keep them; never stage them here.

Then find the route:

- **Standard or epic route: the spec.** Take the spec the user names, or else the one the diff touches under `docs/specs/<slug>/spec.md`, or else the one whose slug the branch name holds. When more than one fits, or none does, list the specs under `docs/specs/` with their `status` and ask. Read its frontmatter: `draft` → stop, it has not passed spec approval, tell the user to finish it with `/aw-spec`; `superseded` → stop and name its `superseded-by`; `approved` → go on; `implemented` → go on only when this branch's own commits set it, as a rerun of this skill does, and otherwise stop, since a shipped spec changes through `/aw-spec`. Refuse while a slice's done marker is not `[x]`: name it, and tell the user to build it with `/aw-build`.
- **Fast route: no spec.** The change is on the fast route when `/aw-intake` reported `Route: fast` for it in this conversation, or when its commits carry the `Done when:` lines `/aw-build` writes and touch no spec under `docs/specs/`. Take the done-when criteria from intake's report, or else from the latest of those commits that carries `Done when:` lines (`git log <base>..HEAD --format=%B`), or else ask the user for them. They are the definition of done this ship proves, and no spec is created for them.

When the spec's `ticket` field or the commits name a ticket, use `fetch-ticket`, for the review request's title and its closing line.

Done when you have the branch, the base, the commits, and the spec's path or the done-when criteria.

### 2. Read the latest review report

List `.aw/reviews/*-review.md` and take the latest: the file names start with `<yyyymmdd-hhmmss>`, so the last in name order is the newest. Read it whole.

- **No report:** stop. Nothing ships unreviewed: tell the user to run `/aw-review`.
- **The report names another commit:** its heading reads `# Review: <branch> at <short hash>`. When that hash is not `HEAD`, apply **Commits after the review**. When every check in it holds, the report covers `HEAD`. When one fails, the commits after it are unreviewed: stop, and tell the user to run `/aw-review` again.
- **An introduced defect:** stop. Name it; the user fixes it on the work branch with `/aw-build`, or with `/aw-spec` when a criterion is wrong (on the fast route, with a corrected done-when criterion the user agrees), then runs `/aw-review` again.
- **Pre-existing defects only, or none:** go on. Note the counts on the report's `Proven defects:` line for the merge conditions, and every introduced risk for the pre-ship checklist.

**Commits after the review.**

1. **The reviewed commit is an ancestor of `HEAD`:** `git merge-base --is-ancestor <short hash> HEAD` exits 0. After a rebase or an amend it does not.
2. **List the commits after it, each with its files:** `git log -m --no-renames --name-only --oneline <short hash>..HEAD`. `--no-renames` counts a rename under its old and its new path, and `-m` shows what a merge commit changed.
3. **Set aside this skill's own spec commit,** when one is listed: its whole change, in `git show <hash>`, is step 4's edit of the spec's `status: approved` to `status: implemented`.
4. **Every file left, taken as one set, is an exempt adapter.**

**Exempt adapters** are the files the `## Agent skills` block, read at `HEAD`, points to as the tracker adapter, the VCS adapter and the domain doc, compared as exact paths from the repo root. With no block there are none, so any later commit but this skill's own spec commit stops the ship.

**Not exempt.** The exempt list stays closed at those three files, so that widening it is a decision and never a side effect of an edit:

- **The checks adapter:** it defines the command of the `full` level, which **Merge conditions** trusts, so a change to it always needs a review, also when a pointer names it as another adapter.
- **The file that holds the block:** it decides which files are adapters.
- **The spec:** its frontmatter included, apart from this skill's own spec commit.
- **Every other file:** code or not, it needs a review.

Done when you have the report's path, its counts, its introduced risks and the commits after the reviewed one, and the report covers `HEAD`.

### 3. Run the full check level

Run `run-check full` on `HEAD` from the repo root, with every commit step 2 accepted. Keep the exact command, its exit code and the tail of its output for the Evidence section.

- **It fails:** stop. Report the failure with its output; push nothing. The user fixes it with `/aw-build`, then runs `/aw-review` and this skill again.
- **The level has no command:** propose one from the project's manifest, as the checks adapter's defaults say, run it, and say it was proposed, not configured. When nothing can be run, `full` was not run: say so. Shipping may go on, but the merge conditions do not hold.

Done when `full` passed in this session, with its output kept, or you have said why it was not run.

### 4. Set the spec to implemented

Skip this step on the fast route. When this branch already set the spec to `implemented`, as on a rerun, skip the edit and the commit, but still run the check.

A spec is `implemented` only when its evidence proves every criterion, and `aw-check-spec` is what decides it: at `implemented` it resolves every evidence entry, and fails on a Traceability row with a `(failed)` verify result, or with an `(inconclusive)` one and no `test:` or `manual:` entry beside it.

Edit the frontmatter's `status: approved` to `status: implemented`, and change nothing else in the spec. Call the Skill tool with "aw-check-spec" and run it on the repo.

- **A finding on this spec:** set `status` back to `approved` and stop; nothing ships. Report the findings verbatim. A failed criterion goes back to `/aw-build` for the slice that covers it, then `/aw-verify` and `/aw-review` again; an inconclusive one needs `test:` or `manual:` evidence, as `/aw-verify` reports; any other finding is for `/aw-spec`.
- **`Result: not script-verified`:** Node is missing. Say so; the walk by reading found what it found. The spec may ship as `implemented`, but merge condition 3 does not hold, so a person merges.

Use `commit` for the spec alone, in the VCS adapter's commit convention, such as `docs: set <slug> spec to implemented`. When a commit hook fails, fix what it reports and commit again; never pass `--no-verify`. At `draft`, write the draft and tell the user the path: the spec then does not ship with the change, so stop before step 6.

Done when the spec is `implemented` in a local commit on the work branch and the check reports no finding on it, or you have said why not.

### 5. Write the review request body

Write the body to `.aw/review-requests/<yyyymmdd-hhmmss>-review-request.md`. It is local state, never committed. Skip preambles, keep prose brief, and use the glossary's vocabulary. Every section is required:

```markdown
## Summary

<What changes and why, in two or three sentences, next to the smallest visual that shows it.>

## Evidence

- **Before:** <at the merge-base: the failing test, the output or the screenshot that shows the old behaviour>
- **After:** <at HEAD: the same, now passing>
- **Checks:** `<the full command>` passed at <short hash>.
- **Review:** `<path of the review report>`: <n> introduced defects, <m> pre-existing, <k> introduced risks.
- **After the review:** <one line per commit in `<short hash>..HEAD`, from the report's heading: `<short hash>` <subject>, and that it changed only adapters, or, for this skill's spec commit, changed only the spec's status; or "none", when the report names `HEAD`>
- **Criteria:** <one line per AC-n with its Traceability evidence; or, on the fast route, one line per done-when criterion with what proves it: its tests, its verify result under `.aw/verify/`, or the check by hand the user reported>

## Merge Danger

**Door:** <one-way or two-way>, because <what makes it so>.

**Blast Radius:** <what the change can affect outside the review request: none, the repo, CI, consumers of an API, stored data, …. When the scope is not evident, suggest `/aw-blast-radius` to the user. When it has run on this change, its report is under `.aw/blast-radius/`: cite its conclusion, never its script or its report's path, since this body reaches the remote.>

## Pre-ship checklist

- [ ] <item>: <the evidence>

## Rollback plan

- **Trigger:** <what signal would mean rolling back>
- **Steps:** <the exact commands>
- **Data:** <what the change writes or migrates, and whether reverting the code undoes it>
- **Time to roll back:** <an estimate>

<Closes <ticket>, when a ticket is named, in the tracker's closing syntax.>
```

**Summary.** Pick the smallest view that makes the change clear: a `diff` tree of the files added and changed, a call tree, a component tree, pseudocode, a Mermaid diagram, or a short `diff` of the shape that changes. One is usually enough; never more than the point needs.

**Evidence.** A before and an after, from runs made in this session or recorded in the review report and the verify results: the test that fails at the merge-base and passes at `HEAD`, command output, or a screenshot when the change is visual. Quote outputs; never describe a run nobody made.

**Merge Danger.** A two-way door is cheap to walk back: reverting the commits restores the old behaviour. A one-way door is not: a data migration, a deletion, a published API or file format, a message already sent. Consider every consumer when sizing the blast radius.

**Pre-ship checklist.** Tick an item only when its evidence is in the body; leave it `[ ]` with the reason otherwise, and never drop it. The items:

- the `full` check level passed, with its command;
- the review report shows no introduced defect;
- each introduced risk from the report, listed for the user to accept;
- on the standard and epic routes, the spec is `implemented` and `aw-check-spec` passes; on the fast route, each done-when criterion is met, proven by a test, a verify result or a check by hand. For a criterion with none, such as one whose test exception named a check by hand, ask the user for that check and record only what they report;
- no debugging leftovers or unresolved TODOs in the diff: `git diff <base>...HEAD` searched for them;
- no secrets in the diff: searched for keys, tokens and passwords;
- dependency changes, if any, listed, with the review's Security axis on them;
- docs the change makes untrue are updated in the same change.

**Rollback plan.** The steps undo the change without rewriting history: `git revert -m 1 <merge commit>` once it is merged, or `git revert <commits>` for a fast-forward or squash, pushed through a new review request. When the change is a one-way door, say what a revert cannot undo and how to recover from it.

Done when the body file holds every section, filled in.

### 6. Push and open the review request

Each operation follows its access level in the VCS adapter:

- **`push`:** the work branch to its remote, never a protected branch, never forced. At `draft`, write the exact command to `.aw/drafts/<yyyymmdd-hhmmss>-push.md`. When the push is rejected, stop and report it: rewriting the remote is never allowed.
- **`open-review`:** with the review request's title in the commit convention and the body file from step 5. At `draft`, write the exact command and the whole body to `.aw/drafts/<yyyymmdd-hhmmss>-open-review.md`. When `push` was drafted, draft `open-review` too, whatever its access level, since the host has no branch to review yet, and say why. With no review host, the body is the review request: do what the adapter's `open-review` row says, such as copying it to `.aw/drafts/<yyyymmdd-hhmmss>-open-review.md`, and give the user its path.

At `write`, report the review request's URL or number.

Done when each operation was performed, or drafted with its path given to the user.

### 7. Merge

At `merge: draft`, the default, write the exact command to `.aw/drafts/<yyyymmdd-hhmmss>-merge.md`: a person merges.

At `merge: write`, check **Merge conditions**. When one fails, draft the merge, and say which condition failed and why. When all hold, merge as the adapter's `merge` row says:

- **With a review host:** merge the review request opened in step 6, with the adapter's merge method.
- **With no review host:** merge locally into the base branch, as the adapter says, such as `git switch <base>` then `git merge --no-ff <branch>`. The work branch is kept, and the base branch is never pushed by the agent.

When the merge fails, report its output and leave the merge as a draft. Never delete the work branch, local or remote.

Done when the change is merged, or the merge is drafted with its path and its reason given to the user.

### 8. Report

Report in chat:

- the branch, the base, and the spec's path and status, or the done-when criteria;
- the `full` check result, and the `aw-check-spec` result on the standard and epic routes;
- the review report's path and counts;
- the path of the review request body;
- for `push`, `open-review` and `merge`: performed, with the URL, number or merge commit, or drafted, with the draft's path and, for a drafted merge at `merge: write`, the condition that failed.

Then name what comes next. When the change was merged, the work is done; on the standard and epic routes, offer `/aw-retro`, and tell the user to run it: this skill never runs it. Otherwise, name the drafts the user applies to finish shipping.
