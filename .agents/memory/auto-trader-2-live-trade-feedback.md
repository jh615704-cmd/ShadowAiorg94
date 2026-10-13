---
name: Auto Trader 2 live trade feedback
description: User-visible trade freshness and settlement-waiting constraints for Auto Trader 2.
---

Auto Trader 2 trade history feedback is push-driven from Deriv contract updates. Do not reintroduce frequent history polling or a periodic settlement-refetch loop. Preserve the account-scoped reconnect snapshot and prevent new runs while the live feed is unavailable. Stop and unmount must cancel any settlement waiter.

**Why:** the user requested instant trade updates without constant polling and asked to catch delayed-feedback regressions before release.

**How to apply:** changes to trade display or Auto Trader 2 settlement should consume pushed events and keep service/client regression tests that cover open, live-update, and final-settlement states.
