# Answering a UAT case's questions

How to propose the answer to a question asked during a **UAT case**, from the case's `answers` and `turns`. [CASE-FORMAT.md](CASE-FORMAT.md) describes both fields.

## What you get

- **A question**: either one the agent asked with options to choose from, or the text of a turn that ended with the agent waiting.
- **`answers`**: one `{ "when", "intent", "reason" }` per question the agent may ask.
- **`turns`**: one `{ "intent", "reason" }` per follow-up message, in order, and how many of them have been sent so far.

## Rules

These rules hold in both flows: a run with the **UAT conductor**, and an **Unattended run**.

Answers and turns are intents, and option labels change between runs. Match each question, whether the agent asked it with options or in prose, to an entry's `when`, then pick the option of **this run** that fulfils its `intent`. Give the reason with the answer. When the entry's `intent` says to type the answer in and no option of this run fulfils it, the answer is that text, given through the question's free-text choice, "Other".

A turn that ends with the agent waiting is often a question in plain prose. Treat its text like a question, and take the reply from the first entry of `turns` not sent yet.

### Stop points

Where the case's checks expect the agent to stop, such as an approval it must only ask for, the step ends with the question unanswered. This holds even when an entry such as "accept what it proposes" could be stretched to fit, and even when `turns` has entries not sent yet: answering would take the agent past what the case checks.

## When no entry fits

When no entry fits a question that is not a stop point, the question is **drift**. Where a drift answer is given, it is chosen from what the case is testing, marked as drift, and given with its reason. What happens next depends on the flow.

### With the UAT conductor

The conductor proposes a drift answer for the person to confirm, whether the question came with options or in prose.

### In an unattended run

- **A question asked with options:** choose a drift answer among its options, so the run goes on within what the skill offered. It is recorded with `drift: true`.
- **A question in prose:** the step ends with the question unanswered, because an invented reply can take the agent past the case.

## Recording a drift answer

A drift answer is recorded as a new `answers` entry, with three values, which `run.mjs drift` takes as flags of the same names:

- `when`: the question as asked.
- `intent`: the answer used.
- `reason`: why that answer fits what the case is testing.
