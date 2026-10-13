---
name: Auto Trader 2 loss handling
description: AI 2 recovery rules, paired-side switching, and evidence-gated entries.
---

When AI 2 settles any Differs contract at a loss, switch recovery selection to Rise/Fall or Even/Odd. Keep recovery active until settled session P/L exceeds the session P/L immediately before that loss; merely remaining above zero after the loss does not count as recovery.

**Why:** The user clarified that each Differs loss must trigger recovery, including when earlier wins leave session P/L positive, and that the loss must be recovered with additional profit before returning to Differs.

**How to apply:** Track a recovery target at the pre-loss P/L for each triggering loss. Do not clear recovery until a settled result takes P/L strictly above that target. Keep no-order behavior when no eligible recovery candidate is available.

For reload safety, save AI 2 session checkpoints in account-scoped browser storage before order submission, after Deriv accepts a contract, and after settlement is verified. A reload must never automatically restart the loop or resend a possibly submitted order.

**Why:** A browser reload can interrupt an in-flight buy or settlement check; without a durable checkpoint, the bot could forget recovery state or duplicate an order.

**How to apply:** On reload, require a fresh Deriv status and history check, matching account ID, no open contracts, and settled saved contract IDs with a matching session total before resuming. A clean `ready` checkpoint should remain resumable from Start without a manual clear; only awaiting-settlement, interrupted placement, or ambiguous history should keep Start blocked for review.

For AI 2 direction and parity, score historical expiry outcomes at the configured contract duration rather than raw one-tick frequencies. Use the stronger confidence filter and sample requirement in the strategy module; if evidence does not qualify, wait without buying. After a loss on Rise/Fall or Even/Odd, require the paired opposite contract type for the next entry. Spend a quiet three-second analysis window, then fetch fresh market status before choosing the next eligible market. If that opposite side does not qualify, keep waiting rather than switching back to the losing side. After three losses on one contract type without a positive settlement, pause that type for the rest of the AI 2 session.

**Why:** The user wants one-loss side changes and a short, non-countdown analysis pause to reduce repeated entries on a side that just lost. Historical evidence must qualify before an order; no market filter guarantees future results.

**How to apply:** Compare each entry point with its quote or digit at the configured expiry offset. Persist the forced opposite side with the verified account-scoped checkpoint so reload recovery cannot silently revert to the prior side. A positive settlement resets that type's loss streak; a zero settlement does not. Differs losses still use the separate recovery target above and may choose qualifying Rise/Fall or Even/Odd candidates.

An explicit Stop should mark an AI 2 checkpoint completed only when no buy is pending and no accepted contract is awaiting settlement. This lets a clean Stop return to Start without a misleading Verify & Resume prompt, while pending, uncertain, or unsettled trades remain blocked for Deriv verification.

**Why:** The user wants Stop to end the automation and allow a fresh run after a clean stop, without treating a live or uncertain Deriv contract as cancelled.

**How to apply:** Keep the saved session review gates intact for `placing`, `manual-review`, and `awaiting-settlement`. Only promote a clean, no-order stop to `completed`; do not close or replay a contract accepted by Deriv.
