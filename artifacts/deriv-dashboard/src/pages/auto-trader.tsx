import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertCircle, ArrowDownRight, ArrowUpRight, BookOpen, Check,
  ChevronLeft, ChevronRight, CircleHelp, Clock3, Crosshair,
  Pause, Play, Radar, RefreshCw, Settings2, ShieldAlert, Signal, Target, X,
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
import "./auto-trader.css";

type MarketGroup = "regular" | "jump" | "one-sec";
type Market = { symbol: string; name: string; group: MarketGroup };

const markets: Market[] = [
  { symbol: "R_10", name: "Volatility 10", group: "regular" },
  { symbol: "R_25", name: "Volatility 25", group: "regular" },
  { symbol: "R_50", name: "Volatility 50", group: "regular" },
  { symbol: "R_75", name: "Volatility 75", group: "regular" },
  { symbol: "R_100", name: "Volatility 100", group: "regular" },
  { symbol: "R_150", name: "Volatility 150", group: "regular" },
  { symbol: "R_250", name: "Volatility 250", group: "regular" },
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
const storagePrefix = "deriv-auto-trader-contracts:";
const guideCopy = [
  ["Welcome to Auto Trader", "Read live last-digit counts and place one-tick Digit Differs contracts from the scanner.", "Signals describe observed ticks. They do not predict or guarantee the next result."],
  ["Connect a Deriv account", "The selected account is shown in the header with its live balance and account type.", "Use a demo account while familiarizing yourself with the controls."],
  ["Real and demo accounts", "Real-account orders use real funds. Demo orders use virtual funds.", "Confirm the account badge before every trade."],
  ["Scanner markets", "The scanner shows 7 regular Volatility markets, 5 Jump markets and 5 Volatility 1s markets.", "Category buttons filter the cards; there is no separate market-selection list."],
  ["Market groups", "Use the category filters to focus the scanner without changing its live data source.", "All markets shows the same 17 symbols."],
  ["Go Live", "Go Live starts a fresh count from the next real ticks observed from Deriv.", "There are no simulated ticks or starting sample counts."],
  ["Stop and Rescan", "Stop pauses the scanner. Rescan resets the count baseline to the latest live tick sequence.", "Stopping does not cancel an order already accepted by Deriv."],
  ["Live digit counts", "Each digit column shows its observed count since this scan began.", "A zero count is shown in green; other counts use standard text."],
  ["Tick counts", "Each market has its own count, starting at one when its first new tick arrives after Go Live.", "The count advances only from new Deriv ticks."],
  ["Missed updates", "Recent tick digits let the scanner recover sequence updates between polls.", "If a market is disconnected, its counts wait for real ticks to resume."],
  ["Digit Differs", "A Digit Differs contract wins if its final digit at expiry is different from the selected barrier.", "Deriv determines the contract result at expiry."],
  ["Trade Now", "Trade Now places one contract on the currently least-observed digit from the live scanner.", "It is a single independent contract."],
  ["3× and 6× buttons", "Each digit column has buttons for three or six separate one-tick contracts.", "Separate contracts can settle differently; the batch is not all-or-none."],
  ["Order confirmations", "Check the result message and account history after placing a trade.", "If the connection drops during an order, its outcome may be unknown. Check Deriv history before retrying."],
  ["Stake", "Stake is the requested amount for each contract in a batch.", "The total requested exposure grows with the batch size. Check your balance first."],
  ["Risk settings", "Take-profit and stop-loss values are planning fields for the manual session.", "Automatic stopping is not active in this workspace."],
  ["Start is deferred", "Start remains visible while strategy automation is being defined.", "It does not place trades or run in the background."],
  ["5m Auto is deferred", "The 5m Auto control is reserved for a future strategy workflow.", "It is intentionally inactive and will not trade."],
  ["Daily stats and history", "Daily metrics only include contract IDs placed from this page in the selected account.", "Trades from other Deriv features are excluded."],
  ["A considered workflow", "Review account, market, digit, stake and batch size before each manual order.", "No frequency pattern guarantees an outcome. Trade within your own risk limits."],
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
  const token = useGetDerivTokenStatus({ query: { queryKey: getGetDerivTokenStatusQueryKey(), retry: false } });
  const hasToken = token.data?.has_token === true;
  const [scanning, setScanning] = useState(false);
  const accounts = useGetDerivAccounts({
    query: { queryKey: getGetDerivAccountsQueryKey(), enabled: hasToken, retry: false, refetchInterval: 10_000 },
  });
  const status = useGetDerivStatus({
    query: {
      queryKey: getGetDerivStatusQueryKey(),
      enabled: hasToken,
      retry: false,
      refetchInterval: scanning ? 500 : false,
    },
  });
  const history = useGetDerivHistory({
    query: { queryKey: getGetDerivHistoryQueryKey(), enabled: hasToken, retry: false, refetchInterval: hasToken ? 2_000 : false },
  });
  const bulkBuy = useBulkBuyDerivContracts();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [stake, setStake] = useState("1.00");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guidePage, setGuidePage] = useState(0);
  const [takeProfit, setTakeProfit] = useState("10");
  const [stopLoss, setStopLoss] = useState("10");
  const [strategy, setStrategy] = useState("flat");
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
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
    setFrequencies({});
    setMarketTicks({});
    seenTicks.current = {};
    baselineTicks.current = {};
  }, [accountId]);

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
    setScanning(false);
    setMessage(null);
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
  };

  const filteredMarkets = useMemo(
    () => filter === "all" ? markets : markets.filter((market) => market.group === filter),
    [filter],
  );
  const signalBySymbol = useMemo(
    () => new Map(currentSignals.map((signal) => [signal.symbol, signal])),
    [currentSignals],
  );
  const tradeNowTarget = useMemo(() => {
    let best: { market: Market; digit: number; share: number } | null = null;
    for (const market of markets) {
      const counts = frequencies[market.symbol] ?? [];
      const total = counts.reduce((sum, count) => sum + count, 0);
      if (!total) continue;
      for (let digit = 0; digit < counts.length; digit += 1) {
        const count = counts[digit];
        const share = count / total;
        if (!best || share < best.share) best = { market, digit, share };
      }
    }
    return best;
  }, [frequencies]);
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
  const settled = todaysHistory.filter((item) => item.status !== "open" && item.status !== "pending");
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
    if (!accountId || !connected) {
      setMessage({ tone: "error", text: "Connect and select a Deriv account before trading." });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage({ tone: "error", text: "Enter a valid stake greater than zero." });
      return;
    }
    setMessage(null);
    let result: Awaited<ReturnType<typeof bulkBuy.mutateAsync>>;
    try {
      result = await bulkBuy.mutateAsync({
        data: {
          amount,
          duration: 1,
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
      text: `${result.buys.length} contract${result.buys.length === 1 ? "" : "s"} accepted for ${market.name}, digit ${digit}. Separate contracts can settle differently.${trackingNote}`,
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
            <div className="at-stat"><span>DAILY P/L</span><strong className={dailyProfit >= 0 ? "positive" : "negative"}>{dailyProfit >= 0 ? "+" : ""}{money(dailyProfit, currency)}</strong><small>Page-placed contracts</small></div>
            <div className="at-stat"><span>TRADES</span><strong>{todayIds.size}</strong><small>Contracts placed today</small></div>
            <div className="at-stat"><span>WINS / LOSSES</span><strong><em>{wins}</em><i>/</i><b>{losses}</b></strong><small>{settled.length ? `${((wins / settled.length) * 100).toFixed(1)}% win rate` : "Win rate —"}</small></div>
          </div>
        </section>

        <div className="at-workspace-grid">
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
                <button type="button" className="at-icon-button" onClick={() => void startScan()} disabled={!connected || status.isFetching} aria-label="Rescan markets" data-testid="button-rescan"><RefreshCw size={15} /> Rescan</button>
                {scanning ? (
                  <button type="button" className="at-stop-button" onClick={() => { setScanning(false); setMessage({ tone: "info", text: "Scan paused. No further digit counts will be added." }); }} data-testid="button-stop-scan"><Pause size={14} /> Stop</button>
                ) : (
                  <button type="button" className="at-live-button" onClick={() => void startScan()} disabled={!connected || status.isFetching} data-testid="button-go-live"><Play size={14} /> Go Live</button>
                )}
              </div>
            </header>

            <div className="at-filterbar" role="tablist" aria-label="Filter markets">
              {([
                ["all", "All markets", 17],
                ["regular", "Volatility", 7],
                ["jump", "Jump", 5],
                ["one-sec", "Volatility 1s", 5],
              ] as [FilterKey, string, number][]).map(([key, label, count]) => (
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
                <span>{connected ? "Select Go Live to reveal the 17 live markets and begin counting real ticks." : "Connect and select an authorized Deriv account before starting a live scan."}</span>
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

          <aside className="at-order-column">
            <section className="at-order-panel" aria-labelledby="order-title">
              <div className="at-order-topline"><span><Crosshair size={14} /> MANUAL EXECUTION</span><span className="at-contract-tag">DIGIT DIFFERS</span></div>
              <h2 id="order-title">Trade Now</h2>
              <p className="at-order-description">One contract on the least-observed digit in the live scan. Use each digit's 3× or 6× buttons for batches.</p>
              <div className="at-order-selection">
                <div><span>LIVE SCAN TARGET</span><strong>{tradeNowTarget?.market.name ?? "Start the scanner first"}</strong><small>{tradeNowTarget?.market.symbol ?? "No digit data yet"}</small></div>
                <div className="at-order-digit"><span>DIGIT</span><strong>{tradeNowTarget?.digit ?? "—"}</strong></div>
              </div>
              <label className="at-field-label" htmlFor="at-stake">Stake per contract <span>{currency}</span></label>
              <div className="at-stake-input"><span>{currency}</span><input id="at-stake" type="number" min="0.01" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} aria-label="Stake per contract" data-testid="input-stake" /></div>
              <div className="at-duration-row"><span>Duration</span><strong>1 tick</strong><span className="at-fixed-duration">FIXED</span></div>
              <button
                type="button"
                className="at-trade-button"
                disabled={!connected || !scanning || !tradeNowTarget || bulkBuy.isPending}
                onClick={() => tradeNowTarget && void placeTrade(tradeNowTarget.market, tradeNowTarget.digit, 1)}
                data-testid="button-trade-now"
              >
                {bulkBuy.isPending ? <RefreshCw size={16} className="at-spin" /> : <Target size={16} />}
                {bulkBuy.isPending ? "Sending order…" : "Trade Now"}
                <span>1 contract</span>
              </button>
              <p className="at-batch-disclaimer">Each 3× or 6× action sends separate one-tick contracts from that market and digit. Contracts may settle differently.</p>
              {message && <div className={`at-action-message ${message.tone}`} role={message.tone === "error" ? "alert" : "status"} data-testid="status-trade-message">
                {message.tone === "error" ? <AlertCircle size={15} /> : <Check size={15} />}<span>{message.text}</span>
                <button type="button" aria-label="Dismiss message" onClick={() => setMessage(null)} data-testid="button-dismiss-message"><X size={13} /></button>
              </div>}
              <button type="button" className={`at-settings-toggle${settingsOpen ? " open" : ""}`} aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)} data-testid="button-settings">
                <Settings2 size={15} /> Settings <span>{settingsOpen ? "HIDE" : "RISK & STRATEGY"}</span><ChevronRight size={15} />
              </button>
              {settingsOpen && (
                <div className="at-settings-fields" data-testid="panel-settings">
                  <label>Take profit target<div className="at-inline-input"><input type="number" min="0" step="0.01" value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} data-testid="input-take-profit" /><span>{currency}</span></div></label>
                  <label>Stop loss limit<div className="at-inline-input"><input type="number" min="0" step="0.01" value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} data-testid="input-stop-loss" /><span>{currency}</span></div></label>
                  <label>Stake strategy<select value={strategy} onChange={(event) => setStrategy(event.target.value)} data-testid="select-strategy"><option value="flat">Flat stake</option><option value="step">Step-up after loss</option></select></label>
                  <div className="at-deferred-note"><ShieldAlert size={14} /> Risk fields are planning values only. Automated strategy execution is not defined.</div>
                </div>
              )}
            </section>

            <section className="at-deferred-card" aria-label="Deferred automation controls">
              <div className="at-deferred-header"><span><Activity size={14} /> AUTOMATION</span><span>DEFERRED</span></div>
              <button type="button" className="at-deferred-button" disabled aria-disabled="true" data-testid="button-start-deferred">
                <Play size={15} /> Start <span>Inactive</span>
              </button>
              <p>Strategy execution is not defined yet. Start will not place trades.</p>
              <button type="button" className="at-5m-control" disabled aria-disabled="true" data-testid="button-5m-auto"><span><Clock3 size={14} /> 5m Auto</span><span className="at-5m-badge">DEFERRED</span></button>
              <small>The 5-minute automation workflow is not active.</small>
            </section>

            <section className="at-history-panel" aria-labelledby="history-title">
              <div className="at-history-heading"><div><div className="at-section-label">ACCOUNT-SCOPED</div><h2 id="history-title">Today's trades <span>{visibleContracts.length}</span></h2></div><span className="at-history-icon"><Clock3 size={15} /></span></div>
              <div className="at-history-list" data-testid="list-trade-history">
                {history.isLoading && <div className="at-history-state skeleton-line" aria-label="Loading trade history" />}
                {!history.isLoading && visibleContracts.length === 0 && <div className="at-history-state" data-testid="empty-trade-history">No Auto Trader contracts today.<small>Trades from other features are excluded.</small></div>}
                {visibleContracts.map((trade) => (
                  <div className="at-history-row" key={trade.contract_id} data-testid={`row-trade-${trade.contract_id}`}>
                    <span className={`at-result-icon${trade.profit > 0 ? " won" : trade.profit < 0 ? " lost" : ""}`}>
                      {trade.profit > 0 ? <ArrowUpRight size={15} /> : trade.profit < 0 ? <ArrowDownRight size={15} /> : <Clock3 size={13} />}
                    </span>
                    <span className="at-history-market"><strong>{markets.find((market) => market.symbol === trade.symbol)?.name ?? trade.symbol}</strong><small>Differs {trade.barrier ?? "—"} · {trade.status}</small></span>
                    <span className={`at-history-profit${trade.profit > 0 ? " positive" : trade.profit < 0 ? " negative" : ""}`}>{trade.status === "open" ? "Open" : money(trade.profit, trade.currency)}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <section className="at-footnote">
          <CircleHelp size={14} /><span>Signals are descriptive only. Digit frequency cannot predict a future tick or guarantee a contract outcome.</span>
          <span className="at-source-badge">LIVE DERIV DATA</span>
        </section>

        <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
          <DialogContent className="at-guide-dialog" data-testid="dialog-auto-trader-guide">
            <DialogHeader>
              <div className="at-guide-overline"><BookOpen size={14} /> FIELD GUIDE <span>{String(guidePage + 1).padStart(2, "0")} / 20</span></div>
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
