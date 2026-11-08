# The configuration layer

How kit skills find a repo's configuration, what they may do with it, and what they do when there is none. This page is for whoever writes a phase skill; the decisions behind it are ADRs 0006, 0007 and 0013. A phase skill installed through `npx skills` cannot read this page or `aw-setup`'s files, so each one carries the parts it needs in its own text; a phase with a phase procedure carries them there.

## Finding the adapters

`/aw-setup` writes three adapters and the domain doc to `docs/agents/`, and an `## Agent skills` block that points to them, in `AGENTS.md`, or in `CLAUDE.md` (root or `.claude/`) when only that exists. A skill looks for the block in those files and follows its pointers. No skill names a `docs/agents/` file directly, except a skill that writes an adapter, which has to name the path it writes (ADR 0006). Two skills do: `aw-setup`, which writes the files below and first looks for earlier ones and for Pocock's `issue-tracker.md`, and `aw-wayfinder`, which offers a local-markdown tracker when the repo has none and writes it to `docs/agents/tracker.md` when no block points to a tracker adapter. Once written, an adapter is reached through the block like any other.

| Subsection | File | Holds |
| --- | --- | --- |
| `### Tracker` | `tracker.md` | Tracker kind, ticket key, ticket states, how each tracker operation is done, access |
| `### VCS` | `vcs.md` | Base branch, protected branches, branch naming, commit convention, review host, how each VCS operation is done, access |
| `### Checks` | `checks.md` | The command for each check level |
| `### Domain docs` | `domain.md` | Where the glossary and ADRs live |

The templates are in `skills/aw-setup/adapters/`. `node scripts/validate-kit.mjs` fails when one of them misses a canonical operation, names one outside the vocabulary, or gives one an impossible access level. It also fails when a file under `skills/` has a `## Never allowed` or `## Defaults when unconfigured` section whose text differs from this page's, which is the source. `aw-intake`, `aw-wayfinder`, `aw-spec`, `aw-slices`, `aw-build-steps`, `aw-create-verify`, `aw-verify-steps`, `aw-review-steps`, `aw-converge-steps`, `aw-implement`, `aw-ship` and `aw-retro` restate the defaults in such a section, and `aw-wayfinder`, `aw-build-steps`, `aw-create-verify`, `aw-verify-steps`, `aw-review-steps`, `aw-converge-steps`, `aw-implement`, `aw-ship` and `aw-retro` the never-allowed operations too. `aw-wayfinder` also carries a copy of the local-markdown tracker template, which the validator requires to match `aw-setup`'s.

## Canonical operations

A skill requests these by name and does what the adapter's Operations table says:

- **Tracker:** `fetch-ticket`, `query-tickets` (read); `publish-ticket`, `comment-ticket`, `set-status`, `link-tickets` (write). `set-status` moves a ticket between the states `open`, `in-progress` and `done`.
- **VCS:** `diff-base` (read); `start-branch`, `commit`, `push`, `open-review`, `merge` (write).
- **Checks:** `run-check <level>` (read), for `fast`, `task` and `full`.

## Access levels

- A read operation is always allowed.
- A write operation at `write` is performed by the agent.
- A write operation at `draft` is not performed. The agent writes the exact command or text to `.aw/drafts/<yyyymmdd-hhmmss>-<operation>.md`, tells the user the path, and goes on.
- `merge` at `write` is still conditional: only when `aw-review` found no proven defect and the `full` level passed (ADR 0013), and, for a change with a spec, the spec is `implemented` and passes the script-verified spec check.
- Some operations are never allowed, whatever an adapter says: see [Never allowed](#never-allowed).

## Never allowed

Whatever the access levels say, the agent never force-pushes (`--force`, `--force-with-lease`, a `+` refspec), never deletes a branch, local or remote, never pushes directly to a protected branch, and never passes `--no-verify`. These are not configurable.

## Defaults when unconfigured

When the block or an adapter is missing, a skill keeps going on these defaults and says once per session: "using defaults, run `/aw-setup`".

| Adapter | Default |
| --- | --- |
| Tracker | `none`: the task arrives as free text, reads find nothing, and every write leaves a draft. `aw-wayfinder`, which needs a tracker, offers to create a local-markdown one. |
| VCS | git. The base branch and diff base are the default branch (`git symbolic-ref refs/remotes/origin/HEAD`, else `main` or `master`), which is also the one protected branch. `start-branch` and `commit` are at `write`; `push`, `open-review` and `merge` are at `draft`. |
| Checks | No configured commands. A skill proposes commands from the project's manifest, runs them when it needs a level, and never reports a level as passed unless it ran it. |
| Domain | Single-context: `GLOSSARY.md` and `docs/adr/` at the root, read when present. |
