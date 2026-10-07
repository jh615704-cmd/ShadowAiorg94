import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertCircle, ArrowDownRight, ArrowUpRight, BookOpen, Check,
  ChevronLeft, ChevronRight, CircleHelp, Clock3, Crosshair, Layers3,
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
import type { DerivHistoryItem, DerivMarketSignal } from "@workspace/api-client-react";
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
  { symbol: "JD10", name: "Jump 10", group: "jump" },
  { symbol: "JD25", name: "Jump 25", group: "jump" },
  { symbol: "JD50", name: "Jump 50", group: "jump" },
  { symbol: "JD75", name: "Jump 75", group: "jump" },
  { symbol: "JD100", name: "Jump 100", group: "jump" },
  { symbol: "1HZ10V", name: "Volatility 10 · 1s", group: "one-sec" },
  { symbol: "1HZ15V", name: "Volatility 15 · 1s", group: "one-sec" },
  { symbol: "1HZ25V", name: "Volatility 25 · 1s", group: "one-sec" },
  { symbol: "1HZ30V", name: "Volatility 30 · 1s", group: "one-sec" },
  { symbol: "1HZ50V", name: "Volatility 50 · 1s", group: "one-sec" },
  { symbol: "1HZ75V", name: "Volatility 75 · 1s", group: "one-sec" },
  { symbol: "1HZ90V", name: "Volatility 90 · 1s", group: "one-sec" },
  { symbol: "1HZ100V", name: "Volatility 100 · 1s", group: "one-sec" },
];

