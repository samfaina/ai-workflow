// Upstream sync: the manifest, the lock, the mechanical transform and the
// three modes of scripts/sync-upstreams.mjs (ADRs 0001, 0004, 0015).
// Maintainer-only, never ships to user repos. scripts/validate-kit.mjs
// imports `check`, `readUpstreams`, `replacedFinding` and `readJsonFile` from
// here.
//
// upstreams.json pins each upstream and lists the skills copied from it:
//
//   { "upstreams": { "<key>": {
//       "repo": "<git URL, or a local directory holding a git repo>",
//       "commit": "<full commit SHA>",
//       "release": "<upstream tag at that commit, if any>",
//       "reason": "<why this pin was chosen>",
//       "license": "<the upstream license file, LICENSE by default>",
//       "skills": { "<upstream name>": "<folder in the upstream repo>" } } } }
//
// A skill that points to shared files outside its folder is written as
// `{ "path": "<folder>", "shared": ["<file, by its path from the upstream's root>"] }`
// instead of the bare folder.
//
// An upstream may also declare which of its uncopied skills a kit skill
// replaces, so a copy that refers to one points at the kit skill instead:
//
//       "replaced": { "<upstream name>": "<kit skill name>" }
//
// A replaced name may not be a copied skill of any upstream, and its kit
// skill carries the `aw-` prefix but is not the name of a copy. `install` and
// `check` accept a kit skill with no folder; scripts/validate-kit.mjs does not.
//
// `release` and `reason` record the choice of pin for people; no code reads
// them. Each copied skill lands in skills/aw-<upstream name>/.
//
// upstreams.lock.json records, for each copy, the git tree hash of its
// upstream folder at the pin and the mode and git blob hash of every file in
// it, plus the blob hash of the upstream license. A skill with shared files
// also records the mode and blob hash of each, under "shared". The tree hash is the one
// `git rev-parse <commit>:<folder>` prints, so the lock can be checked against
// the upstream, and `check` verifies that the file hashes add up to it.
//
// `check` needs only the lock and the copies, so it runs offline. It undoes
// the transform on each copied file, compares the result to the locked
// upstream hash, and redoes the transform to confirm the copy carries every
// rename, path rewrite and mapping it makes. It also reports any path in a
// copy that still climbs out of the copy's folder.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';

export const PREFIX = 'aw-';
export const MANIFEST = 'upstreams.json';
export const LOCK = 'upstreams.lock.json';
export const LICENSE_FILE = 'LICENSE.upstream';

const INSTALL_HINT = 'run `node scripts/sync-upstreams.mjs install`';

export class SyncError extends Error {}

// ---------------------------------------------------------------------------
// Manifest and lock

