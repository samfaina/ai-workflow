// shell-commands.mjs: the programs a shell line calls, as the permission host
// and the UAT driver read them.

import assert from 'node:assert/strict';
import test from 'node:test';

import { callsOf } from '../.claude/skills/uat/scripts/shell-commands.mjs';

const programs = (line) => callsOf(line).map((call) => [call.program, ...call.args]);

test('the body of a heredoc with a quoted delimiter is text, not commands', () => {
  for (const delimiter of ["'EOF'", '"EOF"', '\\EOF', 'E"OF"']) {
    const line = `cat > .aw/drafts/open-review.md <<${delimiter}\ngh pr create --title x\nEOF\ngit status`;
    assert.deepEqual(programs(line), [['cat'], ['git', 'status']], delimiter);
  }
});

test('a quoted heredoc ends at its delimiter, tabs stripped with <<-, and what follows is read again', () => {
  const line = "mkdir -p d && cat > d/a.md <<-'END'\n\tgh repo delete --yes\n\tEND\r\ngh issue create -R someone/project";
  assert.deepEqual(programs(line), [['mkdir', '-p', 'd'], ['cat'], ['gh', 'issue', 'create', '-R', 'someone/project']]);
});

test('two quoted heredocs on one line skip both bodies in order', () => {
  const line = "cat > a <<'A'; cat > b <<'B'\ngh pr create\nA\ngh pr merge\nB\nls";
  assert.deepEqual(programs(line), [['cat'], ['cat'], ['ls']]);
});

test('the body of a heredoc with an unquoted delimiter is still read, since $(…) in it runs', () => {
  const line = 'cat > a <<EOF\n$(gh pr create)\nEOF';
  assert.ok(programs(line).some(([program, ...args]) => program === 'gh' && args.join(' ') === 'pr create'));
});

test('a here-string and a << inside quotes are no heredoc', () => {
  assert.deepEqual(programs('cat <<< "x"\ngh pr create'), [['cat'], ['gh', 'pr', 'create']]);
  assert.deepEqual(programs("echo '<<EOF'\ngh pr create"), [['echo', '<<EOF'], ['gh', 'pr', 'create']]);
});

test('a redirection and its target are no arguments, and its & splits no call', () => {
  for (const line of ['gh --version 2>&1', 'gh --version 2>/dev/null', 'gh --version >/dev/null 2>&1', 'gh --version &>/dev/null', 'gh --version &>> log', 'gh --version > out.txt 2> err.txt', 'gh --version 2>> "a log"', 'gh --version >& out', 'gh --version 1>&2', 'gh --version <in', 'gh --version >| out', 'gh --version *>$null', 'gh --version 2>$null']) {
    assert.deepEqual(programs(line), [['gh', '--version']], line);
  }
  assert.deepEqual(programs('glab --version 2>&1 | head -1; gh --version 2>&1 | head -1'), [['glab', '--version'], ['head', '-1'], ['gh', '--version'], ['head', '-1']]);
  assert.deepEqual(programs('gh pr list &>/dev/null && gh pr view 2'), [['gh', 'pr', 'list'], ['gh', 'pr', 'view', '2']]);
});

test('a redirection ends the word before it, and only a word of digits before it is its stream', () => {
  assert.deepEqual(programs('echo a2>x b'), [['echo', 'a2', 'b']]);
  assert.deepEqual(programs('echo 2 >x'), [['echo', '2']]);
  assert.deepEqual(programs('gh issue create -R other/repo -t x -b y 2>&1'), [['gh', 'issue', 'create', '-R', 'other/repo', '-t', 'x', '-b', 'y']]);
});

test('a > or & inside quotes is text, and a call in a process substitution is still read', () => {
  assert.deepEqual(programs('gh issue create --title "a > b & c" 2>&1'), [['gh', 'issue', 'create', '--title', 'a > b & c']]);
  assert.deepEqual(programs('diff <(gh pr diff 1) b'), [['diff'], ['gh', 'pr', 'diff', '1'], ['b']]);
});
