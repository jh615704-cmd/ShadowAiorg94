import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAccessSessionQueryKey,
  getGetAdminFeatureSettingsQueryKey,
  getUserFacingErrorMessage,
  ApiTransportError,
  type ClockWorkContractOrder,
  useBuyMatchesContracts,
  useQuoteClockWorkContracts,
  useBuyClockWorkContracts,
  useGetAccessSession,
  useGetAdminFeatureSettings,
  useDeleteDerivToken,
  useGetDerivAccounts,
  useGetDerivHistory,
  useGetDerivStatus,
  useGetDerivTokenStatus,
  useBulkBuyDerivContracts,
  useDualBuyDerivContracts,
  useBuyDerivContract,
  useSellDerivContract,
  getDerivHistory,
  useSelectDerivSymbol,
  useTestDerivConnection,
  useTestDerivToken,
  useRequestDerivProposal,
  getGetDerivTokenStatusQueryKey,
  getGetDerivAccountsQueryKey,
  getGetDerivStatusQueryKey,
  getGetDerivHistoryQueryKey,
  type FeatureControl,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { DerivAccountSwitcher } from "@/components/deriv-account-switcher";
import { FeatureStatusText } from "@/components/feature-status";
import { useAccessSessionLogout } from "@/hooks/use-access-session-logout";
import {
  Activity, BookOpen, Bot, ChevronDown, ChevronLeft, ChevronRight, Gauge, Link2, Loader2,
  Clock3, LogOut, Menu, Pause, Play, Power, RefreshCw, RotateCcw, Settings, ShieldAlert, ShieldCheck, X, Zap,
} from "lucide-react";
import {
  chooseBestDigitSignal,
  chooseBestEdgeDirectionForDigit,
  chooseBestEdgeSignal,
  digitForTick,
  nextStakeAfterSettlement,
  rankDigitsByDistribution,
  sessionStopReason,
  type BestEdgeSignal,
  type MarketSignal,
} from "../lib/trading-sequence";
import {
  AI_SCANNER_MIN_SAMPLE,
  chooseBulkScannerCandidate,
  chooseCashGrabScannerCandidate,
  chooseDigitFlipScannerCandidate,
  chooseTradeXScannerCandidate,
  type AiScannerMarketSignal,
} from "../lib/ai-market-scanner";
import TradeXPanel, {
  type TradeXDigitDistribution,
  type TradeXDuration,
  type TradeXMarketType,
  type TradeXSymbolOption,
} from "../components/trade-x-panel";
import DigitFlipPanel, {
  type DigitFlipDuration,
  type DigitFlipMarketSignal,
  type DigitFlipMarketType,
  type DigitFlipParity,
  type DigitFlipStakeMode,
} from "../components/digit-flip-panel";
import BulkTraderPanel, {
  type BulkTraderContractType,
  type BulkTraderPrediction,
  type BulkTraderType,
} from "../components/bulk-trader-panel";
import EdgeReferencePanel from "../components/edge-reference-panel";
import {
  MoneyBankPanel,
  calculateRecoveryLadder,
  type MoneyBankStartConfig,
  type MoneyBankMarketSignal,
  type MoneyBankTrade,
  type MoneyBankStrategy,
  type MoneyBankJdyDecision,
  MONEY_BANK_AUTO_SYMBOLS,
} from "../components/money-bank-panel";
import CashGrabPanel, {
  type CashGrabAiStatus,
  type CashGrabDirection,
  type CashGrabDuration,
  type CashGrabMarketSignal,
  type CashGrabStartConfig,
  type CashGrabStakeMode,
  type CashGrabTrade,
} from "../components/cash-grab-panel";
import ClockWorkPanel from "../components/clock-work-panel";
import type { ClockWorkPanelProps } from "../components/clock-work-panel";
import MatchesAnalysisPanel, {
  type MatchesAiDigits,
  type MatchesDuration,
  type MatchesMarketOption,
  type MatchesMarketType,
} from "../components/matches-analysis-panel";
import DerivHistory from "../components/deriv-history";
import { getAccountBalance } from "../lib/account-balance";
import {
  appendClockWorkQuote,
  CLOCK_WORK_AGGRESSIVE_MIN_WIN_RATE,
  getClockWorkAggressiveBudget,
  getClockWorkBarrierTickCounts,
  estimateClockWorkBarrierRates,
  formatClockWorkBarrier,
  getClockWorkFourSequence,
  getClockWorkPushProgress,
  getClockWorkRecentMoves,
  meetsClockWorkMinimumWinRate,
  type ClockWorkQuoteBuffer,
} from "../lib/clock-work-logic";
import { buildCashGrabBulkBuyPayload } from "../lib/cash-grab-order";
import { getCashGrabLimitReached } from "../lib/cash-grab-limits";
import { readCachedHistorySnapshot } from "../lib/history-snapshot";
import {
  claimDerivHistoryFeatureContractIds,
  isDerivHistoryOpen,
  type DerivHistoryFeature,
} from "../lib/deriv-history";
import {
  chooseObservedMatchDigits,
  MATCHES_HISTORY_LIMIT,
  MATCHES_MINIMUM_SAMPLE_SIZE,
  rankObservedMatchDigits,
  type MatchesDigitStat as ObservedMatchesDigitStat,
} from "../lib/matches-analysis";
import {
  validateBulkTraderEntry,
  validateEdgeEntry,
  validateTradeXEntry,
} from "../lib/trade-entry-guards";

const markets = [
  ["R_10", "Volatility 10 Index"], ["R_25", "Volatility 25 Index"],
  ["R_50", "Volatility 50 Index"], ["R_75", "Volatility 75 Index"],
  ["R_100", "Volatility 100 Index"], ["1HZ10V", "Volatility 10 (1s)"],
  ["1HZ15V", "Volatility 15 (1s)"], ["1HZ25V", "Volatility 25 (1s)"],
  ["1HZ30V", "Volatility 30 (1s)"], ["1HZ50V", "Volatility 50 (1s)"],
  ["1HZ75V", "Volatility 75 (1s)"], ["1HZ90V", "Volatility 90 (1s)"],
  ["1HZ100V", "Volatility 100 (1s)"],
  ["JD10", "Jump 10 Index"], ["JD25", "Jump 25 Index"], ["JD50", "Jump 50 Index"],
  ["JD75", "Jump 75 Index"], ["JD100", "Jump 100 Index"],
] as const;

const matchesMarkets: MatchesMarketOption[] = [
  { value: "R_10", label: "Volatility 10 Index", marketType: "volatility" },
  { value: "R_25", label: "Volatility 25 Index", marketType: "volatility" },
  { value: "R_50", label: "Volatility 50 Index", marketType: "volatility" },
  { value: "R_75", label: "Volatility 75 Index", marketType: "volatility" },
  { value: "R_100", label: "Volatility 100 Index", marketType: "volatility" },
  { value: "R_150", label: "Volatility 150 Index", marketType: "volatility" },
  { value: "R_250", label: "Volatility 250 Index", marketType: "volatility" },
  { value: "1HZ10V", label: "Volatility 10 (1s)", marketType: "volatility" },
  { value: "1HZ15V", label: "Volatility 15 (1s)", marketType: "volatility" },
  { value: "1HZ25V", label: "Volatility 25 (1s)", marketType: "volatility" },
  { value: "1HZ30V", label: "Volatility 30 (1s)", marketType: "volatility" },
  { value: "1HZ50V", label: "Volatility 50 (1s)", marketType: "volatility" },
  { value: "1HZ75V", label: "Volatility 75 (1s)", marketType: "volatility" },
  { value: "1HZ90V", label: "Volatility 90 (1s)", marketType: "volatility" },
  { value: "1HZ100V", label: "Volatility 100 (1s)", marketType: "volatility" },
  { value: "JD10", label: "Jump 10 Index", marketType: "jumps" },
  { value: "JD25", label: "Jump 25 Index", marketType: "jumps" },
  { value: "JD50", label: "Jump 50 Index", marketType: "jumps" },
  { value: "JD75", label: "Jump 75 Index", marketType: "jumps" },
  { value: "JD100", label: "Jump 100 Index", marketType: "jumps" },
];

const realizedProfit = (trades: readonly { status: string; profit: number }[]) =>
  trades.reduce((sum, trade) => sum + (isDerivHistoryOpen(trade.status) ? 0 : trade.profit), 0);

const guidePages = [
  { title: "Welcome to EDGE 🏔️", body: "EDGE is a digit-contract workspace for testing Over and Under ideas with a controlled stake, a selected market, and visible session results.", points: ["Use demo accounts while learning.", "Every trade uses the selected duration, stake, market, and barrier.", "The guide explains the controls before you start."] },
  { title: "Connect and choose an account", body: "Connect a Deriv PAT with read and trade permissions, then select the account you want to use. The active balance is refreshed from Deriv.", points: ["Demo accounts are the safest place to validate a strategy.", "Selecting a real account routes trades to those funds; the server's live-trading permission and balance checks still apply.", "Account changes clear the active market session state."] },
  { title: "Markets and live ticks", body: "Each supported market streams live quotes. The final digit of each quote becomes the digit signal used by the streak display.", points: ["Switch markets from the Market selector.", "The last tick shows the current quote and final digit.", "Past ticks describe history; they do not control the next tick."] },
  { title: "What Over means", body: "An Over contract wins when the last digit at expiry is above the selected barrier. For example, Over 1 wins on digits 2 through 9.", points: ["Choose a barrier from the digit row.", "The button label always shows the current barrier.", "The result is decided by the contract expiry, not by the entry quote."] },
  { title: "What Under means", body: "An Under contract wins when the last digit at expiry is below the selected barrier. For example, Under 1 wins only on digit 0.", points: ["Over and Under have different winning ranges.", "Changing the barrier changes the winning range.", "Do not treat a visible streak as a promise about the next result."] },
  { title: "Choosing a digit barrier", body: "The digit row shows recent Over and Under streak lengths for each barrier. Selecting a digit changes both the contract label and the configuration summary.", points: ["A larger barrier gives Over more possible winning digits.", "A smaller barrier gives Under more possible winning digits.", "Compare the streaks with the payout and your risk limit."] },
  { title: "Duration in ticks", body: "Tick 0 is the entry spot. One tick settles on the next price update; 2–5 ticks settle on the matching numbered update.", points: ["Use only 1 through 5 ticks.", "Short durations resolve quickly and can also change rapidly.", "Duration does not improve the probability by itself."] },
  { title: "Stake and balance", body: "Stake is the amount risked on each contract. The selected stake is used for the next Over or Under trade unless Martingale after loss is enabled.", points: ["Keep a reserve instead of risking the full balance.", "Martingale increases the next stake after a loss and resets after a win.", "A valid balance check cannot prevent market losses."] },
  { title: "Flat stake strategy", body: "Flat staking uses the same stake on every trade. It is the simplest baseline and makes session results easier to compare.", points: ["Use it to measure a signal without changing risk size.", "Set Take Profit and Stop Loss before starting.", "A losing trade does not automatically justify a larger next stake."] },
  { title: "Martingale after loss", body: "Martingale increases the next stake after a loss by the configured multiplier. It can grow exposure quickly and may exhaust a balance after a short losing run.", points: ["Set a low multiplier and a hard stop if you test it.", "The strategy is not a recovery guarantee.", "Demo testing is strongly recommended before any live use."] },
  { title: "Auto Best Digit", body: "Auto Best Digit ranks the live signals from all supported markets using available tick history, current sample size, and the strongest recent Over or Under streak. It selects a market, direction, and barrier for the next batch.", points: ["The score favors fresh markets with enough observations.", "It selects both Over or Under and the strongest observed signal.", "It is a signal-selection aid, not a prediction engine. No strategy guarantees an outcome."] },
  { title: "How the signal score works", body: "The built-in score compares recent consecutive digits above and below each candidate barrier across every subscribed market. Stronger, better-sampled signals rank higher.", points: ["Signals with no recent ticks are ignored.", "The selected market can change when a stronger signal appears.", "Recent streak length is descriptive, not proof of future probability."] },
  { title: "Manual Over and Under", body: "Use the Over or Under direction and trade controls in the execution area to send one contract using the selected barrier, duration, stake, and strategy.", points: ["The trade control sends one contract at a time.", "Martingale can multiply the next stake after a loss, but it cannot guarantee recovery.", "The next win resets the amount to the normal stake."] },
  { title: "Auto Best Digit", body: "Auto Best Digit starts the repeating loop after selecting the strongest available signal. Stop ends the loop after the active request completes.", points: ["Review the account, market, direction, barrier, duration, and stake first.", "The loop uses the current strategy and risk limits.", "Turning off EDGE stops the loop and hides its controls."] },
  { title: "Take Profit", body: "Take Profit stops the repeating loop after the session reaches the configured positive P/L. It applies to the local session total, not to your entire Deriv account history.", points: ["Choose an amount you can accept as a session target.", "The target is checked as results settle.", "Take Profit does not close a contract early."] },
  { title: "Stop Loss", body: "Stop Loss stops the repeating loop after the session reaches the configured negative P/L. It is a guardrail, not a guarantee that losses cannot exceed the target.", points: ["Use a smaller loss limit while testing.", "Bulk trades can settle after the loop is stopped.", "Review the trade history before starting another session."] },
  { title: "Live-money protection", body: "Selecting a real account routes contracts to real funds. The server's live-trading permission, balance, and settlement checks remain in force.", points: ["Review the selected account before trading.", "A disabled live-trading setting blocks real orders.", "If you are learning, switch back to a demo account."] },
  { title: "Reading session results", body: "Session P/L and Trades Sent show only activity since the last Reset. Recent Trades contains the dashboard rows received from the Deriv stream.", points: ["Reset clears only Session P/L and Trades Sent.", "Reset does not change stake, duration, barrier, or strategy.", "Clear Recent Trades removes dashboard rows without deleting Deriv records."] },
  { title: "A careful pre-trade checklist", body: "Before sending anything, confirm the account, market, direction, barrier, duration, stake, strategy, and risk limits.", points: ["Start with a demo account.", "Martingale increases exposure after losses, so keep a reserve.", "Never rely on a claimed guaranteed outcome."] },
  { title: "Let's start trading", body: "You now know how the market selector, Over and Under contracts, Martingale, Auto Best Digit, and risk controls work.", points: ["Start with one small demo trade.", "Watch the settlement and confirm the history updates.", "Keep the guide available whenever you change strategy."] },
] as const;

const tradeXGuidePages = [
  { title: "Welcome to Trade X", body: "Trade X is the Digit Differs workspace. It watches the live digit distribution, ranks the least frequent digits, and lets you decide whether to send one trade or use controlled automation.", points: ["Use a demo account while learning the signal.", "The signal describes observed ticks; it cannot guarantee the next digit.", "The switch pauses every Trade X action without changing EDGE."] },
  { title: "Read the distribution", body: "Each digit shows its observed percentage and current absence streak. The differs candidate list ranks digits with the lowest observed frequency first, because a Differs contract wins when the expiry digit is not the selected barrier.", points: ["Tap any oval digit to make it the active selection.", "The top three list follows the same live ranking.", "Refresh restarts the local sample window from the next market tick."] },
  { title: "Ranked candidates", body: "Trade X can rank observed digits so you can compare the active Digit Differs barrier before sending a contract.", points: ["Ranked mode follows the live candidate order.", "Tap a digit or turn Manual Select on when you want an exact barrier.", "The active entry is shown before every action."] },
  { title: "Manual actions", body: "Place Trade X Trade sends one Digit Differs contract using the active digit. Tick 0 is entry; one tick settles on the next price update, and 2–5 settle on their matching numbered update.", points: ["Check market, stake, duration, and digit before sending.", "Manual digit taps switch to exact-digit selection so the request matches the screen.", "The expiry result is decided by Deriv."] },
  { title: "A careful workflow", body: "Start with a small demo stake, wait for a meaningful sample, and treat every signal as descriptive market context rather than certainty.", points: ["Confirm the selected account is the one you intend to use.", "Use the lowest practical stake while evaluating a market.", "Stop automation before changing markets or strategy assumptions."] },
  { title: "Set the stake", body: "Stake controls the amount requested for each Digit Differs contract. Start low while learning how the distribution reacts.", points: ["Keep a reserve in the account.", "The server and account balance remain final guards.", "A higher stake does not make a signal stronger."] },
  { title: "Manual selection", body: "Manual selection lets you choose the exact digit barrier rather than accepting the current ranked candidate.", points: ["Tap a digit to make it active.", "Confirm the selected digit before placing a trade.", "The barrier is sent with the contract request."] },
  { title: "Ranked candidates", body: "The ranked list orders digits from the observed distribution so you can compare the least frequent candidates for a Differs idea.", points: ["Ranking is based on the current sample.", "A low observed frequency is not a guarantee.", "Refresh the sample when the context changes."] },
  { title: "Observed percentages", body: "The distribution percentages summarize the selected sample and update as live ticks arrive.", points: ["Small samples can move sharply.", "Use sample count beside the percentage.", "Treat the number as context, not certainty."] },
  { title: "Place a manual trade", body: "Place Trade X Trade uses the active market, stake, duration, and selected digit to send one Digit Differs contract.", points: ["Review every control before placing.", "Selecting a real account sends orders to that account when server live trading is enabled.", "The expiry result is decided by Deriv."] },
  { title: "Live-money protection", body: "The server's live-trading setting and balance checks guard real-account orders; account selection determines where a trade is placed.", points: ["Switch to demo while learning.", "A disabled action can indicate the server live-trading setting is off.", "Check the selected account before trading."] },
  { title: "Reading open contracts", body: "An open row has been bought but does not yet have a final result. It remains visible while Deriv settles the contract.", points: ["Do not treat an open row as a win or loss.", "History refreshes as settlement arrives.", "New actions remain separate from open rows."] },
  { title: "Clearing Trade X history", body: "The Trade X clear control hides the dashboard rows after a second tap. It does not delete contracts or records from Deriv.", points: ["Use the two-step action intentionally.", "The fade confirms the rows were removed from view.", "Clearing does not stop automation."] },
  { title: "Reset the sample", body: "Refreshing analysis starts a new local sample window so the distribution reflects the next stream of ticks.", points: ["Wait for enough observations after refresh.", "Avoid making decisions from an empty sample.", "The account and contract history remain unchanged."] },
  { title: "Safe first session", body: "Start with one small demo Digit Differs contract, a fresh sample, and manual selection.", points: ["Confirm market, digit, duration, and stake.", "Watch the returned row settle.", "Stop if the signal no longer matches your plan."] },
  { title: "Final checklist", body: "Trade X is ready when the market, sample, digit, duration, stake, and automation state are all intentional.", points: ["Start small.", "Check the selected account before trading.", "Use observed data as context, never as certainty."] },
] as const;

const clockWorkGuidePages = [
  { title: "Welcome to Clock Work", body: "Clock Work is the Hybrid Analysis workspace for five-tick Higher and Lower contracts. Its live chart, recent moves, and barrier estimates describe the selected market and do not predict or guarantee the next result.", points: ["Start on a demo account while learning.", "The feature uses the market, barriers, duration, and stakes shown on screen.", "Only one trading feature can be active at a time."] },
  { title: "Connect and choose an account", body: "Connect a Deriv account and confirm which account is selected before enabling Clock Work. Real-account orders are still subject to the server's live-trading and balance checks.", points: ["The selected account receives the orders.", "A disconnected or unsettled account blocks new entries.", "Use demo mode to learn the controls."] },
  { title: "Select the market", body: "Market selects the live synthetic index used for ticks, the price chart, estimates, quotes, and contracts.", points: ["Switching markets changes the live data source.", "Wait for fresh ticks and quotes after changing markets.", "Past market movement does not guarantee future movement."] },
  { title: "Contract duration", body: "Clock Work uses a fixed five-tick duration for quotes, chart estimates, and all placed contracts.", points: ["There is no three-tick option.", "The selected market determines the tick stream.", "A short duration can still settle at a loss."] },
  { title: "Higher and Lower stakes", body: "Higher Stake and Lower Stake set the amount for their matching manual and paired contracts. The four-trade action uses its separate H1, L1, L2, and H2 stake fields.", points: ["Each stake must be at least 1.00.", "The account balance must cover the complete batch.", "The server rechecks the balance before submitting orders."] },
  { title: "Offset barriers", body: "Offset uses a signed distance from the contract's entry price. Higher uses a positive offset and Lower uses a negative offset.", points: ["The displayed pad values are selectable barriers.", "Changing the market can change the entry price, not the selected offset.", "Deriv receives the signed relative barrier."] },
  { title: "Absolute barriers", body: "Absolute converts the selected distance into a price level using the current quote when a fresh proposal is requested.", points: ["The level is recalculated from the live quote before an order.", "Higher and Lower levels remain separate selections.", "A new quote can change the displayed absolute level."] },
  { title: "Half Barrier", body: "Half Barrier cuts the selected distance in half. In Absolute mode this means halfway between the current quote and the selected level, not half of the instrument's entire price.", points: ["The chart uses the effective, halved level.", "The order request uses the same effective barrier.", "Turn it off to restore the full selected distance."] },
  { title: "Read the barrier pads", body: "The two barrier pads select Higher and Lower independently. Their labels and the chart show the effective levels used by the current mode.", points: ["Higher and Lower may use different offsets.", "The selections are sent with their matching contract types.", "Review the values again after changing mode or market."] },
  { title: "Price Chart", body: "The chart plots recent live quotes and overlays the selected Higher and Lower barrier levels.", points: ["The chart needs at least two live quotes.", "Price history is descriptive and does not guarantee a settlement.", "The chart follows the selected market."] },
  { title: "Higher and Lower percentages", body: "The percentages estimate how often recent five-tick windows crossed the selected barrier levels, using the available quote sample.", points: ["Small samples can change quickly.", "The estimate is not Deriv's contract probability.", "A percentage is not a promised return."] },
  { title: "Recent Moves", body: "Recent Moves labels each observed quote change as H for Higher or L for Lower.", points: ["Moves come from consecutive live quotes.", "Flat or unavailable ticks do not create a direction.", "A run of H or L marks is not a reliable forecast."] },
  { title: "Prediction and lean strength", body: "Prediction shows which selected barrier has the stronger estimated hit rate in the current sample. Lean strength shows that side's measured percentage.", points: ["Not enough data leaves the prediction blank.", "The stronger side can change as quotes arrive.", "Lean strength is an observation, not certainty."] },
  { title: "Manual Higher and Lower", body: "The green Higher and red Lower buttons each send one five-tick contract using its own selected barrier, stake, and a fresh Deriv proposal.", points: ["The quote panel shows Deriv's current payout and estimated profit.", "Quotes can change before the order is accepted.", "Check the account, market, stake, and barrier before placing."] },
  { title: "Higher & Lower together", body: "Higher & Lower submits one Higher and one Lower contract using their respective stakes and barriers.", points: ["Both proposals are requested before any buy is sent.", "The pair can have a partial or unconfirmed result; check history.", "The last contract to settle is not guaranteed to win or cover losses."] },
  { title: "All 4 Trades", body: "All 4 Trades submits H1, L1, L2, and H2 contracts in alternating Higher and Lower order, starting with the side that currently has the stronger lean.", points: ["Each leg has its own selected stake and barrier.", "All four quotes must be available before the batch is sent.", "The order sequence cannot guarantee the final settlement outcome."] },
  { title: "Auto Trading modes", body: "Choose H&L (2) for a paired batch, A to select the side with the stronger measured rate, or All (4) for four alternating contracts.", points: ["Automation also requires a minimum lean selection.", "The switch starts and stops new automatic entries.", "An open Deriv contract pauses the next entry."] },
  { title: "Minimum lean", body: "Minimum lean sets the observed percentage threshold required before an automatic batch can start.", points: ["Select one of 50%, 67%, 78%, 88%, 92%, or 95%.", "Higher thresholds can mean fewer entries.", "Passing the threshold does not make a contract certain to win."] },
  { title: "Aggressive Auto Trading", body: "Aggressive mode uses a selected share of the current account balance and waits for five consecutive ticks in one direction before considering an entry.", points: ["Choose 5%, 15%, 25%, or 50%.", "The total planned amount is divided across the selected mode's contracts.", "The balance and minimum stake checks can pause an entry."] },
  { title: "History and risk", body: "Clock Work History shows contracts submitted by this feature, with actual settled profit, result, win rate, and recorded stake. Open contracts remain unsettled until Deriv reports a final result.", points: ["Clearing hides Clock Work rows from this dashboard only; it does not delete Deriv's account history.", "Paired trades and four-trade batches can lose money.", "No sequence can guarantee a final winning contract or recovery."] },
] as const;

const matchesAnalysisGuidePages = [
  { title: "Welcome to Matches Analysis", body: "Matches Analysis displays recent final-digit frequencies for the selected market and lets you place Digit Match contracts. Its observed rankings are descriptive, not guarantees or reliable predictions of the next tick.", points: ["Use a demo account while learning.", "Only one trading feature can be active at a time.", "A Digit Match contract can lose its full stake."] },
  { title: "Connect and choose an account", body: "Connect Deriv and check the active account before turning on Matches Analysis. Real-account trades remain subject to workspace permission, account balance, and Deriv's limits.", points: ["The selected account receives the trades.", "Account changes stop new automatic entries.", "Use demo trading to learn the controls."] },
  { title: "Choose a market family", body: "Choose Volatility for a volatility index or Jumps for a Jump index. The market list changes to show instruments in that family.", points: ["Every index has its own tick stream.", "Changing the market starts a fresh local sample.", "Past ticks do not determine the next result."] },
  { title: "Select a market", body: "The selected symbol supplies the live quotes and final digits shown by the radar and frequency list.", points: ["Wait for the selected market to connect.", "The server checks the symbol again before a buy.", "The same market is used for every contract in an AI batch."] },
  { title: "Read the live tick count", body: "The counter reports fresh ticks collected since the last rescan or market change.", points: ["A new scan starts at zero.", "The sample contains up to the most recent 120 collected digits.", "The AI runner waits for at least 20 fresh ticks."] },
  { title: "Rescan the market", body: "Rescan clears Matches' local digit sample and resets its tick counter. It does not change Deriv history or any open contract.", points: ["Use Rescan after changing how you want to inspect the data.", "The next live ticks begin the new sample.", "A rescan does not improve or guarantee an outcome."] },
  { title: "The digit circle", body: "The radar places digits 0 through 9 around a circle. Select a digit on the radar or from the matching digit controls.", points: ["The selected digit is highlighted.", "Radar size reflects the number of times each digit appeared in this sample.", "It is a frequency display, not a probability guarantee."] },
  { title: "The spider-net plot", body: "The connected radar shape compares the observed counts for digits 0 through 9 in the current sample.", points: ["A farther point means more observations in this sample.", "The plot changes as new ticks arrive.", "A larger historical count does not ensure a future match."] },
  { title: "Top three observed digits", body: "The top three list ranks digits by their frequency in the current fresh sample. Recent frequency is not a dependable forecast of the next digit.", points: ["Counts and percentages use only the current sample.", "Ties use the most recently observed digit as a display tie-breaker.", "The list can change as ticks arrive."] },
  { title: "Choose a manual digit", body: "Select any digit from 0 to 9 for a manual Matches trade. The selected number becomes the contract barrier.", points: ["Check the highlighted digit before buying.", "The button submits only the selected digit.", "The expiry digit decides the contract result."] },
  { title: "What Digit Match means", body: "A Digit Match contract wins only when the final digit at expiry equals the selected barrier.", points: ["A different final digit loses the stake.", "The contract's displayed payout is set by Deriv.", "Observed frequency does not change the contract's rules."] },
  { title: "Choose duration", body: "Select 1, 2, 3, 4, or 5 ticks. Duration is sent with each order and is checked by the server.", points: ["Short duration settles sooner but can change quickly.", "The duration does not make a digit more likely.", "Open contracts block the next automatic batch until settlement."] },
  { title: "Set the stake", body: "Enter the amount to risk per selected digit. The minimum is 0.35; the connected account balance and Deriv's own rules still apply.", points: ["For a batch, the amount is applied to each selected digit.", "The server checks total batch stake against the balance.", "There is no promise that every entered amount will be accepted by Deriv."] },
  { title: "Place a manual trade", body: "The manual Matches button submits one Digit Match contract for the selected digit, stake, market, and duration.", points: ["Confirm the selected account and setup first.", "Wait for the buy acknowledgement.", "If an acknowledgement is uncertain, check Deriv history before trying again."] },
  { title: "Turn on AI Matches", body: "AI Matches can submit trades using the top one, two, or three digits from the current observed-frequency ranking.", points: ["The label does not mean an AI model knows the next result.", "Automatic trading waits for a fresh sample and available settlement slot.", "A losing trade is possible on every entry."] },
  { title: "Select one, two, or three digits", body: "The AI digit-count setting controls how many of the current top-ranked digits are included in one batch.", points: ["Each selected digit becomes a separate contract.", "The stake is charged per contract, so a three-digit batch uses three stakes.", "The server limits a batch to three contracts and checks total balance."] },
  { title: "Start continuous Matches", body: "Start Matches enables repeated automatic entries. It waits for live data, the sample floor, and all prior contracts to settle before sending another batch.", points: ["The AI toggle also starts or stops automatic entries.", "Stop Matches prevents future entries but does not close open contracts.", "An ambiguous buy pauses the runner for history verification."] },
  { title: "Stop and pause safely", body: "Stop Matches pauses future automatic entries. An already-sent buy cannot be cancelled by the page and may still settle normally.", points: ["Check Deriv history if a request status is uncertain.", "Do not resubmit an unconfirmed buy.", "Open contracts can continue to settle after stopping."] },
  { title: "Matches trading history", body: "Matches history shows only contract IDs acknowledged by the Matches feature for the selected account, using the same history display as Trade X.", points: ["Other features' contracts are excluded.", "History is sourced from Deriv and can update after settlement.", "Clearing the local display does not delete Deriv account records."] },
  { title: "Risk and responsible use", body: "No frequency ranking or automated rule can promise accuracy, profit, or rare losses. Random digit outcomes can differ from the recent sample.", points: ["Never stake money you cannot afford to lose.", "Set an amount and stop when it reaches your own limit.", "Review results on a demo account before considering real funds."] },
] as const;

const digitFlipGuidePages = [
  { title: "Welcome to DigitFlip", body: "DigitFlip trades Even or Odd contracts using a live parity sample. Estimates describe recent ticks and never guarantee the next contract result.", points: ["Start with a demo account.", "Only one of DigitFlip, Trade X, and EDGE can run at once.", "Auto Candidates reviews the strongest market every 10 seconds after settlement."] },
  { title: "Choose a market and parity", body: "DigitFlip starts with an automatically selected market, then lets you choose Volatility or Jump markets manually. Even and Odd have distinct selected states.", points: ["The quote and last digit are live telemetry.", "Recent percentages come from the selected market sample.", "The market selector does not predict the next digit."] },
  { title: "Stake and duration", body: "Choose 1 to 5 ticks and begin with a flat stake of 0.50 or more. Tick 0 is entry; settlement is evaluated on the selected numbered tick. Martingale after loss is optional and can grow exposure quickly.", points: ["Decimals are supported for the multiplier.", "Use a small stake while evaluating a signal.", "There is no max-stake control in this workspace."] },
  { title: "Run, stop, and reset", body: "Run starts the guarded loop. Stop prevents another entry after the active request. Reset clears only session P/L and current stake; it does not delete Deriv history.", points: ["Take Profit and Stop Loss stop the loop.", "Recent trades can be hidden from this dashboard.", "Hidden rows remain in Deriv."] },
  { title: "Reading the live parity", body: "DigitFlip uses the live Even and Odd percentages as market context. The percentages describe recent ticks and never guarantee the next contract result.", points: ["Wait for a meaningful live sample before trading.", "Use a small stake while evaluating a market.", "No condition is presented as a guaranteed win."] },
  { title: "Live account protection", body: "Selecting a real account routes DigitFlip orders to real funds. The server's live-trading setting and balance checks still apply.", points: ["Use demo funds while learning.", "Check the selected account before every session.", "Deriv confirms each contract and its settlement."] },
  { title: "Reading the market label", body: "The market label identifies the stream currently used for the parity sample. A new market needs fresh observations before its percentages become useful.", points: ["Wait for the sample to refresh after switching.", "Do not mix observations from different markets.", "The quote is live context, not a promise."] },
  { title: "Auto Candidates", body: "Auto Candidates compares supported markets using the available parity sample and can select a stronger observed setup after settlement.", points: ["It is a selection aid, not an outcome guarantee.", "It can change the market between entries.", "Stop the loop before changing your risk settings."] },
  { title: "Assault mode", body: "Assault mode changes which parity direction is considered for the next entry after a settlement. It does not change Deriv's contract rules.", points: ["Review the active parity before starting.", "Keep the stake small while evaluating the mode.", "Use a stop limit for every live experiment."] },
  { title: "Magic mode", body: "Magic mode applies the configured parity decision from the live sample and session state. It remains subject to the same account and balance guards.", points: ["Server-side permissions and balance checks still apply.", "The mode does not change contract expiry.", "Turn it off when you want manual control."] },
  { title: "Take Profit and Stop Loss", body: "Session limits stop the local loop when the configured positive or negative result is reached. They do not close an already-open contract.", points: ["A limit is a guardrail, not a guarantee.", "Open contracts may settle after stopping.", "Review history before restarting."] },
  { title: "Martingale caution", body: "If Martingale is enabled, the next stake can increase after a losing settlement and reset after a profitable one.", points: ["Losses can grow exposure quickly.", "Keep a reserve in the selected account.", "Demo-test before considering real funds."] },
  { title: "History and session state", body: "The session counter and P/L describe the active DigitFlip run. History rows remain separate from other feature histories.", points: ["Reset does not delete Deriv records.", "Clear hides rows from this dashboard only.", "Open contracts show as unsettled until Deriv responds."] },
  { title: "A safe first session", body: "Begin with one-tick demo contracts, a small stake, and a fresh sample. Stop when the signal no longer matches your plan.", points: ["Confirm the account and market.", "Check the active parity and duration.", "Never call a streak a guaranteed win."] },
  { title: "Final checklist", body: "You are ready to use DigitFlip when the account, market, parity, duration, stake, and risk limits are all intentional.", points: ["Start with one small demo trade.", "Watch the settlement and history update.", "Keep the guide open while learning."] },
  { title: "Live tick timing", body: "The quote and last digit can change between the moment you read the panel and the moment a request reaches Deriv.", points: ["Use the live label to confirm the stream.", "Do not assume the previous digit repeats.", "Short duration does not remove timing risk."] },
  { title: "Dual parity context", body: "When the parity controls expose both directions, compare the live Even and Odd sample before choosing the action.", points: ["Dual does not remove contract risk.", "Both sides are tracked independently.", "Read the returned contracts separately."] },
  { title: "History clearing", body: "The DigitFlip clear action hides visible dashboard rows after confirmation while leaving Deriv records untouched.", points: ["Tap twice to confirm.", "Open contracts are not cancelled.", "The history panel can be rebuilt by a fresh session."] },
  { title: "When to stop", body: "Stop the loop when the sample is too thin, the account changes, the risk limit is reached, or the signal no longer matches your plan.", points: ["Stopping prevents another entry.", "Already-open contracts may still settle.", "Review results before restarting."] },
  { title: "Ready to begin", body: "Use DigitFlip deliberately: choose the account, market, parity, duration, stake, and guardrails, then begin with a small demo action.", points: ["Confirm the live stream.", "Keep the first session simple.", "Return to this guide whenever you change modes."] },
] as const;

