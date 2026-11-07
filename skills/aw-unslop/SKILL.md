---
name: aw-unslop
description: "Cut AI tells from any writing: the file or text you name, or else the last document generated in this conversation."
disable-model-invocation: true
---

# Unslop

Edit text to remove AI patterns. Scan for the patterns below, then rewrite. Preserve meaning and match the intended tone.

## In the Kit

This skill is phase-free and optional: no phase requires it, nor does any route, and no ship or merge condition depends on it having run. It creates no gate. It is user-invoked: rewriting prose changes what a text says, so a person decides when it runs.

## Steps

1. Find the target under **Target**. Done when you know the file or text, or have asked for it.
2. Check the target against **What it refuses** and **On a spec**. When either tells you to stop, say why and change nothing. Done when you have stopped, or know the target may be rewritten.
3. Apply **Patterns to detect and fix** to the prose under **What it rewrites**, keeping **What stays exact** as it is. Done when every rule has been applied to all of that prose.
4. On a draft spec, run the check under **On a spec**. Done when it reports no finding your edit caused, or you have said it ran by reading only.

## Target

The file or text the user names. With no argument, the last document generated in this conversation. When the conversation has generated none, ask for the target.

## What it rewrites

Only prose a person reads. Leave these unchanged: a term defined in the repo's `GLOSSARY.md`, even when a rule would flag it (`harness` under rule 26, the en dash in `expand–contract` under rule 13), a code identifier, a command, a path, a quotation or command output.

In a text not written in English, apply the rules that carry over; the word lists are English.

## What stays exact

A skill, script or test depends on these, so keep their text as it is:

| Document | What stays exact |
| --- | --- |
| Spec | Frontmatter, headings, `AC-n` numbering, the Traceability table, the slice plan and its done markers, `BLOCKS:` items |
| Review request body | Section headings, the bold labels in Evidence, Merge Danger and the Rollback plan, the closing line. It is the file under `.aw/review-requests/` |
| Commit message | The conventional-commit title, `Done when:` and `Test exception:` lines |
| Map, map update, decision ticket | Section headings and the shape of their lines |
| Adapter | The Operations and Levels tables, `**Default access:**` |
| `GLOSSARY.md` | Bold terms and `_Avoid_:` lines |
| Skill | Frontmatter, and the `## Never allowed` and `## Defaults when unconfigured` sections, which `validate-kit` compares with `docs/configuration.md` |

## What it refuses

- A copy, since `sync-upstreams check` fails on any hand edit. A copy is a skill the repo's `upstreams.json` lists.
- A review report, verify result or retro report, since each records what happened and `aw-ship` reads the review report's `Proven defects:` line for its merge conditions.
- A draft under `.aw/drafts/`, since it holds an exact command or text for a person to apply, except the review request body inside a drafted `open-review`. There, rewrite the body and leave the command as it is.

## On a review request body

`aw-ship` at `open-review: write` opens the review request right after writing the body, so a person who wants to run this skill first keeps `open-review` at `draft`.

## On a spec

When its `status` is not `draft`, stop and name the change process, **Changing a spec** in `/aw-spec`, instead of rewriting.

After rewriting a draft, call the Skill tool with "aw-check-spec", run it on the repo, and fix what your edit caused. Report any other finding and leave it as it is. When it reports `Result: not script-verified`, Node is missing: report that, not a pass.

## Patterns to detect and fix

Rule numbers are the upstream's stable ids. A removed rule leaves a gap.

### Content

3. **Superficial -ing phrases.** "highlighting...", "ensuring...", "reflecting...", "showcasing...", "fostering...". Delete or expand with real sources.
5. **Vague attributions.** "Experts believe", "Industry reports suggest", "Some critics argue". Name the source or delete.

### Language

7. **AI vocabulary.** Additionally, crucial, delve, enduring, enhance, fostering, garner, interplay, intricate, landscape (abstract), pivotal, showcase, tapestry (abstract), testament, underscore, vibrant. Replace with plain words.
8. **Fancy ways to say "is".** "serves as", "stands as", "boasts", "features". Say "is" or "has".
9. **"Not just X, but Y."** State the point directly instead.
10. **Rule of three.** Don't force ideas into groups of three. Use the natural number.
11. **Synonym cycling.** Protagonist, main character, central figure, hero all in one paragraph. Pick one, repeat it.
12. **False ranges.** "from X to Y" where X and Y aren't on a meaningful scale. List topics directly.

