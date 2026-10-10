---
name: Money Bank budget cap
description: Auto Budget limits planned cumulative stakes and can shorten the recovery ladder.
---

Auto Budget must keep cumulative planned stakes at or below its selected amount, subject to the $1 minimum contract stake. It may use fewer than seven levels when the budget is below the amount needed for seven minimum stakes. A budget below $1 has no valid ladder. Loss at the last planned level stops the run. Reinvested budget-mode stakes remain within that same cycle cap; Manual BASE remains a separate uncapped-by-budget mode with per-order balance checks.

**Why:** The user selected a hard cap after noting that a $10 budget should not display or plan a larger full cycle. The selected cap takes precedence over a seven-level recovery ladder.

**How to apply:** Preserve the cap through stake calculation, reinvestment, balance validation, status copy, and final-level stop behavior. Never describe the ladder as guaranteeing recovery or profit.
