---
name: Money Bank Auto Knockout
description: Server-side Accumulator entry screening using Deriv's proposal-specific knockout barrier and recent market ticks.
---

Money Bank Auto Knockout is a server-checked entry gate controlled by the configured Qualified Knockouts required count. Count each observed move beyond the proposal barrier when price returns inside it; do not wait for a virtual contract to survive Take Ticks or show virtual exit-tick progress. Take Ticks applies only to the actual Accumulator trade. After the sample, always evaluate the unchanged selected market, percentage, stake, and ticks, even if JDY's separate toggle is off. Manual entries still follow that toggle. Reset the sample after each settled trade. Manual trade losses do not count. Do not describe the scan as a win-rate guarantee.

**Why:** The user clarified that the Qualified Knockouts required setting controls the wait; a virtual-contract Take Ticks gate was not wanted. AI approval is still required after every Auto Knockout sample.

**How to apply:** Keep the UI scanner state, API schema, and server-side buy check in sync. Reset the sample after each settled trade so later entries cannot reuse earlier knockouts. Preserve account, market, balance, proposal, and Deriv order safeguards. Never close an open contract as part of knockout scanning.
