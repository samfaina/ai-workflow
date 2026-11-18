---
name: aw-setup
description: "Configure this repo for the aw- workflow skills: the tracker, VCS, checks and domain adapters, the Agent skills pointer block, and repo housekeeping. Run once per repo, and again to change the configuration."
disable-model-invocation: true
---

# Setup

Write the per-repo configuration the kit's skills read:

- **Adapters** in `docs/agents/`: `tracker.md`, `vcs.md` and `checks.md`, each translating the kit's canonical operations into this repo's tooling and setting the access level of each write operation, plus the domain doc, `domain.md`, which says where the glossary and ADRs live.
- **The pointer block**: an `## Agent skills` section in `AGENTS.md`, or in `CLAUDE.md` when only that exists, through which every skill finds the adapters.
- **Housekeeping**: `.aw/` in `.gitignore`, the `permissions.deny` offer, the Node warning and the Pocock check.

This is an interview, not a script. Explore, propose, confirm, then write. Re-running it updates what exists in place.

## Vocabulary

The canonical operations are a closed vocabulary. Every adapter template in [`adapters/`](adapters/) has an Operations table stating how each one is done and its access level:

- **Tracker:** `fetch-ticket`, `query-tickets` (read); `publish-ticket`, `comment-ticket`, `set-status`, `link-tickets` (write).
- **VCS:** `diff-base` (read); `start-branch`, `commit`, `push`, `open-review`, `merge` (write).
- **Checks:** `run-check <level>` (read), for the levels `fast`, `task` and `full`.

**Access levels.** A read operation is always allowed and is marked `read`. A write operation is at `write`, where the agent performs it, or `draft`, where the agent writes the exact command or text to `.aw/drafts/` and a person applies it. Each tracker and VCS adapter has a **Default access** line set to `write` or `draft`, and its Access column holds each operation's effective level; a row that differs from the default is an override. The operations in the `## Never allowed` section of each VCS template in [`adapters/`](adapters/) are never allowed, and no level or override changes that.

## Steps

### 1. Explore

Read what exists; assume nothing:

