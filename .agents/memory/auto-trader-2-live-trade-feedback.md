---
name: Auto Trader 2 live trade feedback
description: User-visible trade freshness and settlement-waiting constraints for Auto Trader 2.
---

Auto Trader 2 trade history feedback is push-driven from Deriv contract updates. Keep the existing session-summary and trade-row display stable across transient or partial account-history snapshots; do not blank the run total when a snapshot omits a previously loaded feature contract. Do not reintroduce frequent history polling or a periodic settlement-refetch loop. Preserve the account-scoped reconnect snapshot and prevent new runs while the live feed is unavailable. Stop and unmount must cancel any settlement waiter.

**Why:** the user requested instant trade updates without constant polling and asked to catch delayed-feedback regressions before release.

**How to apply:** Changes to trade display or Auto Trader 2 settlement should consume pushed events, preserve known feature rows when snapshots are incomplete, and keep service/client regression tests that cover open, live-update, and final-settlement states.

Auto Trader 2 has no fixed trade-count or take-profit stop; it continues until the user stops it or the configured loss limit is reached, while unresolved order submissions remain in manual-review safety state.

**Why:** The user wants sessions to continue past seven trades without mistaking an empty pending state for a real open contract, but duplicate buys must still be prevented.

**How to apply:** Keep settlement waiting abortable and event-driven, remove arbitrary run caps, and never resend an order whose Deriv outcome is uncertain.
