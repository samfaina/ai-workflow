import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The /uat folder a cases folder belongs to: it holds the fixtures a case's
// `copy` reads and the UAT ledger. It is this skill's own folder unless a run
// named another cases folder.
export const skillFolderOf = (casesDir) => dirname(casesDir);

export const fixtureFile = (casesDir, copy) => join(skillFolderOf(casesDir), copy);

const text = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// What a UAT case holds: its parsed content without `order`, and every
// fixture its setup copies, line endings normalized. `order` is only the
// case's place in a full run, and inserting a case renumbers every later one,
// so it does not count; nor does formatting, since everything reads a case
// through JSON.parse. Keys keep their order, so reordering them still counts.
// The UAT ledger keeps it beside a verdict, and a case is due when it no
// longer matches. Only content and paths inside the skill go in, so a
// fingerprint is the same on every machine.
export function fingerprint(casesDir, id) {
  const { order, ...content } = JSON.parse(readFileSync(join(casesDir, `${id}.json`), 'utf8'));
  const hash = createHash('sha256').update(JSON.stringify(content));
  for (const op of content.setup ?? []) {
    if (op.copy !== undefined) hash.update(`\0${op.copy}\0${text(fixtureFile(casesDir, op.copy))}`);
  }
  return hash.digest('hex');
}
