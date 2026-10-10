---
name: Auto Trader 2 loss recovery
description: The AI 2 recovery trigger and the P/L threshold for returning to Differs.
---

When AI 2 settles any Differs contract at a loss, switch recovery selection to Rise/Fall or Even/Odd. Keep recovery active until settled session P/L exceeds the session P/L immediately before that loss; merely remaining above zero after the loss does not count as recovery.

**Why:** The user clarified that each Differs loss must trigger recovery, including when earlier wins leave session P/L positive, and that the loss must be recovered with additional profit before returning to Differs.

**How to apply:** Track a recovery target at the pre-loss P/L for each triggering loss. Do not clear recovery until a settled result takes P/L strictly above that target. Keep no-order behavior when no eligible recovery candidate is available.

For reload safety, save AI 2 session checkpoints in account-scoped browser storage before order submission, after Deriv accepts a contract, and after settlement is verified. A reload must never automatically restart the loop or resend a possibly submitted order.

**Why:** A browser reload can interrupt an in-flight buy or settlement check; without a durable checkpoint, the bot could forget recovery state or duplicate an order.

**How to apply:** On reload, require a fresh Deriv status and history check, matching account ID, no open contracts, and settled saved contract IDs with a matching session total before resuming. A clean `ready` checkpoint should remain resumable from Start without a manual clear; only awaiting-settlement, interrupted placement, or ambiguous history should keep Start blocked for review.

For AI 2 direction, parity, and market selection, score historical expiry outcomes at the configured contract duration rather than raw one-tick frequencies. Require at least 20 complete expiry samples and a rate at least four percentage points above that contract's baseline. After three losses on one contract type without a positive settlement, pause that type for the rest of the AI 2 session. If no unpaused alternative qualifies, wait without buying. Preserve loss streaks and pauses in the verified account-scoped checkpoint.

**Why:** Direction and digit frequencies over one tick can differ from the result at a multi-tick contract's expiry; repeatedly choosing a direction after three losses also defeats the requested avoidance behavior.

**How to apply:** Compare each entry point with its quote or digit at the configured expiry offset. Keep the existing no-order behavior until at least one eligible, unpaused candidate meets the sample and edge thresholds. A positive settlement resets that type's loss streak; a zero settlement does not.
