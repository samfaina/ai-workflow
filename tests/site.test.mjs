// The docs site's guide (#189): the data and the rules behind its interactive
// parts live in site/guide.mjs, a module with no DOM, so these tests hold them
// to the kit's own text: the routes and the "Which route?" wizard to ADR 0013
// and aw-intake, the access-level simulator to docs/configuration.md, and the
// file tree, the upstream cards and the page's links to the repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownFiles, repoRoot } from './fixtures.mjs';
import {
  FILE_TREE,
  PRE_STEPS,
  ROUTES,
  UNCONFIGURED_ACCESS,
  VCS_OPERATIONS,
  accessOutcome,
  upstreamCards,
  wizardStep,
} from '../site/guide.mjs';

const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

// Walks the wizard from the start, answering each question from `answers` by
// its id, and returns the result. A question the answers do not cover fails.
function walk(answers) {
  const given = {};
  for (let step = 0; step < 20; step++) {
    const next = wizardStep(given);
    if (next.result) return { ...next.result, asked: Object.keys(given) };
    const { id, options } = next.question;
    assert.ok(id in answers, `the wizard asked "${id}", which this walk does not answer`);
    assert.ok(options.some(({ value }) => value === answers[id]), `"${answers[id]}" is not an answer to "${id}"`);
    given[id] = answers[id];
  }
  assert.fail('the wizard never reached a route');
}

const FAST_FEATURE = { type: 'feature', epic: 'no', contract: 'no', data: 'no', security: 'no', contradiction: 'no' };

test('the wizard sends a one-session task that changes no contract, data or security, and contradicts no spec, down the fast route', () => {
  const result = walk(FAST_FEATURE);
  assert.equal(result.route, 'fast');
  assert.equal(result.type, 'feature');
});

for (const [id, what] of [
  ['contract', 'a contract'],
  ['data', 'stored data'],
  ['security', 'anything security-related'],
]) {
  test(`the wizard sends a task that changes ${what} down the standard route`, () => {
    const result = walk({ ...FAST_FEATURE, [id]: 'yes' });
    assert.equal(result.route, 'standard');
  });
}

test('the wizard sends a task of several sessions or deliverables down the epic route, and asks about sessions once', () => {
  const result = walk({ type: 'feature', epic: 'yes' });
  assert.equal(result.route, 'epic');
  assert.equal(result.next, '/aw-wayfinder');
  assert.match(wizardStep({ type: 'feature' }).question.text, /more than one session/);
  assert.deepEqual(walk(FAST_FEATURE).asked, ['type', 'epic', 'contract', 'data', 'security', 'contradiction']);
});

test('a spec contradiction reported as a bug is a feature on the standard route', () => {
  const result = walk({ ...FAST_FEATURE, type: 'bug', contradiction: 'yes' });
  assert.equal(result.route, 'standard');
  assert.equal(result.type, 'feature');
  assert.match(result.reasons.join(' '), /reported as a bug/);
  assert.match(result.preStep, /^none/i);
});

test('an investigation takes the fast route, or the epic route when it spans several sessions, and never asks about a spec', () => {
  const short = walk({ type: 'investigation', sessions: 'no' });
  assert.equal(short.route, 'fast');
  assert.deepEqual(short.asked, ['type', 'sessions']);
  const long = walk({ type: 'investigation', sessions: 'yes' });
  assert.equal(long.route, 'epic');
  assert.match(long.preStep, /left to \/aw-wayfinder/);
});

test('when in doubt the wizard picks the longer route', () => {
  assert.equal(walk({ type: 'feature', epic: 'unsure' }).route, 'epic');
  assert.equal(walk({ ...FAST_FEATURE, data: 'unsure' }).route, 'standard');
  assert.equal(walk({ type: 'investigation', sessions: 'unsure' }).route, 'epic');
});

test('the wizard names the pre-step aw-intake runs for each type', () => {
  const preSteps = Object.fromEntries(
    ['feature', 'bug', 'refactor', 'performance'].map((type) => [type, walk({ ...FAST_FEATURE, type }).preStep]),
  );
  assert.match(preSteps.feature, /^none/i);
  assert.match(preSteps.bug, /aw-diagnosing-bugs/);
  assert.match(preSteps.refactor, /characterization tests/);
  assert.match(preSteps.performance, /baseline/);
  assert.match(walk({ type: 'investigation', sessions: 'no' }).preStep, /answer/i);
});

