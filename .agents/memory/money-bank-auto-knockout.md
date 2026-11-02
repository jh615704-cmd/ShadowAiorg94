---
name: Money Bank Auto Knockout compatibility
description: The Money Bank UI no longer exposes Auto Knockout; legacy API support remains separate.
---

Do not reintroduce an Auto Knockout switch or trading flow in the Money Bank UI. A separate read-only Live Knockouts monitor is allowed; it displays rate-specific live market quote hits and does not place orders. New Money Bank orders must not request Auto Knockout. Existing server routes and schemas may remain for compatibility with older clients; do not remove that API surface unless explicitly requested.

**Why:** The user explicitly requested complete removal of the Auto Knockout switch from Money Bank while keeping unrelated trade safeguards intact, then separately requested a live, read-only market knockout display.

**How to apply:** Keep the Money Bank UI and its outgoing buy payload free of Auto Knockout behavior. The Live Knockouts monitor must remain informational only. Treat retained backend routes as compatibility only, and preserve account, market, balance, proposal, and Deriv order safeguards.