const bulkTraderGuidePages = [
  { title: "Welcome to Bulk Trader", body: "Bulk Trader is the fast multi-contract workspace for reading live digit context and sending one to six separate contracts from a single action.", points: ["Start on a demo account.", "The feature switch pauses the other trading surfaces.", "Percentages describe the current sample and do not guarantee an outcome."] },
  { title: "Connect and choose an account", body: "Connect your Deriv account, then review the account shown in the trading account selector before opening Bulk Trader.", points: ["Demo funds are the safest place to learn.", "Selecting a real account routes trades to those funds when server live trading is enabled.", "Account changes refresh the live session."] },
  { title: "Choose a market", body: "The market list includes Volatility and Jump pairs. Selecting a pair changes the live Deriv stream used by the current tick and digit sample.", points: ["Use the filter to focus on Volatility or Jump pairs.", "The right-side percentage is live observed context.", "Wait for fresh ticks after switching markets."] },
  { title: "Select a trade type", body: "Bulk Trader supports Over / Under and Differs. The rest of the panel changes to match the selected contract family.", points: ["Only the controls for the active type are shown.", "Differs uses one selected digit.", "Manual trade buttons remain available regardless of the observed signal."] },
  { title: "Live analysis", body: "Bulk Trader keeps a running count of observed ticks for the selected market. The digit percentages and markers update as new ticks arrive.", points: ["Refresh starts the counter again at 1.", "The counter has no fixed end value.", "Observed percentages provide context, not certainty."] },
  { title: "Over and Under predictions", body: "Over / Under predictions use digits 1 through 9. The selected digit becomes the barrier sent with the matching contract.", points: ["Over wins above the selected barrier.", "Under wins below the selected barrier.", "The expiry digit decides the contract result."] },
  { title: "Reading O, U, and =", body: "For Over / Under, the digit row marks values above the selected barrier with O, below it with U, and the selected barrier with =.", points: ["The markers follow the selected prediction.", "The current tick is marked separately.", "A marker is descriptive market context only."] },
  { title: "Differs predictions", body: "Differs uses digits 0 through 9. The selected digit is the barrier that the contract must differ from at expiry.", points: ["The row does not show O or U markers in this mode.", "The selected digit is visibly emphasized.", "A digit absent from the sample is still not guaranteed to be absent next."] },
  { title: "Current tick display", body: "The current tick readout shows the latest live quote's last digit and marks that digit in the ten-digit strip.", points: ["The red pointer identifies the latest digit.", "A quote can move before the next control action.", "The sample trail shows recent context, not a fixed sequence."] },
  { title: "Execution ticks", body: "Execution duration is set separately from the analysis window. Choose 1 through 5 ticks for how long each contract observes before settlement.", points: ["One tick resolves quickly.", "Longer durations are not automatically safer.", "Changing duration does not rewrite past rows."] },
  { title: "Stake", body: "Stake starts at 0.35 and accepts decimals. The server and selected account remain the final authority over whether a contract can be bought.", points: ["Keep a reserve in the account.", "There is no artificial maximum in the control.", "A valid stake does not remove market risk."] },
  { title: "Number of bulk trades", body: "Choose 1 through 6 bulk trades. One action sends that many separate contracts and the history lists each returned contract independently.", points: ["Bulk count is not a single combined contract.", "Watch the account balance before increasing count.", "The request is blocked while another bulk request is pending."] },
  { title: "Trade buttons", body: "The action buttons change with the active trade type and show the current observed percentage beneath the label.", points: ["Over / Under show two buttons.", "Differs shows one action for the selected digit.", "Manual actions remain available when the observed signal is not ready."] },
  { title: "Live-money protection", body: "Bulk Trader uses the selected account. The API enforces server live-trading permission, account balance, and open-contract checks.", points: ["Switch to demo when learning.", "A disabled button means a required server or account guard is not satisfied.", "Review the selected stake and trade count before sending."] },
  { title: "Bulk trade history", body: "Each returned contract is shown with its type, symbol, account, buy amount, status, and settlement result.", points: ["Open contracts show no final result yet.", "Rows update as the Deriv stream settles.", "Bulk history is kept separate from the other feature panels."] },
  { title: "Clearing history", body: "The history bin uses a two-step clear. Tap once to arm it, then tap again within the short window; rows fade from the dashboard without deleting Deriv records.", points: ["The second tap confirms the action.", "The fade gives feedback before rows disappear.", "Clearing does not affect active contracts."] },
  { title: "A safe first bulk session", body: "Use one demo contract, one tick, a small stake, and a fresh sample before increasing the bulk count or duration.", points: ["Confirm market, type, prediction, ticks, and stake.", "Watch the first returned row settle.", "Treat every percentage and streak as observed context, never certainty."] },
  { title: "Final checklist", body: "Bulk Trader is ready when the account, market, trade type, prediction, analysis window, execution duration, stake, and bulk count are intentional.", points: ["Start with a small demo batch.", "Keep the clear control available for dashboard hygiene.", "Use the guide again whenever you change contract family."] },
] as const;

const moneyBankGuidePages = [
  { title: "Welcome to Money Bank", body: "Money Bank is the Accumulator workspace for Volatility markets. It uses one open contract at a time and keeps the selected settings and recovery state visible.", points: ["Start with a demo account while learning.", "Accumulator outcomes are not guaranteed.", "Read the full guide before using live funds."] },
  { title: "Connect your Deriv account", body: "Connect your own PAT and select the account that Money Bank should use. The server validates the credential and the account balance before every entry.", points: ["Use a demo account first.", "Selecting a real account routes Accumulator contracts to it when live trading is enabled.", "Keep your PAT private."] },
  { title: "Choose a Volatility pair", body: "The market selector contains Volatility indices only, including 1-second V10, V15, V25, V30, V50, V75, V90, and V100 streams.", points: ["Switch markets before starting.", "Live quotes show the selected stream.", "Changing markets does not change the recovery ladder."] },
  { title: "Growth rate", body: "Growth rate is the Accumulator growth applied to each tick. Higher rates can increase the theoretical return while also changing the contract risk.", points: ["Available rates are 1% through 5%.", "The exact decimal rate is sent to Deriv.", "The rate is not a win probability."] },
  { title: "Take-profit ticks", body: "Take Profit ticks is the exact contract duration target used by Money Bank. The panel keeps it between 5 and 50 ticks because Deriv Accumulator contracts require at least five ticks.", points: ["Shorter contracts settle sooner.", "Longer contracts expose the position for more ticks.", "The selected tick target is sent unchanged to Deriv."] },
  { title: "Auto Budget BASE", body: "Auto Budget keeps the planned cumulative stakes within the selected amount, using as many of the seven levels as the minimum stake allows.", points: ["The planned total stays within the entered budget.", "A loss on the final affordable level stops the run.", "This risk limit does not guarantee recovery or profit."] },
  { title: "Manual BASE", body: "Manual BASE lets you choose the first stake directly. Each recovery level is calculated from that BASE and the selected growth and tick settings.", points: ["Use a small stake while testing.", "The next level can be larger after a loss.", "Keep enough balance for the full ladder."] },
  { title: "Recovery ladder", body: "BASE through L6 are explicit recovery levels. A losing settlement advances one level; a profitable settlement resets the level.", points: ["L6 is the final level.", "Money Bank stops instead of silently extending the ladder.", "The ladder is always visible before entry."] },
  { title: "Reinvest Profit", body: "Reinvest Profit is off by default. When it is off, every win resets to the original BASE; when it is on, the win is added to the next BASE.", points: ["The switch changes the next cycle only.", "Compounding can increase exposure quickly.", "Review the next-stake value after every win."] },
  { title: "Profit Target", body: "Profit Target is an optional session limit in account currency. Leave it blank to run without a positive P/L stop.", points: ["The limit is checked after settlement.", "It does not close a contract early.", "Blank means no profit target is applied."] },
  { title: "Loss Limit", body: "Loss Limit is an optional session guard. Leave it blank to run without a negative P/L stop.", points: ["The limit is checked after settlement.", "It is a guardrail, not a loss guarantee.", "Blank means no loss limit is applied."] },
  { title: "Safest pair snapshot", body: "The snapshot compares the live samples for supported Volatility pairs. It is advisory and does not change your selected market or settings.", points: ["Wait for samples before comparing markets.", "The snapshot is descriptive, not a prediction.", "Select any market manually before starting."] },
  { title: "Live pair samples", body: "The snapshot lists observed tick counts, rise and fall percentages, and the latest quote for each supported pair.", points: ["It shows observed market data, not simulated sessions.", "Refresh updates the capture time.", "Select a market manually before starting."] },
  { title: "Account and session", body: "The selected account and live balance appear in the workspace header. Money Bank session P/L and trade count remain in the footer.", points: ["Open contracts remain unsettled until Deriv responds.", "Session values reset when a new Money Bank run starts.", "The account balance is supplied by Deriv."] },
  { title: "Start Accumulator", body: "Start Accumulator validates the connection, account, balance, and calculated BASE before starting the guarded loop.", points: ["Check the selected pair and ladder first.", "The loop waits for settlement before its next entry.", "Only one Money Bank action runs at a time."] },
  { title: "Stop Accumulator", body: "Stop Accumulator immediately prevents another pending entry and then sends a close request for every open Accumulator contract found in the session history.", points: ["Wait for the closing state to finish.", "A pending buy is closed when Deriv acknowledges it.", "Stopping does not delete trade history."] },
  { title: "Trade history", body: "Money Bank history lists each returned Accumulator contract with its market, account, barrier, price, current value, payout, profit, status, and timestamps.", points: ["Open rows update with current value and profit.", "Rows update as Deriv settles or closes them.", "History is scoped visually to Accumulator contracts."] },
  { title: "Download and Reset", body: "Download exports the visible Money Bank rows as a CSV file. Reset uses a two-tap confirmation and fades the visible rows before clearing them from this panel.", points: ["Download does not alter account records.", "Reset does not cancel open contracts.", "A fresh run can add new rows again."] },
  { title: "Live-money protection", body: "Selecting a real account routes Accumulator contracts to real funds. Server permission, balance, and settlement checks remain active. Never treat the snapshot as a guarantee.", points: ["Demo testing is strongly recommended.", "A disabled action means a required server or account guard is missing.", "Keep an acceptable reserve in the account."] },
  { title: "Final checklist", body: "Money Bank is ready when the account, Volatility pair, growth rate, ticks, BASE strategy, optional limits, reinvest state, and auto-switch state are intentional.", points: ["Start small.", "Watch every settlement.", "Stop if the session no longer matches your plan."] },
] as const;

const cashGrabGuidePages = [
  { title: "Welcome to Cash Grab Rise/Fall", body: "Cash Grab is a controlled Rise/Fall workspace. It shows the selected market, direction, stake, duration, and trade history.", points: ["Start with a demo account.", "Recent market samples are not guarantees.", "Use the guide before risking live funds."] },
  { title: "Connect Deriv", body: "Connect your Deriv account with a Personal Access Token that has the permissions needed to read markets and trade.", points: ["Keep your token private.", "Check the active account and currency.", "Demo funds are the safest place to learn."] },
  { title: "Choose an account", body: "The account selector shows the account Cash Grab will use and its latest available balance.", points: ["Review the account before every session.", "Selecting a real account routes contracts to it when server live trading is enabled.", "A server-side balance check still applies."] },
  { title: "Rise and Fall contracts", body: "Rise and Fall are directional contracts sent to Deriv as CALL and PUT. Cash Grab only offers these two contract types.", points: ["Rise uses CALL.", "Fall uses PUT.", "The contract result is decided by Deriv at expiry."] },
  { title: "What Rise means", body: "A Rise contract compares the exit quote with the entry quote according to the selected contract duration.", points: ["Choose Rise only when it matches your plan.", "The entry quote does not promise the exit quote.", "Check the contract details before starting."] },
  { title: "What Fall means", body: "A Fall contract uses the opposite quote direction from Rise for the same market and duration.", points: ["Choose Fall only when it matches your plan.", "A falling quote can reverse before expiry.", "Review the actual settlement in history."] },
  { title: "Choose a market", body: "Cash Grab can use supported Volatility and Jump markets. The live quote and sample belong to the selected market.", points: ["Wait for fresh data after switching.", "Auto best selects a market from observed direction rates.", "Auto selection does not predict a future result."] },
  { title: "Manual and automatic markets", body: "Choose a specific market to keep the pair fixed, or select Auto best to use the strongest eligible observed rate.", points: ["Manual selection keeps your chosen pair.", "Auto best may update the pair between entries.", "Review the market shown before starting."] },
  { title: "Read the live quote", body: "The quote card displays the most recent quote for the active market. It can change before a request reaches Deriv.", points: ["A live quote is not a forecast.", "The newest displayed value may differ from the entry quote.", "Use a fresh connection before trading."] },
  { title: "Read Rise and Fall samples", body: "The direction bar summarizes observed Rise and Fall movement in the available market sample.", points: ["Small samples can change quickly.", "A larger percentage is still not a promise.", "A safety gate can hold an entry when evidence is too limited."] },
  { title: "Select a direction", body: "Choose Rise or Fall explicitly. Cash Grab keeps that direction for the next entry and does not silently flip it.", points: ["Confirm the selected direction.", "Changing direction while stopped does not send a trade.", "The trade request matches the visible selection."] },
  { title: "Set the stake", body: "Stake is the base amount used for each contract. Cash Grab enforces a minimum of 0.35 and checks the connected account balance before every entry.", points: ["Use a small demo stake while learning.", "Multiply mode can increase the next stake after a loss.", "Leave a reserve instead of using the full balance."] },
  { title: "Set duration and stake mode", body: "Rise/Fall duration can be set from one to five ticks. Tick 0 is entry; settlement is evaluated on the selected numbered tick. Choose Flat for the same stake each time, or Multiply to apply your entered multiplier after a loss.", points: ["Cash Grab waits for each contract to settle before the next entry.", "A win restores the base stake.", "A larger multiplier can increase exposure quickly."] },
  { title: "Custom multiplier", body: "In Multiply mode, enter any positive multiplier for the next contract after a settled loss. A win returns the stake to the configured base amount.", points: ["The multiplier has no app-imposed maximum.", "The available account balance is checked before every entry.", "Multiplying does not guarantee recovery."] },
  { title: "Auto-switch safety", body: "Auto-switch reviews fresh market samples on its scan schedule and changes markets only when the observed direction rate, sample, and balance checks pass.", points: ["It can change markets between entries.", "It does not alter your selected stake mode or multiplier.", "It may wait rather than send when no setup qualifies."] },
  { title: "Run Cash Grab", body: "Start checks the connection, selected account, and available balance, then sends one Rise/Fall contract at a time until you stop it.", points: ["Review market, direction, stake, mode, and duration.", "Each request waits for the current contract to settle before the next.", "If a check or request fails, Cash Grab stops and reports the reason."] },
  { title: "Stop Cash Grab", body: "Stop prevents Cash Grab from starting another batch and requests closure for open contracts claimed by the active session.", points: ["Wait until the stopping state finishes.", "A contract can settle while a close request is being handled.", "Already settled contracts remain in history."] },
  { title: "Cash Grab history", body: "Cash Grab history shows the contracts sent by this feature. Open contracts are not final results, and the rows remain visible after stopping.", points: ["Check each returned contract and direction.", "Clearing dashboard rows does not delete Deriv records.", "Observed rates describe past samples only."] },
  { title: "Final Rise/Fall checklist", body: "Before a session, confirm the selected account, market, Rise or Fall direction, stake, Flat or Multiply mode, multiplier, and one-to-ten-tick duration.", points: ["Use demo funds while testing.", "Keep the Stop control available.", "Treat all observed rates as historical context, not certainty."] },
] as const;

const tradeXSymbols: readonly TradeXSymbolOption[] = markets.map(([value, label]) => ({
  value,
  label,
  marketType: value.startsWith("JD") ? "jumps" : "volatility",
}));

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const DIGIT_FLIP_SIGNAL_FLOOR = 80;
const DIGIT_FLIP_MARKET_SCAN_INTERVAL_MS = 10_000;
const EDGE_PERCENTAGE_SCAN_FLOOR = 90;
const EDGE_MIN_MARKET_SAMPLE = 20;
// The trading calendar is deliberately internal. "all-days" keeps the
// strategy available on both weekdays and weekends without adding another
// user-facing switch that could be mistaken for a market prediction.
const TRADING_CALENDAR_MODE = "all-days" as const;
const isTradingCalendarOpen = (date = new Date()) => (
  TRADING_CALENDAR_MODE === "all-days"
  || (TRADING_CALENDAR_MODE === "weekdays" && date.getDay() > 0 && date.getDay() < 6)
  || (TRADING_CALENDAR_MODE === "weekends" && (date.getDay() === 0 || date.getDay() === 6))
);
const errorMessage = (error: unknown) => {
  return getUserFacingErrorMessage(error, "Request failed");
};

type MartingaleSettlementWatch = {
  knownIds: Set<string>;
  processedIds: Set<string>;
  amount: number;
  expectedSettlements: number;
};

type DigitFlipSettlementWatch = {
  knownIds: Set<string>;
  processedIds: Set<string>;
};

type CashGrabAutoSwitchRecommendation = {
  symbol: string;
  observedWinRate: number;
  sampleCount: number;
  score: number;
};

