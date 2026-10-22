---
name: Responsive trading controls
description: Project-wide expectation for responsive trading panels and controls.
---

Trading panels and buttons must reflow for the device and viewport in use; controls should not disappear or become inaccessible on laptops or smaller screens. Every feature switch should give immediate visual feedback with a brief, consistent transition and a usable touch target. Feature scrolling should preserve native wheel/touch momentum, avoid trapping nested scroll areas, and allow horizontal panning for wide tables. Apply these behaviors to future trading features too.

**Why:** The user explicitly asked that every feature's controls and scrolling feel effortless, quick, and consistent across the bot.

**How to apply:** When adding or changing a trading panel, check desktop/laptop and phone layouts, keep controls within their containers, preserve touch targets, use the shared short switch motion, respect reduced-motion settings, and keep user-driven scrolling native rather than forcing animated scroll behavior. Trade requests still wait for required quotes and Deriv confirmation.
