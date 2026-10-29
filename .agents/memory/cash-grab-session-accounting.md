---
name: Cash Grab session accounting
description: Cash Grab stop limits and stake progression must use only completed contracts explicitly acknowledged during the active run.
---

Cash Grab session P/L and post-loss stake progression use only settled contracts whose IDs were acknowledged during the active run. Account-wide Rise/Fall rows, other features' records, open trades, previously settled trades, and uncertain buys are not Cash Grab session outcomes.

**Why:** Other Rise/Fall trades can be placed on the same Deriv account outside Cash Grab; including them could trigger or bypass session limits or change the next stake.

**How to apply:** Start each run with an empty set of owned contract IDs, add IDs only after Deriv confirms a buy, and reconcile each settled ID once. Keep account-wide open-contract checks separate for safety.