export default function XTraderPage() {
  const accessSession = useGetAccessSession({ query: { retry: false, queryKey: getGetAccessSessionQueryKey() } });
  const adminFeatureSettings = useGetAdminFeatureSettings({
    query: { retry: false, refetchInterval: 5_000, queryKey: getGetAdminFeatureSettingsQueryKey() },
  });
  const queryClient = useQueryClient();
  const { logout: logoutAccessSession, isLoggingOut } = useAccessSessionLogout();
  const isAdmin = accessSession.data?.is_admin === true;
  const featureControl = (feature: FeatureControl["feature"]) =>
    adminFeatureSettings.data?.features.find((item) => item.feature === feature);
  const featureIsAvailable = (feature: FeatureControl["feature"]) =>
    isAdmin || featureControl(feature)?.mode === "available";
  const hasFeature = (feature: FeatureControl["feature"]) =>
    isAdmin || accessSession.data?.features.includes(feature) === true;
  const canUseEdge = hasFeature("edge") && featureIsAvailable("edge");
  const canUseDigitFlip = hasFeature("digit-flip") && featureIsAvailable("digit-flip");
  const canUseTradeX = hasFeature("trade-x") && featureIsAvailable("trade-x");
  const canUseBulkTrader = hasFeature("bulk-trader") && featureIsAvailable("bulk-trader");
  const canUseMatchesAnalysis = hasFeature("matches-analysis") && featureIsAvailable("matches-analysis");
  const canUseClockWork = hasFeature("clock-work") && featureIsAvailable("clock-work");
  const canUseCashGrab = hasFeature("cash-grab") && featureIsAvailable("cash-grab");
  const canUseMoneyBank = hasFeature("money-bank") && featureIsAvailable("money-bank");
  const canUseAutoTrader = hasFeature("auto-trader") && featureIsAvailable("auto-trader");
  const canUseAutoTrader2 = hasFeature("auto-trader-2") && featureIsAvailable("auto-trader-2");
  const canUseSettings = hasFeature("settings") && featureIsAvailable("settings");
  const canUseDeriv = canUseEdge || canUseDigitFlip || canUseTradeX || canUseBulkTrader || canUseMatchesAnalysis || canUseClockWork || canUseCashGrab || canUseMoneyBank || canUseAutoTrader || canUseAutoTrader2;
  const canViewHistory = canUseDeriv || (hasFeature("history") && featureIsAvailable("history"));
  const tokenStatus = useGetDerivTokenStatus({ query: { enabled: canUseDeriv, retry: false, queryKey: getGetDerivTokenStatusQueryKey() } });
  const connectedToken = Boolean(tokenStatus.data?.has_token);
  const accounts = useGetDerivAccounts({ query: { enabled: connectedToken && canUseDeriv, retry: false, refetchInterval: 10_000, queryKey: getGetDerivAccountsQueryKey() } });
  const storedPatInvalid = errorMessage(accounts.error).includes("saved Deriv token is no longer readable");
  const status = useGetDerivStatus({ query: { enabled: connectedToken && canUseDeriv, retry: false, refetchInterval: 500, queryKey: getGetDerivStatusQueryKey() } });
  const history = useGetDerivHistory({ query: { enabled: connectedToken && canViewHistory, retry: false, refetchInterval: 5_000, queryKey: getGetDerivHistoryQueryKey() } });
  const derivCapacityError = [accounts.error, status.error]
    .map(errorMessage)
    .find((message) => message.includes("Deriv session limit"));
  const tokenMutation = useTestDerivToken();
  const connectionMutation = useTestDerivConnection();
  const deleteTokenMutation = useDeleteDerivToken();
  const symbolMutation = useSelectDerivSymbol();
  const bulkBuyMutation = useBulkBuyDerivContracts();
  const dualBuyMutation = useDualBuyDerivContracts();
  const digitFlipBuyMutation = useBuyDerivContract();
  const moneyBankBuyMutation = useBuyDerivContract();
  const moneyBankSellMutation = useSellDerivContract();
  const cashGrabSellMutation = useSellDerivContract();
  const clockWorkQuoteMutation = useQuoteClockWorkContracts();
  const clockWorkBuyMutation = useBuyClockWorkContracts();
  const matchesBuyMutation = useBuyMatchesContracts();

  const [pat, setPat] = useState("");
  const [symbol, setSymbol] = useState("R_75");
  const [direction, setDirection] = useState<"DIGITOVER" | "DIGITUNDER">("DIGITOVER");
  const [barrier, setBarrier] = useState(5);
  const [duration, setDuration] = useState(5);
  const [stake, setStake] = useState(1);
  const [strategy, setStrategy] = useState<"flat" | "martingale">("martingale");
  const [martingale, setMartingale] = useState(2);
  const [takeProfit, setTakeProfit] = useState(10);
  const [stopLoss, setStopLoss] = useState(10);
  const [autoSwitch, setAutoSwitch] = useState(false);
  const [edgePercentageMode, setEdgePercentageMode] = useState(false);
  const [edgeSniperOverUnder, setEdgeSniperOverUnder] = useState(false);
  const [edgeRecommendation, setEdgeRecommendation] = useState<BestEdgeSignal | null>(null);
  const [edgeAccountBalance, setEdgeAccountBalance] = useState("");
  const [xTraderEnabled, setXTraderEnabled] = useState(false);
  const [tradeXEnabled, setTradeXEnabled] = useState(false);
  const [tradeXMarketType, setTradeXMarketType] = useState<TradeXMarketType>("volatility");
  const [tradeXSymbol, setTradeXSymbol] = useState("R_75");
  const [tradeXStake, setTradeXStake] = useState(1);
  const [tradeXSelectedDigit, setTradeXSelectedDigit] = useState(5);
  const [tradeXDuration, setTradeXDuration] = useState<TradeXDuration>(1);
  const [tradeXManualSelect, setTradeXManualSelect] = useState(false);
  const [digitFlipEnabled, setDigitFlipEnabled] = useState(false);
  const [edge2Enabled, setEdge2Enabled] = useState(false);
  const [moneyBankSymbol, setMoneyBankSymbol] = useState("1HZ90V");
  const [moneyBankGrowthRate, setMoneyBankGrowthRate] = useState(4);
  const [moneyBankTakeProfitTicks, setMoneyBankTakeProfitTicks] = useState(5);
  const [moneyBankAutoKnockout, setMoneyBankAutoKnockout] = useState(false);
  const [moneyBankStrategy, setMoneyBankStrategy] = useState<MoneyBankStrategy>("budget");
  const [moneyBankBudget, setMoneyBankBudget] = useState(500);
  const [moneyBankManualBase, setMoneyBankManualBase] = useState(1);
  const [moneyBankReinvestProfit, setMoneyBankReinvestProfit] = useState(false);
  const [moneyBankReinvestPercent, setMoneyBankReinvestPercent] = useState(100);
  const [moneyBankProfitTarget, setMoneyBankProfitTarget] = useState<number | null>(null);
  const [moneyBankLossLimit, setMoneyBankLossLimit] = useState<number | null>(null);
  const [moneyBankRunning, setMoneyBankRunning] = useState(false);
  const [moneyBankAutoKnockoutCountdown, setMoneyBankAutoKnockoutCountdown] = useState<number | null>(null);
  const [moneyBankClosing, setMoneyBankClosing] = useState(false);
  const [moneyBankJdyEnabled, setMoneyBankJdyEnabled] = useState(false);
  const [moneyBankJdyState, setMoneyBankJdyState] = useState<"idle" | "scanning" | "safe" | "not-good">("idle");
  const [moneyBankJdyDecision, setMoneyBankJdyDecision] = useState<MoneyBankJdyDecision | null>(null);
  const [moneyBankSessionPnl, setMoneyBankSessionPnl] = useState(0);
  const [moneyBankLastSettledProfit, setMoneyBankLastSettledProfit] = useState<number | null>(null);
  const [moneyBankTradeCount, setMoneyBankTradeCount] = useState(0);
  const [bulkTraderEnabled, setBulkTraderEnabled] = useState(false);
  const [bulkTraderType, setBulkTraderType] = useState<BulkTraderType>("over-under");
  const [bulkTraderPrediction, setBulkTraderPrediction] = useState<BulkTraderPrediction>(5);
  const [bulkTraderSymbol, setBulkTraderSymbol] = useState("R_75");
  const [bulkTraderDuration, setBulkTraderDuration] = useState(1);
  const [bulkTraderStake, setBulkTraderStake] = useState(.35);
  const [bulkTraderCount, setBulkTraderCount] = useState(1);
  const [bulkTraderClearArmed, setBulkTraderClearArmed] = useState(false);
  const [bulkTraderAutoSelectBest, setBulkTraderAutoSelectBest] = useState(false);
  const [bulkTraderHiddenHistoryIds, setBulkTraderHiddenHistoryIds] = useState<Set<string>>(new Set());
  const [cashGrabEnabled, setCashGrabEnabled] = useState(false);
  const [matchesAnalysisEnabled, setMatchesAnalysisEnabled] = useState(false);
  const [matchesMarketType, setMatchesMarketType] = useState<MatchesMarketType>("volatility");
  const [matchesSymbol, setMatchesSymbol] = useState("R_75");
  const [matchesDuration, setMatchesDuration] = useState<MatchesDuration>(1);
  const [matchesStake, setMatchesStake] = useState(0.35);
  const [matchesSelectedDigit, setMatchesSelectedDigit] = useState(5);
  const [matchesAiEnabled, setMatchesAiEnabled] = useState(false);
  const [matchesAiDigits, setMatchesAiDigits] = useState<MatchesAiDigits>(1);
  const [matchesObservedDigits, setMatchesObservedDigits] = useState<number[]>([]);
  const [matchesTickCount, setMatchesTickCount] = useState(0);
  const [matchesStatusMessage, setMatchesStatusMessage] = useState("Rescan to start a fresh digit sample.");
  const [matchesHistoryClearArmed, setMatchesHistoryClearArmed] = useState(false);
  const [matchesHiddenHistoryIds, setMatchesHiddenHistoryIds] = useState<Set<string>>(new Set());
  const [clockWorkEnabled, setClockWorkEnabled] = useState(false);
  const [clockWorkSymbol, setClockWorkSymbol] = useState("R_75");
  const [clockWorkBarrierMode, setClockWorkBarrierMode] = useState<"offset" | "absolute">("offset");
  const [clockWorkHalfBarrier, setClockWorkHalfBarrier] = useState(false);
  const [clockWorkHigherBarrier, setClockWorkHigherBarrier] = useState(.12);
  const [clockWorkLowerBarrier, setClockWorkLowerBarrier] = useState(-.12);
  const [clockWorkHigherStake, setClockWorkHigherStake] = useState(1);
  const [clockWorkLowerStake, setClockWorkLowerStake] = useState(1);
  const [clockWorkH1Stake, setClockWorkH1Stake] = useState(1);
  const [clockWorkL1Stake, setClockWorkL1Stake] = useState(1);
  const [clockWorkL2Stake, setClockWorkL2Stake] = useState(1);
  const [clockWorkH2Stake, setClockWorkH2Stake] = useState(1);
  const [clockWorkQuotes, setClockWorkQuotes] = useState<{ pair: { higher: { payout: number; ask_price: number; spot: number } | null; lower: { payout: number; ask_price: number; spot: number } | null }; allFour: { payout: number; ask_price: number; spot: number } | null }>({
    pair: { higher: null, lower: null },
    allFour: null,
  });
  const [clockWorkQuoteBuffer, setClockWorkQuoteBuffer] = useState<ClockWorkQuoteBuffer>({
    symbol: "R_75",
    quotes: [],
    lastTickId: null,
  });
  const clockWorkMarketResetEpochRef = useRef(0);
  const [clockWorkBarrierAnchor, setClockWorkBarrierAnchor] = useState<number | null>(null);
  const [clockWorkStatusMessage, setClockWorkStatusMessage] = useState<string | null>(null);
  const [clockWorkBusy, setClockWorkBusy] = useState(false);
  const [clockWorkAutoMode, setClockWorkAutoMode] = useState<ClockWorkPanelProps["autoMode"]>("pair");
  const [clockWorkMinLean, setClockWorkMinLean] = useState<number | null>(60);
  const [clockWorkAutoEnabled, setClockWorkAutoEnabled] = useState(false);
  const [clockWorkAggressiveEnabled, setClockWorkAggressiveEnabled] = useState(false);
  const [clockWorkAggressivePercent, setClockWorkAggressivePercent] = useState(5);
  const [clockWorkAggressiveRounds, setClockWorkAggressiveRounds] = useState(0);
  const [clockWorkAutoStatus, setClockWorkAutoStatus] = useState("Select an automatic mode to begin.");
  const [clockWorkHistoryClearArmed, setClockWorkHistoryClearArmed] = useState(false);
  const [clockWorkHiddenHistoryIds, setClockWorkHiddenHistoryIds] = useState<Set<string>>(new Set());
  const [cashGrabDirection, setCashGrabDirection] = useState<CashGrabDirection>("CALL");
  const [cashGrabSymbol, setCashGrabSymbol] = useState("R_75");
  const [cashGrabStake, setCashGrabStake] = useState(.35);
  const [cashGrabDuration, setCashGrabDuration] = useState<CashGrabDuration>(1);
  const [cashGrabStakeMode, setCashGrabStakeMode] = useState<CashGrabStakeMode>("flat");
  const [cashGrabMultiplier, setCashGrabMultiplier] = useState(2);
  const [cashGrabTakeProfit, setCashGrabTakeProfit] = useState(1);
  const [cashGrabLossLimit, setCashGrabLossLimit] = useState(1);
  const [cashGrabSessionPnl, setCashGrabSessionPnl] = useState(0);
  const [cashGrabAutoSelectBest, setCashGrabAutoSelectBest] = useState(false);
  const [cashGrabAutoSwitchSafestPair, setCashGrabAutoSwitchSafestPair] = useState(false);
  const [cashGrabAutoDirection, setCashGrabAutoDirection] = useState(false);
  const [cashGrabAutoSwitchSafestPairStatus, setCashGrabAutoSwitchSafestPairStatus] = useState<CashGrabAiStatus>("off");
  const [cashGrabAutoSwitchRecommendation, setCashGrabAutoSwitchRecommendation] = useState<CashGrabAutoSwitchRecommendation | null>(null);
  const [cashGrabRunning, setCashGrabRunning] = useState(false);
  const [cashGrabStopping, setCashGrabStopping] = useState(false);
  const [cashGrabClearArmed, setCashGrabClearArmed] = useState(false);
  const [cashGrabHiddenHistoryIds, setCashGrabHiddenHistoryIds] = useState<Set<string>>(new Set());
  const [digitFlipMarketType, setDigitFlipMarketType] = useState<DigitFlipMarketType>("auto");
  const [digitFlipSymbol, setDigitFlipSymbol] = useState("R_75");
  const [digitFlipParity, setDigitFlipParity] = useState<DigitFlipParity>("DIGITEVEN");
  const [digitFlipDuration, setDigitFlipDuration] = useState<DigitFlipDuration>(1);
  const [digitFlipStake, setDigitFlipStake] = useState(.5);
  const [digitFlipStakeMode, setDigitFlipStakeMode] = useState<DigitFlipStakeMode>("flat");
  const [digitFlipMultiplier, setDigitFlipMultiplier] = useState(2);
  const [digitFlipTakeProfit, setDigitFlipTakeProfit] = useState(10);
  const [digitFlipStopLoss, setDigitFlipStopLoss] = useState(10);
  const [digitFlipRunning, setDigitFlipRunning] = useState(false);
  const [digitFlipAssault, setDigitFlipAssault] = useState(false);
  const [digitFlipMagic, setDigitFlipMagic] = useState(false);
  const [digitFlipCurrentStake, setDigitFlipCurrentStake] = useState(.5);
  const [digitFlipSessionPnl, setDigitFlipSessionPnl] = useState(0);
  const [digitFlipTradeCount, setDigitFlipTradeCount] = useState(0);
  const [digitFlipSampleCount, setDigitFlipSampleCount] = useState(0);
  const [digitFlipEvenCount, setDigitFlipEvenCount] = useState(0);
  const [digitFlipAccountBalance, setDigitFlipAccountBalance] = useState("");
  const [digitFlipClearArmed, setDigitFlipClearArmed] = useState(false);
  const [edgeHiddenHistoryIds, setEdgeHiddenHistoryIds] = useState<Set<string>>(new Set());
  const [digitFlipHiddenHistoryIds, setDigitFlipHiddenHistoryIds] = useState<Set<string>>(new Set());
  const [edgeMinWinRate, setEdgeMinWinRate] = useState(90);
  const [tradeXTradesSent, setTradeXTradesSent] = useState(0);
  const [tradeXSubmitting, setTradeXSubmitting] = useState(false);
  const [tradeXMessage, setTradeXMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [guidePage, setGuidePage] = useState(0);
  const [guideMode, setGuideMode] = useState<"edge" | "trade-x" | "digit-flip" | "bulk-trader" | "money-bank" | "cash-grab" | "matches-analysis" | "clock-work">("edge");
  const [clearHistoryArmed, setClearHistoryArmed] = useState(false);
  const [historyFading, setHistoryFading] = useState(false);
  const [tradeXHistoryClearArmed, setTradeXHistoryClearArmed] = useState(false);
  const [tradeXHiddenHistoryIds, setTradeXHiddenHistoryIds] = useState<Set<string>>(new Set());
  const [sessionPnl, setSessionPnl] = useState(0);
  const [sessionTrades, setSessionTrades] = useState(0);
  const [analysisDigits, setAnalysisDigits] = useState<number[]>([]);
  const [analysisTickCount, setAnalysisTickCount] = useState(0);
  const [connectionMessage, setConnectionMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [connectionMessageFading, setConnectionMessageFading] = useState(false);
  useEffect(() => {
    if (!connectionMessage) {
      setConnectionMessageFading(false);
      return;
    }
    setConnectionMessageFading(false);
    const fadeTimer = window.setTimeout(() => setConnectionMessageFading(true), 4500);
    const removeTimer = window.setTimeout(() => setConnectionMessage(null), 5000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [connectionMessage]);
  const [nextStake, setNextStake] = useState(stake);
  const runningRef = useRef(false);
  const autoSwitchRef = useRef(autoSwitch);
  const edgePercentageModeRef = useRef(edgePercentageMode);
  const edgeProposalRequestKeyRef = useRef("");
  const edgeProposalMutation = useRequestDerivProposal();
  const edgeLossStreakRef = useRef(0);
  const edgeProcessedSettlementIdsRef = useRef(new Set<string>());
  const nextStakeRef = useRef(stake);
  const martingaleWatchRef = useRef<MartingaleSettlementWatch | null>(null);
  const analysisEpochRef = useRef<number | null>(null);
  const tradeXActionLockRef = useRef(false);
  const edgeActionLockRef = useRef(false);
  const edgeSettlementLockRef = useRef(false);
  const bulkActionLockRef = useRef(false);
  const aiScannerActionLockRef = useRef(false);
  const digitFlipRunningRef = useRef(false);
  const moneyBankRunningRef = useRef(false);
  const moneyBankActionLockRef = useRef(false);
  const moneyBankClosePromiseRef = useRef<Promise<void> | null>(null);
  const moneyBankOpenContractIdRef = useRef<string | null>(null);
  const moneyBankJdyScanInFlightRef = useRef(false);
  const cashGrabRunningRef = useRef(false);
  const cashGrabRunIdRef = useRef(0);
  const cashGrabActionLockRef = useRef(false);
  const cashGrabOpenContractIdsRef = useRef(new Set<string>());
  const cashGrabCurrentStakeRef = useRef(.35);
  const cashGrabSessionPnlRef = useRef(0);
  const cashGrabSessionKnownIdsRef = useRef<Set<string> | null>(null);
  const cashGrabProcessedSettlementIdsRef = useRef(new Set<string>());
  const cashGrabConfigRef = useRef<CashGrabStartConfig | null>(null);
  const cashGrabAutoSwitchBusyRef = useRef(false);
  const cashGrabAutoSwitchNextAtRef = useRef<number | null>(null);
  const cashGrabAutoSwitchRecommendationRef = useRef<CashGrabAutoSwitchRecommendation | null>(null);
  const cashGrabClosePromiseRef = useRef<Promise<void> | null>(null);
  const moneyBankSessionKnownIdsRef = useRef<Set<string> | null>(null);
  const moneyBankProcessedSettlementIdsRef = useRef(new Set<string>());
  const moneyBankLevelRef = useRef(0);
  const moneyBankConfigRef = useRef<MoneyBankStartConfig | null>(null);
  const moneyBankSessionPnlRef = useRef(0);
  const digitFlipActionLockRef = useRef(false);
  const digitFlipAssaultRef = useRef(false);
  const digitFlipMagicRef = useRef(false);
  const digitFlipNextMarketScanAtRef = useRef(0);
  const digitFlipAutoSelectionKeyRef = useRef("");
  const digitFlipMarketSignalsRef = useRef<DigitFlipMarketSignal[]>([]);
  const digitFlipRatesRef = useRef({ even: 50, odd: 50 });
  const digitFlipConfigRef = useRef({
    marketType: digitFlipMarketType,
    symbol: digitFlipSymbol,
    parity: digitFlipParity,
    duration: digitFlipDuration,
    stake: digitFlipStake,
    stakeMode: digitFlipStakeMode,
    multiplier: digitFlipMultiplier,
  });
  const edgeAnalysisRef = useRef({ sample: 0, overPercent: 50, underPercent: 50 });
  const liveTickSequenceRef = useRef(0);
  const digitFlipNextStakeRef = useRef(digitFlipStake);
  const digitFlipMartingaleWatchRef = useRef<{ knownIds: Set<string>; processedIds: Set<string> } | null>(null);
  const digitFlipAssaultWatchRef = useRef<DigitFlipSettlementWatch | null>(null);
  const digitFlipAssaultLossesRef = useRef<Record<DigitFlipParity, number>>({
    DIGITEVEN: 0,
    DIGITODD: 0,
  });
  const sessionAccountIdRef = useRef<string | null>(null);
  const edgeSessionKnownIdsRef = useRef<Set<string> | null>(null);
  const digitFlipSessionKnownIdsRef = useRef<Set<string> | null>(null);
  const bulkSessionKnownIdsRef = useRef<Set<string> | null>(null);
  const edgeClaimedHistoryIdsRef = useRef(new Set<string>());
  const tradeXClaimedHistoryIdsRef = useRef(new Set<string>());
  const digitFlipClaimedHistoryIdsRef = useRef(new Set<string>());
  const bulkClaimedHistoryIdsRef = useRef(new Set<string>());
  const cashGrabClaimedHistoryIdsRef = useRef(new Set<string>());
  const clockWorkClaimedHistoryIdsRef = useRef(new Set<string>());
  const matchesClaimedHistoryIdsRef = useRef(new Set<string>());
  const moneyBankClaimedHistoryIdsRef = useRef(new Set<string>());
  const matchesSessionKnownIdsRef = useRef<Set<string> | null>(null);
  const historyFeatureOwnersRef = useRef(new Map<string, DerivHistoryFeature>());
  const matchesAiRunningRef = useRef(false);
  const matchesActionLockRef = useRef(false);
  const matchesAutomationAttemptTickRef = useRef(-1);
  const matchesSampleCursorRef = useRef({ symbol: "", tickCount: 0 });
  const clockWorkActionLockRef = useRef(false);
  const clockWorkAutoAttemptAtRef = useRef(0);
  const clockWorkAutomationRef = useRef<(() => void) | null>(null);
  const clockWorkQuoteOrderBuilderRef = useRef<(() => {
    pair: ClockWorkContractOrder[];
    allFour: ClockWorkContractOrder[];
  }) | null>(null);
  const configRef = useRef({
    direction,
    barrier,
    duration,
    stake,
    strategy,
    martingale,
    symbol,
    sniperOverUnder: edgeSniperOverUnder,
    rankedDigits: [] as number[],
  });
  const tradeXConfigRef = useRef({
    symbol: tradeXSymbol,
    stake: tradeXStake,
    selectedDigit: tradeXSelectedDigit,
    duration: tradeXDuration,
    manualSelect: tradeXManualSelect,
    frameworkSignalReady: false,
    rankedDigits: [] as number[],
  });

  const currentAccount = status.data?.account;
  const currentAccountBalance = getAccountBalance(currentAccount);
  const currentAccountRef = useRef(currentAccount);
  currentAccountRef.current = currentAccount;
  const currentAccountBalanceRef = useRef(currentAccountBalance);
  currentAccountBalanceRef.current = currentAccountBalance;
  const isReal = currentAccount?.type === "real";
  const isConnected = Boolean(status.data?.connected && status.data?.authorized);
  const activeContractCount = status.data?.active_contract_count ?? 0;
  const openContractsReady = status.data?.open_contracts_ready === true;
  const tradeSlotBlocked = !openContractsReady || activeContractCount > 0;
  const tradeSlotMessage = !isConnected
    ? null
    : !openContractsReady
      ? "Deriv is checking open contracts. New trade entries are paused until that check finishes."
      : activeContractCount > 0
        ? `Waiting for ${activeContractCount} open Deriv contract${activeContractCount === 1 ? "" : "s"} to settle before another trade can start.`
        : null;
  const volatilityMarkets = markets.filter(([market]) => !market.startsWith("JD"));
  const moneyBankMarkets = volatilityMarkets.filter(([market]) =>
    (MONEY_BANK_AUTO_SYMBOLS as readonly string[]).includes(market),
  );
  const rows = history.data ?? [];
  const readHistorySnapshot = async () => {
    // History is a display and settlement feed. The API's buy guard is the
    // authority for whether another contract can be opened.
    return readCachedHistorySnapshot(
      async () => {
        const latestRows = await getDerivHistory();
        queryClient.setQueryData(getGetDerivHistoryQueryKey(), latestRows);
        return latestRows;
      },
      queryClient.getQueryData<typeof rows>(getGetDerivHistoryQueryKey()) ?? rows,
    );
  };
  const edgeAllRows = rows.filter((trade) => trade.contract_type === "DIGITOVER" || trade.contract_type === "DIGITUNDER");
  const tradeXAllRows = rows.filter((trade) => trade.contract_type === "DIGITDIFF");
  const digitFlipAllRows = rows.filter((trade) => trade.contract_type === "DIGITEVEN" || trade.contract_type === "DIGITODD");
  const matchesAllRows = rows.filter((trade) => trade.contract_type === "DIGITMATCH");
  const bulkAllRows = rows.filter((trade) => (
    trade.contract_type === "DIGITOVER"
    || trade.contract_type === "DIGITUNDER"
    || trade.contract_type === "DIGITEVEN"
    || trade.contract_type === "DIGITODD"
    || trade.contract_type === "DIGITDIFF"
    || trade.contract_type === "CALL"
    || trade.contract_type === "PUT"
  ));
  const moneyBankAllRows = rows.filter((trade) => trade.contract_type === "ACCU");
  const clockWorkAllRows = rows.filter((trade) => trade.contract_type === "HIGHER" || trade.contract_type === "LOWER");
  const cashGrabAllRows = rows.filter((trade) => (
    trade.contract_type === "DIGITEVEN"
    || trade.contract_type === "DIGITODD"
    || trade.contract_type === "CALL"
    || trade.contract_type === "PUT"
    || trade.contract_type === "DIGITDIFF"
    || trade.contract_type === "ACCU"
  ));
  const edgeRows = edgeAllRows.filter((trade) => edgeClaimedHistoryIdsRef.current.has(trade.contract_id) && !edgeHiddenHistoryIds.has(trade.contract_id));
  const tradeXRows = tradeXAllRows.filter((trade) => tradeXClaimedHistoryIdsRef.current.has(trade.contract_id) && !tradeXHiddenHistoryIds.has(trade.contract_id));
  const tradeXSessionRows = tradeXAllRows.filter((trade) => tradeXClaimedHistoryIdsRef.current.has(trade.contract_id));
  const tradeXVisibleSessionRows = tradeXSessionRows.filter((trade) => !tradeXHiddenHistoryIds.has(trade.contract_id));
  const digitFlipRows = digitFlipAllRows.filter((trade) => digitFlipClaimedHistoryIdsRef.current.has(String(trade.contract_id)) && !digitFlipHiddenHistoryIds.has(String(trade.contract_id)));
  const matchesSessionRows = matchesSessionKnownIdsRef.current
    ? matchesAllRows.filter((trade) => (
      matchesClaimedHistoryIdsRef.current.has(String(trade.contract_id))
      && !matchesSessionKnownIdsRef.current?.has(String(trade.contract_id))
    ))
    : [];
  const matchesVisibleSessionRows = matchesSessionRows.filter((trade) => !matchesHiddenHistoryIds.has(String(trade.contract_id)));
  const matchesRows = matchesAllRows.filter((trade) => (
    matchesClaimedHistoryIdsRef.current.has(String(trade.contract_id))
    && !matchesHiddenHistoryIds.has(String(trade.contract_id))
  ));
  const matchesTopDigits = useMemo<ObservedMatchesDigitStat[]>(
    () => matchesTickCount > 0 ? rankObservedMatchDigits(matchesObservedDigits).slice(0, 3) : [],
    [matchesObservedDigits, matchesTickCount],
  );
  const bulkRows = bulkAllRows.filter((trade) => bulkClaimedHistoryIdsRef.current.has(trade.contract_id) && !bulkTraderHiddenHistoryIds.has(trade.contract_id));
  const moneyBankRows = moneyBankAllRows
    .filter((trade) => moneyBankClaimedHistoryIdsRef.current.has(trade.contract_id)) as MoneyBankTrade[];
  const cashGrabRows = cashGrabAllRows
    .filter((trade) => !cashGrabHiddenHistoryIds.has(trade.contract_id))
    .filter((trade) => cashGrabClaimedHistoryIdsRef.current.has(trade.contract_id)) as CashGrabTrade[];
  const clockWorkSessionRows = clockWorkAllRows.filter((trade) => clockWorkClaimedHistoryIdsRef.current.has(trade.contract_id));
  const clockWorkRows = clockWorkSessionRows.filter((trade) => !clockWorkHiddenHistoryIds.has(trade.contract_id));
  const cashGrabSymbols = markets.map(([value, label]) => ({ value, label }));
  const clockWorkSymbols = markets.map(([value, label]) => ({ value, label }));
  const clockWorkLatestTick = status.data?.last_tick;
  const clockWorkTickIsFreshForMarket = Boolean(
    clockWorkLatestTick
    && clockWorkLatestTick.symbol === clockWorkSymbol
    && clockWorkLatestTick.epoch > clockWorkMarketResetEpochRef.current,
  );
  const clockWorkCurrentQuote = clockWorkTickIsFreshForMarket
    ? clockWorkLatestTick?.quote ?? null
    : null;
  const clockWorkQuoteHistory = clockWorkQuoteBuffer.symbol === clockWorkSymbol
    ? clockWorkQuoteBuffer.quotes
    : [];
  useEffect(() => {
    const tick = clockWorkTickIsFreshForMarket ? clockWorkLatestTick : null;
    setClockWorkQuoteBuffer((current) => appendClockWorkQuote(current, clockWorkSymbol, tick));
  }, [
    clockWorkSymbol,
    clockWorkTickIsFreshForMarket,
    clockWorkLatestTick?.epoch,
    clockWorkLatestTick?.quote,
    clockWorkLatestTick?.symbol,
  ]);
  useEffect(() => {
    if (clockWorkBarrierAnchor == null && clockWorkCurrentQuote != null) {
      setClockWorkBarrierAnchor(clockWorkCurrentQuote);
    }
  }, [clockWorkBarrierAnchor, clockWorkCurrentQuote]);
  const clockWorkBarrierReference = clockWorkBarrierAnchor ?? clockWorkCurrentQuote;
  const clockWorkRates = estimateClockWorkBarrierRates({
    quotes: clockWorkQuoteHistory,
    spot: clockWorkBarrierReference,
    mode: clockWorkBarrierMode,
    higherOffset: clockWorkHigherBarrier,
    lowerOffset: clockWorkLowerBarrier,
    halfBarrier: clockWorkHalfBarrier,
    duration: 5,
  });
  const clockWorkObservedTicks = getClockWorkBarrierTickCounts(
    clockWorkQuoteHistory,
    clockWorkBarrierReference == null
      ? null
      : clockWorkBarrierReference + (clockWorkHalfBarrier ? clockWorkHigherBarrier / 2 : clockWorkHigherBarrier),
    clockWorkBarrierReference == null
      ? null
      : clockWorkBarrierReference + (clockWorkHalfBarrier ? clockWorkLowerBarrier / 2 : clockWorkLowerBarrier),
  );
  const clockWorkRecentMoves = getClockWorkRecentMoves(clockWorkQuoteHistory);
  const clockWorkPushProgress = getClockWorkPushProgress(clockWorkQuoteHistory, 5);
  const clockWorkPushDirection = clockWorkPushProgress.direction;
  const clockWorkTickEpoch = clockWorkTickIsFreshForMarket ? clockWorkLatestTick?.epoch ?? null : null;
  const clockWorkQuoteUpdatedAt = clockWorkTickEpoch == null ? "" : new Date(Number(clockWorkTickEpoch) * 1000).toISOString();
  const clockWorkBarrierValues = [.5, .25, .12, .05];
  const clockWorkBarrierOptions = (side: "higher" | "lower") => {
    const selected = side === "higher" ? clockWorkHigherBarrier : clockWorkLowerBarrier;
    return clockWorkBarrierValues.map((magnitude) => {
      const offset = side === "higher" ? magnitude : -magnitude;
      const effectiveOffset = clockWorkHalfBarrier ? offset / 2 : offset;
      const absolute = clockWorkBarrierReference == null ? null : clockWorkBarrierReference + effectiveOffset;
      return {
        value: offset,
        label: clockWorkBarrierMode === "offset"
          ? `${effectiveOffset > 0 ? "+" : ""}${effectiveOffset.toFixed(2)}`
          : absolute == null ? "—" : absolute.toFixed(2),
        selected: selected === offset,
      };
    });
  };
  const makeClockWorkOrder = (
    key: string,
    contractType: "HIGHER" | "LOWER",
    amount: number,
  ): ClockWorkContractOrder => {
    const offset = contractType === "HIGHER" ? clockWorkHigherBarrier : clockWorkLowerBarrier;
    const barrier = formatClockWorkBarrier(clockWorkBarrierMode, clockWorkCurrentQuote, offset, clockWorkHalfBarrier) ?? "1";
    return {
      key,
      amount: Number(Math.max(1, amount).toFixed(2)),
      duration: 5,
      duration_unit: "t",
      contract_type: contractType,
      barrier,
      symbol: clockWorkSymbol,
    };
  };
  const clockWorkPairOrders = useMemo(() => [
    makeClockWorkOrder("higher", "HIGHER", clockWorkHigherStake),
    makeClockWorkOrder("lower", "LOWER", clockWorkLowerStake),
  ], [clockWorkSymbol, clockWorkBarrierMode, clockWorkHigherBarrier, clockWorkLowerBarrier, clockWorkHalfBarrier, clockWorkCurrentQuote, clockWorkHigherStake, clockWorkLowerStake]);
  const makeClockWorkFourOrders = (lead: "HIGHER" | "LOWER" | null) => {
    const sequence = getClockWorkFourSequence(lead);
    let higherIndex = 0;
    let lowerIndex = 0;
    return sequence.map((contractType) => {
      const index = contractType === "HIGHER" ? ++higherIndex : ++lowerIndex;
      const key = `${contractType === "HIGHER" ? "h" : "l"}${index}`;
      const amount = contractType === "HIGHER"
        ? index === 1 ? clockWorkH1Stake : clockWorkH2Stake
        : index === 1 ? clockWorkL1Stake : clockWorkL2Stake;
      return makeClockWorkOrder(key, contractType, amount);
    });
  };
  const clockWorkFourOrders = useMemo(
    () => makeClockWorkFourOrders(clockWorkRates.prediction),
    [clockWorkSymbol, clockWorkBarrierMode, clockWorkHigherBarrier, clockWorkLowerBarrier, clockWorkHalfBarrier, clockWorkCurrentQuote, clockWorkH1Stake, clockWorkH2Stake, clockWorkL1Stake, clockWorkL2Stake, clockWorkRates.prediction],
  );
  clockWorkQuoteOrderBuilderRef.current = () => ({
    pair: [
      makeClockWorkOrder("higher", "HIGHER", clockWorkHigherStake),
      makeClockWorkOrder("lower", "LOWER", clockWorkLowerStake),
    ],
    allFour: makeClockWorkFourOrders("HIGHER"),
  });

  useEffect(() => {
    if (!clockWorkEnabled || !canUseClockWork || !isConnected) {
      setClockWorkQuotes({ pair: { higher: null, lower: null }, allFour: null });
      if (!clockWorkEnabled) setClockWorkStatusMessage(null);
      return;
    }
    let cancelled = false;
    const refreshQuotes = async () => {
      const orderSets = clockWorkQuoteOrderBuilderRef.current?.();
      if (!orderSets) return;
      try {
        const pairResult = await clockWorkQuoteMutation.mutateAsync({ data: { contracts: orderSets.pair } });
        const fourResult = await clockWorkQuoteMutation.mutateAsync({ data: { contracts: orderSets.allFour } });
        if (cancelled) return;
        const pairByKey = new Map(pairResult.quotes.map((quote) => [quote.key, quote]));
        const higher = pairByKey.get("higher");
        const lower = pairByKey.get("lower");
        const allFourTotal = fourResult.quotes.reduce(
          (total, quote) => ({
            payout: total.payout + quote.payout,
            ask_price: total.ask_price + quote.ask_price,
            spot: quote.spot,
          }),
          { payout: 0, ask_price: 0, spot: 0 },
        );
        setClockWorkQuotes({
          pair: {
            higher: higher ? { payout: higher.payout, ask_price: higher.ask_price, spot: higher.spot } : null,
            lower: lower ? { payout: lower.payout, ask_price: lower.ask_price, spot: lower.spot } : null,
          },
          allFour: fourResult.quotes.length === 4 ? allFourTotal : null,
        });
      } catch (error) {
        if (cancelled) return;
        setClockWorkQuotes({ pair: { higher: null, lower: null }, allFour: null });
        setClockWorkStatusMessage(`Live Clock Work quotes are unavailable: ${errorMessage(error)}`);
      }
    };
    void refreshQuotes();
    const timer = window.setInterval(() => void refreshQuotes(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    clockWorkEnabled,
    canUseClockWork,
    isConnected,
    clockWorkSymbol,
    clockWorkBarrierMode,
    clockWorkHigherBarrier,
    clockWorkLowerBarrier,
    clockWorkHalfBarrier,
    clockWorkHigherStake,
    clockWorkLowerStake,
    clockWorkH1Stake,
    clockWorkL1Stake,
    clockWorkL2Stake,
    clockWorkH2Stake,
    clockWorkQuoteMutation.mutateAsync,
  ]);
  const cashGrabBestSymbol = useMemo(() => {
    const supported = new Set<string>(cashGrabSymbols.map((item) => item.value));
    const signals = (status.data?.market_signals ?? [])
      .filter((signal) => supported.has(signal.symbol) && signal.sample_count >= 5)
      .map((signal) => {
        const observedRate = cashGrabDirection === "PUT"
          ? signal.fall_percentage ?? 0
          : signal.rise_percentage ?? 0;
        return { signal, score: observedRate + Math.min(signal.sample_count, 100) / 100 };
      });
    return signals.sort((left, right) => right.score - left.score || right.signal.sample_count - left.signal.sample_count)[0]?.signal.symbol ?? null;
  }, [cashGrabDirection, cashGrabSymbols, status.data?.market_signals]);
  const bulkSessionRows = bulkSessionKnownIdsRef.current
    ? bulkAllRows.filter((trade) => (
      bulkClaimedHistoryIdsRef.current.has(trade.contract_id)
      && !bulkSessionKnownIdsRef.current?.has(trade.contract_id)
    ))
    : [];
  const bulkVisibleSessionRows = bulkSessionRows.filter((trade) => !bulkTraderHiddenHistoryIds.has(trade.contract_id));
  const edgeSessionRows = edgeSessionKnownIdsRef.current
    ? edgeAllRows.filter((trade) => edgeClaimedHistoryIdsRef.current.has(trade.contract_id) && !edgeSessionKnownIdsRef.current?.has(trade.contract_id))
    : [];
  const digitFlipSessionRows = digitFlipSessionKnownIdsRef.current
    ? digitFlipAllRows.filter((trade) => (
      digitFlipClaimedHistoryIdsRef.current.has(String(trade.contract_id))
      && !digitFlipSessionKnownIdsRef.current?.has(String(trade.contract_id))
    ))
    : [];
  const digitFlipVisibleSessionRows = digitFlipSessionRows.filter((trade) => !digitFlipHiddenHistoryIds.has(trade.contract_id));
  const moneyBankSessionRows = moneyBankSessionKnownIdsRef.current
    ? moneyBankAllRows
      .filter((trade) => moneyBankClaimedHistoryIdsRef.current.has(trade.contract_id))
      .filter((trade) => !moneyBankSessionKnownIdsRef.current?.has(trade.contract_id))
    : [];
  const cashGrabSessionRows = cashGrabSessionKnownIdsRef.current
    ? cashGrabAllRows.filter((trade) => (
      cashGrabClaimedHistoryIdsRef.current.has(trade.contract_id)
      && !cashGrabSessionKnownIdsRef.current?.has(trade.contract_id)
    ))
    : [];
  const cashGrabVisibleSessionRows = cashGrabSessionRows.filter((trade) => !cashGrabHiddenHistoryIds.has(trade.contract_id));
  const moneyBankSignals = (status.data?.market_signals ?? []) as MoneyBankMarketSignal[];
  const fastSessionPnl = realizedProfit(edgeSessionRows);
  const cashGrabHistorySessionPnl = cashGrabSessionRows.length
    ? realizedProfit(cashGrabSessionRows)
    : cashGrabSessionPnl;
  const streaks = status.data?.digit_streaks ?? [];
  const lastDigit = status.data?.last_digit;
  const digitFlipEvenPercentage = digitFlipSampleCount ? (digitFlipEvenCount / digitFlipSampleCount) * 100 : 50;
  const digitFlipOddPercentage = digitFlipSampleCount ? 100 - digitFlipEvenPercentage : 50;
  const digitFlipMarketSignals = useMemo<DigitFlipMarketSignal[]>(
    () => (status.data?.market_signals ?? []).map((signal) => ({
      symbol: signal.symbol,
      evenPercentage: signal.digit_even_percentage,
      oddPercentage: signal.digit_odd_percentage,
      sampleCount: signal.sample_count,
    })),
    [status.data?.market_signals],
  );
  const cashGrabMarketSignals = useMemo<CashGrabMarketSignal[]>(
    () => (status.data?.market_signals ?? []).map((signal) => ({
      symbol: signal.symbol,
      risePercentage: Number(signal.rise_percentage ?? 0),
      fallPercentage: Number(signal.fall_percentage ?? 0),
      sampleCount: signal.sample_count,
    })),
    [status.data?.market_signals],
  );
  const bulkTraderMarketSignals = useMemo(
    () => (status.data?.market_signals ?? []).map((signal) => {
      const selectedDigit = typeof bulkTraderPrediction === "number" ? bulkTraderPrediction : 5;
      const selectedOutcome = signal.digit_outcomes?.find((outcome) => outcome.digit === selectedDigit);
      const differsRate = selectedOutcome
        ? Number(selectedOutcome.over_percentage) + Number(selectedOutcome.under_percentage)
        : 50;
      const observedPercentage = bulkTraderType === "over-under"
        ? Number((selectedOutcome ? Math.max(Number(selectedOutcome.over_percentage), Number(selectedOutcome.under_percentage)) : 50).toFixed(1))
         : Number(differsRate.toFixed(1));
      return {
        symbol: signal.symbol,
        sampleCount: signal.sample_count,
        observedPercentage,
      };
    }),
    [bulkTraderPrediction, bulkTraderType, status.data?.market_signals],
  );
  const bulkTraderBestSymbol = useMemo(
    () => [...bulkTraderMarketSignals]
      .sort((left, right) => right.observedPercentage - left.observedPercentage || right.sampleCount - left.sampleCount)[0]?.symbol ?? null,
    [bulkTraderMarketSignals],
  );

  const scanJdyMoneyBank = async (
    candidateConfig?: MoneyBankStartConfig,
    candidateSymbol?: string,
  ): Promise<MoneyBankJdyDecision | null> => {
    if (!isConnected || moneyBankJdyScanInFlightRef.current) return moneyBankJdyDecision;
    const config = candidateConfig ?? moneyBankConfigRef.current;
    const selectedSymbol = candidateSymbol ?? config?.symbol;
    if (!config || !selectedSymbol) return null;
    moneyBankJdyScanInFlightRef.current = true;
    setMoneyBankJdyState("scanning");
    try {
      const freshStatus = await status.refetch();
      const freshSignals = (freshStatus.data?.market_signals ?? moneyBankSignals) as MoneyBankMarketSignal[];
      const evaluateSetup = (marketSymbol: string, growthRate: number, takeProfitTicks: number): MoneyBankJdyDecision => {
        const signal = freshSignals.find((entry) => entry.symbol === marketSymbol);
        const observedBalance = signal ? Math.max(signal.rise_percentage ?? 50, signal.fall_percentage ?? 50) : 0;
        const stake = config.ladder[Math.min(6, moneyBankLevelRef.current)]?.stake ?? config.ladder[0]?.stake ?? 1;
        const stakeRiskPenalty = currentAccountBalance
          ? Math.min(15, (stake / currentAccountBalance) * 100)
          : 20;
        const riskPenalty = growthRate * 1.5 + takeProfitTicks * 0.12 + stakeRiskPenalty;
        const predictedWinRate = Math.max(0, Math.min(100, observedBalance - riskPenalty));
        const estimatedLossStreak = Math.max(0, Math.ceil((100 - predictedWinRate) / 10));
        const sampleCount = signal?.sample_count ?? 0;
        const score = predictedWinRate + Math.min(sampleCount, 200) / 10;
        return {
          symbol: marketSymbol,
          growthRate,
          takeProfitTicks,
          score,
          sampleCount,
          observedBalance,
          estimatedLosses: estimatedLossStreak,
          stake,
          predictedWinRate,
          estimatedLossStreak,
           safe: sampleCount >= 5 && predictedWinRate >= 45 && estimatedLossStreak <= 5,
          suggestedSymbol: null,
          suggestedGrowthRate: null,
          suggestedTakeProfitTicks: null,
          suggestedStake: Math.max(1, Number((stake * 0.5).toFixed(2))),
        };
      };

      const decision = evaluateSetup(selectedSymbol, config.growthRate, config.takeProfitTicks);
      const alternatives = moneyBankMarkets
        .flatMap(([marketSymbol]) => Array.from({ length: 5 }, (_, index) => index + 1)
          .flatMap((growthRate) => Array.from({ length: 46 }, (_, index) => index + 5)
            .map((takeProfitTicks) => evaluateSetup(marketSymbol, growthRate, takeProfitTicks))))
        .filter((candidate) => candidate.symbol !== decision.symbol || candidate.growthRate !== decision.growthRate || candidate.takeProfitTicks !== decision.takeProfitTicks)
        .sort((left, right) =>
          Number(right.safe) - Number(left.safe)
          || right.score - left.score
          || right.sampleCount - left.sampleCount,
        );
      const suggestion = alternatives[0];
      if (!decision.safe && suggestion) {
        decision.suggestedSymbol = suggestion.symbol;
        decision.suggestedGrowthRate = suggestion.growthRate;
        decision.suggestedTakeProfitTicks = suggestion.takeProfitTicks;
      }
      setMoneyBankJdyDecision(decision);
      setMoneyBankJdyState(decision.safe ? "safe" : "not-good");
      return decision;
    } catch (error) {
      setMoneyBankJdyState("not-good");
      setConnectionMessage({ kind: "error", text: `Shadows could not complete its scan: ${errorMessage(error)}` });
      return null;
    } finally {
      moneyBankJdyScanInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (sessionAccountIdRef.current === currentAccount?.id) return;
    sessionAccountIdRef.current = currentAccount?.id ?? null;
    edgeSessionKnownIdsRef.current = null;
    digitFlipSessionKnownIdsRef.current = null;
    bulkSessionKnownIdsRef.current = null;
    cashGrabSessionKnownIdsRef.current = null;
    moneyBankSessionKnownIdsRef.current = null;
    matchesSessionKnownIdsRef.current = null;
    historyFeatureOwnersRef.current.clear();
    edgeClaimedHistoryIdsRef.current.clear();
    tradeXClaimedHistoryIdsRef.current.clear();
    digitFlipClaimedHistoryIdsRef.current.clear();
    bulkClaimedHistoryIdsRef.current.clear();
    cashGrabClaimedHistoryIdsRef.current.clear();
    clockWorkClaimedHistoryIdsRef.current.clear();
    matchesClaimedHistoryIdsRef.current.clear();
    moneyBankClaimedHistoryIdsRef.current.clear();
    setEdgeHiddenHistoryIds(new Set());
    setTradeXHiddenHistoryIds(new Set());
    setDigitFlipHiddenHistoryIds(new Set());
    setBulkTraderHiddenHistoryIds(new Set());
    setCashGrabHiddenHistoryIds(new Set());
    setClockWorkHiddenHistoryIds(new Set());
    setMatchesHiddenHistoryIds(new Set());
    matchesAiRunningRef.current = false;
    setMatchesAiEnabled(false);
    setMatchesAnalysisEnabled(false);
    setEdgeAccountBalance(currentAccountBalance == null ? "" : currentAccountBalance.toFixed(2));
    setDigitFlipAccountBalance(currentAccountBalance == null ? "" : currentAccountBalance.toFixed(2));
  }, [currentAccount?.id]);

  useEffect(() => {
    if (currentAccountBalance == null) return;
    const liveBalance = currentAccountBalance.toFixed(2);
    if (edgeAccountBalance !== liveBalance) setEdgeAccountBalance(liveBalance);
  }, [currentAccountBalance, edgeAccountBalance]);

  useEffect(() => {
    if (currentAccountBalance == null) return;
    const liveBalance = currentAccountBalance.toFixed(2);
    if (digitFlipAccountBalance !== liveBalance) setDigitFlipAccountBalance(liveBalance);
  }, [currentAccountBalance, digitFlipAccountBalance]);

  useEffect(() => {
    if (history.data == null || sessionAccountIdRef.current == null) return;
    if (edgeSessionKnownIdsRef.current == null) {
      edgeSessionKnownIdsRef.current = new Set(edgeAllRows.map((trade) => trade.contract_id));
    }
    if (digitFlipSessionKnownIdsRef.current == null) {
      digitFlipSessionKnownIdsRef.current = new Set(digitFlipAllRows.map((trade) => trade.contract_id));
    }
    if (bulkSessionKnownIdsRef.current == null) {
      bulkSessionKnownIdsRef.current = new Set(bulkAllRows.map((trade) => trade.contract_id));
    }
  }, [history.data, edgeAllRows, digitFlipAllRows, bulkAllRows]);

  const analysis = useMemo(() => {
    const counts = Array.from({ length: 10 }, (_, digit) => analysisDigits.filter((value) => value === digit).length);
    const overCount = analysisDigits.filter((digit) => digit > barrier).length;
    const underCount = analysisDigits.filter((digit) => digit < barrier).length;
    const decisiveCount = overCount + underCount;
    const overPercent = decisiveCount ? (overCount / decisiveCount) * 100 : 50;
    const underPercent = decisiveCount ? (underCount / decisiveCount) * 100 : 50;
    const lean = overPercent >= underPercent ? "OVER" : "UNDER";
    return {
      counts,
      overPercent,
      underPercent,
      lean,
      maxCount: Math.max(1, ...counts),
    };
  }, [analysisDigits, barrier]);

  useEffect(() => {
    setDigitFlipSessionPnl(realizedProfit(digitFlipSessionRows));
    if (digitFlipStakeMode !== "martingale") {
      digitFlipNextStakeRef.current = digitFlipStake;
      if (!digitFlipRunning) setDigitFlipCurrentStake(digitFlipStake);
      return;
    }
    const watch = digitFlipMartingaleWatchRef.current;
    if (!watch) {
      digitFlipNextStakeRef.current = digitFlipStake;
      if (!digitFlipRunning) setDigitFlipCurrentStake(digitFlipStake);
      return;
    }
    const newlySettled = digitFlipSessionRows
      .filter((trade) => !watch.knownIds.has(trade.contract_id) && !watch.processedIds.has(trade.contract_id) && !isDerivHistoryOpen(trade.status))
      .sort((left, right) => (left.buy_time ?? 0) - (right.buy_time ?? 0));
    if (!newlySettled.length) return;
    let next = digitFlipNextStakeRef.current;
    for (const trade of newlySettled) {
      next = nextStakeAfterSettlement(trade.profit, next, digitFlipStake, digitFlipMultiplier);
      watch.processedIds.add(trade.contract_id);
    }
    digitFlipNextStakeRef.current = next;
    setDigitFlipCurrentStake(next);
  }, [digitFlipSessionRows, digitFlipMultiplier, digitFlipRunning, digitFlipStake, digitFlipStakeMode]);
  const tradeXDistribution = useMemo<TradeXDigitDistribution[]>(() => {
    const total = analysisDigits.length;
    return analysis.counts.map((count, digit) => {
      let absentStreak = 0;
      for (let index = analysisDigits.length - 1; index >= 0 && analysisDigits[index] !== digit; index -= 1) {
        absentStreak += 1;
      }
      const midpoint = Math.floor(analysisDigits.length / 2);
      const previousCount = analysisDigits.slice(0, midpoint).filter((value) => value === digit).length;
      const recentCount = analysisDigits.slice(midpoint).filter((value) => value === digit).length;
      return {
        digit,
        percentage: total ? Number(((count / total) * 100).toFixed(1)) : 0,
        streak: absentStreak,
        momentum: recentCount > previousCount ? "up" : recentCount < previousCount ? "down" : "flat",
        sampleCount: total,
      };
    });
  }, [analysis.counts, analysisDigits]);
  const tradeXRankedDigits = useMemo(
    () => analysisTickCount > 0
      ? [...tradeXDistribution]
        .sort((left, right) => {
          const leftScore = Math.max(0, Math.min(100, 100 - left.percentage * 4 + Math.min(left.streak, 10) * 2));
          const rightScore = Math.max(0, Math.min(100, 100 - right.percentage * 4 + Math.min(right.streak, 10) * 2));
          return rightScore - leftScore || left.digit - right.digit;
        })
        .map((item) => item.digit)
      : [],
    [analysisTickCount, tradeXDistribution],
  );
  const tradeXRankedEntryDigit = digitForTick(tradeXDuration, tradeXRankedDigits, tradeXSelectedDigit);
  const tradeXEntryDigit = tradeXManualSelect ? tradeXSelectedDigit : tradeXRankedEntryDigit;
  const tradeXFrameworkSignalReady = useMemo(() => {
    const selectedSignal = tradeXDistribution[tradeXEntryDigit];
    return Boolean(
      selectedSignal
      && selectedSignal.percentage < 7
      && (selectedSignal.streak === 3 || selectedSignal.streak === 4)
      && lastDigit === tradeXEntryDigit,
    );
  }, [lastDigit, tradeXDistribution, tradeXEntryDigit]);
  useEffect(() => {
    edgeAnalysisRef.current = {
      sample: analysisDigits.length,
      overPercent: analysis.overPercent,
      underPercent: analysis.underPercent,
    };
  }, [analysis, analysisDigits, analysisTickCount, lastDigit, tradeXDistribution]);
  const rankedDigits = useMemo(
    () => analysisTickCount > 0 ? rankDigitsByDistribution(analysis.counts) : [],
    [analysis.counts, analysisTickCount],
  );

  useEffect(() => {
    configRef.current = {
      direction,
      barrier,
      duration,
      stake,
      strategy,
      martingale,
      symbol,
      sniperOverUnder: edgeSniperOverUnder,
      rankedDigits,
    };
  }, [direction, barrier, duration, stake, strategy, martingale, symbol, edgeSniperOverUnder, rankedDigits]);

  useEffect(() => {
    cashGrabConfigRef.current = {
      contractFamily: "rise-fall",
      direction: cashGrabDirection,
      symbol: cashGrabSymbol,
      stake: Math.max(.35, cashGrabStake),
      duration: cashGrabDuration,
      stakeMode: cashGrabStakeMode,
      multiplier: Math.max(.01, cashGrabMultiplier),
      takeProfit: Math.max(0, cashGrabTakeProfit),
      lossLimit: Math.max(0, cashGrabLossLimit),
      autoSelectBest: cashGrabAutoSelectBest,
      autoSwitchSafestPair: cashGrabAutoSwitchSafestPair,
      autoDirection: cashGrabAutoDirection,
    };
  }, [
    cashGrabAutoSelectBest,
    cashGrabAutoSwitchSafestPair,
    cashGrabAutoDirection,
    cashGrabDirection,
    cashGrabDuration,
    cashGrabStakeMode,
    cashGrabStake,
    cashGrabSymbol,
    cashGrabMultiplier,
    cashGrabTakeProfit,
    cashGrabLossLimit,
  ]);

  useEffect(() => {
    tradeXConfigRef.current = {
      symbol: tradeXSymbol,
      stake: tradeXStake,
      selectedDigit: tradeXEntryDigit,
      duration: tradeXDuration,
      manualSelect: tradeXManualSelect,
      frameworkSignalReady: tradeXFrameworkSignalReady,
      rankedDigits: tradeXRankedDigits,
    };
  }, [
    tradeXSymbol,
    tradeXStake,
    tradeXEntryDigit,
    tradeXDuration,
    tradeXManualSelect,
    tradeXFrameworkSignalReady,
    tradeXRankedDigits,
  ]);

  useEffect(() => {
    if (storedPatInvalid) void tokenStatus.refetch();
  }, [storedPatInvalid, tokenStatus]);

  useEffect(() => {
    autoSwitchRef.current = autoSwitch;
  }, [autoSwitch]);

  useEffect(() => {
    edgePercentageModeRef.current = edgePercentageMode;
  }, [edgePercentageMode]);

  useEffect(() => {
    nextStakeRef.current = stake;
    setNextStake(stake);
  }, [stake, strategy]);

  useEffect(() => {
    const watch = martingaleWatchRef.current;
    if (!watch || strategy !== "martingale") return;
    const newlySettled = edgeRows
      .filter((trade) => !watch.knownIds.has(trade.contract_id) && !watch.processedIds.has(trade.contract_id) && !isDerivHistoryOpen(trade.status))
      .sort((left, right) => (left.buy_time ?? 0) - (right.buy_time ?? 0));
    if (!newlySettled.length) return;

    let next = watch.amount;
    for (const settledTrade of newlySettled) {
      next = nextStakeAfterSettlement(settledTrade.profit, next, stake, martingale);
      watch.knownIds.add(settledTrade.contract_id);
      watch.processedIds.add(settledTrade.contract_id);
    }
    nextStakeRef.current = next;
    setNextStake(next);
    if (watch.processedIds.size >= watch.expectedSettlements) {
      martingaleWatchRef.current = null;
    }
  }, [edgeRows, strategy, martingale, stake]);

  useEffect(() => {
    const epoch = status.data?.last_tick?.epoch;
    const digit = status.data?.last_digit;
    if (epoch == null || digit == null) return;
    if (status.data?.last_tick?.symbol !== symbol) return;
    if (analysisEpochRef.current != null && epoch <= analysisEpochRef.current) return;
    analysisEpochRef.current = epoch;
    liveTickSequenceRef.current += 1;
    setAnalysisDigits((current) => [...current, digit].slice(-1000));
    setAnalysisTickCount((current) => current + 1);
    if (tradeXEnabled && status.data?.last_tick?.symbol === tradeXSymbol) {
    }
    if (digitFlipEnabled) {
      setDigitFlipSampleCount((current) => current + 1);
      if (digit % 2 === 0) setDigitFlipEvenCount((current) => current + 1);
    }
  }, [digitFlipEnabled, status.data?.last_tick?.epoch, status.data?.last_digit, status.data?.last_tick?.symbol, tradeXEnabled, tradeXSymbol]);

  useEffect(() => {
    if (!matchesAnalysisEnabled) return;
    const cursor = matchesSampleCursorRef.current;
    if (symbol !== matchesSymbol) {
      if (cursor.symbol !== matchesSymbol) {
        matchesSampleCursorRef.current = { symbol: matchesSymbol, tickCount: analysisTickCount };
        setMatchesObservedDigits([]);
        setMatchesTickCount(0);
      }
      return;
    }
    if (cursor.symbol !== matchesSymbol || analysisTickCount < cursor.tickCount) {
      matchesSampleCursorRef.current = { symbol: matchesSymbol, tickCount: analysisTickCount };
      setMatchesObservedDigits([]);
      setMatchesTickCount(0);
      return;
    }
    const tickDelta = analysisTickCount - cursor.tickCount;
    if (tickDelta <= 0) return;

    matchesSampleCursorRef.current = { symbol: matchesSymbol, tickCount: analysisTickCount };
    const freshDigits = analysisDigits.slice(-tickDelta).filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    setMatchesObservedDigits((current) => [...current, ...freshDigits].slice(-MATCHES_HISTORY_LIMIT));
    setMatchesTickCount((current) => current + tickDelta);
  }, [analysisDigits, analysisTickCount, matchesAnalysisEnabled, matchesSymbol, symbol]);

  useEffect(() => {
    digitFlipAssaultRef.current = digitFlipAssault;
    digitFlipMagicRef.current = digitFlipMagic;
    digitFlipMarketSignalsRef.current = digitFlipMarketSignals;
    digitFlipRatesRef.current = { even: digitFlipEvenPercentage, odd: digitFlipOddPercentage };
    digitFlipConfigRef.current = {
      marketType: digitFlipMarketType,
      symbol: digitFlipSymbol,
      parity: digitFlipParity,
      duration: digitFlipDuration,
      stake: digitFlipStake,
      stakeMode: digitFlipStakeMode,
      multiplier: digitFlipMultiplier,
    };
  }, [digitFlipAssault, digitFlipMagic, digitFlipMarketSignals, digitFlipEvenPercentage, digitFlipOddPercentage, digitFlipMarketType, digitFlipSymbol, digitFlipParity, digitFlipDuration, digitFlipStake, digitFlipStakeMode, digitFlipMultiplier]);

  useEffect(() => {
    const pnl = fastSessionPnl;
    setSessionPnl(pnl);
    if (!running) return;
    const stopReason = sessionStopReason(pnl, takeProfit, stopLoss);
    if (stopReason) {
      runningRef.current = false;
      setRunning(false);
      setConnectionMessage({
        kind: "info",
        text: `${stopReason === "take-profit" ? "Take profit" : "Stop loss"} reached at ${pnl.toFixed(2)} ${currentAccount?.currency ?? "USD"}.`,
      });
    }
  }, [fastSessionPnl, running, takeProfit, stopLoss, currentAccount?.currency]);

  useEffect(() => {
    if (!digitFlipRunning) return;
    const stopReason = sessionStopReason(digitFlipSessionPnl, digitFlipTakeProfit, digitFlipStopLoss);
    if (!stopReason) return;
    digitFlipRunningRef.current = false;
    setDigitFlipRunning(false);
    setConnectionMessage({
      kind: "info",
      text: `DigitFlip ${stopReason === "take-profit" ? "take profit" : "stop loss"} reached at ${digitFlipSessionPnl.toFixed(2)} ${currentAccount?.currency ?? "USD"}.`,
    });
  }, [digitFlipSessionPnl, digitFlipRunning, digitFlipTakeProfit, digitFlipStopLoss, currentAccount?.currency]);

  useEffect(() => () => {
    runningRef.current = false;
    digitFlipRunningRef.current = false;
  }, []);

  const connectPat = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pat.trim()) return;
    setConnectionMessage({ kind: "info", text: "Validating PAT and opening the Deriv connection…" });
    try {
      const tokenResult = await tokenMutation.mutateAsync({ data: { token: pat.trim() } });
      setPat("");
      queryClient.setQueryData(getGetDerivAccountsQueryKey(), tokenResult.accounts);
      queryClient.setQueryData(getGetDerivTokenStatusQueryKey(), {
        has_token: true,
        expires_at: null,
        last_verified_at: new Date().toISOString(),
      });
      const connection = await connectionMutation.mutateAsync();
      if (!connection.ok) throw new Error(connection.message);
      queryClient.setQueryData(getGetDerivAccountsQueryKey(), connection.accounts);
      queryClient.setQueryData(getGetDerivStatusQueryKey(), connection.status);
      setConnectionMessage({ kind: "info", text: "Deriv connected. Your credential remains protected on the server." });
    } catch (error) {
      setConnectionMessage({ kind: "error", text: errorMessage(error) });
    }
  };

  const disconnect = async () => {
    runningRef.current = false;
    setRunning(false);
    await deleteTokenMutation.mutateAsync();
    queryClient.clear();
    void tokenStatus.refetch();
  };

  const chooseBestDigit = async () => {
    const signals = (status.data?.market_signals ?? []) as MarketSignal[];
    const fallback: MarketSignal = {
      symbol,
      quote: status.data?.last_tick?.quote ?? null,
      sample_count: status.data?.digit_sample_count ?? 0,
      digit_streaks: streaks,
    };
    const best = chooseBestDigitSignal(signals, fallback);
    if (!best) return;
    if (best.symbol !== symbol) await selectMarket(best.symbol);
    setDirection(best.direction);
    setBarrier(best.digit);
    configRef.current = { ...configRef.current, direction: best.direction, barrier: best.digit, symbol: best.symbol };
  };

  const applyPercentageRecommendation = async () => {
    const signals = (status.data?.market_signals ?? []) as MarketSignal[];
    const recommendation = chooseBestEdgeSignal(signals, EDGE_PERCENTAGE_SCAN_FLOOR);
    setEdgeRecommendation(recommendation);
    if (!recommendation) {
      setConnectionMessage({
        kind: "info",
        text: `Percentage scan is waiting for a cross-market observed outcome at or above ${EDGE_PERCENTAGE_SCAN_FLOOR}%.`,
      });
      return null;
    }
    if (recommendation.symbol !== configRef.current.symbol) {
      await selectMarket(recommendation.symbol);
    }
    const nextDirection = recommendation.direction === "DIGITUNDER" ? "DIGITUNDER" : "DIGITOVER";
    setDirection(nextDirection);
    setBarrier(recommendation.digit);
    configRef.current = {
      ...configRef.current,
      direction: nextDirection,
      barrier: recommendation.digit,
      symbol: recommendation.symbol,
    };
    setConnectionMessage({
      kind: "info",
      text: `Percentage scan recommends ${recommendation.direction === "DUAL" ? "Dual" : nextDirection === "DIGITOVER" ? "Over" : "Under"} ${recommendation.digit} on ${recommendation.symbol} at ${recommendation.score.toFixed(1)}% observed ${recommendation.direction === "DUAL" ? "coverage" : "share"}. This is evidence, not a guaranteed outcome.`,
    });
    return recommendation;
  };

  const requestEdgeQuote = async (quote: {
    symbol: string;
    direction: "DIGITOVER" | "DIGITUNDER";
    barrier: number;
  }) => {
    const key = `${quote.symbol}:${quote.direction}:${quote.barrier}:${stake}:${duration}`;
    if (edgeProposalRequestKeyRef.current === key) return;
    edgeProposalRequestKeyRef.current = key;
    try {
      await edgeProposalMutation.mutateAsync({
        data: {
          amount: stake,
          duration,
          duration_unit: "t",
          contract_type: quote.direction,
          barrier: quote.barrier,
          symbol: quote.symbol,
        },
      });
      await sleep(150);
      await queryClient.refetchQueries({ queryKey: getGetDerivStatusQueryKey(), type: "active" });
    } catch {
      edgeProposalRequestKeyRef.current = "";
    }
  };

  useEffect(() => {
    if (!isConnected || !xTraderEnabled) return;
    void requestEdgeQuote({ symbol, direction, barrier });
  }, [barrier, direction, duration, isConnected, stake, symbol, xTraderEnabled]);

  const armMartingaleWatch = (latestRows: typeof rows, amount: number, expectedSettlements: number) => {
    if (configRef.current.strategy !== "martingale") {
      martingaleWatchRef.current = null;
      return;
    }
    martingaleWatchRef.current = {
      knownIds: new Set(latestRows.map((trade) => trade.contract_id)),
      processedIds: new Set(),
      amount,
      expectedSettlements,
    };
  };

  const refreshTradeResults = () => {
    // One non-cancelling refresh gives the acknowledged trade a fast UI update
    // without restarting an in-flight poll or causing a second render burst.
    const options = { cancelRefetch: false };
    void Promise.all([
      queryClient.refetchQueries({ queryKey: getGetDerivStatusQueryKey(), type: "active" }, options),
      queryClient.refetchQueries({ queryKey: getGetDerivHistoryQueryKey(), type: "active" }, options),
      queryClient.refetchQueries({ queryKey: getGetDerivAccountsQueryKey(), type: "active" }, options),
    ]).catch((error: unknown) => {
      console.warn("Could not refresh trade data after the order was confirmed.", error);
    });
  };

  const claimFeatureRows = (
    feature: DerivHistoryFeature,
    target: Set<string>,
    confirmedContractIds: readonly string[],
  ) => {
    claimDerivHistoryFeatureContractIds(
      historyFeatureOwnersRef.current,
      currentAccountRef.current?.id,
      feature,
      target,
      confirmedContractIds.map((contractId) => String(contractId)),
    );
    // Contract IDs come from Deriv's buy acknowledgement. Claim them locally
    // now; the single background refresh/poll fills in the authoritative row.
    return queryClient.getQueryData<typeof rows>(getGetDerivHistoryQueryKey()) ?? rows;
  };

  const waitForEdgeSettlement = async (contractIds: readonly string[]) => {
    if (!contractIds.length) return true;
    const expectedIds = new Set(contractIds);
    let historySnapshot = await readHistorySnapshot();
    if (!historySnapshot.fresh) return false;
    let latestRows = historySnapshot.rows;
    let sawContract = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const matching = latestRows.filter((trade) => expectedIds.has(trade.contract_id));
      if (matching.length) sawContract = true;
      if (sawContract && matching.every((trade) => !isDerivHistoryOpen(trade.status))) {
        queryClient.setQueryData(getGetDerivHistoryQueryKey(), latestRows);
        return true;
      }
      // Allow the history stream time to publish the buy acknowledgement. The
      // next EDGE entry must never race that update, even for a one-tick trade.
      await sleep(500);
      historySnapshot = await readHistorySnapshot();
      if (!historySnapshot.fresh) return false;
      latestRows = historySnapshot.rows;
    }
    throw new Error("EDGE stopped because the previous trade did not settle in time.");
  };

  const waitForEdgeSniperConfirmation = async () => {
    const config = configRef.current;
    const side = config.direction === "DIGITOVER" ? "Over" : "Under";
    setConnectionMessage({
      kind: "info",
      text: `Sniper ${side} ${config.barrier} is working. Waiting for two fresh matching ticks before entry.`,
    });

    let initial = await status.refetch();
    if (initial.data?.last_tick?.symbol !== config.symbol) {
      if (!await selectMarket(config.symbol)) {
        throw new Error(`Sniper could not select ${config.symbol}. No trade was sent.`);
      }
      initial = await status.refetch();
    }
    let lastEpoch = initial.data?.last_tick?.symbol === config.symbol
      ? initial.data.last_tick.epoch
      : null;
    let streak = 0;

    for (let attempt = 0; attempt < 240 && runningRef.current; attempt += 1) {
      await sleep(300);
      if (!runningRef.current) return false;
      const fresh = await status.refetch();
      const tick = fresh.data?.last_tick;
      if (tick?.symbol !== config.symbol || tick.epoch == null || (lastEpoch != null && tick.epoch <= lastEpoch)) continue;
      lastEpoch = tick.epoch;
      const digit = fresh.data?.last_digit;
      if (digit == null || digit < 0 || digit > 9) continue;
      const matches = config.direction === "DIGITOVER" ? digit > config.barrier : digit < config.barrier;
      streak = matches ? streak + 1 : 0;
      if (streak >= 2) {
        setConnectionMessage({
          kind: "info",
          text: `Sniper confirmed two fresh ${side} ticks around digit ${config.barrier}. Sending the configured EDGE entry.`,
        });
        return true;
      }
    }
    if (runningRef.current) {
      setConnectionMessage({
        kind: "info",
        text: "Sniper is still working; no trade was sent because it did not confirm two fresh matching ticks.",
      });
    }
    return false;
  };

  const executeBatch = async () => {
    if (edgeSettlementLockRef.current) return;
    edgeSettlementLockRef.current = true;
    edgeActionLockRef.current = true;
    try {
    const config = configRef.current;
    const entryDigit = config.barrier;
    const amount = config.strategy === "martingale" ? nextStakeRef.current : config.stake;
    const entryError = validateEdgeEntry({
      stake: amount,
      balance: currentAccountBalanceRef.current,
      symbol: config.symbol,
      supportedSymbols: markets.map(([marketSymbol]) => marketSymbol),
      contractType: config.direction,
      barrier: entryDigit,
      duration: config.duration,
      count: 1,
    });
    if (entryError) throw new Error(entryError);
    // Do not decide the next stake from an older settled result while the
    // immediately preceding contract is still open.
    let historySnapshot = await readHistorySnapshot();
    let latestRows = historySnapshot.rows;
    for (let attempt = 0; historySnapshot.fresh && latestRows.some((trade) => isDerivHistoryOpen(trade.status)) && attempt < 20; attempt += 1) {
      await sleep(500);
      historySnapshot = await readHistorySnapshot();
      latestRows = historySnapshot.rows;
    }
    if (historySnapshot.fresh && latestRows.some((trade) => isDerivHistoryOpen(trade.status))) {
      throw new Error("The previous contract is still settling. EDGE stopped without sending another trade.");
    }
    for (const trade of (historySnapshot.fresh ? latestRows : []).filter((item) => (item.contract_type === "DIGITOVER" || item.contract_type === "DIGITUNDER") && !isDerivHistoryOpen(item.status))) {
      if (edgeProcessedSettlementIdsRef.current.has(trade.contract_id)) continue;
      edgeProcessedSettlementIdsRef.current.add(trade.contract_id);
      edgeLossStreakRef.current = trade.profit < 0 ? edgeLossStreakRef.current + 1 : 0;
    }
    if (historySnapshot.fresh) queryClient.setQueryData(getGetDerivHistoryQueryKey(), latestRows);
    if (!runningRef.current) return;
    const declaredAccountBalance = currentAccountBalance ?? 0;
    if (!Number.isFinite(declaredAccountBalance) || declaredAccountBalance <= 0) {
      throw new Error("Sync the connected account balance before EDGE places another trade.");
    }
    if (amount > declaredAccountBalance || (currentAccountBalance != null && amount > currentAccountBalance)) {
      throw new Error(`EDGE stopped before the next trade because the ${amount.toFixed(2)} ${currentAccount?.currency ?? "USD"} stake exceeds the connected balance. Lower the stake or Martingale multiplier.`);
    }
    if (config.sniperOverUnder) {
      if (!await waitForEdgeSniperConfirmation()) return;
      if (!runningRef.current) return;
    }
    armMartingaleWatch(latestRows, amount, 1);
    const result = await bulkBuyMutation.mutateAsync({
      data: {
        access_feature: "edge",
        amount,
        duration: config.duration,
        duration_unit: "t",
        contract_type: config.direction,
        barrier: entryDigit,
        symbol: config.symbol,
        count: 1,
      },
    });
    claimFeatureRows("edge", edgeClaimedHistoryIdsRef.current, result.buys.map((buy) => buy.contract_id));
    refreshTradeResults();
    setConnectionMessage(null);
    setSessionTrades((value) => value + 1);
    if (!await waitForEdgeSettlement(result.buys.map((buy) => buy.contract_id))) {
      runningRef.current = false;
      setRunning(false);
      setConnectionMessage({
        kind: "info",
        text: "Deriv accepted the EDGE trade. Trade history is temporarily unavailable, so automatic entries are paused; Deriv still checks settlement before another trade.",
      });
      return;
    }
    } finally {
      edgeActionLockRef.current = false;
      edgeSettlementLockRef.current = false;
    }
  };

  const executeDualBatch = async () => {
    if (edgeSettlementLockRef.current) return;
    edgeSettlementLockRef.current = true;
    edgeActionLockRef.current = true;
    try {
    const config = configRef.current;
    const amount = config.strategy === "martingale" ? nextStakeRef.current : config.stake;
    const entryError = validateEdgeEntry({
      stake: amount,
      balance: currentAccountBalanceRef.current,
      symbol: config.symbol,
      supportedSymbols: markets.map(([marketSymbol]) => marketSymbol),
      contractType: "DUAL",
      barrier: config.barrier,
      duration: config.duration,
      count: 2,
    });
    if (entryError) throw new Error(entryError);
    let historySnapshot = await readHistorySnapshot();
    let latestRows = historySnapshot.rows;
    for (let attempt = 0; historySnapshot.fresh && latestRows.some((trade) => isDerivHistoryOpen(trade.status)) && attempt < 20; attempt += 1) {
      await sleep(500);
      historySnapshot = await readHistorySnapshot();
      latestRows = historySnapshot.rows;
    }
    if (historySnapshot.fresh && latestRows.some((trade) => isDerivHistoryOpen(trade.status))) {
      throw new Error("The previous contract is still settling. EDGE stopped without sending another dual trade.");
    }
    if (!runningRef.current) return;
    const declaredAccountBalance = Number(edgeAccountBalance);
    if (!Number.isFinite(declaredAccountBalance) || declaredAccountBalance <= 0) {
      throw new Error("Sync the connected account balance before EDGE places another dual trade.");
    }
    if (amount * 2 > declaredAccountBalance || (currentAccountBalance != null && amount * 2 > currentAccountBalance)) {
      throw new Error(`EDGE stopped before the dual trade because the ${ (amount * 2).toFixed(2) } ${currentAccount?.currency ?? "USD"} stake exceeds the connected balance.`);
    }
    armMartingaleWatch(latestRows, amount, 2);
    const result = await dualBuyMutation.mutateAsync({
      data: {
        access_feature: "edge",
        amount,
        duration: config.duration,
        duration_unit: "t",
        barrier: config.barrier,
        symbol: config.symbol,
      },
    });
    claimFeatureRows("edge", edgeClaimedHistoryIdsRef.current, result.buys.map((buy) => buy.contract_id));
    refreshTradeResults();
    setConnectionMessage(null);
    setSessionTrades((value) => value + 2);
    if (!await waitForEdgeSettlement(result.buys.map((buy) => buy.contract_id))) {
      runningRef.current = false;
      setRunning(false);
      setConnectionMessage({
        kind: "info",
        text: "Deriv accepted the EDGE dual trade. Trade history is temporarily unavailable, so automatic entries are paused; Deriv still checks settlement before another trade.",
      });
      return;
    }
    } finally {
      edgeActionLockRef.current = false;
      edgeSettlementLockRef.current = false;
    }
  };

  const runLoop = async () => {
    while (runningRef.current) {
      try {
        if (configRef.current.sniperOverUnder) {
          await executeBatch();
        } else if (edgePercentageModeRef.current) {
          const recommendation = await applyPercentageRecommendation();
          if (!recommendation) {
            await sleep(1500);
            continue;
          }
          if (recommendation.direction === "DUAL") await executeDualBatch();
          else await executeBatch();
        } else {
          if (autoSwitchRef.current) await chooseBestDigit();
          if (autoSwitchRef.current) {
          const currentAnalysis = edgeAnalysisRef.current;
          const directionRate = configRef.current.direction === "DIGITOVER"
            ? currentAnalysis.overPercent
            : currentAnalysis.underPercent;
          if (directionRate < edgeMinWinRate) {
            setConnectionMessage({
              kind: "info",
              text: `Auto Best Digit is waiting for ${edgeMinWinRate}% live win percentage. Current ${configRef.current.direction === "DIGITOVER" ? "Over" : "Under"} signal: ${Math.round(directionRate)}%.`,
            });
            await sleep(1500);
            continue;
          }
          }
          await executeBatch();
        }
        // executeBatch waits for the active contract to settle. Do not add a
        // duration-based cooldown after settlement; Deriv's tick duration is
        // the source of truth for how long the contract runs.
        if (runningRef.current) await sleep(50);
      } catch (error) {
        const message = errorMessage(error);
        if (message.includes("still settling")) {
          setConnectionMessage({
            kind: "info",
            text: "Deriv is still settling the previous contract. EDGE will retry after the server confirms it is safe to continue.",
          });
          await sleep(500);
          continue;
        }
        runningRef.current = false;
        setRunning(false);
        setConnectionMessage({ kind: "error", text: message });
      }
    }
  };

  const closeMoneyBankContracts = async () => {
    if (moneyBankClosePromiseRef.current) return moneyBankClosePromiseRef.current;
    const operation = (async () => {
      setMoneyBankClosing(true);
      try {
        let latestRows = await getDerivHistory();
        const openContractId = moneyBankOpenContractIdRef.current;
        if (openContractId && latestRows.some((trade) => trade.contract_id === openContractId && isDerivHistoryOpen(trade.status))) {
          await moneyBankSellMutation.mutateAsync({ data: { contract_id: openContractId } });
        }
        await queryClient.refetchQueries({ queryKey: getGetDerivHistoryQueryKey(), type: "active" });
      } finally {
        setMoneyBankClosing(false);
        moneyBankClosePromiseRef.current = null;
      }
    })();
    moneyBankClosePromiseRef.current = operation;
    return operation;
  };

  const stopMoneyBank = () => {
    moneyBankRunningRef.current = false;
    moneyBankActionLockRef.current = false;
    setMoneyBankRunning(false);
    setMoneyBankAutoKnockoutCountdown(null);
    void closeMoneyBankContracts().catch((error) => {
      setConnectionMessage({ kind: "error", text: `Money Bank could not close every open contract: ${errorMessage(error)}` });
    });
  };

  const executeMoneyBankTrade = async () => {
    const config = moneyBankConfigRef.current;
    if (!config || !moneyBankRunningRef.current || moneyBankActionLockRef.current) return;

    let historySnapshot = await readHistorySnapshot();
    let latestRows = historySnapshot.rows;
    const openContractId = moneyBankOpenContractIdRef.current;
    for (let attempt = 0; historySnapshot.fresh && attempt < 240; attempt += 1) {
      const stillOpen = openContractId
        ? latestRows.some((trade) => trade.contract_id === openContractId && isDerivHistoryOpen(trade.status))
        : latestRows.some((trade) =>
          trade.contract_type === "ACCU"
          && !cashGrabClaimedHistoryIdsRef.current.has(trade.contract_id)
          && isDerivHistoryOpen(trade.status),
        );
      if (!stillOpen) break;
      await sleep(500);
      historySnapshot = await readHistorySnapshot();
      latestRows = historySnapshot.rows;
    }
    const unsettledPrevious = historySnapshot.fresh && (openContractId
      ? latestRows.some((trade) => trade.contract_id === openContractId && isDerivHistoryOpen(trade.status))
      : latestRows.some((trade) =>
        trade.contract_type === "ACCU"
        && !cashGrabClaimedHistoryIdsRef.current.has(trade.contract_id)
        && isDerivHistoryOpen(trade.status),
      ));
    if (unsettledPrevious) {
      throw new Error("Money Bank stopped while the previous contract was still settling.");
    }

    const settledAccumulatorRows = historySnapshot.fresh
      ? openContractId
        ? latestRows.filter((trade) => trade.contract_id === openContractId)
        : latestRows
          .filter((trade) => trade.contract_type === "ACCU")
          .filter((trade) => !cashGrabClaimedHistoryIdsRef.current.has(trade.contract_id))
          .filter((trade) => !isDerivHistoryOpen(trade.status))
      : [];
    const settledAccumulator = settledAccumulatorRows.find((trade) =>
      !moneyBankProcessedSettlementIdsRef.current.has(trade.contract_id),
    );
    if (settledAccumulator) {
      moneyBankProcessedSettlementIdsRef.current.add(settledAccumulator.contract_id);
      const nextSessionPnl = moneyBankSessionPnlRef.current + settledAccumulator.profit;
      moneyBankSessionPnlRef.current = nextSessionPnl;
      setMoneyBankSessionPnl(nextSessionPnl);
      setMoneyBankLastSettledProfit(settledAccumulator.profit);
      if (settledAccumulator.profit > 0) {
        moneyBankLevelRef.current = 0;
        if (config.reinvestProfit) {
          const reinvestedProfit = settledAccumulator.profit * (config.reinvestPercent / 100);
          const nextBase = Math.max(1, config.ladder[0].stake + reinvestedProfit);
          const cycleBudget = config.ladder.at(-1)?.cumulative ?? 0;
          moneyBankConfigRef.current = {
            ...config,
            ladder: calculateRecoveryLadder({
              strategy: config.strategy,
              budget: cycleBudget,
              manualBase: nextBase,
              ...(config.strategy === "budget" ? { preferredBase: nextBase } : {}),
              growthRate: config.growthRate,
              takeProfitTicks: config.takeProfitTicks,
            }),
          };
        }
      } else {
        const currentLadder = moneyBankConfigRef.current?.ladder ?? config.ladder;
        if (moneyBankLevelRef.current + 1 >= currentLadder.length) {
          throw new Error("Money Bank reached the Auto Budget limit; no planned recovery level remains.");
        }
        moneyBankLevelRef.current += 1;
      }
      if (config.profitTarget != null && config.profitTarget > 0 && nextSessionPnl >= config.profitTarget) {
        throw new Error("Money Bank reached the session Profit target.");
      }
      if (config.lossLimit != null && config.lossLimit > 0 && nextSessionPnl <= -config.lossLimit) {
        throw new Error("Money Bank reached the session Loss limit.");
      }
    }

    if (!moneyBankRunningRef.current) return;
    const currentConfig = moneyBankConfigRef.current ?? config;
    const tradeSymbol = currentConfig.symbol;
    if (moneyBankJdyEnabled) {
      // The Money Bank gate evaluates the market selected in the form.
      const decision = await scanJdyMoneyBank(currentConfig, tradeSymbol);
      if (!decision?.safe) {
        moneyBankRunningRef.current = false;
        setMoneyBankRunning(false);
        setMoneyBankJdyState("not-good");
        setConnectionMessage({
          kind: "info",
          text: decision
            ? `Shadows cancelled this trade: not a good trade, with an estimated ${decision.estimatedLossStreak}-loss streak risk.`
            : "Shadows cancelled this trade because it could not confirm a safe setup.",
        });
        return;
      }
      setMoneyBankJdyState("safe");
      setConnectionMessage({
        kind: "info",
        text: `Shadows confirmed the selected ${tradeSymbol} setup before entry.`,
      });
    }
    const level = currentConfig.ladder?.[Math.min(6, moneyBankLevelRef.current)];
    if (!level) throw new Error("Money Bank reached its Auto Budget limit; no planned recovery level remains.");
    const accountBalance = currentAccountBalance ?? 0;
    if (!accountBalance || level.stake > accountBalance) {
      throw new Error(`Money Bank stopped because ${level.stake.toFixed(2)} ${currentAccount?.currency ?? "USD"} exceeds the connected balance.`);
    }

    if (tradeSymbol !== moneyBankSymbol) {
      setMoneyBankSymbol(tradeSymbol);
      await selectMarket(tradeSymbol);
    }

    moneyBankActionLockRef.current = true;
    try {
      if (currentConfig.autoKnockout) {
        const countdownEndsAt = Date.now() + 10_000;
        setMoneyBankAutoKnockoutCountdown(10);
        while (moneyBankRunningRef.current && Date.now() < countdownEndsAt) {
          setMoneyBankAutoKnockoutCountdown(Math.max(0, (countdownEndsAt - Date.now()) / 1000));
          await sleep(Math.min(100, countdownEndsAt - Date.now()));
        }
        if (!moneyBankRunningRef.current) return;
        setMoneyBankAutoKnockoutCountdown(0);
      }

      const result = await moneyBankBuyMutation.mutateAsync({
        data: {
          access_feature: "money-bank",
          amount: Number(level.stake.toFixed(2)),
          duration: currentConfig.takeProfitTicks,
          duration_unit: "t",
          contract_type: "ACCU",
          growth_rate: currentConfig.growthRate / 100,
          symbol: tradeSymbol,
        },
      });
      const contractId = result.buy?.contract_id;
      if (typeof contractId === "string" && contractId) {
        claimFeatureRows("money-bank", moneyBankClaimedHistoryIdsRef.current, [contractId]);
        moneyBankOpenContractIdRef.current = contractId;
      }
      setConnectionMessage(null);
      setMoneyBankTradeCount((value) => value + 1);
      void refreshTradeResults();
    } finally {
      setMoneyBankAutoKnockoutCountdown(null);
      moneyBankActionLockRef.current = false;
      if (!moneyBankRunningRef.current) await closeMoneyBankContracts();
    }
  };

  const runMoneyBankLoop = async () => {
    while (moneyBankRunningRef.current) {
      try {
        await executeMoneyBankTrade();
        if (!moneyBankRunningRef.current) return;
        await sleep(250);
      } catch (error) {
        const message = errorMessage(error);
        if (message.includes("still settling")) {
          setConnectionMessage({
            kind: "info",
            text: "Deriv is still settling the previous Accumulator. Money Bank will retry when the server confirms it is safe to continue.",
          });
          await sleep(750);
          continue;
        }
        if (message.includes("reached the Auto Budget limit") || message.includes("reached its Auto Budget limit")) {
          stopMoneyBank();
          setConnectionMessage({ kind: "info", text: message });
          return;
        }
        if (message.includes("Buy cooldown active")) {
          await sleep(1000);
          continue;
        }
        stopMoneyBank();
        setConnectionMessage({ kind: "error", text: message });
      }
    }
  };

  const startMoneyBank = async (config: MoneyBankStartConfig) => {
    if (!isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before starting Money Bank." });
      return;
    }
    if (!currentAccount || currentAccountBalance == null) {
      setConnectionMessage({ kind: "error", text: "Select a Deriv account before starting Money Bank." });
      return;
    }
    if (config.strategy === "budget" && !config.ladder?.length) {
      setConnectionMessage({ kind: "error", text: "The Auto Budget must cover at least one minimum Accumulator stake." });
      return;
    }
    if (!config.ladder?.[0] || config.ladder[0].stake > currentAccountBalance) {
      setConnectionMessage({ kind: "error", text: "The calculated BASE is higher than the connected account balance." });
      return;
    }
    const plannedStakeTotal = config.ladder.at(-1)?.cumulative ?? 0;
    if (config.strategy === "budget" && plannedStakeTotal > currentAccountBalance) {
      setConnectionMessage({ kind: "error", text: "The planned Auto Budget cycle exceeds the connected balance. Lower the budget before starting." });
      return;
    }

    try {
      const historySnapshot = await readHistorySnapshot();
      const latestRows = historySnapshot.rows;
      const accumulatorIds = latestRows
        .filter((trade) => trade.contract_type === "ACCU")
        .filter((trade) => !cashGrabClaimedHistoryIdsRef.current.has(trade.contract_id))
        .map((trade) => trade.contract_id);
      const moneyBankSessionIds = latestRows
        .filter((trade) => trade.contract_type === "ACCU")
        .filter((trade) => moneyBankClaimedHistoryIdsRef.current.has(trade.contract_id))
        .map((trade) => trade.contract_id);
      moneyBankSessionKnownIdsRef.current = new Set(moneyBankSessionIds);
      moneyBankProcessedSettlementIdsRef.current = new Set(accumulatorIds);
       const existingOpenAccumulator = latestRows.find((trade) =>
         trade.contract_type === "ACCU"
         && !cashGrabClaimedHistoryIdsRef.current.has(trade.contract_id)
         && isDerivHistoryOpen(trade.status)
       );
       if (historySnapshot.fresh && existingOpenAccumulator) {
         setConnectionMessage({ kind: "info", text: "Money Bank is waiting for the existing Accumulator contract to settle before starting a new session." });
         return;
       }
       moneyBankOpenContractIdRef.current = existingOpenAccumulator?.contract_id ?? null;
      moneyBankLevelRef.current = 0;
      moneyBankConfigRef.current = config;
      moneyBankSessionPnlRef.current = 0;
      setMoneyBankSessionPnl(0);
      setMoneyBankLastSettledProfit(null);
      setMoneyBankTradeCount(0);
       setMoneyBankAutoKnockoutCountdown(null);
      moneyBankRunningRef.current = true;
      setMoneyBankRunning(true);
      if (moneyBankJdyEnabled) {
        setMoneyBankJdyDecision(null);
        setMoneyBankJdyState("scanning");
      }
      void runMoneyBankLoop();
    } catch (error) {
      setConnectionMessage({ kind: "error", text: errorMessage(error) });
    }
  };

  const start = async () => {
    if (!isConnected) return;
    if (currentAccountBalance == null || currentAccountBalance <= 0) {
      setConnectionMessage({ kind: "error", text: "Sync the connected account balance before starting EDGE." });
      return;
    }
    const declaredAccountBalance = Number(edgeAccountBalance);
    if (!Number.isFinite(declaredAccountBalance) || declaredAccountBalance <= 0) {
      setConnectionMessage({ kind: "error", text: "Enter a positive account balance before starting EDGE." });
      return;
    }
    if (currentAccountBalance != null && declaredAccountBalance > currentAccountBalance + 0.01) {
      setConnectionMessage({ kind: "error", text: `The declared account balance is above the connected ${currentAccount?.currency ?? "USD"} balance.` });
      return;
    }
    const historySnapshot = await readHistorySnapshot();
    const latestEdgeIds = historySnapshot.rows
      .filter((trade) => trade.contract_type === "DIGITOVER" || trade.contract_type === "DIGITUNDER")
      .map((trade) => trade.contract_id);
    edgeSessionKnownIdsRef.current = new Set(latestEdgeIds);
    edgeProcessedSettlementIdsRef.current = new Set(latestEdgeIds);
    edgeLossStreakRef.current = 0;
    setSessionPnl(0);
    setSessionTrades(0);
      nextStakeRef.current = stake;
      setNextStake(stake);
    runningRef.current = true;
    setRunning(true);
    void runLoop();
  };

  const stop = () => {
    runningRef.current = false;
    setRunning(false);
  };

  const cashGrabContractTypes = ["CALL", "PUT"] as const;
  const cashGrabManagedContractTypes = ["DIGITEVEN", "DIGITODD", "CALL", "PUT", "DIGITDIFF", "ACCU"] as const;

  const scanCashGrabAutoSwitch = async (
    candidateConfig?: CashGrabStartConfig,
  ): Promise<CashGrabAutoSwitchRecommendation | null> => {
    if (!isConnected || cashGrabAutoSwitchBusyRef.current) return cashGrabAutoSwitchRecommendationRef.current;
    const config = candidateConfig ?? cashGrabConfigRef.current;
    if (!config || currentAccountBalance == null) return null;
    cashGrabAutoSwitchBusyRef.current = true;
    setCashGrabAutoSwitchSafestPairStatus("watching");
    try {
      const freshStatus = await status.refetch();
      const signals = freshStatus.data?.market_signals ?? [];
      const balance = currentAccountBalance;
      const minimumStake = .35;
      const currentStake = Math.max(minimumStake, cashGrabCurrentStakeRef.current || config.stake);
      const candidates: CashGrabAutoSwitchRecommendation[] = [];

      for (const signal of signals) {
        if (!cashGrabSymbols.some((item) => item.value === signal.symbol) || signal.sample_count < 5) continue;
        const observedWinRate = config.direction === "PUT"
          ? signal.fall_percentage ?? 0
          : signal.rise_percentage ?? 0;
        if (currentStake > balance || observedWinRate < 50) continue;
        const sampleConfidence = Math.min(signal.sample_count, 200) / 20;
        candidates.push({
          symbol: signal.symbol,
          observedWinRate,
          sampleCount: signal.sample_count,
          score: observedWinRate * 2 + sampleConfidence,
        });
      }

      const recommendation = candidates.sort((left, right) =>
        right.score - left.score
        || right.observedWinRate - left.observedWinRate
        || right.sampleCount - left.sampleCount,
      )[0] ?? null;
      cashGrabAutoSwitchRecommendationRef.current = recommendation;
      setCashGrabAutoSwitchRecommendation(recommendation);
      if (recommendation) {
        setCashGrabAutoSwitchSafestPairStatus("ready");
        setConnectionMessage({
          kind: "info",
          text: `Auto-switch selected ${recommendation.symbol} with ${recommendation.observedWinRate.toFixed(1)}% observed in ${recommendation.sampleCount} moves. Historical rates are not a forecast.`,
        });
      } else {
        setCashGrabAutoSwitchSafestPairStatus("quiet");
        setConnectionMessage({ kind: "info", text: "Auto-switch is waiting for a supported market with enough sampled moves, at least a 50% observed direction rate, and room for the current stake." });
      }
      return recommendation;
    } catch (error) {
      setCashGrabAutoSwitchSafestPairStatus("quiet");
      setConnectionMessage({ kind: "error", text: `Auto-switch could not scan: ${errorMessage(error)}` });
      return null;
    } finally {
      cashGrabAutoSwitchBusyRef.current = false;
    }
  };

  const reconcileCashGrabSession = (latestRows: typeof rows) => {
    const knownIds = cashGrabSessionKnownIdsRef.current;
    if (!knownIds) return [];
    const completed = latestRows
      .filter((trade) => cashGrabContractTypes.includes(trade.contract_type as typeof cashGrabContractTypes[number]))
      .filter((trade) => !knownIds.has(trade.contract_id))
      .filter((trade) => !isDerivHistoryOpen(trade.status))
      .filter((trade) => !cashGrabProcessedSettlementIdsRef.current.has(trade.contract_id));
    if (!completed.length) return [];
    completed.forEach((trade) => {
      cashGrabProcessedSettlementIdsRef.current.add(trade.contract_id);
      cashGrabOpenContractIdsRef.current.delete(trade.contract_id);
    });
    return completed;
  };

  const applyCashGrabSettlements = (completed: typeof rows) => {
    const config = cashGrabConfigRef.current;
    if (!completed.length || !config) return;
    const currentStake = cashGrabCurrentStakeRef.current;
    const netSettledProfit = completed.reduce((total, trade) => total + trade.profit, 0);
    cashGrabSessionPnlRef.current = Number((cashGrabSessionPnlRef.current + netSettledProfit).toFixed(2));
    setCashGrabSessionPnl(cashGrabSessionPnlRef.current);
    cashGrabCurrentStakeRef.current = netSettledProfit < 0 && config.stakeMode === "multiply"
      ? Number((currentStake * Math.max(.01, config.multiplier)).toFixed(2))
      : Number(config.stake.toFixed(2));

    const reachedLimit = getCashGrabLimitReached(
      cashGrabSessionPnlRef.current,
      config.takeProfit,
      config.lossLimit,
    );
    if (reachedLimit) {
      setConnectionMessage({
        kind: "info",
        text: reachedLimit === "take-profit"
          ? `Cash Grab stopped at its ${config.takeProfit.toFixed(2)} ${currentAccount?.currency ?? "USD"} take-profit limit. No next contract was started.`
          : `Cash Grab stopped at its ${config.lossLimit.toFixed(2)} ${currentAccount?.currency ?? "USD"} session loss limit. No next contract was started.`,
      });
      stopCashGrab();
    }
  };

  const confirmCashGrabDirection = async (marketSymbol: string): Promise<CashGrabDirection | null> => {
    const initial = await status.refetch();
    const signal = initial.data?.market_signals?.find((entry) => entry.symbol === marketSymbol);
    if (!signal || signal.sample_count < 1) {
      setConnectionMessage({ kind: "info", text: `Auto Direction is waiting for live Rise/Fall samples on ${marketSymbol}. No trade was sent.` });
      return null;
    }
    const rise = Number(signal.rise_percentage);
    const fall = Number(signal.fall_percentage);
    if (!Number.isFinite(rise) || !Number.isFinite(fall) || rise === fall) {
      setConnectionMessage({ kind: "info", text: `Auto Direction is waiting for a clear Rise or Fall leader on ${marketSymbol}. No trade was sent.` });
      return null;
    }
    const selectedDirection: CashGrabDirection = rise > fall ? "CALL" : "PUT";
    let lastSequence = signal.tick_sequence;
    let freshTicks = 0;

    setConnectionMessage({
      kind: "info",
      text: `Auto Direction is checking the leading ${selectedDirection === "CALL" ? "Rise" : "Fall"} sample on ${marketSymbol}; waiting for two fresh ticks.`,
    });
    for (let attempt = 0; attempt < 240 && cashGrabRunningRef.current; attempt += 1) {
      await sleep(300);
      if (!cashGrabRunningRef.current) return null;
      const latest = await status.refetch();
      const latestSignal = latest.data?.market_signals?.find((entry) => entry.symbol === marketSymbol);
      if (!latestSignal || latestSignal.tick_sequence <= lastSequence) continue;
      freshTicks += latestSignal.tick_sequence - lastSequence;
      lastSequence = latestSignal.tick_sequence;
      if (freshTicks < 2) continue;

      const latestRise = Number(latestSignal.rise_percentage);
      const latestFall = Number(latestSignal.fall_percentage);
      if (selectedDirection === "CALL" ? latestRise > latestFall : latestFall > latestRise) {
        return selectedDirection;
      }
      setConnectionMessage({
        kind: "info",
        text: `Auto Direction found that ${selectedDirection === "CALL" ? "Rise" : "Fall"} no longer leads after two fresh ticks. It will check the live sample again; no trade was sent.`,
      });
      return null;
    }
    if (cashGrabRunningRef.current) {
      setConnectionMessage({ kind: "info", text: "Auto Direction did not receive two fresh ticks. No trade was sent; it will check again." });
    }
    return null;
  };

  const executeCashGrabTrade = async () => {
    let config = cashGrabConfigRef.current;
    if (!config || !cashGrabRunningRef.current || cashGrabActionLockRef.current) return;
    let historySnapshot = await readHistorySnapshot();
    let latestRows = historySnapshot.rows;
    if (historySnapshot.fresh) applyCashGrabSettlements(reconcileCashGrabSession(latestRows));
    const hasOpenCashGrabContract = () =>
      cashGrabOpenContractIdsRef.current.size > 0
      || latestRows.some((trade) =>
        cashGrabContractTypes.includes(trade.contract_type as typeof cashGrabContractTypes[number])
        && cashGrabSessionKnownIdsRef.current
        && !cashGrabSessionKnownIdsRef.current.has(trade.contract_id)
        && isDerivHistoryOpen(trade.status),
      );
    for (let attempt = 0; historySnapshot.fresh && attempt < 60 && hasOpenCashGrabContract(); attempt += 1) {
      await sleep(500);
      historySnapshot = await readHistorySnapshot();
      latestRows = historySnapshot.rows;
      if (!historySnapshot.fresh) break;
      applyCashGrabSettlements(reconcileCashGrabSession(latestRows));
    }
    if (!cashGrabRunningRef.current) return;
    if (hasOpenCashGrabContract()) {
      setConnectionMessage({ kind: "info", text: "Cash Grab is still waiting for the current Rise/Fall contract to settle. No next contract will open until it is cleared." });
      return;
    }

    if (config.autoSwitchSafestPair && Date.now() >= (cashGrabAutoSwitchNextAtRef.current ?? 0)) {
      const recommendation = await scanCashGrabAutoSwitch(config);
      cashGrabAutoSwitchNextAtRef.current = Date.now() + 20_000;
      if (!cashGrabRunningRef.current) return;
      if (!recommendation) return;
      config = {
        ...config,
        symbol: recommendation.symbol,
        autoSelectBest: false,
      };
      cashGrabConfigRef.current = config;
      setCashGrabSymbol(recommendation.symbol);
      await selectMarket(recommendation.symbol);
    }
    if (!cashGrabRunningRef.current) return;

    if (config.autoSelectBest && cashGrabBestSymbol && cashGrabBestSymbol !== config.symbol) {
      config = { ...config, symbol: cashGrabBestSymbol };
      cashGrabConfigRef.current = config;
      setCashGrabSymbol(cashGrabBestSymbol);
      await selectMarket(cashGrabBestSymbol);
    }
    if (!cashGrabRunningRef.current) return;
    const amount = Number(cashGrabCurrentStakeRef.current.toFixed(2));
    if (currentAccountBalance == null || amount > currentAccountBalance) {
      setConnectionMessage({ kind: "error", text: "Cash Grab stopped because the selected stake exceeds the connected balance." });
      cashGrabRunningRef.current = false;
      setCashGrabRunning(false);
      return;
    }
    if (config.autoDirection) {
      const selectedDirection = await confirmCashGrabDirection(config.symbol);
      if (!cashGrabRunningRef.current) return;
      if (!selectedDirection) {
        await sleep(500);
        return;
      }
      config = { ...config, direction: selectedDirection };
      cashGrabConfigRef.current = config;
      setCashGrabDirection(selectedDirection);
    }
    let contractConfirmed = false;
    cashGrabActionLockRef.current = true;
    try {
      const result = await bulkBuyMutation.mutateAsync({
        data: {
          ...buildCashGrabBulkBuyPayload({
            amount,
            duration: config.duration,
            direction: config.direction,
            symbol: config.symbol,
            count: 1,
          }),
          access_feature: "cash-grab",
        },
      });
      contractConfirmed = true;
      setConnectionMessage(null);
      result.buys.forEach((buy) => {
        cashGrabOpenContractIdsRef.current.add(buy.contract_id);
      });
      let afterRows = claimFeatureRows("cash-grab", cashGrabClaimedHistoryIdsRef.current, result.buys.map((buy) => buy.contract_id));
      refreshTradeResults();
      let completed = reconcileCashGrabSession(afterRows);
      applyCashGrabSettlements(completed);
      for (let attempt = 0; attempt < 60 && cashGrabRunningRef.current; attempt += 1) {
        const active = cashGrabOpenContractIdsRef.current.size > 0 || afterRows.some((trade) =>
          cashGrabContractTypes.includes(trade.contract_type as typeof cashGrabContractTypes[number])
          && cashGrabSessionKnownIdsRef.current
          && !cashGrabSessionKnownIdsRef.current.has(trade.contract_id)
          && isDerivHistoryOpen(trade.status),
        );
        if (!active) break;
        await sleep(250);
        afterRows = await getDerivHistory();
        completed = reconcileCashGrabSession(afterRows);
        applyCashGrabSettlements(completed);
      }
      if (cashGrabOpenContractIdsRef.current.size > 0) {
        setConnectionMessage({ kind: "info", text: "Cash Grab is still waiting for the current Rise/Fall contract to settle. No next contract will open until it is cleared." });
        return;
      }
    } catch (error) {
      if (contractConfirmed) {
        setConnectionMessage({
          kind: "error",
          text: `Cash Grab contract was confirmed by Deriv, but its settlement history could not be refreshed: ${errorMessage(error)}. Cash Grab is paused to prevent overlapping trades.`,
        });
      } else if (error instanceof ApiTransportError && error.tradeOutcomeUncertain) {
        setConnectionMessage({
          kind: "error",
          text: `Cash Grab trade status is unconfirmed. ${errorMessage(error)} Cash Grab is paused; confirm there is no open Rise/Fall contract in Deriv before restarting.`,
        });
      } else {
        setConnectionMessage({ kind: "error", text: `Cash Grab could not place the contract: ${errorMessage(error)}` });
      }
      // A failed request must not be retried automatically in the now-unlimited
      // run. Stop and close any contract that was already acknowledged.
      stopCashGrab();
    } finally {
      cashGrabActionLockRef.current = false;
    }
  };

  const runCashGrabLoop = async (runId: number) => {
    while (cashGrabRunningRef.current && cashGrabRunIdRef.current === runId) {
      try {
        const currentConfig = cashGrabConfigRef.current;
        if (currentConfig?.autoSwitchSafestPair) {
          const nextScanAt = cashGrabAutoSwitchNextAtRef.current ?? Date.now();
          const waitForScan = Math.max(0, nextScanAt - Date.now());
          if (waitForScan > 0) await sleep(waitForScan);
        }
        if (!cashGrabRunningRef.current || cashGrabRunIdRef.current !== runId) break;
        await executeCashGrabTrade();
        if (cashGrabRunningRef.current && cashGrabRunIdRef.current === runId) {
          const nextConfig = cashGrabConfigRef.current;
          if (nextConfig?.autoSwitchSafestPair) {
            const nextScanAt = cashGrabAutoSwitchNextAtRef.current ?? (Date.now() + 20_000);
            const waitForScan = Math.max(250, nextScanAt - Date.now());
            await sleep(waitForScan);
          } else {
            await sleep(50);
          }
        }
      } catch (error) {
        if (cashGrabRunIdRef.current !== runId) return;
        cashGrabRunningRef.current = false;
        setCashGrabRunning(false);
        setConnectionMessage({ kind: "error", text: errorMessage(error) });
      }
    }
  };

  const closeCashGrabContracts = async () => {
    if (cashGrabClosePromiseRef.current) return cashGrabClosePromiseRef.current;
    const operation = (async () => {
      try {
        for (let pass = 0; pass < 80; pass += 1) {
          const cachedRows = queryClient.getQueryData<typeof rows>(getGetDerivHistoryQueryKey()) ?? rows;
          const cachedOpenIds = cachedRows
            .filter((trade) => cashGrabManagedContractTypes.includes(trade.contract_type as typeof cashGrabManagedContractTypes[number]))
            .filter((trade) => cashGrabClaimedHistoryIdsRef.current.has(trade.contract_id))
            .filter((trade) => isDerivHistoryOpen(trade.status))
            .map((trade) => trade.contract_id);
          const openIds = Array.from(new Set([...cachedOpenIds, ...cashGrabOpenContractIdsRef.current]));
          if (!openIds.length) {
            const latestRows = await getDerivHistory();
            const refreshedHistoryOpenIds = latestRows
              .filter((trade) => cashGrabManagedContractTypes.includes(trade.contract_type as typeof cashGrabManagedContractTypes[number]))
              .filter((trade) => cashGrabClaimedHistoryIdsRef.current.has(trade.contract_id))
              .filter((trade) => isDerivHistoryOpen(trade.status))
              .map((trade) => trade.contract_id);
            const refreshedOpenIds = Array.from(new Set([...refreshedHistoryOpenIds, ...cashGrabOpenContractIdsRef.current]));
            queryClient.setQueryData(getGetDerivHistoryQueryKey(), latestRows);
            if (!refreshedOpenIds.length) {
              // MONEY STOP can be clicked while the buy acknowledgement is
              // still in flight. Keep the close sweep alive until that
              // acknowledgement has been claimed and its contract is visible.
              if (cashGrabActionLockRef.current) {
                await sleep(50);
                continue;
              }
              cashGrabOpenContractIdsRef.current.clear();
              return;
            }
            await Promise.all(refreshedOpenIds.map(async (contractId) => {
              try {
                await cashGrabSellMutation.mutateAsync({ data: { contract_id: contractId } });
              } catch {
                // Settlement can win the race against a close request.
              }
            }));
            await sleep(100);
            continue;
          }

          await Promise.all(openIds.map(async (contractId) => {
            try {
              await cashGrabSellMutation.mutateAsync({ data: { contract_id: contractId } });
            } catch {
              // A contract can settle between the history read and the close
              // request. The next history sweep decides whether it still needs
              // a close attempt.
            }
          }));
          await sleep(100);
        }

        const finalRows = await getDerivHistory();
        queryClient.setQueryData(getGetDerivHistoryQueryKey(), finalRows);
        const stillOpen = finalRows.some((trade) =>
          cashGrabManagedContractTypes.includes(trade.contract_type as typeof cashGrabManagedContractTypes[number])
          && cashGrabClaimedHistoryIdsRef.current.has(trade.contract_id)
          && isDerivHistoryOpen(trade.status),
        );
        if (stillOpen) {
          throw new Error("Cash Grab could not close every active contract. Deriv is still processing the close request.");
        }
        cashGrabOpenContractIdsRef.current.clear();
      } finally {
        setCashGrabStopping(false);
        cashGrabClosePromiseRef.current = null;
      }
    })();
    cashGrabClosePromiseRef.current = operation;
    return operation;
  };

  const stopCashGrab = () => {
    cashGrabRunIdRef.current += 1;
    cashGrabRunningRef.current = false;
    cashGrabAutoSwitchNextAtRef.current = null;
    setCashGrabStopping(true);
    setCashGrabRunning(false);
    setCashGrabAutoSwitchSafestPairStatus(
      cashGrabAutoSwitchSafestPair || cashGrabConfigRef.current?.autoSwitchSafestPair ? "blocked" : "off",
    );
    void closeCashGrabContracts().catch((error) => {
      setConnectionMessage({ kind: "error", text: errorMessage(error) });
    });
  };

  const startCashGrab = async (requestedConfig?: CashGrabStartConfig) => {
    if (cashGrabRunningRef.current) return;
    if (cashGrabClosePromiseRef.current || cashGrabStopping) {
      setConnectionMessage({ kind: "info", text: "Cash Grab is finishing its stop sweep. Start again when the active contracts are closed." });
      return;
    }
    if (cashGrabOpenContractIdsRef.current.size > 0) {
      setConnectionMessage({ kind: "error", text: "Cash Grab cannot start until its previous open contracts are confirmed closed. Toggle Cash Grab off to retry the stop sweep." });
      return;
    }
    const requested = requestedConfig ?? cashGrabConfigRef.current;
    const config: CashGrabStartConfig | null = requested
      ? { ...requested, contractFamily: "rise-fall" }
      : null;
    if (!config || !isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before starting Cash Grab." });
      return;
    }
    if (!currentAccount) {
      setConnectionMessage({ kind: "error", text: "Select a Deriv account before starting Cash Grab." });
      return;
    }
    const existingIds = rows
      .filter((trade) => cashGrabManagedContractTypes.includes(trade.contract_type as typeof cashGrabManagedContractTypes[number]))
      .map((trade) => trade.contract_id);
    cashGrabOpenContractIdsRef.current.clear();
    cashGrabSessionKnownIdsRef.current = new Set(existingIds);
    cashGrabProcessedSettlementIdsRef.current = new Set(existingIds);
    cashGrabConfigRef.current = config;
    cashGrabCurrentStakeRef.current = Number(config.stake.toFixed(2));
    cashGrabSessionPnlRef.current = 0;
    setCashGrabSessionPnl(0);
    cashGrabAutoSwitchNextAtRef.current = config.autoSwitchSafestPair ? 0 : null;
    setCashGrabStopping(false);
    setCashGrabAutoSwitchSafestPairStatus(config.autoSwitchSafestPair ? "watching" : "off");
    cashGrabRunningRef.current = true;
    setCashGrabRunning(true);
    const runId = ++cashGrabRunIdRef.current;
    void runCashGrabLoop(runId);
  };

  const deactivateCashGrab = () => {
    stopCashGrab();
    setCashGrabEnabled(false);
  };

  const toggleCashGrab = (enabled: boolean) => {
    if (enabled && !isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before enabling Cash Grab." });
      return;
    }
    setCashGrabEnabled(enabled);
    if (!enabled) {
      stopCashGrab();
      return;
    }
    deactivateMoneyBank();
    stop();
    setXTraderEnabled(false);
    setDigitFlipEnabled(false);
    setTradeXEnabled(false);
    setBulkTraderEnabled(false);
    digitFlipRunningRef.current = false;
    setDigitFlipRunning(false);
    setClockWorkEnabled(false);
    setClockWorkAutoEnabled(false);
    setClockWorkAggressiveEnabled(false);
    matchesAiRunningRef.current = false;
    setMatchesAiEnabled(false);
    setMatchesAnalysisEnabled(false);
    autoSwitchRef.current = false;
    setAutoSwitch(false);
  };

  const clearCashGrabHistory = async () => {
    if (!cashGrabClearArmed) {
      setCashGrabClearArmed(true);
      window.setTimeout(() => setCashGrabClearArmed(false), 2_500);
      return;
    }
    setCashGrabClearArmed(false);
    setHistoryFading(true);
    await sleep(260);
    setCashGrabHiddenHistoryIds((current) => {
      const next = new Set(current);
      cashGrabRows.forEach((trade) => next.add(trade.contract_id));
      return next;
    });
    setHistoryFading(false);
  };

  const deactivateMoneyBank = () => {
    setEdge2Enabled(false);
    setMoneyBankJdyEnabled(false);
    setMoneyBankJdyState("idle");
    setMoneyBankJdyDecision(null);
    stopMoneyBank();
  };

  const toggleXTrader = (enabled: boolean) => {
    if (enabled && !isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before enabling EDGE." });
      return;
    }
    setXTraderEnabled(enabled);
    if (!enabled) {
      stop();
      return;
    }
    deactivateMoneyBank();
    deactivateCashGrab();
    setDigitFlipEnabled(false);
    digitFlipRunningRef.current = false;
    setDigitFlipRunning(false);
    setTradeXEnabled(false);
    setBulkTraderEnabled(false);
    setClockWorkEnabled(false);
    setClockWorkAutoEnabled(false);
    setClockWorkAggressiveEnabled(false);
    matchesAiRunningRef.current = false;
    setMatchesAiEnabled(false);
    setMatchesAnalysisEnabled(false);
    void selectMarket(symbol);
  };

  const toggleMoneyBank = (enabled: boolean) => {
    if (enabled && !canUseMoneyBank) return;
    if (enabled && !isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before enabling Money Bank." });
      return;
    }
    setEdge2Enabled(enabled);
    if (!enabled) {
      deactivateMoneyBank();
      return;
    }
    deactivateCashGrab();
    stop();
    setXTraderEnabled(false);
    setDigitFlipEnabled(false);
    digitFlipRunningRef.current = false;
    setDigitFlipRunning(false);
    setTradeXEnabled(false);
    setBulkTraderEnabled(false);
    setClockWorkEnabled(false);
    setClockWorkAutoEnabled(false);
    setClockWorkAggressiveEnabled(false);
    matchesAiRunningRef.current = false;
    setMatchesAiEnabled(false);
    setMatchesAnalysisEnabled(false);
  };

  const reset = () => {
    edgeSessionKnownIdsRef.current = new Set(edgeAllRows.map((trade) => trade.contract_id));
    setSessionPnl(0);
    setSessionTrades(0);
    nextStakeRef.current = stake;
    setNextStake(stake);
    martingaleWatchRef.current = null;
    edgeLossStreakRef.current = 0;
  };

  const refreshAnalysis = () => {
    analysisEpochRef.current = status.data?.last_tick?.epoch ?? null;
    setAnalysisDigits([]);
    setAnalysisTickCount(0);
  };

  const toggleAutoBestDigit = (enabled: boolean) => {
    if (enabled) {
      if (!isConnected) {
        setConnectionMessage({ kind: "error", text: "Connect Deriv before enabling Auto Best Digit." });
        return;
      }
      autoSwitchRef.current = true;
      setAutoSwitch(true);
      if (!runningRef.current) void start();
      return;
    }
    autoSwitchRef.current = false;
    setAutoSwitch(false);
    if (runningRef.current) stop();
  };

  const toggleEdgePercentageMode = (enabled: boolean) => {
    if (enabled) {
      if (!isConnected) {
        setConnectionMessage({ kind: "error", text: "Connect Deriv before enabling Percentage Scan." });
        return;
      }
      edgePercentageModeRef.current = true;
      setEdgePercentageMode(true);
      void applyPercentageRecommendation();
      return;
    }
    edgePercentageModeRef.current = false;
    setEdgePercentageMode(false);
    setEdgeRecommendation(null);
  };

  const resetDigitFlipScanner = () => {
    setDigitFlipSampleCount(0);
    setDigitFlipEvenCount(0);
  };

  const selectMarket = async (next: string) => {
    setSymbol(next);
    analysisEpochRef.current = null;
    setAnalysisDigits([]);
    setAnalysisTickCount(0);
    if (digitFlipEnabled) resetDigitFlipScanner();
    try {
      await symbolMutation.mutateAsync({ data: { symbol: next } });
      refreshTradeResults();
      return true;
    } catch (error) {
      setConnectionMessage({ kind: "error", text: errorMessage(error) });
      return false;
    }
  };

  useEffect(() => {
    if (
      !bulkTraderAutoSelectBest
      || !bulkTraderBestSymbol
      || bulkTraderBestSymbol === bulkTraderSymbol
      || bulkBuyMutation.isPending
    ) return;
    setBulkTraderSymbol(bulkTraderBestSymbol);
    void selectMarket(bulkTraderBestSymbol);
  }, [bulkTraderAutoSelectBest, bulkTraderBestSymbol, bulkTraderSymbol, bulkBuyMutation.isPending]);

  const withAiScannerLock = async (scan: () => Promise<string>) => {
    if (aiScannerActionLockRef.current) throw new Error("An AI Scanner action is already running.");
    aiScannerActionLockRef.current = true;
    try {
      return await scan();
    } finally {
      aiScannerActionLockRef.current = false;
    }
  };
  const executeTradeX = async (
    count = 1,
    durationOverride = tradeXConfigRef.current.duration,
    digitOverride?: number,
    symbolOverride?: string,
  ) => {
    if (tradeXActionLockRef.current) {
      setTradeXMessage("Trade X is already sending. Wait for the current request to finish.");
      return false;
    }
    if (bulkBuyMutation.isPending) {
      setTradeXMessage("Another trade request is still being sent. Wait for its confirmation before placing a Trade X contract.");
      return false;
    }
    if (tradeSlotBlocked) {
      setTradeXMessage(tradeSlotMessage ?? "Deriv has not confirmed that the previous contract settled. No new trade was sent.");
      return false;
    }
    const config = tradeXConfigRef.current;
    const entryDigit = digitOverride ?? (config.manualSelect
      ? config.selectedDigit
      : config.frameworkSignalReady
        ? config.selectedDigit
        : digitForTick(durationOverride, config.rankedDigits, config.selectedDigit));
    if (!isConnected) {
      setTradeXMessage("Connect Deriv before sending a Trade X contract.");
      return false;
    }
    if (currentAccountBalance == null) {
      setTradeXMessage("Trade X is paused until the selected account balance is available.");
      return false;
    }
    if (!isTradingCalendarOpen()) {
      setTradeXMessage("Trade X is outside its configured trading calendar.");
      return false;
    }
    const symbol = symbolOverride ?? config.symbol;
    const orderError = validateTradeXEntry({
      stake: config.stake,
      balance: currentAccountBalance,
      symbol,
      supportedSymbols: tradeXSymbols.map((market) => market.value),
      digit: entryDigit,
      duration: durationOverride,
      count,
    });
    if (orderError) {
      setTradeXMessage(orderError);
      return false;
    }
    const latestRows = queryClient.getQueryData<typeof rows>(getGetDerivHistoryQueryKey()) ?? [];
    tradeXActionLockRef.current = true;
    setTradeXSubmitting(true);
    try {
      const result = await bulkBuyMutation.mutateAsync({
        data: {
          access_feature: "trade-x",
          amount: config.stake,
          duration: durationOverride,
          duration_unit: "t",
          contract_type: "DIGITDIFF",
          barrier: entryDigit,
          symbol,
          count,
        },
      });
      if (result.buys.length) {
        claimFeatureRows("trade-x", tradeXClaimedHistoryIdsRef.current, result.buys.map((buy) => buy.contract_id));
      }
      if (!result.ok || result.buys.length !== count) {
        setTradeXMessage(result.message || `Deriv confirmed ${result.buys.length} of ${count} Trade X contracts. Check account history before resubmitting.`);
        refreshTradeResults();
        return false;
      }
      setTradeXTradesSent((value) => value + result.buys.length);
      setTradeXMessage(`Deriv confirmed ${result.buys.length} Trade X contract${result.buys.length === 1 ? "" : "s"}. Waiting for settlement.`);
      setConnectionMessage(null);
      refreshTradeResults();
      return true;
    } catch (error) {
      setTradeXMessage(`${errorMessage(error)} Check Deriv account history before retrying in case the contract was accepted.`);
      return false;
    } finally {
      tradeXActionLockRef.current = false;
      setTradeXSubmitting(false);
    }
  };

  const runEdgeAiScanner = () => withAiScannerLock(async () => {
    if (!xTraderEnabled || !isConnected) throw new Error("Enable EDGE and connect Deriv before scanning.");
    if (running) throw new Error("Stop the active EDGE run before changing its direction.");
    if (edgeActionLockRef.current || edgeSettlementLockRef.current || bulkBuyMutation.isPending) {
      throw new Error("EDGE is already sending or settling a contract.");
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 5) {
      throw new Error("Choose an EDGE duration from 1 to 5 ticks first.");
    }
    if (!Number.isFinite(stake) || stake < 0.35) throw new Error("Set an EDGE stake of at least 0.35 first.");
    if (!Number.isInteger(barrier) || barrier < 0 || barrier > 9) {
      throw new Error("Choose a digit from 0 to 9 before scanning.");
    }

    const freshStatus = await status.refetch();
    if (!freshStatus.data?.open_contracts_ready || (freshStatus.data.active_contract_count ?? 0) > 0) {
      throw new Error(tradeSlotMessage ?? "Deriv has not confirmed that the previous contract settled.");
    }
    if (isReal && !freshStatus.data.live_trading_enabled) {
      throw new Error("Live trading is disabled for this workspace.");
    }
    const freshBalance = getAccountBalance(freshStatus.data.account) ?? currentAccountBalanceRef.current;
    if (freshBalance == null || stake > freshBalance) {
      throw new Error("The selected EDGE stake exceeds the available account balance.");
    }
    const signals = (freshStatus.data?.market_signals ?? []) as MarketSignal[];
    const selectedMarket = signals.find((signal) => signal.symbol === symbol);
    if (!selectedMarket || selectedMarket.sample_count < EDGE_MIN_MARKET_SAMPLE) {
      throw new Error(`EDGE needs at least ${EDGE_MIN_MARKET_SAMPLE} live samples for ${symbol}.`);
    }
    const outcome = selectedMarket.digit_outcomes?.find((entry) => entry.digit === barrier);
    if (!outcome) throw new Error(`No live Over/Under sample is available for digit ${barrier} on ${symbol}.`);
    const overRate = Number(outcome.over_percentage);
    const underRate = Number(outcome.under_percentage);
    if (![overRate, underRate].every((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100)) {
      throw new Error(`The live Over/Under sample for digit ${barrier} is not usable yet.`);
    }
    if (overRate === underRate) {
      throw new Error(`Over and Under are tied at ${overRate.toFixed(1)}% for ${symbol} digit ${barrier}. No trade was sent.`);
    }
    const candidate = chooseBestEdgeDirectionForDigit(signals, symbol, barrier, EDGE_MIN_MARKET_SAMPLE);
    if (!candidate) throw new Error("EDGE could not validate the current quote and sample. No trade was sent.");

    setDirection(candidate.direction);
    configRef.current = {
      ...configRef.current,
      symbol,
      direction: candidate.direction,
      barrier,
      duration,
      stake,
    };
    const historySnapshot = await readHistorySnapshot();
    if (!historySnapshot.fresh || historySnapshot.rows.some((trade) => isDerivHistoryOpen(trade.status))) {
      throw new Error("EDGE needs a fresh, settled history check before sending a scanned trade.");
    }
    if (edgeActionLockRef.current || edgeSettlementLockRef.current || bulkBuyMutation.isPending) {
      throw new Error("EDGE is already sending or settling a contract.");
    }
    edgeActionLockRef.current = true;
    edgeSettlementLockRef.current = true;
    try {
      armMartingaleWatch(historySnapshot.rows, stake, 1);
      const result = await bulkBuyMutation.mutateAsync({
        data: {
          access_feature: "edge",
          amount: stake,
          duration,
          duration_unit: "t",
          contract_type: candidate.direction,
          barrier,
          symbol,
          count: 1,
        },
      });
      if (!result.buys.length) throw new Error("Deriv did not return a confirmed EDGE contract.");
      claimFeatureRows("edge", edgeClaimedHistoryIdsRef.current, result.buys.map((buy) => buy.contract_id));
      setSessionTrades((value) => value + result.buys.length);
      setConnectionMessage(null);
      refreshTradeResults();
    } finally {
      edgeActionLockRef.current = false;
      edgeSettlementLockRef.current = false;
    }
    const side = candidate.direction === "DIGITOVER" ? "Over" : "Under";
    return `Sent one ${side} ${barrier} contract on ${symbol} for ${duration} ticks at ${stake.toFixed(2)} ${currentAccount?.currency ?? "USD"}. The selected side had ${candidate.score.toFixed(1)}% in ${candidate.sampleCount} observed samples; that is not a win-rate guarantee.`;
  });

  const runCashGrabAiScanner = () => withAiScannerLock(async () => {
    if (!cashGrabEnabled || !isConnected) throw new Error("Enable Cash Grab and connect Deriv before scanning.");
    if (cashGrabRunningRef.current || cashGrabActionLockRef.current || bulkBuyMutation.isPending) {
      throw new Error("Cash Grab is already running or sending a contract.");
    }
    if (!Number.isInteger(cashGrabDuration) || cashGrabDuration < 1 || cashGrabDuration > 5) {
      throw new Error("Choose a Cash Grab duration from 1 to 5 ticks first.");
    }
    const amount = Number(cashGrabStake.toFixed(2));
    if (!Number.isFinite(amount) || amount < 0.35) throw new Error("Set a Cash Grab stake of at least 0.35 first.");

    const freshStatus = await status.refetch();
    if (!freshStatus.data?.open_contracts_ready || (freshStatus.data.active_contract_count ?? 0) > 0) {
      throw new Error(tradeSlotMessage ?? "Deriv has not confirmed that the previous contract settled.");
    }
    if (isReal && !freshStatus.data.live_trading_enabled) {
      throw new Error("Live trading is disabled for this workspace.");
    }
    const balance = getAccountBalance(freshStatus.data.account) ?? currentAccountBalanceRef.current;
    if (balance == null || amount > balance) throw new Error("The Cash Grab stake exceeds the available account balance.");

    const signals = (freshStatus.data.market_signals ?? []) as AiScannerMarketSignal[];
    const candidate = chooseCashGrabScannerCandidate(signals, cashGrabSymbols.map((market) => market.value));
    if (!candidate) {
      throw new Error(`Cash Grab needs at least ${AI_SCANNER_MIN_SAMPLE} valid Rise/Fall samples on a supported market.`);
    }
    if (!await selectMarket(candidate.symbol)) throw new Error("Deriv could not select the scanned market. No contract was sent.");
    const historySnapshot = await readHistorySnapshot();
    if (!historySnapshot.fresh || historySnapshot.rows.some((trade) => isDerivHistoryOpen(trade.status))) {
      throw new Error("Cash Grab needs a fresh, settled history check before sending a scanned contract.");
    }
    if (cashGrabSessionKnownIdsRef.current == null) {
      cashGrabSessionKnownIdsRef.current = new Set(historySnapshot.rows.map((trade) => trade.contract_id));
    }

    setCashGrabSymbol(candidate.symbol);
    setCashGrabDirection(candidate.contractType);
    cashGrabActionLockRef.current = true;
    try {
      const result = await bulkBuyMutation.mutateAsync({
        data: {
          ...buildCashGrabBulkBuyPayload({
            amount,
            duration: cashGrabDuration,
            direction: candidate.contractType,
            symbol: candidate.symbol,
            count: 1,
          }),
          access_feature: "cash-grab",
        },
      });
      if (!result.buys.length) throw new Error("Deriv did not return a confirmed Cash Grab contract.");
      setConnectionMessage(null);
      claimFeatureRows("cash-grab", cashGrabClaimedHistoryIdsRef.current, result.buys.map((buy) => buy.contract_id));
      refreshTradeResults();
    } finally {
      cashGrabActionLockRef.current = false;
    }
    const side = candidate.contractType === "CALL" ? "Rise" : "Fall";
    return `Sent one Cash Grab ${side} contract on ${candidate.symbol} for ${cashGrabDuration} ticks at ${amount.toFixed(2)} ${currentAccount?.currency ?? "USD"}. The selected side appeared in ${candidate.observedRate.toFixed(1)}% of ${candidate.sampleCount} observed moves; that sample is not a win-rate guarantee.`;
  });

  const runTradeXAiScanner = () => withAiScannerLock(async () => {
    if (!tradeXEnabled || !isConnected) throw new Error("Enable Trade X and connect Deriv before scanning.");
    if (running) throw new Error("Stop the active EDGE run before using the one-shot scanner.");
    const freshStatus = await status.refetch();
    if (!freshStatus.data?.open_contracts_ready || (freshStatus.data.active_contract_count ?? 0) > 0) {
      throw new Error(tradeSlotMessage ?? "Deriv has not confirmed that the previous contract settled. No new trade was sent.");
    }
    const signals = (freshStatus.data?.market_signals ?? []) as AiScannerMarketSignal[];
    const symbols = tradeXSymbols
      .filter((item) => item.marketType === tradeXMarketType)
      .map((item) => item.value);
    const candidate = chooseTradeXScannerCandidate(signals, symbols);
    if (!candidate) {
      throw new Error(`No ${tradeXMarketType} market has at least ${AI_SCANNER_MIN_SAMPLE} observed moves.`);
    }
    setTradeXSymbol(candidate.symbol);
    setTradeXSelectedDigit(candidate.digit);
    setTradeXManualSelect(true);
    if (!await selectMarket(candidate.symbol)) throw new Error("Deriv could not select the scanned market. No trade was sent.");
    if (currentAccountBalanceRef.current == null || tradeXStake > currentAccountBalanceRef.current) {
      throw new Error("The selected Trade X stake exceeds the current account balance.");
    }
    const sent = await executeTradeX(1, tradeXDuration, candidate.digit, candidate.symbol);
    if (!sent) throw new Error("The setup was selected, but the existing Trade X checks blocked the order.");
    return `Sent one ${candidate.symbol} Digit Differs ${candidate.digit} trade. The digit differed in ${candidate.observedRate.toFixed(1)}% of ${candidate.sampleCount} sampled moves; that history is not a prediction.`;
  });


  const chooseDigitFlipSetup = async (requireThreshold = false) => {
    const config = digitFlipConfigRef.current;
    const signals = digitFlipMarketSignalsRef.current
      .filter((signal) => signal.sampleCount > 0)
      .filter((signal) => config.marketType === "auto" || tradeXSymbols.find((option) => option.value === signal.symbol)?.marketType === config.marketType)
      .map((signal) => ({
        signal,
        parity: signal.evenPercentage >= signal.oddPercentage ? "DIGITEVEN" as const : "DIGITODD" as const,
        rate: Math.max(signal.evenPercentage, signal.oddPercentage),
      }))
      .filter((candidate) => !requireThreshold || candidate.rate >= DIGIT_FLIP_SIGNAL_FLOOR)
      .sort((left, right) => right.rate - left.rate || right.signal.sampleCount - left.signal.sampleCount);
    const best = signals[0];
    if (!best) return false;
    if (best.signal.symbol !== config.symbol) {
      setDigitFlipSymbol(best.signal.symbol);
      await selectMarket(best.signal.symbol);
    }
    const nextParity = (config.marketType === "auto" || digitFlipMagicRef.current) && !digitFlipAssaultRef.current
      ? best.parity
      : config.parity;
    if (nextParity !== config.parity) setDigitFlipParity(nextParity);
    digitFlipConfigRef.current = {
      ...digitFlipConfigRef.current,
      symbol: best.signal.symbol,
      parity: nextParity,
    };
    return true;
  };

  useEffect(() => {
    if (!digitFlipEnabled || (!digitFlipMagic && digitFlipMarketType !== "auto") || !digitFlipMarketSignals.length) return;
    const eligible = digitFlipMarketSignals
      .filter((signal) => digitFlipMarketType === "auto" || tradeXSymbols.some((option) => option.value === signal.symbol && option.marketType === digitFlipMarketType))
      .sort((left, right) => Math.max(right.evenPercentage, right.oddPercentage) - Math.max(left.evenPercentage, left.oddPercentage) || right.sampleCount - left.sampleCount);
    const best = eligible[0];
    if (!best) return;
    const parity = best.oddPercentage > best.evenPercentage ? "DIGITODD" : "DIGITEVEN";
    const key = `${best.symbol}:${parity}`;
    if (digitFlipAutoSelectionKeyRef.current === key) return;
    digitFlipAutoSelectionKeyRef.current = key;
    if (digitFlipConfigRef.current.symbol === best.symbol && digitFlipConfigRef.current.parity === parity) return;
    void chooseDigitFlipSetup(false);
  }, [digitFlipEnabled, digitFlipMagic, digitFlipMarketSignals, digitFlipMarketType]);

  const chooseDigitFlipMarket = async () => chooseDigitFlipSetup(false);

  const applyDigitFlipAssaultSettlements = (latestRows: typeof rows) => {
    if (!digitFlipAssaultRef.current) return;
    const watch = digitFlipAssaultWatchRef.current;
    if (!watch) return;
    const newlySettled = latestRows
      .filter((trade) =>
        (trade.contract_type === "DIGITEVEN" || trade.contract_type === "DIGITODD")
        && !watch.knownIds.has(trade.contract_id)
        && !watch.processedIds.has(trade.contract_id)
        && !isDerivHistoryOpen(trade.status),
      )
      .sort((left, right) => (left.buy_time ?? 0) - (right.buy_time ?? 0));
    for (const trade of newlySettled) {
      const settledParity = trade.contract_type === "DIGITEVEN" ? "DIGITEVEN" : "DIGITODD";
      watch.processedIds.add(trade.contract_id);
      watch.knownIds.add(trade.contract_id);
      if (trade.profit < 0) {
        digitFlipAssaultLossesRef.current[settledParity] += 1;
        const nextParity = settledParity === "DIGITEVEN" ? "DIGITODD" : "DIGITEVEN";
        digitFlipConfigRef.current = { ...digitFlipConfigRef.current, parity: nextParity };
        setDigitFlipParity(nextParity);
        setConnectionMessage({
          kind: "info",
          text: `Assault switched to ${nextParity === "DIGITEVEN" ? "Even" : "Odd"} after a ${settledParity === "DIGITEVEN" ? "Even" : "Odd"} loss${digitFlipAssaultLossesRef.current[settledParity] >= 3 ? " (3-loss trigger)" : ""}.`,
        });
      } else {
        digitFlipAssaultLossesRef.current[settledParity] = 0;
      }
    }
  };

  const executeDigitFlip = async () => {
    if (digitFlipActionLockRef.current || !isConnected) return false;
    if (tradeSlotBlocked) {
      setConnectionMessage({ kind: "info", text: tradeSlotMessage ?? "Deriv has not confirmed that the previous contract settled. No new trade was sent." });
      return false;
    }
    if (!isTradingCalendarOpen()) {
      setConnectionMessage({ kind: "info", text: "DigitFlip is outside its configured trading calendar." });
      return false;
    }
    const declaredAccountBalance = currentAccountBalance ?? 0;
    if (!Number.isFinite(declaredAccountBalance) || declaredAccountBalance <= 0) {
      setConnectionMessage({ kind: "error", text: "DigitFlip is paused until the account balance is entered." });
      return false;
    }
    // History is a display/settlement feed, not a prerequisite for a buy.
    // Use the newest cached snapshot; the API serializes buys and rejects one
    // while an earlier contract is still open.
    const latestRows = queryClient.getQueryData<typeof rows>(getGetDerivHistoryQueryKey()) ?? [];
    if (digitFlipSessionKnownIdsRef.current == null) {
      digitFlipSessionKnownIdsRef.current = new Set(latestRows
        .filter((trade) => trade.contract_type === "DIGITEVEN" || trade.contract_type === "DIGITODD")
        .map((trade) => trade.contract_id));
    }
    applyDigitFlipAssaultSettlements(latestRows);
    const config = digitFlipConfigRef.current;
    const selectedRate = config.parity === "DIGITEVEN" ? digitFlipRatesRef.current.even : digitFlipRatesRef.current.odd;
    if (digitFlipMagicRef.current && selectedRate < DIGIT_FLIP_SIGNAL_FLOOR) {
      setConnectionMessage({ kind: "info", text: `Standby is waiting for an ${DIGIT_FLIP_SIGNAL_FLOOR}% observed parity signal. Current ${selectedRate.toFixed(1)}%.` });
      return false;
    }
    const latestFlip = latestRows.find((trade) => (trade.contract_type === "DIGITEVEN" || trade.contract_type === "DIGITODD") && !isDerivHistoryOpen(trade.status));
    const watch = digitFlipMartingaleWatchRef.current;
    if (
      config.stakeMode === "martingale" &&
      latestFlip &&
      watch &&
      !watch.knownIds.has(latestFlip.contract_id) &&
      !watch.processedIds.has(latestFlip.contract_id)
    ) {
      digitFlipNextStakeRef.current = nextStakeAfterSettlement(latestFlip.profit, digitFlipNextStakeRef.current, config.stake, config.multiplier);
      watch.processedIds.add(latestFlip.contract_id);
    }
    const amount = config.stakeMode === "martingale"
      ? digitFlipNextStakeRef.current
      : config.stake;
    if (amount > declaredAccountBalance || (currentAccountBalance != null && amount > currentAccountBalance)) {
      setConnectionMessage({ kind: "error", text: "The DigitFlip stake is higher than the available balance." });
      return false;
    }
    digitFlipActionLockRef.current = true;
    setDigitFlipCurrentStake(amount);
    try {
      const result = await digitFlipBuyMutation.mutateAsync({
        data: {
          access_feature: "digit-flip",
          amount,
          duration: config.duration,
          duration_unit: "t",
          contract_type: config.parity,
          symbol: config.symbol,
        },
      });
      // The buy acknowledgement is authoritative. Claim its contract id now,
      // and let history polling populate the full row when Deriv publishes it.
      if (result.buy?.contract_id) {
        claimFeatureRows("digit-flip", digitFlipClaimedHistoryIdsRef.current, [result.buy.contract_id]);
      }
      setConnectionMessage(null);
      setDigitFlipTradeCount((value) => value + 1);
      void refreshTradeResults();
      return true;
    } catch (error) {
      setConnectionMessage({ kind: "error", text: errorMessage(error) });
      return false;
    } finally {
      digitFlipActionLockRef.current = false;
    }
  };

  const runDigitFlipAiScanner = () => withAiScannerLock(async () => {
    if (!digitFlipEnabled || !isConnected) throw new Error("Enable DigitFlip and connect Deriv before scanning.");
    if (digitFlipRunningRef.current || digitFlipActionLockRef.current) {
      throw new Error("Stop the active DigitFlip run before using the one-shot scanner.");
    }
    if (currentAccountBalance == null || currentAccountBalance <= 0) {
      throw new Error("The selected account balance must be available before scanning.");
    }
    const freshStatus = await status.refetch();
    const signals = (freshStatus.data?.market_signals ?? []) as AiScannerMarketSignal[];
    const symbols = tradeXSymbols
      .filter((item) => digitFlipMarketType === "auto" || item.marketType === digitFlipMarketType)
      .map((item) => item.value);
    const candidate = chooseDigitFlipScannerCandidate(signals, symbols);
    if (!candidate) {
      throw new Error(`No eligible market has at least ${AI_SCANNER_MIN_SAMPLE} observed moves.`);
    }
    const selectedSignal = signals.find((signal) => signal.symbol === candidate.symbol);
    if (!selectedSignal) throw new Error("The selected market sample is no longer available.");
    digitFlipRunningRef.current = false;
    setDigitFlipRunning(false);
    digitFlipRatesRef.current = {
      even: selectedSignal.digit_even_percentage,
      odd: selectedSignal.digit_odd_percentage,
    };
    digitFlipConfigRef.current = {
      ...digitFlipConfigRef.current,
      symbol: candidate.symbol,
      parity: candidate.parity,
    };
    setDigitFlipSymbol(candidate.symbol);
    setDigitFlipParity(candidate.parity);
    if (!await selectMarket(candidate.symbol)) throw new Error("Deriv could not select the scanned market. No trade was sent.");
    const currentDigitFlipStake = digitFlipStakeMode === "martingale"
      ? digitFlipNextStakeRef.current
      : digitFlipStake;
    if (currentAccountBalanceRef.current == null || currentDigitFlipStake > currentAccountBalanceRef.current) {
      throw new Error("The selected DigitFlip stake exceeds the current account balance.");
    }
    const sent = await executeDigitFlip();
    if (!sent) throw new Error("The setup was selected, but the existing DigitFlip checks blocked the order.");
    return `Sent one ${candidate.symbol} ${candidate.parity === "DIGITEVEN" ? "Even" : "Odd"} trade. That parity appeared in ${candidate.observedRate.toFixed(1)}% of ${candidate.sampleCount} sampled moves; that history is not a prediction.`;
  });

  const waitForMarketTicks = async (count: number, isActive: () => boolean) => {
    const target = liveTickSequenceRef.current + Math.max(1, Math.trunc(count));
    while (isActive() && liveTickSequenceRef.current < target) {
      await sleep(20);
    }
  };

  const runDigitFlipLoop = async () => {
    digitFlipNextMarketScanAtRef.current = 0;
    while (digitFlipRunningRef.current) {
      const config = digitFlipConfigRef.current;
      if ((config.marketType === "auto" || digitFlipMagicRef.current) && Date.now() >= digitFlipNextMarketScanAtRef.current) {
        const selected = await chooseDigitFlipSetup(digitFlipMagicRef.current);
        if (!selected) {
          setConnectionMessage({ kind: "info", text: `Standby is waiting for a market with an ${DIGIT_FLIP_SIGNAL_FLOOR}% observed parity signal.` });
          digitFlipNextMarketScanAtRef.current = Date.now() + DIGIT_FLIP_MARKET_SCAN_INTERVAL_MS;
          await waitForMarketTicks(1, () => digitFlipRunningRef.current);
          continue;
        }
        digitFlipNextMarketScanAtRef.current = Date.now() + DIGIT_FLIP_MARKET_SCAN_INTERVAL_MS;
      }
      const didTrade = await executeDigitFlip();
      if (digitFlipRunningRef.current) {
        await waitForMarketTicks(didTrade ? digitFlipDuration : 1, () => digitFlipRunningRef.current);
        if (didTrade && (digitFlipConfigRef.current.marketType === "auto" || digitFlipMagicRef.current)) {
          await sleep(DIGIT_FLIP_MARKET_SCAN_INTERVAL_MS);
          digitFlipNextMarketScanAtRef.current = 0;
        }
      }
    }
  };

  const toggleDigitFlip = (enabled: boolean) => {
    if (enabled && !isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before enabling DigitFlip." });
      return;
    }
    setDigitFlipEnabled(enabled);
    if (!enabled) {
      digitFlipRunningRef.current = false;
      digitFlipMartingaleWatchRef.current = null;
      setDigitFlipRunning(false);
      return;
    }
    deactivateMoneyBank();
    deactivateCashGrab();
    setXTraderEnabled(false);
    setTradeXEnabled(false);
    setBulkTraderEnabled(false);
    setClockWorkEnabled(false);
    setClockWorkAutoEnabled(false);
    setClockWorkAggressiveEnabled(false);
    matchesAiRunningRef.current = false;
    setMatchesAiEnabled(false);
    setMatchesAnalysisEnabled(false);
    runningRef.current = false;
    setRunning(false);
    autoSwitchRef.current = false;
    setAutoSwitch(false);
    void chooseDigitFlipMarket();
  };

  const toggleDigitFlipAssault = (enabled: boolean) => {
    digitFlipAssaultRef.current = enabled;
    setDigitFlipAssault(enabled);
    if (enabled) {
      digitFlipAssaultLossesRef.current = { DIGITEVEN: 0, DIGITODD: 0 };
      digitFlipAssaultWatchRef.current = {
        knownIds: new Set(digitFlipAllRows.map((trade) => trade.contract_id)),
        processedIds: new Set(),
      };
      setConnectionMessage({ kind: "info", text: "Assault is armed. A settled loss switches the next trade to the opposite parity." });
    }
  };

  const toggleDigitFlipMagic = (enabled: boolean) => {
    digitFlipMagicRef.current = enabled;
    setDigitFlipMagic(enabled);
    if (enabled) {
      setConnectionMessage({ kind: "info", text: `Standby is working with an ${DIGIT_FLIP_SIGNAL_FLOOR}% observed-signal gate; it does not guarantee a win.` });
    }
  };

  const toggleDigitFlipRun = () => {
    if (digitFlipRunningRef.current) {
      digitFlipRunningRef.current = false;
      setDigitFlipRunning(false);
      return;
    }
    if (!isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before running DigitFlip." });
      return;
    }
    if (currentAccountBalance == null || currentAccountBalance <= 0) {
      setConnectionMessage({ kind: "error", text: "Sync the connected account balance before starting DigitFlip." });
      return;
    }
    const declaredAccountBalance = Number(digitFlipAccountBalance);
    if (!Number.isFinite(declaredAccountBalance) || declaredAccountBalance <= 0) {
      setConnectionMessage({ kind: "error", text: "Enter a positive account balance before starting DigitFlip." });
      return;
    }
    if (currentAccountBalance != null && declaredAccountBalance > currentAccountBalance + 0.01) {
      setConnectionMessage({ kind: "error", text: `The declared account balance is above the connected ${currentAccount?.currency ?? "USD"} balance.` });
      return;
    }
    digitFlipSessionKnownIdsRef.current = new Set(digitFlipAllRows.map((trade) => trade.contract_id));
    setDigitFlipSessionPnl(0);
    setDigitFlipTradeCount(0);
    setDigitFlipCurrentStake(digitFlipStake);
    digitFlipNextStakeRef.current = digitFlipStake;
    digitFlipMartingaleWatchRef.current = {
      knownIds: new Set(digitFlipAllRows.map((trade) => trade.contract_id)),
      processedIds: new Set(),
    };
    digitFlipAssaultWatchRef.current = {
      knownIds: new Set(digitFlipAllRows.map((trade) => trade.contract_id)),
      processedIds: new Set(),
    };
    digitFlipAssaultLossesRef.current = { DIGITEVEN: 0, DIGITODD: 0 };
    digitFlipNextMarketScanAtRef.current = 0;
    digitFlipRunningRef.current = true;
    setDigitFlipRunning(true);
    void runDigitFlipLoop();
  };

  const resetDigitFlip = () => {
    digitFlipSessionKnownIdsRef.current = new Set(digitFlipAllRows.map((trade) => trade.contract_id));
    setDigitFlipSessionPnl(0);
    setDigitFlipTradeCount(0);
    setDigitFlipCurrentStake(digitFlipStake);
    resetDigitFlipScanner();
    digitFlipNextStakeRef.current = digitFlipStake;
    digitFlipMartingaleWatchRef.current = null;
    digitFlipAssaultWatchRef.current = null;
    digitFlipAssaultLossesRef.current = { DIGITEVEN: 0, DIGITODD: 0 };
    digitFlipNextMarketScanAtRef.current = 0;
  };

  const refreshDigitFlipSample = () => {
    resetDigitFlipScanner();
    setConnectionMessage({ kind: "info", text: "DigitFlip parity scanner reset. Waiting for fresh ticks." });
  };

  const clearDigitFlipHistory = async () => {
    if (!digitFlipClearArmed) {
      setDigitFlipClearArmed(true);
      window.setTimeout(() => setDigitFlipClearArmed(false), 2_500);
      return;
    }
    setDigitFlipClearArmed(false);
    setHistoryFading(true);
    await sleep(260);
    setDigitFlipHiddenHistoryIds((current) => {
      const next = new Set(current);
          digitFlipRows.forEach((trade) => next.add(String(trade.contract_id)));
      return next;
    });
    setHistoryFading(false);
  };

  const clearMatchesHistory = async () => {
    if (!matchesHistoryClearArmed) {
      setMatchesHistoryClearArmed(true);
      window.setTimeout(() => setMatchesHistoryClearArmed(false), 2_500);
      return;
    }
    setMatchesHistoryClearArmed(false);
    setHistoryFading(true);
    await sleep(260);
    setMatchesHiddenHistoryIds((current) => {
      const next = new Set(current);
      matchesRows.forEach((trade) => next.add(String(trade.contract_id)));
      return next;
    });
    setHistoryFading(false);
  };

  const toggleTradeX = (enabled: boolean) => {
    if (enabled && !isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before enabling Trade X." });
      return;
    }
    setTradeXEnabled(enabled);
    if (enabled) {
      deactivateMoneyBank();
      deactivateCashGrab();
      setXTraderEnabled(false);
      setDigitFlipEnabled(false);
      setBulkTraderEnabled(false);
      setClockWorkEnabled(false);
      setClockWorkAutoEnabled(false);
      setClockWorkAggressiveEnabled(false);
      matchesAiRunningRef.current = false;
      setMatchesAiEnabled(false);
      setMatchesAnalysisEnabled(false);
      digitFlipRunningRef.current = false;
      setDigitFlipRunning(false);
      stop();
      autoSwitchRef.current = false;
      setAutoSwitch(false);
      void selectMarket(tradeXSymbol);
      return;
    }
    setTradeXMessage("Trade X paused.");
  };

  const toggleClockWork = (enabled: boolean) => {
    if (enabled && !canUseClockWork) return;
    if (enabled && !isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before enabling Clock Work." });
      return;
    }
    setClockWorkEnabled(enabled);
    if (!enabled) {
      setClockWorkAutoEnabled(false);
      setClockWorkAggressiveEnabled(false);
      setClockWorkAutoStatus("Clock Work automation is stopped. Open contracts can continue to settle.");
      return;
    }
    deactivateMoneyBank();
    deactivateCashGrab();
    toggleXTrader(false);
    setTradeXEnabled(false);
    setDigitFlipEnabled(false);
    setBulkTraderEnabled(false);
    matchesAiRunningRef.current = false;
    setMatchesAiEnabled(false);
    setMatchesAnalysisEnabled(false);
    runningRef.current = false;
    digitFlipRunningRef.current = false;
    setRunning(false);
    setDigitFlipRunning(false);
    autoSwitchRef.current = false;
    setAutoSwitch(false);
    setClockWorkAutoEnabled(false);
    setClockWorkAggressiveEnabled(false);
    setClockWorkStatusMessage(null);
    setClockWorkAutoStatus("Select a mode and minimum lean to begin.");
    void selectMarket(clockWorkSymbol);
  };

  const toggleBulkTrader = (enabled: boolean) => {
    if (enabled && !isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before enabling Bulk Trader." });
      return;
    }
    setBulkTraderEnabled(enabled);
    if (!enabled) return;
    deactivateMoneyBank();
    deactivateCashGrab();
    setXTraderEnabled(false);
    setTradeXEnabled(false);
    setDigitFlipEnabled(false);
    setClockWorkEnabled(false);
    setClockWorkAutoEnabled(false);
    setClockWorkAggressiveEnabled(false);
    matchesAiRunningRef.current = false;
    setMatchesAiEnabled(false);
    setMatchesAnalysisEnabled(false);
    runningRef.current = false;
    digitFlipRunningRef.current = false;
    setRunning(false);
    setDigitFlipRunning(false);
    autoSwitchRef.current = false;
    setAutoSwitch(false);
    void selectMarket(bulkTraderSymbol);
  };

  const resetMatchesSample = (symbol = matchesSymbol) => {
    matchesSampleCursorRef.current = { symbol, tickCount: analysisTickCount };
    setMatchesObservedDigits([]);
    setMatchesTickCount(0);
    matchesAutomationAttemptTickRef.current = -1;
  };

  const toggleMatchesAnalysis = (enabled: boolean) => {
    if (enabled && !canUseMatchesAnalysis) return;
    if (enabled && !isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before enabling Matches Analysis." });
      return;
    }
    setMatchesAnalysisEnabled(enabled);
    if (!enabled) {
      matchesAiRunningRef.current = false;
      setMatchesAiEnabled(false);
      setMatchesStatusMessage("Matches Analysis is off. Open contracts can continue to settle.");
      return;
    }

    deactivateMoneyBank();
    deactivateCashGrab();
    stop();
    setXTraderEnabled(false);
    setTradeXEnabled(false);
    setDigitFlipEnabled(false);
    setBulkTraderEnabled(false);
    setClockWorkEnabled(false);
    setClockWorkAutoEnabled(false);
    setClockWorkAggressiveEnabled(false);
    runningRef.current = false;
    digitFlipRunningRef.current = false;
    setRunning(false);
    setDigitFlipRunning(false);
    autoSwitchRef.current = false;
    setAutoSwitch(false);
    matchesAiRunningRef.current = false;
    setMatchesAiEnabled(false);
    setClockWorkAutoStatus("Clock Work automation is stopped. Open contracts can continue to settle.");
    matchesSessionKnownIdsRef.current = new Set(
      rows.filter((trade) => trade.contract_type === "DIGITMATCH").map((trade) => String(trade.contract_id)),
    );
    resetMatchesSample();
    setMatchesStatusMessage("Collecting fresh ticks for this market.");
    void selectMarket(matchesSymbol);
  };

  const toggleMatchesAi = (
    enabled: boolean,
    stoppedMessage = "Automatic Matches entries are stopped. Open contracts can continue to settle.",
  ) => {
    if (enabled && (!matchesAnalysisEnabled || !canUseMatchesAnalysis || !isConnected || !currentAccount)) {
      setMatchesStatusMessage("Enable Matches Analysis and connect a Deriv account before starting automatic entries.");
      return;
    }
    matchesAiRunningRef.current = enabled;
    setMatchesAiEnabled(enabled);
    matchesAutomationAttemptTickRef.current = enabled ? -1 : matchesTickCount;
    setMatchesStatusMessage(enabled
      ? "AI Matches is on. Waiting for fresh ticks, a ranked sample, and an available trade slot."
      : stoppedMessage);
  };

  const changeMatchesSymbol = (nextSymbol: string) => {
    const nextMarket = matchesMarkets.find((market) => market.value === nextSymbol);
    setMatchesSymbol(nextSymbol);
    if (nextMarket) setMatchesMarketType(nextMarket.marketType);
    matchesAiRunningRef.current = false;
    setMatchesAiEnabled(false);
    resetMatchesSample(nextSymbol);
    setMatchesStatusMessage("Market changed. Collecting a fresh sample.");
    if (matchesAnalysisEnabled) void selectMarket(nextSymbol);
  };

  const executeMatchesOrders = async (digits: readonly number[], automated: boolean) => {
    if (matchesActionLockRef.current || matchesBuyMutation.isPending) return false;
    if (automated && (!matchesAnalysisEnabled || !matchesAiEnabled || !matchesAiRunningRef.current)) return false;
    if (!matchesAnalysisEnabled || !canUseMatchesAnalysis || !isConnected || !currentAccount) {
      setMatchesStatusMessage("Enable Matches Analysis and connect a Deriv account before trading.");
      return false;
    }
    if (isReal && !status.data?.live_trading_enabled) {
      setMatchesStatusMessage("Live-account trading is disabled for this workspace.");
      if (automated) toggleMatchesAi(false);
      return false;
    }
    if (tradeSlotBlocked) {
      setMatchesStatusMessage(tradeSlotMessage ?? "Waiting for open contracts to settle.");
      return false;
    }
    const selectedDigits = Array.from(new Set(digits))
      .filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9)
      .slice(0, 3);
    if (!selectedDigits.length || (automated && matchesTickCount < MATCHES_MINIMUM_SAMPLE_SIZE)) {
      setMatchesStatusMessage(`Collect at least ${MATCHES_MINIMUM_SAMPLE_SIZE} fresh ticks before AI Matches trades.`);
      return false;
    }

    const contracts = selectedDigits.map((digit) => ({
      // The Matches API limits contract keys to 32 characters. A standard
      // UUID contains 36 characters, so remove its four separators.
      key: crypto.randomUUID().replace(/-/g, ""),
      amount: matchesStake,
      duration: matchesDuration,
      duration_unit: "t" as const,
      contract_type: "DIGITMATCH" as const,
      barrier: digit,
      symbol: matchesSymbol,
    }));
    matchesActionLockRef.current = true;
    if (automated) matchesAutomationAttemptTickRef.current = matchesTickCount;
    setMatchesStatusMessage(automated ? "Sending fresh Matches proposals and buy requests." : "Sending the manual Matches trade.");
    try {
      const result = await matchesBuyMutation.mutateAsync({ data: { contracts } });
      claimFeatureRows(
        "matches-analysis",
        matchesClaimedHistoryIdsRef.current,
        result.contracts.map((entry) => String(entry.buy.contract_id)),
      );
      refreshTradeResults();
      if (!result.ok) {
        toggleMatchesAi(false, `${result.message} Automatic entries are stopped. Open contracts can continue to settle.`);
      } else {
        setMatchesStatusMessage(automated && !matchesAiRunningRef.current
          ? `${result.message} Automatic entries remain stopped. Open contracts can continue to settle.`
          : result.message);
      }
      return result.ok;
    } catch (error) {
      const message = errorMessage(error);
      const status = error && typeof error === "object" && "status" in error
        ? Number((error as { status?: unknown }).status)
        : NaN;
      const stoppedMessage = status >= 400 && status < 500
        ? `${message} No Matches order was submitted. Automatic entries are stopped. Open contracts can continue to settle.`
        : `${message} Check Deriv history before retrying an unconfirmed order. Automatic entries are stopped. Open contracts can continue to settle.`;
      toggleMatchesAi(
        false,
        stoppedMessage,
      );
      return false;
    } finally {
      matchesActionLockRef.current = false;
    }
  };

  useEffect(() => {
    if (!matchesAnalysisEnabled || !matchesAiEnabled || !matchesAiRunningRef.current) return;
    if (!canUseMatchesAnalysis) {
      toggleMatchesAi(false);
      return;
    }
    if (!isConnected || !currentAccount) {
      matchesAiRunningRef.current = false;
      setMatchesAiEnabled(false);
      matchesAutomationAttemptTickRef.current = matchesTickCount;
      setMatchesStatusMessage("Deriv disconnected. Automatic Matches entries are stopped. Open contracts can continue to settle.");
      return;
    }
    if (isReal && !status.data?.live_trading_enabled) {
      setMatchesStatusMessage("Live-account trading is disabled for this workspace.");
      toggleMatchesAi(false);
      return;
    }
    if (matchesTickCount < MATCHES_MINIMUM_SAMPLE_SIZE) {
      setMatchesStatusMessage(`Collecting fresh ticks (${matchesTickCount}/${MATCHES_MINIMUM_SAMPLE_SIZE}).`);
      return;
    }
    if (tradeSlotBlocked) {
      setMatchesStatusMessage(tradeSlotMessage ?? "Waiting for open contracts to settle.");
      return;
    }
    if (matchesBuyMutation.isPending || matchesActionLockRef.current) return;
    if (matchesAutomationAttemptTickRef.current >= matchesTickCount) return;
    const digits = chooseObservedMatchDigits(matchesTopDigits, matchesAiDigits);
    if (digits.length !== matchesAiDigits) {
      matchesAutomationAttemptTickRef.current = matchesTickCount;
      setMatchesStatusMessage("Waiting for enough top-ranked digits to exceed the 10% observed-frequency baseline.");
      return;
    }

    matchesAutomationAttemptTickRef.current = matchesTickCount;
    void executeMatchesOrders(digits, true);
  }, [
    canUseMatchesAnalysis,
    currentAccount,
    executeMatchesOrders,
    isConnected,
    isReal,
    matchesAiDigits,
    matchesAiEnabled,
    matchesAnalysisEnabled,
    matchesBuyMutation.isPending,
    matchesTickCount,
    matchesTopDigits,
    status.data?.live_trading_enabled,
    tradeSlotBlocked,
    tradeSlotMessage,
  ]);

  const executeClockWorkBatch = async (
    contracts: ClockWorkContractOrder[],
    source: "manual" | "auto" | "aggressive" = "manual",
  ) => {
    if (!clockWorkEnabled || !canUseClockWork || !isConnected || !currentAccount) {
      setClockWorkStatusMessage("Enable Clock Work and connect a Deriv account before placing orders.");
      return false;
    }
    if (isReal && !status.data?.live_trading_enabled) {
      setClockWorkStatusMessage("Live-account trading is disabled for this workspace.");
      return false;
    }
    if (tradeSlotBlocked) {
      setClockWorkStatusMessage(tradeSlotMessage ?? "Wait for open Deriv contracts to settle before placing another order.");
      return false;
    }
    if (clockWorkActionLockRef.current) return false;
    clockWorkActionLockRef.current = true;
    setClockWorkBusy(true);
    setClockWorkStatusMessage(null);
    if (source !== "manual") setClockWorkAutoStatus("Sending the selected Clock Work orders to Deriv.");
    try {
      const result = await clockWorkBuyMutation.mutateAsync({ data: { contracts } });
      for (const contract of result.contracts) {
        claimFeatureRows("clock-work", clockWorkClaimedHistoryIdsRef.current, [String(contract.buy.contract_id)]);
      }
      setClockWorkStatusMessage(result.message);
      refreshTradeResults();
      if (!result.ok) {
        setClockWorkAutoEnabled(false);
        setClockWorkAggressiveEnabled(false);
        setClockWorkAutoStatus("Automation paused. Check Deriv history before retrying an unconfirmed order.");
      } else if (source === "aggressive") {
        setClockWorkAggressiveRounds((rounds) => rounds + 1);
        setClockWorkAutoStatus("Aggressive cycle submitted. Waiting for all contracts to settle before another entry.");
      } else if (source === "auto") {
        setClockWorkAutoStatus("Orders submitted. Waiting for all contracts to settle before another entry.");
      }
      return result.ok;
    } catch (error) {
      const message = errorMessage(error);
      setClockWorkStatusMessage(message);
      if (source !== "manual") {
        setClockWorkAutoEnabled(false);
        setClockWorkAggressiveEnabled(false);
        setClockWorkAutoStatus(`Automation paused: ${message}`);
      }
      return false;
    } finally {
      clockWorkActionLockRef.current = false;
      setClockWorkBusy(false);
    }
  };

  const executeBulkTrade = async (
    contractType: BulkTraderContractType,
    barrierOverride?: number,
    symbolOverride?: string,
  ): Promise<boolean> => {
    if (bulkActionLockRef.current || bulkBuyMutation.isPending) {
      setConnectionMessage({ kind: "info", text: "Bulk Trader is already sending. Wait for the current request to finish." });
      return false;
    }
    if (tradeSlotBlocked) {
      setConnectionMessage({ kind: "info", text: tradeSlotMessage ?? "Deriv has not confirmed that the previous contract settled. No new batch was sent." });
      return false;
    }
    if (!isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before sending a Bulk Trader contract." });
      return false;
    }
    if (currentAccountBalance == null) {
      setConnectionMessage({ kind: "error", text: "Bulk Trader is paused until the selected account balance is available." });
      return false;
    }
    const barrier = barrierOverride ?? bulkTraderPrediction;
    const symbol = symbolOverride ?? bulkTraderSymbol;
    const orderError = validateBulkTraderEntry({
      stake: bulkTraderStake,
      balance: currentAccountBalance,
      symbol,
      supportedSymbols: tradeXSymbols.map((market) => market.value),
      contractType,
      barrier,
      duration: bulkTraderDuration,
      count: bulkTraderCount,
    });
    if (orderError) {
      setConnectionMessage({ kind: "error", text: orderError });
      return false;
    }
    const beforeRows = queryClient.getQueryData<typeof rows>(getGetDerivHistoryQueryKey()) ?? [];
    if (bulkSessionKnownIdsRef.current == null) {
      bulkSessionKnownIdsRef.current = new Set(beforeRows.map((trade) => trade.contract_id));
    }
    const send = (type: BulkTraderContractType) => bulkBuyMutation.mutateAsync({
      data: {
        access_feature: "bulk-trader",
        amount: bulkTraderStake,
        duration: bulkTraderDuration,
        duration_unit: "t",
        contract_type: type,
        barrier,
        symbol,
        count: bulkTraderCount,
      },
    });
    bulkActionLockRef.current = true;
    try {
      const result = await send(contractType);
      if (result.buys.length) {
        claimFeatureRows("bulk-trader", bulkClaimedHistoryIdsRef.current, result.buys.map((buy) => buy.contract_id));
      }
      setConnectionMessage(result.ok ? null : { kind: "info", text: result.message });
      refreshTradeResults();
      return result.ok;
    } catch (error) {
      setConnectionMessage({ kind: "error", text: errorMessage(error) });
      return false;
    } finally {
      bulkActionLockRef.current = false;
    }
  };

  const runBulkTraderAiScanner = () => withAiScannerLock(async () => {
    if (!bulkTraderEnabled || !isConnected) throw new Error("Enable Bulk Trader and connect Deriv before scanning.");
    if (bulkActionLockRef.current || bulkBuyMutation.isPending) throw new Error("Bulk Trader is already sending a batch.");
    const freshStatus = await status.refetch();
    if (!freshStatus.data?.open_contracts_ready || (freshStatus.data.active_contract_count ?? 0) > 0) {
      throw new Error(tradeSlotMessage ?? "Deriv has not confirmed that the previous contract settled. No new batch was sent.");
    }
    const signals = (freshStatus.data?.market_signals ?? []) as AiScannerMarketSignal[];
    const candidate = chooseBulkScannerCandidate(
      signals,
      tradeXSymbols.map((item) => item.value),
      bulkTraderType,
      bulkTraderPrediction,
    );
    if (!candidate) {
      throw new Error(`No eligible setup has at least ${AI_SCANNER_MIN_SAMPLE} observed moves for the selected contract type and barrier.`);
    }
    const nextType = candidate.contractType === "DIGITDIFF" ? "differs" : "over-under";
    setBulkTraderAutoSelectBest(false);
    setBulkTraderSymbol(candidate.symbol);
    setBulkTraderType(nextType);
    setBulkTraderPrediction(candidate.barrier);
    if (!await selectMarket(candidate.symbol)) throw new Error("Deriv could not select the scanned market. No contracts were sent.");
    if (
      currentAccountBalanceRef.current == null
      || bulkTraderStake * bulkTraderCount > currentAccountBalanceRef.current
    ) {
      throw new Error("The configured Bulk Trader batch exceeds the current account balance.");
    }
    const sent = await executeBulkTrade(candidate.contractType, candidate.barrier, candidate.symbol);
    if (!sent) throw new Error("The setup was selected, but the existing Bulk Trader checks blocked the batch.");
    return `Sent the configured batch of ${bulkTraderCount} ${candidate.symbol} ${candidate.contractType === "DIGITDIFF" ? "Digit Differs" : candidate.contractType === "DIGITOVER" ? "Over" : "Under"} ${candidate.barrier} contracts. The observed rate was ${candidate.observedRate.toFixed(1)}% across ${candidate.sampleCount} moves; that history is not a prediction.`;
  });

  const selectDuration = (next: number) => {
    if (!Number.isInteger(next) || next < 1 || next > 5) return;
    setDuration(next);
  };

  const fireTrade = async (contractType: "DIGITOVER" | "DIGITUNDER") => {
    if (edgeActionLockRef.current || edgeSettlementLockRef.current) return;
    if (!isConnected) return;
    if (tradeSlotBlocked) {
      setConnectionMessage({ kind: "info", text: tradeSlotMessage ?? "Deriv has not confirmed that the previous contract settled. No new trade was sent." });
      return;
    }
    if (currentAccountBalance == null) {
      setConnectionMessage({ kind: "error", text: "EDGE is paused until the selected account balance is available." });
      return;
    }
    edgeActionLockRef.current = true;
    edgeSettlementLockRef.current = true;
    try {
      if (edgePercentageModeRef.current) {
        const recommendation = await applyPercentageRecommendation();
        if (!recommendation) return;
        if (recommendation.direction === "DUAL" || recommendation.direction !== contractType) {
          setConnectionMessage({
            kind: "info",
            text: `Percentage Scan recommends ${recommendation.direction === "DUAL" ? "Dual" : recommendation.direction === "DIGITOVER" ? "Over" : "Under"} ${recommendation.digit} on ${recommendation.symbol}; no ${contractType === "DIGITOVER" ? "Over" : "Under"} trade was sent.`,
          });
          return;
        }
      }
      const amount = strategy === "martingale" ? nextStakeRef.current : stake;
      const entryDigit = configRef.current.barrier;
      if (currentAccountBalance == null || amount > currentAccountBalance) {
        setConnectionMessage({ kind: "error", text: "The next stake is higher than the available balance." });
        return;
      }
      const latestRows = queryClient.getQueryData<typeof rows>(getGetDerivHistoryQueryKey()) ?? [];
      armMartingaleWatch(latestRows, amount, 1);
      const result = await bulkBuyMutation.mutateAsync({
        data: {
          access_feature: "edge",
          amount,
          duration,
          duration_unit: "t",
          contract_type: contractType,
          barrier: entryDigit,
          symbol: configRef.current.symbol,
          count: 1,
        },
      });
      claimFeatureRows("edge", edgeClaimedHistoryIdsRef.current, result.buys.map((buy) => buy.contract_id));
      setConnectionMessage(null);
      setDirection(contractType);
      setSessionTrades((value) => value + 1);
      refreshTradeResults();
      if (!await waitForEdgeSettlement(result.buys.map((buy) => buy.contract_id))) {
        setConnectionMessage({
          kind: "info",
          text: "Deriv accepted the EDGE trade. Trade history is temporarily unavailable; Deriv still checks settlement before another trade.",
        });
        return;
      }
    } catch (error) {
      martingaleWatchRef.current = null;
      setConnectionMessage({ kind: "error", text: errorMessage(error) });
    } finally {
      edgeActionLockRef.current = false;
      edgeSettlementLockRef.current = false;
    }
  };

  const fireDualTrade = async () => {
    if (edgeActionLockRef.current || edgeSettlementLockRef.current) return;
    if (!isConnected) return;
    if (tradeSlotBlocked) {
      setConnectionMessage({ kind: "info", text: tradeSlotMessage ?? "Deriv has not confirmed that the previous contract settled. No new dual batch was sent." });
      return;
    }
    if (currentAccountBalance == null) {
      setConnectionMessage({ kind: "error", text: "EDGE is paused until the selected account balance is available." });
      return;
    }
    edgeActionLockRef.current = true;
    edgeSettlementLockRef.current = true;
    try {
      if (edgePercentageModeRef.current) {
        const recommendation = await applyPercentageRecommendation();
        if (!recommendation) return;
        if (recommendation.direction !== "DUAL") {
          setConnectionMessage({
            kind: "info",
            text: `Percentage Scan recommends ${recommendation.direction === "DIGITOVER" ? "Over" : "Under"} ${recommendation.digit} on ${recommendation.symbol}; Dual was not sent.`,
          });
          return;
        }
      }
      const amount = strategy === "martingale" ? nextStakeRef.current : stake;
      if (currentAccountBalance == null || amount * 2 > currentAccountBalance) {
        setConnectionMessage({ kind: "error", text: "The dual stake is higher than the available balance." });
        return;
      }
      const latestRows = queryClient.getQueryData<typeof rows>(getGetDerivHistoryQueryKey()) ?? [];
      armMartingaleWatch(latestRows, amount, 2);
      const result = await dualBuyMutation.mutateAsync({
        data: {
          access_feature: "edge",
          amount,
          duration,
          duration_unit: "t",
          barrier: configRef.current.barrier,
          symbol: configRef.current.symbol,
        },
      });
      claimFeatureRows("edge", edgeClaimedHistoryIdsRef.current, result.buys.map((buy) => buy.contract_id));
      setConnectionMessage(null);
      setSessionTrades((value) => value + 2);
      refreshTradeResults();
      if (!await waitForEdgeSettlement(result.buys.map((buy) => buy.contract_id))) {
        setConnectionMessage({
          kind: "info",
          text: "Deriv accepted the EDGE dual trade. Trade history is temporarily unavailable; Deriv still checks settlement before another trade.",
        });
        return;
      }
    } catch (error) {
      martingaleWatchRef.current = null;
      setConnectionMessage({ kind: "error", text: errorMessage(error) });
    } finally {
      edgeActionLockRef.current = false;
      edgeSettlementLockRef.current = false;
    }
  };
  const clearHistory = async () => {
    if (!clearHistoryArmed) {
      setClearHistoryArmed(true);
      window.setTimeout(() => setClearHistoryArmed(false), 2_500);
      return;
    }
    setClearHistoryArmed(false);
    setHistoryFading(true);
    await sleep(260);
    setEdgeHiddenHistoryIds((current) => {
      const next = new Set(current);
      edgeRows.forEach((trade) => next.add(trade.contract_id));
      return next;
    });
    setHistoryFading(false);
  };

  const clearTradeXHistory = async () => {
    if (!tradeXHistoryClearArmed) {
      setTradeXHistoryClearArmed(true);
      window.setTimeout(() => setTradeXHistoryClearArmed(false), 2_500);
      return;
    }
    setTradeXHistoryClearArmed(false);
    setHistoryFading(true);
    await sleep(260);
    setTradeXHiddenHistoryIds((current) => {
      const next = new Set(current);
      tradeXRows.forEach((trade) => next.add(trade.contract_id));
      return next;
    });
    setHistoryFading(false);
  };

  const clearClockWorkHistory = async () => {
    if (!clockWorkHistoryClearArmed) {
      setClockWorkHistoryClearArmed(true);
      window.setTimeout(() => setClockWorkHistoryClearArmed(false), 2_500);
      return;
    }
    setClockWorkHistoryClearArmed(false);
    setHistoryFading(true);
    await sleep(260);
    setClockWorkHiddenHistoryIds((current) => {
      const next = new Set(current);
      clockWorkRows.forEach((trade) => next.add(trade.contract_id));
      return next;
    });
    setHistoryFading(false);
  };

  const clearBulkTraderHistory = async () => {
    if (!bulkTraderClearArmed) {
      setBulkTraderClearArmed(true);
      window.setTimeout(() => setBulkTraderClearArmed(false), 2_500);
      return;
    }
    setBulkTraderClearArmed(false);
    setHistoryFading(true);
    await sleep(260);
    setBulkTraderHiddenHistoryIds((current) => {
      const next = new Set(current);
      bulkRows.forEach((trade) => next.add(trade.contract_id));
      return next;
    });
    setHistoryFading(false);
  };

  const anyFeatureRunning = running
    || xTraderEnabled
    || tradeXEnabled
    || digitFlipEnabled
    || bulkTraderEnabled
    || cashGrabRunning
    || cashGrabStopping
    || moneyBankRunning
    || clockWorkAutoEnabled
    || clockWorkAggressiveEnabled;
  const entryDigit = barrier;
  const activeGuidePages = guideMode === "trade-x"
    ? tradeXGuidePages
    : guideMode === "digit-flip"
      ? digitFlipGuidePages
      : guideMode === "bulk-trader"
        ? bulkTraderGuidePages
        : guideMode === "money-bank"
          ? moneyBankGuidePages
          : guideMode === "cash-grab"
            ? cashGrabGuidePages
            : guideMode === "matches-analysis"
              ? matchesAnalysisGuidePages
            : guideMode === "clock-work"
              ? clockWorkGuidePages
        : guidePages;
  const canUseGuideFeature = guideMode === "trade-x"
    ? canUseTradeX
    : guideMode === "digit-flip"
      ? canUseDigitFlip
      : guideMode === "bulk-trader"
        ? canUseBulkTrader
        : guideMode === "money-bank"
          ? canUseMoneyBank
          : guideMode === "cash-grab"
            ? canUseCashGrab
            : guideMode === "matches-analysis"
              ? canUseMatchesAnalysis
            : guideMode === "clock-work"
              ? canUseClockWork
              : canUseEdge;
  const statusText = isConnected ? "CONNECTED" : connectedToken ? "CONNECTING" : "DISCONNECTED";
  const activityText = running ? "EDGE RUNNING" : "EDGE STOPPED";
  const edgeBalanceReady = currentAccountBalance != null && currentAccountBalance > 0;
  const canTrade = isConnected && !running && edgeBalanceReady
    && !tradeSlotBlocked
    && (!isReal || Boolean(status.data?.live_trading_enabled))
    && Boolean(currentAccount) && stake <= Number(edgeAccountBalance)
    && stake <= (currentAccountBalance ?? 0);
  const clockWorkControlsDisabled = !canUseClockWork
    || !isConnected
    || !currentAccount
    || (isReal && !status.data?.live_trading_enabled);
  const clockWorkAggressiveOrderCount = clockWorkAutoMode === "all4"
    ? 4
    : clockWorkAutoMode === "auto" ? 1 : 2;
  const clockWorkAggressiveBudget = getClockWorkAggressiveBudget(
    currentAccountBalance ?? null,
    clockWorkAggressivePercent,
    clockWorkAggressiveOrderCount,
  );
  const clockWorkAggressiveUsingBalance = clockWorkAggressiveBudget?.budgetAmount ?? null;
  const clockWorkAggressiveEachSide = clockWorkAggressiveBudget?.eachContractAmount ?? null;
  const clockWorkAggressiveStakeLabel = clockWorkAutoMode === "pair" ? "Each side" : "Per trade";

  clockWorkAutomationRef.current = () => {
    const aggressive = clockWorkAggressiveEnabled;
    if (!clockWorkEnabled || (!clockWorkAutoEnabled && !aggressive)) return;
    if (!clockWorkAutoMode || (!aggressive && clockWorkMinLean == null)) {
      setClockWorkAutoStatus(aggressive
        ? "Choose an automatic mode before Aggressive Auto Trading can run."
        : "Choose a mode and minimum lean before automatic trading can run.");
      return;
    }
    if (!isConnected || !currentAccount || !canUseClockWork) {
      setClockWorkAutoStatus("Waiting for the Clock Work account connection.");
      return;
    }
    if (isReal && !status.data?.live_trading_enabled) {
      setClockWorkAutoStatus("Live-account trading is disabled for this workspace.");
      return;
    }
    if (Date.now() < clockWorkAutoAttemptAtRef.current) return;
    if (tradeSlotBlocked) {
      setClockWorkAutoStatus(tradeSlotMessage ?? "Waiting for open contracts to settle.");
      return;
    }
    if (clockWorkCurrentQuote == null || clockWorkRates.leanStrength == null) {
      setClockWorkAutoStatus("Waiting for enough live price history to estimate a lean.");
      return;
    }
    const lead = aggressive ? clockWorkPushDirection : clockWorkRates.prediction;
    if (aggressive && !lead) {
      setClockWorkAutoStatus(`Waiting for 5 consecutive ticks in one direction (${clockWorkPushProgress.consecutiveTicks}/5).`);
      return;
    }
    if (clockWorkAutoMode === "auto" && !lead) {
      setClockWorkAutoStatus("The Higher and Lower estimates are tied; waiting for a clear lean.");
      return;
    }
    const measuredLean = lead == null
      ? null
      : aggressive || clockWorkAutoMode === "auto"
        ? lead === "HIGHER" ? clockWorkRates.higherPercent : clockWorkRates.lowerPercent
        : clockWorkRates.leanStrength;
    const measuredLeanWhole = measuredLean == null ? null : Math.round(measuredLean);
    const minimumWinRate = aggressive ? CLOCK_WORK_AGGRESSIVE_MIN_WIN_RATE : clockWorkMinLean;
    if (
      minimumWinRate == null
      || !meetsClockWorkMinimumWinRate(measuredLean, minimumWinRate)
    ) {
      setClockWorkAutoStatus(`Waiting for ${minimumWinRate ?? CLOCK_WORK_AGGRESSIVE_MIN_WIN_RATE}% observed win rate. Current measured rate: ${measuredLeanWhole == null ? "—" : `${measuredLeanWhole}%`}.`);
      return;
    }

    let plannedOrders: ClockWorkContractOrder[];
    if (clockWorkAutoMode === "pair") {
      plannedOrders = aggressive && lead === "LOWER"
        ? [...clockWorkPairOrders].reverse()
        : [...clockWorkPairOrders];
    } else if (clockWorkAutoMode === "auto") {
      plannedOrders = [makeClockWorkOrder("auto", lead as "HIGHER" | "LOWER", lead === "HIGHER" ? clockWorkHigherStake : clockWorkLowerStake)];
    } else {
      plannedOrders = makeClockWorkFourOrders(lead);
    }

    if (aggressive) {
      if (currentAccountBalance == null || currentAccountBalance <= 0) {
        setClockWorkAutoStatus("Waiting for an available account balance.");
        return;
      }
      const allocation = getClockWorkAggressiveBudget(
        currentAccountBalance,
        clockWorkAggressivePercent,
        plannedOrders.length,
      );
      if (!allocation?.eligible) {
        setClockWorkAutoStatus(`The ${clockWorkAggressivePercent}% balance budget is too small for the $1 minimum on each contract.`);
        return;
      }
      plannedOrders = plannedOrders.map((order, index) => ({
        ...order,
        amount: allocation.stakes[index],
      }));
    }

    clockWorkAutoAttemptAtRef.current = Date.now() + 5_000;
    void executeClockWorkBatch(plannedOrders, aggressive ? "aggressive" : "auto");
  };
  useEffect(() => {
    if (!clockWorkEnabled || (!clockWorkAutoEnabled && !clockWorkAggressiveEnabled)) return;
    const timer = window.setInterval(() => clockWorkAutomationRef.current?.(), 1_000);
    return () => window.clearInterval(timer);
  }, [clockWorkEnabled, clockWorkAutoEnabled, clockWorkAggressiveEnabled]);

  return (
    <main className="xt-app">
      <header className="xt-header">
        <div className="xt-header-leading">
          <div className="xt-menu-anchor">
            <button
              className="xt-menu-button"
              type="button"
              aria-label={navigationOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={navigationOpen}
              aria-controls="xt-navigation-menu"
              onClick={() => setNavigationOpen((open) => !open)}
            >
              {navigationOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            {navigationOpen && (
              <nav id="xt-navigation-menu" className="xt-navigation-menu" aria-label="Main navigation">
                <Link href="/app" onClick={() => setNavigationOpen(false)}><Gauge size={15} />Trading dashboard</Link>
                {accessSession.data?.is_admin === true && (
                  <Link href="/admin/users" onClick={() => setNavigationOpen(false)}><ShieldCheck size={15} />Admin panel</Link>
                )}
                {canUseSettings && (
                  <Link href="/settings" onClick={() => setNavigationOpen(false)}><Settings size={15} />Settings</Link>
                )}
                <button
                  type="button"
                  className="xt-navigation-logout"
                  onClick={() => {
                    setNavigationOpen(false);
                    logoutAccessSession();
                  }}
                  disabled={isLoggingOut}
                >
                  <LogOut size={15} />Log out
                </button>
                <Link href="/auto-trader" className={canUseAutoTrader ? "" : "xt-navigation-link-restricted"} onClick={() => setNavigationOpen(false)}>
                  <Bot size={15} />Auto Trader
                  {!canUseAutoTrader && <span><FeatureStatusText control={featureControl("auto-trader")} isAdmin={isAdmin} fallback="Restricted — admin access only" /></span>}
                </Link>
                <Link href="/auto-trader-2" className={canUseAutoTrader2 ? "" : "xt-navigation-link-restricted"} onClick={() => setNavigationOpen(false)}>
                  <Bot size={15} />Auto Trader 2.0
                  {!canUseAutoTrader2 && <span><FeatureStatusText control={featureControl("auto-trader-2")} isAdmin={isAdmin} fallback="Restricted — admin access only" /></span>}
                </Link>
              </nav>
            )}
          </div>
          <div className="xt-brand">
            <span aria-hidden="true">S</span>
            <div className="xt-brand-copy">
              <div className="xt-brand-heading">
                <strong>Shadow Ai Trading</strong>
                <small>AI Trading</small>
              </div>
            </div>
          </div>
        </div>
        <div className="xt-header-right">
          <DerivAccountSwitcher
            variant="cockpit"
            className="deriv-account-switcher-xt"
            enabled={canUseDeriv}
            disabled={anyFeatureRunning || bulkBuyMutation.isPending || digitFlipBuyMutation.isPending || moneyBankBuyMutation.isPending}
            onAccountSelected={() => {
              void queryClient.invalidateQueries();
            }}
            onAccountSelectError={(message) => setConnectionMessage({ kind: "error", text: message })}
          />
          {accessSession.data?.is_admin === true && (
            <Link href="/admin/users" className="xt-admin-link">
              <ShieldCheck size={14} />Admin panel
            </Link>
          )}
          <div className={`xt-connection ${isConnected ? "online" : ""}`}><i />{statusText}</div>
        </div>
      </header>

      <section className="xt-connect-card" id="account-connection">
        <div className="xt-section-title"><Link2 size={17} /><div><b>Connect your Deriv account</b></div></div>
         {!canUseDeriv ? (
           <div className="xt-restricted-message"><ShieldAlert size={17} /><span>Restricted — admin access only. This key has not been granted a trading feature.</span></div>
         ) : !connectedToken ? (
          <form onSubmit={connectPat} className="xt-pat-form">
            <input type="password" value={pat} onChange={(event) => setPat(event.target.value)} placeholder="Paste your Deriv PAT token" autoComplete="off" />
            <button disabled={!pat.trim() || tokenMutation.isPending}>{tokenMutation.isPending ? <Loader2 className="spin" size={16} /> : <Power size={16} />}Connect</button>
          </form>
        ) : (
          <div className="xt-connected-row">
           <span><i />Deriv credential connected securely</span>
            <button onClick={() => void disconnect()} disabled={deleteTokenMutation.isPending}>Disconnect</button>
          </div>
        )}
        {derivCapacityError && <p className="xt-inline-message error" role="alert">{derivCapacityError}</p>}
        {connectionMessage && <p className={`xt-inline-message ${connectionMessage.kind}${connectionMessageFading ? " fading" : ""}`} role="status" aria-live="polite">{connectionMessage.text}</p>}
        {tradeSlotMessage && <p className="xt-inline-message info" role="status" aria-live="polite">{tradeSlotMessage}</p>}
        {isReal && status.data && !status.data.live_trading_enabled && (
          <p className="xt-inline-message error" role="status">
            Live-account trading is turned off for this workspace. Ask an administrator to enable it.
          </p>
        )}
      </section>

      <h2 className="xt-trading-strategies-heading">Trading Strategies</h2>

      <section className={`xt-feature-card xt-feature-card-matches ${!canUseMatchesAnalysis ? "xt-feature-card-restricted" : ""}`} id="matches-analysis-feature">
        <div><Activity size={18} /><span><b>Matches Analysis</b><small><FeatureStatusText control={featureControl("matches-analysis")} isAdmin={isAdmin} fallback={canUseMatchesAnalysis ? "Matches Tool" : "Restricted — admin access only"} /></small></span></div>
        <div className="xt-feature-actions">
          {!canUseMatchesAnalysis && <span className="xt-feature-locked">RESTRICTED</span>}
          <button className="xt-guide-button" type="button" onClick={() => { setGuideMode("matches-analysis"); setGuidePage(0); setGuideOpen(true); }}>
            <BookOpen size={14} />Guide
          </button>
          <label className="xt-switch">
            <input type="checkbox" checked={matchesAnalysisEnabled} onChange={(event) => toggleMatchesAnalysis(event.target.checked)} aria-label="Toggle Matches Analysis" disabled={!canUseMatchesAnalysis || !isConnected} />
            <span />
          </label>
        </div>
      </section>

      <section className={`xt-feature-card xt-feature-card-clock-work ${!canUseClockWork ? "xt-feature-card-restricted" : ""}`} id="clock-work-feature">
        <div><Clock3 size={18} /><span><b>Clock Work</b><small><FeatureStatusText control={featureControl("clock-work")} isAdmin={isAdmin} fallback={canUseClockWork ? "Hybrid Analysis" : "Restricted — admin access only"} /></small></span></div>
        <div className="xt-feature-actions">
          {!canUseClockWork && <span className="xt-feature-locked">RESTRICTED</span>}
          <button className="xt-guide-button" type="button" onClick={() => { setGuideMode("clock-work"); setGuidePage(0); setGuideOpen(true); }}>
            <BookOpen size={14} />Guide
          </button>
          <label className="xt-switch">
            <input type="checkbox" checked={clockWorkEnabled} onChange={(event) => toggleClockWork(event.target.checked)} aria-label="Toggle Clock Work" disabled={!canUseClockWork || !isConnected} />
            <span />
          </label>
        </div>
      </section>

      <section className={`xt-feature-card xt-feature-card-cash-grab ${!canUseCashGrab ? "xt-feature-card-restricted" : ""}`} id="cash-grab-feature">
        <div><Activity size={18} /><span><b>Cash Grab</b><small><FeatureStatusText control={featureControl("cash-grab")} isAdmin={isAdmin} fallback={canUseCashGrab ? "Rise/Fall contracts · one at a time" : "Restricted — admin access only"} /></small></span></div>
        <div className="xt-feature-actions">
          {!canUseCashGrab && <span className="xt-feature-locked">RESTRICTED</span>}
          <button className="xt-guide-button" type="button" onClick={() => { setGuideMode("cash-grab"); setGuidePage(0); setGuideOpen(true); }}>
            <BookOpen size={14} />Guide
          </button>
          <label className="xt-switch">
            <input type="checkbox" checked={cashGrabEnabled} onChange={(event) => toggleCashGrab(event.target.checked)} aria-label="Toggle Cash Grab" disabled={!canUseCashGrab || !isConnected} />
            <span />
          </label>
        </div>
      </section>

      <section className={`xt-feature-card xt-feature-card-edge2 ${!canUseMoneyBank ? "xt-feature-card-restricted" : ""}`}>
        <div><Bot size={18} /><span><b>Money Bank</b><small><FeatureStatusText control={featureControl("money-bank")} isAdmin={isAdmin} fallback={canUseMoneyBank ? "Accumulator" : "Restricted — admin access only"} /></small></span></div>
        <div className="xt-feature-actions">
          {!canUseMoneyBank && <span className="xt-feature-locked">RESTRICTED</span>}
          <button className="xt-guide-button" type="button" onClick={() => { setGuideMode("money-bank"); setGuidePage(0); setGuideOpen(true); }}>
            <BookOpen size={14} />Guide
          </button>
          <label className="xt-switch">
           <input
              type="checkbox"
              checked={edge2Enabled}
              onChange={(event) => toggleMoneyBank(event.target.checked)}
              aria-label="Toggle Money Bank"
               disabled={!canUseMoneyBank || !isConnected}
            />
            <span />
          </label>
        </div>
      </section>

      <section className={`xt-feature-card xt-feature-card-bulk ${!canUseBulkTrader ? "xt-feature-card-restricted" : ""}`}>
        <div><Activity size={18} /><span><b>Bulk Trader</b><small><FeatureStatusText control={featureControl("bulk-trader")} isAdmin={isAdmin} fallback={canUseBulkTrader ? "Send 1–6 contracts across four trade types" : "Restricted — admin access only"} /></small></span></div>
        <div className="xt-feature-actions">
          {!canUseBulkTrader && <span className="xt-feature-locked">RESTRICTED</span>}
          <button className="xt-guide-button" type="button" onClick={() => { setGuideMode("bulk-trader"); setGuidePage(0); setGuideOpen(true); }}>
            <BookOpen size={14} />Guide
          </button>
          <label className="xt-switch">
            <input type="checkbox" checked={bulkTraderEnabled} onChange={(event) => toggleBulkTrader(event.target.checked)} aria-label="Toggle Bulk Trader" disabled={!canUseBulkTrader || !isConnected} />
            <span />
          </label>
        </div>
      </section>

      <section className={`xt-feature-card xt-feature-card-digit-flip ${!canUseDigitFlip ? "xt-feature-card-restricted" : ""}`}>
        <div><Zap size={18} /><span><b>DigitFlip</b><small><FeatureStatusText control={featureControl("digit-flip")} isAdmin={isAdmin} fallback={canUseDigitFlip ? "Even / Odd parity trading with live estimates" : "Restricted — admin access only"} /></small></span></div>
        <div className="xt-feature-actions">
          {!canUseDigitFlip && <span className="xt-feature-locked">RESTRICTED</span>}
          <button className="xt-guide-button" type="button" onClick={() => { setGuideMode("digit-flip"); setGuidePage(0); setGuideOpen(true); }}><BookOpen size={14} />Guide</button>
          <label className="xt-switch">
            <input type="checkbox" checked={digitFlipEnabled} onChange={(event) => toggleDigitFlip(event.target.checked)} aria-label="Toggle DigitFlip" disabled={!canUseDigitFlip} />
            <span />
          </label>
        </div>
      </section>

      <section className={`xt-feature-card xt-feature-card-trade-x ${!canUseTradeX ? "xt-feature-card-restricted" : ""}`}>
        <div><Activity size={18} /><span><b>Trade X</b><small><FeatureStatusText control={featureControl("trade-x")} isAdmin={isAdmin} fallback={canUseTradeX ? "Digit Differs distribution and ranked-entry automation" : "Restricted — admin access only"} /></small></span></div>
        <div className="xt-feature-actions">
          {!canUseTradeX && <span className="xt-feature-locked">RESTRICTED</span>}
          <button className="xt-guide-button" type="button" onClick={() => { setGuideMode("trade-x"); setGuidePage(0); setGuideOpen(true); }}>
            <BookOpen size={14} />Guide
          </button>
          <label className="xt-switch">
            <input
              type="checkbox"
              checked={tradeXEnabled}
              onChange={(event) => toggleTradeX(event.target.checked)}
              aria-label="Toggle Trade X"
              disabled={!canUseTradeX}
            />
            <span />
          </label>
        </div>
      </section>

      <section className={`xt-feature-card xt-feature-card-edge ${!canUseEdge ? "xt-feature-card-restricted" : ""}`}>
        <div><Bot size={18} /><span><b>EDGE 🏔️</b><small><FeatureStatusText control={featureControl("edge")} isAdmin={isAdmin} fallback={canUseEdge ? "Over / Under digit automation" : "Restricted — admin access only"} /></small></span></div>
        <div className="xt-feature-actions">
          {!canUseEdge && <span className="xt-feature-locked">RESTRICTED</span>}
          <button className="xt-guide-button" type="button" onClick={() => { setGuideMode("edge"); setGuidePage(0); setGuideOpen(true); }}>
            <BookOpen size={14} />Guide
          </button>
          <label className="xt-switch">
            <input
              type="checkbox"
              checked={xTraderEnabled}
              onChange={(event) => toggleXTrader(event.target.checked)}
              aria-label="Toggle EDGE"
              disabled={!canUseEdge}
            />
            <span />
          </label>
        </div>
      </section>

      {bulkTraderEnabled && canUseBulkTrader && (
        <BulkTraderPanel
          symbol={bulkTraderSymbol}
          symbols={tradeXSymbols}
          marketSignals={bulkTraderMarketSignals}
          marketLabel={markets.find(([id]) => id === bulkTraderSymbol)?.[1] ?? bulkTraderSymbol}
          currency={currentAccount?.currency ?? "USD"}
          quote={status.data?.last_tick?.quote}
          lastDigit={lastDigit}
          digitHistory={analysisDigits}
          type={bulkTraderType}
          prediction={bulkTraderPrediction}
          duration={bulkTraderDuration}
          stake={bulkTraderStake}
          tradeCount={bulkTraderCount}
           analysisTickCount={analysisTickCount}
           autoSelectBest={bulkTraderAutoSelectBest}
          recentTrades={bulkRows}
          sessionRows={bulkVisibleSessionRows}
          isConnected={isConnected}
          isPlacingTrade={bulkBuyMutation.isPending}
          tradeSlotMessage={tradeSlotMessage}
          historyFading={historyFading}
          clearArmed={bulkTraderClearArmed}
           onSymbolChange={(next) => { setBulkTraderAutoSelectBest(false); setBulkTraderSymbol(next); void selectMarket(next); }}
          onTypeChange={(next) => {
            setBulkTraderType(next);
             setBulkTraderPrediction(next === "over-under" ? 5 : 0);
          }}
          onPredictionChange={setBulkTraderPrediction}
           onAutoSelectBestChange={(enabled) => {
             setBulkTraderAutoSelectBest(enabled);
             if (enabled && bulkTraderBestSymbol) {
               setBulkTraderSymbol(bulkTraderBestSymbol);
               void selectMarket(bulkTraderBestSymbol);
             }
           }}
          onDurationChange={setBulkTraderDuration}
          onStakeChange={setBulkTraderStake}
          onTradeCountChange={setBulkTraderCount}
          onTrade={(contractType, selectedBarrier) => void executeBulkTrade(contractType, selectedBarrier)}
          onAiScan={runBulkTraderAiScanner}
          onRefreshAnalysis={refreshAnalysis}
          onClearHistory={() => void clearBulkTraderHistory()}
        />
      )}

      {digitFlipEnabled && (
        <DigitFlipPanel
          enabled={digitFlipEnabled}
          marketType={digitFlipMarketType}
          symbol={digitFlipSymbol}
          symbols={tradeXSymbols}
           marketSignals={digitFlipMarketSignals}
          quote={status.data?.last_tick?.quote}
          lastDigit={lastDigit}
           evenPercentage={digitFlipEvenPercentage}
           oddPercentage={digitFlipOddPercentage}
           sampleCount={digitFlipSampleCount}
          selectedParity={digitFlipParity}
          duration={digitFlipDuration}
          stake={digitFlipStake}
          stakeMode={digitFlipStakeMode}
          multiplier={digitFlipMultiplier}
          takeProfit={digitFlipTakeProfit}
          stopLoss={digitFlipStopLoss}
          running={digitFlipRunning}
          currentStake={digitFlipCurrentStake}
            assaultEnabled={digitFlipAssault}
           magicEnabled={digitFlipMagic}
          isPlacingTrade={digitFlipBuyMutation.isPending}
          disabled={!isConnected}
          entryBlocked={tradeSlotBlocked}
          onMarketTypeChange={(next) => {
            setDigitFlipMarketType(next);
             if (next === "auto") {
               window.setTimeout(() => void chooseDigitFlipSetup(false), 0);
             } else {
               const nextSymbol = tradeXSymbols.find((option) => option.marketType === next)?.value;
               if (nextSymbol) {
                 setDigitFlipSymbol(nextSymbol);
                 void selectMarket(nextSymbol);
               }
             }
          }}
          onSymbolChange={(next) => { setDigitFlipSymbol(next); void selectMarket(next); }}
          onParityChange={setDigitFlipParity}
          onDurationChange={setDigitFlipDuration}
          onStakeChange={setDigitFlipStake}
          onStakeModeChange={setDigitFlipStakeMode}
          onMultiplierChange={setDigitFlipMultiplier}
          onTakeProfitChange={setDigitFlipTakeProfit}
          onStopLossChange={setDigitFlipStopLoss}
          onRunStop={toggleDigitFlipRun}
          onAiScan={runDigitFlipAiScanner}
          onReset={resetDigitFlip}
           onRefreshSample={refreshDigitFlipSample}
           onAssaultChange={toggleDigitFlipAssault}
           onMagicChange={toggleDigitFlipMagic}
        />
      )}

      {canUseDigitFlip && canViewHistory && (digitFlipEnabled || digitFlipClaimedHistoryIdsRef.current.size > 0) && (
        <section className="xt-bottom-feature">
          <DerivHistory
            className="digit-flip-history"
            title="DigitFlip History"
            strategy="DigitFlip Strategy"
            rows={digitFlipRows}
            sessionRows={digitFlipVisibleSessionRows}
            currency={currentAccount?.currency}
            clearArmed={digitFlipClearArmed}
            fading={historyFading}
            onClear={clearDigitFlipHistory}
          />
        </section>
      )}

      {xTraderEnabled && (
        <EdgeReferencePanel
          isConnected={isConnected}
          running={running}
          sniperOverUnder={edgeSniperOverUnder}
          onSniperOverUnderChange={setEdgeSniperOverUnder}
          symbol={symbol}
          markets={markets}
          onSymbolChange={(next) => void selectMarket(next)}
          currentAccount={currentAccount}
          direction={direction}
          onDirectionChange={setDirection}
          barrier={barrier}
          onBarrierChange={setBarrier}
          duration={duration}
          onDurationChange={selectDuration}
          stake={stake}
          onStakeChange={setStake}
          strategy={strategy}
          onStrategyChange={setStrategy}
          martingale={martingale}
          onMartingaleChange={setMartingale}
          takeProfit={takeProfit}
          onTakeProfitChange={setTakeProfit}
          stopLoss={stopLoss}
          onStopLossChange={setStopLoss}
          edgeRecommendation={edgeRecommendation}
          marketSignals={(status.data?.market_signals ?? []) as MarketSignal[]}
          analysis={analysis}
          lastDigit={lastDigit}
          quote={status.data?.last_tick?.quote}
          payoutPercent={status.data?.last_proposal && status.data.last_proposal.ask_price > 0
            ? (status.data.last_proposal.payout / status.data.last_proposal.ask_price) * 100
            : null}
          nextStake={nextStake}
          sessionPnl={sessionPnl}
          sessionTrades={sessionTrades}
          onAiScan={runEdgeAiScanner}
          canTrade={canTrade}
          onStart={start}
          onStop={stop}
          onReset={reset}
          canViewHistory={canViewHistory}
          recentTrades={edgeRows}
          sessionRows={edgeSessionRows}
          historyFading={historyFading}
          clearTradesArmed={clearHistoryArmed}
          onClearHistory={clearHistory}
        />
      )}

      {xTraderEnabled && (
        <>
          <section className="xt-cockpit edge-legacy-hidden">
            <div className="xt-cockpit-head">
              <div><Activity size={18} /><span><b>EDGE Cockpit</b><small>Live tick analysis · historical streaks do not guarantee outcomes</small></span></div>
              <em className={running ? "running" : ""}><i />{activityText}</em>
            </div>

             <div className="xt-market-row market-only">
              <label><small>MARKET</small><select value={symbol} onChange={(event) => void selectMarket(event.target.value)} disabled={!isConnected || running}>{markets.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            </div>

             <section className="xt-analysis-panel" aria-live="polite">
               <div className="xt-analysis-header">
                 <div className="xt-analysis-title"><Activity size={16} /><span><b>LIVE ANALYSIS · {analysisTickCount}T</b><small>{analysisTickCount ? "Live market digits" : "Waiting for the next live tick"}</small></span></div>
                 <div className="xt-analysis-actions">
                   <button type="button" className="xt-analysis-refresh" onClick={refreshAnalysis} disabled={!isConnected} title="Restart live analysis count"><RefreshCw size={14} /></button>
                 </div>
               </div>
               <div className="xt-analysis-track" aria-label={`Live analysis: ${analysis.overPercent.toFixed(1)} percent over and ${analysis.underPercent.toFixed(1)} percent under`}>
                 <span className="over" style={{ width: `${analysis.overPercent}%` }} />
                 <span className="under" style={{ width: `${analysis.underPercent}%` }} />
               </div>
               <div className="xt-analysis-chart" aria-label="Live digit distribution">
                 {analysis.counts.map((count, digit) => {
                   const tone = digit === barrier ? "selected" : digit > barrier ? "over" : "under";
                   const height = count ? Math.max(18, (count / analysis.maxCount) * 100) : 10;
                   return <div className={`xt-analysis-column ${tone}`} key={digit}><small>{count}</small><span style={{ height: `${height}%` }} /><b>{digit}</b></div>;
                 })}
               </div>
               <div className="xt-analysis-trail" aria-label="Recent live digits">
                 {analysisDigits.slice(-20).map((digit, index) => <span className={digit === barrier ? "selected" : digit > barrier ? "over" : "under"} key={`${digit}-${index}`}>{digit}</span>)}
                 {!analysisDigits.length && <small>New ticks will appear here after the market connects.</small>}
               </div>
                <p className="xt-analysis-note">Green marks digits above the selected barrier, red marks digits below it, and yellow marks the selected barrier. Percentages describe this sample; they are not guaranteed outcomes.</p>
             </section>

            <div className="xt-direction">
              <button className={direction === "DIGITOVER" ? "active over" : ""} onClick={() => setDirection("DIGITOVER")} disabled={running}><b>OVER</b></button>
              <button className={direction === "DIGITUNDER" ? "active under" : ""} onClick={() => setDirection("DIGITUNDER")} disabled={running}><b>UNDER</b></button>
            </div>

            <div className="xt-form-grid">
               <label><small>DURATION</small><div className="xt-ticks">{[1,2,3,4,5].map((tick) => <button key={tick} className={duration === tick ? "active" : ""} onClick={() => selectDuration(tick)} disabled={running}>{tick}</button>)}</div></label>
               <label><small>STAKE · MIN 0.35</small><div className="xt-money"><span>{currentAccount?.currency ?? "USD"}</span><input type="number" min=".35" step=".01" value={stake} onChange={(event) => setStake(Math.max(.35, Number(event.target.value) || .35))} disabled={running} /></div></label>
              <label><small>STRATEGY</small><select value={strategy} onChange={(event) => setStrategy(event.target.value as "flat" | "martingale")} disabled={running}><option value="flat">Flat stake</option><option value="martingale">Martingale after loss</option></select></label>
              <label><small>MARTINGALE MULTIPLIER</small><input type="number" min="1" max="10" step=".1" value={martingale} onChange={(event) => setMartingale(Number(event.target.value))} disabled={running || strategy === "flat"} /></label>
              <label><small>TAKE PROFIT</small><input type="number" min=".01" step=".01" value={takeProfit} onChange={(event) => setTakeProfit(Number(event.target.value))} disabled={running} /></label>
              <label><small>STOP LOSS</small><input type="number" min=".01" step=".01" value={stopLoss} onChange={(event) => setStopLoss(Number(event.target.value))} disabled={running} /></label>
                 <label><small>MIN OBSERVED SIDE SHARE · {edgeMinWinRate}%</small><input type="range" min="90" max="99" step="1" value={edgeMinWinRate} onChange={(event) => setEdgeMinWinRate(Number(event.target.value))} disabled={running} /></label>
              <label className="xt-auto-row"><span><small>AUTO BEST DIGIT</small></span><span className="xt-switch"><input type="checkbox" checked={autoSwitch} onChange={(event) => toggleAutoBestDigit(event.target.checked)} disabled={!isConnected} /><span /></span></label>
               <label className="xt-auto-row"><span><small>PERCENTAGE SCAN · {EDGE_PERCENTAGE_SCAN_FLOOR}% FLOOR</small><b>Scan every market and gate Over, Under, or Dual by observed outcomes</b></span><span className="xt-switch"><input type="checkbox" checked={edgePercentageMode} onChange={(event) => toggleEdgePercentageMode(event.target.checked)} disabled={!isConnected} /><span /></span></label>
               {edgePercentageMode && <div className={`xt-percentage-recommendation ${edgeRecommendation ? "ready" : "waiting"}`}>
                 <span><small>LIVE RECOMMENDATION</small><b>{edgeRecommendation ? `${edgeRecommendation.direction === "DUAL" ? "DUAL" : edgeRecommendation.direction === "DIGITOVER" ? "OVER" : "UNDER"} ${edgeRecommendation.digit} · ${edgeRecommendation.symbol}` : "WAITING FOR ENOUGH OBSERVED OUTCOMES"}</b></span>
                 <strong>{edgeRecommendation ? `${edgeRecommendation.score.toFixed(1)}% observed` : "No trade sent"}</strong>
               </div>}
               <label className="xt-chosen-digit"><small>CHOSEN DIGIT</small><div className="xt-digit-picker">{Array.from({ length: 10 }, (_, digit) => digit).map((digit) => <button type="button" key={digit} className={barrier === digit ? "active" : ""} onClick={() => setBarrier(digit)} disabled={running}>{digit}</button>)}</div><b>Trade {direction === "DIGITOVER" ? "Over" : "Under"} the selected digit</b></label>
            </div>

            <div className="xt-session">
              <div><small>SESSION P/L</small><strong className={sessionPnl < 0 ? "loss" : ""}>{sessionPnl >= 0 ? "+" : ""}{sessionPnl.toFixed(2)}</strong></div>
              <div><small>TRADES SENT</small><strong>{sessionTrades}</strong></div>
               <div><small>CONFIGURATION</small><strong>{direction === "DIGITOVER" ? "OVER" : "UNDER"} {entryDigit} · {duration}T</strong></div>
            </div>

            <div className="xt-controls">
               {running && <button className="stop" onClick={stop}><Pause size={18} fill="currentColor" />STOP</button>}
              <button className="reset" onClick={reset}><RotateCcw size={18} />RESET</button>
            </div>
             <div className="xt-bulk-controls">
              <button className="xt-bulk-over" onClick={() => void fireTrade("DIGITOVER")} disabled={!canTrade}>
                 <span><Play size={14} fill="currentColor" />OVER {entryDigit}</span>
                <small>Send one trade</small>
              </button>
               <button className="xt-bulk-dual" onClick={() => void fireDualTrade()} disabled={!canTrade}>
                  <span><Play size={14} fill="currentColor" />DUAL {entryDigit}</span>
                 <small>Send Over + Under</small>
               </button>
              <button className="xt-bulk-under" onClick={() => void fireTrade("DIGITUNDER")} disabled={!canTrade}>
                 <span><Play size={14} fill="currentColor" />UNDER {entryDigit}</span>
                <small>Send one trade</small>
              </button>
            </div>
            {strategy === "martingale" && <p className="xt-streak-note">Next stake after settlement: <b>{nextStake.toFixed(2)} {currentAccount?.currency ?? "USD"}</b>. Every loss multiplies the next stake; any profit resets it to normal.</p>}
          </section>

        </>
      )}

      {tradeXEnabled && (
        <section className="xt-bottom-feature">
          <TradeXPanel
            enabled={tradeXEnabled}
            marketType={tradeXMarketType}
            symbol={tradeXSymbol}
            tradeType="DIGITDIFF"
            stake={tradeXStake}
            selectedDigit={tradeXEntryDigit}
            duration={tradeXDuration}
            manualSelectMode={tradeXManualSelect}
            distribution={tradeXDistribution}
            rankedSafestDigits={tradeXRankedDigits}
            symbols={tradeXSymbols}
            analysisTickCount={analysisTickCount}
            analysisUpdatedAt={lastDigit == null ? "waiting for live ticks" : `last digit ${lastDigit}`}
            lastDigit={lastDigit}
            isPlacingTrade={tradeXSubmitting || bulkBuyMutation.isPending}
            isRefreshingAnalysis={analysisTickCount === 0 && !isConnected}
            disabled={running || !isConnected || tradeSlotBlocked}
            onMarketTypeChange={setTradeXMarketType}
            onSymbolChange={(next) => { setTradeXSymbol(next); void selectMarket(next); }}
            onTradeTypeChange={() => undefined}
            onStakeChange={(next) => setTradeXStake(Math.max(0.35, Number.isFinite(next) ? next : 0.35))}
             onSelectedDigitChange={(digit) => {
               setTradeXSelectedDigit(digit);
               setTradeXManualSelect(true);
             }}
            onDurationChange={setTradeXDuration}
            onManualSelectModeChange={setTradeXManualSelect}
             onTradeSelect={(digit) => {
               setTradeXSelectedDigit(digit);
               setTradeXManualSelect(true);
               void executeTradeX(1, tradeXDuration, digit);
             }}
            onPlaceTrade={() => void executeTradeX(1)}
            onAiScan={runTradeXAiScanner}
            onRefreshAnalysis={refreshAnalysis}
          />
          {tradeXMessage && <p className="tx-parent-message" role="status">{tradeXMessage}</p>}
          {canViewHistory && <DerivHistory title="Trade X History" strategy="Trade X Strategy" rows={tradeXRows} sessionRows={tradeXVisibleSessionRows} currency={currentAccount?.currency} clearArmed={tradeXHistoryClearArmed} fading={historyFading} onClear={clearTradeXHistory} />}
        </section>
      )}

       {edge2Enabled && canUseMoneyBank && (
        <MoneyBankPanel
          isConnected={isConnected}
          tradeSlotBlocked={tradeSlotBlocked}
          running={moneyBankRunning}
          closing={moneyBankClosing}
          symbol={moneyBankSymbol}
          markets={moneyBankMarkets}
          onSymbolChange={(next) => {
            setMoneyBankSymbol(next);
            void selectMarket(next);
          }}
          accountBalance={currentAccountBalance}
          currency={currentAccount?.currency ?? "USD"}
          quote={status.data?.last_tick?.quote}
          growthRate={moneyBankGrowthRate}
          onGrowthRateChange={setMoneyBankGrowthRate}
          takeProfitTicks={moneyBankTakeProfitTicks}
          onTakeProfitTicksChange={setMoneyBankTakeProfitTicks}
          autoKnockout={moneyBankAutoKnockout}
          autoKnockoutCountdown={moneyBankAutoKnockoutCountdown}
          onAutoKnockoutChange={setMoneyBankAutoKnockout}
          strategy={moneyBankStrategy}
          onStrategyChange={setMoneyBankStrategy}
          budget={moneyBankBudget}
          onBudgetChange={setMoneyBankBudget}
          manualBase={moneyBankManualBase}
          onManualBaseChange={setMoneyBankManualBase}
          reinvestProfit={moneyBankReinvestProfit}
          onReinvestProfitChange={setMoneyBankReinvestProfit}
          reinvestPercent={moneyBankReinvestPercent}
          onReinvestPercentChange={setMoneyBankReinvestPercent}
          profitTarget={moneyBankProfitTarget}
          onProfitTargetChange={setMoneyBankProfitTarget}
          lossLimit={moneyBankLossLimit}
          onLossLimitChange={setMoneyBankLossLimit}
          recentTrades={moneyBankRows}
          sessionRows={moneyBankSessionRows}
          lastSettledProfit={moneyBankLastSettledProfit}
          onStart={(config) => void startMoneyBank(config)}
          onStop={stopMoneyBank}
        />
      )}

      {cashGrabEnabled && canUseCashGrab && (
        <CashGrabPanel
          direction={cashGrabDirection}
          tradeSlotBlocked={tradeSlotBlocked}
          symbol={cashGrabSymbol}
          bestSymbol={cashGrabBestSymbol}
          autoSelectBest={cashGrabAutoSelectBest}
          symbols={cashGrabSymbols}
          marketSignals={cashGrabMarketSignals}
          quote={status.data?.last_tick?.symbol === cashGrabSymbol ? status.data?.last_tick?.quote ?? null : null}
          stake={cashGrabStake}
          duration={cashGrabDuration}
          stakeMode={cashGrabStakeMode}
          currency={currentAccount?.currency ?? "USD"}
          multiplier={cashGrabMultiplier}
          takeProfit={cashGrabTakeProfit}
          lossLimit={cashGrabLossLimit}
          sessionPnl={cashGrabHistorySessionPnl}
          autoSwitchSafestPair={cashGrabAutoSwitchSafestPair}
          autoDirection={cashGrabAutoDirection}
          autoSwitchSafestPairStatus={cashGrabAutoSwitchSafestPairStatus}
          autoSwitchSafestPairRecommendation={cashGrabAutoSwitchRecommendation}
          running={cashGrabRunning}
          stopping={cashGrabStopping}
          isConnected={isConnected}
          isPlacingTrade={bulkBuyMutation.isPending}
          recentTrades={cashGrabRows}
          sessionRows={cashGrabVisibleSessionRows}
          clearArmed={cashGrabClearArmed}
          historyFading={historyFading}
          onDirectionChange={setCashGrabDirection}
          onSymbolChange={(next) => { setCashGrabSymbol(next); void selectMarket(next); }}
          onAutoDirectionChange={(enabled) => {
            setCashGrabAutoDirection(enabled);
            const currentConfig = cashGrabConfigRef.current;
            if (currentConfig) cashGrabConfigRef.current = { ...currentConfig, autoDirection: enabled };
          }}
          onAutoSelectBestChange={(enabled) => {
            setCashGrabAutoSelectBest(enabled);
            if (enabled && cashGrabBestSymbol) {
              setCashGrabSymbol(cashGrabBestSymbol);
              void selectMarket(cashGrabBestSymbol);
            }
          }}
          onStakeChange={setCashGrabStake}
          onDurationChange={setCashGrabDuration}
          onStakeModeChange={setCashGrabStakeMode}
          onMultiplierChange={setCashGrabMultiplier}
          onTakeProfitChange={setCashGrabTakeProfit}
          onLossLimitChange={setCashGrabLossLimit}
          onAutoSwitchSafestPairChange={(enabled) => {
            const currentConfig = cashGrabConfigRef.current;
            setCashGrabAutoSwitchSafestPair(enabled);
            if (enabled) setCashGrabAutoSelectBest(false);
            if (!enabled) {
              cashGrabAutoSwitchNextAtRef.current = null;
              cashGrabAutoSwitchRecommendationRef.current = null;
              setCashGrabAutoSwitchRecommendation(null);
              setCashGrabAutoSwitchSafestPairStatus("off");
              if (currentConfig) cashGrabConfigRef.current = { ...currentConfig, autoSwitchSafestPair: false };
              stopCashGrab();
              setCashGrabAutoSwitchSafestPairStatus("off");
              return;
            }
            cashGrabAutoSwitchRecommendationRef.current = null;
            setCashGrabAutoSwitchRecommendation(null);
            const nextConfig = currentConfig
              ? {
                ...currentConfig,
                autoSwitchSafestPair: true,
                autoSelectBest: false,
              }
              : null;
            setCashGrabAutoSwitchSafestPairStatus("watching");
            cashGrabAutoSwitchNextAtRef.current = 0;
            if (nextConfig) {
              cashGrabConfigRef.current = nextConfig;
              if (!cashGrabRunning) void startCashGrab(nextConfig);
            }
          }}
          onAiScan={runCashGrabAiScanner}
          onMoneyStart={(config) => void startCashGrab(config)}
          onMoneyStop={stopCashGrab}
          onClearHistory={() => void clearCashGrabHistory()}
        />
      )}

      {matchesAnalysisEnabled && canUseMatchesAnalysis && (
        <section className="xt-bottom-feature">
          <MatchesAnalysisPanel
            marketType={matchesMarketType}
            markets={matchesMarkets}
            symbol={matchesSymbol}
            onMarketTypeChange={setMatchesMarketType}
            onSymbolChange={changeMatchesSymbol}
            digitHistory={matchesObservedDigits}
            tickCount={matchesTickCount}
            topDigits={matchesTopDigits}
            selectedDigit={matchesSelectedDigit}
            onSelectedDigitChange={setMatchesSelectedDigit}
            duration={matchesDuration}
            onDurationChange={setMatchesDuration}
            stake={matchesStake}
            onStakeChange={setMatchesStake}
            aiEnabled={matchesAiEnabled}
            onAiEnabledChange={toggleMatchesAi}
            aiDigits={matchesAiDigits}
            onAiDigitsChange={setMatchesAiDigits}
            isRunning={matchesAiEnabled}
            isPlacing={matchesBuyMutation.isPending}
            disabled={!isConnected || !currentAccount || !canUseMatchesAnalysis}
            tradeSlotBlocked={tradeSlotBlocked}
            statusMessage={matchesStatusMessage}
            onManualTrade={() => {
              toggleMatchesAi(false);
              void executeMatchesOrders([matchesSelectedDigit], false);
            }}
            onTradeDigit={(digit) => {
              toggleMatchesAi(false);
              void executeMatchesOrders([digit], false);
            }}
            onStartMatches={() => toggleMatchesAi(true)}
            onStopMatches={() => toggleMatchesAi(false)}
            onRescan={() => {
              resetMatchesSample();
              setMatchesStatusMessage("Rescan started. Waiting for fresh ticks.");
            }}
            onOpenGuide={() => {
              setGuideMode("matches-analysis");
              setGuidePage(0);
              setGuideOpen(true);
            }}
          />
        </section>
      )}

      {canUseMatchesAnalysis && canViewHistory && !clockWorkEnabled && (matchesAnalysisEnabled || matchesClaimedHistoryIdsRef.current.size > 0) && (
        <section className="xt-bottom-feature">
          <DerivHistory
            title="Matches Analysis History"
            strategy="Matches Tool"
            rows={matchesRows}
            sessionRows={matchesVisibleSessionRows}
            currency={currentAccount?.currency}
            clearArmed={matchesHistoryClearArmed}
            fading={historyFading}
            onClear={clearMatchesHistory}
          />
        </section>
      )}

      {clockWorkEnabled && canUseClockWork && (
        <section className="xt-bottom-feature">
          <ClockWorkPanel
            enabled={clockWorkEnabled}
            symbol={clockWorkSymbol}
            markets={clockWorkSymbols}
            duration={5}
            onSymbolChange={(next) => {
              clockWorkMarketResetEpochRef.current = Math.floor(Date.now() / 1000);
              setClockWorkQuoteBuffer({ symbol: next, quotes: [], lastTickId: null });
              setClockWorkBarrierAnchor(null);
              setClockWorkAggressiveRounds(0);
              clockWorkAutoAttemptAtRef.current = 0;
              setClockWorkSymbol(next);
              setClockWorkAutoEnabled(false);
              setClockWorkAggressiveEnabled(false);
              setClockWorkAutoStatus("Automation stopped because the selected market changed.");
              void selectMarket(next);
            }}
            quote={clockWorkCurrentQuote}
            quoteHistory={clockWorkQuoteHistory}
            quoteUpdatedAt={clockWorkQuoteUpdatedAt}
            tradeSlotBlocked={tradeSlotBlocked}
            barrierMode={clockWorkBarrierMode}
            onBarrierModeChange={setClockWorkBarrierMode}
            halfBarrier={clockWorkHalfBarrier}
            onHalfBarrierChange={setClockWorkHalfBarrier}
            higherBarrierLabel="↑ Higher barrier"
            lowerBarrierLabel="↓ Lower barrier"
            higherBarrierOffset={clockWorkHigherBarrier}
            lowerBarrierOffset={clockWorkLowerBarrier}
            barrierAnchor={clockWorkBarrierAnchor}
            onResetBarrierAnchor={() => setClockWorkBarrierAnchor(clockWorkCurrentQuote)}
            higherBarrierOptions={clockWorkBarrierOptions("higher")}
            lowerBarrierOptions={clockWorkBarrierOptions("lower")}
            onHigherBarrierChange={setClockWorkHigherBarrier}
            onLowerBarrierChange={setClockWorkLowerBarrier}
            higherStake={clockWorkHigherStake}
            lowerStake={clockWorkLowerStake}
            h1Stake={clockWorkH1Stake}
            l1Stake={clockWorkL1Stake}
            l2Stake={clockWorkL2Stake}
            h2Stake={clockWorkH2Stake}
            onHigherStakeChange={(value) => setClockWorkHigherStake(Math.max(1, value))}
            onLowerStakeChange={(value) => setClockWorkLowerStake(Math.max(1, value))}
            onH1StakeChange={(value) => setClockWorkH1Stake(Math.max(1, value))}
            onL1StakeChange={(value) => setClockWorkL1Stake(Math.max(1, value))}
            onL2StakeChange={(value) => setClockWorkL2Stake(Math.max(1, value))}
            onH2StakeChange={(value) => setClockWorkH2Stake(Math.max(1, value))}
            higherPercent={clockWorkObservedTicks.higherPercent}
            lowerPercent={clockWorkObservedTicks.lowerPercent}
            higherTicks={clockWorkObservedTicks.higherCount}
            lowerTicks={clockWorkObservedTicks.lowerCount}
            recentMoves={clockWorkRecentMoves}
            prediction={clockWorkRates.prediction}
            leanStrength={clockWorkRates.leanStrength}
            busy={clockWorkBusy || clockWorkBuyMutation.isPending}
            disabled={clockWorkControlsDisabled}
            statusMessage={clockWorkStatusMessage}
            higherQuote={clockWorkQuotes.pair.higher}
            lowerQuote={clockWorkQuotes.pair.lower}
            allFourQuote={clockWorkQuotes.allFour}
            onPlaceHigher={() => void executeClockWorkBatch([makeClockWorkOrder("higher", "HIGHER", clockWorkHigherStake)])}
            onPlaceLower={() => void executeClockWorkBatch([makeClockWorkOrder("lower", "LOWER", clockWorkLowerStake)])}
            onPlacePair={() => void executeClockWorkBatch([...clockWorkPairOrders])}
            onPlaceAllFour={() => void executeClockWorkBatch([...clockWorkFourOrders])}
            autoMode={clockWorkAutoMode}
            onAutoModeChange={setClockWorkAutoMode}
            minLean={clockWorkMinLean}
            onMinLeanChange={(value) => {
              setClockWorkMinLean(value);
              if (value == null) {
                setClockWorkAutoEnabled(false);
                if (!clockWorkAggressiveEnabled) {
                  setClockWorkAutoStatus("Choose a minimum lean to resume Auto Trading.");
                }
              }
            }}
            autoEnabled={clockWorkAutoEnabled}
            onAutoEnabledChange={(enabled) => {
              if (enabled && (!clockWorkAutoMode || clockWorkMinLean == null)) {
                setClockWorkStatusMessage("Select H&L (2), A, or All (4), then choose a minimum lean before starting Auto Trading.");
                return;
              }
              setClockWorkAutoEnabled(enabled);
              if (enabled) {
                setClockWorkAggressiveEnabled(false);
                setClockWorkAutoStatus("Auto Trading is active and waiting for the selected lean.");
              } else {
                setClockWorkAutoStatus("Auto Trading is stopped. Open contracts can continue to settle.");
              }
            }}
            aggressiveEnabled={clockWorkAggressiveEnabled}
            onAggressiveEnabledChange={(enabled) => {
              if (enabled && !clockWorkAutoMode) {
                setClockWorkStatusMessage("Select an automatic mode before starting Aggressive Auto Trading.");
                return;
              }
              setClockWorkAggressiveEnabled(enabled);
              if (enabled) {
                setClockWorkAggressiveRounds(0);
                setClockWorkAutoEnabled(false);
                setClockWorkAutoStatus(`Waiting for a 5-tick directional push and at least ${CLOCK_WORK_AGGRESSIVE_MIN_WIN_RATE}% observed win rate.`);
              } else {
                setClockWorkAutoStatus("Aggressive Auto Trading is stopped. Open contracts can continue to settle.");
              }
            }}
            aggressiveBalancePercent={clockWorkAggressivePercent}
            aggressiveMinWinRate={CLOCK_WORK_AGGRESSIVE_MIN_WIN_RATE}
            onAggressiveBalancePercentChange={setClockWorkAggressivePercent}
            aggressivePushProgress={clockWorkPushProgress.consecutiveTicks}
            aggressiveRounds={clockWorkAggressiveRounds}
            aggressiveStakeLabel={clockWorkAggressiveStakeLabel}
            accountBalance={currentAccountBalance ?? null}
            currency={currentAccount?.currency ?? "USD"}
            aggressiveUsingBalance={clockWorkAggressiveUsingBalance}
            aggressiveEachSide={clockWorkAggressiveEachSide}
            autoStatus={clockWorkAutoStatus}
          />
          {canViewHistory && (
            <DerivHistory
              title="Clock Work History"
              strategy="Hybrid Analysis"
              rows={clockWorkRows}
              sessionRows={clockWorkRows}
              currency={currentAccount?.currency}
              clearArmed={clockWorkHistoryClearArmed}
              fading={historyFading}
              onClear={clearClockWorkHistory}
            />
          )}
        </section>
      )}

      {guideOpen && (
        <div className="xt-guide-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGuideOpen(false); }}>
          <section className="xt-guide" role="dialog" aria-modal="true" aria-labelledby="xt-guide-title">
            <header className="xt-guide-header">
              <div><BookOpen size={18} /><span><b>{guideMode === "trade-x" ? "Trade X Guide" : guideMode === "digit-flip" ? "DigitFlip Guide" : guideMode === "bulk-trader" ? "Bulk Trader Guide" : guideMode === "money-bank" ? "Money Bank Guide" : guideMode === "cash-grab" ? "Cash Grab Guide" : guideMode === "matches-analysis" ? "Matches Analysis Guide" : guideMode === "clock-work" ? "Clock Work Guide" : "EDGE Guide"}</b><small>Page {guidePage + 1} of {activeGuidePages.length}</small></span></div>
              <button type="button" aria-label="Close guide" onClick={() => setGuideOpen(false)}><X size={17} /></button>
            </header>
            <div className="xt-guide-progress"><span style={{ width: `${((guidePage + 1) / activeGuidePages.length) * 100}%` }} /></div>
            <article className="xt-guide-page">
               <small className="xt-guide-kicker">{guideMode === "trade-x" ? "TRADE X FIELD GUIDE" : guideMode === "digit-flip" ? "DIGITFLIP FIELD GUIDE" : guideMode === "bulk-trader" ? "BULK TRADER FIELD GUIDE" : guideMode === "money-bank" ? "MONEY BANK FIELD GUIDE" : guideMode === "cash-grab" ? "CASH GRAB FIELD GUIDE" : guideMode === "matches-analysis" ? "MATCHES ANALYSIS FIELD GUIDE" : guideMode === "clock-work" ? "CLOCK WORK FIELD GUIDE" : "EDGE FIELD GUIDE"}</small>
              <h2 id="xt-guide-title">{activeGuidePages[guidePage].title}</h2>
              <p>{activeGuidePages[guidePage].body}</p>
              <ul>{activeGuidePages[guidePage].points.map((point) => <li key={point}>{point}</li>)}</ul>
            </article>
            <footer className="xt-guide-footer">
              <button type="button" className="xt-guide-nav" onClick={() => setGuidePage((page) => Math.max(0, page - 1))} disabled={guidePage === 0}><ChevronLeft size={15} />Back</button>
              <span>{guidePage + 1} / {activeGuidePages.length}</span>
              {guidePage === activeGuidePages.length - 1 ? (
                <button type="button" className="xt-guide-start" onClick={() => {
                  setGuideOpen(false);
                  if (!canUseGuideFeature) return;
                  guideMode === "trade-x" ? toggleTradeX(true) : guideMode === "digit-flip" ? toggleDigitFlip(true) : guideMode === "bulk-trader" ? toggleBulkTrader(true) : guideMode === "money-bank" ? toggleMoneyBank(true) : guideMode === "cash-grab" ? toggleCashGrab(true) : guideMode === "matches-analysis" ? toggleMatchesAnalysis(true) : guideMode === "clock-work" ? toggleClockWork(true) : toggleXTrader(true);
                }}>{canUseGuideFeature ? "Let's start trading" : "Close guide"}</button>
              ) : (
                <button type="button" className="xt-guide-nav next" onClick={() => setGuidePage((page) => Math.min(activeGuidePages.length - 1, page + 1))}>Next<ChevronRight size={15} /></button>
              )}
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}