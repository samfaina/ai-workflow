---
name: aw-create-verify
description: "Write the repo's verify skill: discover from the repo how to start, diagnose, drive, observe and clean up the real app, write it with a feature map to .claude/skills/verify-<app>/, and run it once end to end before finishing. Run once per app, before the first /aw-verify, and again when the app's start-up or features change."
disable-model-invocation: true
---

# Create verify

Write the repo's **verify skill**: the skill that starts, drives and observes the repo's real app, so that `/aw-verify` can prove acceptance criteria on it. It lives at `.claude/skills/verify-<app>/SKILL.md`, committed with the project and with no `aw-` prefix, because it belongs to the repo, not to the kit (ADR 0011). `/aw-verify` looks for it at that path whatever the harness. The skill, run once end to end, is this skill's artifact.

`<app>` is a short lowercase slug for the app, such as `api` or `web`, taken from its package or folder name. A repo with several apps gets one verify skill per app: ask the user which one to write first.

The verify skill holds only what the repo or a run proved. Every command and URL in it names where it came from (a file and line, or the run that confirmed it), and nothing in it is guessed: what the repo does not say, the user answers.

A `file:line` reference is a **citation**, and it carries the text it cites, quoted beside it: `` `package.json:7` `"dev": "node server.js"` ``. Before writing a citation, open the file and confirm the line holds what you cite. Leave a secret's value out of the quote.

## Configuration

Find the repo's `## Agent skills` block: look in `AGENTS.md`, then `CLAUDE.md`, then `.claude/CLAUDE.md`, and follow its pointers to the tracker, VCS and checks adapters and the domain doc. Use each operation the way the adapter's Operations table says, at its access level: a write at `draft` is not performed; write its exact command or text to `.aw/drafts/<yyyymmdd-hhmmss>-<operation>.md` and tell the user the path. Where the block or an adapter is missing, use the defaults below.

## Defaults when unconfigured

When the block or an adapter is missing, a skill keeps going on these defaults and says once per session: "using defaults, run `/aw-setup`".

| Adapter | Default |
| --- | --- |
| Tracker | `none`: the task arrives as free text, reads find nothing, and every write leaves a draft. `aw-wayfinder`, which needs a tracker, offers to create a local-markdown one. |
| VCS | git. The base branch and diff base are the default branch (`git symbolic-ref refs/remotes/origin/HEAD`, else `main` or `master`), which is also the one protected branch. `start-branch` and `commit` are at `write`; `push`, `open-review` and `merge` are at `draft`. |
| Checks | No configured commands. A skill proposes commands from the project's manifest, runs them when it needs a level, and never reports a level as passed unless it ran it. |
| Domain | Single-context: `GLOSSARY.md` and `docs/adr/` at the root, read when present. |

## Never allowed

Whatever the access levels say, the agent never force-pushes (`--force`, `--force-with-lease`, a `+` refspec), never deletes a branch, local or remote, never pushes directly to a protected branch, and never passes `--no-verify`. These are not configurable.

## Steps

### 1. Find the app

Read the README, the project manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, a `Makefile`, `docker-compose.yml`, a `Procfile` and the like) and the CI workflows, and decide what the app is: a server or API, a web front end, a CLI, a desktop or mobile app, or a mix of these.

A repo with no runnable app, such as a library, gets no verify skill: its tests are the evidence. Say so and stop. When `.claude/skills/verify-<app>/` already exists, read it: this run updates it in place, keeping what still holds. Re-check every citation it keeps against its file, correcting a line that moved and adding the quote where one is missing.

Done when you can name the app, its kind and its `<app>` slug, or have said why the repo gets no verify skill.

### 2. Discover the five operations

Find in the repo how to do each of these, and where it says so:

- **Start:** the command that runs the app locally, the environment it needs (`.env.example`, config files, a database or another service it depends on, seed data) and how long it takes to be up. Prefer the command the README or CI uses over one you assemble. Start checks the port first, where the app has one, and, when it is held, applies Diagnose's fix for a port in use. It records a **process identity** for each process it starts, the process id with the process's command line or start time, read from the live process, and it records the ports this run took. Diagnose and Drive use those ports.
- **Diagnose:** how to tell the app is up and healthy (a health URL, a log line, a process that stays alive, a `--version` that answers), where its logs go, and the usual failures, such as a port in use or a missing variable. The fix for a port in use leaves the process holding it alone: report what holds it and stop, or use another port where the app allows one.
- **Drive:** how to act on it the way a user does: HTTP requests for an API, the binary and its arguments for a CLI, a browser for a web UI. Use the drivers the repo already has, such as a Playwright or Cypress setup, before anything else. For a UI the repo has no driver for, use the harness's own browser tool when it has one, and say so in the skill.
- **Observe:** what counts as evidence for each kind of behaviour: a response's status and body, a command's output and exit code, a screenshot, a log line, a row read through the app's own interface.
- **Clean up:** how to stop everything Start started and reset the state a run changed, so that the next run starts clean. Compare each process identity with the live process and signal only on a match; on a mismatch, signal nothing and report it. The check and the signal use the same kind of process id, as the template's Clean up says.

