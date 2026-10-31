---
name: Clock Work evidence and risk
description: Keep Clock Work and Ai Clock evidence gates honest and session losses bounded.
---

Clock Work's default entry threshold is the user's selected 55% observed historical rate; compare the observed rate directly to the selected 55/65/70% threshold rather than applying a hidden confidence cutoff. Keep the 20-outcome evidence floor and two fresh confirmations. Observed hit rates are not guarantees. Stop before sending a stake that could exceed the remaining configured session-loss budget. The default Clock Work session-loss limit is $10; setting it to zero disables the guard.

**Why:** Clock Work was not entering because its hidden confidence cutoff overrode the user's selected historical-rate threshold. The user chose 55% so the displayed threshold controls eligibility.

**How to apply:** Preserve the direct selected-rate gate, sample sufficiency, fresh confirmations, Deriv/account safeguards, settled-result accounting, and the pre-entry loss-budget check unless the user changes the strategy.
