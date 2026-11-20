---
name: ask
description: PROTOTYPE for #165. Asks one AskUserQuestion call in the shape a variant names, then reports what the tool returned.
disable-model-invocation: true
---

# Probe: ask

The argument is a variant name: `single`, `multi` or `other`. Call `AskUserQuestion` exactly once, with the input listed for that variant, copied verbatim. Make no other tool call.

After the tool returns, reply with only a fenced code block holding the tool result text, verbatim, followed by one line per question: `<header>: <the answer you understood>`. If the call was refused or errored, reply with the error text verbatim instead. Don't retry and don't ask anything else.

## single

```json
{"questions": [
  {"question": "Which tracker does the probe use?", "header": "Tracker", "multiSelect": false,
   "options": [{"label": "GitHub", "description": "Issues on github.com"}, {"label": "GitLab", "description": "Issues on a GitLab host"}]}
]}
```

## multi

```json
{"questions": [
  {"question": "Which tracker does the probe use?", "header": "Tracker", "multiSelect": false,
   "options": [{"label": "GitHub", "description": "Issues on github.com"}, {"label": "GitLab", "description": "Issues on a GitLab host"}]},
  {"question": "Which branch prefix does the probe use?", "header": "Prefix", "multiSelect": false,
   "options": [{"label": "feat", "description": "A feature branch"}, {"label": "fix", "description": "A bug-fix branch"}]},
  {"question": "Which labels does the probe apply?", "header": "Labels", "multiSelect": true,
   "options": [{"label": "bug", "description": "Something is broken"}, {"label": "docs", "description": "Documentation"}, {"label": "chore", "description": "Upkeep"}]}
]}
```

## other

```json
{"questions": [
  {"question": "Which GitLab host does the probe use?", "header": "Host", "multiSelect": false,
   "options": [{"label": "gitlab.com", "description": "The public GitLab"}, {"label": "Self-hosted", "description": "Your own GitLab instance"}]}
]}
```
