---
name: Clock Work evidence and risk
description: Keep Clock Work and Ai Clock evidence gates honest and session losses bounded.
---

Clock Work AI and Auto Best require at least six completed, non-overlapping five-tick outcomes and an observed rate strictly greater than 58%; there is no user-selectable rate threshold. Keep two fresh-tick confirmations, account and settlement safeguards, settled-result accounting, and the pre-entry session-loss budget check. Historical hit rates are not guarantees. The default Clock Work session-loss limit is $10; setting it to zero disables the guard.

**Why:** The user changed Clock Work's evidence requirements to six completed outcomes and a fixed strict >58% observed-rate gate; six outcomes are less reliable and must not be presented as a future guarantee.

**How to apply:** Preserve the fixed threshold, six-sample floor, fresh confirmations, Deriv/account safeguards, settled-result accounting, and pre-entry loss-budget check unless the user changes the strategy.
