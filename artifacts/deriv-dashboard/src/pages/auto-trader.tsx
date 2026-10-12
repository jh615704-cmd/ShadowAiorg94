import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, ArrowDownRight, ArrowUpRight, BookOpen, Check,
  ChevronLeft, ChevronRight, CircleHelp, Clock3,
  Pause, Play, Radar, RefreshCw, Settings2, ShieldAlert, Signal, Trash2, X,
} from "lucide-react";
import {
  getGetAccessSessionQueryKey,
  getGetDerivAccountsQueryKey,
  getGetDerivHistoryQueryKey,
  getGetDerivStatusQueryKey,
  getGetDerivTokenStatusQueryKey,
  useBulkBuyDerivContracts,
  useGetAccessSession,
  useGetDerivAccounts,
  useGetDerivHistory,
  useGetDerivStatus,
  useGetDerivTokenStatus,
} from "@workspace/api-client-react";
import type { DerivHistoryItem } from "@workspace/api-client-react";
import { AppShell } from "@/components/layout/app-shell";
import { DerivAccountSwitcher } from "@/components/deriv-account-switcher";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAccountBalance } from "@/lib/account-balance";
import { formatSignedDerivProfit, isDerivHistoryOpen } from "@/lib/deriv-history";
import "./auto-trader.css";

type MarketGroup = "regular" | "jump" | "one-sec";
type Market = { symbol: string; name: string; group: MarketGroup };

const markets: Market[] = [
  { symbol: "R_10", name: "Volatility 10", group: "regular" },
  { symbol: "R_25", name: "Volatility 25", group: "regular" },
  { symbol: "R_50", name: "Volatility 50", group: "regular" },
  { symbol: "R_75", name: "Volatility 75", group: "regular" },
  { symbol: "R_100", name: "Volatility 100", group: "regular" },
  { symbol: "JD10", name: "Jump 10", group: "jump" },
  { symbol: "JD25", name: "Jump 25", group: "jump" },
  { symbol: "JD50", name: "Jump 50", group: "jump" },
  { symbol: "JD75", name: "Jump 75", group: "jump" },
  { symbol: "JD100", name: "Jump 100", group: "jump" },
  { symbol: "1HZ10V", name: "Volatility 10 · 1s", group: "one-sec" },
  { symbol: "1HZ25V", name: "Volatility 25 · 1s", group: "one-sec" },
  { symbol: "1HZ50V", name: "Volatility 50 · 1s", group: "one-sec" },
  { symbol: "1HZ75V", name: "Volatility 75 · 1s", group: "one-sec" },
  { symbol: "1HZ100V", name: "Volatility 100 · 1s", group: "one-sec" },
];

const groupLabels: Record<MarketGroup, string> = {
  regular: "REGULAR VOLATILITY",
  jump: "JUMP INDICES",
  "one-sec": "VOLATILITY 1S",
};
const filterOptions: Array<[FilterKey, string, number]> = [
  ["all", "All markets", markets.length],
  ["regular", "Volatility", markets.filter((market) => market.group === "regular").length],
  ["jump", "Jump", markets.filter((market) => market.group === "jump").length],
  ["one-sec", "Volatility 1s", markets.filter((market) => market.group === "one-sec").length],
];
const storagePrefix = "deriv-auto-trader-contracts:";
const guideCopy = [
  ["What this page does", "Auto Trader displays live last-digit counts and lets you manually place Digit Differs contracts.", "Orders go to Deriv immediately when you press a 3× or 6× button."],
  ["Choose an account", "The header shows the selected account, account type, connection status, and balance.", "Real-account orders use real funds. Check the account badge before ordering."],
  ["Start the scanner", "Select Go Live to count actual Deriv ticks. Rescan starts a fresh count baseline; Stop pauses updates.", "A stopped scan does not cancel contracts already accepted by Deriv."],
  ["Find a market", "Filter the 15 instruments by Volatility, Jump, or Volatility 1s. Each market has its own tick counter.", "Counts begin with new live ticks; the scanner does not fill in sample data."],
  ["Read digit counts", "The number under each digit is how many times that final digit appeared during this scan.", "Zero means it has not appeared in the observed scan. It does not predict the next digit or guarantee a win."],
  ["Place a Digit Differs order", "Choose a digit and press 3× or 6× to send that many separate contracts using the stake and duration in Settings.", "Buttons are available after the first live tick for that market; no larger sample threshold is required. Each contract can settle differently."],
  ["Set stake and duration", "Stake is per contract. Duration is 1–5 ticks; a 2-tick duration is valid. A 6× order requests six times the per-contract stake.", "Take-profit and stop-loss fields are reference targets only; they do not automatically close trades."],
  ["Review and clear history", "Today's trades and daily totals include only contracts placed from this page on the selected account.", "Clear removes them from this page's account-scoped view. Deriv's account history is not deleted."],
  ["Check the outcome", "A Digit Differs contract is settled by Deriv at expiry; it wins only if the final digit differs from its barrier.", "A zero count, a short sample, or waiting for another tick cannot guarantee the result. If an order response is uncertain, check Deriv history before retrying."],
] as const;

