---
name: aw-build
description: "Build one slice of an approved spec per call: on a work branch, test-first with aw-tdd at the agreed seams, then run the task checks, tick the slice, update Traceability and commit locally. Stops with a proposed spec change when the spec is wrong. On the fast route, builds the whole task from intake's done-when criteria with no spec. A fix run fixes the introduced defects of the latest review report. Run after /aw-slices, once per slice, after /aw-intake on the fast route, or after /aw-review reports an introduced defect."
disable-model-invocation: true
---

# Build

This phase's steps live in its phase procedure (ADR 0016). Call the Skill tool with "aw-build-steps", with `caller: aw-build` as the arguments, followed by whatever the user asked for with this command. Then follow what it returns. Do not start this phase's work any other way. When that skill is not installed, stop and tell the user to install it with `npx skills add samfaina/ai-workflow --skill aw-build-steps`.
