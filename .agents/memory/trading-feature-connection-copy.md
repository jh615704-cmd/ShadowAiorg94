---
name: Trading feature connection copy
description: Avoid repeating Deriv PAT setup instructions in newly added trading features.
---

Keep PAT setup instructions in the shared account-connection flow. New trading feature pages should use existing connection and account state without adding another PAT prompt or repeating credential instructions beneath the feature.

**Why:** The user asked not to repeat the PAT connection wording beneath new bot features.

**How to apply:** When adding trading features, show the connection/account status needed for the flow, but do not copy credential-setup guidance into the feature panel or its guide.
