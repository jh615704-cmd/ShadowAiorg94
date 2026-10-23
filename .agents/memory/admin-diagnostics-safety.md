---
name: Admin diagnostics safety
description: Product boundaries for private, non-AI diagnostics and trading recovery.
---

Admin diagnostics are deterministic, visible only to administrators, and may poll sanitized health reports every five seconds without changing user sessions or trade state.

**Why:** The user explicitly requested non-AI diagnostics that do not disrupt trades or other users.

**How to apply:** Never automatically retry, clear, close, or otherwise alter an uncertain Deriv order or saved trading session. Offer a one-click repair only when that specific operation is verified safe and cannot affect trades or another user's browser; otherwise provide the manual review step.
