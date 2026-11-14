import { useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, RotateCcw, Volume2, VolumeX, Zap } from "lucide-react";
import "./roulette-panel.css";

export type RouletteDirection = "under" | "over";
export type RouletteOutcome = "win" | "loss" | "even";

export type RouletteMarket = {
  symbol: string;
  label: string;
  family: string;
  observedWinRate: number | null;
  sampleCount: number;
  lastDigit: number | null;
};

export type RouletteResult = {
  id: string;
  settlementDigit: number | null;
  outcome: RouletteOutcome;
  netProfit: number;
  direction: RouletteDirection;
  barrier: number;
  duration: number;
  symbol: string;
  marketLabel: string;
  contractCount: number;
};

export type RoulettePanelProps = {
  market: RouletteMarket | null;
  marketStatus: string;
  connected: boolean;
  accountLabel: string;
  currency: string;
  direction: RouletteDirection;
  onDirectionChange: (value: RouletteDirection) => void;
  barrier: number;
  onBarrierChange: (value: number) => void;
  winningDigitsLabel: string;
  stake: string;
  onStakeChange: (value: string) => void;
  doubleStake: boolean;
  onDoubleStakeChange: (value: boolean) => void;
  totalStake: number;
  duration: string;
  onDurationChange: (value: string) => void;
  soundEnabled: boolean;
  onSoundToggle: () => void;
  spinning: boolean;
  spinSequence: number;
  canSpin: boolean;
  statusMessage: string | null;
  onSpin: () => void;
  onReset: () => void;
  sessionPnl: number;
  spinCount: number;
  winCount: number;
  lossCount: number;
  lastResult: RouletteResult | null;
};

const money = (value: number, currency: string) => {
  const amount = Math.abs(value).toFixed(2);
  return currency === "USD" ? `${value < 0 ? "−" : ""}$${amount}` : `${value < 0 ? "−" : ""}${currency} ${amount}`;
};

const polar = (angle: number, radius: number) => {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: 50 + radius * Math.cos(radians), y: 50 + radius * Math.sin(radians) };
};

const wedgePath = (start: number, end: number) => {
  const a = polar(start, 43);
  const b = polar(end, 43);
  return `M 50 50 L ${a.x} ${a.y} A 43 43 0 0 1 ${b.x} ${b.y} Z`;
};

function MaxRobot({ win, loss }: { win: boolean; loss: boolean }) {
  return (
    <div className={`roulette-max ${win ? "celebrate" : ""} ${loss ? "console" : ""}`} data-testid="roulette-max">
      <svg viewBox="0 0 150 190" role="img" aria-label="Max, the friendly roulette robot">
        <ellipse cx="74" cy="178" rx="43" ry="7" fill="#050b16" opacity=".7" />
        <path className="max-aerial" d="M75 24V12" stroke="#9ec9dc" strokeWidth="4" strokeLinecap="round" />
        <circle cx="75" cy="9" r="5" fill="#f3bf59" />
        <rect x="37" y="26" width="76" height="60" rx="22" fill="url(#max-metal)" stroke="#8fb4c7" strokeWidth="3" />
        <path d="M42 43Q75 17 108 43" fill="none" stroke="#d7e8ef" strokeWidth="5" opacity=".9" />
        <rect x="47" y="45" width="56" height="28" rx="12" fill="#0b1b2e" />
        <ellipse cx="62" cy="58" rx="4" ry="6" fill="#73e5c9" className="max-eye" />
        <ellipse cx="88" cy="58" rx="4" ry="6" fill="#73e5c9" className="max-eye" />
        <path d="M65 68Q75 76 85 68" fill="none" stroke="#a5d5d4" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="33" cy="56" r="7" fill="#e9b65d" stroke="#754e3c" strokeWidth="2" />
        <circle cx="117" cy="56" r="7" fill="#e9b65d" stroke="#754e3c" strokeWidth="2" />
        <path d="M51 86L48 98H102L99 86" fill="#e9b65d" stroke="#744b31" strokeWidth="2" />
        <path d="M43 100Q75 88 107 100L116 145Q75 158 34 145Z" fill="url(#max-coat)" stroke="#71a6b6" strokeWidth="3" />
        <path d="M60 102L75 118L90 102" fill="#d9f1ea" opacity=".94" />
        <path d="M69 118H81L85 143H65Z" fill="#e8b952" />
        <rect x="39" y="143" width="26" height="10" rx="5" fill="#d6e8e7" />
        <rect x="85" y="143" width="26" height="10" rx="5" fill="#d6e8e7" />
        <path d="M36 107L18 131" stroke="#d1e2e5" strokeWidth="9" strokeLinecap="round" />
        <circle cx="17" cy="133" r="7" fill="#e3b45b" />
        <path d="M108 107L127 128" stroke="#d1e2e5" strokeWidth="9" strokeLinecap="round" />
        <circle cx="129" cy="130" r="7" fill="#e3b45b" />
        {win && <path d="M112 86L124 73M122 94L138 91M111 75L107 63" stroke="#ffd275" strokeWidth="3" strokeLinecap="round" />}
        {loss && <path d="M67 63Q75 57 83 63" fill="none" stroke="#f2c56d" strokeWidth="2" />}
        <defs>
          <linearGradient id="max-metal" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#f4d17a" /><stop offset=".52" stopColor="#d9a84f" /><stop offset="1" stopColor="#a46d38" /></linearGradient>
          <linearGradient id="max-coat" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#50bca7" /><stop offset="1" stopColor="#1c6579" /></linearGradient>
        </defs>
      </svg>
    </div>
  );
}

