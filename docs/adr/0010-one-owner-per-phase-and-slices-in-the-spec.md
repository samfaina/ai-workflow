# One owner per phase; slices live in the spec

Each phase of the workflow is owned by exactly one kit skill and has exactly one artifact. Where upstreams overlap, the kit merges them into that one owner instead of shipping both:

| Phase owner | Draws on | Artifact |
| --- | --- | --- |
| `aw-intake` | Own: picks the task's type and route and runs the type's pre-step | Route and type, reported in chat |
| `aw-wayfinder` | Matt Pocock's `wayfinder` | Map and decision tickets in the tracker |
| `aw-spec` | Pocock's `to-spec`, with grilling first; living-spec format with `AC-n` and Traceability | The spec |
| `aw-slices` | Pocock's `to-tickets`: tracer bullets, blocking edges, expand–contract | The spec's slice plan |
| `aw-build` | Own: one slice per call, with `aw-tdd` | Commits and the spec's Traceability |
| `aw-verify` | pstack's evidence discipline (inspired) | `verify:` evidence in Traceability |
| `aw-review` | Pocock's `code-review`, plus a security axis and a proven-defects rule | Review report: Spec, Standards and Security |
| `aw-ship` | Pocock's `pr`, plus Addy Osmani's pre-ship checklist and rollback plan | Review request body and the spec set to `implemented` |
| `aw-retro` | Pocock's `retro`, plus a ladder of controls | Proposed controls |

On the fast route (ADR 0013) there is no spec, so three artifacts differ from the ones above. `aw-build` builds the whole task, not one slice per call, and its artifact is the commits alone, which carry the done-when criteria. `aw-verify` runs only when the repo has a verify skill, and its artifact is local result files under `.aw/verify/`, which it does not commit. `aw-ship` has no spec to set to `implemented`, so its artifact is the review request body alone.

A fix run of `aw-build` fixes the introduced defects of the latest review report in one commit and builds no slice. The phases stay apart: `aw-review` finds the defects, `aw-build` fixes them, and it never starts a review or a verify run itself. `aw-converge`, a phase-free skill with no artifact of its own, repeats those phases until the latest review report holds no introduced defect: it runs each through its phase procedure, so every phase keeps its one owner (ADR 0016).

Phase-free copies sit outside the table: `aw-grilling`, `aw-grill-with-docs`, `aw-domain-modeling`, `aw-research`, `aw-prototype`, `aw-tdd`, `aw-diagnosing-bugs`, `aw-codebase-design`, `aw-improve-codebase-architecture`, `aw-writing-for-agents`, `aw-handoff`, `aw-wizard`, `aw-to-questionnaire` and `aw-wait-what` (from Pocock), and `aw-source-driven-development` (from Addy Osmani). `aw-security-and-hardening` and `aw-observability-and-instrumentation`, phase-free adaptations of Addy Osmani's skills, sit outside it too, and so do `aw-unslop`, a phase-free adaptation of pstack's `unslop`, `aw-blast-radius`, a phase-free adaptation of pstack's `blast-radius`, and `aw-benchmark-checklist`, a phase-free adaptation of pstack's `benchmark-checklist`. `aw-retro` points to `aw-improve-codebase-architecture` when an error class is best fixed at the architecture rung of its ladder.

The slice plan lives in the spec. When the tracker allows it, `aw-slices` publishes each slice as a **mirror ticket**, and the slice remains the source of truth.

## Considered Options

- **Slices as tracker tickets** (`to-tickets`): rejected as the primary artifact. It would put the plan somewhere other than the spec, and repos without a tracker would have nowhere to keep it.
- **Keep `triage`**: rejected. It grooms incoming issues from other people by writing to the tracker, which a personal kit does not need. The bug pre-step in `aw-intake` already covers its reproduction step.
- **`implement-spec`'s parallel build** (a task graph, worktrees and a merger subagent): out of v1. `aw-build` does one slice per call, and building never triggers review: that phase belongs to `aw-review`.
