// Checks, in a fast-route working copy, that each test the branch adds under a
// `done when:` name quotes a `Done when:` line of the latest commit that carries
// them, whole and verbatim (#123). A final period may be dropped, and a suffix
// after a space, a bracket or a punctuation mark may name the part a test
// proves. Prints one line per problem and exits 1 when there is any.

import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

const criteria = git('log', '-1', '--format=%B', '--grep=Done when:')
  .split('\n')
  .filter((line) => line.startsWith('Done when: '))
  .map((line) => line.slice('Done when: '.length).trimEnd());

// The lines the branch adds to test files: files under a tests/ or test/
// folder, or named *.test.* or *.spec.*.
const isTestFile = (path) => /(^|\/)tests?\//.test(path) || /\.(test|spec)\.[^/]+$/.test(path);
let inTestFile = false;
const added = [];
for (const line of git('diff', '-U0', 'origin/main', 'HEAD').split('\n')) {
  if (line.startsWith('+++ ')) inTestFile = line.startsWith('+++ b/') && isTestFile(line.slice('+++ b/'.length));
  else if (inTestFile && line.startsWith('+')) added.push(line);
}

// String literals that open with `done when: `, with their escapes undone.
const names = added.flatMap((line) =>
  [...line.matchAll(/(["'`])(done when: (?:\\.|(?!\1)[^\\])*)\1/g)].map((match) => match[2].replace(/\\(.)/g, '$1')),
);

const quotes = (body, criterion) =>
  [criterion, criterion.replace(/\.$/, '')].some(
    (quoted) => body === quoted || (body.startsWith(quoted) && /^[\s([:;,—–-]/.test(body.slice(quoted.length))),
  );

const problems = [];
if (criteria.length === 0) problems.push('no commit carries Done when: lines');
if (names.length === 0) problems.push('no test the branch adds is named done when: <criterion>');
for (const name of names) {
  const body = name.slice('done when: '.length);
  if (!criteria.some((criterion) => quotes(body, criterion))) problems.push(`quotes no Done when: line verbatim: ${name}`);
}

if (problems.length > 0) {
  console.log(problems.join('\n'));
  process.exit(1);
}