function RouletteWheel({
  spinning, result, sequence,
}: { spinning: boolean; result: RouletteResult | null; sequence: number }) {
  const wheelRef = useRef<SVGGElement>(null);
  const [rotation, setRotation] = useState(0);
  const [landedId, setLandedId] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!result || result.id === landedId || spinning) return;
    const node = wheelRef.current;
    let current = rotation;
    if (node) {
      const transform = window.getComputedStyle(node).transform;
      if (transform && transform !== "none") {
        const matrix = new DOMMatrixReadOnly(transform);
        current = ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360;
      }
    }
    if (result.settlementDigit == null) {
      setRotation(current);
      setLandedId(result.id);
      return;
    }
    const centerAngle = result.settlementDigit * 36;
    const offset = ((-centerAngle % 360) + 360) % 360;
    const target = current + 5 * 360 + offset;
    setRotation(current);
    requestAnimationFrame(() => setRotation(target));
    setLandedId(result.id);
  }, [result, landedId, spinning, rotation]);

  return (
    <div className={`roulette-wheel-shell ${spinning ? "is-spinning" : ""}`} data-testid="roulette-wheel">
      <svg className="roulette-wheel-svg" viewBox="0 0 100 100" role="img" aria-label={result?.settlementDigit == null ? "Ten digit roulette wheel; settlement digit unavailable" : `Roulette wheel landed on digit ${result.settlementDigit}`}>
        <circle cx="50" cy="50" r="48" className="wheel-rim" />
        <g ref={wheelRef} className="roulette-wheel-rotor" style={{ transform: `rotate(${rotation}deg)` }} data-sequence={sequence}>
          {Array.from({ length: 10 }, (_, digit) => {
            const start = digit * 36 - 18;
            const isExact = result?.direction === "under"
              ? digit === result.barrier
              : result?.direction === "over" ? digit === result.barrier : false;
            const isWinner = result?.settlementDigit === digit
              ? result.outcome === "win"
              : (digit % 10) !== 5;
            const fill = isExact ? "#c48b45" : isWinner ? (digit % 2 ? "#238d68" : "#2aa77b") : "#174a4c";
            const point = polar(digit * 36, 30);
            return <g key={digit}>
              <path d={wedgePath(start, start + 36)} fill={fill} stroke="#10212b" strokeWidth=".75" />
              <text x={point.x} y={point.y + 2.3} className="roulette-digit" textAnchor="middle">{digit}</text>
            </g>;
          })}
          <circle cx="50" cy="50" r="12" className="wheel-hub" />
          <text x="50" y="54" className="wheel-dollar" textAnchor="middle">$</text>
        </g>
        <circle cx="50" cy="50" r="47" className="wheel-rim-inner" />
        <path d="M45 2H55L50 11Z" className="wheel-pointer" />
        {Array.from({ length: 20 }, (_, i) => {
          const point = polar(i * 18, 46);
          return <circle key={i} cx={point.x} cy={point.y} r="1" className="wheel-stud" />;
        })}
      </svg>
      {result?.settlementDigit == null && !spinning && result && <div className="roulette-wheel-unavailable" data-testid="roulette-wheel-unavailable">Digit unavailable</div>}
      {result?.settlementDigit != null && !spinning && <div className={`roulette-wheel-result ${result.outcome}`} data-testid="roulette-wheel-result">
        <span>{result.outcome === "win" ? "YOU WON" : result.outcome === "loss" ? "ROUND SETTLED" : "EVEN"}</span>
        <strong>{result.outcome === "win" ? `+${money(result.netProfit, "USD")}` : result.outcome === "loss" ? money(result.netProfit, "USD") : money(result.netProfit, "USD")}</strong>
      </div>}
    </div>
  );
}

