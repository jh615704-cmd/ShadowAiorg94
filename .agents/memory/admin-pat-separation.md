---
name: Admin PAT separation
description: The boundary between workspace access-key authorization and the Deriv credential used for trading.
---

The primary administrator access key grants workspace and feature permissions only. It must never select, inject, or fall back to `DERIV_API_TOKEN`; each access-key browser session must validate and use the PAT entered in its own connection form.

**Why:** Reusing the secret PAT made a newly entered admin session appear connected to an old credential and made PAT rotation ambiguous. It also coupled application administration to an external trading credential.

**How to apply:** Keep Deriv PATs encrypted per access-key session, require explicit PAT entry before account/status/history/proposal/buy requests, dispose the runtime when the PAT is disconnected or rejected, and treat secret rotation as unrelated to an already authenticated browser session.

The shared `DERIV_API_TOKEN` Replit secret is not a trading credential in the production runtime. Its rotation does not update a user's saved PAT or require an API restart. The project owner expects Deriv PAT refreshes roughly every 4–5 months.

**Why:** The trading app intentionally isolates credentials by user. Replacing a workspace secret cannot safely replace the PAT that an individual session entered.

**How to apply:** When the owner reports updating `DERIV_API_TOKEN`, verify only secret existence with the secret-only environment view and check `GET /api/healthz`; never read or log its value, and do not restart the API solely for this unused secret. If an actual user PAT has expired, reconnect that user's Deriv session through the dashboard and verify its status. Reassess this rule only if production code begins consuming the shared secret.