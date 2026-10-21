---
name: Matches automation quality
description: User preference for Matches Analysis auto-entry filtering and control visibility.
---

Matches Analysis automation should let users choose the top one, two, or three ranked digits before enabling its switch. Keep the observed-frequency quality filter in the trading logic rather than adding another settings control, and never describe past frequency as a guaranteed win rate.

**Why:** The user wants fewer low-quality Matches entries without adding more controls to the bot's visible setup.

**How to apply:** Preserve the explicit top-digit count selector and switch-style start/stop control. Keep any eligibility threshold internal, derive it from observed data, and make no promise that it improves future outcomes.