// The wizard restates aw-intake's route rules. Their lists are quoted from
// aw-intake's text, so a change to that text fails here and the page follows
// it, as .claude/CLAUDE.md's "Changing a rule" asks.
test("the wizard's contract and security questions quote aw-intake's lists", () => {
  const intake = read('skills/aw-intake/SKILL.md').toLowerCase();
  const contractQuestion = wizardStep({ type: 'feature', epic: 'no' }).question;
  const securityQuestion = wizardStep({ type: 'feature', epic: 'no', contract: 'no', data: 'no' }).question;
  assert.equal(contractQuestion.id, 'contract');
  assert.equal(securityQuestion.id, 'security');
  const contracts = contractQuestion.text.match(/: (.*)\?$/)[1];
  assert.ok(intake.includes(`(${contracts.toLowerCase()})`), contracts);
  const security = securityQuestion.hint.split('. ')[0];
  assert.ok(intake.includes(security.toLowerCase()), security);
  assert.ok(intake.includes('when two routes fit, pick the longer one'));
  assert.ok(intake.includes('upgrading an existing dependency does not, on its own, keep a task off the fast route'));
});

test('the wizard says /aw-intake makes the actual call', () => {
  const result = walk(FAST_FEATURE);
  assert.match(result.note, /\/aw-intake/);
});

// --- Routes -------------------------------------------------------------------

const skills = JSON.parse(read('site/skills.json'));
const skillNames = new Set(skills.map(({ name }) => name));

test('the routes hold the phases of ADR 0013, in order, with the pre-step after intake', () => {
  const ids = (route) => ROUTES.find(({ id }) => id === route).stations.map(({ id }) => id);
  assert.deepEqual(ROUTES.map(({ id }) => id), ['fast', 'standard', 'epic']);
  assert.deepEqual(ids('fast'), ['intake', 'pre-step', 'build', 'verify', 'review', 'ship']);
  assert.deepEqual(ids('standard'), ['intake', 'pre-step', 'spec', 'approval', 'slices', 'build', 'verify', 'review', 'ship', 'retro']);
  assert.deepEqual(ids('epic'), ['intake', 'pre-step', 'wayfinder', 'spec', 'approval', 'slices', 'build', 'verify', 'review', 'ship', 'retro']);
});

test('every station names the skill that owns it, what it does and the artifact it leaves', () => {
  for (const route of ROUTES) {
    for (const station of route.stations) {
      const where = `${route.id}/${station.id}`;
      assert.ok(skillNames.has(station.owner), `${where}: owner ${station.owner} is not in site/skills.json`);
      assert.ok(station.label && station.does && station.artifact, `${where}: missing label, does or artifact`);
    }
  }
});

test('on the epic route, every station from spec on runs once per deliverable', () => {
  const epic = ROUTES.find(({ id }) => id === 'epic').stations;
  assert.deepEqual(epic.filter((s) => s.perDeliverable).map((s) => s.id), ['spec', 'approval', 'slices', 'build', 'verify', 'review', 'ship', 'retro']);
});

test('spec approval is the one gate, and the fast route has none', () => {
  const gates = (route) => ROUTES.find(({ id }) => id === route).stations.filter(({ gate }) => gate).map(({ id }) => id);
  assert.deepEqual(gates('fast'), []);
  assert.deepEqual(gates('standard'), ['approval']);
  assert.deepEqual(gates('epic'), ['approval']);
});

test("the optional stations are the fast route's verify, which needs a verify skill, and retro", () => {
  const optional = Object.fromEntries(ROUTES.map(({ id, stations }) => [id, stations.filter((s) => s.optional).map((s) => s.id)]));
  assert.deepEqual(optional, { fast: ['verify'], standard: ['retro'], epic: ['retro'] });
});

test('the pre-step station shows what aw-intake runs for each type', () => {
  const preStep = ROUTES[0].stations.find(({ id }) => id === 'pre-step');
  assert.equal(preStep.owner, 'aw-intake');
  assert.deepEqual(PRE_STEPS.map(({ type }) => type), ['feature', 'bug', 'refactor', 'performance', 'investigation']);
});

// --- What lands where --------------------------------------------------------------

const nodes = (tree) => tree.flatMap((node) => [node, ...nodes(node.children ?? [])]);

// Every Markdown file under a skill's folder, and under its phase procedure's.
function skillText(name) {
  return [name, `${name}-steps`]
    .filter((folder) => existsSync(join(repoRoot, 'skills', folder)))
    .flatMap((folder) => markdownFiles(join('skills', folder)).map(read))
    .join('\n');
}

