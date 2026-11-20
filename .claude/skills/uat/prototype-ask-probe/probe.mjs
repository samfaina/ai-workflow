// PROTOTYPE for #165, not part of the kit. Runs the real `claude -p` once per
// scenario against the probe plugin's `/probe:ask` skill, with a PreToolUse
// hook on AskUserQuestion that the scenario configures, and the UAT driver's
// own permission host. Writes each scenario's stream and logs to --out and a
// summary.json that keeps only what the #165 comment needs.
//
//   node probe.mjs --out <dir> [--only a,b] [--model haiku]
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fwd = (p) => p.replaceAll('\\', '/');
const pluginDir = fwd(join(here, 'plugin'));
const hookScript = fwd(join(here, 'hook.mjs'));
const hostScript = fwd(join(here, '..', 'scripts', 'permission-host.mjs'));
const HOST_TOOL = 'mcp__uat__approve';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const outRoot = opt('out');
if (!outRoot) throw new Error('usage: node probe.mjs --out <dir> [--only a,b] [--model haiku]');
const only = opt('only')?.split(',');
const model = opt('model') ?? 'haiku';

const Q1 = 'Which tracker does the probe use?';
const Q2 = 'Which branch prefix does the probe use?';
const Q3 = 'Which labels does the probe apply?';
const QH = 'Which GitLab host does the probe use?';
const multi = (labels) => ({ [Q1]: 'GitLab', [Q2]: 'fix', [Q3]: labels });

// variant: the skill's argument. plan: what the hook does. hook: handler
// fields. killOnInit: stop at the init event, before the model is asked.
const SCENARIOS = [
  { name: 'live-init', variant: 'single', plan: { mode: 'answer', answers: { [Q1]: 'GitLab' } }, killOnInit: true },
  { name: 'live-no-host', variant: 'single', plan: { mode: 'answer', answers: { [Q1]: 'GitLab' } }, noHost: true, killOnInit: true },
  { name: 'live-bare', variant: 'single', plan: { mode: 'answer', answers: { [Q1]: 'GitLab' } }, extra: ['--bare'], killOnInit: true },
  { name: 'single', variant: 'single', plan: { mode: 'answer', answers: { [Q1]: 'GitLab' } } },
  { name: 'multi-comma-space', variant: 'multi', plan: { mode: 'answer', answers: multi('bug, docs') } },
  { name: 'multi-comma', variant: 'multi', plan: { mode: 'answer', answers: multi('bug,docs') } },
  { name: 'multi-array', variant: 'multi', plan: { mode: 'answer', answers: multi(['bug', 'docs']) } },
  { name: 'multi-partial', variant: 'multi', plan: { mode: 'answer', answers: { [Q1]: 'GitLab' } } },
  { name: 'other-text', variant: 'other', plan: { mode: 'answer', answers: { [QH]: 'gitlab.internal.example' } } },
  { name: 'other-annotation', variant: 'other', plan: { mode: 'answer', answers: { [QH]: 'Self-hosted' }, annotations: { [QH]: { notes: 'gitlab.internal.example' } } } },
  { name: 'fail-exit1', variant: 'single', plan: { mode: 'exit1' } },
  { name: 'fail-exit1-block', variant: 'single', plan: { mode: 'exit1' }, hook: { onFailure: 'block' } },
  { name: 'fail-timeout', variant: 'single', plan: { mode: 'sleep', sleepSeconds: 20, answers: { [Q1]: 'GitLab' } }, hook: { timeout: 5 } },
  { name: 'fail-timeout-block', variant: 'single', plan: { mode: 'sleep', sleepSeconds: 20, answers: { [Q1]: 'GitLab' } }, hook: { timeout: 5, onFailure: 'block' } },
];

const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const readLines = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [{ unparsed: l }];
        }
      })
    : [];

