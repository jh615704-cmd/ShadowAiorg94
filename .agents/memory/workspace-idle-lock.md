---
name: Workspace idle lock
description: User-defined idle-lock policy for the full Shadow AI Trading workspace.
---

Lock access to the entire Shadow AI Trading workspace after three hours without real user interaction, whether the app stays open or is away in the background. Trade activity does not reset this timer. This applies to the workspace and all trading features, not only Auto Trader 2.0. Manual logout must return to key entry after two seconds even if its server response is delayed; late logout responses must not clear a replacement login.

**Why:** On November 7, 2026, the user changed the lock policy to three hours for both inactivity and time away, including when automatic trades are running. The user also requires manual logout to return to key entry after two seconds.

**How to apply:** Measure from the last human interaction, not ticks or trades. Enforce the same three-hour deadline while the page is open and when the user returns from time away. Treat server revocation as authoritative, but keep the login form available when the two-second countdown ends; prevent delayed logout cleanup or cookie expiry from affecting a newer session.
