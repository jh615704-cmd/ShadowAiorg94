---
name: Auto Magic entry policy
description: User-selected Auto Trader rule for historical evidence, digit choice, and one-batch scan lifecycle.
---

Auto Magic selects one top-ranked eligible market per scan. It requires a historical Digit Differs rate strictly above 68% from at least 50 duration-matched expiry samples. The chosen barrier must be in the opposite half from the latest live digit and must not have appeared during the current scan. Send one selected 3× or 6× batch, wait for every acknowledged contract to settle, then require the user to press Rescan before another automatic batch. Take-profit and stop-loss are reminders/reference targets, not Auto Magic activation prerequisites. Historical rates do not guarantee future results.

**Why:** The user explicitly chose this strategy and the one-batch/manual-rescan lifecycle; a historical threshold must not be presented as a guaranteed outcome or trigger automatic retries.

**How to apply:** Keep candidate ranking, expiry-sample calculations, the Auto Magic controls, and its settlement/rearm state in sync. Preserve account/risk checks and require manual history review after an uncertain order result.
