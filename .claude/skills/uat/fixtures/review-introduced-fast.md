# Review: {{BRANCH}} at {{SHORT}}

- Diff base: main
- Spec axis judged against: the done-when criteria
- Proven defects: 1 introduced, 0 pre-existing

## Spec

### Defects introduced

**src/mask-member-id.mjs:3: the done-when criterion does not hold: a member id reaches the log unmasked.**

- Run: `node -e "import('./src/mask-member-id.mjs').then((m) => console.log(m.maskMemberId('M-123456')))"` at {{SHORT}}.
- Output: `M-123456`. Only the last four characters should show: `****3456`.

## Standards

No findings.

## Security

No findings.
