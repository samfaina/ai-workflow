# Shipping

Read by the `ship-tickets` skill (samfaina/agent-skills).

- **Base branch:** `main`
- **Merge method:** `merge` (passed to `gh pr merge --merge`)
- **Merge approval:** `auto` (the loop merges as soon as CI is green)
- **Branch naming:** `--name` is `<type>/<slug>`, where `<type>` is the conventional-commit type of the PR title (`feat`, `fix`, `docs`, `chore`, …) and `<slug>` is the issue title in kebab-case. Orca adds `samfaina/` in front and turns the `/` into `-`, so the branch is `samfaina/<type>-<slug>`.
- **After merge:** nothing.
- **CI:** `required` (PRs get checks, and the loop waits for them to pass)
- **Workers:** `claude` (all roles)

## PR format

- **Title:** a conventional commit, `<type>: <issue title>` with the title's first letter lowercased, as in `feat: kit skeleton, validation CLI and CI`.
- **Body:** three sections, then `Closes #<n>` as the last line:
  1. `## Summary`: what changes and why, with a `diff` tree of the added (`+`) and changed (`~`) files, one comment per file.
  2. `## Evidence`: before and after, and the test, validator and command output that shows the change works.
  3. `## Merge Danger`: `**Door:**` one-way or two-way, with what makes it so, and `**Blast Radius:**` what the change can affect outside the PR (none, repo-local, CI, …).
  4. `Closes #<n>` on a line of its own, ending the body.
