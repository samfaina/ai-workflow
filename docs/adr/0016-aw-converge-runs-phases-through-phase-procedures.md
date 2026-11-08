# `aw-converge` runs the phases through phase procedures

`aw-converge` repeats rounds on a work branch: a fix run, `aw-verify` when the fix calls for it, and `aw-review`, until the latest review report holds no introduced defect. A user-invoked skill cannot be called by another skill (ADR 0012), and copying its steps would give the phase a second owner (ADR 0010). So the whole body of `aw-build`, `aw-verify` and `aw-review` moves into three phase procedures, `aw-build-steps`, `aw-verify-steps` and `aw-review-steps`, which the model can call and the `/` menu does not show. The three phases stay user-invoked, each a thin door to its procedure, and remain the owners ADR 0010 names.

The model could still load a phase procedure by its own choice, and nothing at runtime prevents it. Three layers make that unlikely and checkable: the description limits it to calls from a kit skill, its first step refuses when the arguments do not name the caller, and `validate-kit` fails when any skill but the phase's door or `aw-converge` names it.

**Where a round runs.** The fix run and `aw-verify` each run in a subagent of their own, and the review in the main session, which receives their reports and none of their reasoning. The context that confirms a defect has not seen how it was fixed, and the axes need no nesting. Subagents cannot ask the user, so a fix run that needs a seam agreed returns the question, and the main session asks it and starts the fix run again with the answer. With no subagents available, `aw-converge` refuses to start.

**The reviewers.** Each round reviews the whole diff from the diff base, with the brief of a first review and an instruction not to read `.aw/reviews/`. The commit subjects of earlier fix runs stay visible, as they do in a review run by hand.

**The limit.** Three rounds, which a call can raise, as in `/aw-converge 5`. A repo cannot change it: each round costs three subagents and a `full` check level, and a repo setting would open the adapter contract (ADR 0006) for a need nobody has. Running the command again starts a new count, with no state kept between calls.

## Considered Options

- **Headless sessions (`claude -p "/aw-review"`)**: rejected. It keeps `disable-model-invocation` as a hard barrier and moves no text, but it works only on the reference harness and cannot ask a question. `-p` also denies whatever needs approval, and a review runs arbitrary commands, so one agent would have to start another with wider permissions.
- **Reading a sibling skill's `SKILL.md`**: rejected. Skills install one folder at a time (ADR 0012), and the reference harness tells the model not to reproduce a blocked skill's steps another way.
- **Moving only the fix run**: rejected. It cites steps 2 to 7 of `aw-build` and the refusals of its step 1, so extracting it alone would put those rules in two skills.
- **Every round in the main session**: rejected. The context that wrote a fix would judge the defects against it, and after compaction the harness keeps only the first 5,000 tokens of each skill, which cuts the fix run off the end of `aw-build`.
- **Every step in a subagent, the review included**: rejected. The axes would then need nested subagents, which an environment variable can turn off.

## Consequences

- The first slice must prove that a subagent can load a skill with `user-invocable: false`. The reference harness's documentation implies it without stating it. If it fails, where a round runs is open again, before any text moves.
