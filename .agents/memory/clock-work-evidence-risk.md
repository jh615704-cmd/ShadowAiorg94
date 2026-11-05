---
name: Clock Work evidence and risk
description: Keep Clock Work and Ai Clock evidence gates honest and session losses bounded.
---

Clock Work AI and Auto Best require at least six completed, non-overlapping five-tick outcomes and an observed rate of at least 58%; there is no user-selectable rate threshold. Ai Clock must be on before the running scanner can place automatic entries. Keep two fresh-tick confirmations, account and settlement safeguards, settled-result accounting, and the pre-entry session-loss budget check. Clearing history hides local rows only; run accounting must use authoritative account history so clearing feature-history claims cannot turn a settled result into a missing result or block controls. Historical hit rates are not guarantees. The default Clock Work session-loss limit is $10; setting it to zero disables the guard.

**Why:** The user requested a fixed 58% threshold with six samples for Clock Work's controls; observed rates do not guarantee future results. A local history clear must not erase the authoritative settlement state used by run safeguards.

**How to apply:** Preserve the inclusive threshold, six-sample floor, live Auto Best refresh, functional Ai Clock switch, fresh confirmations, Deriv/account safeguards, settled-result accounting independent of display-history claims, and pre-entry loss-budget check unless the user changes the strategy.
