---
name: aw-blast-radius
description: "Find what a change could break somewhere else, beyond the diff, and prove the one fact it's safe because of by running real code instead of writing it up. Use for 'blast radius of X' or 'what could this break'."
---

# Blast radius

Find what a change breaks somewhere else, before it ships.

Listing the callers is not the job. The agent can grep those in a second. The job is the breakage grep won't show you.

## In the Kit

This skill is phase-free and optional: no phase requires it, nor does any route, and no ship or merge condition depends on it having run. It creates no gate. It runs when a task calls for it or a person invokes it.

## Don't trust your own writeup

A blast radius writeup that sounds right is worthless. It reads as convincing whether or not it's true. So don't hand back the writeup. Find the one or two facts the whole thing depends on and prove them by running code.

## Proof levels

For each fact the change's safety depends on, get it as far down this list as is cheap, and say where it stopped.

1. You said so. Worthless on its own.
2. You pointed at the line. A real `file:line`, or the library's own source.
3. You showed the bad case can't happen. You walked the failure step by step and it doesn't reach.
4. You ran it. A script or test that calls the real code and fails loud if you're wrong.
5. You reproduced it in the running app.

Level 4 is usually one small script that imports the same library the app ships and calls the exact function you're worried about.

## Findings

- **Defect**: a breakage a run made by this skill demonstrates. A run is a command whose output shows the wrong behaviour: a test, a script, a check level, a request to the running app. A defect names its run (the exact command and the commit it ran on) and quotes the output that shows it. A breakage with no such run is never a defect, however sure you are.
- **Risk**: any other breakage you keep. A risk says how it breaks and the `file:line`, its **likelihood** (low, medium or high, and what it depends on), its **cost** if it happens (what breaks, and for whom), and how to check. It is never worded as a defect.
- **Cleared**: what you checked and why it's fine, listed apart from the risks. Cite a real `file:line`. A search that finds nothing is still an answer. Never make up a caller or an API.
- **Introduced or pre-existing**: a defect is **pre-existing** when the same run, made at the merge-base, shows it too. Report it apart: the change is not responsible for it.

## Where runs happen

Every run is made in a detached worktree outside the repo, never in the user's working tree, which may hold uncommitted changes and must stay as it is: `git worktree add --detach <tmp>/head HEAD` for runs at `HEAD`, and `git worktree add --detach <tmp>/base <merge-base>` for the same run at the merge-base, where `<tmp>` is a new directory under the system's temporary directory. Install the project's dependencies in each worktree the way its manifest says, such as `npm ci`, before the first run there. A proof script is written in the worktree, never committed and never left behind: its text goes in the report. Remove each worktree when its runs are done, with `git worktree remove --force <dir>`, which removes the worktree and no branch.

A worktree holds commits only. When the change is uncommitted, carry it across with `git diff HEAD | git -C <tmp>/head apply`, copy any untracked file it needs, and say so in the report.

## What it writes

The only file it writes in the repo is its report, under **Report**. It commits nothing. It fixes nothing: fixing belongs to `/aw-build` or `/aw-spec`.

## Steps

1. Read the change, with git directly. Take the commit, range or branch the user names; with none, the work branch against the VCS adapter's `diff-base`, or else the default branch (`git symbolic-ref refs/remotes/origin/HEAD`, else `main` or `master`). Read `git diff <base>...HEAD` and `git log <base>..HEAD`, or `git show <commit>` for one commit, then `git status --porcelain` for anything uncommitted. Work out the symbols it adds, changes, and deletes, and what it now does differently, including the part the diff doesn't spell out. Done when you can say what the change does differently.
2. Find the safety fact, the one fact it's safe because of. Most changes that look risky are safe because of a single fact, like "this call only drops already-dead cache entries and does nothing else". Find that fact. If it holds, most risky cases are cleared at once. Spend your time here, not on a long list of maybes. Done when you can state it in a sentence, or have said the change has none.
3. Look where grep stops. Read the source of the library you call, and check its pinned version and any local patch. Work out when things run: microtasks, unmount and teardown, one framework's rules against another's. Follow what a symbol search misses: the JSON an API returns, a DB column, a wire format, another language reading the same bytes, a feature flag, code three hops downstream. Done when each of these the change can reach has been followed, or marked as not applying.
4. Be honest about each breakage. Give it a real chance of happening and a real cost if it does, and sort it under **Findings**. Done when each one you found is a defect, a risk or cleared.
5. Prove the safety fact. Write a script or test that runs the real code, run it, and paste what happened. Every run goes where **Where runs happen** says. When the run shows the fact is false, the breakage it shows is a defect. Run any other breakage you can prove the same way, and each proven defect again at the merge-base. Done when the safety fact has a proof level, and every defect has a run at `HEAD` and at the merge-base.
6. Write the report and reply, under **Report**, following **A proven defect** when there is one. Done when the report is written and the worktrees are removed.

## A proven defect

When a run proves a defect, say plainly, in the report's conclusion and in the reply, that the defect stays open until it is fixed and `/aw-review` runs again. No merge condition reads this report, so nothing else holds it open.

## Report

Write the report to `.aw/blast-radius/<yyyymmdd-hhmmss>-blast-radius.md`, in this shape:

```markdown
# Blast radius: <branch> at <short hash of HEAD>

- Change: <the commit or range read, and whether it carries uncommitted changes>

## Conclusion

<The safety fact, proven or unproven, and any defect left open.>

## What it does

<What changed, including the part that isn't obvious.>

## Safety fact

<State it. Proof level: <1 to 5>. Show the proof. If you couldn't prove it, write unproven.>

## Defects

<Each with the `file:line`, what breaks, its run and its quoted output, pre-existing ones apart; or "None.">

## Risks

<Each with how it breaks, the `file:line`, its likelihood, its cost and how to check; or "None.">

## Cleared

<What you checked and why it's fine.>

## Before you merge

<The cheapest test or repro that catches the real bug.>

## Proof script

<The whole script you ran, and the command that runs it; or why there is none.>
```

**Conclusion.** One or two sentences that can be quoted where the remote shows it: no script, and no path to this report.

The report stays in `.aw/`, which is local state: never commit it. Cite real code, and strip anything private before any of it goes anywhere public.

**Reply:** the report in chat, with its path and with the safety fact either proven or marked unproven.

## Credits

Adapted from Lauren Tan's pstack (MIT), as listed in the kit's `NOTICE.md`.
