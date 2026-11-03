---
name: Deriv read concurrency
description: The concurrency rule for keeping live trade results responsive while preserving serialized per-user mutations.
---

Live status, account, and history reads should stay outside the per-user mutation lock. Buy, credential, account-selection, and symbol-selection operations remain serialized.

**Why:** High-frequency reads can delay buy acknowledgements. Repeated portfolio polling can also trigger Deriv rate limits that reject buys, while string contract IDs cause `proposal_open_contract` validation failures.

**How to apply:** When adding a Deriv route, classify it as a read or mutation. Use the non-serialized credential path for safe reads and keep state-changing operations on the stable per-user lock. For settlement recovery, send `proposal_open_contract` with a numeric contract ID for tracked open rows; do not run periodic full-portfolio polls. Never let a delayed open update revert a confirmed settlement.

DigitFlip and other trade entry paths must not depend on a successful history request. Use cached rows for strategy context and submit buys through the normal API path when history is stale or unavailable; the server's serialized active-contract check remains authoritative.

**Why:** A history outage should not suppress a valid buy or make an acknowledged buy appear to have failed, while stale client history must not authorize overlapping contracts.

**How to apply:** Treat history freshness separately from buy success. Preserve server-side open-contract, account-balance, and live-trading safeguards; post-buy automation may pause if it cannot confirm settlement.

When Deriv rate-limits `profit_table`, return cached history and back off before retrying; repeated UI polling must not become a retry storm or make all feature histories appear blank.

After Deriv acknowledges a buy, claim its returned contract IDs locally and start one non-cancelling refresh for active status, history, and account queries. Do not keep the action locked while repeatedly polling for the history row or schedule a second near-immediate refresh.

**Why:** Delayed duplicate refetches can cancel in-flight polls and create visible update bursts, while waiting for history to catch up makes an already-confirmed order feel delayed.

**How to apply:** Keep the server's portfolio, balance, authorization, and settlement safeguards authoritative; make the browser responsive to the buy acknowledgement, then let one refresh and normal polling reconcile the full history row.

For Jackpot, once an open-contract state has been observed and Deriv confirms the account has no open contracts, trigger one non-cancelling history-only refresh so the Place button does not wait for the next regular history poll. Keep the batch locked until settlement rows are confirmed; do not add repeated portfolio polling or a retry loop.

**Why:** The normal history interval can add unnecessary delay after Deriv has already confirmed settlement. A single event-driven history refresh shortens that UI wait without weakening account-level overlap protection.

**How to apply:** Track the transition from blocked to confirmed clear status for a pending Jackpot batch, refresh only history once, and keep the contract IDs until all settlement rows are present and closed.

The entry-admission portfolio snapshot is a deliberate exception to ordinary read concurrency: correlate every request, keep `openContractsReady` false until Deriv returns a valid contracts array, and retry only this safe read with bounded backoff after an error or timeout. Keep the snapshot inside the serialized per-user buy path; never interpret a malformed response as an empty portfolio or replay a buy.

**Why:** The initial uncorrelated portfolio request could fail without notifying readiness, leaving every feature paused indefinitely. Treating an invalid response as an empty portfolio could instead authorize overlapping trades.

**How to apply:** Correlate socket-connect and entry-admission checks with `req_id`; preserve the closed trade gate on timeout, error, malformed data, account switch, and reconnect. Retries may request portfolio state only; they must never resend an uncertain trade.