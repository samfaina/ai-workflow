# Pre-steps

Each type's pre-step runs before any change to the code it is about, so that the work starts from evidence. Run only the section for the task's type. Record what you run and what it prints; the report quotes it. A `<slug>` below is a short kebab-case name for the task, such as `slow-search-results`.

Run a check level through `run-check <level>`. With no checks adapter, propose the command from the project's manifest, run it, and report it as the command you ran, never as a level that passed.

## Bug: reproduce

Call the Skill tool with "aw-diagnosing-bugs" and work through its Phase 1 (build a feedback loop) and Phase 2 (reproduce and minimise). Stop there: the hypothesis, the fix and the regression test come later, in `aw-build`.

When the red command runs a test file, write it under `.aw/repro/<slug>/` and commit nothing: it is the bug's **reproduction**. It is temporary: `aw-build` turns it into a committed test at an agreed seam or deletes it, and until then the project's test runner may pick it up.

Done when you have one command, already run, that goes red on this bug, and the smallest input that still reproduces it. When that skill's Phase 1 says no loop can be built, report what you tried and what it asks the user for; the bug counts as not reproduced.

## Refactor: characterization tests

Pin the behaviour the refactor must keep, so that any change in it shows up as a failing test:

1. Find the public interface the refactored code sits behind, as high as the change allows, and the tests that already cover it.
2. List the behaviour that crosses that interface: outputs for typical, edge and error inputs, and side effects that are observable from outside.
3. For each behaviour no existing test pins, write a test at that interface whose expected value is what the current code does, observed by running it. Name each test after the behaviour, and mark the file or block as characterization tests.
4. Run them, with the existing tests of that interface, on the unchanged code.

Then commit the new tests on their own, through `start-branch` when you are on the base branch and then `commit`, so that every later phase starts from them. Done when every listed behaviour is pinned by a test, existing or new, all of them pass on the current code, and the new tests are committed or their `commit` left as a draft.

## Performance: baseline

1. Agree with the user what to measure (latency, throughput, memory, size, …), the workload that exercises the slow path, and the target, when they have one.
2. Write the measurement as one command, so that `aw-build` and `aw-verify` can rerun it unchanged.
3. Run it on the current code at least five times.
4. Write `.aw/baselines/<slug>.md` with the command, the machine and the tool versions, the commit (`git rev-parse HEAD`), every run's number, and the median.
5. When the task states a figure for the problem (a time, a rate, a size), compare the median with it, and say in the report whether they match. That figure is what the task says the problem is, not the target agreed in step 1. When they differ, give both numbers, and never present the baseline as confirming the task. A tail value that matches the figure, such as the maximum or a p99, is named as the tail, not as the usual case. When the task states no figure, skip this step.

The report states only what the recorded numbers show: quote a count or share of slow runs or requests only when the measurement recorded it. A maximum above a threshold shows that at least one passed it, not how many.

Done when the file holds at least five runs of one command and the report quotes the median and the spread, and, when the task states a figure, that figure beside the median and whether they match.

## Investigation: answer, changing nothing

An investigation reads and runs read-only commands, and writes only under `.aw/`: it edits no tracked file, writes nothing to the tracker, creates no branch and makes no commit. Before anything else, run `git status --porcelain` and keep its output, to compare against at the end.

- **The answer is in the repo:** answer the question, and cite every claim about the repo as `path:line`. When a claim rests on running something, quote the command and its output.
- **The answer needs sources outside the repo** (a library's documentation, a standard, a third-party API's behaviour): call the Skill tool with "aw-research", and tell it to save its findings to `.aw/research/<slug>.md`. Report what you asked it and where the findings will land.

Done when the question is answered with citations or handed to `aw-research`, and `git status --porcelain`, run again, shows nothing outside `.aw/` that the first run did not show.

## Feature

No pre-step. Done at once.
