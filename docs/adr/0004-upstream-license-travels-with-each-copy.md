# The upstream license travels inside each copy's folder

The repo is MIT-licensed, copyright `samfaina`. Each copy carries its upstream license as `LICENSE.upstream` inside its own folder, and its text changes only by the mechanical transform (ADR 0001). A root `NOTICE.md` lists every copied or adapted skill with its upstream, pinned commit and kind. This is because `npx skills` installs one skill folder at a time, and MIT requires the copyright notice to accompany every copy. A single root `THIRD_PARTY_LICENSES` file would be left behind on every such install.

## Consequences

- Adapted skills are credited in `NOTICE.md` but do not carry the upstream license text, with one exception: an adaptation that keeps almost all of its upstream's text also carries `LICENSE.upstream`. It installs one folder at a time too, and MIT requires the copyright notice to accompany substantial portions. `aw-security-and-hardening` is the case that motivates this.
- Before anything is copied verbatim from an upstream whose license has not been read at its source, a `research` ticket must confirm the license. pstack's has been read: `pstack/LICENSE` in `cursor/plugins`, at `c742dd6`, the last commit that touches that folder, is MIT, copyright Lauren Tan. The kit takes only adaptations and inspired skills from pstack, credited in `NOTICE.md`; it is not in `upstreams.json` and nothing syncs it. A copy would not pass `validate-kit` anyway: its skills declare `disable-model-invocation: true` without an `agents/openai.yaml`, and the mechanical transform cannot add one.
