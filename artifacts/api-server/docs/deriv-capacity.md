# Capacity targets and Deriv session capacity

## Account/MAU targets (planning, not a guarantee)

The confirmed planning target is **15,000 total registered users and 7,000 monthly active users (MAU)**. These are account and monthly-activity targets, not a measured simultaneous-user count.

The targets cannot be presented as a capacity guarantee until the published deployment is tested with representative registration, authenticated dashboard, and database workloads. Demo PATs are not needed for account-count or MAU estimates; they are needed only for the separate external Deriv WebSocket concurrency probe.

No production traffic or time-of-day usage telemetry is available yet. Until it is, use these explicit planning scenarios rather than promising a single concurrency figure:

| Peak active share of 7,000 MAU | Concurrent app users | Possible Deriv sockets if all are connected to a trading screen |
| --- | ---: | ---: |
| 1% low case | 70 | 70 |
| 5% planning case | 350 | 350 |
| 10% stress case | 700 | 700 |

Estimate one authenticated Deriv Options WebSocket per user actively using a trading screen. Users who are signed in but not actively trading need not hold one. These are workload scenarios, not observed usage. Replace them with measured 5-minute peak concurrency and active-socket telemetry before making a support commitment.

Replit's Starter documentation does not publish a numeric concurrent-user guarantee. The project is **not currently published**, so a deployment-size or production-capacity claim cannot be verified from this workspace.

## Verified runtime boundary

The API allows up to **four Deriv-enabled user runtimes per Node process**. A fifth distinct user receives HTTP `503` with a retry-later message. The limit is per process, not per deployment, and idle runtimes are normally reclaimed after 30 minutes.

The automated fake-WebSocket test verifies this four-session process limit without contacting Deriv. This is a code-level boundary, not a measured four-user production capacity. Runtime ownership, selected account, quote state, and trade coordination are in process memory. Multiple API instances do not share that state: requests for one user can reach different processes, while every process may open its own Deriv connection. Do not scale the API horizontally until user-runtime ownership and routing are shared and multi-instance behavior is tested.

## Rate-budget estimate

The dashboard polls Deriv status every 500 ms in its active trading screen. The server refreshes the selected account through REST at most once every two seconds, so that path is approximately 30 Deriv REST requests per active user per minute. The active X Trader screen refreshes account lists every ten seconds; the legacy app screen refreshes them every five seconds. Using the more conservative 12 account-list requests per minute gives an estimate of 42 Deriv REST requests per user per minute. At four active sessions, the estimate is 168 requests per minute from this app, or 56% of Deriv's documented 300 requests per IP per minute. The estimated 42 requests per user per minute is below the documented 80 requests per logged-in user per minute.

This estimate excludes bursts from initial connections, retries, account changes, other apps sharing the same egress IP, and changes to polling behavior. It is an upstream request-budget calculation, not a CPU, memory, or end-to-end performance guarantee.

## Verification

**Never load-test with live accounts or live trades.** The external probe is restricted to isolated demo accounts and read-only requests; it never sends proposals, buys, or sells.

`pnpm --filter @workspace/api-server test` includes staged 1-, 2-, and 4-session tests using mocked REST and WebSockets. It verifies the fifth session is rejected, established sessions remain open, and no buy or sell messages are sent. Those tests do not contact Deriv and do not establish demo-service or deployment capacity.

The app/database capacity workload is `pnpm --filter @workspace/api-server capacity:app-flow`. It requires the explicit opt-in `CAPACITY_FIXTURE_MODE=development`, refuses `NODE_ENV=production`, and creates temporary synthetic access-key records in the workspace development database. It exercises the real Express routes `POST /api/access/login`, `GET /api/access/session`, `POST /api/access/heartbeat`, and `POST /api/access/logout`. It creates at least 15,000 stored user access keys in total and exercises 7,000 distinct synthetic users. The staged runs allow up to 1, 70, and 350 concurrent user-flow tasks; because login arrivals are spread over eight seconds and the normal session hold is three seconds, actual overlapping authorized sessions are reported separately. The peak stage establishes 700 simultaneously authorized app sessions in two sequential setup waves of 350. After both waves, all sessions remain active for at least three seconds while heartbeat and logout actions are staggered over eight seconds. The remaining MAU cohort is processed at up to 350 concurrent user-flow tasks. This is an active app-session target, not 7,000 concurrent users. No Deriv API calls, WebSockets, PAT credentials, proposals, or trades are used or requested by this app-flow workload.

The probe reports per-route latency and errors, per-stage database-pool acquisition delay and sampled waiters, API-plus-load-generator process memory/CPU/event-loop delay, and the detected cgroup CPU/memory limits. The real application routes and database pool are used, but the API server and generator share one local process and bypass the Replit proxy, browser, deployment autoscaling, and production database. Treat this as development workload evidence, not a published deployment capacity guarantee. The target account count is measured as non-deleted `access_keys` rows with `kind=user`; it is not a count of Clerk identities.

Fixture rows are tagged with a random run UUID, removed automatically on success or error, and their child session rows are removed by the schema's cascade. If the process is forcibly stopped, the run UUID is printed before inserting fixtures; clean only that run with `CAPACITY_FIXTURE_MODE=development pnpm --filter @workspace/api-server capacity:app-flow -- --cleanup-run-id <printed-uuid>`. The cleanup command validates the UUID and deletes only rows with that run's synthetic fixture label.

The optional external connectivity smoke test is separate: `pnpm --filter @workspace/api-server capacity:demo:smoke` uses one dedicated demo PAT (`DERIV_DEMO_TEST_PAT_1`) and `DERIV_APP_ID` for one authenticated read-only Deriv session. It is not needed for the app-flow load test and does not validate concurrent Deriv capacity.

