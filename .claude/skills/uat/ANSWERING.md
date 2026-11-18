# Answering a UAT case's questions

How to propose the answer to a question asked during a **UAT case**, from the case's `answers` and `turns`. [CASE-FORMAT.md](CASE-FORMAT.md) describes both fields.

## What you get

- **A question**: either one the agent asked with options to choose from, or the text of a turn that ended with the agent waiting.
- **`answers`**: one `{ "when", "intent", "reason" }` per question the agent may ask.
- **`turns`**: one `{ "intent", "reason" }` per follow-up message, in order, and how many of them have been sent so far.

## Rules

Answers and turns are intents, and option labels change between runs. Match the question to an entry's `when`, then pick the option of **this run** that fulfils its `intent`. Give the reason with the answer.

A turn that ends with the agent waiting is often a question in plain prose. Treat its text like a question, and take the reply from the first entry of `turns` not sent yet.

When no entry fits, the question is **drift**. Choose an answer from what the case is testing, mark it as drift, and give the reason for that answer. A drift answer is recorded as a new `answers` entry, with three values, which `run.mjs drift` takes as flags of the same names:

- `when`: the question as asked.
- `intent`: the answer used.
- `reason`: why that answer fits what the case is testing.
