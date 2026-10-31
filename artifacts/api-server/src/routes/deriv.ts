import { Router, type IRouter } from "express";
import {
  GetDerivAccountsResponse,
  GetDerivHistoryResponse,
  GetDerivStatusResponse,
  RequestDerivProposalBody,
  RequestDerivProposalResponse,
  BuyDerivContractBody,
  BuyDerivContractResponse,
  SellDerivContractBody,
  SellDerivContractResponse,
  BulkBuyDerivContractsBody,
  BulkBuyDerivContractsResponse,
  DualBuyDerivContractsBody,
  QuoteClockWorkContractsBody,
  QuoteClockWorkContractsResponse,
  BuyClockWorkContractsBody,
  BuyClockWorkContractsResponse,
  ScanDerivAccumulatorKnockoutBody,
  ScanDerivAccumulatorKnockoutResponse,
  SelectDerivAccountBody,
  SelectDerivAccountResponse,
  SelectDerivSymbolBody,
  SelectDerivSymbolResponse,
  TestDerivConnectionResponse,
} from "@workspace/api-zod";
import {
  getAccounts,
  getStatus,
  getLiveStatus,
  getHistory,
  getMarketTickSnapshot,
  subscribeDerivHistoryUpdates,
  subscribeDerivMarketTickUpdates,
  refreshDerivHistory,
  clearHistory,
  requestProposal,
  scanAccumulatorKnockout,
  buyContract,
  sellContract,
  bulkBuyContracts,
  dualBuyContracts,
  quoteClockWorkContracts,
  buyClockWorkContracts,
  selectAccount,
  selectSymbol,
  testConnection,
  withUser,
  withUserSerialized,
  setUserPat,
  disposeUser,
  DerivCredentialError,
  DerivCapacityError,
  isDerivBuyRateLimitError,
  classifyBuyFailure,
  getTradeErrorSource,
} from "../lib/deriv";
import { withDistributedUserLock } from "../lib/distributed-user-lock";
import { assertAccessSessionActive, AccessSessionRevokedError } from "../lib/access-keys";
import { adminFeatureSettingsTable, db, derivCredentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptPat } from "../lib/pat-crypto";
import { requireAccessFeature, requireTradeAccessFeature } from "../middlewares/requireAccess.ts";

const router: IRouter = Router();
class MissingDerivCredentialError extends Error {}
class InvalidStoredCredentialError extends Error {}

function isCredentialError(error: unknown): error is Error {
  return error instanceof MissingDerivCredentialError
    || error instanceof InvalidStoredCredentialError
    || error instanceof DerivCredentialError;
}

function credentialHttpStatus(error: unknown): number {
  return error instanceof DerivCredentialError ? error.status : 401;
}

function tradeOutcomeForRouteError(
  error: unknown,
  status: number,
): "rejected" | "uncertain" | "not_sent" {
  if (error && typeof error === "object" && "name" in error && error.name === "ZodError") return "uncertain";
  const outcome = classifyBuyFailure(error).outcome;
  if (outcome !== "uncertain") return outcome;
  if (status === 429) return "rejected";
  if (status >= 400 && status < 500) return "not_sent";
  return "uncertain";
}

function tradeErrorSourceForRoute(error: unknown, status: number) {
  const source = getTradeErrorSource(error);
  if (source !== "unknown") return source;
  if (isCapacityError(error) || isCredentialError(error) || error instanceof AccessSessionRevokedError) {
    return "api_server" as const;
  }
  return status >= 400 && status < 500 ? "api_server" as const : "unknown" as const;
}

function isCapacityError(error: unknown): error is DerivCapacityError {
  return error instanceof DerivCapacityError;
}

function normalizeHistoryBarrier(row: unknown): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const barrier = (row as { barrier?: unknown }).barrier;
  if (typeof barrier !== "string" || barrier.trim() === "") return row;
  const numericBarrier = Number(barrier);
  return Number.isFinite(numericBarrier) ? { ...row, barrier: numericBarrier } : row;
}

