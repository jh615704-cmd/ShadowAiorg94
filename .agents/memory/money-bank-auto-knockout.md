---
name: Money Bank Auto Knockout
description: Server-side Accumulator entry screening using Deriv's proposal-specific knockout barrier and recent market ticks.
---

Money Bank Auto Knockout is a server-checked entry gate, not a countdown. Before a buy, the selected market must produce five cleared virtual Accumulator knockouts by default; each event must occur after the selected Take Ticks. Show the cumulative knockout count separately from exit-tick progress for the current virtual contract. After the sample, always evaluate the unchanged selected market, percentage, stake, and ticks, even if JDY's separate toggle is off. Manual entries still follow that toggle. Manual trade losses do not count. Do not describe the scan as a win-rate guarantee.

**Why:** The user clarified that five qualifying knockouts accumulate into the scanner sample and that AI approval is required afterward for every Auto Knockout entry.

**How to apply:** Keep the UI scanner state, API schema, and server-side buy check in sync. Reset the sample after each settled trade so later entries cannot reuse earlier knockouts. Preserve account, market, balance, proposal, and Deriv order safeguards. Never close an open contract as part of knockout scanning.
