---
name: Matches automation quality
description: User preference for Matches Analysis auto-entry filtering and control visibility.
---

Matches Analysis automation should let users choose the top one, two, or three digits before enabling its switch. Base automatic entries on settled Digit Match results for the selected account, market, and tick duration; keep quality filters internal and never promise future outcomes.

**Why:** The user asked to use settled outcomes at the chosen duration while keeping the strategy logic out of the visible setup.

**How to apply:** Preserve the explicit top-digit count selector and switch-style start/stop control. Exclude unsettled or mismatched history and avoid adding strategy-threshold controls.
