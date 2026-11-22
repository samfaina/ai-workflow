// The docs site's script: the theme toggle, the skills explorer and the
// interactive guide. The data and rules come from guide.mjs, which
// tests/site.test.mjs holds to the kit's text; this file only draws them.
// Every control is a button, so it works by keyboard, and its state lives in
// aria-pressed, aria-current or aria-expanded. No dependencies (ADR 0008).

import { FILE_TREE, PRE_STEPS, ROUTES, UNCONFIGURED_ACCESS, VCS_OPERATIONS, accessOutcome, blob, upstreamCards, wizardStep } from './guide.mjs';

// --- Helpers -------------------------------------------------------------------

// A DOM element with its attributes and children; strings become text.
function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

function button(label, attributes, onClick) {
  const node = el('button', { type: 'button', ...attributes }, ...[label].flat());
  node.addEventListener('click', onClick);
  return node;
}

// Text with `code` spans, the way the data writes paths and commands.
const PATHLIKE = /(\/aw-[a-z-]+|aw-[a-z-]+|\.aw\/[^\s,:;]*|docs\/[^\s,:;]*|\.claude\/[^\s,:;]*|<[a-z-]+>|status: [a-z]+|test:|manual:|verify:|Done when:)/g;
function withCodeSpans(text) {
  return text.split(PATHLIKE).flatMap((part, index) => {
    if (index % 2 === 0) return [part];
    // A path that ends a sentence keeps its full stop outside the code span.
    return part.endsWith('.') ? [el('code', {}, part.slice(0, -1)), '.'] : [el('code', {}, part)];
  });
}

let skills = [];
const skillByName = (name) => skills.find((skill) => skill.name === name);
const invocation = (name) => (skillByName(name)?.invoked === 'user' ? `/${name}` : name);

// --- Theme -----------------------------------------------------------------------

const THEME_KEY = 'aw-theme';
const themeToggle = document.getElementById('theme-toggle');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const light = theme === 'light';
  themeToggle.textContent = light ? 'Dark theme' : 'Light theme';
  themeToggle.setAttribute('aria-pressed', String(light));
}

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
});

applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

// --- Skills explorer ---------------------------------------------------------------

const GROUPS = [
  { name: 'Setup', about: 'Run once per repo, and again to change the configuration.' },
  { name: 'Phases', about: 'Each owned by one skill and producing one artifact. You run them.' },
  { name: 'Runs across phases', about: 'They run several phases in one call. Neither ever ships.' },
  { name: 'Phase procedures', about: 'The steps behind a phase or a convergence run, so that a run can repeat them. You never invoke one directly.' },
  { name: 'Skills the phases call', about: 'Phase-free. A phase or another skill points to one when it needs it, and you can run any of them yourself.' },
  { name: 'Optional skills', about: 'Nothing obliges them. They run when a task calls for one or you invoke it.' },
];

const ORIGINS = { kit: 'kit', pocock: 'Matt Pocock', addy: 'Addy Osmani', pstack: 'pstack' };
const KINDS = { copy: 'copy', adaptation: 'adaptation', inspired: 'inspired skill', kit: 'kit skill' };

const list = document.getElementById('skill-list');
const detail = document.getElementById('skill-detail');
const originFilter = document.getElementById('origin-filter');
const groupFilter = document.getElementById('group-filter');

const explorer = { origin: 'all', group: 'all', selected: null };

function pills(skill) {
  return [
    ...skill.origin.map((origin) => el('span', { class: `pill ${origin}` }, ORIGINS[origin] ?? origin)),
    el('span', { class: 'pill kind' }, KINDS[skill.kind] ?? skill.kind),
  ];
}

function visibleSkills() {
  return skills.filter(
    (skill) =>
      (explorer.origin === 'all' || skill.origin.includes(explorer.origin)) &&
      (explorer.group === 'all' || skill.group === explorer.group),
  );
}

function howInvoked(skill) {
  if (skill.invoked === 'user') return 'By you, as a slash command.';
  if (skill.group === 'Phase procedures') return 'Only by the skills under Needs, never by you.';
  return 'By the model when the task calls for it, or by you.';
}

