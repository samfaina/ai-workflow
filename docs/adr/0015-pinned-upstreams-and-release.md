# Upstreams are pinned by commit and synced by script; releases are plain semver tags

`upstreams.json` pins each upstream the kit copies from (repo and commit) and lists the skills copied from it. `scripts/sync-upstreams.mjs` has three modes:

- `install` clones each upstream at its pin, applies the mechanical transform (ADR 0001) and adds `LICENSE.upstream`.
- `check` verifies offline that each upstream skill plus the transform equals its copy, against hashes in `upstreams.lock.json`.
- `report` lists what changed upstream since the pin.

Copies keep their `agents/` folder (`openai.yaml`), because Codex needs it. A GitHub Actions workflow runs `check` and validates the plugin manifests on every pull request.

A release is a semver tag `vX.Y.Z`, the matching `version` in `.claude-plugin/plugin.json`, and a hand-written `CHANGELOG.md` entry, with no changesets. Without a version bump, installed plugin users never see the update.