async function withCredential<T>(
  userId: string,
  operation: () => Promise<T>,
  serialize = true,
): Promise<T> {
  const run = async () => {
    let [credential] = await db
      .select()
      .from(derivCredentialsTable)
      .where(eq(derivCredentialsTable.clerkUserId, userId))
      .limit(1);
    let hasStoredCredential = Boolean(credential);
    if (credential) {
      let pat: string;
      try {
        pat = decryptPat(credential.encryptedPat);
      } catch {
        await db.delete(derivCredentialsTable).where(eq(derivCredentialsTable.clerkUserId, userId));
        hasStoredCredential = false;
        throw new InvalidStoredCredentialError("The saved Deriv token is no longer readable. Enter it again to reconnect.");
      }
      setUserPat(userId, pat);
      const syncSelectedSession = async () => {
        if (credential?.selectedAccountId && getStatus().account?.id !== credential.selectedAccountId) {
          await selectAccount(credential.selectedAccountId);
        }
        if (credential?.selectedSymbol && getStatus().symbol !== credential.selectedSymbol) {
          await selectSymbol(credential.selectedSymbol);
        }
      };
      if (credential?.selectedAccountId || credential?.selectedSymbol) {
        if (serialize) await syncSelectedSession();
        else await withUserSerialized(userId, syncSelectedSession);
      }
    }
    if (!hasStoredCredential) throw new MissingDerivCredentialError("Connect a Deriv token first");
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof DerivCredentialError)) throw error;
      if (error.status !== 401) throw error;
      await db.delete(derivCredentialsTable).where(eq(derivCredentialsTable.clerkUserId, userId));
      disposeUser(userId);
      throw new InvalidStoredCredentialError("The saved Deriv token was rejected. Enter your PAT again to reconnect.");
    }
  };
  return serialize
    ? withUserSerialized(userId, () => withDistributedUserLock(userId, run))
    : withUser(userId, run);
}

router.get("/deriv/accounts", async (req, res) => {
  try {
    const accounts = GetDerivAccountsResponse.parse(await withCredential(res.locals.userId, getAccounts, false));
    res.set("Cache-Control", "no-store");
    res.json(accounts);
  } catch (error) {
    if (isCapacityError(error)) {
      res.status(503).json({ error: error.message });
      return;
    }
    if (isCredentialError(error)) {
      res.status(credentialHttpStatus(error)).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Unable to load Deriv accounts");
    res.status(502).json({ error: "Unable to load Deriv accounts from Deriv" });
  }
});

router.get("/deriv/status", (_req, res) => {
  void withCredential(res.locals.userId, getLiveStatus, false)
    .then((status) => {
      res.set("Cache-Control", "no-store");
      res.json(GetDerivStatusResponse.parse(status));
    })
    .catch((error) => {
       if (isCapacityError(error)) {
         res.status(503).json({ error: error.message });
         return;
       }
       const missingCredential = isCredentialError(error);
       res.status(missingCredential ? credentialHttpStatus(error) : 502).json({
         error: missingCredential ? error.message : "Unable to refresh Deriv balance",
      });
    });
});

router.get("/deriv/history", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const snapshot = await withCredential(res.locals.userId, async () => {
      let refreshError: unknown = null;
      try {
        await refreshDerivHistory();
      } catch (error) {
        if (isCredentialError(error) || isCapacityError(error)) throw error;
        refreshError = error;
      }
      return { history: await getHistory(), refreshError };
    }, false);
    const historySnapshot = Array.isArray(snapshot.history)
      ? snapshot.history.map(normalizeHistoryBarrier)
      : snapshot.history;
    let historyResult = GetDerivHistoryResponse.safeParse(historySnapshot);
    let stale = snapshot.refreshError != null;
    if (!historyResult.success) {
      if (!Array.isArray(historySnapshot)) throw historyResult.error;
      const validationError = historyResult.error;
      const validRows = historySnapshot.flatMap((row) => {
        const parsedRow = GetDerivHistoryResponse.safeParse([row]);
        return parsedRow.success ? parsedRow.data : [];
      });
      historyResult = GetDerivHistoryResponse.safeParse(validRows);
      if (!historyResult.success) throw historyResult.error;
      stale = true;
      req.log.warn(
        { err: validationError, receivedRows: historySnapshot.length, returnedRows: validRows.length },
        "Filtered invalid rows from the cached Deriv history snapshot",
      );
    }
    res.set("X-Deriv-History-Stale", stale ? "true" : "false");
    if (stale) {
      req.log.warn(
        { err: snapshot.refreshError },
        "Serving the account-scoped cached Deriv history after a temporary refresh failure",
      );
    }
    return res.json(historyResult.data);
  } catch (error) {
    if (isCapacityError(error)) {
      return res.status(503).json({ error: error.message });
    }
    const missingCredential = isCredentialError(error);
    if (!missingCredential) req.log.error({ err: error }, "Unable to load Deriv history");
    return res.status(missingCredential ? credentialHttpStatus(error) : 502).json({
      error: missingCredential ? error.message : "Unable to load Deriv history",
    });
  }
});

