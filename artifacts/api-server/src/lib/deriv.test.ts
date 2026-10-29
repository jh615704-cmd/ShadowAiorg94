import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";

process.env.DERIV_APP_ID = "test-app";
process.env.DERIV_SYMBOL = "R_75";
process.env.DERIV_CURRENCY = "USD";
process.env.DERIV_ALLOW_LIVE_TRADING = "true";

type SocketMessage = Record<string, any>;
type BuyBehavior = "ack" | "reject" | "disconnect" | "invalid-proposal-id";

let buyBehavior: BuyBehavior = "ack";
let rateLimitFailuresRemaining = 0;
let rejectBuyResponsesRemaining = 0;
let portfolioErrorsRemaining = 0;
let malformedPortfolioResponsesRemaining = 0;
let portfolioResponseDelayMs = 0;
let proposalNumber = 0;
let proposalPayoutOverride: number | null = null;
let buyPayoutOverride: number | null = null;
let mockProfitTableRateLimited = false;
const sockets: FakeWebSocket[] = [];
const testUserIds = new Set<string>();
let mockPortfolioContracts: SocketMessage[] = [];
let mockProfitTableTransactions: SocketMessage[] = [];
const mockOpenContractResponses = new Map<string, SocketMessage>();
const buySendCountsAtAck: number[] = [];

class FakeWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly sent: SocketMessage[] = [];
  readyState = FakeWebSocket.CONNECTING;

  constructor(url: string) {
    super();
    this.url = url;
    sockets.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open");
    });
  }

  send(raw: string) {
    const message = JSON.parse(raw) as SocketMessage;
    this.sent.push(message);
    queueMicrotask(() => handleClientMessage(this, message));
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSING;
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.CLOSED;
      this.emit("close");
    });
  }
}

mock.module("ws", {
  defaultExport: FakeWebSocket,
});

mock.module("./trading-protection", {
  namedExports: {
    assertTradingProtection: () => {},
    getTradingProtectionSettings: async () => ({
      weekdaysEnabled: false,
      weekendsEnabled: false,
      dualWeekendsWeekdaysEnabled: false,
    }),
  },
});

const deriv = await import("./deriv.ts");

test("trade failure diagnostics distinguish app, transport, Deriv, and unverified outcomes", () => {
  assert.deepEqual(
    deriv.classifyBuyFailure(new Error("WebSocket is not ready")),
    { outcome: "not_sent", source: "transport" },
  );
  assert.deepEqual(
    deriv.classifyBuyFailure(new Error("The buy acknowledgement did not arrive")),
    { outcome: "uncertain", source: "unknown" },
  );
  assert.deepEqual(
    deriv.classifyBuyFailure({ code: "DERIV_BUY_RATE_LIMITED" }),
    { outcome: "rejected", source: "deriv" },
  );
  const annotatedFailure = Object.assign(new Error("A previous batch was partly accepted."), {
    tradeOutcome: "uncertain",
    diagnosticSource: "deriv",
  });
  assert.deepEqual(deriv.classifyBuyFailure(annotatedFailure), {
    outcome: "uncertain",
    source: "deriv",
  });
  assert.equal(deriv.getTradeErrorSource(annotatedFailure), "deriv");
});

function emitMessage(socket: FakeWebSocket, message: SocketMessage) {
  if (
    message.msg_type === "proposal_open_contract"
    && (message.proposal_open_contract?.is_sold === 1 || message.proposal_open_contract?.is_sold === true)
  ) {
    mockPortfolioContracts = mockPortfolioContracts.filter(
      (contract) => contract.contract_id !== String(message.proposal_open_contract.contract_id),
    );
  }
  socket.emit("message", Buffer.from(JSON.stringify(message)));
}

function handleClientMessage(socket: FakeWebSocket, message: SocketMessage) {
  if (message.portfolio) {
    if (portfolioErrorsRemaining > 0) {
      portfolioErrorsRemaining -= 1;
      emitMessage(socket, {
        error: { code: "RateLimit", message: "portfolio check temporarily unavailable" },
        ...(message.req_id == null ? {} : { req_id: message.req_id }),
        echo_req: { req_id: message.req_id, portfolio: 1 },
      });
      return;
    }
    if (malformedPortfolioResponsesRemaining > 0) {
      malformedPortfolioResponsesRemaining -= 1;
      emitMessage(socket, {
        msg_type: "portfolio",
        portfolio: {},
        ...(message.req_id == null ? {} : { req_id: message.req_id }),
        echo_req: { req_id: message.req_id, portfolio: 1 },
      });
      return;
    }
    const portfolioResponse = {
      msg_type: "portfolio",
      ...(message.req_id == null ? {} : { req_id: message.req_id }),
      portfolio: { contracts: mockPortfolioContracts },
    };
    if (portfolioResponseDelayMs > 0) {
      const delayMs = portfolioResponseDelayMs;
      portfolioResponseDelayMs = 0;
      setTimeout(() => emitMessage(socket, portfolioResponse), delayMs);
    } else {
      emitMessage(socket, portfolioResponse);
    }
    return;
  }

  if (message.profit_table) {
    if (mockProfitTableRateLimited) {
      emitMessage(socket, {
        error: { code: "RateLimit", message: "You have reached the rate limit for profit_table." },
        ...(message.req_id == null ? {} : { req_id: message.req_id }),
        echo_req: { req_id: message.req_id, profit_table: 1 },
      });
    } else {
      emitMessage(socket, {
        msg_type: "profit_table",
        ...(message.req_id == null ? {} : { req_id: message.req_id }),
        profit_table: { transactions: mockProfitTableTransactions },
      });
    }
    return;
  }

  if (message.proposal) {
    proposalNumber += 1;
    const proposalId = `proposal-${proposalNumber}`;
    if (proposalNumber === 1) {
      emitMessage(socket, {
        msg_type: "proposal",
        proposal: {
          id: "stale-proposal",
          ask_price: 99,
          payout: 999,
          spot: 1,
        },
      });
    }
    emitMessage(socket, {
      msg_type: "proposal",
      req_id: message.req_id,
      proposal: {
        id: proposalId,
        ask_price: 1.25 + proposalNumber,
        payout: proposalPayoutOverride ?? 2.5 + proposalNumber,
        spot: 75.5,
        spot_time: Math.floor(Date.now() / 1000),
        contract_details: { tick_size_barrier: 0.00005 },
        longcode: `proposal ${proposalNumber}`,
      },
    });
    return;
  }

  if (message.proposal_open_contract && !message.subscribe) {
    const contractId = String(message.contract_id ?? "");
    const contract = mockOpenContractResponses.get(contractId);
    if (contract) {
      emitMessage(socket, {
        msg_type: "proposal_open_contract",
        proposal_open_contract: contract,
      });
    }
    return;
  }

  if (!message.buy) return;
  if (buyBehavior === "invalid-proposal-id" && message.buy !== "1") {
    emitMessage(socket, {
      error: { code: "InvalidContractProposal", message: "Unknown contract proposal" },
      echo_req: { buy: message.buy },
    });
    return;
  }
  if (buyBehavior === "reject") {
    emitMessage(socket, {
      error: { code: "ContractBuyFailure", message: "buy rejected by Deriv" },
      echo_req: { buy: message.buy },
    });
    return;
  }
  if (rejectBuyResponsesRemaining > 0) {
    rejectBuyResponsesRemaining -= 1;
    emitMessage(socket, {
      ...(message.req_id == null ? {} : { req_id: message.req_id }),
      error: { code: "ContractBuyFailure", message: "buy rejected by Deriv" },
      echo_req: { buy: message.buy, ...(message.req_id == null ? {} : { req_id: message.req_id }) },
    });
    return;
  }
  if (rateLimitFailuresRemaining > 0) {
    rateLimitFailuresRemaining -= 1;
    emitMessage(socket, {
      ...(message.req_id == null ? {} : { req_id: message.req_id }),
      error: { code: "RateLimit", message: "You have reached the rate limit for buy." },
      echo_req: {
        buy: message.buy,
        ...(message.req_id == null ? {} : { req_id: message.req_id }),
      },
    });
    return;
  }
  if (buyBehavior === "disconnect") {
    socket.close();
    return;
  }

  buySendCountsAtAck.push(socket.sent.filter((sent) => sent.buy).length);
  const buyReference = String(message.buy === "1" ? message.req_id ?? message.buy : message.buy);
  const referenceNumber = Number(buyReference.match(/\d+/)?.[0] ?? 1);
  const contractId = String(900_000_000 + referenceNumber);
  mockPortfolioContracts.push({
    contract_id: contractId,
    account_id: "DOT123",
    contract_type: String(message.contract_type ?? "DIGITEVEN"),
    underlying: String(message.underlying ?? "R_75"),
    buy_price: Number(message.price ?? 1),
    payout: 4.5,
    status: "open",
  });
  emitMessage(socket, {
    msg_type: "buy",
    ...(message.req_id == null ? {} : { req_id: message.req_id }),
    echo_req: {
      buy: message.buy,
      ...(message.req_id == null ? {} : { req_id: message.req_id }),
    },
    buy: {
      contract_id: contractId,
      buy_price: message.price,
      payout: buyPayoutOverride ?? 4.5,
      start_time: 1_700_000_000,
    },
  });
}

