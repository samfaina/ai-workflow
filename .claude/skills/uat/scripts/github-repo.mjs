// The GitHub repo a git URL names, as `owner/name` in lower case, or null when
// the URL is not on github.com: https, ssh and scp-like forms alike.
export function githubRepo(url) {
  const match = String(url).match(/^(?:(?:https?|ssh|git):\/\/)?(?:[^@/]+@)?github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}