function drawFilter(container, options, current, onPick) {
  container.replaceChildren(
    ...options.map(([value, label]) => button(label, { 'aria-pressed': String(value === current) }, () => onPick(value))),
  );
}

function drawFilters() {
  drawFilter(originFilter, [['all', 'All'], ...Object.entries(ORIGINS)], explorer.origin, (origin) => {
    explorer.origin = origin;
    drawExplorer();
  });
  drawFilter(groupFilter, [['all', 'All'], ...GROUPS.map(({ name }) => [name, name])], explorer.group, (group) => {
    explorer.group = group;
    drawExplorer();
  });
}

function drawList(visible) {
  const items = [];
  for (const group of GROUPS) {
    const members = visible.filter((skill) => skill.group === group.name);
    if (members.length === 0) continue;
    items.push(el('li', { class: 'gl' }, group.name, el('small', {}, group.about)));
    for (const skill of members) {
      const attributes = skill.name === explorer.selected ? { 'aria-current': 'true' } : {};
      items.push(
        el(
          'li',
          {},
          button([el('span', {}, skill.name), ...pills(skill)], attributes, () => {
            explorer.selected = skill.name;
            drawExplorer();
          }),
        ),
      );
    }
  }
  if (items.length === 0) items.push(el('li', { class: 'empty' }, 'No skill matches both filters.'));
  list.replaceChildren(...items);
}

function drawDetail(skill) {
  if (!skill) {
    detail.replaceChildren(el('p', { class: 'muted' }, 'Pick a skill to see its detail.'));
    return;
  }
  const rows = [];
  if (skill.calledBy) {
    rows.push(
      el('dt', {}, 'Called by'),
      el('dd', {}, skill.calledBy.join(', '), el('small', {}, 'The skills whose text refers to it: a reference, not an obligation.')),
    );
  } else {
    rows.push(el('dt', {}, 'Needs'), el('dd', {}, skill.needs));
  }
  rows.push(
    el('dt', {}, 'Leaves'),
    el('dd', {}, skill.leaves),
    el('dt', {}, 'Origin'),
    el('dd', { class: 'pills' }, ...pills(skill)),
    el('dt', {}, 'Invoked'),
    el('dd', {}, howInvoked(skill)),
  );
  detail.replaceChildren(
    el('h3', {}, `${skill.invoked === 'user' ? '/' : ''}${skill.name}`),
    el('p', {}, skill.does),
    el('dl', { class: 'kv' }, ...rows),
  );
}

function drawExplorer() {
  const visible = visibleSkills();
  if (!visible.some((skill) => skill.name === explorer.selected)) explorer.selected = visible[0]?.name ?? null;
  drawFilters();
  drawList(visible);
  drawDetail(visible.find((skill) => skill.name === explorer.selected));
}

// --- Upstreams ----------------------------------------------------------------------

const KIND_HEADINGS = { copy: ['Copy', 'Copies'], adaptation: ['Adaptation', 'Adaptations'], inspired: ['Inspired', 'Inspired'], kit: ['Kit skill', 'Kit skills'] };

function drawUpstreams() {
  const cards = upstreamCards(skills).map((card) => {
    const total = card.kinds.reduce((sum, group) => sum + group.skills.length, 0);
    return el(
      'article',
      { class: `card ${card.id}` },
      el('h3', {}, el('span', { class: `dot ${card.id}`, 'aria-hidden': 'true' }), card.name, el('span', { class: 'count' }, `${total} skill${total === 1 ? '' : 's'}`)),
      el('p', { class: 'muted' }, card.about),
      card.repo ? el('a', { href: card.repo }, card.repo.replace('https://github.com/', '')) : null,
      ...card.kinds.map((group) => {
        const [one, many] = KIND_HEADINGS[group.kind];
        return [
          el('h4', {}, `${group.skills.length === 1 ? one : many} (${group.skills.length})`),
          el('ul', { class: 'names' }, ...group.skills.map((name) => el('li', {}, el('code', {}, name)))),
        ];
      }),
    );
  });
  document.getElementById('upstream-cards').replaceChildren(...cards);
}

// --- Routes ---------------------------------------------------------------------------

const routeLines = document.getElementById('route-lines');
const stationDetail = document.getElementById('station-detail');
// The selected station, which starts at the gate.
const routeSelection = { route: 'standard', station: 'approval' };

