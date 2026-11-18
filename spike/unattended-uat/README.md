# Spike: unattended UAT runs (#155)

Throwaway code that measures what one UAT case costs against the plan's quota when nobody is at the keyboard. It is not the driver #155 asks for.

| File | What it does |
| --- | --- |
| `case.mjs` | Runs the run's next case: `run.mjs next`, the case's `shell`, the session in `claude -p`, the follow-up turns, `check` and one grading call. Writes `spike.json` in the step folder. |
| `hook.mjs` | `PreToolUse` on `AskUserQuestion`: answers by `ANSWERING.md` through one model call. |
| `host.mjs` | The permission host (stdio MCP, tool `approve`). Allows everything except file writes outside the working copy. Denies `AskUserQuestion`, which only reaches it when the hook failed. |
| `meter.mjs` | Sums the tokens of every local session in a time window and splits a `/usage` delta by token share. |

## Measuring one case

1. Use only this machine during the window: claude.ai, the desktop app's chat and cloud sessions spend the quota but are not on disk.
2. `node spike/unattended-uat/meter.mjs mark`. It prints the time and the last quota reading, which the statusline logs to `~/.claude/rate-limits.jsonl` while any interactive session is open.
3. `node .claude/skills/uat/scripts/run.mjs init --run <dir> --source <clone> --cases aw-intake-bug`
4. `node spike/unattended-uat/case.mjs --run <dir>`
5. Wait until the weekly reading has risen by at least 3 points, then `mark` again.
6. Run the `meter` line that `case.mjs` printed, with `--from` and `--to` set to the two marks. It takes the rise from the log; `--pct` overrides it.

`spikePoints.range` is the case's estimated cost in points, once per token kind. For a case with `continues`, run the earlier case with `--record` first.
