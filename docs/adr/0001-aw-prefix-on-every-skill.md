# Every skill in the kit carries the `aw-` prefix, copies included

Every skill the kit ships is named `aw-<name>`: kit skills (`aw-spec`, `aw-build`, ...) and copies (`aw-grilling`, `aw-handoff`, ...). The kit has to sit next to Matt Pocock's plugin and other kits, and be enabled only in the repos that use the workflow. Unprefixed names (`grilling`, `review`, `ship`) would collide in un-namespaced installs such as `npx skills`, would make a bare `/grilling` ambiguous, and would let one kit's skill run by accident in place of the other's.

## Considered Options

- **No prefix, rely on the plugin namespace** (Pocock's choice, see his `.out-of-scope/harness-name-collisions.md`): rejected. `npx skills` installs into a flat directory, and Claude Code's docs do not say which skill a bare name resolves to when two plugins ship it.
- **Prefix only kit skills; copies keep upstream names**: rejected. It keeps copies byte-identical to upstream, but leaves exactly the accidental collisions this ADR exists to prevent.

## Consequences

- A copy is no longer byte-identical to its upstream. Its text changes only by the **mechanical transform**, which has three parts:
  - The rename: the folder, the `name:` field, and references to other copied skills (for example `aw-improve-codebase-architecture` calls the Skill tool with `aw-codebase-design`).
  - Relocating shared upstream files the copy points to outside its own folder, as a skill's path to a repo-level `references/` file would. They move into the copy's folder and the paths that point at them are rewritten, because `npx skills` installs one folder at a time (ADR 0002) and would leave them behind. No copy relocates one today: `aw-security-and-hardening`, which relocated Addy Osmani's `references/security-checklist.md`, is now an adaptation.
  - Mapping replaced skills: a reference to an upstream skill the kit does not copy but replaces with a kit skill of its own, such as Pocock's `code-review`, which `aw-review` replaces, points at the kit skill instead. Each upstream in `upstreams.json` lists these under `replaced`. Once Pocock's plugin is disabled in a repo, as `/aw-setup` offers, a copy must not point to a skill that is missing there, and a hand edit would make the copy an adaptation.

  The sync tooling applies the transform and checks that the upstream text plus the transform equals the copy. Any other edit turns the skill into an adaptation.
- Per-repo choice also relies on Claude Code's `enabledPlugins`. The kit can be installed with `--scope project` only where it is used, and Pocock's plugin can be disabled in those repos.