function runScenario(s) {
  const dir = join(outRoot, s.name);
  const workdir = join(dir, 'workdir');
  mkdirSync(workdir, { recursive: true });
  const planFile = join(dir, 'plan.json');
  const hookLog = join(dir, 'hook.log');
  const hostLog = join(dir, 'host.log');
  const streamFile = join(dir, 'stream.jsonl');
  writeJson(planFile, s.plan);
  const handler = { type: 'command', command: `node "${hookScript}"`, timeout: 30, ...s.hook };
  const settings = {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: `node "${hookScript}"`, timeout: 30 }] }],
      PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [handler] }],
    },
  };
  const settingsFile = join(dir, 'settings.json');
  writeJson(settingsFile, settings);
  const mcpFile = join(dir, 'mcp.json');
  writeJson(mcpFile, { mcpServers: { uat: { command: process.execPath, args: [hostScript, '--workdir', fwd(workdir), '--log', fwd(hostLog)] } } });

  const argv = [
    '-p',
    '--model', model,
    '--plugin-dir', pluginDir,
    '--settings', fwd(settingsFile),
    ...(s.noHost ? [] : ['--mcp-config', fwd(mcpFile), '--permission-prompts', 'host', '--permission-prompt-tool', HOST_TOOL]),
    '--output-format', 'stream-json',
    '--verbose',
    '--include-hook-events',
    ...(s.extra ?? []),
  ];
  const env = { ...process.env, PROBE_PLAN: fwd(planFile), PROBE_LOG: fwd(hookLog) };
  delete env.ANTHROPIC_API_KEY;
  writeJson(join(dir, 'argv.json'), argv);

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('claude', argv, { cwd: workdir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    let killed = false;
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      killed = 'timeout';
      child.kill();
    }, 240_000);
    createInterface({ input: child.stdout }).on('line', (line) => {
      appendFileSync(streamFile, `${line}\n`);
      if (!s.killOnInit || killed) return;
      try {
        const e = JSON.parse(line);
        if (e.type === 'system' && e.subtype === 'init') {
          killed = 'init';
          child.kill();
        }
      } catch {}
    });
    child.stdin.end(`/probe:ask ${s.variant}`);
    child.on('close', (code) => {
      clearTimeout(timer);
      writeFileSync(join(dir, 'stderr.txt'), stderr);
      resolve(summarize(s, { dir, code, killed, stderr, seconds: Math.round((Date.now() - started) / 1000), streamFile, hookLog, hostLog }));
    });
  });
}

function summarize(s, { code, killed, stderr, seconds, streamFile, hookLog, hostLog }) {
  const events = readLines(streamFile);
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const contents = (e) => (Array.isArray(e.message?.content) ? e.message.content : []);
  const asks = events.flatMap((e) => (e.type === 'assistant' ? contents(e) : [])).filter((c) => c.type === 'tool_use' && c.name === 'AskUserQuestion');
  const askIds = new Set(asks.map((a) => a.id));
  const toolResults = events.flatMap((e) =>
    e.type === 'user'
      ? contents(e)
          .filter((c) => c.type === 'tool_result' && askIds.has(c.tool_use_id))
          .map((c) => ({ is_error: c.is_error ?? false, content: c.content, tool_use_result: e.tool_use_result }))
      : [],
  );
  const end = events.findLast((e) => e.type === 'result');
  return {
    scenario: s.name,
    variant: s.variant,
    plan: s.plan,
    hookFields: s.hook ?? {},
    host: !s.noHost,
    extra: s.extra ?? [],
    exit: code,
    killed,
    seconds,
    init: init && {
      claude_code_version: init.claude_code_version,
      keys: Object.keys(init),
      askUserQuestionOffered: Array.isArray(init.tools) ? init.tools.includes('AskUserQuestion') : null,
      tools: init.tools,
      mcp_servers: init.mcp_servers,
      mcp_server_errors: init.mcp_server_errors,
      plugins: init.plugins?.map((p) => p.name),
      plugin_errors: init.plugin_errors,
      permissionMode: init.permissionMode,
      model: init.model,
    },
    preInitEvents: events.slice(0, Math.max(0, events.indexOf(init))).map((e) => ({ type: e.type, subtype: e.subtype, hook_event: e.hook_event, hook_name: e.hook_name })),
    hookEvents: events
      .filter((e) => e.type === 'system' && String(e.subtype).startsWith('hook'))
      .map(({ session_id, uuid, ...rest }) => rest),
    systemOther: events
      .filter((e) => e.type === 'system' && !['init'].includes(e.subtype) && !String(e.subtype).startsWith('hook'))
      .map(({ session_id, uuid, ...rest }) => rest),
    asks: asks.map((a) => a.input),
    toolResults,
    result: end && { subtype: end.subtype, is_error: end.is_error, num_turns: end.num_turns, result: end.result, permission_denials: end.permission_denials, stop_reason: end.stop_reason },
    hookLog: readLines(hookLog),
    hostLog: readLines(hostLog),
    stderrTail: stderr.trim().slice(-800),
  };
}

mkdirSync(outRoot, { recursive: true });
const summary = [];
for (const s of SCENARIOS.filter((x) => !only || only.includes(x.name))) {
  process.stderr.write(`probe: ${s.name} ...\n`);
  const r = await runScenario(s);
  summary.push(r);
  process.stderr.write(`probe: ${s.name} exit=${r.exit} killed=${r.killed} ${r.seconds}s asks=${r.asks.length} results=${r.toolResults.length}\n`);
  writeJson(join(outRoot, 'summary.json'), summary);
}
