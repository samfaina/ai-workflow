---
name: aw-review
description: "Review the diff from the diff base on three axes, Spec, Standards and Security, each in its own clean-context subagent, and report them side by side. A defect counts only when a run proves it; anything else is a risk with its likelihood and cost; pre-existing findings are reported apart. Writes a review report and never posts to the review host. Run before /aw-ship: after /aw-verify on the standard and epic routes, after /aw-build on the fast route."
disable-model-invocation: true
---

# Review

Review the change on the work branch, the diff from the VCS adapter's `diff-base`, on three axes:

- **Spec**: does the change do what its spec asks, every `AC-n` and nothing outside its scope? On the fast route there is no spec, and the axis judges against intake's "done when" criteria.
- **Standards**: does it follow the repo's documented standards, plus a baseline of code smells?
- **Security**: is it safe, judged with `aw-security-and-hardening`?

Each axis runs in a **subagent of its own with a fresh context**, so that no axis sees another's reasoning, and the report puts the three side by side without merging or reranking them. The **review report** is this phase's artifact: a file under `.aw/reviews/`, also given in chat.

This skill observes; it never fixes. It changes no code, no test and no spec, commits nothing, and never posts to the review host: no `push`, no `open-review`, no comment on a review request or a ticket. Posting belongs to `/aw-ship`, and fixing to `/aw-build` or `/aw-spec`.

## Configuration

Find the repo's `## Agent skills` block: look in `AGENTS.md`, then `CLAUDE.md`, then `.claude/CLAUDE.md`, and follow its pointers to the tracker, VCS and checks adapters and the domain doc. Use each operation the way the adapter's Operations table says, at its access level: a write at `draft` is not performed; write its exact command or text to `.aw/drafts/<yyyymmdd-hhmmss>-<operation>.md` and tell the user the path. Where the block or an adapter is missing, use the defaults below. This skill uses only read operations: `diff-base`, `fetch-ticket` and `run-check`.

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

## Findings

Every axis reports its findings under the same rules. The reviewer of each axis gets them pasted in full in its brief (step 5).

- **Defect**: a finding that a **run** made in this review demonstrates. A run is a command whose output shows the wrong behaviour: a test, a check level, a script, a request to the running app, or, for a documented standard that is a rule about the text itself, a search whose output quotes the lines that break it. A defect names its run (the exact command and the commit it ran on) and quotes the output that shows it. A finding with no such run is never a defect, however sure the reviewer is.
- **Risk**: every other finding, including a suspected defect no run could demonstrate, and every code smell. A risk states what may go wrong, its **likelihood** (low, medium or high, and what it depends on) and its **cost** if it happens (what breaks, and for whom). It is never worded as a defect.
- **Dropped**: when a run shows the suspected behaviour is right, the finding is not reported at all.
- **Introduced or pre-existing**: a defect is **pre-existing** when the same run, made at the merge-base, shows it too; otherwise the change **introduced** it, as it also did when the run cannot be made at the merge-base because what it calls does not exist there. A risk is introduced when it rests on lines the diff adds or changes, and pre-existing otherwise. Pre-existing findings are reported apart: they are not this change's.
- **Zero findings is a valid outcome.** An axis with nothing to report says "No findings." and nothing more. Only defects and risks enter the report: a finding is one or the other, or it is left out.

**Where runs happen.** Every run is made in a detached worktree outside the repo, never in the user's working tree, which may hold uncommitted changes and must stay as it is: `git worktree add --detach <tmp>/head HEAD` for runs at `HEAD`, and `git worktree add --detach <tmp>/base <merge-base>` for the same run at the merge-base, where `<tmp>` is a new directory under the system's temporary directory. Install the project's dependencies in each worktree the way its manifest says, such as `npm ci`, before the first run there. A throwaway test is written in the worktree, never committed and never left behind. Remove each worktree when its runs are done, with `git worktree remove --force <dir>`, which removes the worktree and no branch.

## Steps

### 1. Pin the diff base

Use `diff-base` for the base the change is reviewed against; the user may name another fixed point (a branch, tag or commit). Confirm it resolves with `git rev-parse <base>`, and take the merge-base: `git merge-base <base> HEAD`.

Capture once:

