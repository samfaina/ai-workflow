// aw-setup asks each housekeeping offer that applies as a question of its own,
// after interview section D, never folded into a section's question or into
// another offer (#230). The offer to remove Pocock's subsections from the
// pointer block is one of them, asked before Confirm, and step 4 asks nothing
// (#231). The behaviour is the skill's text, so these tests hold that text: the
// Interview and Write rules in SKILL.md and each offer's options in
// HOUSEKEEPING.md.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { skillSection } from './fixtures.mjs';

const interview = skillSection('aw-setup', '### 2. Interview', '### 3. Confirm');

describe('aw-setup, step 2. Interview', () => {
  test('asks each applicable housekeeping offer after D, as a question of its own', () => {
    assert.match(
      interview,
      /After D, ask each housekeeping offer in \[`HOUSEKEEPING\.md`\]\(HOUSEKEEPING\.md\) that applies on this run as a question of its own, with its own options: the `permissions\.deny` entries, then Matt Pocock's plugin, then the removal of the subsections the kit does not own from the pointer block\./,
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
    const done = interview.indexOf('Done when every section and every offer asked has an answer');
    assert.ok(d !== -1 && rule > d, 'The housekeeping rule does not come after section D');
    assert.ok(done > rule, 'The housekeeping rule does not come before the Done when line');
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

  test('looks for the entries in both settings files, so an offer already accepted is not asked again', () => {
    assert.match(deny, /\*\*Explore:\*\* read `permissions\.deny` in `\.claude\/settings\.json` and `\.claude\/settings\.local\.json`; an entry in either file is present\./);
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
      /\*\*Offer\*\*, when enabled, to turn it off for this repo only, as a question of its own with three options: set `"mattpocock-skills@<marketplace>": false` under `enabledPlugins` in `\.claude\/settings\.json`, set it in `\.claude\/settings\.local\.json`, or leave it on\. Recommend `\.claude\/settings\.json`\./,
    );
  });

  test('says in the report that both kits\' skills stay on when it is left on', () => {
    assert.match(pocock, /When the user leaves it on, mention in the report that both kits' skills stay on\./);
  });

  test('is not asked when the plugin is already off', () => {
    assert.match(pocock, /When the plugin is already off in this repo, the plugin offer is not asked\./);
  });
});

describe("aw-setup housekeeping, the offer to remove Pocock's subsections", () => {
  const pocock = skillSection('aw-setup/HOUSEKEEPING.md', "## Matt Pocock's plugin (Claude Code)");

  test('is a question of its own with two options, right after the plugin offer', () => {
    assert.match(
      pocock,
      /\*\*Offer\*\*, right after the plugin offer and as a question of its own, to remove the subsections of the `## Agent skills` block that the kit does not own, such as `### Issue tracker` or `### Triage labels`, with two options: remove them, or keep them\. Name each one in the question\./,
    );
  });

  test('is asked whenever the plugin is off once the plugin offer is settled, turned off now or already off', () => {
    assert.match(
      pocock,
      /Ask it whenever the plugin is off in this repo once the plugin offer is settled, whether the user turned it off on this run or it was already off, and the block holds such subsections\./,
    );
  });

  test('is not asked when the plugin stays on or the block holds no such subsection', () => {
    assert.match(
      pocock,
      /When the plugin stays on, or the block holds no such subsection, the removal offer is not asked\./,
    );
  });

  test('says what step 4 writes when the user accepts, and nothing else of the file changes', () => {
    assert.match(
      pocock,
      /\*\*Write, in step 4:\*\* when the user accepted, delete each of those subsections, heading and body, from the block, and leave the kit's four and the rest of the file as they are\./,
    );
  });

  test('is asked again on the next run when the user keeps them', () => {
    assert.match(pocock, /When the user keeps them, the removal offer is asked again on the next run\./);
  });
});

describe('aw-setup, step 4. Write, the pointer block', () => {
  const write = skillSection('aw-setup', '### 4. Write', '### 5. Report');

  test('removes his subsections only when the offer was accepted, and asks nothing', () => {
    assert.match(
      write,
      /Remove them only when the user accepted the offer to remove them in step 2, as \[`HOUSEKEEPING\.md`\]\(HOUSEKEEPING\.md\) describes; this step asks nothing\./,
    );
  });

  test('no longer offers the removal during Write', () => {
    assert.doesNotMatch(write, /offer to remove his subsections/);
  });
});
