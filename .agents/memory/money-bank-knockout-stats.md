---
name: Money Bank live statistics
description: Rules for live Money Bank tick display and rate-scoped knockout summaries.
---

Keep the Money Bank Stats range fixed at ticks 1–20, independent of take-profit. Do not render empty tick placeholders before a live market tick arrives. The All Rates view may show the current market tick; a 1–5% view must show only that rate's active contract tick or matching outcome data.

Scope summaries and outcome bands to the selected market and growth rate; All Rates combines rates. Include matching open, pending, or active contracts with a positive `tick_passed` in tracked runs and duration metrics so those values advance with the live contract. Count knockouts and completed runs only from settled Deriv outcomes; do not infer contract results from quote direction.

Color historical exit ticks only from settled outcomes at the same market, growth rate, and exact duration. Red (observed rate at or below 30%) and green (at or above 90%) require at least 20 settled contracts in that exact bucket; use yellow for smaller samples or intermediate rates. The live marker is distinct from outcome colors, and historical colors are not predictions.

The live tick counter and its reset are separate from trade history; resetting it must not reset the market chart or trading state.

**Why:** The user wants stats to begin with live market ticks and each percentage selection to isolate its own Money Bank data. Contract outcomes must remain grounded in Deriv results rather than inferred from raw price movement.

**How to apply:** Keep market, rate, duration, account, active-contract progress, and settled-outcome filters consistent across the Stats panel and its tests. Use an explicit empty state instead of zero-filled placeholder cells when a selected rate has no samples.
