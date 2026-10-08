---
name: Access feature registry
description: Access-controlled dashboard features must stay synchronized across runtime validation, API schemas, generated clients, and admin controls.
---

Keep every access-controlled feature in one synchronized registry across the API server, OpenAPI schema, generated client types, route middleware, and administrator feature picker.

**Why:** A hand-maintained administrator list omitted an existing feature, while schema/runtime drift can make access keys reject otherwise valid values.

**How to apply:** Derive the administrator picker and server accepted values from generated `AccessFeature` values rather than duplicate lists. When adding or renaming a feature, update the OpenAPI enum and its route/UI gates together, then regenerate clients before type-checking dependent artifacts.

History polling should be enabled for users with any trading feature, even when their access key does not separately grant the optional history feature.

**Why:** The API grants trading-feature users access to their own trade history; a narrower UI gate leaves those users without a cached history feed.

**How to apply:** Keep the frontend history-query gate aligned with the API route guard and the trading-feature registry.