function mockDerivRest() {
  mock.method(globalThis, "fetch", async (input: URL | string | Request) => {
    const url = String(input);
    if (url.endsWith("/trading/v1/options/accounts")) {
      return Response.json({
        data: [
          {
            account_id: "DOT123",
            account_type: "demo",
            currency: "USD",
            balance: 100,
            status: "active",
          },
          {
            account_id: "CR123",
            account_type: "real",
            currency: "EUR",
            balance: 250,
            status: "active",
          },
        ],
      });
    }
    if (url.endsWith("/trading/v1/options/accounts/DOT123/otp") || url.endsWith("/trading/v1/options/accounts/CR123/otp")) {
      return Response.json({ data: { url: "wss://fake.deriv.test/options" } });
    }
    throw new Error(`Unexpected REST request: ${url}`);
  });
}

async function inUser<T>(userId: string, operation: () => Promise<T>) {
  testUserIds.add(userId);
  deriv.setUserPat(userId, "test-pat");
  return deriv.withUser(userId, operation);
}

async function withSelectedAccount<T>(userId: string, operation: () => Promise<T>) {
  return inUser(userId, async () => {
    if (!deriv.getStatus().account) await deriv.selectAccount("DOT123");
    return operation();
  });
}

function latestSocket() {
  const socket = sockets.at(-1);
  assert.ok(socket, "expected an authenticated WebSocket");
  return socket;
}

function emitAccumulatorTicks(socket: FakeWebSocket, quotes: number[]) {
  const now = Math.floor(Date.now() / 1000);
  quotes.forEach((quote, index) => {
    emitMessage(socket, {
      msg_type: "tick",
      tick: {
        symbol: "1HZ90V",
        quote,
        epoch: now - (quotes.length - index),
        pip_size: 5,
      },
    });
  });
}

function emitAccumulatorTick(socket: FakeWebSocket, quote: number, epoch = Math.floor(Date.now() / 1000)) {
  emitMessage(socket, {
    msg_type: "tick",
    tick: { symbol: "1HZ90V", quote, epoch, pip_size: 5 },
  });
}

before(() => {
  mockDerivRest();
});

beforeEach(() => {
  for (const userId of testUserIds) deriv.disposeUser(userId);
  testUserIds.clear();
  buyBehavior = "ack";
  rateLimitFailuresRemaining = 0;
  rejectBuyResponsesRemaining = 0;
  portfolioErrorsRemaining = 0;
  malformedPortfolioResponsesRemaining = 0;
  portfolioResponseDelayMs = 0;
  proposalNumber = 0;
  proposalPayoutOverride = null;
  buyPayoutOverride = null;
  mockProfitTableRateLimited = false;
  mockPortfolioContracts = [];
  mockProfitTableTransactions = [];
  mockOpenContractResponses.clear();
  buySendCountsAtAck.length = 0;
  sockets.length = 0;
});

after(() => {
  deriv.stopDeriv();
});

describe("Deriv per-process session capacity", { concurrency: false }, () => {
  test("supports staged 1, 2, and 4 mock sessions and rejects a fifth without trading", async () => {
    const baselineRss = process.memoryUsage().rss;
    const stages: Array<{
      sessions: number;
      elapsedMs: number;
      rssMiB: number;
      openSockets: number;
    }> = [];
    const openedUsers: string[] = [];

    for (const target of [1, 2, 4]) {
      const pendingUsers = Array.from(
        { length: target - openedUsers.length },
        (_, index) => `capacity-load-${target}-${index}`,
      );
      const startedAt = performance.now();
      await Promise.all(
        pendingUsers.map(async (userId) => {
          await inUser(userId, () => deriv.selectAccount("DOT123"));
          openedUsers.push(userId);
        }),
      );
      const memory = process.memoryUsage();
      const openSockets = sockets.filter(
        (socket) => socket.readyState === FakeWebSocket.OPEN,
      ).length;

      assert.equal(openSockets, target);
      stages.push({
        sessions: target,
        elapsedMs: Math.round(performance.now() - startedAt),
        rssMiB: Math.round((memory.rss / 1024 / 1024) * 10) / 10,
        openSockets,
      });
    }

    assert.throws(
      () => deriv.setUserPat("capacity-load-overflow", "test-pat"),
      (error: unknown) => error instanceof deriv.DerivCapacityError,
    );
    assert.equal(
      sockets.filter((socket) => socket.readyState === FakeWebSocket.OPEN).length,
      4,
    );
    assert.equal(
      sockets.some((socket) =>
        socket.sent.some((message) => message.buy || message.sell),
      ),
      false,
      "the capacity test must not submit trade messages",
    );

    console.log(JSON.stringify({
      test: "mocked_deriv_session_capacity",
      baselineRssMiB: Math.round((baselineRss / 1024 / 1024) * 10) / 10,
      stages,
      fifthSessionRejected: true,
      tradeMessagesSent: 0,
    }));
  });
});

