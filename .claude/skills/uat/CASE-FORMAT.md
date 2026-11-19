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
| `shell` | What the person runs in a terminal before starting Claude Code. |
| `command` | What the person types in Claude Code. `{{RUN}}` becomes the run folder. |
| `answers` | `{ "when", "intent", "reason" }` for each question the agent may ask. `drift: true` marks one added during a run. |
| `turns` | `{ "intent", "reason", "assertions"? }` for each follow-up message, in order. |
| `assertions` | Checked by `check` at the end of the step. |
| `assisted` | Optional. A non-empty string giving the reason the case only runs with a person, such as checks that depend on what the terminal shows. It makes the case an **Assisted UAT case**. |

A case's fingerprint in the **UAT ledger** covers its file and every fixture its `setup` copies, so changing either changes it. Line endings do not count.

`run.mjs due` lists every **Due UAT case** with its reason: `new`, `changed`, `upstream-due` (a case it starts from through `from.case` or `continues` is due) or `not-passed`. It groups them into **UAT batches**, each holding its due cases and the cases they start from, with a `--cases` list in `order`. Assisted cases are never in a batch: they are listed apart, grouped the same way, each with its reason. A case that starts from an assisted case goes with it, since no batch can hold the case it needs. Such a group can run again a case that a batch also runs.

Write answers and turns as **intents**: what the person means, never an option's label, since labels change between runs. The `reason` says what the case tests with that answer, so an agent can adapt it to a question worded differently.

## Setup operations

`{ "write": path, "text": ... }` · `{ "copy": path under this skill, "to": path }` · `{ "replace": path, "pattern": regex, "with": text }` · `{ "delete": path }`, a file or a whole folder, which must exist · `{ "commit": message }` · `{ "remote": url }`, which points `origin` at another URL. `write` and `copy` expand `{{SHORT}}` and `{{BRANCH}}`, so a fixture review report can cover `HEAD`: a report written before a `commit` names the commit before it.

A case at `write` access uses `fixtures/vcs-local-write.md` instead of a review host, because `origin` is a local repo. The one exception, `aw-ship-merge-review-host`, merges through GitHub: it points `origin` at the scratch repo, uses `fixtures/vcs-github-write.md`, and merges into a base branch of its own, which its `shell` resets before each run. The ship cases write their review report from `fixtures/` so that each one tests the ship guard alone, whatever the previous review found.

## Assertions

`name` is optional on the first three.

- `{ "run": command, "exit": 0, "stdout": regex }` runs in the working copy. `{{KIT}}` becomes this repo's root.
- `{ "file": path, "matches": regex, "count": n }` or `{ "file": path, "exists": false }`. `count` is optional and requires exactly that many matches. A `*` in the last segment takes the last file in name order.
- `{ "file": path, "frontmatter": { "status": "draft" } }`.
- `{ "judge": criterion }` is graded by the conductor, by the rules in [GRADING.md](GRADING.md).
