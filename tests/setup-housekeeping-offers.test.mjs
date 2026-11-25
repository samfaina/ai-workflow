// aw-setup asks each housekeeping offer that applies as a question of its own,
// after interview section D, never folded into a section's question or into
// another offer (#230). The behaviour is the skill's text, so these tests hold
// that text: the Interview rule in SKILL.md and each offer's three options in
// HOUSEKEEPING.md.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { skillSection } from './fixtures.mjs';

const interview = skillSection('aw-setup', '### 2. Interview', '### 3. Confirm');

describe('aw-setup, step 2. Interview', () => {
  test('asks each applicable housekeeping offer after D, as a question of its own', () => {
    assert.match(
      interview,
      /After D, ask each housekeeping offer in \[`HOUSEKEEPING\.md`\]\(HOUSEKEEPING\.md\) that applies on this run as a question of its own, with its own options: the `permissions\.deny` entries, then Matt Pocock's plugin\./,
    );
  });

  test('never folds an offer into a section\'s question or into another offer', () => {
    assert.match(interview, /Never fold an offer into a section's question or into another offer\./);
  });

  test('does not ask an offer that does not apply', () => {
    assert.match(interview, /An offer that does not apply on this run is not asked\./);
  });

  test('comes after section D and before the Done when line', () => {
    const d = interview.indexOf('**D. Domain docs.**');
    const rule = interview.indexOf('After D, ask each housekeeping offer');
    const done = interview.indexOf('Done when every section has an answer');
    assert.ok(d !== -1 && rule > d, 'The housekeeping rule does not come after section D');
    assert.ok(done === -1 || done > rule, 'The housekeeping rule comes after the Done when line');
  });

  test('is done only when every applicable offer has its answer too', () => {
    assert.match(interview, /Done when every section and every offer asked has an answer\./);
  });
});

describe('aw-setup housekeeping, the permissions.deny offer', () => {
  const deny = skillSection('aw-setup/HOUSEKEEPING.md', '## `permissions.deny` entries (Claude Code)', '## Node');

  test('is a question of its own with three options', () => {
    assert.match(
      deny,
      /\*\*Offer\*\* the entries below that are missing, as a question of its own with three options: add them to `\.claude\/settings\.json` \(shared with everyone on the repo\), add them to `\.claude\/settings\.local\.json` \(kept personal\), or don't add them\./,
    );
  });

  test('keeps the PowerShell copies in the same offer, not a question of their own', () => {
    assert.match(deny, /offer each entry a second time with `PowerShell\(` in place of `Bash\(`, in the same question\./);
  });

  test('is not asked when every entry is already present', () => {
    assert.match(deny, /When every entry is already present, the offer is not asked\./);
  });
});

describe('aw-setup housekeeping, the Pocock plugin offer', () => {
  const pocock = skillSection('aw-setup/HOUSEKEEPING.md', "## Matt Pocock's plugin (Claude Code)");

  test('is a question of its own with three options', () => {
    assert.match(
      pocock,
      /\*\*Offer\*\*, when enabled, to turn it off for this repo only, as a question of its own with three options: set `"mattpocock-skills@<marketplace>": false` under `enabledPlugins` in `\.claude\/settings\.json`, set it in `\.claude\/settings\.local\.json`, or leave it on\./,
    );
  });

  test('says in the report that both kits\' skills stay on when it is left on', () => {
    assert.match(pocock, /When the user leaves it on, mention in the report that both kits' skills stay on\./);
  });

  test('is not asked when the plugin is already off', () => {
    assert.match(pocock, /When the plugin is already off in this repo, the offer is not asked\./);
  });
});
