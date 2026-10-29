---
name: Money Bank JDY gate
description: Durable behavior for the Money Bank JDY pre-entry safety scan.
---

JDY must stay quiet while enabled but idle, scan only after Start Accumulator begins, and block the contract unless the selected market, growth, ticks, and stake pass the safety heuristic. Entry approval requires at least 20 recent samples and a tick no more than five seconds old; Accumulator scoring uses the observed rise rate, not the stronger of rise and fall. Only alternatives that pass the same gate may be suggested. It rescans after settlement; suggestions remain advisory. When JDY is active, auto-switch must not replace the selected market between evaluation and entry.

**Why:** Automatically replacing the user’s selected setup made the displayed controls disagree with the contract that JDY evaluated and removed the user’s opportunity to review the recommendation. Small samples, stale ticks, and scoring with the opposite market direction can also authorize an entry using evidence that does not support the selected Accumulator.

**How to apply:** Keep the pre-entry scan as the only market-signal gate before buying. Fail closed when the selected signal is stale, undersampled, or invalid. Never silently mutate Money Bank settings from a JDY result; an explicit user action may apply a safe suggested setup before the user starts again. Keep Auto Knockout’s 10-second countdown informational and non-blocking.