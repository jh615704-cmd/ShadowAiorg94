---
name: Clock Work evidence and risk
description: Keep Clock Work and Ai Clock evidence gates honest and session losses bounded.
---

Clock Work's default entry threshold is 50% observed historical rate, with selectable 50/55/65/70% thresholds; compare the observed rate directly to the selected threshold rather than applying a hidden confidence cutoff. Keep the 20-outcome evidence floor and two fresh confirmations. Observed hit rates are not guarantees. Stop before sending a stake that could exceed the remaining configured session-loss budget. The default Clock Work session-loss limit is $10; setting it to zero disables the guard.

**Why:** Clock Work was not entering because its hidden confidence cutoff overrode the user's selected historical-rate threshold. The user later set the default to 50% and requested the same threshold across the other features, except Auto Trader and Auto Trader 2.0.

**How to apply:** Preserve the direct selected-rate gate, sample sufficiency, fresh confirmations, Deriv/account safeguards, settled-result accounting, and the pre-entry loss-budget check unless the user changes the strategy.
