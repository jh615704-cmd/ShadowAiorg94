---
name: Money Bank Auto Knockout
description: Server-side Accumulator entry screening using Deriv's proposal-specific knockout barrier and recent market ticks.
---

Money Bank Auto Knockout is a server-checked entry gate, not a countdown. Before a buy, the selected market must produce five cleared virtual Accumulator knockouts by default; each event must occur after the selected Take Ticks. Show the cumulative knockout count separately from exit-tick progress for the current virtual contract. If JDY is enabled, evaluate the unchanged selected market, growth rate, stake, and ticks only after the sample is complete. Manual trade losses do not count. Do not describe the scan as a win-rate guarantee.

**Why:** The user clarified that five qualifying knockouts accumulate into the scanner sample, with the AI evaluating the selected setup after those events.

**How to apply:** Keep the UI scanner state, API schema, and server-side buy check in sync. Preserve account, market, balance, proposal, and Deriv order safeguards. Never close an open contract as part of knockout scanning.
