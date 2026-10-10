---
name: Auto Trader history clearing
description: Scope Auto Trader history clears to the local current-account view without deleting Deriv's authoritative history.
---

Clear only locally tracked Auto Trader rows for the selected account. For Auto Trader 2.0, also reset the run totals, stake progression, and safe local recovery checkpoint so the next run starts at the configured base stake. Do not present this as deletion of Deriv's account history.

**Why:** The Auto Trader history view is account-scoped, while Deriv's authoritative history includes trades outside this feature. The user wants Auto Trader 2.0's clear action to reset its displayed run stats and stake without altering Deriv records or abandoning an open/uncertain order.

**How to apply:** Require a second confirmation, then verify the selected account has no open contract and no saved session needs review before clearing Auto Trader 2.0's local history or checkpoint. Keep Deriv history unchanged; block the reset until unresolved orders or sessions are verified.