Then map the **features**: the behaviour a user reaches, each with its entry point (a route, command or screen), how to drive it and what to observe. Take them from the routes, commands and screens in the code, and name the files they live in. The feature map is what `/aw-verify` reads to turn an acceptance criterion into a journey.

When the repo leaves one of these open (a secret, an account, a service only the user can run), ask the user. Never invent a value or a credential, and never write a secret into the skill: name the variable and where the user keeps it.

Done when each operation has a command or procedure with its source, every citation has been opened and confirmed, and the feature map lists the app's features with their entry points.

### 3. Write the verify skill

Write `.claude/skills/verify-<app>/SKILL.md` from [`VERIFY-TEMPLATE.md`](VERIFY-TEMPLATE.md), filling every placeholder and deleting none of its sections. Keep its `name:` as `verify-<app>`, with no `aw-` prefix. `/aw-verify` reads it from that path; leave it model-invoked as well, so that an agent can check a change on the real app outside `/aw-verify`. Put helper scripts it needs, such as a wait-until-ready loop, in the same folder and call them by relative path. When it has shell scripts, name each one `*.sh` and also write `.claude/skills/verify-<app>/.gitattributes` holding `*.sh text eol=lf`, so that they stay LF whatever the checkout's `core.autocrlf`.

Write nothing else into the repo, and leave its root `.gitattributes` alone: the verify skill must work from what is already there.

Done when the skill's every section is filled, each command names its source, each citation quotes its text, the feature map is in it, and the folder holds its `.gitattributes` if the skill has shell scripts.

### 4. Run it once end to end

Follow the skill you wrote, as `/aw-verify` will, with nothing from your own exploration:

1. **Start** the app and **Diagnose** it until it reports healthy.
2. Run the skill's **smoke journey**, the shortest run that proves the skill works: drive at least one feature from the feature map and **Observe** the result the map says to expect.
3. **Clean up**, then check that nothing it started is still running and no port this run took is still held. A port held before the first attempt's Start is not this run's: a dev server the user already had running does not fail the check.

When a step fails, first stop, through its process identities, anything the failed attempt left running. Then fix the skill, not the app, and run all three again from the start. After three failed runs, when the fix needs a change to the app, or when the port Start needs is held by something this run did not start and the app allows no other, stop: report the failing step and its output, and leave the skill where it is for the user to decide.

Before the commit, re-read every citation in the skill against its file: the line must hold the quoted text. Correct any that does not, and when a correction changes a command, run all three again.

Done when one run, start to clean-up, followed the skill as written and passed, and every citation matched its file.

### 5. Commit locally

The verify skill is committed with the project. When the working tree holds changes this skill did not make, ask the user whether to commit, set aside or keep them first: they must not land in this commit.

Never commit on a protected branch (the base branch or another the VCS adapter names). When the current branch is protected, use `start-branch` to create one, named by the adapter's branch naming, such as `chore/verify-<app>`. When `start-branch` is at `draft`, write the draft, tell the user to create the branch with it and commit the skill's folder there, and stop: the commit would otherwise land on the protected branch.

Then use `commit` for the skill's folder alone, with a message in the VCS adapter's commit convention, such as `chore: add the verify-<app> skill`. At `draft`, write the draft and tell the user the path.

The commit stays local: `push` and `open-review` belong to `/aw-ship`.

Done when the skill's folder is in one local commit, or in a draft whose path you gave the user.

### 6. Report

Report in chat:

- the verify skill's path and the app it drives;
- each of the five operations, one line each, with the source of its command;
- the features in the feature map;
- the end-to-end run: each step and what it observed, or the step that failed and its output;
- the commit's hash and subject, or the draft path;
- what the user answered or still has to supply, such as a secret the skill names.

Then name the next skill: `/aw-verify` once every slice of a spec is built, or `/aw-build` while slices remain. Tell the user to run it; this skill never runs it.
