# ai-workflow

A personal kit of agent skills in `SKILL.md` format that takes a task to a merged change: a spec when the change deserves one, evidence for every acceptance criterion, and a review before anything ships. It works with or without a tracker, on any VCS host. Every skill is named `aw-<name>`, so it never collides with another kit's skills.

Claude Code is the reference harness. Other harnesses (Codex, OpenCode, Cursor and the like) get the skills through the `SKILL.md` standard.

The vocabulary is in [`GLOSSARY.md`](GLOSSARY.md) and the design decisions in [`docs/adr/`](docs/adr/).

> Status: pre-release. The repo is a valid plugin and skills source. It ships eleven copies of Matt Pocock's skills and one of Addy Osmani's so far, listed in [`NOTICE.md`](NOTICE.md), and thirteen kit skills: `aw-check-spec`, the spec template and the script that checks specs under `docs/specs/`; `aw-setup`, which configures a repo for the workflow; `aw-intake`, which classifies a task's type and route and runs its pre-step; `aw-wayfinder`, which charts an epic-route effort as a map of decision tickets in the tracker, offering a local-markdown tracker when there is none, resolves them one per session, and hands each deliverable to `aw-spec` without building anything; `aw-spec`, which writes the spec and holds it at `draft` until you approve it; `aw-slices`, which plans an approved spec as slices, agrees the test seams with you, and mirrors the slices as tickets where the tracker allows; `aw-build`, which builds one slice per call, test-first, and records it in the spec with a local commit, or on the fast route builds the whole task from intake's done-when criteria with no spec; `aw-create-verify`, which writes the repo's verify skill to `.claude/skills/verify-<app>/` and runs it once; `aw-verify`, which proves each acceptance criterion on the real app through that skill and records the results in Traceability; `aw-review`, which reviews the diff from the diff base on Spec, Standards and Security axes in separate subagents and writes a review report in which a defect counts only when a run proves it; `aw-security-and-hardening`, Addy Osmani's security guidance and checklists, which the review's Security axis judges with; `aw-ship`, which runs the `full` checks, sets the spec to `implemented`, writes the review request body, and pushes, opens the review request and merges only as far as the VCS adapter's access levels allow; and `aw-retro`, which turns every error class a session repeated into the highest control on its ladder that works, proven to fail on the real case and pass on a correct one, and changes nothing until you approve it.

## Install

### As a Claude Code plugin (recommended)

The repo is its own marketplace. Add it once, then install the kit with project scope in each repo that uses the workflow, so other repos never see its skills:

```sh
claude plugin marketplace add samfaina/ai-workflow
claude plugin install ai-workflow@samfaina --scope project
```

The same steps work inside Claude Code as `/plugin marketplace add samfaina/ai-workflow` and `/plugin install ai-workflow@samfaina`, choosing project scope when asked.

Project scope writes the plugin to the repo's `.claude/settings.json`, so everyone who clones the repo gets the same kit. Updates arrive through Claude Code's plugin system whenever a release bumps the plugin version.

### With `npx skills`

For harnesses without Claude Code's plugin system:

```sh
npx skills add samfaina/ai-workflow
```

To install a single skill, name it:

```sh
npx skills add samfaina/ai-workflow --skill aw-<name>
```

Each skill folder is self-contained, with its license, references and scripts, so a single skill works on its own.

## Switching plugins on or off per repo

Claude Code decides which plugins are active in a repo from `enabledPlugins` in the settings files. Keys are `<plugin>@<marketplace>`. A project's `.claude/settings.json` (shared) or `.claude/settings.local.json` (yours only) overrides your user settings.

The usual setup keeps Matt Pocock's plugin installed at user scope and turns it off in the repos that use this kit, so the two kits never offer competing skills for the same phase:

```json
{
  "enabledPlugins": {
    "ai-workflow@samfaina": true,
    "mattpocock-skills@claude-plugins-official": false
  }
}
```

