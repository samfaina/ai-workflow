# Which UAT cases are due comes from a committed ledger, and batches are derived from it

UAT batches used to be written by hand as tracker issues, and only those issues said what had run. Nothing noticed when a case was added or changed after its batch had run: #120 and #126 exist because of that. By the time 71 cases existed, 42 of them sat in no batch at all.

**The UAT ledger is the source of truth.** It is a committed file beside `/uat`, with one entry per UAT case: a fingerprint of the case, its verdict, the kit commit it ran on, the date and the issue that reports it. It holds no paths, since the scratch app's clone and the run folder stay out of the repo. The fingerprint covers the case file and the fixtures its `setup` copies, taken as they stand when the run ends, so the drift answers that run adds do not make the case due again. `run.mjs report` writes the ledger for every case in the run, and the person commits it together with the drift. Committing it is the review: no Pass reaches the ledger unreviewed, whoever graded it.

**A case is due** when the ledger holds no passing run for what the case holds now: the case is new, it changed, or a case it starts from (`from.case` or `continues`) is due. A change to a kit skill alone makes no case due. Instead, a release needs every case to have passed since the previous release tag, across as many batches as that takes. Cases that run only with a person are included. `run.mjs due --release` exits with an error while any case is missing that pass, and the README's release section names it as a step.

**Batches are derived, never declared.** `run.mjs due` groups the due cases with the cases they start from into independent batches. Each batch runs in a run folder of its own. A due case whose chain is too long to rerun is given a `from.ref` start by whoever writes it. The "UAT batch N" issue is opened from that output, and records why the batch exists and what it found.

## Considered Options

- **Batches as hand-written issues (the status quo)**: rejected. This is what let #120 and #126 slip through.
- **A `batch` field in each case**: rejected. It is a second list to keep in step with the dependency chains, and it says nothing about whether a case has run.
- **A test that fails while any case is due**: rejected. Every pull request that adds or changes a case would stay red until a run happened. The gate sits at the release instead.
- **A skill change makes due every case whose command calls that skill**: rejected. It misses skills called inside other skills, and frequent skill changes would keep most cases due between releases. The pass before a release covers skill changes.
- **Durable restore points instead of rerunning a chain**: rejected. A frozen point hides changes to the skills that produced it, and `clean` deletes restore points.
- **One run of every case at the release commit**: rejected. A run goes one batch at a time to stay within the plan's quota.

## Consequences

- A skill change can wait until the next release for its UAT. A ticket that wants it sooner opens a batch by hand.
- Each run leaves a ledger change to commit, as drift already does.
- The first ledger is seeded once from the results the batch issues already report. A pass counts only while the case's fingerprint still matches the case today. Every other case starts due.
