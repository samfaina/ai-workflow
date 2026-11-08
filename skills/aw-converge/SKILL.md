---
name: aw-converge
description: "Take a work branch from a review report with introduced defects to a review report with none: repeat the fix run of /aw-build, /aw-verify when the fix calls for it, and /aw-review, up to 3 rounds, which a call can raise, as in /aw-converge 5. Reports the defects left at the limit and stops with its reason on anything a round cannot resolve. Never pushes, opens a review request or merges. Run after /aw-review reports an introduced defect."
disable-model-invocation: true
---

# Converge

The rounds of a convergence run live in the convergence procedure (ADR 0017). Call the Skill tool with "aw-converge-steps", with `caller: aw-converge` as the arguments, followed by whatever the user asked for with this command. Then follow what it returns. Do not start this work any other way. When that skill is not installed, stop and tell the user to install it with `npx skills add samfaina/ai-workflow --skill aw-converge-steps`.