// `{ value }` with the parsed JSON, `{ missing: true }` when the file does not
// exist, or `{ finding }` when it is not valid JSON.
export function readJsonFile(dir, path) {
  const full = join(dir, path);
  if (!existsSync(full)) return { missing: true };
  try {
    return { value: JSON.parse(readFileSync(full, 'utf8')) };
  } catch (error) {
    return { finding: `${path}: invalid JSON (${error.message})` };
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// `a\b/` becomes `a/b`.
const toPosix = (path) => path.replace(/\\/g, '/').replace(/\/+$/, '');

// `./skills/aw-x/` and `skills\\aw-x` both become `skills/aw-x`.
export function normalizeSkillPath(entry) {
  return entry.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

// A file named by its path from a repo's root: relative, with no `.` or `..`
// segment and no empty one.
const isRepoFile = (path) => path !== '' && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

// The copies upstreams.json declares, flattened, with any findings about the
// manifest's shape. A kit without upstreams.json has no copies.
export function readUpstreams(dir) {
  const read = readJsonFile(dir, MANIFEST);
  if (read.missing) return { upstreams: [], copies: [], findings: [] };
  if (read.finding) return { upstreams: [], copies: [], findings: [read.finding] };

  const findings = [];
  const upstreams = [];
  const copies = [];
  const entries = isObject(read.value.upstreams) ? Object.entries(read.value.upstreams) : [];
  if (!isObject(read.value.upstreams)) findings.push(`${MANIFEST}: "upstreams" must be an object`);

  for (const [key, entry] of entries) {
    const at = `${MANIFEST}: upstream "${key}"`;
    if (!isObject(entry)) {
      findings.push(`${at} must be an object`);
      continue;
    }
    if (typeof entry.repo !== 'string' || entry.repo === '') findings.push(`${at} needs a "repo"`);
    if (typeof entry.commit !== 'string' || !/^[0-9a-f]{40}$/.test(entry.commit)) {
      findings.push(`${at} needs a "commit" that is a full 40-character SHA`);
    }
    if (!isObject(entry.skills)) findings.push(`${at} needs "skills", an object of name to folder`);
    const replaced = entry.replaced ?? {};
    const validReplaced = isObject(replaced) && Object.values(replaced).every((to) => typeof to === 'string');
    if (!validReplaced) findings.push(`${at} needs "replaced" to be an object of upstream name to kit skill`);
    const upstream = {
      key,
      repo: entry.repo,
      commit: entry.commit,
      license: typeof entry.license === 'string' ? entry.license : 'LICENSE',
      replaced: validReplaced ? replaced : {},
      skills: [],
    };
    for (const [name, value] of Object.entries(isObject(entry.skills) ? entry.skills : {})) {
      const { path, shared = [] } = isObject(value) ? value : { path: value };
      if (typeof path !== 'string' || path === '') {
        findings.push(`${at}: skill "${name}" needs the folder it lives in upstream`);
        continue;
      }
      const sharedPaths = Array.isArray(shared) ? shared.map((file) => (typeof file === 'string' ? toPosix(file) : '')) : null;
      if (sharedPaths === null || !sharedPaths.every(isRepoFile)) {
        findings.push(`${at}: skill "${name}" needs "shared" to list files by their path from the upstream's root`);
        continue;
      }
      const earlier = copies.find((copy) => copy.name === name);
      if (earlier) {
        findings.push(`${at}: skill "${name}" is already copied from upstream "${earlier.upstream.key}"`);
        continue;
      }
      const copy = { upstream, name, path: toPosix(path), folder: PREFIX + name, shared: [...new Set(sharedPaths)].sort() };
      upstream.skills.push(copy);
      copies.push(copy);
    }
    upstreams.push(upstream);
  }
  findings.push(...replacedFindings(upstreams, copies));
  return { upstreams, copies, findings };
}

// Findings about each upstream's "replaced", checked once every copy is known.
function replacedFindings(upstreams, copies) {
  return upstreams.flatMap((upstream) =>
    Object.entries(upstream.replaced)
      .map(([from, to]) => replacedFinding(upstream, from, to, copies))
      .filter((finding) => finding !== null));
}

// The finding about one "replaced" entry, or null when readUpstreams accepts it.
export function replacedFinding(upstream, from, to, copies) {
  const at = `${MANIFEST}: upstream "${upstream.key}"`;
  const copied = copies.find((copy) => copy.name === from);
  if (copied) {
    return `${at}: replaced skill "${from}" is copied from upstream "${copied.upstream.key}"; a copied skill is renamed, not replaced`;
  }
  if (!to.startsWith(PREFIX) || to === PREFIX) {
    return `${at}: replaced skill "${from}" maps to "${to}", which lacks the ${PREFIX} prefix of a kit skill`;
  }
  if (copies.some((copy) => copy.folder === to)) {
    return `${at}: replaced skill "${from}" maps to "${to}", the copy of "${to.slice(PREFIX.length)}"; it must map to a kit skill`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The mechanical transform (ADR 0001), rename part
//
// A reference to a copied skill is its upstream name written in one of the
// forms upstream skills use to point at each other:
//
//   - in double quotes: call the Skill tool with "codebase-design";
//   - as a slash command: the `/codebase-design` skill;
//   - in backticks followed by "skill": the `codebase-design` skill;
//   - as the backticked text of a link: [`writing-for-agents`](SKILL.md).
//
// The copy's own SKILL.md also has its frontmatter `name:` renamed. Any other
// use of a name is left alone: prose ("a research question"), a bare
// backticked word (include the word `prototype` in the path) or a path
// (`/prototype/<name>`). `install` lists the quoted ones it left alone, so a
// reference in a form this list lacks does not slip through unseen. `install`
// also fails on a reference, in these forms, to a skill of the copy's own
// upstream that the kit neither copies nor replaces.

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const alternation = (names) =>
  [...names]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');

// The reference forms, in the order the rename applies them. `pattern` matches
// only the name, so a rewrite leaves the rest of the form as it is; `mention`
// spells a reference out for a person. The rename, the mapping and the search
// for references to uncopied skills all read this list, so they cannot drift
// apart.
const REFERENCE_FORMS = [
  { pattern: (tokens) => `(?<=")(?:${tokens})(?=")`, mention: (name) => `"${name}"` },
  { pattern: (tokens) => `(?<=\`)(?:${tokens})(?=\` skill\\b)`, mention: (name) => `\`${name}\` skill` },
  { pattern: (tokens) => `(?<=\\[\`)(?:${tokens})(?=\`\\]\\()`, mention: (name) => `[\`${name}\`]` },
  { pattern: (tokens) => `(?<=(?<![^\\s\`"'(\\[])/)(?:${tokens})(?![\\w/-]|\\.\\w)`, mention: (name) => `/${name}` },
];

// Replaces every reference to a key of `pairs` with its value.
function swapReferences(text, pairs) {
  const froms = Object.keys(pairs);
  if (froms.length === 0) return text;
  const tokens = alternation(froms);
  return REFERENCE_FORMS.reduce(
    (swapped, form) => swapped.replace(new RegExp(form.pattern(tokens), 'g'), (name) => pairs[name]),
    text,
  );
}

// Every reference to one of `names` in `text`, in reading order, as
// `{ line, mention }`.
function findReferences(text, names) {
  if (names.length === 0) return [];
  const tokens = alternation(names);
  const forms = REFERENCE_FORMS.map(({ pattern, mention }) => ({ pattern: new RegExp(pattern(tokens), 'g'), mention }));
  return text.split('\n').flatMap((line, index) =>
    forms
      .flatMap(({ pattern, mention }) => [...line.matchAll(pattern)].map((match) => ({ at: match.index, mention: mention(match[0]) })))
      .sort((a, b) => a.at - b.at)
      .map(({ mention }) => ({ line: index + 1, mention })),
  );
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/;

// The value of the `name:` field in a SKILL.md's frontmatter, or null when it
// has none.
function skillName(text) {
  const name = text.match(FRONTMATTER)?.[0].match(/^name:[ \t]*(["']?)(.*?)\1[ \t]*\r?$/m)?.[2];
  return name || null;
}

// Renames `from` to `to` in the `name:` field of SKILL.md's frontmatter.
function swapName(text, file, from, to) {
  if (file !== 'SKILL.md') return text;
  const match = text.match(FRONTMATTER);
  if (!match) return text;
  const head = match[0].replace(
    new RegExp(`^(name:[ \\t]*)(["']?)${escapeRegExp(from)}\\2([ \\t]*\\r?)$`, 'm'),
    (_m, key, quote, tail) => `${key}${quote}${to}${quote}${tail}`,
  );
  return head + text.slice(match[0].length);
}

// The rename for one copy, given the names of every copied skill: `apply`
// turns upstream text into copy text, `undo` turns it back.
function renamerFor(copy, names) {
  const toCopy = Object.fromEntries(names.map((name) => [name, PREFIX + name]));
  const toUpstream = Object.fromEntries(names.map((name) => [PREFIX + name, name]));
  const copyName = PREFIX + copy.name;
  return {
    apply: (text, file) => swapName(swapReferences(text, toCopy), file, copy.name, copyName),
    undo: (text, file) => swapName(swapReferences(text, toUpstream), file, copyName, copy.name),
  };
}

// ---------------------------------------------------------------------------
// The mechanical transform (ADR 0001), relocation part
//
// A shared upstream file is one outside the skill's folder that the skill
// points to, such as a repo-level references/security-checklist.md.
// upstreams.json lists it under the skill's "shared", by its path from the
// upstream's root, and the copy holds it at that same path inside its folder:
// references/security-checklist.md lands in
// skills/aw-<name>/references/security-checklist.md.
//
// A path to a shared file is the relative path from the directory of the
// file that names it to the shared file, as upstream writes it (from a
// skill's SKILL.md, `../../references/security-checklist.md`). In the copy it
// becomes the relative path from the copy's file to the relocated one
// (`references/security-checklist.md`). Only that exact string is a path:
// it may be followed by an `#anchor` but not by more path, and the same
// words without the leading `../` are left alone.

// The path from the directory holding `from` to `to`, both repo-relative.
const relativePath = (from, to) => posix.relative(posix.dirname(`/${from}`), `/${to}`);

// Replaces each key of `pairs` with its value where it stands as a whole path.
function swapPaths(text, pairs) {
  const froms = Object.keys(pairs);
  if (froms.length === 0) return text;
  return text.replace(new RegExp(`(?<![\\w./-])(${alternation(froms)})(?![\\w/-]|\\.\\w)`, 'g'), (_m, path) => pairs[path]);
}

// The path rewrite for one file of a copy, given its path inside the copy.
// `toCopy` maps each path to a shared file as upstream writes it to the path
// the copy uses, `toUpstream` maps back.
function pathPairsFor(copy, file) {
  const upstreamFile = copy.shared.includes(file) ? file : `${copy.path}/${file}`;
  const toCopy = {};
  const toUpstream = {};
  for (const shared of copy.shared) {
    const from = relativePath(upstreamFile, shared);
    const to = relativePath(file, shared);
    if (from === to) continue;
    toCopy[from] = to;
    toUpstream[to] = from;
  }
  return { toCopy, toUpstream };
}

// ---------------------------------------------------------------------------
// The mechanical transform (ADR 0001), mapping part
//
// A replaced skill is an upstream skill the kit does not copy but replaces
// with a kit skill of its own, as aw-review replaces Pocock's code-review.
// The copy's upstream lists it under "replaced". A reference to it, in the
// same forms the rename knows, points at the kit skill instead, so a copy
// never sends the agent to a skill that is gone once the upstream's plugin
// is disabled. The kit skill's name must not already appear in upstream text
// in a reference form, or `undo` could not tell the two apart; `install`
// fails on such a file.

// The mapping for one copy: `apply` points references to a replaced skill at
// its kit skill, `undo` points them back.
function mapperFor(copy) {
  const toKit = copy.upstream.replaced;
  const toUpstream = Object.fromEntries(Object.entries(toKit).map(([from, to]) => [to, from]));
  return {
    apply: (text) => swapReferences(text, toKit),
    undo: (text) => swapReferences(text, toUpstream),
  };
}

// The mechanical transform for one copy, given the names of every copied
// skill: `apply` turns upstream text into copy text and `undo` turns it back.
// `missingRewrite` tells whether copy text still holds a path to a shared
// file as upstream wrote it, and `missingMapping` whether it still refers to
// a replaced skill. `leftAlone` lists the uses of a copied or replaced name
// the transform left in copy text. `file` is the path inside the copy.
function transformFor(copy, names) {
  const renamer = renamerFor(copy, names);
  const mapper = mapperFor(copy);
  return {
    apply: (text, file) => mapper.apply(renamer.apply(swapPaths(text, pathPairsFor(copy, file).toCopy), file)),
    undo: (text, file) => swapPaths(renamer.undo(mapper.undo(text), file), pathPairsFor(copy, file).toUpstream),
    missingRewrite: (text, file) => swapPaths(text, pathPairsFor(copy, file).toCopy) !== text,
    missingMapping: (text) => mapper.apply(text) !== text,
    leftAlone: (text) => leftAlone(text, [...names, ...Object.keys(copy.upstream.replaced)]),
  };
}

// Quoted or backticked uses of a copied or replaced name, and paths through a
// folder of that name, that the transform left in `text`, as `{ line, mention }`.
function leftAlone(text, names) {
  if (names.length === 0) return [];
  const tokens = alternation(names);
  const pattern = new RegExp(`\`(?:${tokens})\`|'(?:${tokens})'|(?<![\\w-])/(?:${tokens})/`, 'g');
  const mentions = [];
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(pattern)) mentions.push({ line: index + 1, mention: match[0] });
  });
  return mentions;
}

// Text is UTF-8 without NUL bytes; anything else is copied byte for byte.
function asText(bytes) {
  if (bytes.includes(0)) return null;
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null;
}

// ---------------------------------------------------------------------------
// Git object hashes, computed the way git computes them

const objectHash = (type, body) => createHash('sha1').update(`${type} ${body.length}\0`).update(body).digest('hex');

const blobHash = (bytes) => objectHash('blob', bytes);

// The tree hash of a folder from its files, given as
// `{ "<relative path>": { mode, blob } }`. Git sorts a tree's entries by name,
// comparing a subtree's name as if it ended in "/".
function treeHash(files) {
  const entries = [];
  const subtrees = {};
  for (const [path, entry] of Object.entries(files)) {
    const slash = path.indexOf('/');
    if (slash === -1) entries.push({ name: path, mode: entry.mode, hash: entry.blob });
    else (subtrees[path.slice(0, slash)] ??= {})[path.slice(slash + 1)] = entry;
  }
  for (const [name, subtree] of Object.entries(subtrees)) {
    entries.push({ name, mode: '40000', hash: treeHash(subtree) });
  }
  const sortKey = (entry) => Buffer.from(entry.mode === '40000' ? `${entry.name}/` : entry.name);
  entries.sort((a, b) => Buffer.compare(sortKey(a), sortKey(b)));
  const body = Buffer.concat(
    entries.flatMap((entry) => [Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(entry.hash, 'hex')]),
  );
  return objectHash('tree', body);
}

// ---------------------------------------------------------------------------
// check

function copyFiles(dir) {
  const files = [];
  const walk = (relative) => {
    for (const entry of readdirSync(join(dir, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk('');
  return files.sort();
}

// A copied file passes when undoing the transform gives the locked upstream
// blob and redoing it gives the copy back. A copy checked out with CRLF line
// endings is compared with LF ones too (ADR 0008); the validator reports the
// CRLF on its own.
function checkFile(at, bytes, expectedBlob, file, transform) {
  const text = asText(bytes);
  if (text === null) {
    return blobHash(bytes) === expectedBlob ? [] : [`${at}: differs from upstream at the pin; a copy may change only by the mechanical transform`];
  }
  const candidates = text.includes('\r\n') ? [text, text.replace(/\r\n/g, '\n')] : [text];
  for (const candidate of candidates) {
    const upstream = transform.undo(candidate, file);
    if (blobHash(Buffer.from(upstream, 'utf8')) !== expectedBlob) continue;
    if (transform.apply(upstream, file) === candidate) return [];
    if (transform.missingRewrite(candidate, file)) {
      return [`${at}: a path rewrite is missing; the mechanical transform rewrites every path to a shared file to point inside the copy`];
    }
    if (transform.missingMapping(candidate)) {
      return [`${at}: a mapping is missing; the mechanical transform points every reference to a replaced skill at the kit skill that replaces it`];
    }
    return [`${at}: a rename is missing; the mechanical transform adds the aw- prefix to the name: field and to every reference to a copied skill`];
  }
  return [`${at}: differs from upstream plus the mechanical transform; a copy may not be edited by hand`];
}

// A relative path that climbs: one or more `../` then at least one path
// segment, to a file with or without an extension or to a folder with or
// without a trailing `/`, optionally followed by an `#anchor`. A bare `../`
// or `..`, as in code that tests for it, has no named segment and is not a
// path; nor is a run of them such as `../..`. A `../` right after a word
// character, `.`, `/` or `-` is inside a longer path or word, so it does not
// start one. outsidePaths() keeps only the matches that resolve outside the
// copy's folder. Only a trailing `/` marks a match as a folder: offline,
// `../shared` and `../Makefile` look alike, so both get the file hint.
const CLIMBING_PATH = /(?<![\w./-])((?:\.\.\/)+(?:[\w.-]+\/)*[\w.-]*[\w-]\/?)(#[\w-]*)?/g;

// One finding per path in a copied file that resolves outside the copy's
// folder (ADR 0002: a copy is installed one folder at a time).
function outsidePaths(at, bytes, file) {
  const text = asText(bytes);
  if (text === null) return [];
  const findings = [];
  text.split('\n').forEach((line, index) => {
    for (const [match, path] of line.matchAll(CLIMBING_PATH)) {
      if (!posix.normalize(posix.join(posix.dirname(file), path)).startsWith('../')) continue;
      const hint = path.endsWith('/') ? 'list the files the copy needs from it' : 'list the file';
      findings.push(`${at}:${index + 1}: points outside the copy's folder: ${match}; ${hint} under "shared" in ${MANIFEST}`);
    }
  });
  return findings;
}

// True when a shared file would land on a file the copy already has: one of
// the skill's own files, given as an object keyed by path, or LICENSE.upstream.
const clashesWithSkill = (file, skillFiles) => file in skillFiles || file === LICENSE_FILE;

const isLockedFile = (entry) => isObject(entry) && typeof entry.mode === 'string' && typeof entry.blob === 'string';

// True when the lock holds exactly the shared files upstreams.json lists for
// the copy, none of them clashing with a file of the skill.
function locksShared(lockedSkill, copy) {
  const shared = lockedSkill.shared ?? {};
  if (!isObject(shared) || !Object.values(shared).every(isLockedFile)) return false;
  const files = Object.keys(shared).sort();
  return (
    files.length === copy.shared.length &&
    files.every((file, index) => file === copy.shared[index] && !clashesWithSkill(file, lockedSkill.files))
  );
}

function checkCopy(dir, copy, lockedSkill, licenseBlob, transform) {
  const at = `skills/${copy.folder}`;
  const copyDir = join(dir, at);
  if (!existsSync(copyDir) || !statSync(copyDir).isDirectory()) {
    return [`${at}: copy is missing; ${INSTALL_HINT}`];
  }
  const expected = { [LICENSE_FILE]: licenseBlob };
  for (const [file, entry] of Object.entries(lockedSkill.files)) expected[file] = entry.blob;
  for (const [file, entry] of Object.entries(lockedSkill.shared ?? {})) expected[file] = entry.blob;
  const actual = copyFiles(copyDir);
  const findings = [];
  for (const file of Object.keys(expected).sort()) {
    if (actual.includes(file)) continue;
    findings.push(
      file === LICENSE_FILE
        ? `${at}/${LICENSE_FILE}: missing; a copy carries its upstream license (ADR 0004)`
        : copy.shared.includes(file)
          ? `${at}/${file}: missing; the mechanical transform relocates the shared upstream file ${file} here`
          : `${at}/${file}: missing; the upstream skill has it at the pin`,
    );
  }
  for (const file of actual) {
    const path = `${at}/${file}`;
    if (!(file in expected)) {
      findings.push(`${path}: not in the upstream skill at the pin; a copy may not gain files`);
      continue;
    }
    const bytes = readFileSync(join(copyDir, file));
    const fileFindings = checkFile(path, bytes, expected[file], file, transform);
    findings.push(...(fileFindings.length > 0 ? fileFindings : outsidePaths(path, bytes, file)));
  }
  return findings;
}

// Verifies offline that each copy equals its upstream at the pin plus the
// mechanical transform. Returns one finding string per problem.
export function check(dir) {
  const { upstreams, copies, findings } = readUpstreams(dir);
  if (findings.length > 0 || copies.length === 0) return findings;

  const read = readJsonFile(dir, LOCK);
  if (read.missing) return [`${LOCK}: file is missing; ${INSTALL_HINT}`];
  if (read.finding) return [read.finding];
  const locked = isObject(read.value.upstreams) ? read.value.upstreams : {};
  const names = copies.map((copy) => copy.name);

  for (const upstream of upstreams) {
    const lockedUpstream = locked[upstream.key];
    const at = `${LOCK}: upstream "${upstream.key}"`;
    if (!isObject(lockedUpstream)) {
      findings.push(`${at} is not locked; ${INSTALL_HINT}`);
      continue;
    }
    if (lockedUpstream.commit !== upstream.commit || lockedUpstream.license?.path !== upstream.license) {
      findings.push(`${at} is locked at another pin than ${MANIFEST} names; ${INSTALL_HINT}`);
      continue;
    }
    const lockedSkills = isObject(lockedUpstream.skills) ? lockedUpstream.skills : {};
    for (const copy of upstream.skills) {
      const lockedSkill = lockedSkills[copy.name];
      const valid =
        isObject(lockedSkill) &&
        lockedSkill.path === copy.path &&
        isObject(lockedSkill.files) &&
        Object.values(lockedSkill.files).every(isLockedFile) &&
        locksShared(lockedSkill, copy);
      if (!valid) {
        findings.push(`${at}: skill "${copy.name}" is not locked as ${MANIFEST} lists it; ${INSTALL_HINT}`);
        continue;
      }
      if (treeHash(lockedSkill.files) !== lockedSkill.tree) {
        findings.push(`${at}: skill "${copy.name}" has file hashes that do not match its tree hash; ${INSTALL_HINT}`);
        continue;
      }
      findings.push(...checkCopy(dir, copy, lockedSkill, lockedUpstream.license.blob, transformFor(copy, names)));
    }
    for (const name of Object.keys(lockedSkills)) {
      if (!upstream.skills.some((copy) => copy.name === name)) {
        findings.push(`${at}: skill "${name}" is locked but not listed in ${MANIFEST}; ${INSTALL_HINT}`);
      }
    }
  }
  for (const key of Object.keys(locked)) {
    if (!upstreams.some((upstream) => upstream.key === key)) {
      findings.push(`${LOCK}: upstream "${key}" is locked but not listed in ${MANIFEST}; ${INSTALL_HINT}`);
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Reading an upstream through git (install and report)

// git's stdout, or null when it exits non-zero.
function tryGit(gitDir, args, { encoding = 'utf8' } = {}) {
  const result = spawnSync('git', ['-C', gitDir, ...args], { encoding, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new SyncError(`git could not be run: ${result.error.message}`);
  return result.status === 0 ? result.stdout : null;
}

// git's stdout; throws when it exits non-zero.
function git(gitDir, args, options) {
  const out = tryGit(gitDir, args, options);
  if (out === null) throw new SyncError(`git ${args.join(' ')} failed in ${gitDir}`);
  return out;
}

// The git object hash at `commit:path`, or null when there is none.
function objectAt(gitDir, commit, path) {
  return tryGit(gitDir, ['rev-parse', '--verify', '--quiet', `${commit}:${path}`])?.trim() ?? null;
}

// Runs `fn` with a git directory holding the upstream, after checking the
// pinned commit is there: the repo itself when `repo` is a local directory,
// otherwise a fresh clone in a temp directory, removed afterwards.
function withUpstream(dir, upstream, fn) {
  const local = resolve(dir, upstream.repo);
  let gitDir = local;
  let temp = null;
  if (!existsSync(local) || !statSync(local).isDirectory()) {
    temp = mkdtempSync(join(tmpdir(), 'aw-sync-'));
    const clone = spawnSync('git', ['clone', '--quiet', '--no-checkout', upstream.repo, temp], { encoding: 'utf8' });
    if (clone.status !== 0) {
      rmSync(temp, { recursive: true, force: true });
      throw new SyncError(`could not clone ${upstream.repo}:\n${(clone.stderr ?? clone.error?.message ?? '').trim()}`);
    }
    gitDir = temp;
  }
  try {
    if (tryGit(gitDir, ['cat-file', '-e', `${upstream.commit}^{commit}`]) === null) {
      throw new SyncError(`upstream "${upstream.key}" has no commit ${upstream.commit}`);
    }
    return fn(gitDir);
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

// What `git ls-tree` lists at `commit` for `pathspecs`, every entry when there
// are none, as { path, mode, type, blob } with `path` from the repo's root.
function treeEntries(gitDir, commit, pathspecs, { recursive }) {
  return git(gitDir, ['ls-tree', ...(recursive ? ['-r'] : []), '-z', '--full-tree', commit, '--', ...pathspecs])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      const [mode, type, blob] = meta.split(' ');
      return { path, mode, type, blob };
    });
}

const isRegularFile = ({ mode, type }) => type === 'blob' && (mode === '100644' || mode === '100755');

// The regular files at `commit` for `pathspec`, as { path, mode, blob }. Throws
// on anything else, such as a symlink or a submodule: copies hold only regular
// files.
function regularFiles(gitDir, commit, pathspec, { recursive }) {
  return treeEntries(gitDir, commit, [pathspec], { recursive }).map((entry) => {
    if (!isRegularFile(entry)) {
      throw new SyncError(`${entry.path} at ${commit} is not a regular file (mode ${entry.mode}); copies hold only regular files`);
    }
    return { path: entry.path, mode: entry.mode, blob: entry.blob };
  });
}

// Every file under `path` at `commit`, as { file, mode, blob } with `file`
// relative to `path`.
function treeFiles(gitDir, commit, path) {
  return regularFiles(gitDir, commit, `${path}/`, { recursive: true }).map(({ path: fullPath, mode, blob }) => ({
    file: fullPath.slice(path.length + 1),
    mode,
    blob,
  }));
}

// The mode and blob of the regular file at `commit:path`.
function fileAt(gitDir, commit, path) {
  const [entry] = regularFiles(gitDir, commit, path, { recursive: false });
  if (entry?.path !== path) throw new SyncError(`there is no file ${path} at ${commit}`);
  return { mode: entry.mode, blob: entry.blob };
}

const readBlob = (gitDir, blob) => git(gitDir, ['cat-file', 'blob', blob], { encoding: 'buffer' });

// The skill names of an upstream at `commit`: the `name:` of every SKILL.md in
// its tree. Unlike a copied folder, the tree may hold anything, so a SKILL.md
// that is not a regular text file is skipped, as is one without a name.
function upstreamSkillNames(gitDir, commit) {
  const names = treeEntries(gitDir, commit, [], { recursive: true })
    .filter((entry) => isRegularFile(entry) && posix.basename(entry.path) === 'SKILL.md')
    .map((entry) => skillName(asText(readBlob(gitDir, entry.blob)) ?? ''));
  return [...new Set(names.filter(Boolean))];
}

// ---------------------------------------------------------------------------
// install

function writeFile(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

// One upstream file of a copy with the mechanical transform applied: what the
// copy holds, the uses of a copied or replaced name the transform left alone,
// and the references to one of `unresolved` it still holds. Throws when the
// transform cannot be undone on the file, since `check` could then never
// verify the copy.
function transformFile(path, bytes, file, transform, unresolved) {
  const text = asText(bytes);
  if (text === null) return { content: bytes, leftAlone: [], dangling: [] };
  const content = transform.apply(text, file);
  if (transform.undo(content, file) !== text) {
    throw new SyncError(`${path}: the mechanical transform cannot be undone on this file, so check could not verify it`);
  }
  return { content, leftAlone: transform.leftAlone(content), dangling: findReferences(content, unresolved) };
}

// The line reporting a retained folder. Its advice fits why the folder is still
// tied to the kit: `mappedBy` labels each "replaced" entry that maps to it, and
// `listedIn` is the plugin manifest that lists it, or null.
function keptLine(path, mappedBy, listedIn) {
  const reasons = [];
  const steps = [];
  if (mappedBy.length > 0) {
    reasons.push(`"replaced" maps ${mappedBy.join(', ')} to it`);
    steps.push(`remove or remap each "replaced" entry that maps to it in ${MANIFEST}`);
  }
  if (listedIn) {
    reasons.push(`${listedIn} still lists it`);
    steps.push(`remove its listing from ${listedIn}`);
  }
  return `kept ${path}: ${reasons.join(' and ')}; to remove it, ${steps.join(', ')} and delete the folder`;
}

// Installs every copy at its pin, applies the mechanical transform, adds
// LICENSE.upstream and rewrites the lock. Copies dropped from the manifest
// since the last install are removed unless replaced maps to their folder
// or plugin.json still lists it. Retained folders keep their contents, but
// their stale lock entries are removed. The kept line names each "replaced"
// entry that maps to the folder and any plugin.json listing, and its removal
// advice covers only those. It prints once, since the lock entry goes with it.
// Everything is worked out before the first write, so a failure
// leaves the copies and the lock as they were. It fails on a reference to a
// skill of the copy's own upstream that the kit neither copies nor replaces,
// since that reference points nowhere once the upstream's plugin is disabled.
// Returns the lines to print.
export function install(dir) {
  const { upstreams, copies, findings } = readUpstreams(dir);
  if (findings.length > 0) throw new SyncError(findings.join('\n'));
  const names = copies.map((copy) => copy.name);
  const pluginPath = '.claude-plugin/plugin.json';
  const plugin = readJsonFile(dir, pluginPath);
  if (plugin.finding) throw new SyncError(plugin.finding);
  if (!plugin.missing && !Array.isArray(plugin.value?.skills)) {
    throw new SyncError(`${pluginPath}: "skills" must be an array of skill folders`);
  }
  const listed = new Set((plugin.value?.skills ?? [])
    .filter((entry) => typeof entry === 'string').map(normalizeSkillPath));
  const replacedEntries = upstreams.flatMap((upstream) =>
    Object.entries(upstream.replaced).map(([from, to]) => ({ to, label: `"${from}" of upstream "${upstream.key}"` })));
  const previous = readJsonFile(dir, LOCK).value;
  const lock = { upstreams: {} };
  const lines = [];
  const writes = [];
  const dangling = [];

  for (const upstream of upstreams) {
    withUpstream(dir, upstream, (gitDir) => {
      const licenseBlob = objectAt(gitDir, upstream.commit, upstream.license);
      if (licenseBlob === null) {
        throw new SyncError(`upstream "${upstream.key}" has no ${upstream.license} at ${upstream.commit}`);
      }
      const license = readBlob(gitDir, licenseBlob);
      const unresolved = upstreamSkillNames(gitDir, upstream.commit).filter((name) => !names.includes(name) && !(name in upstream.replaced));
      const lockedSkills = {};
      for (const copy of upstream.skills) {
        const tree = objectAt(gitDir, upstream.commit, copy.path);
        if (tree === null) {
          throw new SyncError(`upstream "${upstream.key}" has no ${copy.path} at ${upstream.commit}`);
        }
        const at = `skills/${copy.folder}`;
        const transform = transformFor(copy, names);
        const planFile = (file, bytes) => {
          const path = `${at}/${file}`;
          const planned = transformFile(path, bytes, file, transform, unresolved);
          writes.push({ path, content: planned.content });
          lines.push(...planned.leftAlone.map(({ line, mention }) => `${path}:${line}: left alone: ${mention}`));
          dangling.push(...planned.dangling.map(({ line, mention }) => `${path}:${line}: ${mention}`));
        };
        const files = {};
        for (const { file, mode, blob } of treeFiles(gitDir, upstream.commit, copy.path)) {
          files[file] = { mode, blob };
          planFile(file, readBlob(gitDir, blob));
        }
        const shared = {};
        for (const file of copy.shared) {
          if (clashesWithSkill(file, files)) {
            throw new SyncError(`${at}/${file}: shared file ${file} would replace a file the skill already has`);
          }
          shared[file] = fileAt(gitDir, upstream.commit, file);
          planFile(file, readBlob(gitDir, shared[file].blob));
        }
        planFile(LICENSE_FILE, license);
        lockedSkills[copy.name] = { path: copy.path, tree, files, ...(copy.shared.length > 0 && { shared }) };
        lines.push(`installed ${at} from ${upstream.key} ${copy.path} at ${upstream.commit.slice(0, 12)}`);
      }
      lock.upstreams[upstream.key] = {
        repo: upstream.repo,
        commit: upstream.commit,
        license: { path: upstream.license, blob: licenseBlob },
        skills: lockedSkills,
      };
    });
  }
  if (dangling.length > 0) {
    throw new SyncError(
      `${dangling.join('\n')}\n` +
        `${dangling.length} reference(s) to an upstream skill the kit neither copies nor replaces. ` +
        `For each, copy the skill or map it under the upstream's "replaced" in ${MANIFEST}.`,
    );
  }

  for (const copy of copies) rmSync(join(dir, 'skills', copy.folder), { recursive: true, force: true });
  for (const { path, content } of writes) writeFile(join(dir, path), content);

  for (const lockedUpstream of Object.values(isObject(previous?.upstreams) ? previous.upstreams : {})) {
    for (const name of Object.keys(isObject(lockedUpstream?.skills) ? lockedUpstream.skills : {})) {
      if (names.includes(name)) continue;
      const folder = PREFIX + name;
      const path = `skills/${folder}`;
      const mappedBy = replacedEntries.filter(({ to }) => to === folder).map(({ label }) => label);
      if (mappedBy.length > 0 || listed.has(path)) {
        lines.push(keptLine(path, mappedBy, listed.has(path) ? pluginPath : null));
        continue;
      }
      rmSync(join(dir, 'skills', folder), { recursive: true, force: true });
      lines.push(`removed ${path}, no longer listed in ${MANIFEST}`);
    }
  }

  writeFileSync(join(dir, LOCK), JSON.stringify(lock, null, 2) + '\n');
  lines.push(`wrote ${LOCK}`);
  return lines;
}

// ---------------------------------------------------------------------------
// report

// Lists, for each upstream, what changed on its default branch since the
// pin: per copied skill and for the license. Returns the lines to print.
export function report(dir) {
  const { upstreams, findings } = readUpstreams(dir);
  if (findings.length > 0) throw new SyncError(findings.join('\n'));
  const lines = [];
  for (const upstream of upstreams) {
    withUpstream(dir, upstream, (gitDir) => {
      const head = git(gitDir, ['rev-parse', 'HEAD']).trim();
      const count = git(gitDir, ['rev-list', '--count', `${upstream.commit}..${head}`]).trim();
      lines.push(`${upstream.key}: pinned at ${upstream.commit.slice(0, 12)}, upstream is at ${head.slice(0, 12)}, ${count} commit(s) since the pin`);
      const paths = [
        ...upstream.skills.flatMap((copy) => [
          { label: `${copy.name} (${copy.path})`, path: copy.path },
          ...copy.shared.map((file) => ({ label: `${copy.name} shared file (${file})`, path: file })),
        ]),
        { label: `license (${upstream.license})`, path: upstream.license },
      ];
      for (const { label, path } of paths) {
        const before = objectAt(gitDir, upstream.commit, path);
        const after = objectAt(gitDir, head, path);
        if (after === null) {
          lines.push(`  ${label}: removed upstream`);
        } else if (before === after) {
          lines.push(`  ${label}: unchanged`);
        } else {
          lines.push(`  ${label}: changed`);
          const log = git(gitDir, ['log', '--format=%h %s', `${upstream.commit}..${head}`, '--', path]).trim();
          for (const entry of log.split('\n').filter(Boolean)) lines.push(`    ${entry}`);
        }
      }
    });
  }
  return lines;
}
