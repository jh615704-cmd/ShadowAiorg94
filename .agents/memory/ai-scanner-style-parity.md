---
name: AI Scanner visual parity
description: Keep AI Scanner controls visually consistent across trading features.
---

Use the shared AI Scanner component with its default presentation across trading features. Avoid feature-specific switch overrides, and scope a panel's form-label rules to only its own direct field labels so they do not change the nested scanner control.

**Why:** Bulk Trader's custom style diverged from DigitFlip, and a broad label selector changed the shared switch layout even after that custom styling was removed.

**How to apply:** When a feature should match another feature's scanner, reuse the same component and compare computed switch and track styles in the browser. Check parent selectors for unintended effects on nested labels.
