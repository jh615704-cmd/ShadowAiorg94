---
name: Money Bank Auto Knockout
description: Server-side Accumulator entry screening using Deriv's proposal-specific knockout barrier and recent market ticks.
---

Auto Knockout must use `tick_size_barrier` from the matching Deriv Accumulator proposal; `growth_rate` is not a substitute for that barrier. If the proposal barrier, proposal spot/time, or enough fresh ticks for the configured contract window are unavailable, block the buy before sending it.

**Why:** Deriv's knockout barrier is specific to the proposed contract, while growth rate is a separate setting. Treating them as equivalent can create false safety checks.

**How to apply:** When changing Money Bank's pre-trade scan, proposal parsing, or tick history, preserve the exact proposal barrier and the no-buy-on-uncertain-data behavior.
