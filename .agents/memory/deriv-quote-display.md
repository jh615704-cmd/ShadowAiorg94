---
name: Deriv quote display
description: Fixed visual formatting for live quote values in selected trading features.
---

Cash Grab, DigitFlip, and EDGE live quotes should use a decimal point, at least four integer digits (left-padded with zeros when needed), exactly two fractional digits, and no thousands separators.

**Why:** The user specified the `1204.11` style shown in their reference image.

**How to apply:** Use this formatting only for live quote values in those three features; do not change stake, session P/L, percentages, or history formatting.
