// The programs a shell line calls, read the same way by the permission host,
// which filters a case session's gh and git commands, and by the UAT driver,
// which tells whether a case runs gh. Best effort, for bash and PowerShell
// alike: a backslash outside quotes stays as it is, since it separates a
// Windows path.

// The commands of a line, each as its words with quotes removed: the line is
// split at ; & | ( ) { } ` and line ends outside quotes.
function commandsOf(line) {
  const commands = [[]];
  let word = null;
  let quote = null;
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
    } else if (/[;&|(){}`\n]/.test(ch)) {
      endWord();
      if (commands.at(-1).length > 0) commands.push([]);
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
