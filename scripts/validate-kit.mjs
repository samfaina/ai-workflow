// Kit validation CLI (maintainer-only, never ships to user repos).
//
// Usage: node scripts/validate-kit.mjs [kit-dir]
//
// Checks the kit invariants and prints one finding per line as
// `<path>: <message>`. Exits 0 when the kit is valid, 1 when there are
// findings, 2 on a usage error.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  check as checkCopies,
  MANIFEST as UPSTREAMS_MANIFEST,
  PREFIX,
  normalizeSkillPath,
  readJsonFile,
  readUpstreams,
  replacedFinding,
} from './lib/upstreams.mjs';

const kitDir = resolve(process.argv[2] ?? '.');
if (!existsSync(kitDir) || !statSync(kitDir).isDirectory()) {
  console.error(`usage: node scripts/validate-kit.mjs [kit-dir]\nnot a directory: ${kitDir}`);
  process.exit(2);
}

function skillFolders(dir) {
  const skillsDir = join(dir, 'skills');
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// The trimmed cells of one Markdown table row, `| a | b |` → ['a', 'b'].
function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

// A table cell's text with its code backticks removed: `` `copy` `` → `copy`.
function unbacktick(cell) {
  return cell.replace(/`/g, '');
}

function unquote(value) {
  const match = value.match(/^(["'])(.*)\1$/);
  return match ? match[2] : value;
}

// Top-level `key: value` pairs of a SKILL.md frontmatter block, or null when
// the file has none. Nested and multi-line values are not needed here.
function frontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (match) fields[match[1]] = unquote(match[2]);
  }
  return fields;
}

function checkSkills(dir) {
  const findings = [];
  for (const folder of skillFolders(dir)) {
    const at = `skills/${folder}`;
    if (!folder.startsWith(PREFIX)) {
      findings.push(`${at}: skill folder must carry the "${PREFIX}" prefix`);
    }
    const skillFile = join(dir, at, 'SKILL.md');
    if (!existsSync(skillFile)) {
      findings.push(`${at}: skill folder has no SKILL.md`);
      continue;
    }
    const fields = frontmatter(readFileSync(skillFile, 'utf8'));
    if (fields === null) {
      findings.push(`${at}/SKILL.md: missing frontmatter`);
      continue;
    }
    if (fields.name !== folder) {
      findings.push(
        `${at}/SKILL.md: name "${fields.name ?? ''}" does not match folder "${folder}"`,
      );
    }
    findings.push(...checkInvocation(dir, folder, fields));
  }
  return findings;
}

// True when an agents/openai.yaml sets `allow_implicit_invocation: false`
// under its top-level `policy:` block.
function disablesImplicitInvocation(yaml) {
  let inPolicy = false;
  for (const line of yaml.split(/\r?\n/)) {
    if (/^\S/.test(line)) inPolicy = /^policy:\s*(#.*)?$/.test(line);
    else if (inPolicy && /^\s+allow_implicit_invocation:\s*false\s*(#.*)?$/.test(line)) return true;
  }
  return false;
}

// Skills that are user-invoked whatever they declare: aw-setup and the phase
// skills, which the user runs one after another (ADRs 0010 and 0013, and the
// v1 spec's naming decisions). A user-invoked skill cannot be called by
// another skill (ADR 0012).
const USER_INVOKED_SKILLS = [
  'aw-setup',
  'aw-intake',
  'aw-wayfinder',
  'aw-spec',
  'aw-slices',
  'aw-build',
  'aw-verify',
  'aw-create-verify',
  'aw-review',
  'aw-ship',
  'aw-retro',
];

// How a skill declares its invocation: `claude` when SKILL.md sets
// `disable-model-invocation: true`, `codex` when agents/openai.yaml disables
// implicit invocation, and `userInvoked` when either is set or the skill is
// one of USER_INVOKED_SKILLS.
function invocation(dir, folder, fields) {
  const yamlPath = `skills/${folder}/agents/openai.yaml`;
  const yamlFile = join(dir, yamlPath);
  const yaml = existsSync(yamlFile) ? readFileSync(yamlFile, 'utf8') : null;
  const claude = fields?.['disable-model-invocation'] === 'true';
  const codex = yaml !== null && disablesImplicitInvocation(yaml);
  const userInvoked = claude || codex || USER_INVOKED_SKILLS.includes(folder);
  return { yamlPath, hasYaml: yaml !== null, claude, codex, userInvoked };
}

// A user-invoked skill must declare both flags: Claude Code reads SKILL.md,
// Codex reads agents/openai.yaml.
function checkInvocation(dir, folder, fields) {
  const at = `skills/${folder}`;
  const { yamlPath, hasYaml, claude, codex, userInvoked } = invocation(dir, folder, fields);
  if (claude && !hasYaml) {
    return [`${yamlPath}: missing; a user-invoked skill needs one with "policy: allow_implicit_invocation: false"`];
  }
  if (claude && !codex) {
    return [`${yamlPath}: a user-invoked skill must set "policy: allow_implicit_invocation: false"`];
  }
  if (codex && !claude) {
    return [`${at}/SKILL.md: openai.yaml disables implicit invocation, so the frontmatter must set "disable-model-invocation: true"`];
  }
  if (userInvoked && !claude) {
    return [`${at}/SKILL.md: aw-setup and the phase skills are user-invoked, so the frontmatter must set "disable-model-invocation: true" and ${yamlPath} "policy: allow_implicit_invocation: false"`];
  }
  return [];
}

// The Markdown files under `skills/`, relative and sorted.
function skillMarkdownFiles(dir) {
  return kitFiles(dir)
    .filter((path) => path.startsWith('skills/') && path.endsWith('.md'))
    .sort();
}

// Text without its opening `---` frontmatter block, where a quoted `name:`
// is not a Skill tool call.
function withoutFrontmatter(text) {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
  return match ? text.slice(match[0].length) : text;
}

// A Skill tool call names its skill in double quotes ("aw-tdd"), the form
// the sync rename also treats as a reference. A user-invoked skill cannot be
// called that way (ADR 0012): a skill names it as a slash command for the
// user to run.
function checkSkillToolCalls(dir) {
  const userInvoked = new Set(
    skillFolders(dir).filter((folder) => {
      const skillFile = join(dir, 'skills', folder, 'SKILL.md');
      const fields = existsSync(skillFile) ? frontmatter(readFileSync(skillFile, 'utf8')) : null;
      return invocation(dir, folder, fields).userInvoked;
    }),
  );
  const findings = [];
  for (const path of skillMarkdownFiles(dir)) {
    const text = withoutFrontmatter(readFileSync(join(dir, path), 'utf8'));
    const called = new Set([...text.matchAll(/"(aw-[a-z0-9-]+)"/g)].map((match) => match[1]));
    for (const name of [...called].filter((candidate) => userInvoked.has(candidate)).sort()) {
      findings.push(`${path}: "${name}" is user-invoked and cannot be called through the Skill tool; tell the user to run /${name}`);
    }
  }
  return findings;
}

const PLUGIN_MANIFEST = '.claude-plugin/plugin.json';
const MARKETPLACE_MANIFEST = '.claude-plugin/marketplace.json';

// Parsed JSON, or a finding string when the file is missing or invalid.
function readJson(dir, path) {
  const read = readJsonFile(dir, path);
  return read.missing ? { finding: `${path}: file is missing` } : read;
}

function checkManifestListing(dir, plugin) {
  const findings = [];
  const entries = Array.isArray(plugin.skills) ? plugin.skills : [];
  if (!Array.isArray(plugin.skills)) {
    findings.push(`${PLUGIN_MANIFEST}: "skills" must be an array of skill folders`);
  }
  const listed = new Set();
  for (const entry of entries) {
    const path = typeof entry === 'string' ? normalizeSkillPath(entry) : '';
    if (!/^skills\/[^/]+$/.test(path)) {
      findings.push(`${PLUGIN_MANIFEST}: skills entry ${JSON.stringify(entry)} must be "./skills/<name>"`);
    } else if (!existsSync(join(dir, path))) {
      findings.push(`${PLUGIN_MANIFEST}: skills entry "${entry}" has no skill folder`);
    }
    listed.add(path);
  }
  for (const folder of skillFolders(dir)) {
    if (!listed.has(`skills/${folder}`)) {
      findings.push(`skills/${folder}: skill is not listed in ${PLUGIN_MANIFEST}`);
    }
  }
  return findings;
}

// Releases are plain semver tags vX.Y.Z (ADR 0015).
const SEMVER = /^\d+\.\d+\.\d+$/;

// plugin.json holds the version a release bumps; the marketplace entry for
// the plugin must carry the same one.
function checkVersions(plugin, marketplace) {
  const findings = [];
  if (typeof plugin.version !== 'string' || !SEMVER.test(plugin.version)) {
    findings.push(`${PLUGIN_MANIFEST}: "version" must be plain semver X.Y.Z, such as "0.1.0"`);
  }
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const entry = plugins.find((candidate) => candidate?.name === plugin.name);
  if (!entry) {
    findings.push(`${MARKETPLACE_MANIFEST}: no plugins entry named "${plugin.name}"`);
  } else if (entry.version !== plugin.version) {
    findings.push(
      `${MARKETPLACE_MANIFEST}: entry "${plugin.name}" has version "${entry.version ?? ''}" but ${PLUGIN_MANIFEST} has "${plugin.version ?? ''}"`,
    );
  }
  return findings;
}

// The kit's files, relative and `/`-separated. Inside a git work tree that is
// what git tracks or would track, so ignored local files (handoffs, local
// settings) are skipped; elsewhere, every file.
function kitFiles(dir) {
  const git = spawnSync(
    'git',
    ['-C', dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  );
  if (git.status === 0) {
    return git.stdout.split('\0').filter((path) => path && existsSync(join(dir, path)));
  }
  const files = [];
  const walk = (relative) => {
    for (const entry of readdirSync(join(dir, relative), { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  walk('');
  return files;
}

function checkLineEndings(dir) {
  const findings = [];
  for (const path of kitFiles(dir).sort()) {
    const bytes = readFileSync(join(dir, path));
    if (bytes.includes(0)) continue; // binary
    if (bytes.includes(0x0d)) findings.push(`${path}: has CRLF or CR line endings; use LF`);
  }
  return findings;
}

// NOTICE.md lists every copy with its upstream, pin and kind (ADR 0004).
// An entry is a table row whose first cell is the copy's name, whose upstream
// cell holds the upstream's `repo` from upstreams.json (usually as a link),
// whose pin cell holds at least the first seven characters of the pinned
// commit and whose kind is `copy`.
function checkNotice(dir) {
  const { copies } = readUpstreams(dir);
  if (copies.length === 0) return [];
  const full = join(dir, 'NOTICE.md');
  if (!existsSync(full)) return ['NOTICE.md: file is missing; it must list every copy (ADR 0004)'];
  const rows = readFileSync(full, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map(tableCells);
  const findings = [];
  for (const copy of copies) {
    const row = rows.find((cells) => unbacktick(cells[0]) === copy.folder);
    const pin = copy.upstream.commit.slice(0, 7);
    const repo = copy.upstream.repo.replace(/\/+$/, '').replace(/\.git$/, '');
    if (!row) {
      findings.push(`NOTICE.md: no entry for copy "${copy.folder}" (ADR 0004)`);
    } else if (!(row[1] ?? '').includes(repo)) {
      findings.push(`NOTICE.md: entry "${copy.folder}" must link its upstream ${repo} from ${UPSTREAMS_MANIFEST}`);
    } else if (!(row[2] ?? '').includes(pin)) {
      findings.push(`NOTICE.md: entry "${copy.folder}" must show its pin ${pin} from ${UPSTREAMS_MANIFEST}`);
    } else if (unbacktick(row[3] ?? '').toLowerCase() !== 'copy') {
      findings.push(`NOTICE.md: entry "${copy.folder}" must have kind "copy"`);
    }
  }
  return findings;
}

// Each "replaced" entry must map to a kit skill the kit has, or a copy that
// refers to the replaced skill points at nothing. An entry readUpstreams
// already rejects has its finding from there. `install` and `check` accept a
// missing folder, so this check is not part of readUpstreams.
function checkReplacedFolders(dir) {
  const { upstreams, copies } = readUpstreams(dir);
  const folders = skillFolders(dir);
  const findings = [];
  for (const upstream of upstreams) {
    for (const [from, to] of Object.entries(upstream.replaced)) {
      if (replacedFinding(upstream, from, to, copies) === null && !folders.includes(to)) {
        findings.push(`${UPSTREAMS_MANIFEST}: upstream "${upstream.key}": replaced skill "${from}" maps to "${to}", which has no folder under skills/`);
      }
    }
  }
  return findings;
}

// The closed vocabulary of canonical operations (ADR 0006), by adapter kind.
// Read operations are always allowed; each write operation is at `write` or
// `draft`.
const OPERATIONS = {
  tracker: {
    read: ['fetch-ticket', 'query-tickets'],
    write: ['publish-ticket', 'comment-ticket', 'set-status', 'link-tickets'],
  },
  vcs: {
    read: ['diff-base'],
    write: ['start-branch', 'commit', 'push', 'open-review', 'merge'],
  },
  checks: {
    read: ['run-check'],
    write: [],
  },
};

// The check levels a checks template gives a command for.
const CHECK_LEVELS = ['fast', 'task', 'full'];

// The index of the `## <heading>` line in `lines`, or -1.
function headingIndex(lines, heading) {
  return lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`).test(line));
}

// True for a heading line of level 1 or 2, which ends a `##` section.
function endsSection(line) {
  return /^#{1,2}\s/.test(line);
}

// Rows of the first table under the `## <heading>` heading, as trimmed cells,
// header and separator rows dropped; null when there is no such heading.
function tableRows(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = headingIndex(lines, heading);
  if (start === -1) return null;
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith('|')) rows.push(tableCells(line));
    else if (rows.length > 0 || endsSection(line)) break;
  }
  return rows.slice(2);
}

// A checks template gives the command behind each check level in a
// `## Levels` table.
function checkLevelsTable(at, text) {
  const rows = tableRows(text, 'Levels') ?? [];
  const levels = new Set(rows.filter((cells) => cells[1]).map((cells) => unbacktick(cells[0])));
  return CHECK_LEVELS.filter((level) => !levels.has(level)).map(
    (level) => `${at}: no command for check level "${level}" in the Levels table`,
  );
}

// The Operations table names each canonical operation of its kind once, says
// how it is performed, and gives `read` operations `read` and write
// operations `write` or `draft`.
function checkOperationRows(at, kind, rows) {
  const { read, write } = OPERATIONS[kind];
  const findings = [];
  const byOperation = new Map();
  for (const cells of rows) {
    const operation = unbacktick(cells[0]);
    if (byOperation.has(operation)) {
      findings.push(`${at}: "${operation}" is listed more than once in the Operations table`);
      continue;
    }
    if (!read.includes(operation) && !write.includes(operation)) {
      findings.push(`${at}: "${operation}" is not a canonical ${kind} operation (ADR 0006)`);
    }
    byOperation.set(operation, cells);
  }
  for (const operation of [...read, ...write]) {
    const cells = byOperation.get(operation);
    const access = unbacktick(cells?.[2] ?? '');
    if (!cells) {
      findings.push(`${at}: no row for canonical operation "${operation}" in the Operations table`);
    } else if (!cells[1]) {
      findings.push(`${at}: "${operation}" does not say how it is performed`);
    } else if (write.includes(operation) && access !== 'write' && access !== 'draft') {
      findings.push(`${at}: "${operation}" is a write operation, so its access must be \`write\` or \`draft\`, not "${access}"`);
    } else if (read.includes(operation) && access !== 'read') {
      findings.push(`${at}: "${operation}" is always allowed, so its access must be \`read\`, not "${access}"`);
    }
  }
  return findings;
}

// The adapter kind a template file belongs to, from its name: `<kind>.md` or
// `<kind>-<variant>.md`; undefined for any other file, such as `domain.md`.
function adapterKind(file) {
  return Object.keys(OPERATIONS).find(
    (kind) => file === `${kind}.md` || (file.startsWith(`${kind}-`) && file.endsWith('.md')),
  );
}

function checkAdapterTemplate(at, kind, text) {
  const findings = kind === 'checks' ? checkLevelsTable(at, text) : [];
  if (OPERATIONS[kind].write.length > 0 && !/^\*\*Default access:\*\*\s*`(write|draft)`/m.test(text)) {
    findings.push(`${at}: must declare "**Default access:** \`write\`" or "\`draft\`" for its write operations`);
  }
  const rows = tableRows(text, 'Operations');
  if (rows === null || rows.length === 0) {
    findings.push(`${at}: has no "## Operations" table stating how each canonical ${kind} operation is performed`);
    return findings;
  }
  return [...findings, ...checkOperationRows(at, kind, rows)];
}

// Adapter templates live in a skill's `adapters/` folder (ADR 0006). Each
// tracker, VCS and checks template states, for every canonical operation of
// its kind, how it is performed and its access level.
//
// A skill installed through `npx skills` reads only its own folder, so a
// skill that needs another skill's template carries a copy of it under the
// same file name. Each copy must match the first one found, in folder order.
function checkAdapterTemplates(dir) {
  const findings = [];
  const firstCopy = new Map();
  for (const folder of skillFolders(dir)) {
    const adaptersDir = join(dir, 'skills', folder, 'adapters');
    if (!existsSync(adaptersDir)) continue;
    for (const file of readdirSync(adaptersDir).sort()) {
      const at = `skills/${folder}/adapters/${file}`;
      const text = readFileSync(join(adaptersDir, file), 'utf8');
      const first = firstCopy.get(file);
      if (!first) firstCopy.set(file, { at, text });
      else if (first.text !== text) findings.push(`${at}: differs from its copy in ${first.at}`);
      const kind = adapterKind(file);
      if (kind) findings.push(...checkAdapterTemplate(at, kind, text));
    }
  }
  return findings;
}

// The prose of the `## <heading>` section, up to the next heading of level 1
// or 2; null when there is no such heading.
function sectionBody(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = headingIndex(lines, heading);
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && endsSection(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

// Text with every run of whitespace, line breaks included, made one space.
function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

const CONFIGURATION_PAGE = 'docs/configuration.md';

// Sections of the configuration page that a file under `skills/` may restate.
// A skill installed through `npx skills` cannot read the page, so it carries
// what it needs in its own text, and each restatement must match the page:
// the never-allowed operations, and the defaults of an unconfigured repo.
const RESTATED_SECTIONS = ['Never allowed', 'Defaults when unconfigured'];

function checkRestatedSection(dir, skillFiles, heading) {
  const restatements = skillFiles
    .map((path) => ({ path, body: sectionBody(readFileSync(join(dir, path), 'utf8'), heading) }))
    .filter(({ body }) => body !== null);
  if (restatements.length === 0) return [];
  const page = join(dir, CONFIGURATION_PAGE);
  const pageExists = existsSync(page);
  const source = pageExists ? sectionBody(readFileSync(page, 'utf8'), heading) : null;
  if (source === null) {
    const paths = restatements.map(({ path }) => path).join(', ');
    const problem = pageExists ? `has no "## ${heading}" section` : 'file is missing';
    return [`${CONFIGURATION_PAGE}: ${problem}; it is the source for the "${heading}" section in ${paths}`];
  }
  return restatements
    .filter(({ body }) => collapseWhitespace(body) !== collapseWhitespace(source))
    .map(({ path }) => `${path}: "${heading}" section differs from ${CONFIGURATION_PAGE}`);
}

function checkRestatedSections(dir) {
  const skillFiles = skillMarkdownFiles(dir);
  return RESTATED_SECTIONS.flatMap((heading) => checkRestatedSection(dir, skillFiles, heading));
}

function validate(dir) {
  const findings = checkSkills(dir);
  findings.push(...checkSkillToolCalls(dir));
  findings.push(...checkAdapterTemplates(dir));
  findings.push(...checkRestatedSections(dir));
  const plugin = readJson(dir, PLUGIN_MANIFEST);
  const marketplace = readJson(dir, MARKETPLACE_MANIFEST);
  if (plugin.finding) findings.push(plugin.finding);
  if (marketplace.finding) findings.push(marketplace.finding);
  if (!plugin.finding) findings.push(...checkManifestListing(dir, plugin.value));
  if (!plugin.finding && !marketplace.finding) {
    findings.push(...checkVersions(plugin.value, marketplace.value));
  }
  findings.push(...checkCopies(dir));
  findings.push(...checkReplacedFolders(dir));
  findings.push(...checkNotice(dir));
  findings.push(...checkLineEndings(dir));
  return findings;
}

const findings = validate(kitDir);

for (const finding of findings) console.log(finding);
if (findings.length > 0) {
  console.error(`${findings.length} finding(s) in ${kitDir}`);
  process.exit(1);
}
console.error(`kit valid: ${kitDir}`);
