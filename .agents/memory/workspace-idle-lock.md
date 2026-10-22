---
name: Workspace idle lock
description: User-defined idle-lock policy for the full Shadow AI Trading workspace.
---

Lock access to the entire Shadow AI Trading workspace after two hours without real user interaction, not merely after two hours away from the browser. Leaving, hiding, or closing the bot should lock it immediately so returning requires the access key again. This applies to the workspace and all trading features, not only Auto Trader 2.0. Keep the fast forced-exit countdown for server-side access revocation separate.

**Why:** The user clarified that the whole bot should lock after two hours with no interaction, and should lock immediately when they leave the bot or browser.

**How to apply:** Track actual user input rather than page visibility or background polling as activity. Lock on hidden/exit lifecycle events and re-require the access key on return. Do not reuse the two-hour duration for unrelated timeouts such as revocation countdowns or trade acknowledgements.
