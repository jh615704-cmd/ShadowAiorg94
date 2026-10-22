---
name: Workspace idle lock
description: User-defined idle-lock policy for the full Shadow AI Trading workspace.
---

Lock access to the entire Shadow AI Trading workspace after two hours away, rather than after a few seconds. This applies to the workspace and all trading features, not only Auto Trader 2.0. Keep the fast forced-exit countdown for server-side access revocation separate from the idle-lock duration.

**Why:** On October 22, 2026, the user clarified that the two-hour idle lock applies to the whole bot, not one trading feature, and replaces the previous ten-second away lock.

**How to apply:** When adjusting session/access behavior, use the two-hour duration for away-idle checks across the workspace. Do not reuse it for unrelated timeouts such as revocation countdowns or trade acknowledgements.
