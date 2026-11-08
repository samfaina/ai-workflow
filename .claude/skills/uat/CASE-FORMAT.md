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
| `shell` | What the person runs outside the agent before starting it. |
| `command` | What the person types inside the agent. `{{RUN}}` becomes the run folder. |
| `answers` | `{ "when", "intent", "reason" }` for each question the agent may ask. `drift: true` marks one added during a run. |
| `turns` | `{ "intent", "reason", "assertions"? }` for each follow-up message, in order. |
| `assertions` | Checked by `check` at the end of the step. |

Write answers and turns as **intents**: what the person means, never an option's label, since labels change between runs. The `reason` says what the case tests with that answer, so an agent can adapt it to a question worded differently.

## Setup operations

`{ "write": path, "text": ... }` · `{ "copy": path under this skill, "to": path }` · `{ "replace": path, "pattern": regex, "with": text }` · `{ "commit": message }` · `{ "remote": url }`, which points `origin` at another URL. `write` and `copy` expand `{{SHORT}}`, `{{HEAD}}` and `{{BRANCH}}`, so a fixture review report can cover `HEAD`: a report written before a `commit` names the commit before it.

A case at `write` access uses `fixtures/vcs-local-write.md` instead of a review host, because `origin` is a local repo. The ship cases write their review report from `fixtures/` so that each one tests the ship guard alone, whatever the previous review found.

## Assertions

`name` is optional on the first three.

- `{ "run": command, "exit": 0, "stdout": regex }` runs in the working copy. `{{KIT}}` becomes this repo's root.
- `{ "file": path, "matches": regex }` or `{ "file": path, "exists": false }`. A `*` in the last segment takes the last file in name order.
- `{ "file": path, "frontmatter": { "status": "draft" } }`.
- `{ "judge": criterion }` is graded by the conductor against the transcript, and reported apart.
