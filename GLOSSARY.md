# ai-workflow

A personal, tracker- and VCS-agnostic kit of agent skills in `SKILL.md` format, published as a public repo. This glossary fixes the vocabulary the kit's skills, ADRs and docs use.

## Language

### The kit

**Harness**:
The coding agent that loads and runs skills, such as Claude Code, Codex or OpenCode.
_Avoid_: tool, agent, IDE, client

**Reference harness**:
The one harness the kit is tested on: Claude Code. Every other harness is supported only through the `SKILL.md` standard.
_Avoid_: primary tool, main agent

**Kit skill**:
A skill written or adapted for this kit, as opposed to a copy. Every skill in the kit, copies included, carries the `aw-` prefix.
_Avoid_: own skill, workflow skill

**Upstream**:
A third-party skill collection the kit copies from or draws on, pinned to a commit.
_Avoid_: source, origin, vendor

**Copy**:
An upstream skill shipped with its text unchanged except for the mechanical transform, with the upstream license inside its folder.
_Avoid_: vendored skill, fork, mirror

**Mechanical transform**:
The only edits a copy may carry. The first renames it with the `aw-` prefix. The second moves the shared upstream files it points to into its own folder and rewrites the paths to them. The third points its references to an upstream skill the kit replaces at the kit skill that replaces it.
_Avoid_: patch, local edit

**Replaced skill**:
An upstream skill the kit does not copy but replaces with a kit skill of its own, as `aw-review` replaces Pocock's `code-review`. The mechanical transform points a copy's references to it at the kit skill.
_Avoid_: mapped skill, substitute

**Adaptation**:
A kit skill whose text derives from one or more upstream skills.
_Avoid_: port, fork, merge

**Inspired skill**:
A kit skill that takes an idea from an upstream and none of its text.
_Avoid_: derivative

### Configuration

**Adapter**:
A per-repo file that translates canonical operations into one repo's actual tooling: `tracker.md`, `vcs.md` or `checks.md`.
_Avoid_: config, driver, integration

**Exempt adapter**:
A file whose change after the review `aw-ship` accepts without a new one: the tracker adapter, the VCS adapter, or the domain doc, which counts as an adapter for this rule alone. The checks adapter is never one.
_Avoid_: safe file, ignored adapter

**Canonical operation**:
One of the named, tool-independent actions a kit skill may request, such as `fetch-ticket`, `push` or `run-check`.
_Avoid_: command, action, verb

**Access level**:
Whether the agent performs a write operation itself (`write`) or leaves a draft for a person (`draft`).
_Avoid_: permission, mode, read-only

**Default access**:
The access level a tracker or VCS adapter declares for its write operations as a whole. Each row of its Operations table still states its own effective level.
_Avoid_: global level, base access, fallback

**Override**:
A write operation whose effective access level in an adapter's Operations table differs from that adapter's Default access.
_Avoid_: exception, per-operation setting, custom level

**Draft**:
The exact text or command of an operation the agent may not perform, left for a person to apply.
_Avoid_: proposal, suggestion, pending change

**Check level**:
One of three named scopes of automated checks: `fast`, `task` and `full`.
_Avoid_: check tier, test suite, gate

### Work and its record

**Tracker**:
Wherever a repo keeps its tickets: none, local markdown, or an external service.
_Avoid_: issue tracker, backlog, board

**Ticket**:
A transient unit of work that lives in the tracker. It may link to a spec, but it never holds one.
_Avoid_: issue, task, story, work item

**Spec**:
A durable document in the repo that states the intended behaviour of one change. It outlives the merge and is updated in the same change that alters the behaviour.
_Avoid_: PRD, plan, design doc, ticket

**Acceptance criterion**:
A numbered, verifiable statement in a spec, written `AC-n`.
_Avoid_: requirement, user story, AC (alone, without a number)

**Done-when criterion**:
One of the 1 to 3 observable statements `aw-intake` gives a fast-route task in place of a spec. Every phase on the fast route takes them as the definition of done, and `aw-build` writes them into its commit message as `Done when:` lines.
_Avoid_: acceptance criterion (on the fast route), exit criterion

**Evidence**:
The proof attached to an acceptance criterion, or on the fast route to a done-when criterion: a test, a verify journey, or a manual check with its reason.
_Avoid_: proof, coverage, validation

**Traceability**:
The section of a spec that maps every acceptance criterion to its evidence.
_Avoid_: coverage matrix, test plan

**Slice**:
A vertical piece of a spec that can be built and verified on its own and covers at least one acceptance criterion. Slices are listed in the spec's slice plan.
_Avoid_: task, step, subtask, ticket

**Tracer bullet**:
The shape of a slice: a narrow but complete path through every layer the change touches (data, logic, interface, tests), never one layer on its own. The slices of an expand–contract are the one exception.
_Avoid_: end-to-end slice, full-stack slice

