---
name: Money Bank budget cap
description: Auto Budget limits planned cumulative stakes and can shorten the recovery ladder.
---

Auto Budget must keep cumulative planned stakes at or below its selected amount, subject to the $1 minimum contract stake. It may use fewer than seven levels when the budget is below the amount needed for seven minimum stakes. A budget below $1 has no valid ladder. A loss at the final planned level exhausts the cycle but must leave Money Bank active in a no-order wait until the user stops and starts a new cycle. Reinvested budget-mode stakes remain within that same cycle cap; Manual BASE remains a separate uncapped-by-budget mode with per-order balance checks.

**Why:** The user selected a hard cap after noting that a $10 budget should not display or plan a larger full cycle, then clarified that automation must remain active except for manual stop or configured session profit/loss limits. The selected cap takes precedence over a seven-level recovery ladder without turning cycle exhaustion into a run stop.

**How to apply:** Preserve the cap through stake calculation, reinvestment, balance validation, status copy, and final-level no-order hold behavior. Never describe the ladder as guaranteeing recovery or profit.
