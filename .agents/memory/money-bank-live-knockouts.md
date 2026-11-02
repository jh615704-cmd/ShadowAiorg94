---
name: Money Bank live knockouts
description: Rules for the read-only, rate-specific live quote knockout monitor.
---

Money Bank's Live Knockouts area is read-only and separate from stats and trade outcomes. For each selected percentage, show all available `ticks_stayed_in` samples returned by Deriv as historical knockout durations; do not collapse these samples into a single displayed number. Keep the historical sample list separate from estimates. Also use the selected market's live tick movement and that percentage's current Deriv barrier to estimate ticks until a possible barrier crossing. Show only integer tick-count estimates, never full market prices. Keep an independent rolling queue of the newest eight estimates per percentage and remove the oldest when a new estimate arrives. These are uncertain forecasts, not guaranteed exit advice or trade instructions.

Keep the selected volatility pair sourced from Money Bank's existing market selection. Do not submit orders, automatically alter exit ticks, or restore the Auto Knockout trading switch.

**Why:** The user clarified that values such as 5, 56, and 567 are tick counts, not market quotes. They also corrected a display that showed only one value per percentage; the underlying historical knockout durations must remain visible alongside separate live estimates.

**How to apply:** Keep each percentage's historical samples and rolling estimates independent. Show all available historical samples for the selected percentage, then display the latest eight integer estimates in a separate line with a visible uncertainty note.
