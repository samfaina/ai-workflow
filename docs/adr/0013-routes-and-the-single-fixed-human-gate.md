# Three routes; spec approval is the only fixed human gate

`aw-intake` sends every task down one of three routes. When in doubt, it picks the longer one.

| Route | When | Phases |
| --- | --- | --- |
| Fast | Fits in one session; no change to contracts, data or security; no spec contradiction | `aw-intake` (states 1 to 3 "done when" criteria), pre-step, `aw-build` with no spec, `aw-review`, `aw-ship`. `aw-verify` runs only if a verify skill exists |
| Standard | Everything else | `aw-intake`, `aw-spec`, **spec approval**, `aw-slices`, `aw-build` once per slice, `aw-verify`, `aw-review`, `aw-ship`, and optionally `aw-retro` |
| Epic | Several sessions or deliverables | `aw-intake`, `aw-wayfinder`, then the standard route for each deliverable, with its own spec |

**Spec approval** is the one fixed human gate. It is what makes writing the spec first worth it, because it catches a misunderstanding before it costs code. It stays light: the person approves explicitly in the conversation, and only then does the agent set `status: approved`. The fast route has no spec, so it has no gate.

A **spec contradiction**, a task that asks for behaviour other than what an `approved` or `implemented` spec states as intended, is a feature even when it is reported as a bug, and takes the standard route: the spec changes through `aw-spec`, back to `draft` and through spec approval again. `aw-intake` looks for one while classifying, in the specs whose Traceability points at what the task touches. When one only shows during a fast-route build, `aw-build` stops without a commit and sends the task back to `aw-intake`. A fast-route change may still edit a spec's Traceability, and only that section, to keep its evidence pointing at the right files: that is evidence, not intended behaviour, so there is nothing to approve.

Accepting the change is not a fixed gate. `merge` is a canonical VCS operation at `draft` by default, so a person merges. With `merge: write`, `aw-ship` merges only when `aw-review` found no proven defect and `run-check full` passed; with no review host, it merges locally into the base branch. `aw-ship` runs `run-check full` itself. A change with a spec merges only once the spec is `implemented` and passes the script-verified spec check, which fails on a `(failed)` verify result and on an `(inconclusive)` one with no `test:` or `manual:` evidence beside it.

## Considered Options

- **Two fixed gates: spec approval and human PR review**: rejected. Mandatory human PR review came from an earlier corporate setting where every PR was reviewed by hand. A personal kit should allow autonomy once the spec is approved and the evidence is in.
- **No gates at all**, with spec approval implied once grilling ends: rejected for the reason above.
- **A spec contradiction stays on the fast route, and `aw-ship` records the spec it contradicts as an accepted risk** (#111): rejected. It leaves a spec in the repo that states behaviour the code no longer has, though a spec is updated in the same change that alters the behaviour (ADR 0003), and it changes intended behaviour without spec approval.
- **Only `aw-intake` catches a spec contradiction**: rejected. Intake may not see it until the build, as in the #55 fast-route UAT run, where the fix itself contradicted an `implemented` spec.