Use the key under which Pocock's plugin is installed on your machine. It depends on the marketplace you installed it from (`claude plugin list` shows it). From the command line:

```sh
claude plugin enable ai-workflow@samfaina --scope project
claude plugin disable mattpocock-skills@claude-plugins-official --scope project
```

To turn the kit off in one repo without uninstalling it, set `"ai-workflow@samfaina": false` in that repo's settings.

## Configuring a repo

Run `/aw-setup` once in each repo that uses the workflow. One interview writes three adapters to `docs/agents/` (`tracker.md`, `vcs.md`, `checks.md`), the domain doc (`domain.md`) and an `## Agent skills` block pointing to all four in `AGENTS.md`, or in `CLAUDE.md` when only that exists. The adapters translate the kit's canonical operations into the repo's tools and set what the agent may do itself (`write`) and what it only drafts for you in `.aw/drafts/` (`draft`). Setup also adds `.aw/` to `.gitignore`, offers `permissions.deny` entries against force-push and `--no-verify`, warns when Node is missing, and offers to turn Pocock's plugin off in the repo. Re-run it to change anything; it updates in place.

A repo without configuration still works on safe defaults: no tracker, and pushing, opening a review request and merging left as drafts. [`docs/configuration.md`](docs/configuration.md) describes the layer and its defaults.

## Maintaining the kit

The scripts are dependency-free Node 18+ ESM, always run as `node <path>` (ADR 0008).

```sh
node --test                          # tests
node scripts/validate-kit.mjs        # kit invariants
claude plugin validate . --strict    # plugin and marketplace manifests
```

`scripts/validate-kit.mjs` checks that:

- every skill folder under `skills/` carries the `aw-` prefix and its `name:` matches the folder;
- every skill is listed in `.claude-plugin/plugin.json`, and every listed skill exists;
- user-invoked skills carry both `disable-model-invocation: true` and an `agents/openai.yaml` with `policy: allow_implicit_invocation: false`. A skill that declares either flag counts as user-invoked, and so do `aw-setup` and the phase skills (`aw-intake`, `aw-wayfinder`, `aw-spec`, `aw-slices`, `aw-build`, `aw-verify`, `aw-create-verify`, `aw-review`, `aw-ship`, `aw-retro`) whatever they declare;
- no Markdown file under `skills/` names a user-invoked skill in double quotes, the way a Skill tool call does (`"aw-spec"`): a user-invoked skill cannot be called, so a skill tells the user to run it (`/aw-spec`);
- a `## Never allowed` or `## Defaults when unconfigured` section in a Markdown file under `skills/` matches the section of the same name in `docs/configuration.md`, up to whitespace;
- every adapter template in a skill's `adapters/` folder (`<kind>.md` or `<kind>-<variant>.md`, for the kinds `tracker`, `vcs` and `checks`) has an `## Operations` table with one row per canonical operation of its kind, each saying how it is performed, with `read` for read operations and `write` or `draft` for write operations, and no operation outside the vocabulary; tracker and VCS templates declare a `**Default access:**`, and checks templates give a command for `fast`, `task` and `full` in a `## Levels` table;
- a template copied into another skill's `adapters/` folder under the same file name, as `aw-wayfinder` copies `aw-setup`'s local-markdown tracker so that it works when installed alone, is identical to the first copy in folder order;
- the version in `plugin.json` is plain semver `X.Y.Z` and matches the marketplace entry;
- every copy passes the sync `check` (below), which also requires its `LICENSE.upstream`;
- every entry in an upstream's `replaced` in `upstreams.json` maps to a kit skill with a folder under `skills/`, so a copy that refers to a replaced skill points at a skill that exists;
- every copy has a `NOTICE.md` entry that links its upstream `repo` and shows its pin and the kind `copy`;
- text files use LF line endings.

It prints one finding per line and exits non-zero when it finds any. CI runs all three commands on every pull request.

