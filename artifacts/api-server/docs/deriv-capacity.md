# Capacity targets and Deriv session capacity

## User target and peak-concurrency estimate

The confirmed planning target is **15,000 total registered users and 7,000 monthly active users (MAU)**. These are account and monthly-activity targets, not a measured simultaneous-user count.

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

The full external check is available as `pnpm --filter @workspace/api-server capacity:demo`. It requires four distinct dedicated secrets (`DERIV_DEMO_TEST_PAT_1` through `_4`) and `DERIV_APP_ID`. It lists demo accounts for all PATs and selects a distinct account for each before opening any test sockets; if four distinct demo accounts are unavailable, it exits without opening test sessions. Each staged session checks the account portfolio and aborts if there are open positions. It opens read-only sessions in stages of 1, 2, and 4, then closes them. It sends account, OTP, portfolio, profit-table, balance-subscription, and market-tick requests only. It does not request proposals or send buy/sell messages. PATs and account IDs are not printed. Never substitute `DERIV_API_TOKEN`.

When only one isolated demo account is available, `pnpm --filter @workspace/api-server capacity:demo:smoke` uses `DERIV_DEMO_TEST_PAT_1` to check one authenticated read-only session. This is a connectivity smoke test only; it does not validate 2- or 4-session Deriv capacity.

The development-only synthetic API/database probe is `pnpm --filter @workspace/api-server capacity:api-db`. It sends health-check requests through the local Replit proxy and `SELECT 1` through a PostgreSQL pool configured with the app's `DB_POOL_MAX` setting. It writes no database data and sends no Deriv requests. This is a plumbing probe only: the health endpoint does not exercise authenticated user routes or the API server's own database queries, so its latency is not an end-to-end application capacity result.

### Results to date

- Current synthetic API/database probe (2026-10-05): stages of 1, 70, 350, and 700 clients completed with zero health or database errors and zero Deriv requests. At 700, health-check p95 was 666.8 ms; `SELECT 1` p95 was 160.5 ms and the probe's 20-connection pool peaked at 258 waiters; runner RSS reached 252 MiB. These are development-only plumbing measurements, not authenticated-app or production capacity.
- Current workspace check (2026-10-05): no deployment is active, and no dedicated `DERIV_DEMO_TEST_PAT_1..4` secrets are configured. Therefore no external demo-socket test or production deployment load test was run for this verification pass. The older PAT/account result below describes a previous workspace state.
- The current development database reports `max_connections=112`. `DB_POOL_MAX` is unset, so each API process uses the code default of 20 connections. The development setting is not evidence of the production database's connection limit.
- Mocked 1/2/4-session API test passed; the fifth session was rejected and no trade messages were sent. The latest test-runner observation was 29/2/4 ms per stage and 156.4 MiB baseline RSS to 169.7 MiB at four mock sessions. These measurements are from the test runner, not production.
- One-account Deriv demo smoke passed with one authenticated session: 3.1 seconds mean session readiness, 13.1 seconds for connection and read-only setup, 138 ticks received, and RSS from 117.5 MiB baseline to 121.3 MiB. It sent no proposal, buy, or sell messages.
- The full external 1/2/4 probe was not run: all four configured PATs resolved to one distinct demo account. It exited before opening test sockets. The single-session smoke does not validate concurrent Deriv capacity.

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