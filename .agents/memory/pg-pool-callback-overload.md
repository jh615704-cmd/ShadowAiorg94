---
name: PostgreSQL pool callback overload
description: Preserve node-postgres connection acquisition overloads when instrumenting a pool.
---

When wrapping `pg.Pool.connect`, preserve both its promise-returning form and its callback form. `pool.query()` internally uses callback-style `connect()`; ignoring that callback can leave route queries hanging and cause checked-out clients or pending requests to linger.

**Why:** The capacity probe's promise-only wrapper broke the real access-login route's `db.select()` calls. That surfaced as request timeouts and pool errors even though direct database queries and a separate one-user flow worked.

**How to apply:** Any pool-acquisition measurement must forward the original callback's error, client, and release function. Exercise both `db.select()` and `db.transaction()` while the measurement is enabled.
