# UAT case files

One JSON file per **UAT case** in `cases/`, named `<id>.json`. `tests/uat-cases.test.mjs` checks them.

| Field | Meaning |
| --- | --- |
| `id`, `title`, `group` | The file's name, its name in the summary, and the summary heading it sits under. |
| `order` | Position in a full run. |
| `source` | The line of the #49 results it reproduces, or why it exists. |
| `from` | The restore point: `{ "case": "<id>" }` for an earlier case's, or `{ "ref": "<ref or commit of the source repo>" }`, with `branch` and `base` when it is not on `main`. Absent when `continues` is set. |
| `continues` | The id of the earlier case whose session this one continues. It reuses that working copy and restores nothing. |
| `setup` | Done by `next` after restoring, in order. See below. |
| `shell` | What the person runs in a terminal before starting Claude Code, written for PowerShell. `run.mjs auto` runs the lines in one PowerShell session in the working copy, and starts the case session in the environment they leave. |
| `cleanup` | Optional. Shell lines like `shell`, which `run.mjs auto` runs in the working copy once the step is graded, whether it passed or not, so that the case leaves the scratch repo as later runs expect. `{{STARTED}}` becomes the step's start time, in UTC to the second (`2026-01-31T09:00:00Z`), so that a line can find what the step created. A cleanup closes what the step created and never deletes it, so the evidence stays. A cleanup that fails stops the run, with the step's result recorded. |
| `command` | What the person types in Claude Code. `{{RUN}}` becomes the run folder. |
| `answers` | `{ "when", "intent", "reason" }` for each question the agent may ask. `drift: true` marks one added during a run. |
| `turns` | `{ "intent", "reason", "assertions"? }` for each follow-up message, in order. |
| `assertions` | Checked by `check` at the end of the step. |
| `assisted` | Optional. A non-empty string giving the reason the case only runs with a person, such as checks that depend on what the terminal shows. It makes the case an **Assisted UAT case**, which `run.mjs auto` skips with that reason, so it stays due. |

A case's fingerprint in the **UAT ledger** covers what its file parses to, except `order`, and every fixture its `setup` copies, so changing any other field, or a fixture it copies, changes it. Only the parsed content counts, not the file's formatting: indentation, whitespace and line endings do not count, and neither does `order`, which inserting a case renumbers in every later one. Reordering keys or the items of an array still counts.

`run.mjs due` lists every **Due UAT case** with its reason: `new`, `changed`, `upstream-due` (a case it starts from through `from.case` or `continues` is due) or `not-passed`, and with `--release` also `before-release` (below). It groups them into **UAT batches**, each holding its due cases and the cases they start from, with a `--cases` list in `order`. Assisted cases are never in a batch: they are listed apart, grouped the same way, each with its reason. A case that starts from an assisted case goes with it, since no batch can hold the case it needs. Such a group can run again a case that a batch also runs.

`run.mjs due --release` is the release gate. It also counts as due, with the reason `before-release`, every case whose last pass is dated before the most recently dated `vX.Y.Z` tag of the repo that holds the cases, and exits with code 3 while it lists any case, assisted cases included. With no such tag, it lists what plain `due` lists. It compares dates, not commit ancestry, so a squash merge does not hide a pass.

Write answers and turns as **intents**: what the person means, never an option's label, since labels change between runs. The `reason` says what the case tests with that answer, so an agent can adapt it to a question worded differently.

## Setup operations

`{ "write": path, "text": ... }` · `{ "copy": path under this skill, "to": path }` · `{ "replace": path, "pattern": regex, "with": text }` · `{ "delete": path }`, a file or a whole folder, which must exist · `{ "commit": message }` · `{ "remote": url }`, which points `origin` at another URL. `write` and `copy` expand `{{SHORT}}` and `{{BRANCH}}`, so a fixture review report can cover `HEAD`: a report written before a `commit` names the commit before it.

A case at `write` access uses `fixtures/vcs-local-write.md` instead of a review host, because `origin` is a local repo. The one exception, `aw-ship-merge-review-host`, merges through GitHub: it points `origin` at the scratch repo, uses `fixtures/vcs-github-write.md`, and merges into a base branch of its own, which its `shell` resets before each run. The ship cases write their review report from `fixtures/` so that each one tests the ship guard alone, whatever the previous review found.

## GitHub in an unattended run

A case can write to GitHub in an unattended run, but only on the scratch repo: the GitHub repo the source clone's remote names, `origin` first.

- **The token is the guarantee.** Each step's shell lines, case session and cleanup get `GH_TOKEN` from the driver's own variable, `UAT_GH_TOKEN`, and none of the maintainer's credentials: no other token, an empty gh config, and git's credential helpers reset through the environment, so that git authenticates to github.com with that token alone, SSH URLs included. `UAT_GH_TOKEN` holds a fine-grained token whose only repository is the scratch repo, with these repository permissions: contents, issues and pull requests read and write, metadata read, and no administration. The maintainer creates it once, by hand, and keeps it out of the repo.
- **`auto` refuses to start without it** while the batch holds a case that runs `gh` or reaches GitHub: one whose `shell` or `cleanup` lines or `run` assertions run `gh` or name github.com, or whose setup, or that of a case it continues, points `origin` there. It names those cases.
- **The permission host filters, best effort.** It allows `gh` reads, and denies a `gh` write, or a `git push`, `fetch` or `pull`, aimed at a repo other than the scratch repo or a repo in the step folder, such as the local `origin` a case starts with. Each decision goes to `permissions.jsonl` in the step folder. It sees only what would prompt: a command that an allow rule in the settings the session loads already permits never reaches it.
- **A denial is graded** by [GRADING.md](GRADING.md): the grading call sees the host's log, and the log of the hook that answers the agent's questions, and the driver refuses grades that break its rule.

## Assertions

`name` is optional on the first three.

- `{ "run": command, "exit": 0, "stdout": regex }` runs in the working copy. `{{KIT}}` becomes this repo's root.
- `{ "file": path, "matches": regex, "count": n }` or `{ "file": path, "exists": false }`. `count` is optional and requires exactly that many matches. A `*` in the last segment takes the last file in name order.
- `{ "file": path, "frontmatter": { "status": "draft" } }`.
- `{ "judge": criterion }` is graded by the conductor, by the rules in [GRADING.md](GRADING.md).
