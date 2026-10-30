---
name: Vite preview cache isolation
description: Prevent an isolated dashboard E2E server from invalidating the live preview's optimized dependency cache.
---

The dashboard's responsive E2E test starts a second Vite server with different environment flags and plugins from the live artifact server. Each Vite server must use a separate `cacheDir`; sharing the default `node_modules/.vite` lets one process overwrite dependency metadata while the other still serves old chunk hashes. Browsers then receive `504 Outdated Optimize Dep` responses and render a blank page.

**Why:** The live dashboard retained an in-memory dependency hash after the E2E server rewrote the shared on-disk cache for its different Vite configuration.

**How to apply:** Give any test or auxiliary Vite server for this artifact its own cache directory. After cache-related changes, restart the managed web workflow once and verify a browser load has no stale dependency requests.
