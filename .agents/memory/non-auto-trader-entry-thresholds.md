---
name: Non-Auto-Trader entry thresholds
description: Keep non-Auto-Trader signal-entry floors at the user's requested 50%.
---

Use a 50% minimum observed-rate threshold for percentage-based automated entry scanners across Clock Work, Cash Grab, Bulk Trader, DigitFlip, Trade X, and EDGE. Auto Trader and Auto Trader 2.0 are explicitly excluded. Money Bank's current entry filter is knockout-count based, not a percentage-rate gate; do not replace that mechanism with a new probability filter. Preserve sample-size requirements, account and loss protections, duplicate-order locks, and uncertain-order safeguards. Manual user-selected orders should not be silently blocked by automated scanner thresholds.

**Why:** The user requested that the seven other trading features use a 50% signal threshold instead of the higher floors, while leaving both Auto Trader features unchanged.

**How to apply:** Change percent-based candidate floors to 50% inclusively; do not reduce evidence minimums or risk controls, and do not edit either Auto Trader implementation.
