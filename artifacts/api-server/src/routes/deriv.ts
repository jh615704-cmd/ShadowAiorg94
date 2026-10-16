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
  subscribeDerivHistoryUpdates,
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
} from "../lib/deriv";
import { withDistributedUserLock } from "../lib/distributed-user-lock";
import { assertAccessSessionActive, AccessSessionRevokedError } from "../lib/access-keys";
import { db, derivCredentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptPat } from "../lib/pat-crypto";
import { requireAccessFeature } from "../middlewares/requireAccess.ts";

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

function isCapacityError(error: unknown): error is DerivCapacityError {
  return error instanceof DerivCapacityError;
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

router.get("/deriv/history", (req, res) => {
  res.set("Cache-Control", "no-store");
  withCredential(res.locals.userId, async () => {
    await refreshDerivHistory();
    return getHistory();
  }, false)
    .then((history) => res.json(GetDerivHistoryResponse.parse(history)))
     .catch((error) => {
       if (isCapacityError(error)) {
         return res.status(503).json({ error: error.message });
       }
       const missingCredential = isCredentialError(error);
       if (!missingCredential) req.log.error({ err: error }, "Unable to load Deriv history");
        return res.status(missingCredential ? credentialHttpStatus(error) : 502).json({
       error: missingCredential ? error.message : "Unable to load Deriv history",
       });
     });
});

router.get("/deriv/events", async (req, res): Promise<void> => {
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = null;
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

      unsubscribe = subscribeDerivHistoryUpdates((item) => {
        if (!res.destroyed) {
          res.write(`event: trade-update\ndata: ${JSON.stringify(item)}\n\n`);
        }
      });
      res.write(`event: history-snapshot\ndata: ${JSON.stringify(getHistory())}\n\n`);
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
  const parsed = RequestDerivProposalBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Accumulator scan request" });
  }

  try {
    const result = RequestDerivProposalResponse.parse(
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

router.post("/deriv/buy", async (req, res) => {
  const parsed = BuyDerivContractBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid trade request" });

  try {
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
     const status = isCapacityError(error)
       ? 503
       : isCredentialError(error)
       ? credentialHttpStatus(error)
        : error instanceof AccessSessionRevokedError
        ? 403
      : message.includes("disabled") || message.includes("real account")
      ? 403
       : message.includes("still settling") || message.includes("checking open contracts") || message.includes("safety timeout")
         ? 409
      : message.includes("cooldown")
        ? 429
       : message.includes("not available") || message.includes("balance") || message.includes("confirmation") || message.includes("offers no return") || message.includes("duration")
        ? 400
        : message.includes("did not return a proposal") || message.includes("WebSocket is not ready")
          ? 504
        : 502;
    return res.status(status).json({ error: message });
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
    return res.status(status).json({ error: message });
  }
});

router.post("/deriv/bulk-buy", async (req, res) => {
  const parsed = BulkBuyDerivContractsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid bulk buy request" });

  try {
    const result = BulkBuyDerivContractsResponse.parse(
      await withCredential(res.locals.userId, async () => {
        const assertAuthorized = () => assertAccessSessionActive(res.locals.accessSessionId, res.locals.accessKeyId);
        await assertAuthorized();
        return bulkBuyContracts(parsed.data, assertAuthorized);
      }, true),
    );
    return res.status(202).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk buy request failed";
    req.log?.error({ err: error }, "Deriv bulk buy request failed");
    const status = isCapacityError(error)
      ? 503
      : isCredentialError(error)
      ? credentialHttpStatus(error)
        : error instanceof AccessSessionRevokedError
        ? 403
      : message.includes("disabled") || message.includes("real account")
      ? 403
      : message.includes("still settling") || message.includes("checking open contracts") || message.includes("safety timeout")
        ? 409
       : message.includes("not available") || message.includes("balance") || message.includes("confirmation") || message.includes("offers no return") || message.includes("duration")
        ? 400
        : message.includes("did not return a proposal") || message.includes("WebSocket is not ready")
          ? 504
        : 502;
    return res.status(status).json({ error: message });
  }
});

router.post("/deriv/dual-buy", async (req, res) => {
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
    const status = isCapacityError(error)
      ? 503
      : isCredentialError(error)
      ? credentialHttpStatus(error)
        : error instanceof AccessSessionRevokedError
        ? 403
      : message.includes("disabled") || message.includes("real account")
      ? 403
      : message.includes("still settling") || message.includes("checking open contracts") || message.includes("safety timeout")
        ? 409
       : message.includes("not available") || message.includes("balance") || message.includes("confirmation") || message.includes("offers no return")
        ? 400
        : message.includes("did not return a proposal") || message.includes("WebSocket is not ready")
          ? 504
        : 502;
    return res.status(status).json({ error: message });
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
    const status = isCapacityError(error)
      ? 503
      : isCredentialError(error)
      ? credentialHttpStatus(error)
      : error instanceof AccessSessionRevokedError
      ? 403
      : message.includes("disabled")
      ? 403
      : message.includes("still settling") || message.includes("checking open contracts") || message.includes("safety timeout")
      ? 409
      : message.includes("stake") || message.includes("market") || message.includes("barrier") || message.includes("five-tick") || message.includes("supports") || message.includes("contract keys")
      ? 400
      : message.includes("did not return a proposal") || message.includes("WebSocket is not ready")
      ? 503
      : 502;
    return res.status(status).json({ error: message });
  }
});

export default router;