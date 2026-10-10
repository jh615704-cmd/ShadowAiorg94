---
name: Auto Trader 2 loss recovery
description: The AI 2 recovery trigger and the P/L threshold for returning to Differs.
---

When AI 2 settles any Differs contract at a loss, switch recovery selection to Rise/Fall or Even/Odd. Keep recovery active until settled session P/L exceeds the session P/L immediately before that loss; merely remaining above zero after the loss does not count as recovery.

**Why:** The user clarified that each Differs loss must trigger recovery, including when earlier wins leave session P/L positive, and that the loss must be recovered with additional profit before returning to Differs.

**How to apply:** Track a recovery target at the pre-loss P/L for each triggering loss. Do not clear recovery until a settled result takes P/L strictly above that target. Keep no-order behavior when no eligible recovery candidate is available.

For reload safety, save AI 2 session checkpoints in account-scoped browser storage before order submission, after Deriv accepts a contract, and after settlement is verified. A reload must never automatically restart the loop or resend a possibly submitted order.

**Why:** A browser reload can interrupt an in-flight buy or settlement check; without a durable checkpoint, the bot could forget recovery state or duplicate an order.

**How to apply:** On reload, require a fresh Deriv status and history check, matching account ID, no open contracts, and settled saved contract IDs with a matching session total before resuming. Treat an interrupted placement or ambiguous history as manual review and fail closed.
