# VCS: git, no review host

Read by the aw- skills through the `## Agent skills` block. Edit by hand or re-run `/aw-setup`.

- **Base branch:** `main`. It is also the diff base.
- **Protected branches:** `main`, the base branch.
- **Branch naming:** `<type>/<slug>`.
- **Commit convention:** an imperative, sentence-case summary with no type prefix.
- **Review host:** none. The review request is a document the user reads, and merging happens locally.
- **Remote:** `origin`.

**Default access:** `write`

## Access

`read` operations are always allowed. At `write` the agent performs the operation. At `draft` it writes the exact command, with any body text, to `.aw/drafts/<yyyymmdd-hhmmss>-<operation>.md`, tells the user the path, and goes on without performing it. A row whose Access differs from the default is an override.

`merge` at `write` is still conditional: the agent merges only when `aw-review` found no proven defect and the `full` check level passed.

## Never allowed

Whatever the access levels say, the agent never force-pushes (`--force`, `--force-with-lease`, a `+` refspec), never deletes a branch, local or remote, never pushes directly to a protected branch, and never passes `--no-verify`. These are not configurable.

## Operations

| Operation | How | Access |
| --- | --- | --- |
| `start-branch` | `git switch -c <branch> main`, naming the branch by the pattern above | `write` |
| `commit` | `git add <paths>`, then `git commit -F <message-file>`, with a message in the commit convention | `write` |
| `diff-base` | `git merge-base HEAD main`; the change under review is `git diff <that commit>...HEAD` | `read` |
| `push` | `git push -u origin <branch>`, from a branch that is not protected | `write` |
| `open-review` | No review host: the review request body is written to `.aw/drafts/<yyyymmdd-hhmmss>-open-review.md` for the user to read | `draft` |
| `merge` | Locally: `git switch main`, then `git merge --no-ff <branch>`. The merged branch is kept, and the base branch is never pushed by the agent | `write` |