const groupLabels: Record<MarketGroup, string> = {
  regular: "REGULAR VOLATILITY",
  jump: "JUMP INDICES",
  "one-sec": "VOLATILITY 1S",
};
const storagePrefix = "deriv-auto-trader-contracts:";
const guideCopy = [
  ["Welcome to Auto Trader", "A live market workspace for reading last-digit frequency and placing explicitly selected Digit Differs contracts.", "Signals describe observed ticks. They do not predict or guarantee the next result."],
  ["Connect a Deriv account", "The selected account is shown in the header with its live balance and account type.", "Use a demo account while familiarizing yourself with the controls."],
  ["Real and demo accounts", "Real-account orders use real funds. Demo orders use virtual funds.", "Confirm the account badge before every trade."],
  ["Choose a market", "The scanner includes regular Volatility, Jump and Volatility 1s indices supported by this workspace.", "Market cards only show quotes received from Deriv."],
  ["Market groups", "Use the category filters to focus the scanner without changing its live data source.", "All markets shows all 18 supported symbols."],
  ["Go Live", "Go Live begins polling Deriv status for live market signals.", "Digit counters start at zero each time a new scan starts."],
  ["Stop and Rescan", "Stop pauses the scanner. Rescan clears the local frequency window and starts a fresh scan.", "No simulated ticks are used."],
  ["Read a quote", "The quote and last digit come from the latest status.market_signals entry for that symbol.", "A quote may not arrive for every market at the same instant."],
  ["Tick counts", "Tick counts are synchronized across cards within a market family.", "Counts reflect sequence advances reported by Deriv."],
  ["Digit frequency", "The counter beneath each digit tracks observed last digits since this scan began.", "Missed sequence history is not reconstructed from generated data."],
  ["Select a digit", "Choose one digit from 0–9. The selected state is highlighted and used as the exact barrier.", "Confirm the selected digit before sending an order."],
  ["Digit Differs", "A Digit Differs contract wins if the final digit at expiry is different from its selected barrier.", "The contract result is determined by Deriv at expiry."],
  ["Trade Now", "Trade Now sends one Digit Differs contract for the selected market, stake and digit.", "It is a single independent contract."],
  ["3× and 6× batches", "Batch controls request three or six separate contracts through the bulk-buy API.", "Deriv quotes the complete batch before buys are sent; separate contracts can settle differently."],
  ["Stake", "Stake is the requested amount for each contract in a batch.", "The total requested exposure grows with the batch size. Check your balance first."],
  ["Risk settings", "Take-profit and stop-loss values are visible planning limits for your manual session.", "Automatic stopping is not active in this workspace."],
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
    query: { queryKey: getGetDerivHistoryQueryKey(), enabled: hasToken, retry: false, refetchInterval: 1_000 },
  });
  const bulkBuy = useBulkBuyDerivContracts();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedSymbol, setSelectedSymbol] = useState("R_10");
  const [selectedDigit, setSelectedDigit] = useState(0);
  const [stake, setStake] = useState("1.00");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guidePage, setGuidePage] = useState(0);
  const [takeProfit, setTakeProfit] = useState("10");
  const [stopLoss, setStopLoss] = useState("10");
  const [strategy, setStrategy] = useState("flat");
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [frequencies, setFrequencies] = useState<Frequencies>({});
  const [groupTicks, setGroupTicks] = useState<Record<MarketGroup, number>>({ regular: 0, jump: 0, "one-sec": 0 });
  const seenTicks = useRef<TickMap>({});
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
    if (!scanning) return;
    const latest: TickMap = { ...seenTicks.current };
    const arrivals: Array<{ symbol: string; digit: number }> = [];
    const deltas: Record<MarketGroup, number> = { regular: 0, jump: 0, "one-sec": 0 };
    for (const signal of currentSignals) {
      const market = markets.find((candidate) => candidate.symbol === signal.symbol);
      if (!market) continue;
      const previous = latest[signal.symbol];
      if (previous == null) {
        latest[signal.symbol] = signal.tick_sequence;
        continue;
      }
      if (signal.tick_sequence > previous) {
        const delta = signal.tick_sequence - previous;
        latest[signal.symbol] = signal.tick_sequence;
        deltas[market.group] += delta;
        if (signal.last_digit != null) arrivals.push({ symbol: market.symbol, digit: signal.last_digit });
      }
    }
    seenTicks.current = latest;
    if (arrivals.length || deltas.regular || deltas.jump || deltas["one-sec"]) {
      setFrequencies((old) => {
        const next = { ...old };
        for (const arrival of arrivals) {
          const counts = [...(next[arrival.symbol] ?? Array(10).fill(0))];
          counts[arrival.digit] += 1;
          next[arrival.symbol] = counts;
        }
        return next;
      });
      setGroupTicks((old) => ({
        regular: old.regular + deltas.regular,
        jump: old.jump + deltas.jump,
        "one-sec": old["one-sec"] + deltas["one-sec"],
      }));
    }
  }, [scanning, currentSignals]);

  const startScan = (reset: boolean) => {
    if (reset) {
      setFrequencies({});
      setGroupTicks({ regular: 0, jump: 0, "one-sec": 0 });
    }
    seenTicks.current = Object.fromEntries(currentSignals.map((signal) => [signal.symbol, signal.tick_sequence]));
    setScanning(true);
    setMessage({ tone: "info", text: "Live scan started. Digit counters begin at zero for this scan." });
    void status.refetch();
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
  const settled = todaysHistory.filter((item) => item.status !== "open" && item.status !== "pending");
  const wins = settled.filter((item) => item.profit > 0).length;
  const losses = settled.filter((item) => item.profit < 0).length;
  const dailyProfit = settled.reduce((total, item) => total + item.profit, 0);
  const selectedMarket = markets.find((market) => market.symbol === selectedSymbol) ?? markets[0];
  const currency = account?.currency ?? status.data?.currency ?? "USD";
  const accountBalance = getAccountBalance(account);
  const visibleContracts = todaysHistory
    .slice()
    .sort((a, b) => (b.buy_time ?? 0) - (a.buy_time ?? 0));
  const connected = Boolean(status.data?.connected && status.data?.authorized && hasToken);

  const placeTrade = async (count: 1 | 3 | 6) => {
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
    try {
      const result = await bulkBuy.mutateAsync({
        data: {
          amount,
          duration: 1,
          duration_unit: "t",
          contract_type: "DIGITDIFF",
          barrier: selectedDigit,
          symbol: selectedSymbol,
          count,
        },
      });
      const placedAt = Date.now();
      const fresh = result.buys.map((buy) => ({ id: String(buy.contract_id), placedAt }));
      const updated = [...localContracts.filter((item) => !fresh.some((entry) => entry.id === item.id)), ...fresh];
      setLocalContracts(updated);
      localStorage.setItem(`${storagePrefix}${accountId}`, JSON.stringify(updated));
      setMessage({
        tone: "success",
        text: `${result.buys.length} contract${result.buys.length === 1 ? "" : "s"} accepted for ${selectedMarket.name}, digit ${selectedDigit}. Separate contracts can settle differently.`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetDerivStatusQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetDerivHistoryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetDerivAccountsQueryKey() }),
      ]);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The order could not be placed." });
    }
  };

  const formatQuote = (signal?: DerivMarketSignal) =>
    signal?.quote == null ? "—" : String(signal.quote);
  const renderMarket = (market: Market) => {
    const signal = signalBySymbol.get(market.symbol);
    const selected = selectedSymbol === market.symbol;
    const digits = frequencies[market.symbol] ?? Array(10).fill(0);
    return (
      <article
        key={market.symbol}
        className={`at-market-card${selected ? " is-selected" : ""}`}
        data-testid={`card-market-${market.symbol}`}
      >
        <button
          className="at-market-select"
          type="button"
          onClick={() => setSelectedSymbol(market.symbol)}
          aria-pressed={selected}
          aria-label={`Select ${market.name}`}
          data-testid={`button-select-market-${market.symbol}`}
        >
          <span className="at-market-name">{market.name}</span>
          <span className="at-symbol">{market.symbol}</span>
          {selected && <span className="at-selected-mark"><Check size={12} /> ACTIVE</span>}
        </button>
        <div className="at-quote-line">
          <span className="at-quote" data-testid={`text-quote-${market.symbol}`}>{formatQuote(signal)}</span>
          <span className={`at-last-digit${signal?.last_digit == null ? "" : " has-digit"}`}>
            <small>LAST</small>{signal?.last_digit ?? "—"}
          </span>
        </div>
        <div className="at-market-meta">
          <span><Activity size={12} /> {groupTicks[market.group].toLocaleString()} ticks</span>
          <span>{signal?.sample_count ?? 0} sample</span>
        </div>
        <div className="at-frequencies" aria-label={`Digit frequency for ${market.name}`}>
          {digits.map((count, digit) => (
            <button
              className={`at-frequency${selectedDigit === digit ? " active" : ""}`}
              key={digit}
              type="button"
              aria-pressed={selectedDigit === digit}
              onClick={() => { setSelectedSymbol(market.symbol); setSelectedDigit(digit); }}
              aria-label={`Select digit ${digit}, observed ${count} times`}
              data-testid={`button-digit-${market.symbol}-${digit}`}
            >
              <b>{digit}</b><span>{count}</span>
            </button>
          ))}
        </div>
        <div className="at-market-foot">
          <span>Digit frequency · this scan</span>
          <span className="at-live-dot">{scanning ? "LIVE" : "PAUSED"}</span>
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
            <button type="button" className="at-guide-button" onClick={() => { setGuidePage(0); setGuideOpen(true); }} data-testid="button-open-guide">
              <BookOpen size={15} /> GUIDE <span>20</span>
            </button>
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
                <button type="button" className="at-icon-button" onClick={() => startScan(true)} aria-label="Rescan markets" data-testid="button-rescan"><RefreshCw size={15} /> Rescan</button>
                {scanning ? (
                  <button type="button" className="at-stop-button" onClick={() => { setScanning(false); setMessage({ tone: "info", text: "Scan paused. No further digit counts will be added." }); }} data-testid="button-stop-scan"><Pause size={14} /> Stop</button>
                ) : (
                  <button type="button" className="at-live-button" onClick={() => startScan(false)} disabled={!hasToken} data-testid="button-go-live"><Play size={14} /> Go Live</button>
                )}
              </div>
            </header>

            <div className="at-filterbar" role="tablist" aria-label="Filter markets">
              {([
                ["all", "All markets", 18],
                ["regular", "Volatility", 5],
                ["jump", "Jump", 5],
                ["one-sec", "Volatility 1s", 8],
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

            {filteredMarkets.length > 0 && (
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
            {!hasToken && !token.isLoading && (
              <div className="at-empty-overlay" data-testid="empty-market-signals">
                <Signal size={22} /><strong>Awaiting a Deriv connection</strong><span>Live quotes and digit counters appear here when account signals are available.</span>
              </div>
            )}
            {hasToken && !status.isLoading && currentSignals.length === 0 && !status.error && (
              <div className="at-empty-inline" data-testid="empty-live-quotes"><Clock3 size={16} /> Waiting for actual Deriv tick data. No sample quotes are shown.</div>
            )}
          </section>

          <aside className="at-order-column">
            <section className="at-order-panel" aria-labelledby="order-title">
              <div className="at-order-topline"><span><Crosshair size={14} /> MANUAL EXECUTION</span><span className="at-contract-tag">DIGIT DIFFERS</span></div>
              <h2 id="order-title">Place a trade</h2>
              <p className="at-order-description">Every order uses the exact market and digit selected in the scanner.</p>
              <div className="at-order-selection">
                <div><span>MARKET</span><strong>{selectedMarket.name}</strong><small>{selectedMarket.symbol}</small></div>
                <div className="at-order-digit"><span>BARRIER</span><strong>{selectedDigit}</strong></div>
              </div>
              <label className="at-field-label" htmlFor="at-stake">Stake per contract <span>{currency}</span></label>
              <div className="at-stake-input"><span>{currency}</span><input id="at-stake" type="number" min="0.01" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} aria-label="Stake per contract" data-testid="input-stake" /></div>
              <div className="at-duration-row"><span>Duration</span><strong>1 tick</strong><span className="at-fixed-duration">FIXED</span></div>
              <button
                type="button"
                className="at-trade-button"
                disabled={!connected || bulkBuy.isPending}
                onClick={() => void placeTrade(1)}
                data-testid="button-trade-now"
              >
                {bulkBuy.isPending ? <RefreshCw size={16} className="at-spin" /> : <Target size={16} />}
                {bulkBuy.isPending ? "Sending order…" : "Trade Now"}
                <span>1 contract</span>
              </button>
              <div className="at-batch-label"><Layers3 size={13} /> MULTI-CONTRACT BATCH <span>1 tick each</span></div>
              <div className="at-batch-actions">
                <button type="button" disabled={!connected || bulkBuy.isPending} onClick={() => void placeTrade(3)} data-testid="button-trade-3x"><span>3×</span><small>3 separate contracts</small></button>
                <button type="button" disabled={!connected || bulkBuy.isPending} onClick={() => void placeTrade(6)} data-testid="button-trade-6x"><span>6×</span><small>6 separate contracts</small></button>
              </div>
              <p className="at-batch-disclaimer">Batch contracts may settle differently. Deriv quotes the complete batch before buys are sent; outcomes are not all-or-none.</p>
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
              <div className="at-5m-control"><span><Clock3 size={14} /> 5m Auto</span><span className="at-5m-badge">DEFERRED</span></div>
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
