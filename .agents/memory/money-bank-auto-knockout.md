---
name: Money Bank Auto Knockout
description: Server-side Accumulator entry screening using Deriv's proposal-specific knockout barrier and recent market ticks.
---

Auto Knockout must use `tick_size_barrier` and the entry spot/time from the matching Deriv Accumulator proposal; `growth_rate` is not a substitute for that barrier. Compare every quote to the proposal's entry spot, never only to the previous tick. Historical pre-entry movement does not itself cross a new contract's barrier. If the proposal barrier, proposal spot/time, or enough fresh ticks for the configured contract window are unavailable, block the buy before sending it.

**Why:** Deriv's knockout barrier is specific to the proposed contract and measured from its entry spot, while growth rate is a separate setting. Previous-tick comparisons can miss cumulative movement during the scan or falsely block a new contract based on earlier movement.

**How to apply:** When changing Money Bank's pre-trade scan, proposal parsing, or tick history, preserve the exact proposal barrier, compare scan and buy-time quotes against the appropriate proposal spot, and keep no-buy-on-uncertain-data behavior.
