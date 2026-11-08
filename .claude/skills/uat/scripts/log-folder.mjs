import { homedir } from 'node:os';
import { join } from 'node:path';

// Where Claude Code keeps the session logs of a working directory.
export function logFolder(workdir) {
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return join(config, 'projects', workdir.replace(/[^A-Za-z0-9]/g, '-'));
}
