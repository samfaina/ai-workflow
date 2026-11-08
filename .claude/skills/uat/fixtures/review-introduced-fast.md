# Review: {{BRANCH}} at {{SHORT}}

- Diff base: main
- Spec axis judged against: the done-when criteria
- Proven defects: 1 introduced, 0 pre-existing

## Spec

### Defects introduced

**src/loan-count-label.mjs:3: the done-when criterion does not hold: a count of one reads "1 loans".**

- Run: `node -e "import('./src/loan-count-label.mjs').then((m) => console.log(m.loanCountLabel(1)))"` at {{SHORT}}.
- Output: `1 loans`. It should read `1 loan`.

## Standards

No findings.

## Security

No findings.
