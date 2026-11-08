// Seam 2: the kit validation CLI, run from outside the way CI runs it.
// Each test builds a small fixture kit in a temp directory, runs
// `node scripts/validate-kit.mjs <dir>` and asserts on the exit code and the
// reported findings only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertNoFindings,
  assertOneFinding,
  manifests,
  repoRoot,
  runCli,
  validateCli,
  writeFiles,
} from './fixtures.mjs';

// A fixture kit maps each relative path to its content (see writeFiles). A
// valid kit has one model-invoked skill and one user-invoked skill.
function validKit() {
  return {
    ...manifests(['aw-alpha', 'aw-beta']),
    'skills/aw-alpha/SKILL.md':
      '---\nname: aw-alpha\ndescription: A model-invoked skill.\n---\n\nBody.\n',
    'skills/aw-beta/SKILL.md':
      '---\nname: aw-beta\ndescription: A user-invoked skill.\ndisable-model-invocation: true\n---\n\nBody.\n',
    'skills/aw-beta/agents/openai.yaml':
      'interface:\n  display_name: "Beta"\npolicy:\n  allow_implicit_invocation: false\n',
  };
}

function runOn(files, { git = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-kit-'));
  try {
    if (git) spawnSync('git', ['init', '--quiet', dir], { encoding: 'utf8' });
    writeFiles(dir, files);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const run = (dir) => runCli(validateCli, dir);

test('a valid kit passes with no findings', () => {
  assertNoFindings(runOn(validKit()));
});

test('a skill folder without the aw- prefix is reported', () => {
  const kit = validKit();
  kit['skills/alpha/SKILL.md'] = kit['skills/aw-alpha/SKILL.md'].replace('aw-alpha', 'alpha');
  delete kit['skills/aw-alpha/SKILL.md'];
  kit['.claude-plugin/plugin.json'].skills = ['./skills/alpha', './skills/aw-beta'];

  assertOneFinding(runOn(kit), /^skills\/alpha: .*aw-/);
});

test('a skill whose name: does not match its folder is reported', () => {
  const kit = validKit();
  kit['skills/aw-alpha/SKILL.md'] = kit['skills/aw-alpha/SKILL.md'].replace(
    'name: aw-alpha',
    'name: aw-other',
  );

  assertOneFinding(runOn(kit), /^skills\/aw-alpha\/SKILL\.md: .*aw-other.*aw-alpha/);
});

test('a quoted name: that matches its folder passes', () => {
  const kit = validKit();
  kit['skills/aw-alpha/SKILL.md'] = kit['skills/aw-alpha/SKILL.md'].replace(
    'name: aw-alpha',
    'name: "aw-alpha"',
  );

  assertNoFindings(runOn(kit));
});

test('a skill folder without SKILL.md is reported', () => {
  const kit = validKit();
  delete kit['skills/aw-alpha/SKILL.md'];
  kit['skills/aw-alpha/notes.md'] = 'Not a skill yet.\n';

  assertOneFinding(runOn(kit), /^skills\/aw-alpha: .*SKILL\.md/);
});

test('a skill missing from the plugin manifest is reported', () => {
  const kit = validKit();
  kit['.claude-plugin/plugin.json'].skills = ['./skills/aw-beta'];

  assertOneFinding(runOn(kit), /^skills\/aw-alpha: .*plugin\.json/);
});

test('a manifest entry with no skill folder behind it is reported', () => {
  const kit = validKit();
  kit['.claude-plugin/plugin.json'].skills.push('./skills/aw-ghost');

  assertOneFinding(runOn(kit), /^\.claude-plugin\/plugin\.json: .*aw-ghost/);
});

// A skill is user-invoked when it declares either flag. It must declare both:
// `disable-model-invocation: true` for Claude Code, `agents/openai.yaml` with
// `allow_implicit_invocation: false` for Codex.

test('a user-invoked skill without agents/openai.yaml is reported', () => {
  const kit = validKit();
  delete kit['skills/aw-beta/agents/openai.yaml'];

  assertOneFinding(runOn(kit), /^skills\/aw-beta\/agents\/openai\.yaml: .*missing/);
});

test('a user-invoked skill whose openai.yaml allows implicit invocation is reported', () => {
  const kit = validKit();
  kit['skills/aw-beta/agents/openai.yaml'] = 'interface:\n  display_name: "Beta"\n';

  assertOneFinding(runOn(kit), /^skills\/aw-beta\/agents\/openai\.yaml: .*allow_implicit_invocation: false/);
});

test('a skill whose openai.yaml disables implicit invocation but SKILL.md does not is reported', () => {
  const kit = validKit();
  kit['skills/aw-beta/SKILL.md'] = kit['skills/aw-beta/SKILL.md'].replace(
    'disable-model-invocation: true\n',
    '',
  );

  assertOneFinding(runOn(kit), /^skills\/aw-beta\/SKILL\.md: .*disable-model-invocation: true/);
});

test('a marketplace entry whose version differs from plugin.json is reported', () => {
  const kit = validKit();
  kit['.claude-plugin/marketplace.json'].plugins[0].version = '1.2.2';

  assertOneFinding(runOn(kit), /^\.claude-plugin\/marketplace\.json: .*1\.2\.2.*1\.2\.3/);
});

test('a plugin.json without a semver version is reported', () => {
  const kit = validKit();
  kit['.claude-plugin/plugin.json'].version = 'next';
  kit['.claude-plugin/marketplace.json'].plugins[0].version = 'next';

  assertOneFinding(runOn(kit), /^\.claude-plugin\/plugin\.json: .*version/);
});

test('a pre-release version is reported, since releases are plain X.Y.Z', () => {
  const kit = validKit();
  kit['.claude-plugin/plugin.json'].version = '1.2.3-beta.1';
  kit['.claude-plugin/marketplace.json'].plugins[0].version = '1.2.3-beta.1';

  assertOneFinding(runOn(kit), /^\.claude-plugin\/plugin\.json: .*version/);
});

test('a marketplace with no entry for the plugin is reported', () => {
  const kit = validKit();
  kit['.claude-plugin/marketplace.json'].plugins[0].name = 'someone-else';

  assertOneFinding(runOn(kit), /^\.claude-plugin\/marketplace\.json: .*fixture-kit/);
});

test('a text file with CRLF line endings is reported once', () => {
  const kit = validKit();
  kit['skills/aw-alpha/SKILL.md'] = kit['skills/aw-alpha/SKILL.md'].replace(/\n/g, '\r\n');

  assertOneFinding(runOn(kit), /^skills\/aw-alpha\/SKILL\.md: .*CRLF/);
});

test('in a git work tree, ignored files are not checked for line endings', () => {
  const kit = validKit();
  kit['.gitignore'] = 'local/\n';
  kit['local/notes.md'] = 'Written on Windows.\r\n';

  assertNoFindings(runOn(kit, { git: true }));
});

test('in a git work tree, untracked files that are not ignored are checked', () => {
  const kit = validKit();
  kit['notes.md'] = 'Written on Windows.\r\n';

  assertOneFinding(runOn(kit, { git: true }), /^notes\.md: .*CRLF/);
});

test('binary files are not checked for line endings', () => {
  const kit = validKit();
  kit['skills/aw-alpha/assets/icon.png'] = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  assertNoFindings(runOn(kit));
});

test('a model-invoked skill may carry an openai.yaml without a policy', () => {
  const kit = validKit();
  kit['skills/aw-alpha/agents/openai.yaml'] = 'interface:\n  display_name: "Alpha"\n';

  assertNoFindings(runOn(kit));
});

test('a kit directory that does not exist is a usage error', () => {
  const { status, findings } = run(join(tmpdir(), 'aw-kit-does-not-exist'));
  assert.deepEqual(findings, []);
  assert.equal(status, 2);
});

test('this repo is a valid kit', () => {
  assertNoFindings(run(repoRoot));
});

// Adapter templates are the files under a skill's `adapters/` folder that
// aw-setup fills in for a repo (ADR 0006). A `tracker`, `vcs` or `checks`
// template (`<kind>.md` or `<kind>-<variant>.md`) has an `## Operations`
// table with one row per canonical operation of its kind: the operation, how
// it is performed, and its access level. A kind with write operations also
// declares a default access level.

const VCS_ROWS = [
  ['start-branch', 'write'],
  ['commit', 'write'],
  ['diff-base', 'read'],
  ['push', 'draft'],
  ['open-review', 'draft'],
  ['merge', 'draft'],
];

const TRACKER_ROWS = [
  ['fetch-ticket', 'read'],
  ['query-tickets', 'read'],
  ['publish-ticket', 'write'],
  ['comment-ticket', 'write'],
  ['set-status', 'write'],
  ['link-tickets', 'draft'],
];

function adapterTemplate(title, rows, { defaultAccess = 'write' } = {}) {
  const lines = [`# ${title}`, ''];
  if (defaultAccess) lines.push(`**Default access:** \`${defaultAccess}\``, '');
  lines.push('## Operations', '', '| Operation | How | Access |', '| --- | --- | --- |');
  for (const [operation, access, how = 'Run the command.'] of rows) {
    lines.push(`| \`${operation}\` | ${how} | \`${access}\` |`);
  }
  return lines.join('\n') + '\n';
}

// A checks template's `## Levels` table, one command per listed level.
function levelsTable(levels) {
  const rows = levels.map((level) => `| \`${level}\` | \`npm run ${level}\` |`);
  return ['', '## Levels', '', '| Level | Command |', '| --- | --- |', ...rows].join('\n') + '\n';
}

function kitWithTemplate(path, content) {
  const kit = validKit();
  kit[`skills/aw-beta/adapters/${path}`] = content;
  return kit;
}

test('a tracker template missing a canonical operation is reported', () => {
  const rows = TRACKER_ROWS.filter(([operation]) => operation !== 'set-status');
  const kit = kitWithTemplate('tracker-github.md', adapterTemplate('Tracker: GitHub', rows));

  assertOneFinding(runOn(kit), /^skills\/aw-beta\/adapters\/tracker-github\.md: .*"set-status"/);
});

test('a write operation whose access is neither write nor draft is reported', () => {
  const rows = TRACKER_ROWS.map(([operation, access]) =>
    operation === 'publish-ticket' ? [operation, 'read'] : [operation, access],
  );
  const kit = kitWithTemplate('tracker-github.md', adapterTemplate('Tracker: GitHub', rows));

  assertOneFinding(runOn(kit), /^skills\/aw-beta\/adapters\/tracker-github\.md: .*"publish-ticket".*`write` or `draft`/);
});

test('a read operation given a write access level is reported', () => {
  const rows = TRACKER_ROWS.map(([operation, access]) =>
    operation === 'fetch-ticket' ? [operation, 'draft'] : [operation, access],
  );
  const kit = kitWithTemplate('tracker-github.md', adapterTemplate('Tracker: GitHub', rows));

  assertOneFinding(runOn(kit), /^skills\/aw-beta\/adapters\/tracker-github\.md: .*"fetch-ticket".*`read`/);
});

test('an operation row that does not say how it is performed is reported', () => {
  const rows = TRACKER_ROWS.map(([operation, access]) =>
    operation === 'comment-ticket' ? [operation, access, ''] : [operation, access],
  );
  const kit = kitWithTemplate('tracker-github.md', adapterTemplate('Tracker: GitHub', rows));

  assertOneFinding(runOn(kit), /^skills\/aw-beta\/adapters\/tracker-github\.md: .*"comment-ticket".*how/);
});

test('an operation outside the canonical vocabulary is reported', () => {
  const rows = [...TRACKER_ROWS, ['close-ticket', 'write']];
  const kit = kitWithTemplate('tracker-github.md', adapterTemplate('Tracker: GitHub', rows));

  assertOneFinding(runOn(kit), /^skills\/aw-beta\/adapters\/tracker-github\.md: .*"close-ticket".*canonical/);
});

test('a template with write operations but no default access level is reported', () => {
  const kit = kitWithTemplate(
    'tracker-github.md',
    adapterTemplate('Tracker: GitHub', TRACKER_ROWS, { defaultAccess: null }),
  );

  assertOneFinding(runOn(kit), /^skills\/aw-beta\/adapters\/tracker-github\.md: .*Default access/);
});

test('a template without an Operations table is reported once', () => {
  const kit = kitWithTemplate('vcs-github.md', '# VCS: GitHub\n\n**Default access:** `write`\n\nPush with git.\n');

  assertOneFinding(runOn(kit), /^skills\/aw-beta\/adapters\/vcs-github\.md: .*## Operations/);
});

test('an operation listed twice is reported', () => {
  const rows = [...TRACKER_ROWS, ['set-status', 'draft']];
  const kit = kitWithTemplate('tracker-github.md', adapterTemplate('Tracker: GitHub', rows));

  assertOneFinding(runOn(kit), /^skills\/aw-beta\/adapters\/tracker-github\.md: .*"set-status".*more than once/);
});

test('complete tracker, vcs and checks templates pass', () => {
  const kit = kitWithTemplate('tracker-github.md', adapterTemplate('Tracker: GitHub', TRACKER_ROWS));
  kit['skills/aw-beta/adapters/vcs-none.md'] = adapterTemplate('VCS: git, no review host', VCS_ROWS);
  kit['skills/aw-beta/adapters/checks.md'] = adapterTemplate(
    'Checks',
    [['run-check', 'read', 'Run the level\'s command from the Levels table.']],
    { defaultAccess: null },
  ) + levelsTable(['fast', 'task', 'full']);
  kit['skills/aw-beta/adapters/domain.md'] = '# Domain docs\n\nNo operations here.\n';

  assertNoFindings(runOn(kit));
});

test('a checks template missing a check level is reported', () => {
  const template =
    adapterTemplate('Checks', [['run-check', 'read', 'Run the level\'s command.']], { defaultAccess: null }) +
    levelsTable(['fast', 'full']);
  const kit = kitWithTemplate('checks.md', template);

  assertOneFinding(runOn(kit), /^skills\/aw-beta\/adapters\/checks\.md: .*"task"/);
});

// A skill installed through `npx skills` reads only its own folder, so a
// skill that needs another skill's adapter template carries a copy of it in
// its own `adapters/` folder, as aw-wayfinder carries aw-setup's local-markdown
// tracker. Every copy of a template must match the others byte for byte.

test('an adapter template whose copy in another skill differs is reported', () => {
  const kit = kitWithTemplate('tracker-local.md', adapterTemplate('Tracker: local markdown', TRACKER_ROWS));
  kit['skills/aw-alpha/adapters/tracker-local.md'] = adapterTemplate('Tracker: local files', TRACKER_ROWS);

  assertOneFinding(
    runOn(kit),
    /^skills\/aw-beta\/adapters\/tracker-local\.md: differs from its copy in skills\/aw-alpha\/adapters\/tracker-local\.md/,
  );
});

test('adapter templates copied unchanged into another skill pass', () => {
  const template = adapterTemplate('Tracker: local markdown', TRACKER_ROWS);
  const kit = kitWithTemplate('tracker-local.md', template);
  kit['skills/aw-alpha/adapters/tracker-local.md'] = template;

  assertNoFindings(runOn(kit));
});

// The never-allowed operations are stated in full in the `## Never allowed`
// section of docs/configuration.md. A file under `skills/` that carries its
// own restatement, such as a VCS adapter template, must match it, up to
// whitespace.

const NEVER_ALLOWED =
  'The agent never force-pushes, never deletes a branch, and never passes `--no-verify`.';

function neverAllowedPage(body = NEVER_ALLOWED) {
  return `# The configuration layer\n\n## Access levels\n\nRead is allowed.\n\n## Never allowed\n\n${body}\n\n## Defaults\n\nNone.\n`;
}

function neverAllowedRestatement(body = NEVER_ALLOWED) {
  return `# VCS: git\n\n## Never allowed\n\n${body}\n\n## Notes\n\nMore text.\n`;
}

test('a VCS template whose never-allowed list differs from the configuration page is reported', () => {
  const kit = kitWithTemplate(
    'vcs-github.md',
    adapterTemplate('VCS: GitHub', VCS_ROWS) +
      `\n## Never allowed\n\n${NEVER_ALLOWED.replace('deletes', 'renames')}\n`,
  );
  kit['docs/configuration.md'] = neverAllowedPage();

  assertOneFinding(
    runOn(kit),
    /^skills\/aw-beta\/adapters\/vcs-github\.md: "Never allowed" section differs from docs\/configuration\.md$/,
  );
});

test('a never-allowed restatement in a skill file that is not a template is also reported', () => {
  const kit = validKit();
  kit['docs/configuration.md'] = neverAllowedPage();
  kit['skills/aw-alpha/SKILL.md'] += `\n## Never allowed\n\n${NEVER_ALLOWED.replace('never passes', 'avoids')}\n`;

  assertOneFinding(
    runOn(kit),
    /^skills\/aw-alpha\/SKILL\.md: "Never allowed" section differs from docs\/configuration\.md$/,
  );
});

test('a never-allowed restatement with no configuration page to compare against is reported', () => {
  const kit = validKit();
  kit['skills/aw-beta/adapters/notes.md'] = neverAllowedRestatement();

  assertOneFinding(runOn(kit), /^docs\/configuration\.md: file is missing; .*"Never allowed".*skills\/aw-beta\/adapters\/notes\.md/);
});

test('a never-allowed restatement with no matching section on the configuration page is reported', () => {
  const kit = validKit();
  kit['docs/configuration.md'] = neverAllowedPage().replace('## Never allowed', '## Forbidden');
  kit['skills/aw-beta/adapters/notes.md'] = neverAllowedRestatement();

  assertOneFinding(runOn(kit), /^docs\/configuration\.md: has no "## Never allowed" section; .*skills\/aw-beta\/adapters\/notes\.md/);
});

test('never-allowed restatements that match the configuration page up to whitespace pass', () => {
  const kit = validKit();
  kit['docs/configuration.md'] = neverAllowedPage();
  kit['skills/aw-beta/adapters/notes.md'] = neverAllowedRestatement(NEVER_ALLOWED.replace(', never', ',\n  never'));
  kit['skills/aw-alpha/SKILL.md'] += `\n## Never allowed\n\n\n${NEVER_ALLOWED}  \n`;

  assertNoFindings(runOn(kit));
});

// The defaults an unconfigured repo runs on are stated in the `## Defaults
// when unconfigured` section of docs/configuration.md. A phase skill carries
// them in its own text (it cannot read the page when installed alone), and
// its restatement must match the page, up to whitespace, like the
// never-allowed list.

const DEFAULTS = 'When an adapter is missing, say once: "using defaults, run `/aw-setup`". Tracker: `none`.';

// A configuration page with both restatable sections: the never-allowed list
// and the defaults.
function configurationPage(defaults = DEFAULTS) {
  return neverAllowedPage().replace('## Defaults\n\nNone.', `## Defaults when unconfigured\n\n${defaults}`);
}

test('a defaults restatement in a skill that differs from the configuration page is reported', () => {
  const kit = validKit();
  kit['docs/configuration.md'] = configurationPage();
  kit['skills/aw-beta/SKILL.md'] += `\n## Defaults when unconfigured\n\n${DEFAULTS.replace('`none`', '`local`')}\n`;

  assertOneFinding(
    runOn(kit),
    /^skills\/aw-beta\/SKILL\.md: "Defaults when unconfigured" section differs from docs\/configuration\.md$/,
  );
});

// Phase skills and aw-setup are user-invoked (ADRs 0010, 0013). The user-invoked
// check above only catches a skill that declares one flag and not the other,
// so a phase skill is also reported when it declares neither.

test('a phase skill that declares neither invocation flag is reported', () => {
  const kit = validKit();
  kit['.claude-plugin/plugin.json'].skills.push('./skills/aw-spec');
  kit['skills/aw-spec/SKILL.md'] = '---\nname: aw-spec\ndescription: Write the spec.\n---\n\nBody.\n';

  assertOneFinding(runOn(kit), /^skills\/aw-spec\/SKILL\.md: .*phase skills are user-invoked.*disable-model-invocation: true/);
});

// A user-invoked skill cannot be called through the Skill tool, so no skill
// may name one the way a Skill tool call does, in double quotes (ADR 0012). A
// phase skill tells the user to run the next one as a slash command instead.

test('a skill that calls a user-invoked skill through the Skill tool is reported', () => {
  const kit = validKit();
  kit['skills/aw-alpha/SKILL.md'] += '\nWhen done, call the Skill tool with "aw-beta".\n';

  assertOneFinding(runOn(kit), /^skills\/aw-alpha\/SKILL\.md: .*"aw-beta" is user-invoked.*\/aw-beta/);
});

test('calling a model-invoked skill, or naming a user-invoked one as a slash command, passes', () => {
  const kit = validKit();
  kit['skills/aw-beta/SKILL.md'] += '\nCall the Skill tool with "aw-alpha". Then tell the user to run `/aw-beta`.\n';
  kit['skills/aw-beta/SKILL.md'] = kit['skills/aw-beta/SKILL.md'].replace('name: aw-beta', 'name: "aw-beta"');

  assertNoFindings(runOn(kit));
});

// A phase procedure holds the steps of one phase so that aw-converge can run
// them, and its door stays the phase's one owner (ADR 0016).

function kitWithProcedure() {
  const kit = validKit();
  kit['.claude-plugin/plugin.json'].skills.push('./skills/aw-build', './skills/aw-build-steps', './skills/aw-converge');
  kit['skills/aw-build/SKILL.md'] =
    '---\nname: aw-build\ndescription: Build.\ndisable-model-invocation: true\n---\n\n# Build\n\nCall the Skill tool with "aw-build-steps".\n';
  kit['skills/aw-build/agents/openai.yaml'] = 'policy:\n  allow_implicit_invocation: false\n';
  kit['skills/aw-build-steps/SKILL.md'] =
    '---\nname: aw-build-steps\ndescription: The steps of the build phase.\nuser-invocable: false\n---\n\n# Build steps\n\n## Steps\n\nBody.\n';
  kit['skills/aw-converge/SKILL.md'] =
    '---\nname: aw-converge\ndescription: Repeat rounds.\ndisable-model-invocation: true\n---\n\nCall the Skill tool with "aw-build-steps".\n';
  kit['skills/aw-converge/agents/openai.yaml'] = 'policy:\n  allow_implicit_invocation: false\n';
  return kit;
}

test('a phase procedure called by its door and aw-converge passes', () => {
  assertNoFindings(runOn(kitWithProcedure()));
});

test('any other skill that names a phase procedure is reported', () => {
  const kit = kitWithProcedure();
  kit['skills/aw-alpha/SKILL.md'] += '\nCall the Skill tool with "aw-build-steps".\n';

  assertOneFinding(runOn(kit), /^skills\/aw-alpha\/SKILL\.md: names the phase procedure "aw-build-steps".*only aw-build and aw-converge.*ADR 0016/);
});

test('a phase procedure that the / menu would show is reported', () => {
  const kit = kitWithProcedure();
  kit['skills/aw-build-steps/SKILL.md'] = kit['skills/aw-build-steps/SKILL.md'].replace('user-invocable: false\n', '');

  assertOneFinding(runOn(kit), /^skills\/aw-build-steps\/SKILL\.md: .*"user-invocable: false"/);
});

test('a door that does not call its phase procedure is reported', () => {
  const kit = kitWithProcedure();
  kit['skills/aw-build/SKILL.md'] = kit['skills/aw-build/SKILL.md'].replace('"aw-build-steps"', 'the steps');

  assertOneFinding(runOn(kit), /^skills\/aw-build\/SKILL\.md: .*must call its phase procedure "aw-build-steps"/);
});

test('a door that keeps steps of its own is reported, since the phase would have them twice', () => {
  const kit = kitWithProcedure();
  kit['skills/aw-build/SKILL.md'] += '\n## Steps\n\nBuild it here.\n';

  assertOneFinding(runOn(kit), /^skills\/aw-build\/SKILL\.md: .*a door holds no section/);
});

test('aw-converge declaring neither invocation flag is reported', () => {
  const kit = kitWithProcedure();
  kit['skills/aw-converge/SKILL.md'] = kit['skills/aw-converge/SKILL.md'].replace('disable-model-invocation: true\n', '');
  delete kit['skills/aw-converge/agents/openai.yaml'];

  assertOneFinding(runOn(kit), /^skills\/aw-converge\/SKILL\.md: .*user-invoked.*disable-model-invocation: true/);
});

test('a defaults restatement that matches the configuration page up to whitespace passes', () => {
  const kit = validKit();
  kit['docs/configuration.md'] = configurationPage();
  kit['skills/aw-beta/SKILL.md'] +=
    `\n## Defaults when unconfigured\n\n${DEFAULTS.replace('. ', '.\n')}\n\n## Steps\n\nMore.\n`;

  assertNoFindings(runOn(kit));
});
