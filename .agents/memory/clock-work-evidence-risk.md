---
name: Clock Work evidence and risk
description: Keep Clock Work and Ai Clock evidence gates honest and session losses bounded.
---

Clock Work/Ai Clock may use historical five-tick outcomes to filter entries, but observed hit rates are not guarantees. Keep the evidence floor conservative, require fresh confirmation, and stop before sending a stake that could exceed the remaining configured session-loss budget. The default Clock Work session-loss limit is $10; setting it to zero disables the guard.

**Why:** The user requires real decision logic rather than a hidden win-rate promise and asked for the $10 loss scenario to be explicit.

**How to apply:** Preserve sample sufficiency, freshness checks, Deriv/account safeguards, settled-result accounting, and the pre-entry loss-budget check when changing Clock Work or Ai Clock.