export function RoulettePanel(props: RoulettePanelProps) {
  const {
    market, marketStatus, connected, accountLabel, currency, direction, onDirectionChange,
    barrier, onBarrierChange, winningDigitsLabel, stake, onStakeChange, doubleStake,
    onDoubleStakeChange, totalStake, duration, onDurationChange, soundEnabled, onSoundToggle,
    spinning, spinSequence, canSpin, statusMessage, onSpin, onReset, sessionPnl, spinCount,
    winCount, lossCount, lastResult,
  } = props;
  const blocked = (direction === "under" && barrier === 0) || (direction === "over" && barrier === 9);
  const wheelResult = lastResult;
  const outcomeText = lastResult
    ? lastResult.outcome === "win" ? "You won" : lastResult.outcome === "loss" ? "Round settled" : "Even"
    : "Awaiting first spin";

  return (
    <section className="roulette-panel" aria-label="Over/Under Roulette" data-testid="roulette-panel" data-feature-scope="roulette">
      <header className="roulette-header">
        <div className="roulette-brand">
          <span className="roulette-brand-mark"><span>O</span><i>/</i><b>U</b></span>
          <div><div className="roulette-title-row"><h2>Over/Under Roulette</h2><span className="roulette-live-tag">DERIV SETTLEMENT</span></div>
            <p>Pick a side and spin. Max lands the wheel on Deriv's settlement digit, and on a win he tears a whole in reality and steps through it with the Cash.</p>
          </div>
        </div>
        <div className={`roulette-connection ${connected ? "online" : ""}`} data-testid="roulette-connection-status"><i />{connected ? "CONNECTED" : "OFFLINE"}<span>{accountLabel || "No account"}</span></div>
      </header>

      <div className="roulette-main">
        <div className="roulette-stage">
          <div className="roulette-stage-orbit" aria-hidden="true" />
          <RouletteWheel spinning={spinning} result={wheelResult} sequence={spinSequence} />
          <MaxRobot win={lastResult?.outcome === "win" && !spinning} loss={lastResult?.outcome === "loss" && !spinning} />
          <div className="roulette-stage-caption"><span><i /> DERIV SETTLEMENT</span><b>{market?.lastDigit == null ? "Awaiting tick" : `Latest tick · ${market.lastDigit}`}</b></div>
        </div>
        <div className="roulette-round-controls">
          <button type="button" className={`roulette-spin ${spinning ? "spinning" : ""}`} data-testid="roulette-spin" onClick={onSpin} disabled={!canSpin || spinning || blocked}>
            <span className="roulette-spin-icon">{spinning ? <RotateCcw size={20} /> : <Zap size={20} />}</span>
            <b>{spinning ? "SETTLING…" : "SPIN"}</b><small>{spinning ? "Waiting for Deriv's result" : "One deliberate selection"}</small>
          </button>
          <section className="roulette-session" aria-label="Session profit and loss" data-testid="roulette-session">
            <div className="roulette-session-top"><span>SESSION P/L</span><button type="button" data-testid="roulette-reset" onClick={onReset} aria-label="Reset roulette session"><RotateCcw size={13} />Reset</button></div>
            <strong className={sessionPnl >= 0 ? "positive" : "negative"} data-testid="roulette-session-pnl">{sessionPnl > 0 ? "+" : ""}{money(sessionPnl, currency)}</strong>
            <small data-testid="roulette-session-counts">{spinCount} {spinCount === 1 ? "spin" : "spins"} · {winCount} won · {lossCount} lost</small>
          </section>
        </div>
      </div>

      <div className={`roulette-result-card ${lastResult?.outcome ?? "waiting"}`} aria-live="polite" data-testid="roulette-last-result">
        <div className="roulette-result-main">
          <span className="roulette-result-digit">{lastResult?.settlementDigit ?? "—"}</span>
          <div><strong>{lastResult ? `${lastResult.settlementDigit == null ? "Digit unavailable" : `${lastResult.settlementDigit} · `}${outcomeText}` : outcomeText}</strong>
            {lastResult && <p>{lastResult.direction === "under" ? "Under" : "Over"} {lastResult.barrier} · {lastResult.duration} {lastResult.duration === 1 ? "tick" : "ticks"} · {lastResult.contractCount} {lastResult.contractCount === 1 ? "contract" : "contracts"} · {lastResult.marketLabel}</p>}
            {lastResult && <small>Net P/L: {lastResult.netProfit > 0 ? "+" : ""}{money(lastResult.netProfit, currency)} · {lastResult.symbol}</small>}
            {!lastResult && <p>Each result is shown from Deriv settlement data.</p>}
          </div>
        </div>
        <strong className="roulette-result-profit">{lastResult ? `${lastResult.netProfit > 0 ? "+" : ""}${money(lastResult.netProfit, currency)}` : "—"}</strong>
      </div>

      <div className="roulette-controls-grid">
        <section className="roulette-card roulette-pick-card">
          <div className="roulette-card-heading"><div><small>YOUR PICK</small><h3>Choose a side</h3></div><span className="roulette-pick-chip">{direction === "under" ? <ArrowDown size={13} /> : <ArrowUp size={13} />}{direction.toUpperCase()}</span></div>
          <div className="roulette-direction" role="group" aria-label="Choose Over or Under">
            <button type="button" className={direction === "under" ? "selected under" : ""} data-testid="roulette-direction-under" onClick={() => onDirectionChange("under")} aria-pressed={direction === "under"}><ArrowDown size={16} /><span><b>Under</b><small>Below the digit</small></span></button>
            <button type="button" className={direction === "over" ? "selected over" : ""} data-testid="roulette-direction-over" onClick={() => onDirectionChange("over")} aria-pressed={direction === "over"}><ArrowUp size={16} /><span><b>Over</b><small>Above the digit</small></span></button>
          </div>
          <div className="roulette-digit-control">
            <div className="roulette-digit-label"><label htmlFor="roulette-barrier">Digit</label><strong data-testid="roulette-barrier-label">{direction === "under" ? "Under" : "Over"} {barrier}</strong></div>
            <input id="roulette-barrier" type="range" min="0" max="9" step="1" value={barrier} onChange={(event) => onBarrierChange(Number(event.target.value))} data-testid="roulette-barrier-slider" aria-label={`Barrier digit ${barrier}`} />
            <div className="roulette-digit-track" aria-hidden="true">{Array.from({ length: 10 }, (_, digit) => <span key={digit} className={digit === barrier ? "active" : ""}>{digit}</span>)}</div>
            <p data-testid="roulette-winning-digits">{winningDigitsLabel}{blocked ? " · No winning digits for this selection." : " · An exact match loses."}</p>
          </div>
        </section>

        <section className="roulette-card roulette-market-card">
          <div className="roulette-card-heading"><div><small>MARKET · PICKED FOR YOU</small><h3>Automatic market evidence</h3></div><span className={`roulette-market-state ${connected ? "live" : ""}`}><i />{connected ? "LIVE" : "WAITING"}</span></div>
          <div className="roulette-market-evidence" data-testid="roulette-market-evidence">
            <strong>{market?.label ?? "Market unavailable"}</strong><span className="roulette-market-symbol">{market?.symbol ?? "—"} · {market?.family ?? "—"}</span>
            <div className="roulette-market-metrics"><span><b>{market?.observedWinRate == null ? "—" : `${market.observedWinRate.toFixed(1)}%`}</b><small>observed win rate</small></span><span><b>{market?.sampleCount ?? 0}</b><small>observations</small></span><span><b>{market?.lastDigit ?? "—"}</b><small>latest digit</small></span></div>
          </div>
          <p className="roulette-market-status" role="status" data-testid="roulette-market-status">{marketStatus || (market ? "Market selected automatically from live evidence." : "Waiting for a market to be selected.")}</p>
        </section>
      </div>

      <div className="roulette-config">
        <section className="roulette-card roulette-stake-card">
          <div className="roulette-card-heading"><div><small>STAKE</small><h3>Set your exposure</h3></div><span className="roulette-currency">{currency}</span></div>
          <label className="roulette-field-label" htmlFor="roulette-stake">Stake per contract</label>
          <div className="roulette-stake-input"><span>{currency === "USD" ? "$" : currency}</span><input id="roulette-stake" type="text" inputMode="decimal" value={stake} onChange={(event) => onStakeChange(event.target.value)} data-testid="roulette-stake-input" aria-label={`Stake in ${currency}`} /></div>
          <button type="button" className={`roulette-double ${doubleStake ? "active" : ""}`} data-testid="roulette-double-stake" aria-pressed={doubleStake} onClick={() => onDoubleStakeChange(!doubleStake)}><b>2×</b><span>Double stake</span><i /></button>
          <div className="roulette-total-stake"><span>{doubleStake ? "2 contracts per spin" : "1 contract per spin"}</span><b data-testid="roulette-total-stake">{money(totalStake, currency)}</b></div>
        </section>

        <section className="roulette-card roulette-duration-card">
          <div className="roulette-card-heading"><div><small>DURATION</small><h3>Wheel turns (ticks)</h3></div><span className="roulette-duration-unit">TICKS</span></div>
          <label className="roulette-field-label" htmlFor="roulette-duration">Deriv settlement duration</label>
          <div className="roulette-duration-input"><input id="roulette-duration" type="text" inputMode="numeric" value={duration} onChange={(event) => onDurationChange(event.target.value)} data-testid="roulette-duration-input" aria-label="Wheel turns in ticks" /><span>ticks</span></div>
          <p>Deriv settles the contract on its final tick. Max only reveals the digit returned in the real result.</p>
          <button type="button" className={`roulette-sound ${soundEnabled ? "on" : ""}`} data-testid="roulette-sound-toggle" onClick={onSoundToggle} aria-pressed={soundEnabled} aria-label={`Sound ${soundEnabled ? "on" : "off"}`}>{soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}Sound {soundEnabled ? "on" : "off"}</button>
        </section>
      </div>
      <footer className="roulette-footer">
        <span className="roulette-footer-note"><i />{statusMessage || (connected ? "Review your side, barrier, and total stake before spinning." : "Connect Deriv before starting a roulette round.")}</span>
        <span className="roulette-account" data-testid="roulette-account-label">{accountLabel || "No account"}</span>
      </footer>
    </section>
  );
}

export default RoulettePanel;
