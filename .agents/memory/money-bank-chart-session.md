---
name: Money Bank chart session
description: Reset behavior for the top Money Bank market chart.
---

The Money Bank top chart is a local observation session. Changing its selected volatility starts a fresh line and tick count at zero. Its refresh control does the same for the current market.

**Why:** The user explicitly corrected the desired behavior: switching volatility should restart the chart tick count, and a refresh icon should let them reset it again.

**How to apply:** Scope resets to Money Bank's chart series and client-side sequence cursor. Do not reset Deriv's shared market feed, other feature histories, or trading state.
