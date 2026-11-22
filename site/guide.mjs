// The data and the rules behind the docs site's interactive parts: the routes,
// the "Which route?" wizard, the access-level simulator, the file tree and the
// upstream cards. No DOM here, so tests/site.test.mjs holds each one to the
// kit's own text; site.js draws them. No dependencies (ADR 0008).

export const REPO = 'https://github.com/samfaina/ai-workflow';
export const blob = (path) => `${REPO}/blob/main/${path}`;

// --- Routes -------------------------------------------------------------------
// The three routes of ADR 0013, phase by phase, with each phase's owner and
// artifact from ADR 0010 and the phases' own SKILL.md.

const STATION = {
  intake: {
    label: 'intake',
    owner: 'aw-intake',
    does: 'Takes a ticket or free text, classifies its type and its route with a reason for each, and names the skill to run next. It changes no code.',
    artifact: 'The type and the route, reported in chat.',
  },
  'pre-step': {
    label: 'pre-step',
    owner: 'aw-intake',
    preStep: true,
    does: "Before any change, intake runs the pre-step of the task's type. When the pre-step changes what the classification rested on, intake classifies again.",
    artifact: "The pre-step's evidence: a reproduction, characterization tests, a baseline or an answer. A feature has none.",
  },
  wayfinder: {
    label: 'wayfinder',
    owner: 'aw-wayfinder',
    does: 'Charts the effort as a map of decision tickets in the tracker, resolves them one per session, and hands each deliverable to /aw-spec. It plans and never builds.',
    artifact: 'A map and its decision tickets in the tracker, and the list of deliverables.',
  },
  spec: {
    label: 'spec',
    owner: 'aw-spec',
    does: 'Grills you, explores the repo, and writes the spec as a draft: numbered acceptance criteria, Boundaries, a Test strategy and Traceability. Then it stops.',
    artifact: 'docs/specs/<slug>/spec.md at status: draft.',
  },
  approval: {
    label: 'Spec approval',
    owner: 'aw-spec',
    gate: true,
    does: 'The one fixed human gate. The work goes on only once you approve the spec explicitly in the conversation, and only then does the agent set status: approved.',
    artifact: 'The spec at status: approved.',
  },
  slices: {
    label: 'slices',
    owner: 'aw-slices',
    does: 'Plans the approved spec as vertical tracer-bullet slices that cover every AC-n, riskiest first, and agrees the test seams with you.',
    artifact: "The spec's Slice plan and Test strategy, and mirror tickets where the tracker allows.",
  },
  build: {
    label: 'build',
    owner: 'aw-build',
    does: "Builds one slice per call, test-first at the agreed seams, runs the task check level and ticks the slice's done marker. Run it once per slice.",
    artifact: "One local commit per slice, with the spec's Traceability pointing at its evidence.",
  },
  verify: {
    label: 'verify',
    owner: 'aw-verify',
    does: "Proves each acceptance criterion on the real app through the repo's verify skill. With no verify skill, each criterion needs test: or manual: evidence.",
    artifact: "A verify result per criterion under the spec's verify/ folder, named in Traceability, in a local commit.",
  },
  review: {
    label: 'review',
    owner: 'aw-review',
    does: 'Reviews the diff from the diff base on the Spec, Standards and Security axes, each in its own subagent. A defect counts only when a run proves it; any other finding is a risk.',
    artifact: 'A review report under .aw/reviews/. It stays local and is never posted to the review host.',
  },
  ship: {
    label: 'ship',
    owner: 'aw-ship',
    does: "Runs the full check level, sets the spec to implemented, writes the review request body, then pushes, opens the review request and merges only as far as the VCS adapter's access levels allow.",
    artifact: 'The review request body and the spec set to implemented, with a draft in .aw/drafts/ for each operation at draft.',
  },
  retro: {
    label: 'retro',
    owner: 'aw-retro',
    optional: true,
    does: 'Turns every error class the session repeated into the highest control on its ladder that works, proven to fail on the real case and pass on a correct one. It changes nothing until you approve.',
    artifact: 'A retro report under .aw/retros/, with the controls it proposes.',
  },
};

