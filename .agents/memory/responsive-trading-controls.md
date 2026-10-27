---
name: Responsive trading controls
description: Project-wide expectation for responsive trading panels and controls.
---

All trading features, including future ones, should work smoothly across old, current, and future devices at up to 4K. Trading panels and buttons must reflow for the viewport in use; controls should not disappear or become inaccessible. Every feature switch should give immediate visual feedback with a brief, consistent transition and a usable touch target. Feature scrolling should preserve native wheel/touch momentum, avoid trapping nested scroll areas, and allow horizontal panning for wide tables.

**Why:** The user explicitly asked that every feature work smoothly on any device, including old, new, and future devices, and at 4K.

**How to apply:** When adding or changing a trading panel, check phone, tablet, laptop, and 4K layouts; keep controls within their containers, preserve touch targets, use the shared short switch motion, respect reduced-motion settings, and keep user-driven scrolling native rather than forcing animated scroll behavior. Treat viewport checks as representative, not as proof of performance on every physical device. Trade requests still wait for required quotes and Deriv confirmation.
