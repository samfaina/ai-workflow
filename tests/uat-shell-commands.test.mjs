// shell-commands.mjs: the programs a shell line calls, as the permission host
// and the UAT driver read them.

import assert from 'node:assert/strict';
import test from 'node:test';

import { callsOf } from '../.claude/skills/uat/scripts/shell-commands.mjs';

const programs = (line) => callsOf(line).map((call) => [call.program, ...call.args]);

test('the body of a heredoc with a quoted delimiter is text, not commands', () => {
  for (const delimiter of ["'EOF'", '"EOF"', '\\EOF', 'E"OF"']) {
    const line = `cat > .aw/drafts/open-review.md <<${delimiter}\ngh pr create --title x\nEOF\ngit status`;
    assert.deepEqual(programs(line), [['cat', '>', '.aw/drafts/open-review.md'], ['git', 'status']], delimiter);
  }
});

test('a quoted heredoc ends at its delimiter, tabs stripped with <<-, and what follows is read again', () => {
  const line = "mkdir -p d && cat > d/a.md <<-'END'\n\tgh repo delete --yes\n\tEND\r\ngh issue create -R someone/project";
  assert.deepEqual(programs(line), [['mkdir', '-p', 'd'], ['cat', '>', 'd/a.md'], ['gh', 'issue', 'create', '-R', 'someone/project']]);
});

test('two quoted heredocs on one line skip both bodies in order', () => {
  const line = "cat > a <<'A'; cat > b <<'B'\ngh pr create\nA\ngh pr merge\nB\nls";
  assert.deepEqual(programs(line), [['cat', '>', 'a'], ['cat', '>', 'b'], ['ls']]);
});

test('the body of a heredoc with an unquoted delimiter is still read, since $(…) in it runs', () => {
  const line = 'cat > a <<EOF\n$(gh pr create)\nEOF';
  assert.ok(programs(line).some(([program, ...args]) => program === 'gh' && args.join(' ') === 'pr create'));
});

test('a here-string and a << inside quotes are no heredoc', () => {
  assert.deepEqual(programs('cat <<< "x"\ngh pr create'), [['cat', '<<<', 'x'], ['gh', 'pr', 'create']]);
  assert.deepEqual(programs("echo '<<EOF'\ngh pr create"), [['echo', '<<EOF'], ['gh', 'pr', 'create']]);
});
