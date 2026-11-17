// Helpers shared by the tests: writing fixture kits, running a CLI the way CI
// runs it, asserting on its findings, and reading a section of a skill's text.
// Not a test file itself.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const validateCli = join(repoRoot, 'scripts', 'validate-kit.mjs');
export const syncCli = join(repoRoot, 'scripts', 'sync-upstreams.mjs');
export const checkSpecCli = join(repoRoot, 'skills', 'aw-check-spec', 'scripts', 'check-spec.mjs');

export const json = (value) => JSON.stringify(value, null, 2) + '\n';

// Writes each relative path's content: a string, a Buffer, or an object
// written as JSON. An undefined content is skipped.
export function writeFiles(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    if (content === undefined) continue;
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    const isRaw = typeof content === 'string' || Buffer.isBuffer(content);
    writeFileSync(full, isRaw ? content : json(content));
  }
}

// The plugin and marketplace manifests of a fixture kit listing `skills`.
export function manifests(skills) {
  return {
    '.claude-plugin/plugin.json': {
      name: 'fixture-kit',
      version: '1.2.3',
      skills: skills.map((name) => `./skills/${name}`),
    },
    '.claude-plugin/marketplace.json': {
      name: 'fixture-kit',
      owner: { name: 'fixture' },
      plugins: [{ name: 'fixture-kit', source: './', version: '1.2.3' }],
    },
  };
}

// The text of a skill's file, from the line `fromHeading` up to the first line
// `toHeading` after it, or to the end when `toHeading` is omitted.
// `skillOrFile` is a skill's name, which reads its SKILL.md, or a path under
// `skills/` to another file of a skill. Line endings are normalized to `\n`. A
// heading is a whole line, and a missing one throws, naming it.
export function skillSection(skillOrFile, fromHeading, toHeading) {
  const file = skillOrFile.includes('/') ? skillOrFile : `${skillOrFile}/SKILL.md`;
  const lines = readFileSync(join(repoRoot, 'skills', file), 'utf8').replaceAll('\r\n', '\n').split('\n');
  const start = lines.indexOf(fromHeading);
  if (start === -1) throw new Error(`skills/${file} has no heading "${fromHeading}"`);
  if (toHeading === undefined) return lines.slice(start).join('\n');
  const end = lines.indexOf(toHeading, start + 1);
  if (end === -1) throw new Error(`skills/${file} has no heading "${toHeading}" after "${fromHeading}"`);
  return lines.slice(start, end).join('\n') + '\n';
}

// Runs a CLI with node; every non-blank stdout line is a finding.
export function runCli(cli, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const findings = result.stdout.split('\n').filter((line) => line.trim() !== '');
  return { status: result.status, findings, stdout: result.stdout, stderr: result.stderr };
}

// Asserts the CLI passed with no findings.
export function assertNoFindings({ status, findings, stderr }) {
  assert.deepEqual(findings, [], stderr);
  assert.equal(status, 0);
}

// Asserts the CLI failed with exactly one finding, and that it matches.
export function assertOneFinding({ status, findings }, pattern) {
  assert.equal(findings.length, 1, `expected one finding, got:\n${findings.join('\n')}`);
  assert.match(findings[0], pattern);
  assert.notEqual(status, 0);
}
