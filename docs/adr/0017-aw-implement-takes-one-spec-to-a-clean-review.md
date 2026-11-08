# `aw-implement` takes one spec to a clean review

`aw-implement` is a phase-free, user-invoked skill: one call builds what is left of an approved spec or a fast-route task, verifies it, reviews it, and starts a convergence run when that review holds an introduced defect. It never ships. Its unit is the spec, because a spec is one change and one review request: `aw-verify` refuses while a slice is not done, and `aw-ship` needs the spec `implemented` with evidence for every criterion. A task that gets its own review request is a deliverable with its own spec, on the epic route when there are several. A slice is a step inside that one review request.

**The rounds get one owner.** `aw-converge` is user-invoked, so `aw-implement` cannot call it (ADR 0012). Its rounds move to a convergence procedure, `aw-converge-steps`, which the model can call and the `/` menu does not show, and `aw-converge` stays as its door. This widens ADR 0016: a phase procedure may be called by its door, the convergence procedure and `aw-implement`. The convergence procedure may be called by its door and `aw-implement`. `validate-kit` enforces both lists.

**Where each step runs.** An AFK slice runs in a subagent of its own, in series, and the main session takes its report and none of its reasoning. A HITL slice runs in the main session, because the need for a person arises in the middle of the slice and a subagent cannot ask. Verify runs in a subagent and the review in the main session, as in a round. Agreeing a seam is the one question that interrupts an AFK slice, with the mechanism of ADR 0016: the subagent returns the question, the main session asks it and starts the subagent again with the answer.

**What survives compaction.** Position is never remembered: it comes from the done markers, the commits and the review reports. What exists only in the conversation goes in a journal, `.aw/implement/<slug>.md`: the agreed seams, the `Spec change:` lines, the round count, the progress lines and, on the fast route, intake's report. Only `aw-implement` reads it, and the main session reads it again before each step. Each call opens its own heading and the round count looks only at the latest, so a new call starts a new count. A journal that names another work branch is replaced. Nothing cleans it up, as with the rest of `.aw/`. Because the harness keeps only the first 5,000 tokens of each skill after compaction, `validate-kit` fails when `aw-implement`, `aw-converge-steps` or `aw-review-steps`, the skills that live in the main session, exceed 20,000 characters.

## Considered Options

- **One slice per call, with a review request per slice**: rejected. It needs a verify and a review over a subset of the criteria, and `aw-ship` opening a review request with the spec not yet `implemented`. Teams that want smaller review requests cut smaller deliverables.
- **One slice per call on one branch, with one review request at the end**: rejected. It keeps the manual repetition this command removes, and pays for a full review per slice.
- **Removing `disable-model-invocation` from `aw-converge`**: rejected. The model could start by its own choice a run that makes commits.
- **A loop of its own in `aw-implement`**: rejected. The rules of a round would live in two skills.
- **Stopping before a HITL slice and asking the user to run `/aw-build`**: rejected. The stop reclaims the person at the same moment and adds two commands.
- **A HITL slice in a subagent resumed through `SendMessage`**: rejected. It works only on the reference harness, and would keep two paths for a risk measured as small: a slice's steps fit inside the part of `aw-build-steps` that survives compaction.

## Consequences

- Slices of one spec share a work branch and a review request, so the kit does not support giving the slices of one spec to different people. Mirror tickets can suggest otherwise.
- Nothing limits how many slices a spec holds. A badly cut spec still means a long wait for a review request.