function drawRoutes() {
  routeLines.replaceChildren(
    ...ROUTES.map((route) => {
      const items = route.stations.map((station) => {
        const classes = [station.gate && 'gate', station.optional && 'opt', station.perDeliverable && 'per'].filter(Boolean).join(' ');
        const current = route.id === routeSelection.route && station.id === routeSelection.station;
        const label = [station.label, station.optional ? el('span', { class: 'sr' }, ' (optional)') : null];
        return el(
          'li',
          classes ? { class: classes } : {},
          button(label, current ? { 'aria-current': 'true' } : {}, () => {
            routeSelection.route = route.id;
            routeSelection.station = station.id;
            drawRoutes();
          }),
        );
      });
      return el(
        'div',
        { class: `route ${route.id}` },
        el('h3', { id: `route-${route.id}` }, `${route.name} route`),
        el('p', { class: 'muted' }, route.when),
        el('ol', { class: 'line', 'aria-labelledby': `route-${route.id}` }, ...items),
      );
    }),
  );
  drawStation();
}

function drawStation() {
  const route = ROUTES.find(({ id }) => id === routeSelection.route);
  const station = route.stations.find(({ id }) => id === routeSelection.station);
  const tags = [
    station.gate ? el('span', { class: 'tag gate' }, 'Human gate') : null,
    station.optional ? el('span', { class: 'tag' }, 'Optional') : null,
    station.perDeliverable ? el('span', { class: 'tag' }, 'Once per deliverable') : null,
  ].filter(Boolean);
  const rows = [
    el('dt', {}, 'Owner'),
    el('dd', {}, el('a', { href: blob(`skills/${station.owner}/SKILL.md`) }, el('code', {}, invocation(station.owner)))),
    el('dt', {}, 'Leaves'),
    el('dd', {}, withCodeSpans(station.artifact)),
  ];
  const children = [
    el('p', { class: 'eyebrow' }, `${route.name} route`),
    el('h3', {}, station.label),
    tags.length ? el('p', { class: 'tags' }, ...tags) : null,
    el('p', {}, withCodeSpans(station.does)),
    el('dl', { class: 'kv' }, ...rows),
  ];
  if (station.preStep) {
    children.push(
      el('h4', {}, 'By type'),
      el('dl', { class: 'kv' }, ...PRE_STEPS.flatMap(({ label, preStep }) => [el('dt', {}, label), el('dd', {}, withCodeSpans(preStep))])),
    );
  }
  stationDetail.replaceChildren(...children);
}

// --- Which route? ------------------------------------------------------------------------

const wizard = document.getElementById('wizard');
let answers = {};

function drawWizard(focus = false) {
  const step = wizardStep(answers);
  // Replay the answers in the order they were given, to show each question.
  const given = [];
  const replayed = {};
  for (const [id, value] of Object.entries(answers)) {
    const { question } = wizardStep(replayed);
    const option = question.options.find((candidate) => candidate.value === value);
    given.push(el('li', {}, el('span', { class: 'q' }, question.text), ' ', el('strong', {}, option.label)));
    replayed[id] = value;
  }
  const controls = [];
  if (Object.keys(answers).length) {
    controls.push(
      button('Back', {}, () => {
        const ids = Object.keys(answers);
        delete answers[ids.at(-1)];
        drawWizard(true);
      }),
      button('Start over', {}, () => {
        answers = {};
        drawWizard(true);
      }),
    );
  }
  const body = [];
  if (step.question) {
    const { id, text, hint, options } = step.question;
    body.push(
      el('h3', { tabindex: '-1', class: 'focus-target' }, text),
      hint ? el('p', { class: 'muted' }, hint) : null,
      el(
        'div',
        { class: 'seg answers', role: 'group', 'aria-label': text },
        ...options.map((option) =>
          button(option.hint ? [option.label, el('small', {}, option.hint)] : option.label, {}, () => {
            answers = { ...answers, [id]: option.value };
            drawWizard(true);
          }),
        ),
      ),
    );
  } else {
    const { route, reasons, preStep, next, note } = step.result;
    body.push(
      el('h3', { tabindex: '-1', class: `focus-target result ${route}` }, `Recommended: the ${route} route`),
      el('ul', { class: 'plain' }, ...reasons.map((reason) => el('li', {}, withCodeSpans(reason)))),
      el('dl', { class: 'kv' }, el('dt', {}, 'Pre-step'), el('dd', {}, withCodeSpans(preStep)), el('dt', {}, 'Next'), el('dd', {}, withCodeSpans(next))),
      el('p', { class: 'muted' }, withCodeSpans(note)),
      el('p', {}, el('a', { href: '#routes', 'data-route': route }, `See the ${route} route`)),
    );
  }
  wizard.replaceChildren(
    given.length ? el('ol', { class: 'given', 'aria-label': 'Your answers' }, ...given) : null,
    ...body,
    controls.length ? el('div', { class: 'actions' }, ...controls) : null,
  );
  wizard.querySelector('[data-route]')?.addEventListener('click', (event) => {
    routeSelection.route = event.currentTarget.dataset.route;
    routeSelection.station = 'intake';
    drawRoutes();
  });
  if (focus) wizard.querySelector('.focus-target')?.focus();
}

