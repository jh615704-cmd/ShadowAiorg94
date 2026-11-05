---
name: Non-Auto-Trader entry thresholds
description: Keep non-Auto-Trader signal-entry floors at the user's requested 50%.
---

Use a 50% minimum observed-rate threshold for percentage-based automated entry scanners across Cash Grab, Bulk Trader, DigitFlip, Trade X, and EDGE. Jackpot and Clock Work use their separate 58%/six-sample policies. Auto Trader and Auto Trader 2.0 are explicitly excluded. Money Bank's current entry filter is knockout-count based, not a percentage-rate gate; do not replace that mechanism with a new probability filter. Preserve sample-size requirements, account and loss protections, duplicate-order locks, and uncertain-order safeguards. Manual user-selected orders should not be silently blocked by automated scanner thresholds except where a feature has an explicit entry-evidence gate.

**Why:** The 50% threshold applies to the listed features only; the user separately set Jackpot and Clock Work to 58% with six samples.

**How to apply:** Change percent-based candidate floors to 50% inclusively only for the listed features; preserve each feature's sample and safety controls and do not edit either Auto Trader implementation.
