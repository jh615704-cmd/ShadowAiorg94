---
name: Trading history results
description: Cross-feature accuracy and presentation rules for Deriv session and contract history.
---

Every trading feature's history should show run P/L, trade count, wins/losses, win rate, and cumulative staked. Each contract row should clearly show net profit/loss and the amount returned. Keep gross return/payout distinct from net profit. For settled Deriv rows without an explicit profit field, derive net profit from sell price minus buy price; open rows must not be treated as settled wins or losses. Cumulative staked is the sum of recorded buy prices, not the current or next planned stake. Preserve known feature rows across partial account-history snapshots so the session summary does not blank.

A contract ID belongs only to the feature that acknowledged its buy, scoped to the selected Deriv account. Do not assign history by contract type alone, and clear local claims when the account changes.

The shared history read is a display snapshot, not a trade-safety authority. On transient Deriv refresh failures, serve the account-scoped cache with an explicit stale signal and server warning; filter malformed cached rows rather than failing every feature's history panel. Keep credential and capacity errors visible, and use verified portfolio/status data for trade-lock decisions.

**Why:** The user asked for accurate metrics and for a trade placed in one feature never to appear in another feature's history.

**How to apply:** Keep history resilient, account-scoped, and explicitly owned by its originating feature. Test cross-feature and cross-account contract-ID collisions alongside absent profit fields, settled and open contracts, cumulative stakes, partial snapshots, malformed rows, and transient refresh failures; never let a stale display snapshot release a trade lock.