router.get("/deriv/events", async (req, res): Promise<void> => {
  let unsubscribeHistory: (() => void) | null = null;
  let unsubscribeMarketTicks: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  const includeMarketTicks = req.query.market_ticks === "true";
  const cleanup = () => {
    unsubscribeHistory?.();
    unsubscribeHistory = null;
    unsubscribeMarketTicks?.();
    unsubscribeMarketTicks = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };
  res.on("close", cleanup);

  try {
    await withCredential(res.locals.userId, async () => {
      await getLiveStatus();
      if (res.destroyed) return;

      res.status(200);
      res.set({
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();

      unsubscribeHistory = subscribeDerivHistoryUpdates((item) => {
        if (!res.destroyed) {
          res.write(`event: trade-update\ndata: ${JSON.stringify(item)}\n\n`);
        }
      });
      res.write(`event: history-snapshot\ndata: ${JSON.stringify(getHistory())}\n\n`);
      if (includeMarketTicks) {
        unsubscribeMarketTicks = subscribeDerivMarketTickUpdates((tick) => {
          if (!res.destroyed) {
            res.write(`event: market-tick\ndata: ${JSON.stringify(tick)}\n\n`);
          }
        });
        res.write(`event: market-tick-snapshot\ndata: ${JSON.stringify(getMarketTickSnapshot())}\n\n`);
      }
      heartbeat = setInterval(() => {
        if (!res.destroyed) res.write(": keep-alive\n\n");
        void withUser(res.locals.userId, async () => undefined);
      }, 25_000);
      heartbeat.unref();
    }, false);
  } catch (error) {
    cleanup();
    if (res.headersSent) {
      req.log.warn({ err: error }, "Deriv trade update stream stopped");
      res.end();
      return;
    }
    if (isCapacityError(error)) {
      res.status(503).json({ error: error.message });
      return;
    }
    const missingCredential = isCredentialError(error);
    if (!missingCredential) req.log.error({ err: error }, "Unable to start Deriv trade update stream");
    res.status(missingCredential ? credentialHttpStatus(error) : 502).json({
      error: missingCredential ? error.message : "Unable to start Deriv trade update stream",
    });
  }
});

router.delete("/deriv/history", (_req, res) => {
  res.set("Cache-Control", "no-store");
  withCredential(res.locals.userId, async () => clearHistory(), false)
    .then((result) => res.json(result))
     .catch((error) => {
       if (isCapacityError(error)) {
         return res.status(503).json({ error: error.message });
       }
       const missingCredential = isCredentialError(error);
        return res.status(missingCredential ? credentialHttpStatus(error) : 502).json({
       error: missingCredential ? error.message : "Unable to clear Deriv history",
       });
     });
});

router.post("/deriv/test-connection", async (req, res) => {
  try {
    const result = TestDerivConnectionResponse.parse(await withCredential(res.locals.userId, testConnection, true));
    res.json(result);
  } catch (error) {
    if (isCapacityError(error)) {
      res.status(503).json({ error: error.message });
      return;
    }
    if (isCredentialError(error)) {
      res.status(credentialHttpStatus(error)).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Deriv connection test failed");
    res.status(502).json({ error: "Deriv connection test failed" });
  }
});

router.post("/deriv/proposals", async (req, res) => {
  const parsed = RequestDerivProposalBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid proposal request" });
  }

  try {
    const result = RequestDerivProposalResponse.parse(await withCredential(res.locals.userId, () => requestProposal(parsed.data), true));
    return res.status(202).json(result);
  } catch (error) {
    req.log.error({ err: error }, "Deriv proposal request failed");
    if (isCapacityError(error)) {
      return res.status(503).json({ error: error.message });
    }
     const missingCredential = isCredentialError(error);
      return res.status(missingCredential ? credentialHttpStatus(error) : 503).json({
       error: missingCredential ? error.message : "Deriv WebSocket is not ready",
    });
  }
});

router.post("/deriv/accumulator-knockout-scan", async (req, res) => {
  const parsed = ScanDerivAccumulatorKnockoutBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Accumulator scan request" });
  }

  try {
    const result = ScanDerivAccumulatorKnockoutResponse.parse(
      await withCredential(res.locals.userId, () => scanAccumulatorKnockout(parsed.data), true),
    );
    return res.json(result);
  } catch (error) {
    if (isCapacityError(error)) {
      return res.status(503).json({ error: error.message });
    }
    if (isCredentialError(error)) {
      return res.status(credentialHttpStatus(error)).json({ error: error.message });
    }
    req.log.warn({ err: error }, "Money Bank Auto Knockout scan did not pass");
    return res.status(409).json({
      error: error instanceof Error ? error.message : "Money Bank Auto Knockout could not verify the selected market.",
    });
  }
});

router.post("/deriv/select-account", async (req, res) => {
  const parsed = SelectDerivAccountBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid account selection" });

  try {
    const result = SelectDerivAccountResponse.parse(await withCredential(res.locals.userId, async () => {
      const selected = await selectAccount(parsed.data.account_id);
      await db.update(derivCredentialsTable)
        .set({ selectedAccountId: parsed.data.account_id, updatedAt: new Date() })
        .where(eq(derivCredentialsTable.clerkUserId, res.locals.userId));
      return selected;
    }, true));
    return res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "Deriv account selection failed");
    if (isCapacityError(error)) {
      return res.status(503).json({ error: error.message });
    }
     const missingCredential = isCredentialError(error);
      return res.status(missingCredential ? credentialHttpStatus(error) : 502).json({ error: missingCredential ? error.message : "Unable to select account" });
  }
});