**AFK**:
The mark that says an agent can build and verify a slice with no person involved.
_Avoid_: autonomous, agent-only

**HITL**:
The mark that says a slice needs a person during it: a judgement on a design or UI, credentials or an account only they have, or a check only they can make.
_Avoid_: manual slice, human task

**Expand–contract**:
The sequence of slices for a wide refactor, one mechanical change too wide for any vertical slice of it to land green: expand adds the new form beside the old, migrate moves the callers over in batches, and contract removes the old form once no caller is left.
_Avoid_: parallel change, phased migration

**Done marker**:
The checkbox that opens each slice in the slice plan: `[ ]` until `aw-build` builds the slice, `[x]` once it has. A slice is done when its marker is ticked.
_Avoid_: status line, done flag

**Test exception**:
The record, in a slice, that `aw-build` proves one of its criteria by verify or manual evidence instead of a test, because a test at the agreed seam would cost far more than it is worth. It carries its reason. On the fast route, which has no slices, it is a line of the commit message.
_Avoid_: skipped test, test waiver

**Mirror ticket**:
A ticket published from a slice so that the tracker can follow it. The slice stays the source of truth.
_Avoid_: sub-issue, child ticket

### The epic route

**Map**:
The one ticket in which `aw-wayfinder` charts an epic-route effort: its destination and notes in the body, and an index of its open decision tickets, the decisions made, the fog and what is out of scope, kept current by map updates. Its decision tickets are linked as part of it. It is an index, not a store: a decision lives only in its ticket.
_Avoid_: epic, roadmap, decision map

**Map update**:
A comment on the map that holds its whole current Tickets, Decisions so far, Not yet specified and Out of scope sections, and, once the map clears, its deliverables. The latest one is the map's current state, since the canonical operations cannot rewrite a ticket's body.
_Avoid_: map edit, status update

**Decision ticket**:
A ticket linked as part of a map that asks one question, sized to one session, whose answer is a decision, never a piece of the build. Its type is grilling, prototype, research or task, and it is HITL or AFK.
_Avoid_: wayfinder ticket, implementation ticket, slice

**Destination**:
What reaching the end of a map looks like: the deliverables, or the answer an investigation is after. It is named first and fixes the map's scope.
_Avoid_: goal, end state

**Fog**:
The in-scope questions a map can tell are coming but cannot yet state precisely, kept in its Not yet specified section. Resolving a ticket graduates whatever it makes specifiable into new decision tickets.
_Avoid_: backlog, unknowns, TBD

**Frontier**:
A map's open, unblocked, unclaimed decision tickets: the ones a session can take now. A session claims one by setting it to `in-progress` before any work on it.
_Avoid_: ready queue, next up

**Deliverable**:
A change that deserves its own spec, listed when a map clears. `aw-wayfinder` hands each one to `aw-spec`, which writes its spec and holds it for its own spec approval.
_Avoid_: epic child, sub-project, milestone

### The workflow

**Phase**:
A stage of the workflow, owned by exactly one kit skill and producing exactly one artifact.
_Avoid_: step, stage

**Phase-free skill**:
A skill that owns no phase. A phase may still call it, and may require it.
_Avoid_: standalone skill

**Optional skill**:
A phase-free skill that nothing obliges: no route, phase or gate requires it, and no ship or merge condition depends on it having run. It runs when a task calls for it or a person invokes it. It has no install switch and no `aw-setup` question.
_Avoid_: opt-in skill

**Route**:
The path a task takes through the phases, chosen at intake: fast, standard or epic.
_Avoid_: track, lane, mode, flow

**Pre-step**:
The action intake runs according to the task's type before any change: reproduce a bug, add characterization tests before a refactor, measure a performance baseline.
_Avoid_: prerequisite, setup step

**Human gate**:
A point where the work continues only after a person explicitly decides it should. The kit has one fixed gate: spec approval.
_Avoid_: checkpoint, approval step, sign-off

**Spec approval**:
The human gate where a person accepts a draft spec and its status becomes `approved`.
_Avoid_: sign-off, spec review

**Verify skill**:
A skill generated inside one repo that starts, drives and observes that repo's real app to gather evidence.
_Avoid_: e2e skill, test harness

**Feature map**:
The table in a verify skill that lists the features a user reaches in the app, each with its entry point, how to drive it and what to observe. `aw-verify` turns an acceptance criterion into a verify journey through it.
_Avoid_: route list, sitemap

**Citation**:
A `file:line` reference in a verify skill, with the text of that line quoted beside it and checked against the file.
_Avoid_: source link, reference (alone)

**Process identity**:
What a verify skill records for each process it starts: the process id with the process's command line or start time, so that it signals only that process.
_Avoid_: PID file, process handle