const FAST_ROUTE_STATION = {
  intake: { artifact: 'The type and the route, reported in chat, with 1 to 3 done-when criteria in place of a spec.' },
  build: {
    does: 'Builds the whole task in one call, test-first, until each done-when criterion holds. There is no spec.',
    artifact: 'Local commits that carry the done-when criteria as Done when: lines.',
  },
  verify: {
    optional: true,
    does: 'Runs only when the repo has a verify skill: proves the done-when criteria on the real app.',
    artifact: 'Result files under .aw/verify/, kept local and never committed.',
  },
  review: { does: 'Reviews the diff on the same three axes, judging the Spec axis against the done-when criteria.' },
  ship: {
    does: "Runs the full check level, writes the review request body with what proves each done-when criterion, then pushes, opens the review request and merges as far as the access levels allow.",
    artifact: 'The review request body alone: there is no spec to set to implemented.',
  },
};

// The stations of a route, with each route's own wording over the shared one.
// From the station `perDeliverableFrom` names on, each runs once per deliverable.
const stations = (ids, overrides = {}, perDeliverableFrom) =>
  ids.map((id, index) => ({
    id,
    ...STATION[id],
    ...overrides[id],
    ...(perDeliverableFrom && index >= ids.indexOf(perDeliverableFrom) ? { perDeliverable: true } : {}),
  }));

const STANDARD = ['intake', 'pre-step', 'spec', 'approval', 'slices', 'build', 'verify', 'review', 'ship', 'retro'];

export const ROUTES = [
  {
    id: 'fast',
    name: 'Fast',
    when: 'Fits in one session; no change to contracts, data or security; no spec contradiction. It has no spec, so it has no gate.',
    stations: stations(['intake', 'pre-step', 'build', 'verify', 'review', 'ship'], FAST_ROUTE_STATION),
  },
  {
    id: 'standard',
    name: 'Standard',
    when: 'Everything else. The spec comes first, and nothing is built before you approve it.',
    stations: stations(STANDARD),
  },
  {
    id: 'epic',
    name: 'Epic',
    when: 'Several sessions or deliverables. From spec on, each deliverable takes the standard route with a spec of its own.',
    stations: stations(['intake', 'pre-step', 'wayfinder', ...STANDARD.slice(STANDARD.indexOf('spec'))], {}, 'spec'),
  },
];

// --- Upstreams -------------------------------------------------------------------
// One card per upstream and one for the kit's own skills, drawn from
// skills.json, whose kinds and origins validate-kit keeps in step with
// NOTICE.md. aw-ship has two upstreams, so it sits on both their cards.

export const UPSTREAMS = [
  {
    id: 'pocock',
    name: 'Matt Pocock',
    repo: 'https://github.com/mattpocock/skills',
    about: 'mattpocock/skills, pinned in upstreams.json and synced by script. The kit copies most of its phase-free skills from here, and adapts its planning and review skills.',
  },
  {
    id: 'addy',
    name: 'Addy Osmani',
    repo: 'https://github.com/addyosmani/agent-skills',
    about: 'addyosmani/agent-skills, pinned in upstreams.json. Security, observability, the spec Boundaries and the pre-ship checklist come from here.',
  },
  {
    id: 'pstack',
    name: 'pstack',
    repo: 'https://github.com/cursor/plugins',
    about: "Lauren Tan's pstack, in cursor/plugins. Not in upstreams.json and never synced: the kit takes only adaptations and inspired skills from it.",
  },
  {
    id: 'kit',
    name: 'The kit',
    about: 'Kit skills written from scratch for this kit (ADR 0014), with no upstream text.',
  },
];

const KIND_ORDER = ['copy', 'adaptation', 'inspired', 'kit'];

export function upstreamCards(skills) {
  return UPSTREAMS.map((upstream) => {
    const members = skills.filter((skill) => skill.origin.includes(upstream.id));
    const kinds = KIND_ORDER.map((kind) => ({ kind, skills: members.filter((skill) => skill.kind === kind).map((skill) => skill.name) })).filter(
      (group) => group.skills.length > 0,
    );
    return { ...upstream, kinds };
  });
}

// --- What lands where ----------------------------------------------------------
// What the kit writes in a repo. Each path is named in the text of one of its
// writers, which tests/site.test.mjs checks.

