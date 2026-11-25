# Housekeeping

Five repo-level changes `aw-setup` checks on every run. Each one is idempotent: a re-run finds it already applied and changes nothing.

## `.aw/` in `.gitignore`

`.aw/` is the kit's local working directory; drafts go to `.aw/drafts/`. It is never committed.

- **Explore:** does `.gitignore` exist, and does a line already ignore the folder (`.aw`, `.aw/`, `/.aw` or `/.aw/`)?
- **Write, without asking:** when no such line exists, append `.aw/` on its own line, creating `.gitignore` if needed. Mention it in the report.

## `permissions.deny` entries (Claude Code)

Basic protection with no hook scripts (ADR 0009). The agent never performs the operations in the `## Never allowed` section of the VCS templates in [`adapters/`](adapters/), whatever the settings say; these entries make Claude Code refuse some of those commands too.

- **Explore:** read `permissions.deny` in `.claude/settings.json` and `.claude/settings.local.json`; an entry in either file is present.
- **Offer** the entries below that are missing, as a question of its own with three options: add them to `.claude/settings.json` (shared with everyone on the repo), add them to `.claude/settings.local.json` (kept personal), or don't add them. Recommend `.claude/settings.json`. When every entry is already present, the offer is not asked.

  ```json
  "Bash(git push --force*)",
  "Bash(git push * --force*)",
  "Bash(git push -f*)",
  "Bash(git push * -f*)",
  "Bash(git push * +*)",
  "Bash(git * --no-verify*)",
  "Bash(git commit -n*)",
  "Bash(git commit * -n*)"
  ```

  `--force*` also covers `--force-with-lease` and `--force-if-includes`, and `+*` covers a forced refspec such as `+main`. The patterns match the command as written, so a bundled short flag such as `git commit -an` slips past them. Say so when offering: the entries are a backstop for the rule, not a replacement for it. When the harness runs shell commands through a PowerShell tool as well (Claude Code on Windows), offer each entry a second time with `PowerShell(` in place of `Bash(`, in the same question.
- **Write, to the file the user picks:** add only the missing entries to the `permissions.deny` array, creating `permissions` or `deny` if absent. Keep every other setting and entry as it is, and write valid JSON.

Other harnesses have no `permissions.deny`; skip this offer there.

## Node

`aw-check-spec` validates specs with a Node script (ADR 0012).

- **Explore:** run `node --version`.
- **Warn** when it fails or reports a major version below 18: "Node 18 or later not found. `aw-check-spec` cannot run its script, so specs are checked by reading and the result is never script-verified. Install Node 18+ to get the script-verified spec check." Setup carries on either way.

## PowerShell (Windows)

On Windows the kit needs PowerShell 7.3 or later (`pwsh`). Claude Code's PowerShell tool runs the agent's commands in `pwsh` when it finds it and falls back to Windows PowerShell 5.1 otherwise, where quoted arguments, `2>&1` and `&&` do not work as the kit's commands expect.

- **Explore:** on Windows only, run `pwsh --version`. On other platforms there is no check.
- **Warn** when it fails or reports a version below 7.3: "PowerShell 7.3 or later (`pwsh`) not found. On Windows the kit needs it, so that Claude Code's PowerShell tool runs in it; Windows PowerShell 5.1 isn't supported. Install it with `winget install --id Microsoft.PowerShell --source winget`." Setup carries on either way.

## Matt Pocock's plugin (Claude Code)

The two kits offer competing skills for the same phases, so Pocock's plugin stays installed at user scope and is turned off per repo.

- **Explore:** find the `enabledPlugins` key naming Pocock's plugin (`mattpocock-skills@<marketplace>`, as `claude plugin list` shows) in `.claude/settings.local.json`, `.claude/settings.json` and `~/.claude/settings.json`. The most specific file that sets the key decides, in that order: the plugin is enabled in this repo when that value is `true`. Skills offered as `mattpocock-skills:<name>` in this session also show it is on.
- **Offer**, when enabled, to turn it off for this repo only, as a question of its own with three options: set `"mattpocock-skills@<marketplace>": false` under `enabledPlugins` in `.claude/settings.json`, set it in `.claude/settings.local.json`, or leave it on. Recommend `.claude/settings.json`. Update an existing key rather than adding a second one. When the plugin is already off in this repo, the plugin offer is not asked. When the user leaves it on, mention in the report that both kits' skills stay on.
- **Offer**, right after the plugin offer and as a question of its own, to remove the subsections of the `## Agent skills` block that the kit does not own, such as `### Issue tracker` or `### Triage labels`, with two options: remove them, or keep them. Name each one in the question. The kit owns `### Tracker`, `### VCS`, `### Checks` and `### Domain docs`. Ask it whenever the plugin is off in this repo once the plugin offer is settled, whether the user turned it off on this run or it was already off, and the block holds such subsections. When the plugin stays on, or the block holds no such subsection, the removal offer is not asked. When the user keeps them, the removal offer is asked again on the next run.
- **Write, in step 4:** when the user accepted, delete each of those subsections, heading and body, from the block, and leave the kit's four and the rest of the file as they are.

The user-scope install is never touched.
