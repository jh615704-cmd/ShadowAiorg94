---
name: Automation stop and retry policy
description: Cross-feature rules for continuous trading automation waits, retries, and safety holds.
---

Keep continuous trading automation active through recoverable waits such as unavailable durations, stale history, connection or balance refresh, missing signal evidence, and market changes. Stop for the user's explicit Stop action or the configured settled session profit/loss boundary. A confirmed no-contract rejection may be retried with clear status. An uncertain order, revoked access, or explicit account-protection rejection must remain a no-buy safety hold pending review; never replay it or close a contract automatically just to resume.

**Why:** The user asked that automation features other than Auto Trader 2.0 not stop for recoverable conditions, and that their runs stop only by manual choice or configured profit/loss limits.

**How to apply:** Keep each feature's run state active while safely waiting, make the wait visible, and retry only when the API confirms no contract was accepted. Preserve hard budget caps as no-order holds rather than converting them into automatic run stops.