### Copies and upstream sync

`upstreams.json` pins each upstream to a commit, records why that pin was chosen, and lists the skills copied from it. `upstreams.lock.json` holds the git tree hash of each copied upstream folder at the pin and the mode and blob hash of every file in it; `check` verifies that the file hashes add up to the tree hash. Both are maintained through `scripts/sync-upstreams.mjs` (ADR 0015):

```sh
node scripts/sync-upstreams.mjs install   # clone each upstream at its pin, write the copies and the lock
node scripts/sync-upstreams.mjs check     # offline: each copy equals its upstream plus the mechanical transform
node scripts/sync-upstreams.mjs report    # what changed upstream since each pin
```

`install` writes each copy to `skills/aw-<name>/` with the rename applied: the folder, the `name:` field, and references to copied skills. A reference is written in double quotes (`"tdd"`, as in Skill tool calls), as a slash command (`/tdd`), backticked before the word "skill" (`` the `tdd` skill ``) or as a backticked link text (``[`tdd`](SKILL.md)``). Any other use of a name, such as a bare backticked word or a path, is left alone, and `install` lists each quoted or backticked one it left, as `<file>:<line>: left alone: <mention>`, so the maintainer can tell whether one is a reference in a form the rename does not know yet.

`install` fails, writing no copy and no lock, when a copy still refers to a skill of its own upstream in one of those forms and the kit neither copies that skill nor maps it under the upstream's `replaced`. Such a reference points nowhere once the upstream's plugin is disabled. The upstream's skills are the `name:` of every `SKILL.md` in its tree at the pin. The error lists each reference as `<file>:<line>: <mention>`; resolve one by copying the skill or mapping it under `replaced`. `check` runs offline and does not repeat this, since the lock does not hold the upstream's skill list.

`install` keeps `agents/`, adds the upstream license as `LICENSE.upstream`, and removes copies no longer listed, unless an upstream’s `replaced` maps to their folder or `plugin.json` still lists it. Those folders keep their contents, including hand edits, and their stale lock entries are dropped. Each retained folder is reported once, on the `install` that drops its lock entry, with advice that fits why it is still tied to the kit:

| An upstream's `replaced` maps to the folder | `plugin.json` lists it | To remove the folder |
| --- | --- | --- |
| yes | yes | remove or remap each `replaced` entry that maps to it, remove its `plugin.json` listing, and delete it |
| yes | no | remove or remap each `replaced` entry that maps to it, and delete it |
| no | yes | remove its `plugin.json` listing, and delete it |

The report names each `replaced` entry that maps to the folder by upstream and upstream skill. Remove or remap, because removing an entry while a copy still refers to that skill makes `install` fail with the error above. `install` and `check` accept a `replaced` entry whose kit skill has no folder; `validate-kit` reports it and fails, so deleting a folder without removing its entry does not pass unnoticed.

An invalid `plugin.json` (including a missing `skills` array) fails before any writes; a missing file lists nothing. A copy must not be edited by hand: `check` fails on any other change, and on a missing rename. An upstream's `repo` can be a local directory holding a git repo, which is how the tests run offline.

To move a pin, change `commit` and `reason` in `upstreams.json`, run `install`, and update the pin in the copy's `NOTICE.md` entry. New copies also need a `NOTICE.md` entry and a line in `plugin.json`'s `skills`.

A release is a semver tag `vX.Y.Z`, the same `version` in `.claude-plugin/plugin.json` and the marketplace entry, and a hand-written `CHANGELOG.md` entry (ADR 0015). Without the version bump, installed plugin users never see the update.

The repo's own agent instructions live in `.claude/CLAUDE.md`, not at the root: `claude plugin validate --strict` rejects a root `CLAUDE.md`, because a plugin does not load it as project context.

## License

MIT, copyright `samfaina`. Copied and adapted skills are credited in [`NOTICE.md`](NOTICE.md).
