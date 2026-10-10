---
name: Money Bank Auto Knockout
description: Server-side Accumulator entry screening using Deriv's proposal-specific knockout barrier and recent market ticks.
---

Money Bank Auto Knockout is a non-blocking 10-second pre-entry countdown. It must not reject or delay an otherwise valid buy based on barrier movement, scan evidence, or exit-tick availability, and must never close an open contract. Standard authorization, account, balance, proposal, and server trading protections remain in force.

**Why:** The user explicitly wants Auto Knockout to allow trades regardless of the scan result and not stop trades.

**How to apply:** Keep its countdown smooth and visible, but do not connect countdown or knockout scan state to buy approval or contract closure. Preserve unrelated account and Deriv order safeguards.