- `git remote -v`: the host (GitHub, GitLab, other, or no remote).
- `git symbolic-ref refs/remotes/origin/HEAD`, or the local branches: the default branch.
- `git branch -a` and `git log --oneline -30`: the branch naming and commit convention in use.
- `AGENTS.md`, `CLAUDE.md` and `.claude/CLAUDE.md`: which exist, and whether one already holds an `## Agent skills` block.
- `docs/agents/`: adapters from an earlier run of this skill (`tracker.md`, `vcs.md`, `checks.md`, `domain.md`), or Matt Pocock's setup output (`issue-tracker.md`), which hints at the tracker.
- The project manifests and CI config: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle*`, `Makefile`, `justfile`, `.github/workflows/`, `.gitlab-ci.yml`.
- `GLOSSARY.md`, `GLOSSARY-MAP.md`, `docs/adr/`, `docs/specs/`.
- The housekeeping state, as listed in [`HOUSEKEEPING.md`](HOUSEKEEPING.md).

Done when you can propose a value for every section in step 2 from what you read.

### 2. Interview

Take the sections in order, one answer each. Lead each with the recommended answer so the user can accept it in a word. When an adapter already exists, its current values are the recommendation, so a re-run changes only what the user changes.

**A. Tracker.** Where tickets live. Propose GitHub when a remote points at GitHub, GitLab when one points at GitLab, and otherwise none. Offer:

- **None**: no tracker; tasks arrive as free text. Template [`tracker-none.md`](adapters/tracker-none.md).
- **Local markdown**: one file per ticket in a tickets folder of its own, `docs/tickets/` unless the user names another, outside `docs/specs/` so that tickets and specs stay apart. Template [`tracker-local.md`](adapters/tracker-local.md).
- **GitHub**, through `gh`. Template [`tracker-github.md`](adapters/tracker-github.md).
- **GitLab**, through `glab`. Template [`tracker-gitlab.md`](adapters/tracker-gitlab.md).
- **Other** (Jira, Linear, …): ask the user to describe, in a short paragraph, how they fetch, list, create, comment on, move and link tickets. Template [`tracker-other.md`](adapters/tracker-other.md), filled with their prose.

Then the tracker's access: recommend `write` for local markdown, GitHub and GitLab, `draft` for other until its commands are proven, and `draft` for none, where every write leaves a draft. Ask for per-operation overrides only if the user wants any.

A GitHub or GitLab tracker needs the repo reachable: `gh repo view` or `glab repo view` prints the project from this directory. If it does not, tell the user what is missing and record the tracker anyway.

**B. VCS.** Propose each value from what step 1 found:

- **Base branch**, which is also the diff base: the default branch.
- **Protected branches**: the base branch, plus any the user names.
- **Branch naming**: the pattern recent branches follow, or `<type>/<slug>`.
- **Commit convention**: Conventional Commits when the log follows it, otherwise what the log shows.
- **Review host**: pull requests on GitHub (template [`vcs-github.md`](adapters/vcs-github.md)), merge requests on GitLab ([`vcs-gitlab.md`](adapters/vcs-gitlab.md)), or none ([`vcs-none.md`](adapters/vcs-none.md)). The review host is independent of the tracker: Linear tickets with GitHub pull requests is a normal pairing.
- **Merge method**, for a review host: what the host's settings or the log show (merge, squash or rebase).
- **Access**: default `write`, with `push`, `open-review` and `merge` at `draft`. That matches the defaults of an unconfigured repo; offer it as the recommendation and record any change the user makes. `merge` at `write` stays conditional: the agent merges only when `aw-review` found no proven defect and the `full` level passed.

**C. Checks.** Propose a command for each level from the manifests and CI config:

- `fast`: seconds; lint, format check, typecheck.
- `task`: what proves one slice, usually `fast` plus the tests the slice touches, with a `<files>` placeholder for them.
- `full`: everything CI runs.

Show the proposed commands and where each came from, and let the user confirm or edit each one. A level with no command is recorded as `none`; it is reported as not run, never as passed. Template [`checks.md`](adapters/checks.md).

**D. Domain docs.** Single-context (one `GLOSSARY.md` and `docs/adr/` at the root) unless step 1 found a `GLOSSARY-MAP.md` or monorepo signals (a `pnpm-workspace.yaml`, a `workspaces` field, a populated `packages/*`); then confirm which layout. Then where the glossary and ADRs live: propose the paths step 1 found, or `GLOSSARY.md` and `docs/adr/` when there are none yet. Template [`domain.md`](adapters/domain.md); when the paths differ from the template's, write the repo's paths in its place.

Done when every section has an answer.

### 3. Confirm

Show the user the whole set you will write, before you ask them to confirm:

- the `## Agent skills` block (step 4), with the file it goes into;
- the three adapters and the domain doc in full, as they will be written, each with its path, or, on a re-run, only the lines that change, as a diff with the file's path;
- the housekeeping changes from [`HOUSEKEEPING.md`](HOUSEKEEPING.md).

Put it in your chat text or in the confirmation question's preview. Output inside a tool call does not count. Then ask. Let them edit, and show each edit the same way before they confirm. Write nothing until they confirm, and once they do, step 4 writes the approved set. Done when the user approves the set.

### 4. Write

**The adapters.** Write each one to `docs/agents/<kind>.md`:

- **New adapter**: copy the chosen template, replace every `{{placeholder}}` with the interview's value, and set the Default access line and the Access column. A `<placeholder>`, such as `<n>` or `<branch>`, stays as it is: it is an argument the skill running the operation fills in. Drop the template's opening note.
- **Existing adapter of the same kind** (same tracker, same review host): edit its values in place: the header lines, the Default access line, the Access cells, the Levels commands. Keep any notes the user added by hand.
- **Existing adapter of another kind** (GitHub to GitLab, say): replace it from the new template, carrying over the access overrides that still apply.

A template's Operations table keeps every row: an adapter that cannot perform an operation says so in the How cell.

**The pointer block.** Choose the file:

- If `AGENTS.md`, `CLAUDE.md` or `.claude/CLAUDE.md` already holds an `## Agent skills` block, update that one.
- Else if `AGENTS.md` exists, add the block to it.
- Else if a `CLAUDE.md` exists (at the root or in `.claude/`), add it there.
- Else create `AGENTS.md` with the block.

Never create a second block. Updating a block means rewriting the kit's four subsections below with the new values, in place, in this order and at the top of the block. Subsections the kit does not own, such as `### Issue tracker` or `### Triage labels` from Matt Pocock's setup, follow them unchanged: his skills read them while his plugin is on, and the kit's skills read only the kit's four. When the user turns his plugin off for this repo, offer to remove his subsections. The rest of the file is never touched.

```markdown
## Agent skills

### Tracker

[One line: the tracker kind and where tickets live, e.g. "GitHub Issues in owner/repo, through `gh`".] See `docs/agents/tracker.md`.

### VCS

[One line: base branch, review host, and the operations left at `draft`.] See `docs/agents/vcs.md`.

### Checks

[One line: the `fast`, `task` and `full` commands, or which are `none`.] See `docs/agents/checks.md`.

### Domain docs

[One line: "single-context" or "multi-context".] See `docs/agents/domain.md`.
```

**Housekeeping.** Apply what the user accepted, as [`HOUSEKEEPING.md`](HOUSEKEEPING.md) describes.

Done when the three adapters, the domain doc, the block and the accepted housekeeping changes are written, and a second read of each file shows no `{{` left in an adapter, one `## Agent skills` block, one `.aw/` ignore line and no repeated deny entry or `enabledPlugins` key.

### 5. Report

Tell the user what was written and what changed, and any warning from housekeeping (Node missing, Pocock's plugin left on). Say they can edit `docs/agents/*.md` by hand or re-run `/aw-setup` at any time. Then name the next skill: `/aw-intake`, to start a task. Done when the report lists every file written or changed and every warning.

## Credits

Adapted from Matt Pocock's `setup-matt-pocock-skills` (MIT), as listed in the kit's `NOTICE.md`. The `domain.md` template is his file with the copied skills' names given the `aw-` prefix.
