---
name: Auto Trader 2 live trade feedback
description: User-visible trade freshness and settlement-waiting constraints for Auto Trader 2.
---

Auto Trader 2 trade history feedback is push-driven from Deriv contract updates. Keep the existing session-summary and trade-row display stable across transient or partial account-history snapshots; do not blank the run total when a snapshot omits a previously loaded feature contract. Do not reintroduce frequent history polling or a periodic settlement-refetch loop. Preserve the account-scoped reconnect snapshot and prevent new runs while the live feed is unavailable. Stop and unmount must cancel any settlement waiter.

**Why:** the user requested instant trade updates without constant polling and asked to catch delayed-feedback regressions before release.

**How to apply:** Changes to trade display or Auto Trader 2 settlement should consume pushed events, preserve known feature rows when snapshots are incomplete, and keep service/client regression tests that cover open, live-update, and final-settlement states.

Auto Trader 2 continues after each settled contract until the user presses Stop, settled session P/L reaches the configured Loss Limit, or it reaches the Profit Target. Zero disables either threshold. With AI 2 disabled, the selected setup still repeats; automatic Rise/Fall and Even/Odd choices compare observed expiry rates, while Differs Auto chooses the least frequent recent digit. AI 2 can still require its stricter evidence filter.

**Why:** On October 22, 2026, the user clarified that Auto Trader 2.0 must not end after a single manual-mode contract and must stop at either the selected loss or profit boundary, as well as the Stop button.

**How to apply:** Keep settlement waiting abortable and event-driven, remove arbitrary run caps, evaluate realized P/L before each next entry, and do not mark confirmed rejections as completed sessions. Never resend an order whose Deriv outcome is uncertain; keep necessary account, connection, and order-review safety holds.