- the diff command: `git diff <base>...HEAD` (three dots, so the comparison is against the merge-base);
- the commits: `git log <base>..HEAD --oneline`;
- the branch, and the short hashes of `HEAD` and the merge-base.

Stop when the diff is empty, or the base does not resolve: say which. The review covers commits only: when the working tree holds uncommitted changes, tell the user they are outside the review and ask whether to go on.

Done when you have the diff command, the commits, the branch and both hashes, and the diff is not empty.

### 2. Find what the Spec axis judges against

First find the route. It is the fast route when `/aw-intake` reported `Route: fast` for the task in this conversation, or when the commits since the base carry the `Done when:` lines `/aw-build` writes and the diff touches no spec under `docs/specs/`; otherwise it is the standard or epic route.

**Standard or epic route: the spec.** Take the spec the user names, or else the one the diff touches under `docs/specs/<slug>/spec.md` (`/aw-build` commits its spec edits with each slice), or else the one whose slug the branch name holds. When more than one fits, or none does, list the specs under `docs/specs/` with their `status` and ask which one. Read its frontmatter:

- `draft`: stop. The spec has not passed spec approval; tell the user to finish it with `/aw-spec`.
- `superseded`: stop, and name the spec its `superseded-by` points to.
- `approved` or `implemented`: go on.

The Spec axis judges against every `AC-n`, and against the scope: the Problem and goal, Out of scope and Boundaries sections. Note each slice whose done marker is not `[x]`, for the report.

**Fast route: the "done when" criteria.** With no spec, take the 1 to 3 "done when" criteria from `/aw-intake`'s report in this conversation, or else from the latest commit whose message carries the `Done when:` lines `/aw-build` writes (`git log <base>..HEAD --format=%B`), or else ask the user for them. They are the definition of done, and the scope: the diff should do what they ask and nothing more. When there are none, the Spec axis does not run, and the report says "No spec or done-when criteria: Spec axis not run." Also note the latest verify results under `.aw/verify/`, when `/aw-verify` ran on this branch.

When the commits name a ticket, use `fetch-ticket` and give it to the Spec axis as context; the spec or the criteria stay what it judges against.

Done when you have the spec's path, or the done-when criteria, or the user's word that there are none.

### 3. Find the standards

List every file in the repo that documents how code should be written: `CODING_STANDARDS.md`, `CONTRIBUTING.md` and the like when they exist, the agent instruction files (`AGENTS.md`, `CLAUDE.md`), linter and formatter configs, and the ADRs and glossary the domain doc points to.

On top of what the repo documents, the Standards axis always carries the **smell baseline** below, a fixed set of Fowler's code smells (_Refactoring_, ch. 3) that applies even when the repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** A smell is a labelled heuristic ("possible Feature Envy"), so it is always a risk, never a defect. Skip anything the repo's tooling already enforces.

Each smell reads _what it is_ → _how to fix_; match it against the diff:

- **Mysterious Name**: a function, variable or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design is murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace it with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split it so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target directly.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

Done when you have the list of standards files and the baseline to paste.

### 4. Load the security guidance

Call the Skill tool with "aw-security-and-hardening". Keep its text, and the paths of its `references/security-checklist.md` and `references/hardening-patterns.md` under the base directory the harness reports for it: the Security axis gets them, since a subagent may not be able to load the skill itself.

Done when you have the skill's text and the paths of both references.

### 5. Run the three axes in parallel

Start the three subagents together, in the foreground, each with a fresh context window, and wait for the three reports. Never review an axis yourself in this context: the separation is what keeps each reviewer unbiased.

Every brief holds:

- the diff command, the commits, the branch, and the hashes of `HEAD` and the merge-base;
- the **Findings** section above, pasted in full, with **Where runs happen**;
- the check commands from the checks adapter, or the ones the project's manifest suggests, for its runs;
- the instruction to change nothing in the user's working tree, commit nothing, push nothing and post nothing;
- the output shape: three headings, `Defects introduced`, `Risks introduced` and `Pre-existing`, each holding its findings or "None."; or "No findings." alone when all three are empty. Each defect gives the file and line, what is wrong, the run, and its quoted output; each risk gives the file and line, what may go wrong, its likelihood and its cost. Under 400 words, runs' output excepted.