The development-only synthetic API/database probe is `pnpm --filter @workspace/api-server capacity:api-db`. It sends health-check requests through the local Replit proxy and `SELECT 1` through a PostgreSQL pool configured with the app's `DB_POOL_MAX` setting. It writes no database data and sends no Deriv requests. This is a plumbing probe only: the health endpoint does not exercise authenticated user workload, API-session database queries, or dashboard database reads/writes.

### Results to date

- Earlier health/`SELECT 1`-only probe (2026-10-05): stages of 1, 70, 350, and 700 clients completed with zero health or database errors and zero Deriv requests. At 700, health-check p95 was 666.8 ms; `SELECT 1` p95 was 160.5 ms and the probe's 20-connection pool peaked at 258 waiters; runner RSS reached 252 MiB. These are development-only plumbing measurements, not authenticated-app or production capacity.
- Synthetic app-flow run (2026-10-05): started with 0 registered access-key users, inserted 15,000 synthetic users, and completed the real login/session/heartbeat/logout flow for 7,000 distinct users: 28,000 endpoint requests, 0 errors, 0 failed flows, and 700 peak simultaneously authorized app sessions. Observed active-session peaks were 1, 27, 139, 700, and 141 across the one-user, 70-flow, 350-flow, 700-session peak, and remaining 5,879-user stages. Automatic cleanup removed all 15,000 fixture users and left 0 sessions; the registered-user count returned to baseline. No Deriv requests, PAT credentials, or trade messages were used.
- At the 700-session peak, route p95/p99 latency was login 10.0/65.9 ms, session read 3.3/5.2 ms, heartbeat 633.4/868.1 ms, and logout 259.0/704.1 ms; every route had 0 errors. The 20-connection pool reached 98 waiters (109 samples with waiters); acquisition delay was p95 22.9 ms, p99 319.1 ms, max 467.8 ms. The API and load generator shared one process: peak RSS 440 MiB, heap 222.5 MiB, event-loop-delay p99 21.4 ms, 51.4 seconds CPU user time and 11.9 seconds system time, with a detected 4-core / 8,192 MiB cgroup limit. This remains development-only evidence, not a published deployment or Deriv capacity guarantee.
- The workspace does not have a published deployment measurement. The app-flow probe runs the actual Express routes and workspace development database locally; it is not evidence for production scale or Deriv session capacity.
- The current development database reports `max_connections=112`. `DB_POOL_MAX` is unset, so each API process uses the code default of 20 connections. The development setting is not evidence of the production database's connection limit.
- Mocked 1/2/4-session API test passed; the fifth session was rejected and no trade messages were sent. The latest test-runner observation was 29/2/4 ms per stage and 156.4 MiB baseline RSS to 169.7 MiB at four mock sessions. These measurements are from the test runner, not production.
- Current one-session Deriv demo smoke (2026-10-05) passed with one authenticated read-only session: 1.8 seconds mean session readiness, 11.8 seconds for the stage including its hold period, 156 ticks received, and RSS from 94.4 MiB baseline to 99 MiB. It sent no proposal, buy, or sell messages. This does not validate concurrent Deriv capacity.

## Sources and assumptions

- Deriv API limits: <https://developers.deriv.com/docs/limits/>
- Deriv API best practices: <https://developers.deriv.com/docs/best-practices/>
- Deriv authenticated Options WebSocket: the API first loads accounts, requests an account OTP, then connects to the returned authenticated WebSocket URL.
- Replit Autoscale may run more than one machine; per-process runtime state is not shared between replicas. See <https://docs.replit.com/features/publishing/deployment-types> and <https://docs.replit.com/features/publishing/machine-configuration>
- The API PostgreSQL pool cap is per process: `max(5, min(100, DB_POOL_MAX ?? 20))`. For `N` API processes, the theoretical application ceiling is `N × DB_POOL_MAX`, before other clients and maintenance connections. Set the per-process pool from the production database's verified limit and the deployment's maximum replica count; keep headroom rather than configuring every connection for the application.
- With the current development value of 112 database connections and a default pool of 20, four API processes could consume up to 80 connections before other clients. This is arithmetic for the development setting, not a recommended or guaranteed production replica count.
- The numerical request estimate reflects the current dashboard polling intervals and server-side two-second account-refresh throttle. Revisit this document if either changes.

## Pool sizing and upgrade triggers

- The 70-socket low case already exceeds the four-session limit of one API process. Do not claim the 70/350/700 trading-session scenarios until the per-process limit and process-local session ownership have been addressed and the staged demo test passes.
- Before increasing the four-runtime process cap, run the staged demo-only socket probe with distinct dedicated demo accounts, then test API memory, CPU, event-loop delay, reconnects, and database pool wait time at the same stage.
- For database sizing, reserve connections for administration, migrations, and other services. Use `floor((verified database connection limit - reserved connections) / maximum API processes)` as the per-process pool ceiling, then set `DB_POOL_MAX` accordingly. Do not copy the development database's 112 limit into a production promise.
- Treat any capacity `503`, sustained PostgreSQL pool waiters, rising p95/p99 API latency, memory pressure, Deriv rate-limit responses, or loss of session ownership as an upgrade trigger. Measure a published deployment before increasing the concurrency commitment.
- Supporting hundreds of concurrent Deriv sessions requires revisiting the four-runtime cap, adding shared runtime ownership/routing, and verifying deployment and Deriv limits. Increasing Replit compute alone does not make process-local sockets or state safe across instances.