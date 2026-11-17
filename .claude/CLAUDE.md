## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (samfaina/ai-workflow) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Changing a rule

Skills are self-contained, so a rule is often restated word for word in several skills. When a change alters a rule, `git grep` its wording under `skills/` and treat every copy as part of the change, in the ticket's scope and in its diff.