// --- Access-level simulator ------------------------------------------------------------------

const sim = document.getElementById('access-sim');
let levels = { ...UNCONFIGURED_ACCESS };

// A redraw replaces the buttons, so the one that was used gets focus back.
const levelButton = (name, level) => `[data-op="${name}"][data-level="${level}"]`;

function drawSim(focusSelector) {
  const rows = VCS_OPERATIONS.map((operation) => {
    const level = operation.read ? 'read' : levels[operation.name];
    const outcome = accessOutcome(operation.name, levels);
    const choice = operation.read
      ? el('span', { class: 'fixed' }, 'read: always allowed')
      : el(
          'div',
          { class: 'seg', role: 'group', 'aria-label': `Access level of ${operation.name}` },
          ...['write', 'draft'].map((value) =>
            button(value, { 'aria-pressed': String(level === value), 'data-op': operation.name, 'data-level': value }, () => {
              levels = { ...levels, [operation.name]: value };
              drawSim(levelButton(operation.name, value));
            }),
          ),
        );
    const result = [el('p', {}, withCodeSpans(outcome.says))];
    if (outcome.draft) {
      result.push(
        el(
          'div',
          { class: 'draft' },
          el('p', {}, 'Draft written to ', el('code', {}, outcome.draft), ', and not run:'),
          el('pre', { class: 'block' }, el('code', {}, operation.command)),
        ),
      );
    } else if (!operation.read) {
      result.push(el('p', { class: 'muted' }, 'Runs: ', el('code', {}, operation.command)));
    }
    return el(
      'div',
      { class: `op ${outcome.draft ? 'is-draft' : 'is-run'}` },
      el('div', { class: 'op-head' }, el('code', { class: 'op-name' }, operation.name), choice),
      el('div', { class: 'op-result', 'aria-live': 'polite' }, ...result),
    );
  });
  const atDefaults = Object.entries(UNCONFIGURED_ACCESS).every(([name, level]) => levels[name] === level);
  sim.replaceChildren(
    ...rows,
    el(
      'div',
      { class: 'actions' },
      button('Back to the unconfigured defaults', atDefaults ? { disabled: '' } : {}, () => {
        levels = { ...UNCONFIGURED_ACCESS };
        // The reset button is disabled once redrawn, so keep focus in the simulator.
        drawSim('[data-op]');
      }),
    ),
  );
  if (focusSelector) sim.querySelector(focusSelector)?.focus();
}

// --- What lands where --------------------------------------------------------------------------

const fileTree = document.getElementById('file-tree');
const fileDetail = document.getElementById('file-detail');
const fileSelection = { selected:'docs/specs/<slug>/spec.md', collapsed: new Set() };