describe("Deriv real-account trading capability", { concurrency: false }, () => {
  test("allows a buy on a selected real account without a per-feature confirmation using mocked Deriv", async () => {
    await inUser("real-account-buy-user", async () => {
      const status = await deriv.selectAccount("CR123");
      assert.equal(status.account?.type, "real");
      assert.equal(status.live_trading_enabled, true);

      const result = await deriv.buyContract({
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITEVEN",
        symbol: "R_75",
      });

      assert.equal(result.ok, true);
      assert.match(result.message, /Live buy request sent/);
      assert.ok(latestSocket().sent.some((message) => message.buy));
    });
  });
});

describe("Deriv market subscriptions", { concurrency: false }, () => {
  test("recovers from a failed portfolio check without unblocking before confirmation", async () => {
    const userId = "portfolio-check-retry-user";
    portfolioErrorsRemaining = 1;
    const firstStatus = await inUser(userId, () => deriv.selectAccount("DOT123"));

    assert.equal(firstStatus.open_contracts_ready, false);
    assert.equal(
      latestSocket().sent.filter((message) => message.portfolio === 1 && message.req_id != null).length,
      1,
      "the initial portfolio request must be correlated",
    );

    await new Promise((resolve) => setTimeout(resolve, 700));
    await inUser(userId, async () => {
      assert.equal(deriv.getStatus().open_contracts_ready, true);
      assert.ok(
        latestSocket().sent.filter((message) => message.portfolio === 1 && message.req_id != null).length >= 2,
        "the failed read must be retried with a fresh correlated request",
      );
    });
  });

  test("keeps trading paused after a malformed portfolio response until a valid snapshot arrives", async () => {
    const userId = "portfolio-check-malformed-user";
    malformedPortfolioResponsesRemaining = 1;
    const firstStatus = await inUser(userId, () => deriv.selectAccount("DOT123"));

    assert.equal(firstStatus.open_contracts_ready, false);
    await new Promise((resolve) => setTimeout(resolve, 700));
    await inUser(userId, async () => {
      assert.equal(deriv.getStatus().open_contracts_ready, true);
    });
  });

  test("selecting an already-subscribed market does not send a duplicate subscription", async () => {
    await withSelectedAccount("market-subscription-user", async () => {
      const socket = latestSocket();
      const countSubscriptionsFor = (symbol: string) =>
        socket.sent.filter(
          (message) => message.ticks === symbol && message.subscribe === 1,
        ).length;

      assert.equal(countSubscriptionsFor("R_50"), 1);
      const status = await deriv.selectSymbol("R_50");

      assert.equal(status.symbol, "R_50");
      assert.equal(countSubscriptionsFor("R_50"), 1);
    });
  });

  test("publishes real market ticks to Auto Trader listeners and supports a reconnect snapshot", async () => {
    await withSelectedAccount("auto-trader-market-feed-user", async () => {
      const updates: Array<{
        symbol: string;
        tick_sequence: number;
        recent_digits: number[];
        tick_epoch: number;
      }> = [];
      const unsubscribe = deriv.subscribeDerivMarketTickUpdates((update) => updates.push(update));
      const socket = latestSocket();

      emitMessage(socket, {
        msg_type: "tick",
        tick: { symbol: "R_75", quote: 1234.56, epoch: 1_700_000_001, pip_size: 2 },
      });

      assert.deepEqual(updates, [{
        symbol: "R_75",
        tick_sequence: 1,
        recent_digits: [6],
        tick_epoch: 1_700_000_001,
      }]);
      assert.deepEqual(
        deriv.getMarketTickSnapshot().find((signal: { symbol: string }) => signal.symbol === "R_75"),
        updates[0],
      );

      unsubscribe();
      emitMessage(socket, {
        msg_type: "tick",
        tick: { symbol: "R_75", quote: 1234.57, epoch: 1_700_000_002, pip_size: 2 },
      });
      assert.equal(updates.length, 1, "unsubscribed Auto Trader screens must stop receiving ticks");
    });
  });
});

