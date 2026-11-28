# The UAT board is a page `run.mjs` serves, and the UAT queue runs from the Task Scheduler in a worktree of its own

Running UAT meant reading `run.mjs status`, picking a batch, building its `auto` command by hand with a run folder, `--source` and `--cases`, and then watching a terminal. One batch went per sitting, while the plan's quota sat unused every night. Orca, the app the maintainer works in, offers scheduled automations, bots and plugin panels, so it was the obvious place to build both the view and the nightly runs.

**The UAT board is a mode of `run.mjs`.** `run.mjs board` serves a local page, in dependency-free Node as ADR 0008 asks. It reuses what `due` and `status` already derive, and it reads each run folder's `state.json` and `results/` for the runs under way. From it the person starts one batch as an unattended run, at a ref they choose (`main` by default), or starts the UAT queue, or copies any batch's `/uat` line to conduct it instead. The board is started on demand. It can be opened in any browser, Orca's included.

**The UAT queue is a mode of `run.mjs` that the Windows Task Scheduler starts.** It runs the due batches in the order `status` gives, one at a time, each in a run folder of its own. It runs from a worktree of its own checked out at `origin/main`, so it never tests the person's work in progress. It never depends on the board. It starts no case after its cut-off hour (06:00 at the latest) when it was scheduled. Started from the board, it has no cut-off and can be told to stop after the current case. A batch it cut short resumes the next time.

**`main` gates the queue.** The queue does not start while any unattended run is going on, nor while an unreviewed run exists, meaning a run whose ledger change has not reached `main`. It passes over a batch whose last run did not pass until the person retries it on the board or the case's fingerprint changes. A failure is usually fixed in a skill, which the fingerprint does not cover, so the fingerprint alone would block that batch for good. The queue never writes to the tracker.

**One night is reviewed in one pull request.** Every run writes the same `ledger.json`, so the night's unreviewed runs are committed together in the queue's worktree. That pull request links or closes each batch's "UAT batch N" issue. Before the review, the board sorts the cases deterministically. It shows first a case that did not pass, added drift, was reset, or has a `judge` criterion without cited evidence. It folds away a pass whose assertions all passed and that added no drift. Each step of the morning, from opening the issues and running `report --issue` to the commit, the push and the pull request, is a button that shows its exact command before it runs. Merging stays the review, as ADR 0018 sets.

## Considered Options

- **An Orca `worker-panel` plugin for the board**: rejected. Its worker can read files and open terminals, but the plugin is TypeScript against Orca's plugin API, is tied to Orca's version, and needs a new `--approve` whenever its access changes. A page served by `run.mjs` is tested with the rest of the script.
- **An Orca automation for the nightly runs**: rejected. Every automation starts an agent session on the same Claude account only to launch a command. Orca stops watching a run after 6 hours, and a queue that waits for the five-hour window resets runs longer than that. Nothing fires while Orca is closed. The Task Scheduler runs the command itself, has no such limit, and can wake the machine.
- **An Orca bot**: rejected. A bot adds memory, connectors and event triggers, and none of them is needed to start a command at a fixed hour.
- **The queue running from the main checkout**: rejected. It would test whatever branch or uncommitted change was checked out that night.
- **One pull request per batch**: rejected. Every one would conflict on `ledger.json`.
- **An agent that pre-screens the grades**: deferred. It would be a second judge beside the UAT driver's, with a verdict of its own to review. The deterministic order comes first, and an auditing agent can be added if it falls short.
- **Retrying a failed batch whenever `main` moves**: rejected. It spends quota on failures nobody has tried to fix.

## Consequences

- The UAT queue runs nothing while a pull request from an earlier night is open, so an unmerged review stops the nightly runs.
- `UAT_GH_TOKEN`, `UAT_MAX_FIVE_HOUR` and `UAT_MAX_WEEKLY` live in the user's environment, so a scheduled run can read them. The token never goes into a file in the repo.
- The scheduled task is created by hand once, with the `schtasks` line the `/uat` skill documents. The machine has to be on, or able to wake, at its hour.
- A pass on a ref other than `main` reaches the ledger only through the same review, and the board names its ref there.
