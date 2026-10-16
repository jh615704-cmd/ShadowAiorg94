---
name: Trading history results
description: Cross-feature accuracy and presentation rules for Deriv session and contract history.
---

Every trading feature's history should show run P/L, trade count, wins/losses, win rate, and cumulative staked. Each contract row should clearly show net profit/loss and the amount returned. Keep gross return/payout distinct from net profit. For settled Deriv rows without an explicit profit field, derive net profit from sell price minus buy price; open rows must not be treated as settled wins or losses. Cumulative staked is the sum of recorded buy prices, not the current or next planned stake. Preserve known feature rows across partial account-history snapshots so the session summary does not blank.

**Why:** The user asked for accurate, consistent Trading History metrics and each trade's result across every trading feature.

**How to apply:** Keep these rules in the shared history normalization and presentation logic. Test Deriv history rows with absent profit fields, winning and losing sale prices, open contracts, cumulative stake totals, and feature-specific snapshot updates.