function fileNode(node, depth) {
  const name = depth === 0 ? node.path : node.path.slice(node.path.lastIndexOf('/', node.path.length - 2) + 1);
  const current = node.path === fileSelection.selected;
  const row = [
    node.children
      ? button(el('span', { 'aria-hidden': 'true' }, fileSelection.collapsed.has(node.path) ? '▸' : '▾'), {
          class: 'disclose',
          'data-disclose': node.path,
          'aria-expanded': String(!fileSelection.collapsed.has(node.path)),
          'aria-label': `Show what is in ${node.path}`,
        }, () => {
          if (fileSelection.collapsed.has(node.path)) fileSelection.collapsed.delete(node.path);
          else fileSelection.collapsed.add(node.path);
          drawFiles(`[data-disclose="${node.path}"]`);
        })
      : el('span', { class: 'spacer', 'aria-hidden': 'true' }),
    button([el('span', {}, name), node.committed ? null : el('span', { class: 'pill kind' }, 'local')], { 'data-path': node.path, ...(current ? { 'aria-current': 'true' } : {}) }, () => {
      fileSelection.selected = node.path;
      drawFiles(`[data-path="${node.path}"]`);
    }),
  ];
  const children = node.children && !fileSelection.collapsed.has(node.path) ? el('ul', {}, ...node.children.map((child) => fileNode(child, depth + 1))) : null;
  return el('li', {}, el('div', { class: 'row' }, ...row), children);
}

function findNode(nodes, path) {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = findNode(node.children ?? [], path);
    if (found) return found;
  }
  return null;
}

// A redraw replaces the buttons, so the one that was used gets focus back.
function drawFiles(focusSelector) {
  fileTree.replaceChildren(...FILE_TREE.map((node) => fileNode(node, 0)));
  const node = findNode(FILE_TREE, fileSelection.selected);
  fileDetail.replaceChildren(
    el('h3', {}, node.path),
    el('p', {}, withCodeSpans(node.about)),
    el(
      'dl',
      { class: 'kv' },
      el('dt', {}, 'Written by'),
      el('dd', {}, ...node.writers.flatMap((writer, index) => [index ? ', ' : '', el('code', {}, invocation(writer))])),
      el('dt', {}, 'Committed'),
      el('dd', {}, node.committed ? 'Yes: it belongs to the repo.' : 'No: it is local, under the git-ignored .aw/.'),
    ),
  );
  if (focusSelector) fileTree.querySelector(focusSelector)?.focus();
}

// --- Anatomy of a spec -------------------------------------------------------------------------

const SPEC_NOTES = {
  draft: '/aw-spec wrote it and stopped at spec approval. The open BLOCKS question must be resolved before you can approve it.',
  approved: 'You approved it, and /aw-slices then wrote the slice plan and the agreed seams. Nothing is built yet.',
  implemented: 'Every slice is built, /aw-verify recorded its results, and /aw-ship set the status.',
};

function drawSpec(status) {
  for (const control of document.querySelectorAll('#spec-status button')) control.setAttribute('aria-pressed', String(control.dataset.status === status));
  for (const part of document.querySelectorAll('#spec-doc [data-only]')) part.hidden = !part.dataset.only.split(' ').includes(status);
  document.getElementById('spec-status-value').textContent = status;
  document.getElementById('spec-status-note').replaceChildren(...withCodeSpans(SPEC_NOTES[status]));
}

for (const control of document.querySelectorAll('#spec-status button')) control.addEventListener('click', () => drawSpec(control.dataset.status));

// --- Copy buttons ------------------------------------------------------------------------------

for (const copy of document.querySelectorAll('.copyable .copy')) {
  copy.setAttribute('aria-label', 'Copy the command');
  copy.addEventListener('click', async () => {
    const text = copy.parentElement.querySelector('code').textContent;
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Select and copy';
    }
    setTimeout(() => (copy.textContent = 'Copy'), 2000);
  });
}

// --- Start -------------------------------------------------------------------------------------

drawRoutes();
drawWizard();
drawSim();
drawFiles();
drawSpec('draft');

fetch('skills.json')
  .then((response) => {
    if (!response.ok) throw new Error(`skills.json: HTTP ${response.status}`);
    return response.json();
  })
  .then((loaded) => {
    skills = loaded;
    drawExplorer();
    drawUpstreams();
    drawStation();
    drawFiles();
  })
  .catch(() => {
    list.replaceChildren(el('li', { class: 'empty' }, 'The skills could not be loaded. Serve site/ with a static server to preview it locally.'));
    detail.replaceChildren(el('p', { class: 'muted' }, 'Nothing to show yet.'));
    document.getElementById('upstream-cards').replaceChildren(el('p', { class: 'muted' }, 'The skills could not be loaded.'));
  });
