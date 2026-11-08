---
name: aw-verify
description: "Prove each acceptance criterion of a built spec on the real app through the repo's verify skill, record each result (passed, failed or inconclusive) as verify: evidence in Traceability, and commit it locally. Without a verify skill, report which criteria need test: or manual: evidence. On the fast route, proves intake's done-when criteria instead, and only when a verify skill exists. Run after the last /aw-build, before /aw-review."
disable-model-invocation: true
---

# Verify

This phase's steps live in its phase procedure (ADR 0016). Call the Skill tool with "aw-verify-steps", with `caller: aw-verify` as the arguments, followed by whatever the user asked for with this command. Then follow what it returns. Do not start this phase's work any other way.