### Style

13. **Em dash overuse.** Avoid em dashes entirely. Use periods or commas only (no parentheses, no en dashes, no hyphen-as-dash substitutes). If a thought needs separation, end the sentence or use a comma.
14. **Colon overuse.** Colons are fine before a list or example, not as mid-sentence connectors. "If you're coming from traditional automation: instead of registering event handlers, you describe conditions" adds nothing with the colon. Rewrite to let the point stand on its own without comparison framing. "Describing when the scheduler should fire works best as plain English." Same meaning, no crutch punctuation.
15. **Boldface overuse.** Don't bold every proper noun or acronym.
16. **Inline-header lists.** The tell is a bold label and colon that restates the line: "**Performance:** Performance improved...". Convert those to prose. A bold lead-in that ends in a period, names the item, and is followed by genuinely new detail ("**Schema in TypeScript.** Tables live in one file.") is fine, not a tell.
17. **Title case headings.** Use sentence case.
18. **Decorative emojis.** Remove from headings and bullets.
19. **Curly quotes.** Use straight quotes.

### Communication artifacts

20. **Chatbot phrases.** "I hope this helps!", "Let me know if...", "Of course!", "Certainly!", "Found the smoking gun!" Remove.
22. **Sycophantic tone.** "Great question! You're absolutely right!" Respond directly.

### Filler

23. **Filler phrases.** "In order to" becomes "To". "Due to the fact that" becomes "Because". Delete "It is important to note that".
24. **Excessive hedging.** "could potentially possibly be argued that it might" becomes "may".
25. **Generic conclusions.** "The future looks bright." State specific plans or facts.

### Jargon

26. **Abstract metaphor nouns.** Substrate (base), wedge, wedge in (add), vector (way, method), locus, vantage, nexus, primitive as a noun, harness as a metaphor, surface as in "API surface", bedrock, scaffolding as a metaphor, modality, paradigm, gold-plating (more than the job needs), ratchet as a metaphor (the mechanism's real name, or a limit that only tightens), evacuate for moving code (move out), endgame (the last phase), north star, flywheel. These read as technical but usually have a plainer concrete word. Pick the concrete word.

### Plain speech

27. **Say what it does, not how it feels.** "the database stays close at hand", "SQL you can read", "types that follow your schema" name a feeling. The fix names the mechanism or a number: "`.toSQL()` returns the exact string sent to the database", "a column rename fails the build". Ask what the sentence tells the reader to do or know, then write that. If you can't restate it as a concrete instruction, fact, or number, cut it. One more check: if the sentence could appear unchanged in another project's docs, it says nothing about this one. Cut it.
28. **Shorten or split dense sentences.** If the reader has to backtrack to parse a sentence, break it in two or drop clauses. One idea per sentence.
29. **Active voice.** Prefer it. Catch "is/are/was/were + past participle" and name the actor: "queries are validated" becomes "the compiler validates queries", "the file is parsed by the loader" becomes "the loader parses the file". Passive is fine only when the actor is unknown or genuinely doesn't matter.
30. **Cut adverbs, or use a stronger verb.** "runs quickly" becomes "is fast" or the number, and "significantly improves" becomes the measured delta. An adverb propping up a weak verb means the verb is wrong.
31. **Prefer the plain word.** "utilize" and "leverage" become "use", "facilitate" becomes "help", "numerous" becomes "many", "in the event that" becomes "if". The fancier synonym is rarely clearer.
32. **Mannered prose.** Metaphor or flourish where a literal phrase exists: aphorisms ("wire it or delete it"), rhetorical fragments for effect, personified code ("the plan holds it"), figurative verbs ("rides along", "stands on"), stock framing phrases. "A dial worth turning" becomes "a parameter worth varying". Say what you mean. Rule 26 covers the metaphor nouns.
33. **Over-compression.** Dropped articles, verbless fragments, symbol-speak, and abbreviations that make the reader decode instead of read. "Parser rejects bad date → exit 2, no write" becomes "The parser rejects a bad date, exits with code 2, and writes nothing." Write whole sentences with their articles and verbs, and spell out arrows and abbreviations.

## Credits

Adapted from Lauren Tan's `unslop` in pstack (MIT), as listed in the kit's `NOTICE.md`.
