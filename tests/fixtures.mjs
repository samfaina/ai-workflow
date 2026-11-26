// Helpers shared by the tests: writing fixture kits, running a CLI the way CI
// runs it, asserting on its findings, reading a section or a line of a skill's
// file or of any text, and listing a folder's Markdown files. Not a test file
// itself.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  const file = skillFile(skillOrFile);
  const lines = readSkillFile(file).split('\n');
  const start = lines.indexOf(fromHeading);
  if (start === -1) throw new Error(`skills/${file} has no heading "${fromHeading}"`);
  if (toHeading === undefined) return lines.slice(start).join('\n');
  const end = lines.indexOf(toHeading, start + 1);
  if (end === -1) throw new Error(`skills/${file} has no heading "${toHeading}" after "${fromHeading}"`);
  return lines.slice(start, end).join('\n') + '\n';
}

// The first line of `text` that starts with `start`. Line endings are
// normalized to `\n`. When no line starts with it, it throws, naming `start`.
export function textLine(text, start) {
  const line = findLine(text, start);
  if (line === undefined) throw new Error(`the text has no line starting "${start}"`);
  return line;
}

// The first line of a skill's file that starts with `start`. `skillOrFile` is
// read as `skillSection` reads it. When no line starts with it, it throws,
// naming the file and `start`.
export function skillLine(skillOrFile, start) {
  const file = skillFile(skillOrFile);
  const line = findLine(readSkillFile(file), start);
  if (line === undefined) throw new Error(`skills/${file} has no line starting "${start}"`);
  return line;
}

const findLine = (text, start) => text.replaceAll('\r\n', '\n').split('\n').find((candidate) => candidate.startsWith(start));

// A skill's name stands for its SKILL.md; any other value is a path under
// `skills/`. The file is read with its line endings normalized to `\n`.
const skillFile = (skillOrFile) => (skillOrFile.includes('/') ? skillOrFile : `${skillOrFile}/SKILL.md`);
const readSkillFile = (file) => readFileSync(join(repoRoot, 'skills', file), 'utf8').replaceAll('\r\n', '\n');

// The lines of `text` from the line `heading` up to, but not including, the
// next heading line of the same or a higher level (fewer or as many `#`, then a
// space), or to the end of the text. A line inside a code fence, between lines
// that start with three backticks, never ends the section. With `withHeading:
// false` the heading line itself is left out. Line endings are normalized to
// `\n`. A heading is a whole line, and a missing one throws, naming it.
export function textSection(text, heading, { withHeading = true } = {}) {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) throw new Error(`the text has no heading "${heading}"`);
  const level = heading.match(/^#+/)[0].length;
  let fenced = false;
  const end = lines.findIndex((line, i) => {
    if (i <= start) return false;
    if (line.startsWith('```')) fenced = !fenced;
    return !fenced && (line.match(/^#+(?= )/)?.[0].length ?? Infinity) <= level;
  });
  return lines.slice(withHeading ? start : start + 1, end === -1 ? undefined : end).join('\n');
}

// Every Markdown file under `dir`, at any depth, as a path from the repo root
// that starts with `dir`.
export function markdownFiles(dir) {
  return readdirSync(join(repoRoot, dir), { recursive: true })
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => join(dir, entry));
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
