---
name: aw-intake
description: "Start a task in the aw- workflow: take a ticket or free text, classify its type and route with reasons, run the type's pre-step, and name the next skill. Run first on every task."
disable-model-invocation: true
---

# Intake

Turn a task into a **type**, a **route** and the evidence its pre-step produces, then name the skill to run next. Intake reports in chat and changes no code: the only files it may add are the pre-step's tests and notes under `.aw/`.

## Configuration

Find the repo's `## Agent skills` block: look in `AGENTS.md`, then `CLAUDE.md`, then `.claude/CLAUDE.md`, and follow its pointers to the tracker, VCS and checks adapters and the domain doc. Use each operation the way the adapter's Operations table says, at its access level: a write at `draft` is not performed; write its exact command or text to `.aw/drafts/<yyyymmdd-hhmmss>-<operation>.md` and tell the user the path. Where the block or an adapter is missing, use the defaults below.

## Defaults when unconfigured

When the block or an adapter is missing, a skill keeps going on these defaults and says once per session: "using defaults, run `/aw-setup`".

| Adapter | Default |
| --- | --- |
| Tracker | `none`: the task arrives as free text, reads find nothing, and every write leaves a draft. `aw-wayfinder`, which needs a tracker, offers to create a local-markdown one. |
| VCS | git. The base branch and diff base are the default branch (`git symbolic-ref refs/remotes/origin/HEAD`, else `main` or `master`), which is also the one protected branch. `start-branch` and `commit` are at `write`; `push`, `open-review` and `merge` are at `draft`. |
| Checks | No configured commands. A skill proposes commands from the project's manifest, runs them when it needs a level, and never reports a level as passed unless it ran it. |
| Domain | Single-context: `GLOSSARY.md` and `docs/adr/` at the root, read when present. |

## Steps

### 1. Take the task

- **A ticket key or URL**, with a tracker configured: `fetch-ticket` it and work from its title, body and comments. Keep the key; `aw-spec` records it.
- **Free text**, or a ticket key while the tracker is `none`: the user's words are the task. When they point to a ticket you cannot read, ask them to paste it.

Done when you can state the task in one or two sentences the user agrees with. Ask one question at a time until you can.

### 2. Explore

Read the glossary and the ADRs the domain doc points to, when present, and the code the task touches: its entry points, its tests, and the callers of what it changes. Use the glossary's terms from here on.

Done when you can name the modules the task changes and whether it changes a contract, data or security (step 3).

### 3. Classify

**Type**, one of:

- **feature**: new behaviour.
- **bug**: behaviour that differs from what was intended.
- **refactor**: a change in structure with no change in behaviour.
- **performance**: the same behaviour, faster or using less.
- **investigation**: a question to answer; nothing changes.

**Route**, one of:

- **fast**: fits in one session and changes no contract (a public API, schema, file format, CLI flag or event), no stored data and nothing security-related (authentication, permissions, secrets, input from outside, a new external service integration, CORS, rate limiting or throttling, adding a dependency, or how personal data is collected, handled or shared).
- **standard**: everything else.
- **epic**: several sessions or several deliverables, each of which deserves its own spec.

Upgrading an existing dependency does not, on its own, keep a task off the fast route, major versions included: an upgrade that changes a contract is already kept off it by the contract rule. A fast-route diff still goes through `aw-review`'s Security axis, so a dependency upgrade can classify as fast and still get Security findings.

An investigation changes nothing, so it never needs a spec: it takes the fast route, or the epic route when answering it spans several sessions. When two routes fit, pick the longer one: epic over standard, standard over fast. Give a reason for the type and one for the route, each naming what in the task or the code decided it. The user may choose another route; record their choice and their reason.

Done when the type and route are stated, each with its reason.

### 4. Run the pre-step

Run the type's pre-step before any change, as [`PRE-STEPS.md`](PRE-STEPS.md) describes for that type:

- **bug**: reproduce it with `aw-diagnosing-bugs`.
- **refactor**: add characterization tests that pin the current behaviour.
- **performance**: measure a baseline.
- **investigation**: answer the question, citing code, or hand it to `aw-research`. An investigation changes nothing.
- **feature**: no pre-step.

When the pre-step changes what step 3 rested on, classify again: a bug that cannot be reproduced goes on the standard route or longer, and an investigation that turns out to span several sessions goes on the epic route, with its pre-step left to `/aw-wayfinder`.

Done when the type's section of `PRE-STEPS.md` says it is.

### 5. Report

Report in chat, in this shape:

```markdown
**Task:** <one or two sentences; the ticket key when there is one>
**Type:** <type>, because <reason>
**Route:** <route>, because <reason>
**Pre-step:** <what ran and what it showed: the reproduction command, the characterization tests and their result, the baseline numbers, or "none">
**Done when:** <fast route, except an investigation: 1 to 3 criteria>
**Next:** <the skill to run>
```

The fast route has no spec, so for every type but investigation, state 1 to 3 **done when** criteria: each one observable, so that `aw-build` can prove it and `aw-review` can judge against it. They are the task's definition of done for every phase after this one: `aw-build` builds until each holds, `aw-verify` proves them on the real app when a verify skill exists, `aw-review` judges the Spec axis against them, and `aw-ship` shows what proves each. When a criterion can only be met by a change step 3 keeps off the fast route, classify the task again as standard.

**Next**, by route:

- **fast**: `/aw-build`, which works from the done-when criteria with no spec, or `/aw-implement`, which runs the build, `/aw-verify` and `/aw-review` in one call; by hand, `/aw-verify` only when the repo has a verify skill at `.claude/skills/verify-*/`, `/aw-review` and `/aw-ship`, each naming the next. For an investigation, see below.
- **standard**: `/aw-spec`.
- **epic**: `/aw-wayfinder`, which charts the deliverables; each one then goes to `/aw-spec`.
- **investigation**: on the fast route, none, unless the answer shows work to do; then `/aw-intake` again with that work as the task. On the epic route, `/aw-wayfinder`, which charts the questions.

Tell the user to run the next skill; this skill never runs it. Done when the report has every line that applies to the route.
