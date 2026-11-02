---
name: Money Bank historical exit stats
description: Data and labeling rules for the Money Bank tick and knockout statistics panel.
---

Money Bank exit-tick bands must come from settled Money Bank outcomes scoped to the selected market, growth rate, and exact contract duration. Red (observed rate at or below 30%) and green (observed rate at or above 90%) require at least 20 settled contracts in that exact bucket. Use yellow for smaller samples or intermediate rates, and no-data when no matching outcomes exist. The live tick counter is separate from trade history and its reset must not reset the market chart or trading state.

Keep the Stats tick range fixed at 1–20, independent of the selected trade take-profit. The 1–5% filters must scope both summary metrics and colored exit ticks to the selected growth rate; “All Rates” combines them.

**Why:** The user wants a consistent 1–20 stats view and accurate rate-specific knockout results; changing trade settings should not silently narrow the stats.

**How to apply:** Keep metrics account-scoped and show sample counts. Describe colors as historical observations only; never claim they predict or guarantee future wins.
