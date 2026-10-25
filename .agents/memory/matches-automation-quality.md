---
name: Matches automation quality
description: User preference for Matches Analysis auto-entry filtering and control visibility.
---

Matches Analysis automation should let users choose the top one, two, or three digits before enabling its switch. Base automatic entries on settled Digit Match results for the selected account, market, and tick duration; keep quality filters internal and never promise future outcomes.

**Why:** The user asked to use settled outcomes at the chosen duration while keeping the strategy logic out of the visible setup.

**How to apply:** Preserve the explicit top-digit count selector and switch-style start/stop control. Exclude unsettled or mismatched history and avoid adding strategy-threshold controls.

Matches Analysis also has a distinct A · Auto digit mode and an optional AI Auto market selector. AI Auto compares qualified settled results across configured Volatility and Jump markets, and may change the market only between contracts. A running session stops when its settled session P/L reaches an enabled profit target or loss limit, or when the user stops it; open contracts are allowed to settle.

**Why:** On October 25, 2026, the user requested market-selected digits distinguished from manual picks, cross-family market selection that never changes during a trade, and continuous session limits.

**How to apply:** Keep market selection separate from digit Auto mode, require fresh ticks after a market switch, use only settled account/market/duration-matched results, and treat limits as stops for future entries rather than early contract closes.
