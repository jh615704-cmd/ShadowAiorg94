---
name: Workspace idle lock
description: User-defined idle-lock policy for the full Shadow AI Trading workspace.
---

Lock access to the entire Shadow AI Trading workspace after two hours without real user interaction. If the user leaves, hides, or closes the bot, require the access key when they return after more than 30 minutes away; shorter departures do not lock by themselves. This applies to the workspace and all trading features, not only Auto Trader 2.0. Keep the fast forced-exit countdown for server-side access revocation separate.

**Why:** The user updated the departure rule: short absences should not immediately lock the bot, but returning after more than 30 minutes away must require signing in again.

**How to apply:** Track actual user input separately from browser visibility. Persist the time the user leaves, enforce the 30-minute away limit on return, and retain the two-hour inactivity limit while the workspace remains open. Do not reuse either duration for unrelated timeouts such as revocation countdowns or trade acknowledgements.
