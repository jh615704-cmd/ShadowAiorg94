---
name: Trade contract selection
description: Exact-barrier semantics and settlement display rules for digit trading features.
---

For Digit Differs, the selected digit is the barrier that must not be the final digit at expiry; intermediate ticks do not settle the contract. Manual taps must submit that exact barrier, while ranked automation may choose a candidate only when it is explicitly surfaced as ranked mode. Trade X observation windows must use the next live ticks, not ranked-history positions.

For grouped multi-contract actions (Auto Trader, Bulk Trader, Clock Work, Matches, and Dual), quote every leg first and dispatch the buys together to avoid artificial per-contract delays. Each contract still has its own Deriv acknowledgement, entry quote, and settlement; never promise identical outcomes or an exact shared entry tick. Preserve confirmed contract IDs when only part of a batch is confirmed, and require account-history review before any uncertain order is resubmitted. Features that intentionally wait for settlement before their next entry remain sequential.

**Why:** Duration-based ranked selection previously replaced a digit the user had selected, and open-contract mark-to-market profit was displayed as a loss before settlement. An artificial delay between already-quoted legs also caused grouped entries to start at different market ticks.

**How to apply:** Keep manual and automated entry selection explicit, observe the configured number of fresh ticks before Smart Auto evaluates, never use an automation setting as the contract duration by accident, block overlapping contracts when the feature expects sequential settlement, and display profit only after the contract is closed. For grouped batches, dispatch the already-quoted legs together while preserving per-leg acknowledgements; a rejected or uncertain leg must not hide confirmed siblings or trigger an automatic replay.