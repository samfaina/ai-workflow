# Review: {{BRANCH}} at {{SHORT}}

- Diff base: main
- Spec axis judged against: the done-when criteria
- Proven defects: 1 introduced, 0 pre-existing

## Spec

### Defects introduced

**src/loan-labels.mjs:2: the done-when criterion does not hold: `titleLabel` does not put the title in capitals.**

- Run: `node -e "import('./src/loan-labels.mjs').then((m) => console.log(m.titleLabel('dune')))"` at {{SHORT}}.
- Output: `dune`.

## Standards

No findings.

## Security

No findings.
