---
name: Cash Grab auto-switch
description: Cash Grab's safest-pair automation scans live evidence on a fixed cadence and remains interruptible.
---

All Cash Grab modes keep at most one current-session contract open. Manual contract limits count sequential entries, and each next entry waits for settlement. Auto-switch remains independent from JDY AI 3 and rescans supported markets every 20 seconds. Auto-switch, Auto Direction, Auto Best, and Scan + Trade must evaluate actual quote outcomes at the selected 1–5 tick expiry, using at least 20 complete non-overlapping samples and a conservative lower-bound filter above 50%. Auto Direction confirms the same direction across two fresh ticks and rechecks it immediately before sending.

**Why:** Sequential entries prevent overlapping exposure in manual and automatic sessions. Per-tick movement percentages do not represent the outcome of a multi-tick contract, and a historical sample cannot guarantee future wins. The user requires actual decision logic rather than a hidden or displayed win-rate promise.

**How to apply:** Keep MONEY STOP and switching Auto-switch off as immediate no-new-entry controls; MONEY STOP also closes every claimed open Cash Grab contract from the active session. Session P/L displays should derive from settled rows in each feature-scoped history, not only mutable counters. Preserve account/live-funds checks, sample thresholds, cent rounding, and settled session-limit enforcement. Do not restore removed inline helper notes.