export const FILE_TREE = [
  {
    path: 'AGENTS.md',
    writers: ['aw-setup'],
    committed: true,
    about: 'The ## Agent skills block, through which every skill finds the adapters. It goes in CLAUDE.md when only that exists, and a re-run updates it in place.',
  },
  {
    path: 'docs/agents/',
    writers: ['aw-setup'],
    committed: true,
    about: 'The adapters and the domain doc. Edit them by hand or re-run /aw-setup.',
    children: [
      {
        path: 'docs/agents/tracker.md',
        writers: ['aw-setup', 'aw-wayfinder'],
        committed: true,
        about: 'The tracker adapter. /aw-wayfinder writes a local-markdown one when the repo has no tracker.',
      },
      { path: 'docs/agents/vcs.md', writers: ['aw-setup'], committed: true, about: 'The VCS adapter: base branch, branch naming, review host and access levels.' },
      { path: 'docs/agents/checks.md', writers: ['aw-setup'], committed: true, about: 'The command for each check level: fast, task and full.' },
      { path: 'docs/agents/domain.md', writers: ['aw-setup'], committed: true, about: 'Where the glossary and the ADRs live.' },
    ],
  },
  {
    path: 'docs/specs/<slug>/',
    writers: ['aw-spec'],
    committed: true,
    about: 'One folder per spec, named by slug and never by ticket key, so that verify results can sit next to it.',
    children: [
      {
        path: 'docs/specs/<slug>/spec.md',
        writers: ['aw-spec', 'aw-slices', 'aw-build', 'aw-verify', 'aw-ship'],
        committed: true,
        about: '/aw-spec writes it and /aw-slices adds its Slice plan and Test strategy, without committing. /aw-build commits its done markers and Traceability with each slice, /aw-verify commits its verify: evidence, and /aw-ship commits the status implemented.',
      },
      {
        path: 'docs/specs/<slug>/verify/',
        writers: ['aw-verify'],
        committed: true,
        about: 'One verify result per acceptance criterion, ac-<n>.md, committed with the spec edits that name it in Traceability.',
      },
    ],
  },
  {
    path: '.claude/skills/verify-<app>/',
    writers: ['aw-create-verify'],
    committed: true,
    about: "The repo's verify skill: how to start, drive, observe and clean up the real app, with its feature map. No aw- prefix: it belongs to the repo, not to the kit. Committed with the project (ADR 0011).",
  },
  {
    path: '.aw/',
    writers: [], // filled below from the folders in it
    committed: false,
    about: "The kit's local working directory. /aw-setup adds it to .gitignore, and nothing in it is ever committed. Each folder in it has its own writers.",
    children: [
      {
        path: '.aw/drafts/',
        writers: ['aw-ship', 'aw-build', 'aw-verify', 'aw-create-verify', 'aw-slices', 'aw-wayfinder', 'aw-retro', 'aw-unslop'],
        committed: false,
        about: 'One draft per write operation at draft, named <yyyymmdd-hhmmss>-<operation>.md, with the exact command or text for a person to apply. Each skill that performs a write operation leaves one when that operation is at draft, and aw-unslop may rewrite the body of a drafted open-review.',
      },
      { path: '.aw/reviews/', writers: ['aw-review'], committed: false, about: 'The review reports, one per review, never posted to the review host.' },
      { path: '.aw/review-requests/', writers: ['aw-ship'], committed: false, about: 'The review request body /aw-ship writes before it opens the review request.' },
      { path: '.aw/verify/', writers: ['aw-verify'], committed: false, about: 'Verify results on the fast route, which has no spec to keep them next to.' },
      { path: '.aw/repro/', writers: ['aw-intake'], committed: false, about: "A bug's reproduction, until /aw-build turns it into a committed test or deletes it." },
      { path: '.aw/baselines/', writers: ['aw-intake'], committed: false, about: "A performance task's baseline: the command, the machine, every run and the median." },
      { path: '.aw/research/', writers: ['aw-research', 'aw-intake'], committed: false, about: "An investigation's findings from outside the repo, which /aw-intake asks aw-research to save here." },
      { path: '.aw/implement/', writers: ['aw-implement'], committed: false, about: "The journal of an implementation run: agreed seams, the round count and progress, read again before each step." },
      { path: '.aw/retros/', writers: ['aw-retro'], committed: false, about: 'The retro reports. A later retro counts their seen-once error classes.' },
      { path: '.aw/blast-radius/', writers: ['aw-blast-radius'], committed: false, about: 'Each blast-radius report, with its conclusion and its proof script.' },
    ],
  },
];

for (const folder of FILE_TREE.filter((node) => node.writers.length === 0)) {
  folder.writers = [...new Set(folder.children.flatMap((child) => child.writers))];
}

// --- Access-level simulator -----------------------------------------------------
// The canonical VCS operations and the access levels of docs/configuration.md.
// Each command is the How cell of skills/aw-setup/adapters/vcs-github.md.

