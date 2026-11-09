---
name: Auto Magic entry policy
description: User-selected Auto Trader rule for historical evidence, digit choice, and one-batch scan lifecycle.
---

Auto Magic selects one top-ranked eligible market per scan. It requires a historical Digit Differs rate strictly above 68% from at least 50 duration-matched expiry samples. The chosen barrier must be in the opposite half from the latest live digit and must not have appeared during the current scan. Choose three contracts below an 80% observed rate and six at or above 80%; do not expose this sizing choice in the UI. Enable Auto Magic, then use Go Live or Rescan to arm one batch. Wait for every acknowledged contract to settle, then require the user to press Rescan before another automatic batch. Take-profit and stop-loss are reminders/reference targets, not Auto Magic activation prerequisites. Historical rates do not guarantee future results.

**Why:** The user asked for a single Auto Magic switch with batch size selected internally from observed evidence. An 80% tier is used as the higher-rate cutoff for the larger batch; historical rates must not be presented as guarantees or trigger automatic retries.

**How to apply:** Keep candidate ranking, expiry-sample calculations, the hidden 80% size tier, the single-switch UI, and the settlement/rearm state in sync. Preserve account/risk checks and require manual history review after an uncertain order result.
