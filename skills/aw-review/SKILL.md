---
name: aw-review
description: "Review the diff from the diff base on three axes, Spec, Standards and Security, each in its own clean-context subagent, and report them side by side. A defect counts only when a run proves it; anything else is a risk with its likelihood and cost; pre-existing findings are reported apart. Writes a review report and never posts to the review host. Run before /aw-ship: after /aw-verify on the standard and epic routes, after /aw-build on the fast route."
disable-model-invocation: true
---

# Review

This phase's steps live in its phase procedure (ADR 0016). Call the Skill tool with "aw-review-steps", with `caller: aw-review` as the arguments, followed by whatever the user asked for with this command. Then follow what it returns. Do not start this phase's work any other way. When that skill is not installed, stop and tell the user to install it with `npx skills add samfaina/ai-workflow --skill aw-review-steps`.
