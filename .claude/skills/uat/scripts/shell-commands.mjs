// The programs a shell line calls, read the same way by the permission host,
// which filters a case session's gh and git commands, and by the UAT driver,
// which tells whether a case runs gh. Best effort, for bash and PowerShell
// alike: a backslash outside quotes stays as it is, since it separates a
// Windows path.

// A heredoc's delimiter word after <<, as in 'EOF', "EOF", \EOF or E"OF".
const HEREDOC_WORD = /^(?:'[^'\n]*'|"[^"\n]*"|[^\s;&|()<>`'"])+/;

// Where the body of each heredoc in `pending` ends, starting at `from`: past
// the line that is its delimiter. Only a quoted delimiter's body is skipped,
// since that body is text; an unquoted one runs what $(…) and backticks hold,
// so from the first unquoted one on, the lines are read as commands.
function pastHeredocs(line, from, pending) {
  let at = from;
  for (const heredoc of pending) {
    if (!heredoc.quoted) return at;
    while (at < line.length) {
      const end = line.indexOf('\n', at);
      const text = line.slice(at, end === -1 ? line.length : end).replace(/\r$/, '');
      at = end === -1 ? line.length : end + 1;
      if ((heredoc.stripTabs ? text.replace(/^\t+/, '') : text) === heredoc.delimiter) break;
    }
  }
  return at;
}

// The commands of a line, each as its words with quotes removed: the line is
// split at ; & | ( ) { } ` and line ends outside quotes, and the body of a
// heredoc whose delimiter is quoted is left out.
function commandsOf(line) {
  const commands = [[]];
  let word = null;
  let quote = null;
  let pending = [];
  const endWord = () => {
    if (word !== null) commands.at(-1).push(word);
    word = null;
  };
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && line[i + 1] === '"') word += line[(i += 1)];
      else word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      word ??= '';
    } else if (ch === '<' && line[i + 1] === '<' && line[i + 2] !== '<' && line[i - 1] !== '<') {
      endWord();
      let at = i + 2;
      const stripTabs = line[at] === '-';
      if (stripTabs) at += 1;
      while (line[at] === ' ' || line[at] === '\t') at += 1;
      const found = line.slice(at).match(HEREDOC_WORD)?.[0];
      if (found) {
        pending.push({ delimiter: found.replace(/['"\\]/g, ''), quoted: /['"\\]/.test(found), stripTabs });
        i = at + found.length - 1;
      } else {
        i = at - 1;
      }
    } else if (/[;&|(){}`\n]/.test(ch)) {
      endWord();
      if (commands.at(-1).length > 0) commands.push([]);
      if (ch === '\n' && pending.length > 0) {
        i = pastHeredocs(line, i + 1, pending) - 1;
        pending = [];
      }
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word = (word ?? '') + ch;
    }
  }
  endWord();
  return commands.filter((words) => words.length > 0);
}

const WRAPPERS = new Set(['command', 'env', 'exec']);

// Each call of the line: the program's name in lower case without a path or
// a Windows extension, its arguments, and the variables assigned before it.
export function callsOf(line) {
  return commandsOf(line).map((command) => {
    const assigned = {};
    let at = 0;
    for (; at < command.length; at += 1) {
      const assignment = command[at].match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (assignment) assigned[assignment[1]] = assignment[2];
      else if (!WRAPPERS.has(command[at])) break;
    }
    const program = (command[at] ?? '').split(/[/\\]/).pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
    return { program, args: command.slice(at + 1), assigned };
  });
}
