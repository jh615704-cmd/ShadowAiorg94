---
name: Money Bank historical exit stats
description: Data and labeling rules for the Money Bank tick and knockout statistics panel.
---

Money Bank exit-tick bands must come from settled Money Bank outcomes scoped to the selected market, growth rate, and exact contract duration. Red (observed rate at or below 30%) and green (observed rate at or above 90%) require at least 20 settled contracts in that exact bucket. Use yellow for smaller samples or intermediate rates, and no-data when no matching outcomes exist. The live tick counter is separate from trade history and its reset must not reset the market chart or trading state.

**Why:** The user asked for live-market Money Bank statistics and colored exit-tick guidance; actual matching outcomes avoid inventing results for durations that were never traded.

**How to apply:** Keep metrics account-scoped and show sample counts. Describe colors as historical observations only; never claim they predict or guarantee future wins.
