---
name: Trade contract selection
description: Exact-barrier semantics and settlement display rules for digit trading features.
---

For Digit Differs, the selected digit is the barrier that must not be the final digit at expiry; intermediate ticks do not settle the contract. Manual taps must submit that exact barrier, while ranked automation may choose a candidate only when it is explicitly surfaced as ranked mode. Trade X observation windows must use the next live ticks, not ranked-history positions.

For Auto Trader and Bulk Trader multi-contract batches, dispatch already-quoted buy requests together to avoid adding an artificial per-contract delay. Each contract still has its own Deriv acknowledgement, entry quote, and settlement; never promise identical outcomes or an exact shared entry tick. Preserve confirmed contract IDs when only part of a batch is confirmed, and require account-history review before any uncertain order is resubmitted.

**Why:** Duration-based ranked selection previously replaced a digit the user had selected, and open-contract mark-to-market profit was displayed as a loss before settlement. Treating a historical rank as a future tick misrepresented what the automation had actually observed.

**How to apply:** Keep manual and automated entry selection explicit, observe the configured number of fresh ticks before Smart Auto evaluates, never use an automation setting as the contract duration by accident, block overlapping contracts when the feature expects sequential settlement, and display profit only after the contract is closed. Keep batch dispatch synchronization separate from settlement behavior; a rejected or uncertain leg must not hide confirmed siblings or trigger an automatic replay.