export const VCS_OPERATIONS = [
  {
    name: 'diff-base',
    read: true,
    command: 'git merge-base HEAD origin/<base>',
    says: { read: 'A read operation, always allowed: the merge-base that aw-review diffs the change against.' },
  },
  {
    name: 'start-branch',
    command: 'git switch -c <branch> origin/<base>',
    says: {
      write: 'The agent creates the work branch, named by the branch naming of the VCS adapter.',
      draft: 'The branch is not created. On a protected branch, /aw-implement refuses to start: create the branch yourself and run it again.',
    },
  },
  {
    name: 'commit',
    command: 'git add <paths>; git commit -F <message-file>',
    says: {
      write: 'The agent makes local commits: each slice, each verify run and each fix run lands as one.',
      draft: 'No slice can land, and /aw-implement refuses to run until commit is back at write. Run the phases by hand and apply each commit yourself.',
    },
  },
  {
    name: 'push',
    command: 'git push -u origin <branch>',
    says: {
      write: '/aw-ship pushes the work branch, never to a protected branch and never with force.',
      draft: 'Nothing is pushed. /aw-ship leaves the command for you to run.',
    },
  },
  {
    name: 'open-review',
    command: 'gh pr create --base <base> --head <branch> --title "<title>" --body-file <file>',
    says: {
      write: '/aw-ship opens the review request on the review host, with the body it wrote.',
      draft: 'No review request is opened. The draft holds the command and the whole review request body.',
    },
  },
  {
    name: 'merge',
    command: 'gh pr merge <n> --<merge-method>',
    says: {
      write: '/aw-ship merges only when aw-review found no proven defect and the full check level passed, and, for a change with a spec, once the spec is implemented and passes the script-verified spec check.',
      draft: 'A person merges. /aw-ship leaves the command for you.',
    },
  },
];

// docs/configuration.md, Defaults when unconfigured.
export const UNCONFIGURED_ACCESS = {
  'start-branch': 'write',
  commit: 'write',
  push: 'draft',
  'open-review': 'draft',
  merge: 'draft',
};

