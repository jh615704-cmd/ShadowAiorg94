---
name: Ambiguous trade transport failures
description: Safe handling when the browser loses a trading API response.
---

Treat a browser transport failure after a buy or sell request as an unknown outcome, not proof that the order failed. The server or Deriv may have accepted the action before the response was lost. Never automatically replay a trade mutation after a timeout or lost response; check Deriv account history and open-contract status before a manual retry. A buy may be retried only after Deriv explicitly rejects it with `RateLimit`, using a fresh proposal and bounded backoff. Safe reads may be retried once, and trade requests should carry a reference that can be matched to server logs.

**Why:** Blind retries can create duplicate positions or repeat a close after the contract has already changed state.

**How to apply:** Use this boundary in server buy helpers, the shared API transport layer, and every browser caller that submits or closes trades. Keep ambiguous outcomes distinct from definite provider rejections.