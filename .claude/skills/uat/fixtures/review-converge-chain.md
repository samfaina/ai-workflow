# Review: {{BRANCH}} at {{SHORT}}

- Diff base: main
- Spec axis judged against: the done-when criteria
- Proven defects: 1 introduced, 0 pre-existing

## Spec

### Defects introduced

**src/loan-line.mjs:2: the done-when criterion does not hold: `loanLine` throws on a loan that has a title.**

- Run: `node -e "import('./src/loan-line.mjs').then((m) => console.log(m.loanLine({ title: 'Dune', due: '2030-01-15', renewals: 1, limits: { renewals: 3 } })))"` at {{SHORT}}.
- Output: `TypeError: Cannot read properties of undefined (reading 'title')`. It should read `Dune, due 2030-01-15, 2 renewals left`.

## Standards

No findings.

## Security

No findings.