test('every node of the file tree names the skill that writes it, and one of those skills names its path', () => {
  const all = nodes(FILE_TREE);
  assert.ok(all.length >= 15, `only ${all.length} nodes`);
  for (const node of all) {
    assert.ok(node.writers?.length, `${node.path}: no writer`);
    for (const writer of node.writers) assert.ok(skillNames.has(writer), `${node.path}: ${writer} is not in site/skills.json`);
    assert.equal(typeof node.committed, 'boolean', `${node.path}: committed must be true or false`);
    assert.ok(node.about, `${node.path}: says nothing`);
    assert.ok(node.writers.some((writer) => skillText(writer).includes(node.path)), `${node.path}: no writer's text names it`);
  }
});

test('the file tree holds what the ticket names, and nothing under .aw/ is committed', () => {
  const paths = nodes(FILE_TREE).map(({ path }) => path);
  for (const path of ['docs/agents/', 'docs/specs/<slug>/spec.md', '.aw/drafts/', '.aw/reviews/', '.aw/retros/', '.aw/blast-radius/', '.claude/skills/verify-<app>/']) {
    assert.ok(paths.includes(path), `the tree leaves out ${path}`);
  }
  for (const node of nodes(FILE_TREE)) if (node.path.startsWith('.aw/')) assert.equal(node.committed, false, node.path);
});

// --- Upstreams -------------------------------------------------------------------

const UPSTREAM_NAMES = { pocock: 'Matt Pocock', addy: 'Addy Osmani', pstack: 'pstack' };
const noticeRows = read('NOTICE.md')
  .split('\n')
  .filter((line) => line.startsWith('| `aw-'))
  .map((line) => {
    const cells = line.split(' | ');
    return { name: cells[0].match(/`(aw-[^`]+)`/)[1], upstream: cells[1], kind: cells.at(-1).replace(/\s*\|$/, '').trim() };
  });

test('each upstream card lists, by kind, exactly the skills NOTICE.md credits to that upstream', () => {
  const cards = upstreamCards(skills);
  assert.deepEqual(cards.map(({ id }) => id), ['pocock', 'addy', 'pstack', 'kit']);
  for (const [id, name] of Object.entries(UPSTREAM_NAMES)) {
    const card = cards.find((candidate) => candidate.id === id);
    for (const kind of ['copy', 'adaptation']) {
      const listed = card.kinds.find((group) => group.kind === kind)?.skills ?? [];
      const credited = noticeRows.filter((row) => row.kind === kind && row.upstream.includes(name)).map((row) => row.name);
      assert.deepEqual([...listed].sort(), credited.sort(), `${id} ${kind}`);
    }
  }
  const pocockCopies = cards[0].kinds.find(({ kind }) => kind === 'copy').skills;
  assert.equal(pocockCopies.length, 12, "the README's count of Pocock copies");
});

test('the cards list every skill of site/skills.json, and the kit card every kit skill', () => {
  const cards = upstreamCards(skills);
  const listed = new Set(cards.flatMap(({ kinds }) => kinds.flatMap((group) => group.skills)));
  assert.deepEqual([...listed].sort(), [...skillNames].sort());
  const kit = cards.find(({ id }) => id === 'kit').kinds.flatMap((group) => group.skills);
  assert.deepEqual(kit.sort(), skills.filter(({ kind }) => kind === 'kit').map(({ name }) => name).sort());
  const pstackInspired = cards.find(({ id }) => id === 'pstack').kinds.find(({ kind }) => kind === 'inspired').skills;
  assert.deepEqual(pstackInspired, ['aw-verify']);
});

// --- The page --------------------------------------------------------------------

const page = read('site/index.html');

test('the page holds the 13 sections of #189, in order', () => {
  const order = [
    'top',
    'principles',
    'upstreams',
    'skills',
    'routes',
    'which-route',
    'install',
    'configure',
    'files',
    'spec',
    'runs',
    'faq',
    'maintaining',
  ];
  const found = [...page.matchAll(/<(?:header|section)\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(found, order);
  assert.doesNotMatch(page, /Coming soon/);
});

test('every link to a file of the repo on main points at a file that exists', () => {
  const sources = ['site/index.html', 'site/site.js', 'site/guide.mjs'].map(read).join('\n');
  const paths = [
    ...[...sources.matchAll(/https:\/\/github\.com\/samfaina\/ai-workflow\/(?:blob|tree)\/main\/([^"'#)\s`<]+)/g)].map((m) => m[1]),
    ...[...sources.matchAll(/\b(?:blob|tree)\('([^']+)'\)/g)].map((m) => m[1]),
  ];
  assert.ok(paths.length >= 20, `only ${paths.length} links found`);
  for (const path of paths) assert.ok(existsSync(join(repoRoot, path)), `${path} does not exist`);
});

