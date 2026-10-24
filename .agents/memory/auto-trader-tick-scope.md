---
name: Auto Trader tick scope
description: User-defined scope and reliability expectations for 1–5 tick responsiveness changes.
---

The user explicitly limits improvements to 1–5 tick responsiveness to Auto Trader only; do not change Auto Trader 2.0 or other trading features for this concern.

**Why:** Shared timing changes can affect other trade flows, and changing the selected duration would not preserve the user's requested Deriv contract.

**How to apply:** Keep future tick-display tuning feature-specific, pass the chosen duration to Deriv unchanged, and explain that actual market tick and settlement cadence is controlled by Deriv.