describe("Deriv buy acknowledgement safety", { concurrency: false }, () => {
  test("keeps entry blocked until a delayed pre-buy portfolio check is confirmed", async () => {
    await withSelectedAccount("portfolio-ready-refresh-user", async () => {
      const socket = latestSocket();
      assert.equal(deriv.getStatus().open_contracts_ready, true);
      const portfolioRequestsBefore = socket.sent.filter((message) => message.portfolio === 1).length;
      portfolioResponseDelayMs = 100;

      const pendingBuy = deriv.buyContract({
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITEVEN",
        symbol: "R_75",
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      assert.equal(
        socket.sent.filter((message) => message.portfolio === 1).length,
        portfolioRequestsBefore + 1,
      );
      assert.equal(
        deriv.getStatus().open_contracts_ready,
        false,
        "the entry gate stays closed while the current portfolio is unconfirmed",
      );
      assert.equal(socket.sent.some((message) => message.proposal || message.buy), false);

      const result = await pendingBuy;
      assert.equal(result.ok, true);
      assert.equal(deriv.getStatus().open_contracts_ready, true);
      assert.ok(socket.sent.some((message) => message.buy));
    });
  });

  test("marks a failed pre-buy portfolio check as not sent", async () => {
    await withSelectedAccount("portfolio-preflight-failure-user", async () => {
      portfolioErrorsRemaining = 1;
      let failure: unknown;
      try {
        await deriv.buyContract({
          amount: 1,
          duration: 1,
          duration_unit: "t",
          contract_type: "DIGITEVEN",
          symbol: "R_75",
        });
      } catch (error) {
        failure = error;
      }

      assert.ok(failure instanceof Error);
      assert.deepEqual(deriv.classifyBuyFailure(failure), {
        outcome: "not_sent",
        source: "api_server",
      });
      assert.equal(deriv.getStatus().open_contracts_ready, false);
      assert.equal(latestSocket().sent.some((message) => message.proposal || message.buy), false);
    });
  });

  test("refreshes Deriv's account portfolio before buying and blocks cross-session overlap", async () => {
    mockPortfolioContracts = [{
      contract_id: "already-open",
      contract_type: "DIGITEVEN",
      underlying: "R_75",
      buy_price: 1,
      payout: 2,
      status: "open",
      purchase_time: 1_700_000_000,
    }];
    await withSelectedAccount("portfolio-overlap-user", async () => {
      await assert.rejects(
        deriv.buyContract({
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITODD",
        symbol: "R_75",
        }),
        /Deriv still reports an open contract/,
      );
      const socket = latestSocket();
      assert.ok(socket.sent.some((message) => message.portfolio && message.req_id != null));
      assert.equal(deriv.getStatus().active_contract_count, 1);
      assert.equal(socket.sent.some((message) => message.proposal || message.buy), false);
    });
  });

  test("omits expiry fields and forwards decimal growth for Accumulator contracts", async () => {
    const result = await withSelectedAccount("accumulator-user", () => deriv.buyContract({
      amount: 1,
      duration: 5,
      duration_unit: "t",
      contract_type: "ACCU",
      growth_rate: 0.04,
      symbol: "1HZ90V",
    }));

    assert.equal(result.buy.contract_id, "900000001");
    const socket = latestSocket();
    const proposalRequest = socket.sent.find((message) => message.proposal);
    assert.ok(proposalRequest);
    assert.equal(proposalRequest.contract_type, "ACCU");
    assert.equal(proposalRequest.growth_rate, 0.04);
    assert.equal(proposalRequest.duration, undefined);
    assert.equal(proposalRequest.duration_unit, undefined);
    assert.equal(proposalRequest.date_expiry, undefined);
    assert.deepEqual(proposalRequest.limit_order, { take_profit: 0.22 });
  });

  test("keeps the requested tick count out of the ACCU proposal payload", async () => {
    const result = await withSelectedAccount("accumulator-duration-fallback-user", () => deriv.buyContract({
      amount: 1,
      duration: 5,
      duration_unit: "t",
      contract_type: "ACCU",
      growth_rate: 0.04,
      symbol: "1HZ90V",
    }));

    assert.equal(result.buy.contract_id, "900000001");
    const socket = latestSocket();
    const proposalRequests = socket.sent.filter((message) => message.proposal);
    assert.equal(proposalRequests.length, 1);
    assert.equal(proposalRequests[0].duration, undefined);
    assert.equal(proposalRequests[0].duration_unit, undefined);
    assert.equal(proposalRequests[0].date_expiry, undefined);
    assert.deepEqual(proposalRequests[0].limit_order, { take_profit: 0.22 });
    assert.equal(proposalRequests[0].growth_rate, 0.04);
  });

  test("does not block a fresh proposal because of price movement before its entry spot", async () => {
    const result = await withSelectedAccount("accumulator-knockout-safe-user", async () => {
      const socket = latestSocket();
      emitAccumulatorTicks(socket, [75.5, 75.50006, 75.5, 75.5, 75.5, 75.5]);
      return deriv.buyContract({
        amount: 1,
        duration: 5,
        duration_unit: "t",
        contract_type: "ACCU",
        growth_rate: 0.04,
        symbol: "1HZ90V",
        auto_knockout: true,
      });
    });

    assert.equal(result.buy.contract_id, "900000001");
    assert.ok(latestSocket().sent.some((message) => message.buy));
  });

  test("allows a fresh entry after a historical quote crossed the new contract barrier", async () => {
    const result = await withSelectedAccount("accumulator-knockout-risk-user", async () => {
      const socket = latestSocket();
      emitAccumulatorTicks(socket, [75.5, 75.5, 75.5, 75.5, 75.50006, 75.5]);
      return deriv.buyContract({
        amount: 1,
        duration: 5,
        duration_unit: "t",
        contract_type: "ACCU",
        growth_rate: 0.04,
        symbol: "1HZ90V",
        auto_knockout: true,
      });
    });

    assert.equal(result.buy.contract_id, "900000001");
    assert.ok(latestSocket().sent.some((message) => message.buy));
  });

  test("does not gate Money Bank buys on knockout movement or incomplete exit-window ticks", async () => {
    const result = await withSelectedAccount("accumulator-knockout-nonblocking-user", async () => {
      const socket = latestSocket();
      emitAccumulatorTicks(socket, [75.5, 75.5]);
      emitAccumulatorTick(socket, 75.50006);
      return deriv.buyContract({
        amount: 1,
        duration: 5,
        duration_unit: "t",
        contract_type: "ACCU",
        growth_rate: 0.04,
        symbol: "1HZ90V",
        auto_knockout: true,
      });
    });

    assert.equal(result.buy.contract_id, "900000001");
    assert.ok(latestSocket().sent.some((message) => message.buy));
  });

  test("requires a clear ten-second Auto Knockout scan and a fresh exit-window quote", async () => {
    const result = await withSelectedAccount("accumulator-knockout-scan-safe-user", async () => {
      const socket = latestSocket();
      emitAccumulatorTicks(socket, [75.5, 75.5, 75.5, 75.5, 75.5, 75.5]);
      setTimeout(() => emitAccumulatorTick(socket, 75.5), 15);
      return deriv.scanAccumulatorKnockout({
        amount: 1,
        duration: 5,
        duration_unit: "t",
        contract_type: "ACCU",
        growth_rate: 0.04,
        symbol: "1HZ90V",
      }, 60);
    });

    assert.equal(result.ok, true);
    assert.equal(latestSocket().sent.some((message) => message.buy), false);
  });

  test("blocks the Auto Knockout scan when a tick reaches Deriv's barrier", async () => {
    await withSelectedAccount("accumulator-knockout-scan-risk-user", async () => {
      const socket = latestSocket();
      emitAccumulatorTicks(socket, [75.5, 75.5, 75.5, 75.5, 75.5, 75.5]);
      setTimeout(() => emitAccumulatorTick(socket, 75.50006), 15);
      await assert.rejects(
        deriv.scanAccumulatorKnockout({
          amount: 1,
          duration: 5,
          duration_unit: "t",
          contract_type: "ACCU",
          growth_rate: 0.04,
          symbol: "1HZ90V",
        }, 60),
        /knockout-sized move during its 10-second scan/,
      );
      assert.equal(socket.sent.some((message) => message.buy), false);
    });
  });

  test("blocks cumulative movement that reaches the barrier during the scan", async () => {
    await withSelectedAccount("accumulator-knockout-cumulative-scan-user", async () => {
      const socket = latestSocket();
      emitAccumulatorTicks(socket, [75.5, 75.5, 75.5, 75.5, 75.5, 75.5]);
      setTimeout(() => {
        emitAccumulatorTick(socket, 75.50002);
        emitAccumulatorTick(socket, 75.50004);
        emitAccumulatorTick(socket, 75.50006);
      }, 15);
      await assert.rejects(
        deriv.scanAccumulatorKnockout({
          amount: 1,
          duration: 5,
          duration_unit: "t",
          contract_type: "ACCU",
          growth_rate: 0.04,
          symbol: "1HZ90V",
        }, 60),
        /knockout-sized move during its 10-second scan/,
      );
      assert.equal(socket.sent.some((message) => message.buy), false);
    });
  });

  test("rounds Accumulator stakes before Deriv receives the proposal", async () => {
    await withSelectedAccount("accumulator-rounding-user", () => deriv.buyContract({
      amount: 1.239,
      duration: 5,
      duration_unit: "t",
      contract_type: "ACCU",
      growth_rate: 0.04,
      symbol: "1HZ90V",
    }));

    const proposalRequest = latestSocket().sent.find((message) => message.proposal);
    assert.ok(proposalRequest);
    assert.equal(proposalRequest.amount, 1.24);
    assert.deepEqual(proposalRequest.limit_order, { take_profit: 0.27 });
  });

  test("uses the same ACCU parameters for bulk direct buys", async () => {
    const result = await withSelectedAccount("accumulator-bulk-user", () => deriv.bulkBuyContracts({
      amount: 1,
      duration: 5,
      duration_unit: "t",
      contract_type: "ACCU",
      growth_rate: 0.04,
      symbol: "1HZ90V",
      count: 1,
    }));

    assert.equal(result.count, 1);
    const socket = latestSocket();
    const proposalRequest = socket.sent.find((message) => message.proposal);
    const buyRequest = socket.sent.find((message) => message.buy === "1");
    assert.ok(proposalRequest);
    assert.ok(buyRequest);
    assert.equal(buyRequest.parameters.growth_rate, 0.04);
    assert.equal(buyRequest.parameters.contract_type, "ACCU");
    assert.equal(buyRequest.parameters.date_expiry, undefined);
    assert.equal(buyRequest.parameters.duration, undefined);
    assert.equal(buyRequest.parameters.duration_unit, undefined);
    assert.deepEqual(buyRequest.parameters.limit_order, { take_profit: 0.22 });
  });

  test("allows 10-tick Rise/Fall bulk contracts and rejects longer digit contracts", async () => {
    const result = await withSelectedAccount("rise-fall-ten-tick-user", () => deriv.bulkBuyContracts({
      amount: 1,
      duration: 10,
      duration_unit: "t",
      contract_type: "CALL",
      symbol: "R_75",
      count: 1,
    }));

    assert.equal(result.count, 1);
    const proposalRequest = latestSocket().sent.find((message) => message.proposal);
    const buyRequest = latestSocket().sent.find((message) => message.buy === "1");
    assert.equal(proposalRequest?.duration, 10);
    assert.equal(buyRequest?.parameters.duration, 10);

    await assert.rejects(
      () => withSelectedAccount("digit-ten-tick-user", () => deriv.bulkBuyContracts({
        amount: 1,
        duration: 10,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 5,
        symbol: "R_75",
        count: 1,
      })),
      /Tick durations above 5 are only supported for Rise\/Fall contracts/,
    );
  });

  test("correlates proposal and buy acknowledgements and tracks open history before settlement", async () => {
    const tradeUpdates: string[] = [];
    const { result, unsubscribe } = await withSelectedAccount("correlation-user", async () => {
      const unsubscribe = deriv.subscribeDerivHistoryUpdates((item) => {
        tradeUpdates.push(`${item.status}:${item.profit}`);
      });
      const result = await deriv.buyContract({
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 5,
        symbol: "R_75",
      });
      return { result, unsubscribe };
    });

    assert.equal(result.proposal.id, "proposal-1");
    assert.equal(result.buy.contract_id, "900000001");
    assert.deepEqual(tradeUpdates, ["open:0"]);
    const socket = latestSocket();
    const buyRequest = socket.sent.find((message) => message.buy);
    assert.deepEqual(buyRequest, { buy: "proposal-1", price: 2.25 });
    assert.equal(
      typeof socket.sent.find((message) => message.proposal_open_contract === 1 && message.subscribe === 1)?.contract_id,
      "number",
    );

    await inUser("correlation-user", async () => {
      assert.deepEqual(deriv.getHistory(), [{
        contract_id: "900000001",
        account_id: "DOT123",
        account_type: "demo",
        currency: "USD",
        contract_type: "DIGITDIFF",
        barrier: 5,
        symbol: "R_75",
         duration: 1,
         duration_unit: "t",
        growth_rate: null,
        tick_passed: null,
        buy_price: 2.25,
         current_value: 2.25,
        payout: 4.5,
        profit: 0,
        status: "open",
        buy_time: 1_700_000_000,
        sell_time: null,
      }]);

       emitMessage(socket, {
         msg_type: "proposal_open_contract",
         proposal_open_contract: {
           contract_id: "900000001",
           status: "open",
           is_sold: false,
           buy_price: 2.25,
           bid_price: 2.8,
           payout: 4.5,
           profit: 0.55,
         },
       });

       assert.equal(deriv.getHistory()[0].status, "open");
       assert.equal(deriv.getHistory()[0].current_value, 2.8);
       assert.equal(deriv.getHistory()[0].profit, 0.55);
       assert.equal(tradeUpdates.at(-1), "open:0.55");

      emitMessage(socket, {
        msg_type: "proposal_open_contract",
        proposal_open_contract: {
          contract_id: "900000001",
          status: "won",
          is_sold: true,
          buy_price: 2.25,
          payout: 4.5,
          sell_price: 4.5,
          profit: 2.25,
          entry_spot: 75.5,
          current_spot: 75.6,
          expiry_time: 1_700_000_001,
          sell_time: 1_700_000_001,
        },
      });

      assert.equal(deriv.getHistory()[0].status, "won");
      assert.equal(deriv.getHistory()[0].profit, 2.25);
       assert.equal(deriv.getHistory()[0].current_value, 4.5);
      assert.equal(deriv.getHistory()[0].sell_time, 1_700_000_001);
      assert.equal(tradeUpdates.at(-1), "won:2.25");
      unsubscribe();
    });
  });

  test("recovers explicit invalid proposal IDs for Money Bank and DigitFlip using a fresh direct quote", async () => {
    buyBehavior = "invalid-proposal-id";
    const cases = [
      {
        userId: "money-bank-invalid-proposal-user",
        input: {
          amount: 1,
          duration: 5,
          duration_unit: "t" as const,
          contract_type: "ACCU" as const,
          growth_rate: 0.04,
          symbol: "1HZ90V",
        },
      },
      {
        userId: "digit-flip-invalid-proposal-user",
        input: {
          amount: 1,
          duration: 1,
          duration_unit: "t" as const,
          contract_type: "DIGITEVEN" as const,
          symbol: "R_75",
        },
      },
    ];

    for (const { userId, input } of cases) {
      proposalNumber = 0;
      await withSelectedAccount(userId, async () => {
        const result = await deriv.buyContract(input);
        const socket = latestSocket();
        const buyRequests = socket.sent.filter((message) => message.buy);

        assert.equal(result.ok, true);
        assert.equal(buyRequests.length, 2);
        assert.equal(buyRequests[0].buy, "proposal-1");
        assert.equal(buyRequests[1].buy, "1");
        assert.equal(buyRequests[1].parameters.contract_type, input.contract_type);
        assert.equal(socket.sent.filter((message) => message.proposal).length, 2);
        assert.equal(deriv.getHistory()[0]?.contract_type, input.contract_type);
      });
      mockPortfolioContracts = [];
    }
  });

  test("preserves the complete Deriv payout in quote, buy, and history responses", async () => {
    const fullPayout = 125_000.75;
    proposalPayoutOverride = fullPayout;
    buyPayoutOverride = fullPayout;

    const result = await withSelectedAccount("full-payout-user", () => deriv.buyContract({
      amount: 1,
      duration: 1,
      duration_unit: "t",
      contract_type: "DIGITEVEN",
      symbol: "R_75",
    }));

    assert.equal(result.proposal.payout, fullPayout);
    assert.equal(result.buy.payout, fullPayout);
    await inUser("full-payout-user", async () => {
      assert.equal(deriv.getHistory()[0]?.payout, fullPayout);
    });
  });

  test("keeps complete trade history isolated and retained per account", async () => {
    const demoRow = {
      contract_id: 4_867_502_908,
      contract_type: "DIGITDIFF",
      underlying_symbol: "R_75",
      buy_price: 2,
      payout: 4,
      sell_price: 4,
      purchase_time: 1_700_000_001,
      sell_time: 1_700_000_002,
      barrier: 5,
    };
    const realRow = {
      ...demoRow,
      account_id: "CR123",
      account_type: "real",
      currency: "EUR",
      contract_type: "DIGITEVEN",
      buy_price: 3,
      payout: 5,
      sell_price: 0,
    };

    await withSelectedAccount("account-history-user", async () => {
      mockProfitTableTransactions = [demoRow];
      await deriv.refreshDerivHistory();
      const demoHistory = deriv.getHistory();
      assert.equal(demoHistory.length, 1);
      assert.equal(demoHistory[0].account_id, "DOT123");
      assert.equal(demoHistory[0].account_type, "demo");
      assert.equal(demoHistory[0].currency, "USD");
      assert.equal(demoHistory[0].contract_id, "4867502908");
      assert.equal(demoHistory[0].profit, 2, "profit-table sell price minus buy price should be the net profit");
      assert.equal(demoHistory[0].current_value, 4, "settled value should use Deriv's sell price");
      assert.equal(demoHistory[0].status, "closed");
      assert.equal(demoHistory[0].sell_time, 1_700_000_002);

      mockProfitTableTransactions = [];
      await deriv.selectAccount("CR123");
      assert.deepEqual(deriv.getHistory(), []);
      mockProfitTableTransactions = [realRow];
      await deriv.refreshDerivHistory();
      const realHistory = deriv.getHistory();
      assert.equal(realHistory.length, 1);
      assert.equal(realHistory[0].account_id, "CR123");
      assert.equal(realHistory[0].account_type, "real");
      assert.equal(realHistory[0].currency, "EUR");
      assert.equal(realHistory[0].contract_type, "DIGITEVEN");
      assert.equal(realHistory[0].profit, -3);
      assert.equal(realHistory[0].status, "closed");

      emitMessage(latestSocket(), {
        msg_type: "profit_table",
        profit_table: { transactions: [demoRow] },
      });
      assert.equal(
        deriv.getHistory().find((entry: { account_id: string }) => entry.account_id === "CR123")?.profit,
        -3,
        "uncorrelated history from a previous account must be ignored",
      );

      deriv.clearHistory();
      assert.deepEqual(deriv.getHistory(), []);
      await deriv.selectAccount("DOT123");
      assert.deepEqual(deriv.getHistory(), demoHistory);
    });
  });

  test("serves cached trade history and backs off when Deriv rate-limits profit_table", async () => {
    await withSelectedAccount("history-rate-limit-user", async () => {
      await deriv.buyContract({
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 5,
        symbol: "R_75",
      });
      mockProfitTableRateLimited = true;

      await assert.doesNotReject(() => deriv.refreshDerivHistory());
      assert.equal(deriv.getHistory().length, 1);
      assert.equal(deriv.getHistory()[0].status, "open");

      const socket = latestSocket();
      const requestCount = socket.sent.filter((message) => message.profit_table).length;
      await deriv.refreshDerivHistory();
      assert.equal(
        socket.sent.filter((message) => message.profit_table).length,
        requestCount,
        "a rate-limited refresh must not trigger an immediate retry",
      );
    });
  });

  test("rejects a buy and clears pending state", async () => {
    buyBehavior = "reject";
    await assert.rejects(
      withSelectedAccount("rejected-buy-user", () => deriv.buyContract({
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITEVEN",
        symbol: "R_75",
      })),
      /buy rejected by Deriv/,
    );
    await inUser("rejected-buy-user", async () => {
      assert.equal(latestSocket().sent.filter((message) => message.buy).length, 1);
    });

    buyBehavior = "ack";
    const result = await withSelectedAccount("rejected-buy-user", () => deriv.bulkBuyContracts({
      amount: 1,
      duration: 1,
      duration_unit: "t",
      contract_type: "DIGITEVEN",
      symbol: "R_75",
      count: 1,
    }));
    assert.equal(result.count, 1);
  });

  test("rejects a buy on socket disconnect and clears pending state", async () => {
    buyBehavior = "disconnect";
    await assert.rejects(
      withSelectedAccount("disconnected-buy-user", () => deriv.buyContract({
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITODD",
        symbol: "R_75",
      })),
      /WebSocket disconnected before the contract purchase was acknowledged/,
    );
    await inUser("disconnected-buy-user", async () => {
      assert.equal(latestSocket().sent.filter((message) => message.buy).length, 1);
    });

    buyBehavior = "ack";
    const result = await withSelectedAccount("disconnected-buy-user", () => deriv.bulkBuyContracts({
      amount: 1,
      duration: 1,
      duration_unit: "t",
      contract_type: "DIGITODD",
      symbol: "R_75",
      count: 1,
    }));
    assert.equal(result.count, 1);
  });

  test("retries a confirmed buy rate-limit rejection with a fresh proposal", async () => {
    rateLimitFailuresRemaining = 1;
    const result = await withSelectedAccount("rate-limited-buy-user", () => deriv.buyContract({
      amount: 1,
      duration: 1,
      duration_unit: "t",
      contract_type: "DIGITODD",
      symbol: "R_75",
    }));

    assert.ok(result.buy.contract_id);
    const socket = latestSocket();
    assert.equal(socket.sent.filter((message) => message.buy).length, 2);
    assert.equal(socket.sent.filter((message) => message.proposal).length, 2);
    await inUser("rate-limited-buy-user", async () => {
      assert.equal(deriv.getHistory().length, 1);
      assert.equal(deriv.getStatus().active_contract_count, 1);
    });
  });

  test("returns a definite rate-limit error after bounded safe retries", async () => {
    rateLimitFailuresRemaining = 4;
    await assert.rejects(
      withSelectedAccount("exhausted-rate-limit-user", () => deriv.buyContract({
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITODD",
        symbol: "R_75",
      })),
      (error: unknown) => {
        assert.equal(deriv.isDerivBuyRateLimitError(error), true);
        return true;
      },
    );
    assert.equal(latestSocket().sent.filter((message) => message.buy).length, 4);
    await inUser("exhausted-rate-limit-user", async () => {
      assert.equal(deriv.getHistory().length, 0);
      assert.equal(deriv.getStatus().active_contract_count, 0);
    });
  });

  test("bulk buys dispatch together and return after acknowledgements without waiting for settlement", async () => {
    const result = await withSelectedAccount("bulk-buy-user", () => deriv.bulkBuyContracts({
      amount: 1,
      duration: 1,
      duration_unit: "t",
      contract_type: "DIGITOVER",
      barrier: 3,
      symbol: "R_75",
      count: 2,
    }, undefined, true));

    assert.equal(result.count, 2);
    assert.deepEqual(buySendCountsAtAck, [2, 2], "all batch buy requests are dispatched before their acknowledgements arrive");
    await inUser("bulk-buy-user", async () => {
      assert.equal(deriv.getHistory().length, 2);
      assert.ok(deriv.getHistory().every((trade: { status: string }) => trade.status === "open"));
      assert.equal(deriv.getStatus().active_contract_count, 2);
      deriv.clearHistory();
      assert.equal(deriv.getHistory().length, 0);
      assert.equal(deriv.getStatus().active_contract_count, 2, "clearing visible history must not clear the active-contract guard");
      await assert.rejects(
        deriv.bulkBuyContracts({
          amount: 1,
          duration: 1,
          duration_unit: "t",
          contract_type: "DIGITOVER",
          barrier: 3,
          symbol: "R_75",
          count: 1,
        }),
        /still reports an open contract|previous contract is still settling/,
      );
    });
  });

  test("Auto Trader 1–5 tick durations are passed unchanged to Deriv proposals and buys", async () => {
    for (const duration of [1, 2, 3, 4, 5]) {
      mockPortfolioContracts = [];
      const userId = `auto-trader-duration-${duration}`;
      const result = await withSelectedAccount(userId, () => deriv.bulkBuyContracts({
        amount: 1,
        duration,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 4,
        symbol: "R_75",
        count: 1,
      }, undefined, true));

      assert.equal(result.count, 1);
      const socket = latestSocket();
      const proposal = socket.sent.find((message) => message.proposal === 1);
      const buy = socket.sent.find((message) => message.buy === "1");
      assert.equal(proposal?.duration, duration);
      assert.equal(proposal?.duration_unit, "t");
      assert.equal((buy?.parameters as Record<string, unknown> | undefined)?.duration, duration);
      assert.equal((buy?.parameters as Record<string, unknown> | undefined)?.duration_unit, "t");
      deriv.disposeUser(userId);
      testUserIds.delete(userId);
      mockPortfolioContracts = [];
    }
  });

  test("three- and six-contract synchronized batches dispatch every buy before acknowledgement", async () => {
    for (const count of [3, 6]) {
      const result = await withSelectedAccount(`synchronized-bulk-${count}`, () => deriv.bulkBuyContracts({
        amount: 1,
        duration: 2,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 4,
        symbol: "R_75",
        count,
      }, undefined, true));
      assert.equal(result.count, count);
      assert.equal(result.buys.length, count);
      assert.deepEqual(buySendCountsAtAck.slice(-count), Array(count).fill(count));
      mockPortfolioContracts = [];
    }
  });

  test("synchronized batches return confirmed contracts when one explicit buy rejection occurs", async () => {
    rejectBuyResponsesRemaining = 1;
    const result = await withSelectedAccount("partial-synchronized-bulk", () => deriv.bulkBuyContracts({
      amount: 1,
      duration: 3,
      duration_unit: "t",
      contract_type: "DIGITDIFF",
      barrier: 7,
      symbol: "R_75",
      count: 3,
    }, undefined, true));

    assert.equal(result.ok, false);
    assert.equal(result.count, 2);
    assert.equal(result.buys.length, 2);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0]?.outcome, "rejected");
    assert.equal(result.failed[0]?.source, "deriv");
    assert.match(result.message, /2 of 3 contracts were confirmed/);
    assert.match(result.message, /check Deriv history before resubmitting/);
  });

  test("Deriv sale flags release a stale open status without treating zero as sold", async () => {
    const result = await withSelectedAccount("sale-flag-settlement-user", () => deriv.bulkBuyContracts({
      amount: 1,
      duration: 1,
      duration_unit: "t",
      contract_type: "DIGITODD",
      symbol: "R_75",
      count: 1,
    }));
    const contractId = result.buys[0].contract_id;

    await inUser("sale-flag-settlement-user", async () => {
      const socket = latestSocket();
      emitMessage(socket, {
        msg_type: "proposal_open_contract",
        proposal_open_contract: {
          contract_id: contractId,
          status: "open",
          is_sold: "0",
          buy_price: 1,
          payout: 4.5,
          bid_price: 1,
          profit: 0,
        },
      });
      assert.equal(deriv.getStatus().active_contract_count, 1, "string zero is not a sold flag");

      emitMessage(socket, {
        msg_type: "proposal_open_contract",
        proposal_open_contract: {
          contract_id: contractId,
          status: "open",
          is_sold: 1,
          buy_price: 1,
          payout: 4.5,
          sell_price: 1.25,
          profit: 0.25,
          sell_time: 1_700_000_001,
        },
      });
      assert.equal(deriv.getStatus().active_contract_count, 0);
      assert.equal(deriv.getHistory()[0].status, "closed");
      assert.equal(deriv.getStatus().last_contract?.is_sold, true);

      const nextBatch = await deriv.bulkBuyContracts({
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITODD",
        symbol: "R_75",
        count: 1,
      });
      assert.equal(nextBatch.count, 1, "a new entry is allowed after the prior contract is confirmed sold");
      assert.equal(deriv.getStatus().active_contract_count, 1);
    });
  });

  test("reconnect restores subscriptions for open contracts and fetches stale settlements", async () => {
    let contractId = "";
    await withSelectedAccount("reconnect-open-contract-user", async () => {
      const result = await deriv.bulkBuyContracts({
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITODD",
        symbol: "R_75",
        count: 1,
      });
      contractId = result.buys[0].contract_id;
      mockPortfolioContracts = [{
        contract_id: contractId,
        account_id: "DOT123",
        buy_price: result.buys[0].buy_price,
        payout: result.buys[0].payout,
        purchase_time: result.buys[0].start_time,
        contract_type: "DIGITODD",
        underlying_symbol: "R_75",
        status: "open",
      }];
      latestSocket().close();
    });

    await new Promise((resolve) => setImmediate(resolve));
    await withSelectedAccount("reconnect-open-contract-user", async () => {
      const socket = latestSocket();
      assert.ok(
        socket.sent.some((message) =>
          message.proposal_open_contract === 1
          && message.contract_id === Number(contractId)
          && message.subscribe === 1,
        ),
        "the reconnect must resubscribe to every still-open contract",
      );
      assert.equal(deriv.getStatus().open_contracts_ready, true);
      assert.equal(
        deriv.getStatus().active_contract_count,
        1,
        JSON.stringify({ history: deriv.getHistory(), status: deriv.getStatus() }),
      );

      emitMessage(socket, {
        msg_type: "proposal_open_contract",
        proposal_open_contract: {
          contract_id: contractId,
          account_id: "DOT123",
          buy_price: 1,
          payout: 4.5,
          sell_price: 4.5,
          profit: 3.5,
          status: "won",
          is_sold: 1,
          contract_type: "DIGITODD",
          underlying: "R_75",
          sell_time: 1_700_000_001,
        },
      });
      assert.equal(deriv.getStatus().active_contract_count, 0);
    });
  });

  test("reconnect verifies a missed settlement update and replaces stale open history", async () => {
    let contractId = "";
    await withSelectedAccount("reconnect-missed-settlement-user", async () => {
      const result = await deriv.buyContract({
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 5,
        symbol: "R_75",
      });
      contractId = result.buy.contract_id;
      mockPortfolioContracts = [];
      mockOpenContractResponses.set(contractId, {
        contract_id: contractId,
        account_id: "DOT123",
        status: "lost",
        is_sold: 1,
        buy_price: result.buy.buy_price,
        payout: result.buy.payout,
        sell_price: 0,
        profit: -result.buy.buy_price,
        contract_type: "DIGITDIFF",
        underlying: "R_75",
        sell_time: 1_700_000_001,
      });
      latestSocket().close();
    });

    await new Promise((resolve) => setImmediate(resolve));
    await inUser("reconnect-missed-settlement-user", () => deriv.selectAccount("DOT123"));
    await new Promise((resolve) => setImmediate(resolve));

    await inUser("reconnect-missed-settlement-user", async () => {
      assert.ok(
        latestSocket().sent.some((message) =>
          message.proposal_open_contract === 1
          && message.contract_id === Number(contractId)
          && !message.subscribe,
        ),
        "reconnect must explicitly request final state for the stale history row",
      );
      const item = deriv.getHistory().find((historyItem: { contract_id: string }) => historyItem.contract_id === contractId);
      assert.ok(item);
      assert.equal(item.status, "lost");
      assert.equal(item.profit, -item.buy_price);
      assert.equal(item.sell_time, 1_700_000_001);
      assert.equal(deriv.getStatus().active_contract_count, 0);
    });
  });

  test("dual buys return after both buy acknowledgements without waiting for settlement", async () => {
    const result = await withSelectedAccount("dual-buy-user", () => deriv.dualBuyContracts({
      amount: 1,
      duration: 1,
      duration_unit: "t",
      barrier: 3,
      symbol: "R_75",
    }));

    assert.equal(result.count, 2);
    await inUser("dual-buy-user", async () => {
      assert.equal(deriv.getHistory().length, 2);
      assert.deepEqual(
        deriv.getHistory().map((trade: { contract_type: string }) => trade.contract_type).sort(),
        ["DIGITOVER", "DIGITUNDER"],
      );
      assert.ok(deriv.getHistory().every((trade: { status: string }) => trade.status === "open"));
    });
  });

  test("Clock Work quotes send signed price barriers for the selected Higher and Lower contracts", async () => {
    const result = await withSelectedAccount("clock-work-quote-user", () => deriv.quoteClockWorkContracts({
      contracts: [
        { key: "higher", amount: 1, duration: 5, duration_unit: "t", contract_type: "HIGHER", barrier: "+0.12", symbol: "R_75" },
        { key: "lower", amount: 1, duration: 5, duration_unit: "t", contract_type: "LOWER", barrier: "-0.12", symbol: "R_75" },
      ],
    }));

    assert.equal(result.quotes.length, 2);
    assert.ok(result.quotes.every((quote: { payout: number; ask_price: number }) => quote.payout > quote.ask_price));
    const proposals = latestSocket().sent.filter((message) => message.proposal);
    assert.ok(proposals.some((message) => message.contract_type === "HIGHER" && message.barrier === "+0.12" && message.duration === 5));
    assert.ok(proposals.some((message) => message.contract_type === "LOWER" && message.barrier === "-0.12" && message.duration === 5));
  });

  test("Clock Work buys four mixed stakes without replaying or selling an acknowledged order", async () => {
    const contracts = [
      { key: "h1", amount: 1, duration: 5 as const, duration_unit: "t" as const, contract_type: "HIGHER" as const, barrier: "+0.12", symbol: "R_75" },
      { key: "l1", amount: 1.2, duration: 5 as const, duration_unit: "t" as const, contract_type: "LOWER" as const, barrier: "-0.12", symbol: "R_75" },
      { key: "h2", amount: 1.4, duration: 5 as const, duration_unit: "t" as const, contract_type: "HIGHER" as const, barrier: "+0.06", symbol: "R_75" },
      { key: "l2", amount: 1.6, duration: 5 as const, duration_unit: "t" as const, contract_type: "LOWER" as const, barrier: "-0.06", symbol: "R_75" },
    ];
    const result = await withSelectedAccount("clock-work-four-user", () => deriv.buyClockWorkContracts({ contracts }));

    assert.equal(result.ok, true);
    assert.equal(result.requested_count, 4);
    assert.equal(result.completed_count, 4);
    assert.equal(result.contracts.length, 4);
    assert.equal(result.failed.length, 0);
    const buyMessages = latestSocket().sent.filter((message) => message.buy);
    assert.equal(buyMessages.length, 4);
    assert.ok(buyMessages.every((message) =>
      message.parameters.duration === 5 && message.parameters.duration_unit === "t",
    ));
    assert.deepEqual(
      buyMessages.map((message) => message.parameters.contract_type).sort(),
      ["HIGHER", "HIGHER", "LOWER", "LOWER"],
    );
    assert.equal(latestSocket().sent.some((message) => message.sell), false);
  });

});