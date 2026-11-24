// On Windows a UAT run needs PowerShell 7.3 or later (`pwsh`): run.mjs init
// and run.mjs auto, starting a run or resuming one, refuse without it before
// the first step. The platform and the `pwsh` the check finds are faked, so
// these tests hold on any platform.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { Refused } from '../.claude/skills/uat/scripts/refused.mjs';
import { requirePwsh } from '../.claude/skills/uat/scripts/driver.mjs';
import { caseFile, makeRun, runScript, tempDir } from './uat-fixtures.mjs';

const INSTALL = 'winget install --id Microsoft.PowerShell --source winget';

// Refuses with the requirement, why it holds and the install command.
const refusesForPwsh = (message) => {
  assert.match(message, /PowerShell 7\.3 or later/);
  assert.match(message, /pwsh/);
  assert.match(message, /Windows PowerShell 5\.1/);
  assert.ok(message.includes(INSTALL), message);
};

test('on Windows, requirePwsh refuses when pwsh is missing or older than 7.3, and lets 7.3 or later through', () => {
  assert.throws(() => requirePwsh({ platform: 'win32', version: () => null }), (error) => {
    assert.ok(error instanceof Refused);
    refusesForPwsh(error.message);
    return true;
  });
  assert.throws(() => requirePwsh({ platform: 'win32', version: () => 'PowerShell 7.2.24' }), (error) => {
    assert.ok(error instanceof Refused);
    refusesForPwsh(error.message);
    assert.match(error.message, /7\.2\.24/);
    return true;
  });
  assert.throws(() => requirePwsh({ platform: 'win32', version: () => 'garbled' }), Refused);
  for (const version of ['PowerShell 7.3.0', 'PowerShell 7.4.6', 'PowerShell 7.5.0-preview.2', 'PowerShell 8.0.0']) {
    assert.doesNotThrow(() => requirePwsh({ platform: 'win32', version: () => version }), version);
  }
});

test('off Windows, requirePwsh checks nothing', () => {
  let asked = false;
  const version = () => {
    asked = true;
    return null;
  };
  for (const platform of ['linux', 'darwin']) assert.doesNotThrow(() => requirePwsh({ platform, version }), platform);
  assert.equal(asked, false);
});

// An environment in which run.mjs believes it runs on Windows and PATH finds
// no `pwsh`, with quota thresholds so that auto's own checks pass.
function windowsWithoutPwsh(t) {
  const dir = tempDir(t);
  const preload = join(dir, 'win32.cjs');
  writeFileSync(preload, "Object.defineProperty(process, 'platform', { value: 'win32' });\n");
  const bin = join(dir, 'empty-bin');
  mkdirSync(bin);
  const env = { ...process.env, UAT_MAX_FIVE_HOUR: '90', UAT_MAX_WEEKLY: '80' };
  for (const key of ['ANTHROPIC_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN', 'UAT_GH_TOKEN']) delete env[key];
  for (const key of Object.keys(env).filter((name) => name.toUpperCase() === 'PATH')) delete env[key];
  env.PATH = bin;
  return (...args) => {
    const result = spawnSync(process.execPath, ['--require', preload, runScript, ...args], { encoding: 'utf8', env });
    return { status: result.status, output: JSON.parse(result.stdout || 'null'), report: `${result.stdout}${result.stderr}` };
  };
}

test('on Windows without pwsh 7.3 or later, init refuses before it creates the run', (t) => {
  const run = makeRun(t, [caseFile('a')]);
  const runMjs = windowsWithoutPwsh(t);
  const runDir = join(run.root, 'second');

  const result = runMjs('init', '--run', runDir, '--source', run.source, '--cases-dir', run.casesDir);

  assert.equal(result.status, 1, result.report);
  assert.equal(result.output.status, 'refused');
  refusesForPwsh(result.output.message);
  assert.equal(existsSync(runDir), false);
});

test('on Windows without pwsh 7.3 or later, auto refuses to start a run, and to resume one, before the first step', (t) => {
  const run = makeRun(t, [caseFile('a')]);
  const runMjs = windowsWithoutPwsh(t);

  const startDir = join(run.root, 'second');
  const started = runMjs('auto', '--run', startDir, '--source', run.source, '--cases-dir', run.casesDir);
  assert.equal(started.status, 1, started.report);
  assert.equal(started.output.status, 'refused');
  refusesForPwsh(started.output.message);
  assert.equal(existsSync(startDir), false);

  const resumed = runMjs('auto', '--run', run.runDir);
  assert.equal(resumed.status, 1, resumed.report);
  assert.equal(resumed.output.status, 'refused');
  refusesForPwsh(resumed.output.message);
  assert.equal(existsSync(join(run.runDir, 'steps')), false);
});
