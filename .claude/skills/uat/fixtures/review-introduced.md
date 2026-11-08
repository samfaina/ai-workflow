# Review: {{BRANCH}} at {{SHORT}}

- Diff base: main
- Spec axis judged against: docs/specs/renew-loan/spec.md
- Proven defects: 1 introduced, 1 pre-existing

## Spec

No findings.

## Standards

### Pre-existing

**package-lock.json: a dev dependency has a known advisory.**

- Run: `npm audit`, the same at HEAD and at the merge-base.

## Security

### Defects introduced

**src/mask-member-id.mjs:3: a member id reaches the log unmasked.**

- Run: `node -e "import('./src/mask-member-id.mjs').then((m) => console.log(m.maskMemberId('M-123456')))"` at {{SHORT}}.
- Output: `M-123456`. Only the last four characters should show: `****3456`.

### Risks introduced

**src/retry-delay.mjs:1: a fixed retry delay may overload the catalogue service.**

- Likelihood: low, it depends on a catalogue outage.
- Cost: slower recovery for every member during that outage.
