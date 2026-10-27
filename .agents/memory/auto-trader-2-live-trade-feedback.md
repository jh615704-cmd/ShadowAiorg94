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

When Deriv explicitly rejects a contract as unavailable for the selected duration and confirms that no contract was accepted, keep the automated feature active and check again with clear status copy. In Auto Trader history, keep an open contract visually neutral; show green or red only after Deriv confirms settlement and supplies the realized result.

**Why:** The user asked that unavailable-duration rejections not stop trading automation and that Auto Trader show a clear win/loss result after an open trade updates.

**How to apply:** Retry only explicit, confirmed no-contract rejections. Preserve pauses for uncertain outcomes, unsettled contracts, and connection or access failures; derive wins and losses from settled Deriv history, not a provisional open label or floating P/L.

For Rise/Fall and Even/Odd, manual A · Auto is exclusive of the manual-side buttons and selects the eligible side with the highest full-precision observed expiry win rate. Display rounding must not affect selection. If AI 2 is enabled, apply its evidence filter first, then rank qualifying Auto candidates by observed win rate; preserve the required opposite-side rule after an AI 2 loss.

**Why:** The user clarified that Auto must not appear selected alongside a manual side and must choose the best observed win-rate side for either contract family.

**How to apply:** Keep the Auto and manual choices mutually exclusive in both appearance and accessibility state. Compare only eligible samples for the selected duration and market scope, wait when sample requirements are unmet, and use unrounded rates for ranking while rounding only displayed values.
