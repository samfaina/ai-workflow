// The docs site's script: the theme toggle and the skills explorer, which
// shows every skill from skills.json. No dependencies (ADR 0008).

// --- Theme -----------------------------------------------------------------

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

// --- Skills explorer ---------------------------------------------------------

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

const state = { skills: [], origin: 'all', group: 'all', selected: null };

// A DOM element with its attributes and children; strings become text.
function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

function pills(skill) {
  return [
    ...skill.origin.map((origin) => el('span', { class: `pill ${origin}` }, ORIGINS[origin] ?? origin)),
    el('span', { class: 'pill kind' }, KINDS[skill.kind] ?? skill.kind),
  ];
}

function visibleSkills() {
  return state.skills.filter(
    (skill) =>
      (state.origin === 'all' || skill.origin.includes(state.origin)) &&
      (state.group === 'all' || skill.group === state.group),
  );
}

function howInvoked(skill) {
  if (skill.invoked === 'user') return 'By you, as a slash command.';
  if (skill.group === 'Phase procedures') return 'Only by the skills under Needs, never by you.';
  return 'By the model when the task calls for it, or by you.';
}

function drawFilter(container, options, current, onPick) {
  container.replaceChildren(
    ...options.map(([value, label]) => {
      const button = el('button', { type: 'button', 'aria-pressed': String(value === current) }, label);
      button.addEventListener('click', () => onPick(value));
      return button;
    }),
  );
}

function drawFilters() {
  drawFilter(originFilter, [['all', 'All'], ...Object.entries(ORIGINS)], state.origin, (origin) => {
    state.origin = origin;
    draw();
  });
  drawFilter(groupFilter, [['all', 'All'], ...GROUPS.map(({ name }) => [name, name])], state.group, (group) => {
    state.group = group;
    draw();
  });
}

function drawList(visible) {
  const items = [];
  for (const group of GROUPS) {
    const members = visible.filter((skill) => skill.group === group.name);
    if (members.length === 0) continue;
    items.push(el('li', { class: 'gl' }, group.name, el('small', {}, group.about)));
    for (const skill of members) {
      const attributes = { type: 'button' };
      if (skill.name === state.selected) attributes['aria-current'] = 'true';
      const button = el('button', attributes, el('span', {}, skill.name), ...pills(skill));
      button.addEventListener('click', () => {
        state.selected = skill.name;
        draw();
      });
      items.push(el('li', {}, button));
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

function draw() {
  const visible = visibleSkills();
  if (!visible.some((skill) => skill.name === state.selected)) state.selected = visible[0]?.name ?? null;
  drawFilters();
  drawList(visible);
  drawDetail(visible.find((skill) => skill.name === state.selected));
}

fetch('skills.json')
  .then((response) => {
    if (!response.ok) throw new Error(`skills.json: HTTP ${response.status}`);
    return response.json();
  })
  .then((skills) => {
    state.skills = skills;
    draw();
  })
  .catch(() => {
    list.replaceChildren(el('li', { class: 'empty' }, 'The skills could not be loaded. Serve site/ with a static server to preview it locally.'));
    detail.replaceChildren(el('p', { class: 'muted' }, 'Nothing to show yet.'));
  });
