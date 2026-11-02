---
name: Money Bank live knockouts
description: Rules for the read-only, rate-specific live quote knockout monitor.
---

Money Bank's Live Knockouts area is read-only and separate from stats and trade outcomes. For each selected percentage, use its current Deriv barrier and the selected market's live tick movement to estimate ticks until a possible barrier crossing. Show only integer tick-count estimates, never full market prices. Keep an independent rolling queue of the newest eight estimates per percentage and remove the oldest when a new estimate arrives. These are uncertain forecasts, not guaranteed exit advice or trade instructions.

Keep the selected volatility pair sourced from Money Bank's existing market selection. Do not submit orders, automatically alter exit ticks, or restore the Auto Knockout trading switch.

**Why:** The user clarified that values such as 5, 56, and 567 are predicted tick counts for the selected growth rate, not market quotes, and are used to avoid crossing those ticks.

**How to apply:** Keep each percentage's estimates independent and tied to current live movement plus its own Deriv barrier. Display the latest eight integer estimates in a clear line with a visible uncertainty note.