type LocalContract = { id: string; placedAt: number };
type FilterKey = "all" | MarketGroup;
type Frequencies = Record<string, number[]>;
type TickMap = Record<string, number>;

const money = (amount: number | undefined, currency = "USD") =>
  amount == null || !Number.isFinite(amount)
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function AutoTraderContent() {
  const queryClient = useQueryClient();
  const access = useGetAccessSession({ query: { queryKey: getGetAccessSessionQueryKey(), retry: false } });
  const hasAutoTraderAccess = access.data?.is_admin === true || access.data?.features.includes("auto-trader") === true;
  const token = useGetDerivTokenStatus({ query: { queryKey: getGetDerivTokenStatusQueryKey(), retry: false, enabled: hasAutoTraderAccess } });
  const hasToken = token.data?.has_token === true;
  const [scanning, setScanning] = useState(false);
  const [scanResetPending, setScanResetPending] = useState(false);
  const scanRestartLockRef = useRef(false);
  const accounts = useGetDerivAccounts({
    query: { queryKey: getGetDerivAccountsQueryKey(), enabled: hasAutoTraderAccess && hasToken, retry: false, refetchInterval: 10_000 },
  });
  const status = useGetDerivStatus({
    query: {
      queryKey: getGetDerivStatusQueryKey(),
      enabled: hasAutoTraderAccess && hasToken,
      retry: false,
      refetchInterval: scanning ? 500 : false,
    },
  });
  const history = useGetDerivHistory({
    query: { queryKey: getGetDerivHistoryQueryKey(), enabled: hasAutoTraderAccess && hasToken, retry: false, refetchInterval: hasAutoTraderAccess && hasToken ? 2_000 : false },
  });
  const bulkBuy = useBulkBuyDerivContracts();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [stake, setStake] = useState("1.00");
  const [durationTicks, setDurationTicks] = useState("1");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guidePage, setGuidePage] = useState(0);
  const [takeProfit, setTakeProfit] = useState("10");
  const [stopLoss, setStopLoss] = useState("10");
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [historyClearArmed, setHistoryClearArmed] = useState(false);
  const clearHistoryTimer = useRef<number | null>(null);
  const [frequencies, setFrequencies] = useState<Frequencies>({});
  const [marketTicks, setMarketTicks] = useState<TickMap>({});
  const seenTicks = useRef<TickMap>({});
  const baselineTicks = useRef<TickMap>({});
  const account = status.data?.account ?? null;
  const accountId = account?.id ?? "";
  const currentSignals = status.data?.market_signals ?? [];

  const [localContracts, setLocalContracts] = useState<LocalContract[]>([]);
  useEffect(() => {
    if (!accountId) {
      setLocalContracts([]);
      return;
    }
    try {
      const saved = localStorage.getItem(`${storagePrefix}${accountId}`);
      const parsed = saved ? JSON.parse(saved) as LocalContract[] : [];
      setLocalContracts(Array.isArray(parsed) ? parsed.filter((entry) => typeof entry?.id === "string" && Number.isFinite(entry.placedAt)) : []);
    } catch {
      setLocalContracts([]);
    }
  }, [accountId]);

  useEffect(() => {
    // A sequence cursor belongs to one active Deriv account only.
    setScanning(false);
    setHistoryClearArmed(false);
    if (clearHistoryTimer.current !== null) {
      window.clearTimeout(clearHistoryTimer.current);
      clearHistoryTimer.current = null;
    }
    setFrequencies({});
    setMarketTicks({});
    seenTicks.current = {};
    baselineTicks.current = {};
  }, [accountId]);

  useEffect(() => () => {
    if (clearHistoryTimer.current !== null) window.clearTimeout(clearHistoryTimer.current);
  }, []);

  useEffect(() => {
    if (!scanning) return;
    const arrivals: Array<{ symbol: string; digit: number }> = [];
    const progress: TickMap = {};
    for (const market of markets) {
      const signal = currentSignals.find((candidate) => candidate.symbol === market.symbol);
      if (!signal || (signal.tick_sequence === 0 && signal.recent_digits.length === 0)) continue;

      let previous = seenTicks.current[market.symbol];
      if (previous == null) {
        // If a market first appears after Go Live, count its first newly
        // observed tick rather than importing its pre-scan history.
        previous = signal.tick_sequence - 1;
        seenTicks.current[market.symbol] = previous;
        baselineTicks.current[market.symbol] = previous;
      }

      const firstSequence = signal.tick_sequence - signal.recent_digits.length + 1;
      if (signal.tick_sequence > previous) {
        for (let index = 0; index < signal.recent_digits.length; index += 1) {
          const sequence = firstSequence + index;
          if (sequence <= previous) continue;
          const digit = signal.recent_digits[index];
          if (digit >= 0 && digit <= 9) arrivals.push({ symbol: market.symbol, digit });
        }
        seenTicks.current[market.symbol] = signal.tick_sequence;
      }

      const baseline = baselineTicks.current[market.symbol] ?? previous;
      progress[market.symbol] = Math.max(0, signal.tick_sequence - baseline);
    }
    if (arrivals.length) {
      setFrequencies((old) => {
        const next = { ...old };
        for (const arrival of arrivals) {
          const counts = [...(next[arrival.symbol] ?? Array(10).fill(0))];
          counts[arrival.digit] += 1;
          next[arrival.symbol] = counts;
        }
        return next;
      });
    }
    setMarketTicks((current) => ({ ...current, ...progress }));
  }, [scanning, currentSignals]);

  const startScan = async () => {
    if (!connected) {
      setMessage({ tone: "error", text: "Connect and select an authorized Deriv account before starting the scanner." });
      return;
    }
    if (scanRestartLockRef.current) return;
    scanRestartLockRef.current = true;
    setScanResetPending(true);
    setScanning(false);
    setMessage(null);
    try {
      const result = await status.refetch();
      if (result.error || !result.data) {
        setMessage({
          tone: "error",
          text: result.error instanceof Error ? result.error.message : "Live Deriv status could not be refreshed.",
        });
        return;
      }
      const startingSignals = result.data.market_signals ?? [];
      const baseline = Object.fromEntries(startingSignals.map((signal) => [signal.symbol, signal.tick_sequence]));
      seenTicks.current = { ...baseline };
      baselineTicks.current = { ...baseline };
      setFrequencies(Object.fromEntries(markets.map((market) => [market.symbol, Array(10).fill(0)])));
      setMarketTicks(Object.fromEntries(markets.map((market) => [market.symbol, 0])));
      setScanning(true);
      setMessage({ tone: "info", text: "Scanner live. Counts begin with the next real tick observed from Deriv." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Live Deriv status could not be refreshed.",
      });
    } finally {
      scanRestartLockRef.current = false;
      setScanResetPending(false);
    }
  };

  const clearTodayTrades = () => {
    if (!accountId) return;
    if (!historyClearArmed) {
      setHistoryClearArmed(true);
      setMessage({ tone: "info", text: "Tap the bin again to clear today's Auto Trader trades for this account." });
      if (clearHistoryTimer.current !== null) window.clearTimeout(clearHistoryTimer.current);
      clearHistoryTimer.current = window.setTimeout(() => {
        setHistoryClearArmed(false);
        clearHistoryTimer.current = null;
      }, 2500);
      return;
    }

    setHistoryClearArmed(false);
    if (clearHistoryTimer.current !== null) {
      window.clearTimeout(clearHistoryTimer.current);
      clearHistoryTimer.current = null;
    }
    setLocalContracts([]);
    try {
      localStorage.removeItem(`${storagePrefix}${accountId}`);
      setMessage({ tone: "success", text: "Auto Trader trades were cleared from this account-scoped view. Deriv's account history is unchanged." });
    } catch {
      setMessage({ tone: "error", text: "The trades were cleared from this view, but this browser could not save the change." });
    }
  };

  const filteredMarkets = useMemo(
    () => filter === "all" ? markets : markets.filter((market) => market.group === filter),
    [filter],
  );
  const signalBySymbol = useMemo(
    () => new Map(currentSignals.map((signal) => [signal.symbol, signal])),
    [currentSignals],
  );
  const todayIds = useMemo(() => new Set(
    localContracts.filter((contract) => contract.placedAt >= todayStart()).map((contract) => contract.id),
  ), [localContracts]);
  const todaysHistory = useMemo(() => {
    if (!accountId || !history.data) return [];
    return (history.data as DerivHistoryItem[]).filter((item) =>
      item.account_id === accountId
      && todayIds.has(item.contract_id)
      && (item.buy_time == null || item.buy_time * 1000 >= todayStart()),
    );
  }, [accountId, history.data, todayIds]);
  const settled = todaysHistory.filter((item) => !isDerivHistoryOpen(item.status));
  const wins = settled.filter((item) => item.profit > 0).length;
  const losses = settled.filter((item) => item.profit < 0).length;
  const dailyProfit = settled.reduce((total, item) => total + item.profit, 0);
  const currency = account?.currency ?? status.data?.currency ?? "USD";
  const accountBalance = getAccountBalance(account);
  const visibleContracts = todaysHistory
    .slice()
    .sort((a, b) => (b.buy_time ?? 0) - (a.buy_time ?? 0));
  const connected = Boolean(status.data?.connected && status.data?.authorized && hasToken);

  const placeTrade = async (market: Market, digit: number, count: 1 | 3 | 6) => {
    const amount = Number(stake);
    const duration = Number(durationTicks);
    if (!accountId || !connected) {
      setMessage({ tone: "error", text: "Connect and select a Deriv account before trading." });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage({ tone: "error", text: "Enter a valid stake greater than zero." });
      return;
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 5) {
      setMessage({ tone: "error", text: "Enter a whole-number duration from 1 to 5 ticks." });
      return;
    }
    setMessage(null);
    let result: Awaited<ReturnType<typeof bulkBuy.mutateAsync>>;
    try {
      result = await bulkBuy.mutateAsync({
        data: {
          amount,
          duration,
          duration_unit: "t",
          contract_type: "DIGITDIFF",
          barrier: digit,
          symbol: market.symbol,
          count,
        },
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The order could not be placed." });
      return;
    }

    const placedAt = Date.now();
    const fresh = result.buys.map((buy) => ({ id: String(buy.contract_id), placedAt }));
    const updated = [...localContracts.filter((item) => !fresh.some((entry) => entry.id === item.id)), ...fresh];
    setLocalContracts(updated);
    let trackingNote = "";
    try {
      localStorage.setItem(`${storagePrefix}${accountId}`, JSON.stringify(updated));
    } catch {
      trackingNote = " The order was accepted, but this browser could not save its local daily-stat tracking; check Deriv history.";
    }
    setMessage({
      tone: "success",
      text: `${result.buys.length} contract${result.buys.length === 1 ? "" : "s"} accepted for ${market.name}, digit ${digit}, ${duration} tick${duration === 1 ? "" : "s"}. Separate contracts can settle differently.${trackingNote}`,
    });
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetDerivStatusQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetDerivHistoryQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetDerivAccountsQueryKey() }),
    ]).catch((error: unknown) => {
      console.warn("Could not refresh Auto Trader data after an accepted order.", error);
    });
  };

  const renderMarket = (market: Market) => {
    const signal = signalBySymbol.get(market.symbol);
    const digits = frequencies[market.symbol] ?? Array(10).fill(0);
    const ticks = marketTicks[market.symbol] ?? 0;
    const hasMarketTicksThisScan = digits.some((count) => count > 0);
    return (
      <article
        key={market.symbol}
        className="at-market-card"
        data-testid={`card-market-${market.symbol}`}
      >
        <div className="at-market-heading">
          <span className="at-market-name">{market.name.replace("Volatility ", "V").replace(" · 1s", " 1s")}</span>
          <span className="at-market-tick-count">{ticks} {ticks === 1 ? "tick" : "ticks"}</span>
        </div>
        <div className="at-frequencies" aria-label={`Digit frequency and trade controls for ${market.name}`}>
          {digits.map((count, digit) => (
            <div className="at-digit-column" key={digit}>
              <span className="at-digit-label">{digit}</span>
              <span className={`at-digit-count${count === 0 ? " zero" : ""}`} aria-label={`${count} observations`}>{count}</span>
              <div className="at-digit-trades">
                <button type="button" disabled={!connected || !scanning || !signal || !hasMarketTicksThisScan || bulkBuy.isPending} onClick={() => void placeTrade(market, digit, 3)} aria-label={`Place three separate contracts on ${market.name}, digit ${digit}`} data-testid={`button-trade-3x-${market.symbol}-${digit}`}>3×</button>
                <button type="button" disabled={!connected || !scanning || !signal || !hasMarketTicksThisScan || bulkBuy.isPending} onClick={() => void placeTrade(market, digit, 6)} aria-label={`Place six separate contracts on ${market.name}, digit ${digit}`} data-testid={`button-trade-6x-${market.symbol}-${digit}`}>6×</button>
              </div>
            </div>
          ))}
        </div>
      </article>
    );
  };

  if (access.isLoading) {
    return (
      <AppShell title="AUTO TRADER">
        <main className="auto-trader-page">
          <div className="at-connection-note skeleton" aria-label="Loading workspace access" />
        </main>
      </AppShell>
    );
  }

  if (access.isError) {
    return (
      <AppShell title="AUTO TRADER">
        <main className="auto-trader-page">
          <div className="at-connection-note error" role="alert">
            <AlertCircle size={17} /><div><strong>Unable to confirm feature access</strong><span>Refresh the page or sign in again before using Auto Trader.</span></div>
          </div>
        </main>
      </AppShell>
    );
  }

  if (!hasAutoTraderAccess) {
    return (
      <AppShell title="AUTO TRADER">
        <main className="auto-trader-page">
          <section className="at-restricted-card" role="status" data-testid="status-auto-trader-restricted">
            <ShieldAlert size={20} />
            <div><strong>Restricted — admin access only</strong><span>Ask your administrator to grant Auto Trader access to this key.</span></div>
          </section>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell title="AUTO TRADER">
      <main className="auto-trader-page">
        <section className="at-heading">
          <div className="at-heading-copy">
            <div className="at-kicker"><span className="at-icon"><Radar size={18} /></span> DERIV SYNTHETIC INDICES <span className="at-kicker-line" /></div>
            <h1>Auto Trader</h1>
            <p>Trade X Advanced Analysis</p>
          </div>
          <div className="at-heading-actions">
            <DerivAccountSwitcher variant="cockpit" enabled={hasToken} />
          </div>
        </section>

        {access.isLoading && <div className="at-connection-note skeleton" aria-label="Loading workspace access" />}
        {!hasToken && !token.isLoading && (
          <div className="at-connection-note" role="status" data-testid="status-connect-deriv">
            <Signal size={17} /><div><strong>Deriv connection required</strong><span>Connect a Deriv account from the existing workspace settings to load live signals and place trades.</span></div>
          </div>
        )}
        {status.error && hasToken && (
          <div className="at-connection-note error" role="alert" data-testid="status-connection-error">
            <AlertCircle size={17} /><div><strong>Live status unavailable</strong><span>{status.error instanceof Error ? status.error.message : "Deriv status could not be loaded."}</span></div>
            <button type="button" onClick={() => void status.refetch()} data-testid="button-retry-status">Retry</button>
          </div>
        )}
        {accounts.error && hasToken && !status.error && (
          <div className="at-connection-note error" role="alert" data-testid="status-accounts-error">
            <AlertCircle size={17} /><div><strong>Account list unavailable</strong><span>{accounts.error instanceof Error ? accounts.error.message : "Deriv accounts could not be loaded."}</span></div>
            <button type="button" onClick={() => void accounts.refetch()} data-testid="button-retry-accounts">Retry</button>
          </div>
        )}

        <section className="at-summary" aria-label="Daily trading summary">
          <div className="at-account-strip">
            <span className={`at-account-state ${account?.type === "real" ? "real" : ""}`} data-testid="status-account-type">
              <i /> {account?.type ? `${account.type.toUpperCase()} ACCOUNT` : "NO ACCOUNT"}
            </span>
            <span className="at-account-name">{account?.id ?? "Select a Deriv account"}</span>
            <span className="at-account-balance" data-testid="text-account-balance">{money(accountBalance, currency)}</span>
            <span className="at-connection-status"><i className={connected ? "connected" : ""} />{connected ? "CONNECTED" : "OFFLINE"}</span>
          </div>
          <div className="at-stat-row">
            <div className="at-stat"><span>TODAY'S BALANCE</span><strong>{money(accountBalance, currency)}</strong><small>Selected account</small></div>
            <div className="at-stat"><span>DAILY PROFIT / LOSS</span><strong className={dailyProfit >= 0 ? "positive" : "negative"} data-testid="text-daily-profit">{formatSignedDerivProfit(dailyProfit, currency)}</strong><small>{dailyProfit > 0 ? "PROFIT" : dailyProfit < 0 ? "LOSS" : "BREAK EVEN"} · Page-placed contracts</small></div>
            <div className="at-stat"><span>TRADES</span><strong>{todayIds.size}</strong><small>Contracts placed today</small></div>
            <div className="at-stat"><span>WINS / LOSSES</span><strong><em>{wins}</em><i>/</i><b>{losses}</b></strong><small>{settled.length ? `${((wins / settled.length) * 100).toFixed(1)}% win rate` : "Win rate —"}</small></div>
          </div>
        </section>

        <div className="at-workspace-grid">
          <aside className="at-order-column">
            <section className="at-order-panel" aria-label="Auto Trader settings">
              <div className="at-order-topline"><span><Settings2 size={14} /> ORDER SETTINGS</span><span className="at-contract-tag">DIGIT DIFFERS</span></div>
              <button type="button" className={`at-settings-toggle${settingsOpen ? " open" : ""}`} aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)} data-testid="button-settings">
                <Settings2 size={15} /> Settings <span>{settingsOpen ? "HIDE" : "STAKE & RISK"}</span><ChevronRight size={15} />
              </button>
              {settingsOpen && (
                <div className="at-settings-fields" data-testid="panel-settings">
                  <label htmlFor="at-stake">Stake per contract<div className="at-stake-input"><span>{currency}</span><input id="at-stake" type="number" min="0.01" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} aria-label="Stake per contract" data-testid="input-stake" /></div></label>
                  <label htmlFor="at-duration-ticks">Duration (ticks)<div className="at-inline-input"><input id="at-duration-ticks" type="number" min="1" max="5" step="1" value={durationTicks} onChange={(event) => setDurationTicks(event.target.value)} aria-label="Duration in ticks" data-testid="input-duration-ticks" /><span>1–5</span></div></label>
                  <label>Take profit target<div className="at-inline-input"><input type="number" min="0" step="0.01" value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} data-testid="input-take-profit" /><span>{currency}</span></div></label>
                  <label>Stop loss limit<div className="at-inline-input"><input type="number" min="0" step="0.01" value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} data-testid="input-stop-loss" /><span>{currency}</span></div></label>
                  <div className="at-deferred-note"><ShieldAlert size={14} /> Take-profit and stop-loss are reference targets only.</div>
                </div>
              )}
              {message && <div className={`at-action-message ${message.tone}`} role={message.tone === "error" ? "alert" : "status"} data-testid="status-trade-message">
                {message.tone === "error" ? <AlertCircle size={15} /> : <Check size={15} />}<span>{message.text}</span>
                <button type="button" aria-label="Dismiss message" onClick={() => setMessage(null)} data-testid="button-dismiss-message"><X size={13} /></button>
              </div>}
            </section>

            <section className="at-history-panel" aria-labelledby="history-title">
              <div className="at-history-heading">
                <div><div className="at-section-label">ACCOUNT-SCOPED</div><h2 id="history-title">Today's trades <span>{visibleContracts.length}</span></h2></div>
                <button
                  type="button"
                  className={`at-history-icon${historyClearArmed ? " armed" : ""}`}
                  onClick={clearTodayTrades}
                  disabled={!accountId || history.isLoading || visibleContracts.length === 0}
                  aria-label={historyClearArmed ? "Tap again to clear today's Auto Trader trades" : "Clear today's Auto Trader trades"}
                  title={historyClearArmed ? "Tap again to clear today's Auto Trader trades" : "Clear today's Auto Trader trades"}
                  data-testid="button-clear-auto-trader-history"
                >
                  <Trash2 size={15} />{historyClearArmed && <span>Tap again</span>}
                </button>
              </div>
              <div className="at-history-list" data-testid="list-trade-history">
                {history.isLoading && <div className="at-history-state skeleton-line" aria-label="Loading trade history" />}
                {!history.isLoading && visibleContracts.length === 0 && <div className="at-history-state" data-testid="empty-trade-history">No Auto Trader contracts today.<small>Trades from other features are excluded.</small></div>}
                {visibleContracts.map((trade) => (
                  <div className="at-history-row" key={trade.contract_id} data-testid={`row-trade-${trade.contract_id}`}>
                    <span className={`at-result-icon${trade.profit > 0 ? " won" : trade.profit < 0 ? " lost" : ""}`}>
                      {trade.profit > 0 ? <ArrowUpRight size={15} /> : trade.profit < 0 ? <ArrowDownRight size={15} /> : <Clock3 size={13} />}
                    </span>
                    <span className="at-history-market"><strong>{markets.find((market) => market.symbol === trade.symbol)?.name ?? trade.symbol}</strong><small>Differs {trade.barrier ?? "—"} · {trade.status}</small></span>
                    <span className={`at-history-profit${trade.profit > 0 ? " positive" : trade.profit < 0 ? " negative" : ""}`}>{isDerivHistoryOpen(trade.status) ? "Open" : money(trade.profit, trade.currency)}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>

          <section className="at-scanner-panel" aria-labelledby="scanner-title">
            <header className="at-panel-header">
              <div>
                <div className="at-section-label"><span className="at-live-indicator" /> MARKET INTELLIGENCE</div>
                <h2 id="scanner-title">Differ Search <span>{markets.length} MARKETS</span></h2>
                <p>Live last-digit distribution · Deriv market signals</p>
              </div>
              <div className="at-scan-actions">
                <button type="button" className="at-guide-button" onClick={() => { setGuidePage(0); setGuideOpen(true); }} data-testid="button-open-guide">
                  <BookOpen size={15} /> Guide
                </button>
                <button type="button" className="at-icon-button" onClick={() => void startScan()} disabled={!connected || scanResetPending} aria-label="Rescan markets" data-testid="button-rescan"><RefreshCw size={15} className={scanResetPending ? "at-spin" : ""} /> Rescan</button>
                {scanning ? (
                  <button type="button" className="at-stop-button" onClick={() => { setScanning(false); setMessage(null); }} data-testid="button-stop-scan"><Pause size={14} /> Stop</button>
                ) : (
                  <button type="button" className="at-live-button" onClick={() => void startScan()} disabled={!connected || scanResetPending} data-testid="button-go-live"><Play size={14} /> Go Live</button>
                )}
              </div>
            </header>

            <div className="at-filterbar" role="tablist" aria-label="Filter markets">
              {filterOptions.map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  className={filter === key ? "selected" : ""}
                  onClick={() => setFilter(key)}
                  data-testid={`button-filter-${key}`}
                >{label}<span>{count}</span></button>
              ))}
            </div>

            <div className="at-scan-status" data-testid="status-scanner">
              <span className={scanning ? "is-live" : ""}><i />{scanning ? "SCANNING LIVE MARKETS" : "SCAN PAUSED"}</span>
              <span>{filteredMarkets.length} instruments in view</span>
              <span className="at-source-note">No simulated feed</span>
            </div>

            {!scanning && (
              <div className="at-empty-overlay" data-testid="empty-market-signals">
                <Signal size={22} />
                <strong>{connected ? "Scanner is paused" : "Awaiting a Deriv connection"}</strong>
                <span>{connected ? `Select Go Live to reveal the ${markets.length} live markets and begin counting real ticks.` : "Connect and select an authorized Deriv account before starting a live scan."}</span>
              </div>
            )}
            {scanning && filteredMarkets.length > 0 && (
              <div className="at-market-list">
                {filter === "all" ? (
                  (["regular", "jump", "one-sec"] as MarketGroup[]).map((group) => (
                    <section className="at-market-group" key={group} aria-label={groupLabels[group]}>
                      <div className="at-group-heading"><span>{groupLabels[group]}</span><b>{markets.filter((market) => market.group === group).length} symbols</b></div>
                      <div className="at-market-grid">{markets.filter((market) => market.group === group).map(renderMarket)}</div>
                    </section>
                  ))
                ) : <div className="at-market-grid">{filteredMarkets.map(renderMarket)}</div>}
              </div>
            )}
            {hasToken && !status.isLoading && currentSignals.length === 0 && !status.error && (
              <div className="at-empty-inline" data-testid="empty-live-quotes"><Clock3 size={16} /> Waiting for actual Deriv ticks. No sample data is shown.</div>
            )}
          </section>
        </div>

        <section className="at-footnote">
          <CircleHelp size={14} /><span>Signals are descriptive only. Digit frequency cannot predict a future tick or guarantee a contract outcome.</span>
          <span className="at-source-badge">LIVE DERIV DATA</span>
        </section>

        <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
          <DialogContent className="at-guide-dialog" data-testid="dialog-auto-trader-guide">
            <DialogHeader>
              <div className="at-guide-overline"><BookOpen size={14} /> FIELD GUIDE <span>{String(guidePage + 1).padStart(2, "0")} / {String(guideCopy.length).padStart(2, "0")}</span></div>
              <DialogTitle>{guideCopy[guidePage][0]}</DialogTitle>
              <DialogDescription>{guideCopy[guidePage][1]}</DialogDescription>
            </DialogHeader>
            <div className="at-guide-caution"><ShieldAlert size={16} /><span>{guideCopy[guidePage][2]}</span></div>
            <div className="at-guide-progress"><span style={{ transform: `scaleX(${(guidePage + 1) / guideCopy.length})` }} /></div>
            <div className="at-guide-controls">
              <button type="button" onClick={() => setGuidePage((page) => Math.max(0, page - 1))} disabled={guidePage === 0} data-testid="button-guide-previous"><ChevronLeft size={16} /> Previous</button>
              <button type="button" onClick={() => guidePage === guideCopy.length - 1 ? setGuideOpen(false) : setGuidePage((page) => page + 1)} data-testid="button-guide-next">
                {guidePage === guideCopy.length - 1 ? "Finish" : "Next"} <ChevronRight size={16} />
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </AppShell>
  );
}

export default function AutoTraderPage() {
  return <AutoTraderContent />;
}
