import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The /uat folder a cases folder belongs to: it holds the fixtures a case's
// `copy` reads and the UAT ledger. It is this skill's own folder unless a run
// named another cases folder.
export const skillFolderOf = (casesDir) => dirname(casesDir);

export const fixtureFile = (casesDir, copy) => join(skillFolderOf(casesDir), copy);

const text = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// What a UAT case holds: its file and every fixture its setup copies, line
// endings normalized. The UAT ledger keeps it beside a verdict, and a case is
// due when it no longer matches. Only content and paths inside the skill go
// in, so a fingerprint is the same on every machine.
export function fingerprint(casesDir, id) {
  const caseText = text(join(casesDir, `${id}.json`));
  const hash = createHash('sha256').update(caseText);
  for (const op of JSON.parse(caseText).setup ?? []) {
    if (op.copy !== undefined) hash.update(`\0${op.copy}\0${text(fixtureFile(casesDir, op.copy))}`);
  }
  return hash.digest('hex');
}
