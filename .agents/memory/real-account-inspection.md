---
name: Real-account order routing
description: Selecting a real account routes trades there without per-feature confirmation checkboxes; server safeguards remain authoritative.
---

Selecting a real account routes feature orders directly to that account without an additional feature-level confirmation checkbox. Keep server live-trading permission, authenticated account binding, available-balance checks, open-contract and settlement checks, and existing risk guards authoritative for every order.

**Why:** The user asked that account selection be the only per-feature step for choosing real funds, while retaining server-side controls.

**How to apply:** Apply this to current and future features. Do not add per-feature live-funds checkboxes; continue to reject orders when server permission, account, balance, settlement, or risk checks fail.