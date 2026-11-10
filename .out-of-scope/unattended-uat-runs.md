# Unattended UAT runs

UAT of the `aw-` skills stays assisted. A person runs each UAT case in a fresh session and the UAT conductor (`/uat`) prepares the step, proposes the answers and grades the result. The kit has no process that plays the person.

## Why this is out of scope

An unattended run has to be free of extra cost, and no supported route is.

The Claude Agent SDK is the only documented way to answer `AskUserQuestion` from a script, through `canUseTool`. Its documented authentication is an API key, so every run is billed apart from the plan the author already pays for. A full run is 42 UAT cases plus a model grading their 69 `judge` criteria, and each case session is a long multi-turn run of a kit skill.

The routes that avoid that bill were looked at and dropped:

- **The SDK on a subscription login.** The docs forbid third parties from offering claude.ai login in their products and do not address personal use, so it is not known to be allowed. It would also spend the plan's quota by an amount nobody has measured.
- **`claude -p` without the SDK.** `--permission-prompts host` hands prompts to the SDK host or to `--permission-prompt-tool`, and the docs do not say that `AskUserQuestion` goes through either. `--permission-prompts none` removes the tool, which changes the behaviour the UAT cases check.

The assisted run already makes a UAT repeatable before a release. What it costs is a person's time.

## If this is reconsidered

A supported way to run sessions unattended at no extra cost would reopen it. Delete this file and start from these findings, since the original proposal in #86 predates `/uat`:

- Reuse `run.mjs` and the case files. A separate `e2e/` tree and YAML scenarios would duplicate them.
- Case files hold intents, and `canUseTool` must return a literal option label, so a model call has to translate each answer and write each follow-up turn.
- 21 of the 42 cases depend on another case's restore point or session, so they cannot run independently.
- 12 cases start from `review/*` and `uat/*` refs that are not on the scratch app's GitHub remote.
- 33 cases run `npm ci`, so a run needs the app's dependencies available even with GitHub out of the picture.

## Prior requests

- #86: "Automate the end-to-end run of the aw- skills"