Then, per axis:

- **Spec**: the spec's path, or the done-when criteria with the `Test exception:` lines of the commits and the paths of any verify results from step 2. The brief: "Run the `full` check level at `HEAD`, and each check that fails there at the merge-base too: a failing check is a defect. For each criterion, prove with a run that the change meets it or fails it, starting from the evidence its Traceability row names, or on the fast route the tests that quote the criterion: running such a test is such a run; a criterion the change does not meet is a defect when a run shows it, and a risk when none can. Report as well behaviour in the diff that the criteria and the scope do not ask for (scope creep), and anything the spec's Out of scope or Never boundaries rule out. Quote the criterion or the spec line for each finding."
- **Standards**: the list of standards files from step 3, the smell baseline pasted in full, since the subagent has no other access to it, and the spec's path or the done-when criteria, so that it can judge Speculative Generality. The brief: "Report each place the diff breaks a documented standard, citing the file and the rule, and each baseline smell you spot, naming it and quoting the hunk. A breach is a defect only when a run shows it; a smell is always a risk. Skip anything tooling enforces."
- **Security**: the text of `aw-security-and-hardening` and the paths of its two references. The brief: "Map the trust boundaries the diff touches and walk the security checklist against them. Prove what you can with a run, such as a request with hostile input, a test of the input handler, or the package manager's audit; report everything else as a risk. When the diff touches no trust boundary, secret, dependency or personal data, you have no findings."

When there is no spec and no done-when criteria, start only the Standards and Security subagents.

Done when every axis that runs has returned its report.

### 6. Check the defects

For each defect a subagent reported, run its command yourself at `HEAD`, and then at the merge-base, in detached worktrees as **Where runs happen** says:

- **The run at `HEAD` shows the behaviour is right:** drop the defect.
- **It shows neither way:** move it to that axis's risks, saying the run did not reproduce it, and give it a likelihood and a cost.
- **It shows the defect:** it stays a defect. It belongs under `Pre-existing` when the run at the merge-base shows it too, and under `Defects introduced` otherwise, whatever the subagent labelled it.

Change nothing else in the reports: do not merge, rerank or reword findings across axes, and add no finding of your own.

Done when every defect left in the report was reproduced at `HEAD` in this context, and its label matches the run at the merge-base.

### 7. Write the report

Write the report to `.aw/reviews/<yyyymmdd-hhmmss>-review.md`, in this shape:

```markdown
# Review: <branch> at <short hash of HEAD>

- Diff base: <base> (merge-base <short hash>), <n> commits
- Spec axis judged against: <the spec's path, the done-when criteria, or "nothing: not run">
- Proven defects: <n> introduced, <m> pre-existing

## Spec

<The Spec axis's report, verbatim or lightly cleaned, with step 6's changes. Then, as a note and not a finding, any slice whose done marker is not `[x]`.>

## Standards

<The Standards axis's report.>

## Security

<The Security axis's report.>

## Summary

<One line per axis: its counts of introduced defects, introduced risks and pre-existing findings, and its worst finding, or "no findings". Never pick one worst finding across axes.>
```

The report stays in `.aw/`, which is local state: never commit it.

Done when the report is written and every defect in it names the run that proves it.

### 8. Report

Give the report in chat, with its path. Then name what comes next, and tell the user to run it; this skill never runs it:

- **No proven defect:** `/aw-ship`. Introduced risks are for the user to accept or fix before shipping.
- **An introduced defect:** fix it on the work branch before shipping, with the fix run of `/aw-build`, which takes every defect under `Defects introduced`, from any axis. It starts by itself once every slice is done; while a slice is still to build, ask `/aw-build` for it. When a criterion itself is wrong, the fix goes to `/aw-spec` instead; on the fast route, to a corrected done-when criterion the user agrees. Then run `/aw-verify` when the fix touches a criterion with `verify:` evidence, or on the fast route when the repo has a verify skill, and `/aw-review` again.
- **Pre-existing defects only:** this change is not responsible for them, and the user may fix them first or ship. Offer to start each as a task of its own with `/aw-intake`. When they ship, `/aw-ship` still sees a proven defect in the report, so with `merge` at `write` it does not merge by itself (ADR 0013): a person merges.
