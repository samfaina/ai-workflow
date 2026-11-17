// Checks, in a working copy that aw-ship merged locally, that the rollback plan
// of the latest review request body names the merge commit on main, and so does
// its open-review copy when step 6 wrote one (#128). A copy counts when its name
// sorts at or after the body's, since step 6 writes it after step 5. Prints one
// line per problem and exits 1 when there is any.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const latest = (folder, suffix) =>
  existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(suffix)).sort().at(-1) : undefined;

const problems = [];
const merge = git('rev-parse', 'main');
if (git('rev-list', '--parents', '-n', '1', 'main').split(' ').length !== 3) problems.push('main is not a merge commit');

const files = [];
const body = latest('.aw/review-requests', '-review-request.md');
if (body) {
  files.push(join('.aw/review-requests', body));
  const copy = latest('.aw/drafts', '-open-review.md');
  if (copy && copy >= body.replace('-review-request.md', '')) files.push(join('.aw/drafts', copy));
} else {
  problems.push('no review request body under .aw/review-requests/');
}

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (text.includes('<merge commit>')) problems.push(`${file} still holds <merge commit>`);
  const named = text.match(/git revert -m 1 ([0-9a-f]{7,40})\b/)?.[1];
  if (!named) problems.push(`${file} names no git revert -m 1 <hash>`);
  else if (!merge.startsWith(named)) problems.push(`${file} names ${named}, not the merge commit ${merge.slice(0, named.length)}`);
}

if (problems.length > 0) {
  console.log(problems.join('\n'));
  process.exit(1);
}
