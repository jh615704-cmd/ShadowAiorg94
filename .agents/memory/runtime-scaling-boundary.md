---
name: Runtime scaling boundary
description: The infrastructure boundary for the high-concurrency Deriv runtime.
---

The current Starter-tier product target is 15,000 total users and 7,000 monthly active users. These are account/MAU targets, not a claim that one Node process can serve 7,000 simultaneous personalized Deriv WebSocket sessions. The older 900,000-active-session figure is a separate longer-range target.

**Why:** The user specified 15,000 total users and 7,000 monthly active users as the current Starter-tier target. Each simultaneously connected Deriv session also has user-specific credentials and live state, so its connection, memory, upstream subscription, and browser-update costs must be measured separately.

**How to apply:** Keep account count, monthly active users, and simultaneous Deriv sessions distinct in capacity discussions. Benchmark expected concurrent API/WebSocket load with isolated demo sessions before claiming capacity; multiple API instances require runtime coordination and per-instance database pool sizing.