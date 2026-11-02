---
name: Money Bank live knockouts
description: Rules for the read-only, rate-specific live quote knockout monitor.
---

Money Bank's Live Knockouts area is separate from account statistics and historical quote replay. Use the currently selected market's live quotes and each rate's current Deriv proposal barrier. Start each rate from the live quote snapshot, record the exact market quote when its absolute move reaches the barrier, reset its reference to that hit, and retain the newest eight hits oldest-to-newest. Selecting a rate changes only which queue is shown; track each available rate independently while connected. Display quote values to two decimal places.

The monitor is read-only: it must not submit orders or restore the Auto Knockout trading switch. Keep the market and volatility pair sourced from Money Bank's existing top market selection.

**Why:** The user explicitly requested complete removal of Stats and a separate Live Knockouts display using live market prices, eight rolling barrier-hit values per rate, and no statistics-style layout.

**How to apply:** Keep detection tied to live ticks and rate-specific Deriv barriers. When a ninth hit arrives, discard the oldest displayed hit. Never infer a knockout from settled trade summaries or historical simulation.