**Verify journey**:
The run that proves one acceptance criterion on the real app through the verify skill: set up its "given", perform its "when", and observe its "then". Called a journey for short in the verify skills.
_Avoid_: scenario, e2e test

**Smoke journey**:
The shortest run through a verify skill that proves the skill itself works: start the app, check it is healthy, drive one feature, observe it, clean up. `aw-create-verify` runs it once before finishing.
_Avoid_: smoke test, sanity check

**Verify result**:
What one verify journey found: passed, failed or inconclusive. `aw-verify` writes it to a file under the spec's `verify/` folder and names it, with the result, in Traceability. On the fast route, which has no spec, the file stays local under `.aw/verify/`.
_Avoid_: test result, verification status

**Review report**:
What `aw-review` produces: the findings of its Spec, Standards and Security axes side by side, each axis reviewed by its own subagent. It stays local and is never posted to the review host.
_Avoid_: code review, PR review, review comments

**Defect**:
A finding of `aw-review` or `aw-blast-radius` that a run made during it demonstrates, named with the command and its output. A finding no run demonstrates is a risk.
_Avoid_: bug, issue, blocker

**Risk**:
A finding of `aw-review` or `aw-blast-radius` that no run demonstrates, stated with its likelihood and its cost if it happens. Every code smell is a risk.
_Avoid_: concern, warning, nit

**Pre-existing finding**:
A defect the same run also shows at the merge-base, or a risk that rests on lines the change did not touch. `aw-review` and `aw-blast-radius` report it apart, since the change is not responsible for it.
_Avoid_: legacy issue, existing bug

**Review request**:
What `aw-ship` opens on the review host to propose merging the work branch: a pull request on GitHub, a merge request on GitLab. With no review host, it is the body alone, a local document the user reads. Its body holds a Summary, Evidence, Merge Danger, a pre-ship checklist and a rollback plan.
_Avoid_: PR (alone, outside GitHub), MR, merge proposal

**Merge Danger**:
The section of a review request body that says how hard the change is to walk back: a two-way door when reverting it restores the old behaviour, a one-way door when it does not, plus its blast radius.
_Avoid_: risk level, impact

**Blast radius**:
What a change can affect outside itself.
_Avoid_: impact, fallout

**Safety fact**:
The one fact that a risky-looking change is safe because of. `aw-blast-radius` looks for it and tries to prove it by running real code.
_Avoid_: key assumption, invariant

**Proof level**:
How far a safety fact has been proven, from a bare claim to a reproduction in the running app.
_Avoid_: ladder, rung (**Ladder** already names the rungs of a control)

**Rollback plan**:
The section of a review request body that says what signal would mean undoing the change, the exact steps to undo it without rewriting history, what the change does to data, and how long undoing it takes.
_Avoid_: revert plan, backout plan

**Retro report**:
What `aw-retro` produces: its candidates, each with its control, rung and demonstration, its architecture findings, and the error classes seen once. It stays local, under `.aw/retros/`, and a later retro counts its seen-once entries.
_Avoid_: retrospective notes, lessons learned

**Error class**:
A kind of mistake a session made, as opposed to one instance of it. `aw-retro` proposes a control for one only once it has happened twice, each occurrence traced to the session's record or to the seen-once list of an earlier retro report.
_Avoid_: bug type, recurring issue, pattern

**Control**:
What `aw-retro` adds to a repo's environment so that an error class cannot recur unnoticed, at one rung of the ladder.
_Avoid_: guardrail, safeguard, rule (alone)

**Ladder**:
The rungs a control can sit on, highest first: architecture, types, lint or check, behaviour test, docs. `aw-retro` picks the highest rung whose control covers the whole error class and passes its demonstration, and hands architecture to `aw-improve-codebase-architecture`.
_Avoid_: hierarchy of controls, escalation levels

**Demonstration**:
The two runs that prove a control: it fails on a real case, an occurrence from the session put back into the code, and passes on a correct case, the code as the session fixed it. An architecture finding states the demonstration its new structure must pass instead.
_Avoid_: proof of concept, validation, test run

### Testing the kit

**UAT case**:
One call to a kit skill that a person runs in a fresh session on a scratch app, with what it starts from, the answers and turns it needs as intents, and how its result is graded. The repo-local `/uat` skill holds them as one JSON file each.
_Avoid_: scenario, e2e test (**Verify journey** names a run on a repo's own app)

**UAT restore point**:
A saved state of the scratch app that a UAT case starts from: a commit, its branch, and the git-ignored `.aw/` folder. A step that passes leaves a new one.
_Avoid_: checkpoint (**Human gate** names a point where a person decides), snapshot

**UAT conductor**:
The session running `/uat`. It prepares each UAT case, reads the case session's log to show each question as it appears and propose an answer, and grades the step when the person says it is done.
_Avoid_: test runner, orchestrator