const pad = (n) => String(n).padStart(2, '0');
const stamp = (at) =>
  `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;

// aw-ship step 6 and its merge conditions, with a review host: a drafted push
// drafts open-review whatever its level, and a drafted push or open-review
// drafts the merge.
const DRAFTED_BY = { 'open-review': ['push'], merge: ['push', 'open-review'] };

// What happens to one operation, given the level of every write operation:
// whether the agent runs it, what that means, and when it is drafted, the
// file the draft is written to.
export function accessOutcome(name, levels, at = new Date()) {
  const operation = VCS_OPERATIONS.find((candidate) => candidate.name === name);
  if (operation.read) return { runs: true, says: operation.says.read };
  const draftedEarlier = (DRAFTED_BY[name] ?? []).find((earlier) => accessOutcome(earlier, levels, at).draft);
  const level = draftedEarlier ? 'draft' : levels[name];
  const outcome = { runs: level === 'write', says: operation.says[level] };
  if (draftedEarlier && levels[name] === 'write') {
    outcome.says = `Drafted although it is at write: ${draftedEarlier} was drafted, so the review host has nothing to ${name === 'merge' ? 'merge' : 'review'} yet.`;
  }
  if (level === 'draft') outcome.draft = `.aw/drafts/${stamp(at)}-${name}.md`;
  return outcome;
}

// --- Which route? ------------------------------------------------------------
// Mirrors steps 3 and 4 of skills/aw-intake/SKILL.md. The page says so: the
// wizard only recommends, and /aw-intake makes the actual call.

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Not sure' },
];

const TYPES = {
  feature: { label: 'Feature', about: 'new behaviour', preStep: 'None: a feature has no pre-step.' },
  bug: {
    label: 'Bug',
    about: 'behaviour that differs from what was intended',
    preStep: 'Reproduce it with aw-diagnosing-bugs: one command that goes red on the bug, with any test file it runs kept under .aw/repro/ until /aw-build commits it as a test or deletes it.',
  },
  refactor: {
    label: 'Refactor',
    about: 'a change in structure with no change in behaviour',
    preStep: 'Add characterization tests that pin the current behaviour.',
  },
  performance: {
    label: 'Performance',
    about: 'the same behaviour, faster or using less',
    preStep: 'Measure a baseline, written to .aw/baselines/.',
  },
  investigation: {
    label: 'Investigation',
    about: 'a question to answer; nothing changes',
    preStep: 'Answer the question, citing code, or hand it to aw-research. An investigation changes nothing.',
  },
};

// The pre-step aw-intake runs for each type, as the routes' pre-step station
// shows it.
export const PRE_STEPS = Object.entries(TYPES).map(([type, { label, preStep }]) => ({ type, label, preStep }));

const QUESTIONS = {
  type: {
    text: 'What kind of task is it?',
    options: Object.entries(TYPES).map(([value, { label, about }]) => ({ value, label, hint: about })),
  },
  sessions: {
    text: 'Will answering it take several sessions?',
    hint: 'An investigation changes nothing, so it never needs a spec.',
    options: YES_NO,
  },
  epic: {
    text: 'Will it take more than one session, or several deliverables that each deserve a spec of their own?',
    options: YES_NO,
  },
  contract: {
    text: 'Does it change a contract: a public API, schema, file format, CLI flag or event?',
    options: YES_NO,
  },
  data: { text: 'Does it change stored data?', options: YES_NO },
  security: {
    text: 'Does it touch anything security-related?',
    hint: 'Authentication, permissions, secrets, input from outside, a new external service integration, CORS, rate limiting or throttling, adding a dependency, or how personal data is collected, handled or shared. Upgrading an existing dependency does not count on its own.',
    options: YES_NO,
  },
  contradiction: {
    text: 'Does it ask for behaviour other than what an approved or implemented spec states as intended?',
    hint: 'That is a spec contradiction. A bug where the code differs from what a spec states is not one: fixing it makes the spec true again.',
    options: YES_NO,
  },
};

const NEXT = { fast: '/aw-build, or /aw-implement', standard: '/aw-spec', epic: '/aw-wayfinder' };

const NOTE = 'A recommendation only: /aw-intake makes the actual call, from the task and the code, and you may choose another route.';

function question(id) {
  return { question: { id, ...QUESTIONS[id] } };
}

function result(answers, route, routeReason, { type = answers.type, typeReason } = {}) {
  const reasons = [typeReason ?? `Type: ${type}, because it is ${TYPES[type].about}.`, `Route: ${route}, because ${routeReason}.`];
  let next = NEXT[route];
  if (answers.type === 'investigation' && route === 'fast') next = 'none, unless the answer shows work to do: then /aw-intake again, with that work as the task';
  // aw-intake step 4: an investigation on the epic route leaves its pre-step
  // to /aw-wayfinder, which charts the questions.
  const preStep = answers.type === 'investigation' && route === 'epic' ? 'None at intake: it is left to /aw-wayfinder, which charts the questions.' : TYPES[type].preStep;
  const notes = [NOTE];
  if (answers.type === 'bug' && route === 'fast') notes.push('If the pre-step cannot reproduce the bug, /aw-intake moves it to the standard route or longer.');
  return { result: { route, type, reasons, preStep, next, note: notes.join(' ') } };
}

// The longer route wins when in doubt, so "Not sure" counts as the answer that
// keeps a task off the shorter route.
const longer = (answer) => answer === 'yes' || answer === 'unsure';

export function wizardStep(answers) {
  if (!answers.type) return question('type');

  if (answers.type === 'investigation') {
    if (!answers.sessions) return question('sessions');
    return longer(answers.sessions)
      ? result(answers, 'epic', 'answering it spans several sessions, so /aw-wayfinder charts the questions')
      : result(answers, 'fast', 'an investigation changes nothing and this one fits in one session');
  }

  if (!answers.epic) return question('epic');
  if (longer(answers.epic)) return result(answers, 'epic', 'it spans several sessions or deliverables, each of which deserves its own spec');

  for (const [id, reason] of [
    ['contract', 'it changes a contract'],
    ['data', 'it changes stored data'],
    ['security', 'it touches something security-related'],
  ]) {
    if (!answers[id]) return question(id);
    if (longer(answers[id])) return result(answers, 'standard', reason);
  }

  if (!answers.contradiction) return question('contradiction');
  if (longer(answers.contradiction)) {
    const reported = answers.type === 'bug' ? ' (reported as a bug)' : '';
    return result(answers, 'standard', 'the change contradicts a spec, which changes through /aw-spec', {
      type: 'feature',
      typeReason: `Type: feature${reported}, because a spec states the current behaviour as intended, and changing it changes intended behaviour.`,
    });
  }

  return result(answers, 'fast', 'it fits in one session, changes no contract, stored data or security, and contradicts no spec');
}
