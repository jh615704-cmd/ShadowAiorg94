---
name: Auto Trader 2 loss recovery
description: The AI 2 recovery trigger and the P/L threshold for returning to Differs.
---

When AI 2 settles any Differs contract at a loss, switch recovery selection to Rise/Fall or Even/Odd. Keep recovery active until settled session P/L exceeds the session P/L immediately before that loss; merely remaining above zero after the loss does not count as recovery.

**Why:** The user clarified that each Differs loss must trigger recovery, including when earlier wins leave session P/L positive, and that the loss must be recovered with additional profit before returning to Differs.

**How to apply:** Track a recovery target at the pre-loss P/L for each triggering loss. Do not clear recovery until a settled result takes P/L strictly above that target. Keep no-order behavior when no eligible recovery candidate is available.
