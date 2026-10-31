---
name: Money Bank Auto Knockout
description: Server-side Accumulator entry screening using Deriv's proposal-specific knockout barrier and recent market ticks.
---

Money Bank Auto Knockout is a server-checked entry gate, not a countdown. Before a buy, the selected market must produce the configured number of virtual Accumulator knockouts that occur after the selected Take Ticks and clear. Default to four; show qualified-knockout count and exit-tick progress. Manual trade losses do not count. Do not describe the scan as a win-rate guarantee.

**Why:** The user specified that Auto Knockout should wait for selected exit ticks, confirm the knockout has cleared, show progress, and only then allow the trade.

**How to apply:** Keep the UI scanner state, API schema, and server-side buy check in sync. Preserve account, market, balance, proposal, and Deriv order safeguards. Never close an open contract as part of knockout scanning.
