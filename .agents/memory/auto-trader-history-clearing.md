---
name: Auto Trader history clearing
description: Scope Auto Trader history clears to the local current-account view without deleting Deriv's authoritative history.
---

Clear only locally tracked Auto Trader rows for the selected account. Do not present this as deletion of Deriv's account history.

**Why:** The Auto Trader history view is account-scoped, while Deriv's authoritative history includes trades outside this feature. The UI clear action should not erase those records.

**How to apply:** Require a second confirmation before clearing the local view, and state clearly that Deriv's history remains unchanged.
