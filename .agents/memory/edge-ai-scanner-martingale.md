---
name: EDGE AI Scanner Martingale
description: Dedicated stake progression controls for one-shot EDGE AI Scanner trades.
---

Keep EDGE AI Scanner Martingale opt-in with its own multiplier instead of silently reusing the regular EDGE strategy setting. Use settled, claimed EDGE history to calculate the scanner's next amount; multiply after a loss and reset to the normal stake after a win. Check the calculated amount against the fresh account balance and use the same amount for duration availability and the order. Never imply the progression guarantees recovery.

**Why:** The user asked for a separate Martingale area for EDGE's AI Scanner. Martingale can increase losses and must remain an explicit choice.

**How to apply:** Preserve the regular EDGE Run strategy controls independently. When changing scanner stake progression, keep the displayed next stake, duration quote, balance check, and submitted order amount in sync.