test('the install section repeats the README install commands and nothing else', () => {
  const readme = read('README.md');
  const install = page.slice(page.indexOf('<section id="install"'), page.indexOf('</section>', page.indexOf('<section id="install"')));
  const commands = [...install.matchAll(/<pre class="block"[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => m[1]);
  assert.equal(commands.length, 3);
  assert.equal((install.match(/<button class="copy"/g) ?? []).length, 3, 'one copy button per command block');
  for (const block of commands) {
    for (const line of block.split('\n')) assert.ok(readme.includes(line.replace(/&lt;/g, '<').replace(/&gt;/g, '>')), `not in the README: ${line}`);
  }
});

// --- The access-level simulator ------------------------------------------------

const DRAFTS = /^\.aw\/drafts\/\d{8}-\d{6}-([a-z-]+)\.md$/;
const AT = new Date(2026, 10, 22, 9, 5, 7);

test('the simulator starts from the unconfigured defaults of docs/configuration.md', () => {
  assert.deepEqual(UNCONFIGURED_ACCESS, {
    'start-branch': 'write',
    commit: 'write',
    push: 'draft',
    'open-review': 'draft',
    merge: 'draft',
  });
  const defaults = read('docs/configuration.md').split('\n').find((line) => line.startsWith('| VCS |'));
  assert.ok(defaults.includes('`start-branch` and `commit` are at `write`; `push`, `open-review` and `merge` are at `draft`'), defaults);
});

test('the simulator lists every canonical VCS operation, with diff-base as its one read operation', () => {
  assert.deepEqual(VCS_OPERATIONS.map(({ name }) => name), ['diff-base', 'start-branch', 'commit', 'push', 'open-review', 'merge']);
  assert.equal(VCS_OPERATIONS.find(({ name }) => name === 'diff-base').read, true);
  assert.equal(accessOutcome('diff-base', UNCONFIGURED_ACCESS, AT).runs, true);
});

const ALL_WRITE = Object.fromEntries(Object.keys(UNCONFIGURED_ACCESS).map((name) => [name, 'write']));

test('at the unconfigured defaults, push, open-review and merge are drafted and the rest run', () => {
  const drafted = Object.keys(UNCONFIGURED_ACCESS).filter((name) => accessOutcome(name, UNCONFIGURED_ACCESS, AT).draft);
  assert.deepEqual(drafted, ['push', 'open-review', 'merge']);
});

test('an operation at draft is not run, and its draft is written to .aw/drafts/ under its name', () => {
  for (const name of Object.keys(UNCONFIGURED_ACCESS)) {
    const outcome = accessOutcome(name, { ...ALL_WRITE, [name]: 'draft' }, AT);
    assert.equal(outcome.runs, false, name);
    assert.equal(outcome.draft.match(DRAFTS)?.[1], name, outcome.draft);
    assert.equal(outcome.draft, `.aw/drafts/20261122-090507-${name}.md`);
    assert.equal(accessOutcome(name, ALL_WRITE, AT).draft, undefined);
  }
});

test('an operation at write is run, and merge at write stays conditional', () => {
  for (const name of Object.keys(UNCONFIGURED_ACCESS)) assert.equal(accessOutcome(name, ALL_WRITE, AT).runs, true, name);
  const merge = accessOutcome('merge', ALL_WRITE, AT).says;
  assert.match(merge, /no proven defect/);
  assert.match(merge, /full/);
  assert.match(merge, /implemented/);
});

test('a drafted push drafts open-review, and a drafted push or open-review drafts the merge, as aw-ship does', () => {
  const pushDrafted = { ...ALL_WRITE, push: 'draft' };
  const openReview = accessOutcome('open-review', pushDrafted, AT);
  assert.equal(openReview.runs, false);
  assert.equal(openReview.draft, '.aw/drafts/20261122-090507-open-review.md');
  assert.match(openReview.says, /push was drafted/);
  assert.equal(accessOutcome('merge', pushDrafted, AT).runs, false);
  const merge = accessOutcome('merge', { ...ALL_WRITE, 'open-review': 'draft' }, AT);
  assert.equal(merge.runs, false);
  assert.match(merge.says, /open-review was drafted/);
  const ship = read('skills/aw-ship/SKILL.md');
  assert.ok(ship.includes('When `push` was drafted, draft `open-review` too, whatever its access level'));
  assert.ok(ship.includes('when either was drafted, the merge is drafted too'));
});

test('commit at draft is the one level /aw-implement refuses to run with', () => {
  assert.match(accessOutcome('commit', { ...ALL_WRITE, commit: 'draft' }, AT).says, /\/aw-implement refuses/);
});