router.post("/deriv/select-symbol", async (req, res) => {
  const parsed = SelectDerivSymbolBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid market selection" });
  try {
    const result = SelectDerivSymbolResponse.parse(await withCredential(res.locals.userId, async () => {
      const selected = await selectSymbol(parsed.data.symbol);
      await db.update(derivCredentialsTable)
        .set({ selectedSymbol: parsed.data.symbol, updatedAt: new Date() })
        .where(eq(derivCredentialsTable.clerkUserId, res.locals.userId));
      return selected;
    }, true));
    return res.json(result);
  } catch (error) {
    if (isCapacityError(error)) {
      return res.status(503).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : "Unable to select market";
     const missingCredential = isCredentialError(error);
      return res.status(missingCredential ? credentialHttpStatus(error) : 400).json({ error: missingCredential ? error.message : message });
  }
});

router.post("/deriv/buy", requireTradeAccessFeature, async (req, res) => {
  const parsed = BuyDerivContractBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid trade request" });
  if (
    parsed.data.access_feature === "cash-grab"
    && (!Number.isInteger(parsed.data.duration) || parsed.data.duration < 1 || parsed.data.duration > 5)
  ) {
    return res.status(400).json({ error: "Cash Grab supports whole-number durations from 1 to 5 ticks." });
  }
  if (
    parsed.data.access_feature === "money-bank"
    && (
      parsed.data.contract_type !== "ACCU"
      || !Number.isInteger(parsed.data.duration)
      || parsed.data.duration < 5
      || parsed.data.duration > 50
    )
  ) {
    return res.status(400).json({ error: "Money Bank supports Accumulator contracts from 5 to 50 ticks." });
  }

  try {
    if (parsed.data.automated === true) {
      const [adminSettings] = await db.select().from(adminFeatureSettingsTable).limit(1);
      const settings = adminSettings?.settings ?? {};
      if (settings.auto_trader_2_paused === true) {
        const message = typeof settings.auto_trader_2_pause_message === "string"
          ? settings.auto_trader_2_pause_message.slice(0, 300)
          : "Auto Trader 2.0 is temporarily paused by an administrator.";
        return res.status(409).json({ error: message, code: "AUTO_TRADER_2_PAUSED" });
      }
    }
    const assertAuthorized = () => assertAccessSessionActive(res.locals.accessSessionId, res.locals.accessKeyId);
    const result = BuyDerivContractResponse.parse(await withCredential(
      res.locals.userId,
      async () => {
        await assertAuthorized();
        return buyContract(parsed.data, assertAuthorized);
      },
      true,
    ));
    return res.status(202).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Buy request failed";
    req.log.error({ err: error }, "Deriv live buy request failed");
    if (isDerivBuyRateLimitError(error)) {
      return res.status(429).json({
        error: "Deriv temporarily limited new buys. The request was safely retried; check account history before repeating it.",
        code: "DERIV_BUY_RATE_LIMITED",
        diagnostic_source: "deriv",
        trade_outcome: tradeOutcomeForRouteError(error, 429),
      });
    }
     const status = isCapacityError(error)
       ? 503
       : isCredentialError(error)
       ? credentialHttpStatus(error)
        : error instanceof AccessSessionRevokedError
        ? 403
      : message.includes("disabled") || message.includes("real account")
      ? 403
       : message.includes("still settling") || message.includes("account status is being refreshed") || message.includes("safety timeout") || message.toLowerCase().includes("global trading protection")
         ? 409
      : message.includes("cooldown")
        ? 429
       : message.includes("not available") || message.includes("balance") || message.includes("confirmation") || message.includes("offers no return") || message.includes("duration")
        ? 400
        : message.includes("did not return a proposal") || message.includes("WebSocket is not ready")
          ? 504
        : 502;
     return res.status(status).json({
       error: message,
       diagnostic_source: tradeErrorSourceForRoute(error, status),
       trade_outcome: tradeOutcomeForRouteError(error, status),
     });
  }
});

router.post("/deriv/sell", async (req, res) => {
  const parsed = SellDerivContractBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid contract close request" });

  try {
    const result = SellDerivContractResponse.parse(
      await withCredential(res.locals.userId, () => sellContract(parsed.data.contract_id), true),
    );
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Contract close request failed";
    req.log.error({ err: error }, "Deriv contract close request failed");
    const status = isCapacityError(error)
      ? 503
      : isCredentialError(error)
      ? credentialHttpStatus(error)
      : message.includes("WebSocket is not ready")
        ? 504
        : 502;
     return res.status(status).json({
       error: message,
       diagnostic_source: tradeErrorSourceForRoute(error, status),
       trade_outcome: tradeOutcomeForRouteError(error, status),
     });
  }
});

router.post("/deriv/bulk-buy", requireTradeAccessFeature, async (req, res) => {
  const parsed = BulkBuyDerivContractsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid bulk buy request" });
  if (parsed.data.access_feature === "bulk-trader") {
    if (
      parsed.data.contract_type !== "DIGITOVER"
      && parsed.data.contract_type !== "DIGITUNDER"
      && parsed.data.contract_type !== "DIGITDIFF"
    ) {
      return res.status(400).json({
        error: "Bulk Trader only accepts Digit Over, Digit Under, and Digit Differs contracts.",
      });
    }
    if (!Number.isInteger(parsed.data.duration) || parsed.data.duration < 1 || parsed.data.duration > 5) {
      return res.status(400).json({ error: "Bulk Trader supports whole-number durations from 1 to 5 ticks." });
    }
  }
  if (parsed.data.access_feature === "trade-x") {
    if (parsed.data.contract_type !== "DIGITDIFF") {
      return res.status(400).json({ error: "Trade X only accepts Digit Differs contracts." });
    }
    if (parsed.data.count !== 1) {
      return res.status(400).json({ error: "Trade X sends one contract per action." });
    }
    if (!Number.isInteger(parsed.data.duration) || parsed.data.duration < 1 || parsed.data.duration > 5) {
      return res.status(400).json({ error: "Trade X supports whole-number durations from 1 to 5 ticks." });
    }
    if (parsed.data.amount < 0.35) {
      return res.status(400).json({ error: "Trade X stake must be at least 0.35." });
    }
  }
  if (
    parsed.data.access_feature === "auto-trader"
    && (!Number.isInteger(parsed.data.duration) || parsed.data.duration < 1 || parsed.data.duration > 5)
  ) {
    res.status(400).json({ error: "Auto Trader supports whole-number durations from 1 to 5 ticks." });
    return;
  }
  if (
    parsed.data.access_feature === "cash-grab"
    && (!Number.isInteger(parsed.data.duration) || parsed.data.duration < 1 || parsed.data.duration > 5)
  ) {
    return res.status(400).json({ error: "Cash Grab supports whole-number durations from 1 to 5 ticks." });
  }

  try {
    const result = BulkBuyDerivContractsResponse.parse(
      await withCredential(res.locals.userId, async () => {
        const assertAuthorized = () => assertAccessSessionActive(res.locals.accessSessionId, res.locals.accessKeyId);
        await assertAuthorized();
        return bulkBuyContracts(
          parsed.data,
          assertAuthorized,
          parsed.data.access_feature === "auto-trader" || parsed.data.access_feature === "bulk-trader",
        );
      }, true),
    );
    return res.status(202).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk buy request failed";
    req.log?.error({ err: error }, "Deriv bulk buy request failed");
    if (isDerivBuyRateLimitError(error)) {
      return res.status(429).json({
        error: "Deriv temporarily limited new buys. Some earlier batch contracts may already be open; check account history before sending another batch.",
        code: "DERIV_BUY_RATE_LIMITED",
        diagnostic_source: "deriv",
        trade_outcome: tradeOutcomeForRouteError(error, 429),
      });
    }
    const status = isCapacityError(error)
      ? 503
      : isCredentialError(error)
      ? credentialHttpStatus(error)
        : error instanceof AccessSessionRevokedError
        ? 403
      : message.includes("disabled") || message.includes("real account")
      ? 403
      : message.includes("still settling") || message.includes("account status is being refreshed") || message.includes("safety timeout") || message.toLowerCase().includes("global trading protection")
        ? 409
       : message.includes("not available") || message.includes("balance") || message.includes("confirmation") || message.includes("offers no return") || message.includes("duration")
        ? 400
        : message.includes("did not return a proposal") || message.includes("WebSocket is not ready")
          ? 504
        : 502;
     return res.status(status).json({
       error: message,
       diagnostic_source: tradeErrorSourceForRoute(error, status),
       trade_outcome: tradeOutcomeForRouteError(error, status),
     });
  }
});

router.post("/deriv/dual-buy", requireTradeAccessFeature, async (req, res) => {
  const parsed = DualBuyDerivContractsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid dual buy request" });

  try {
    const result = BulkBuyDerivContractsResponse.parse(
      await withCredential(res.locals.userId, async () => {
        const assertAuthorized = () => assertAccessSessionActive(res.locals.accessSessionId, res.locals.accessKeyId);
        await assertAuthorized();
        return dualBuyContracts(parsed.data, assertAuthorized);
      }, true),
    );
    return res.status(202).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dual buy request failed";
    req.log.error({ err: error }, "Deriv dual buy request failed");
    if (isDerivBuyRateLimitError(error)) {
      return res.status(429).json({
        error: "Deriv temporarily limited new buys. One contract may already be open; check account history before repeating the pair.",
        code: "DERIV_BUY_RATE_LIMITED",
        diagnostic_source: "deriv",
        trade_outcome: tradeOutcomeForRouteError(error, 429),
      });
    }
    const status = isCapacityError(error)
      ? 503
      : isCredentialError(error)
      ? credentialHttpStatus(error)
        : error instanceof AccessSessionRevokedError
        ? 403
      : message.includes("disabled") || message.includes("real account")
      ? 403
      : message.includes("still settling") || message.includes("account status is being refreshed") || message.includes("safety timeout") || message.toLowerCase().includes("global trading protection")
        ? 409
       : message.includes("not available") || message.includes("balance") || message.includes("confirmation") || message.includes("offers no return")
        ? 400
        : message.includes("did not return a proposal") || message.includes("WebSocket is not ready")
          ? 504
        : 502;
     return res.status(status).json({
       error: message,
       diagnostic_source: tradeErrorSourceForRoute(error, status),
       trade_outcome: tradeOutcomeForRouteError(error, status),
     });
  }
});

router.post("/deriv/clock-work/quotes", requireAccessFeature("clock-work"), async (req, res) => {
  const parsed = QuoteClockWorkContractsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid Clock Work quote request" });

  try {
    const result = QuoteClockWorkContractsResponse.parse(
      await withCredential(res.locals.userId, () => quoteClockWorkContracts(parsed.data), true),
    );
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clock Work quote request failed";
    if (isCapacityError(error)) return res.status(503).json({ error: error.message });
    if (isCredentialError(error)) return res.status(credentialHttpStatus(error)).json({ error: error.message });
    req.log.warn({ err: error }, "Clock Work quote request failed");
    return res.status(message.includes("needs") || message.includes("must") || message.includes("supported") ? 400 : 503)
      .json({ error: message });
  }
});

router.post("/deriv/clock-work/buy", requireAccessFeature("clock-work"), async (req, res) => {
  const parsed = BuyClockWorkContractsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid Clock Work buy request" });

  try {
    const assertAuthorized = () => assertAccessSessionActive(res.locals.accessSessionId, res.locals.accessKeyId);
    const result = BuyClockWorkContractsResponse.parse(await withCredential(
      res.locals.userId,
      async () => {
        await assertAuthorized();
        return buyClockWorkContracts(parsed.data, assertAuthorized);
      },
      true,
    ));
    return res.status(202).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clock Work buy request failed";
    req.log.error({ err: error }, "Clock Work buy request failed");
    if (isDerivBuyRateLimitError(error)) {
      return res.status(429).json({
        error: "Deriv temporarily limited new buys. Check account history before sending another Clock Work batch.",
        code: "DERIV_BUY_RATE_LIMITED",
        diagnostic_source: "deriv",
        trade_outcome: tradeOutcomeForRouteError(error, 429),
      });
    }
    const status = isCapacityError(error)
      ? 503
      : isCredentialError(error)
      ? credentialHttpStatus(error)
      : error instanceof AccessSessionRevokedError
      ? 403
      : message.includes("disabled")
      ? 403
      : message.includes("still settling") || message.includes("account status is being refreshed") || message.includes("safety timeout") || message.toLowerCase().includes("global trading protection")
      ? 409
      : message.includes("stake") || message.includes("market") || message.includes("barrier") || message.includes("five-tick") || message.includes("supports") || message.includes("contract keys")
      ? 400
      : message.includes("did not return a proposal") || message.includes("WebSocket is not ready")
      ? 503
      : 502;
    return res.status(status).json({
      error: message,
      diagnostic_source: tradeErrorSourceForRoute(error, status),
      trade_outcome: tradeOutcomeForRouteError(error, status),
    });
  }
});

export default router;