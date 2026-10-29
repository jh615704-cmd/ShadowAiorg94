import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAccessSessionQueryKey,
  getGetAdminFeatureSettingsQueryKey,
  getUserFacingErrorMessage,
  ApiTransportError,
  type ClockWorkContractOrder,
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
import { GlobalFeatureAnnouncement } from "@/components/layout/global-feature-announcement";
import { NotificationCenter } from "@/components/notification-center";
import { useAccessSessionLogout } from "@/hooks/use-access-session-logout";
import { useAccountNotifications } from "@/hooks/use-account-notifications";
import {
  Activity, BookOpen, Bot, ChevronDown, ChevronLeft, ChevronRight, Gauge, Loader2, LockKeyhole,
  Clock3, LogOut, Pause, Play, Power, RefreshCw, RotateCcw, Settings, ShieldAlert, ShieldCheck, X, Zap,
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
  isConfirmedNoContractRejection,
  roundTradeStakeToCents,
} from "../lib/trade-entry-guards";
import {
  AI_SCANNER_MIN_SAMPLE,
  chooseBulkScannerCandidate,
  chooseCashGrabScannerCandidate,
  chooseCashGrabDirectionalMarket,
  chooseDigitFlipScannerCandidate,
  chooseTradeXScannerCandidate,
  digitDiffersRateFromPercentages,
  isValidObservedPercentage,
  isValidDigitFlipParityRates,
  type AiScannerMarketSignal,
} from "../lib/ai-market-scanner";
import { unprocessedDigitFlipSettlements } from "../lib/digit-flip-logic";
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
import {
  checkMoneyBankJdySignal,
  getMoneyBankSessionStopReason,
  getMoneyBankStartConfigError,
} from "../lib/money-bank-entry-guards";
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
import DerivHistory from "../components/deriv-history";
import { getAccountBalance } from "../lib/account-balance";
import {
  readMoneyBankHistoryClaims,
  saveMoneyBankHistoryClaims,
} from "../lib/money-bank-history-claims";
import {
  appendClockWorkQuote,
  chooseClockWorkAiCandidate,
  CLOCK_WORK_AI_DURATION_TICKS,
  CLOCK_WORK_AI_MIN_SAMPLE_COUNT,
  CLOCK_WORK_AI_MIN_WIN_RATE,
  type ClockWorkQuoteBuffer,
} from "../lib/clock-work-logic";
import { buildCashGrabBulkBuyPayload } from "../lib/cash-grab-order";
import { getCashGrabLimitReached } from "../lib/cash-grab-limits";
import { getCashGrabSessionSettlements } from "../lib/cash-grab-session";
import {
  getCashGrabEntryBlockReason,
  getCashGrabStartConfigError,
} from "../lib/cash-grab-entry-guards";
import { readCachedHistorySnapshot } from "../lib/history-snapshot";
import {
  claimDerivHistoryFeatureContractIds,
  isDerivHistoryOpen,
  removeSettledHistoryAcknowledgements,
  shouldShowFeatureHistoryWhenStopped,
  type DerivHistoryFeature,
} from "../lib/deriv-history";
import {
  acquireTradeXActionLock,
  buildTradeXOrderData,
  releaseTradeXActionLock,
} from "../lib/trade-x-execution";
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

const realizedProfit = (trades: readonly { status: string; profit: number }[]) =>
  trades.reduce((sum, trade) => sum + (isDerivHistoryOpen(trade.status) ? 0 : trade.profit), 0);

const getMoneyBankHistoryStorage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

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
  { title: "Welcome to Clock Work", body: "Ai Clock chooses a Higher or Lower contract and its barrier from recent market outcomes. It only sends one entry when its historical signal qualifies; past outcomes do not guarantee future results.", points: ["Use a demo account while learning.", "Only one trading feature can be active at a time.", "The selected Deriv account receives any accepted order."] },
  { title: "Connect and choose an account", body: "Connect Deriv and confirm which account is selected before enabling Clock Work. Real-account orders remain subject to the workspace's live-trading and balance checks.", points: ["A disconnected account blocks new entries.", "Open contracts must settle before Ai Clock can enter again.", "Use demo mode to learn the controls."] },
  { title: "Choose a market and stake", body: "Select the market and one stake per entry. Clock Work uses a fixed five-tick contract duration; Ai Clock selects the contract direction and barrier.", points: ["Changing markets clears the local sample and waits for fresh ticks.", "The stake must be at least 1.00 and fit the selected account balance.", "No trade is sent while data or account checks are unavailable."] },
  { title: "Enable and start Ai Clock", body: "Turn on the Ai Clock switch to arm the automation, then press Start Clock Work. Ai Clock reviews recent five-tick outcomes and waits until the required history and signal checks are met.", points: ["The switch alone does not start trading.", "No qualifying setup means no order.", "An open or unsettled contract pauses the next entry."] },
  { title: "Stop and review history", body: "Stop Clock Work to prevent new entries. An order already accepted by Deriv is not canceled by Stop and must settle through Deriv.", points: ["Clock Work History shows entries and their reported results.", "Clearing history hides local rows only; it does not delete Deriv's account history.", "Check Deriv history before restarting after an uncertain order."] },
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
  { title: "Welcome to Cash Grab Rise/Fall", body: "Cash Grab is a Rise/Fall workspace. It shows the selected market, direction, stake, duration, and trade history.", points: ["Start with a demo account.", "Use the guide before risking live funds."] },
  { title: "Connect Deriv", body: "Connect your Deriv account with a Personal Access Token that has the permissions needed to read markets and trade.", points: ["Keep your token private.", "Check the active account and currency.", "Demo funds are the safest place to learn."] },
  { title: "Choose an account", body: "The account selector shows the account Cash Grab will use and its latest available balance.", points: ["Review the account before every session.", "Selecting a real account routes contracts to it when server live trading is enabled."] },
  { title: "Rise and Fall contracts", body: "Rise and Fall are directional contracts sent to Deriv as CALL and PUT. Cash Grab only offers these two contract types.", points: ["Rise uses CALL.", "Fall uses PUT.", "The contract result is decided by Deriv at expiry."] },
  { title: "What Rise means", body: "A Rise contract compares the exit quote with the entry quote according to the selected contract duration.", points: ["Choose Rise only when it matches your plan.", "The entry quote does not promise the exit quote.", "Check the contract details before starting."] },
  { title: "What Fall means", body: "A Fall contract uses the opposite quote direction from Rise for the same market and duration.", points: ["Choose Fall only when it matches your plan.", "A falling quote can reverse before expiry.", "Review the actual settlement in history."] },
  { title: "Choose a market", body: "Cash Grab can use supported Volatility and Jump markets. The live quote belongs to the selected market.", points: ["Wait for fresh data after switching.", "Auto best selects an eligible market.", "Review the selected market before starting."] },
  { title: "Manual and automatic markets", body: "Choose a specific market to keep the pair fixed, or select Auto best to use the strongest eligible observed rate.", points: ["Manual selection keeps your chosen pair.", "Auto best may update the pair between entries.", "Review the market shown before starting."] },
  { title: "Read the live quote", body: "The quote card displays the most recent quote for the active market. It can change before a request reaches Deriv.", points: ["A live quote is not a forecast.", "The newest displayed value may differ from the entry quote.", "Use a fresh connection before trading."] },
  { title: "Read Rise and Fall", body: "The direction bar compares current Rise and Fall movement for the selected market.", points: ["Select Rise or Fall before starting.", "A safety gate can hold an entry when its requirements are not met."] },
  { title: "Select a direction", body: "Choose Rise or Fall explicitly. Cash Grab keeps that direction for the next entry and does not silently flip it.", points: ["Confirm the selected direction.", "Changing direction while stopped does not send a trade.", "The trade request matches the visible selection."] },
  { title: "Set the stake", body: "Stake is the base amount used for each contract. Cash Grab enforces a minimum of 0.35.", points: ["Use a small demo stake while learning.", "Multiply mode can increase the next stake after a loss.", "Leave a reserve instead of using the full balance."] },
  { title: "Set duration and stake mode", body: "Rise/Fall duration can be set from one to five ticks. Choose Flat for the same stake each time, or Multiply to apply your entered multiplier after a loss.", points: ["A win restores the base stake.", "A larger multiplier can increase exposure quickly."] },
  { title: "Custom multiplier", body: "In Multiply mode, enter a positive multiplier for the next contract after a settled loss. A win returns the stake to the configured base amount.", points: ["Multiplying does not guarantee recovery."] },
  { title: "Auto-switch safety", body: "Auto-switch reviews fresh market samples on its scan schedule and changes markets only when the observed direction rate, sample, and balance checks pass.", points: ["It can change markets between entries.", "It does not alter your selected stake mode or multiplier.", "It may wait rather than send when no setup qualifies."] },
  { title: "Run Cash Grab", body: "Start begins the configured Rise/Fall session.", points: ["Review market, direction, stake, mode, and duration.", "If a check or request fails, Cash Grab reports the reason."] },
  { title: "Stop Cash Grab", body: "Stop prevents Cash Grab from starting another batch and requests closure for open contracts claimed by the active session.", points: ["Wait until the stopping state finishes.", "A contract can settle while a close request is being handled.", "Already settled contracts remain in history."] },
  { title: "Cash Grab history", body: "Cash Grab history shows the contracts sent by this feature. Open contracts are not final results, and the rows remain visible after stopping.", points: ["Check each returned contract and direction.", "Clearing dashboard rows does not delete Deriv records."] },
  { title: "Final Rise/Fall checklist", body: "Before a session, confirm the selected account, market, Rise or Fall direction, stake, Flat or Multiply mode, multiplier, and one-to-five-tick duration.", points: ["Use demo funds while testing.", "Keep the Stop control available."] },
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

type DigitFlipSetupResult = "selected" | "no-candidate" | "market-selection-failed";

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
  const canUseClockWork = hasFeature("clock-work") && featureIsAvailable("clock-work");
  const canUseCashGrab = hasFeature("cash-grab") && featureIsAvailable("cash-grab");
  const canUseMoneyBank = hasFeature("money-bank") && featureIsAvailable("money-bank");
  const canUseAutoTrader = hasFeature("auto-trader") && featureIsAvailable("auto-trader");
  const canUseAutoTrader2 = hasFeature("auto-trader-2") && featureIsAvailable("auto-trader-2");
  const canUseSettings = hasFeature("settings") && featureIsAvailable("settings");
  const canUseDeriv = canUseEdge || canUseDigitFlip || canUseTradeX || canUseBulkTrader || canUseClockWork || canUseCashGrab || canUseMoneyBank || canUseAutoTrader || canUseAutoTrader2;
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
  const clockWorkBuyMutation = useBuyClockWorkContracts();
  const anyContractBuyPending = bulkBuyMutation.isPending
    || dualBuyMutation.isPending
    || digitFlipBuyMutation.isPending
    || moneyBankBuyMutation.isPending
    || clockWorkBuyMutation.isPending;

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
  const [moneyBankStarting, setMoneyBankStarting] = useState(false);
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
  const [clockWorkEnabled, setClockWorkEnabled] = useState(false);
  const [clockWorkSymbol, setClockWorkSymbol] = useState("R_75");
  const [clockWorkStake, setClockWorkStake] = useState(1);
  const [clockWorkAiEnabled, setClockWorkAiEnabled] = useState(false);
  const [clockWorkRunning, setClockWorkRunning] = useState(false);
  const [clockWorkQuoteBuffer, setClockWorkQuoteBuffer] = useState<ClockWorkQuoteBuffer>({
    symbol: "R_75",
    quotes: [],
    lastTickId: null,
  });
  const clockWorkMarketResetEpochRef = useRef(0);
  const [clockWorkStatusMessage, setClockWorkStatusMessage] = useState<string | null>(null);
  const [clockWorkBusy, setClockWorkBusy] = useState(false);
  const [clockWorkAiStatus, setClockWorkAiStatus] = useState("Ai Clock is off.");
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
  const [cashGrabStarting, setCashGrabStarting] = useState(false);
  const [cashGrabScannerBusy, setCashGrabScannerBusy] = useState(false);
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
  const [digitFlipPendingHistoryIds, setDigitFlipPendingHistoryIds] = useState<Set<string>>(new Set());
  const [edgeMinWinRate, setEdgeMinWinRate] = useState(90);
  const [tradeXTradesSent, setTradeXTradesSent] = useState(0);
  const [tradeXSubmitting, setTradeXSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guidePage, setGuidePage] = useState(0);
  const [guideMode, setGuideMode] = useState<"edge" | "trade-x" | "digit-flip" | "bulk-trader" | "money-bank" | "cash-grab" | "clock-work">("edge");
  const [clearHistoryArmed, setClearHistoryArmed] = useState(false);
  const [historyFading, setHistoryFading] = useState(false);
  const [tradeXHistoryClearArmed, setTradeXHistoryClearArmed] = useState(false);
  const [tradeXHiddenHistoryIds, setTradeXHiddenHistoryIds] = useState<Set<string>>(new Set());
  const [sessionPnl, setSessionPnl] = useState(0);
  const [sessionTrades, setSessionTrades] = useState(0);
  const [analysisDigits, setAnalysisDigits] = useState<number[]>([]);
  const [analysisTickCount, setAnalysisTickCount] = useState(0);
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
  const moneyBankStartingRef = useRef(false);
  const moneyBankActionLockRef = useRef(false);
  const moneyBankBudgetExhaustedRef = useRef(false);
  const moneyBankClosePromiseRef = useRef<Promise<void> | null>(null);
  const moneyBankOpenContractIdRef = useRef<string | null>(null);
  const moneyBankJdyScanInFlightRef = useRef(false);
  const cashGrabRunningRef = useRef(false);
  const cashGrabStartingRef = useRef(false);
  const cashGrabStartAttemptIdRef = useRef(0);
  const cashGrabRunIdRef = useRef(0);
  const cashGrabActionLockRef = useRef(false);
  const cashGrabAccountIdRef = useRef<string | null>(null);
  const cashGrabOpenContractIdsRef = useRef(new Set<string>());
  const cashGrabCurrentStakeRef = useRef(.35);
  const cashGrabSessionPnlRef = useRef(0);
  const cashGrabSessionKnownIdsRef = useRef<Set<string> | null>(null);
  const cashGrabSessionContractIdsRef = useRef(new Set<string>());
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
  const moneyBankAccountIdRef = useRef<string | null>(null);
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
  const moneyBankClaimedHistoryIdsRef = useRef(new Set<string>());
  const [moneyBankHistoryClaims, setMoneyBankHistoryClaims] = useState<{
    accountId: string | null;
    ids: string[];
  }>({ accountId: null, ids: [] });
  const historyFeatureOwnersRef = useRef(new Map<string, DerivHistoryFeature>());
  const clockWorkActionLockRef = useRef(false);
  const clockWorkAiAttemptAtRef = useRef(0);
  const clockWorkAutomationRef = useRef<(() => void) | null>(null);
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
    marketType: tradeXMarketType,
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
  const currentAccountId = currentAccount?.id ?? null;
  const currentAccountType = currentAccount?.type ?? null;
  const currentAccountCurrency = currentAccount?.currency ?? null;
  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;
  const accessKeyId = accessSession.data?.key_id;
  const {
    notifications,
    unreadCount: unreadNotificationCount,
    isReady: notificationsReady,
    addNotification,
    upsertNotification,
    markNotificationRead,
    dismissNotification,
    markAllNotificationsRead,
    clearNotifications,
  } = useAccountNotifications(accessKeyId);
  const addNotificationRef = useRef(addNotification);
  addNotificationRef.current = addNotification;
  const upsertNotificationRef = useRef(upsertNotification);
  upsertNotificationRef.current = upsertNotification;
  const recentConnectionErrorAtRef = useRef(new Map<string, number>());
  const setConnectionMessage = useCallback(
    (message: { kind: "info" | "error"; text: string } | null) => {
      if (!message) return;
      const text = message.text.trim().slice(0, 500);
      if (!text) return;
      if (message.kind === "info") {
        if (text.startsWith("Deriv connected.")) {
          addNotificationRef.current("connection", "Deriv connected", text);
        } else if (/\b(waiting|still settling|checking|retry(?:ing)?|remains active)\b/i.test(text)) {
          upsertNotificationRef.current("connection", "Workspace waiting", text);
        } else {
          addNotificationRef.current("connection", "Workspace update", text);
        }
        return;
      }
      const now = Date.now();
      const previousAt = recentConnectionErrorAtRef.current.get(text);
      if (previousAt !== undefined && now - previousAt < 30_000) return;
      recentConnectionErrorAtRef.current.set(text, now);
      if (recentConnectionErrorAtRef.current.size > 40) {
        for (const [previousText, timestamp] of recentConnectionErrorAtRef.current) {
          if (now - timestamp > 30_000) recentConnectionErrorAtRef.current.delete(previousText);
        }
      }
      addNotificationRef.current("connection", "Workspace alert", text);
    },
    [],
  );
  const previousTokenStateRef = useRef<{ accessKeyId?: string; hasToken: boolean | null }>({ hasToken: null });
  const previousConnectionStateRef = useRef<{ accessKeyId?: string; isConnected: boolean | null }>({ isConnected: null });
  const previousAccountRef = useRef<{ accessKeyId?: string; accountId: string | null }>({ accountId: null });
  const statusIssueRef = useRef<string | null>(null);
  useEffect(() => {
    statusIssueRef.current = null;
    recentConnectionErrorAtRef.current.clear();
  }, [accessKeyId]);
  const activeContractCount = status.data?.active_contract_count ?? 0;
  const openContractsReady = status.data?.open_contracts_ready === true;
  const tradeSlotBlocked = !openContractsReady || activeContractCount > 0;
  const tradeSlotMessage = !isConnected
    ? null
    : !openContractsReady
      ? "Account status is being confirmed."
      : activeContractCount > 0
        ? `Waiting for ${activeContractCount} open Deriv contract${activeContractCount === 1 ? "" : "s"} to settle before another trade can start.`
        : null;
  const realAccountTradingDisabled = Boolean(
    isReal && status.data && !status.data.live_trading_enabled,
  );

  useEffect(() => {
    if (derivCapacityError) {
      upsertNotification(
        "connection",
        "Connection capacity issue",
        derivCapacityError,
      );
    }
  }, [derivCapacityError, upsertNotification]);

  useEffect(() => {
    if (tradeSlotMessage && openContractsReady) {
      upsertNotification("connection", "Trade entry paused", tradeSlotMessage);
    }
  }, [openContractsReady, tradeSlotMessage, upsertNotification]);

  useEffect(() => {
    if (realAccountTradingDisabled) {
      upsertNotification(
        "connection",
        "Real-account trading disabled",
        "Live-account trading is turned off for this workspace. Ask an administrator to enable it.",
      );
    }
  }, [realAccountTradingDisabled, upsertNotification]);

  useEffect(() => {
    if (!accessKeyId || !notificationsReady || !tokenStatus.isSuccess || !tokenStatus.data) return;
    const hasToken = Boolean(tokenStatus.data.has_token);
    const previous = previousTokenStateRef.current;
    if (previous.accessKeyId !== accessKeyId) {
      previousTokenStateRef.current = { accessKeyId, hasToken };
      return;
    }
    if (previous.hasToken === true && !hasToken) {
      addNotification(
        "connection",
        "Deriv credential removed",
        "The saved credential was removed. Reconnect Deriv before starting new trades.",
      );
    }
    previousTokenStateRef.current = { accessKeyId, hasToken };
  }, [accessKeyId, addNotification, notificationsReady, tokenStatus.data?.has_token, tokenStatus.isSuccess]);

  useEffect(() => {
    if (!accessKeyId || !notificationsReady || !status.isSuccess) return;
    const previous = previousConnectionStateRef.current;
    if (previous.accessKeyId !== accessKeyId) {
      previousConnectionStateRef.current = { accessKeyId, isConnected };
      return;
    }
    if (previous.isConnected === false && isConnected) {
      addNotification(
        "connection",
        "Deriv connected",
        "Deriv connected. Your credential remains protected on the server.",
      );
    } else if (previous.isConnected === true && !isConnected && connectedToken) {
      addNotification(
        "connection",
        "Deriv connection interrupted",
        "The live connection is no longer authorized. New trades will stay paused until it reconnects.",
      );
    }
    previousConnectionStateRef.current = { accessKeyId, isConnected };
  }, [accessKeyId, addNotification, connectedToken, isConnected, notificationsReady, status.isSuccess]);

  useEffect(() => {
    if (!accessKeyId || !notificationsReady || !status.isSuccess) return;
    const previous = previousAccountRef.current;
    if (previous.accessKeyId !== accessKeyId) {
      previousAccountRef.current = { accessKeyId, accountId: currentAccountId };
      return;
    }
    if (previous.accountId && currentAccountId && previous.accountId !== currentAccountId && currentAccountType) {
      const accountType = currentAccountType === "real" ? "Real" : "Demo";
      addNotification(
        "account",
        "Trading account changed",
        `The selected account is now ${accountType}${currentAccountCurrency ? ` · ${currentAccountCurrency}` : ""}.`,
      );
    }
    previousAccountRef.current = { accessKeyId, accountId: currentAccountId };
  }, [
    accessKeyId,
    addNotification,
    currentAccountCurrency,
    currentAccountId,
    currentAccountType,
    notificationsReady,
    status.isSuccess,
  ]);

  const statusUpdatesUnavailable = Boolean(
    connectedToken && (status.isError || status.isRefetchError),
  );
  useEffect(() => {
    if (!accessKeyId || !notificationsReady) return undefined;
    if (statusUpdatesUnavailable) {
      if (statusIssueRef.current === accessKeyId) return undefined;
      const timeout = window.setTimeout(() => {
        statusIssueRef.current = accessKeyId;
        addNotification(
          "connection",
          "Deriv status updates paused",
          "The dashboard has not received fresh account status. Check the connection before starting another action.",
        );
      }, 5_000);
      return () => window.clearTimeout(timeout);
    }
    if (statusIssueRef.current === accessKeyId && status.isSuccess) {
      statusIssueRef.current = null;
      addNotification("connection", "Deriv status updates restored", "Fresh account status is being received again.");
    }
    return undefined;
  }, [accessKeyId, addNotification, notificationsReady, status.isSuccess, statusUpdatesUnavailable]);

  const handleLogout = () => {
    clearNotifications();
    logoutAccessSession();
  };
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
  const digitFlipOwnedRows = digitFlipAllRows.filter((trade) => digitFlipClaimedHistoryIdsRef.current.has(String(trade.contract_id)));
  const digitFlipRows = digitFlipOwnedRows.filter((trade) => !digitFlipHiddenHistoryIds.has(String(trade.contract_id)));
  const bulkRows = bulkAllRows.filter((trade) => bulkClaimedHistoryIdsRef.current.has(trade.contract_id) && !bulkTraderHiddenHistoryIds.has(trade.contract_id));
  const visibleMoneyBankContractIds = new Set(
    moneyBankHistoryClaims.accountId === currentAccount?.id ? moneyBankHistoryClaims.ids : [],
  );
  const moneyBankRows = moneyBankAllRows
    .filter((trade) => trade.account_id === currentAccount?.id)
    .filter((trade) => visibleMoneyBankContractIds.has(trade.contract_id)) as MoneyBankTrade[];
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
  const clockWorkAiCandidate = chooseClockWorkAiCandidate(clockWorkQuoteHistory);
  const clockWorkTickEpoch = clockWorkTickIsFreshForMarket ? clockWorkLatestTick?.epoch ?? null : null;

  useEffect(() => {
    if (!clockWorkStatusMessage) return;
    const timeout = window.setTimeout(() => setClockWorkStatusMessage(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [clockWorkStatusMessage]);

  const cashGrabBestSymbol = useMemo(() => {
    return chooseCashGrabDirectionalMarket(
      (status.data?.market_signals ?? []) as AiScannerMarketSignal[],
      cashGrabSymbols.map((item) => item.value),
      cashGrabDirection,
    );
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
  const moneyBankSelectedSignal = moneyBankSignals.find((signal) => signal.symbol === moneyBankSymbol);
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
    () => (status.data?.market_signals ?? []).flatMap((signal) => {
      const selectedDigit = typeof bulkTraderPrediction === "number" ? bulkTraderPrediction : 5;
      const selectedOutcome = signal.digit_outcomes?.find((outcome) => outcome.digit === selectedDigit);
      if (
        !Number.isInteger(signal.sample_count)
        || signal.sample_count <= 0
        || !Number.isInteger(selectedDigit)
        || selectedDigit < 0
        || selectedDigit > 9
        || !selectedOutcome
      ) return [];
      const overRate = Number(selectedOutcome.over_percentage);
      const underRate = Number(selectedOutcome.under_percentage);
      if (!isValidObservedPercentage(overRate) || !isValidObservedPercentage(underRate)) return [];
      const differsRate = digitDiffersRateFromPercentages(overRate, underRate);
      if (bulkTraderType === "differs" && differsRate == null) return [];
      const observedPercentage = bulkTraderType === "over-under"
        ? Number(Math.max(overRate, underRate).toFixed(1))
        : Number(differsRate!.toFixed(1));
      return [{
        symbol: signal.symbol,
        sampleCount: signal.sample_count,
        observedPercentage,
      }];
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
    if (!isConnectedRef.current || moneyBankJdyScanInFlightRef.current) return null;
    const config = candidateConfig ?? moneyBankConfigRef.current;
    const selectedSymbol = candidateSymbol ?? config?.symbol;
    if (!config || !selectedSymbol) return null;
    moneyBankJdyScanInFlightRef.current = true;
    setMoneyBankJdyState("scanning");
    try {
      const freshStatus = await status.refetch();
      if (!freshStatus.isSuccess || !freshStatus.data?.connected || !freshStatus.data.authorized) {
        throw new Error("Money Bank is waiting for a fresh Deriv connection status.");
      }
      const expectedAccountId = moneyBankAccountIdRef.current;
      if (!expectedAccountId || freshStatus.data.account?.id !== expectedAccountId) {
        throw new Error("Money Bank is waiting for the account selected when the run started.");
      }
      const freshBalance = getAccountBalance(freshStatus.data.account);
      if (freshBalance == null || freshBalance <= 0) {
        throw new Error("Money Bank is waiting for a fresh positive account balance.");
      }
      const freshSignals = (freshStatus.data.market_signals ?? []) as MoneyBankMarketSignal[];
      const evaluateSetup = (marketSymbol: string, growthRate: number, takeProfitTicks: number): MoneyBankJdyDecision => {
        const signal = freshSignals.find((entry) => entry.symbol === marketSymbol);
        const signalCheck = checkMoneyBankJdySignal(signal);
        const observedBalance = signalCheck.observedBalance ?? 0;
        const stake = config.ladder[Math.min(6, moneyBankLevelRef.current)]?.stake ?? config.ladder[0]?.stake ?? 1;
        const stakeRiskPenalty = freshBalance
          ? Math.min(15, (stake / freshBalance) * 100)
          : 20;
        const riskPenalty = growthRate * 1.5 + takeProfitTicks * 0.12 + stakeRiskPenalty;
        const predictedWinRate = Math.max(0, Math.min(100, observedBalance - riskPenalty));
        const estimatedLossStreak = Math.max(0, Math.ceil((100 - predictedWinRate) / 10));
        const sampleCount = signalCheck.sampleCount;
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
          safe: signalCheck.ready && predictedWinRate >= 45 && estimatedLossStreak <= 5,
          holdReason: signalCheck.reason,
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
      const suggestion = alternatives.find((candidate) => candidate.safe);
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
    cashGrabSessionContractIdsRef.current.clear();
    moneyBankSessionKnownIdsRef.current = null;
    historyFeatureOwnersRef.current.clear();
    edgeClaimedHistoryIdsRef.current.clear();
    tradeXClaimedHistoryIdsRef.current.clear();
    digitFlipClaimedHistoryIdsRef.current.clear();
    bulkClaimedHistoryIdsRef.current.clear();
    cashGrabClaimedHistoryIdsRef.current.clear();
    clockWorkClaimedHistoryIdsRef.current.clear();
    moneyBankClaimedHistoryIdsRef.current.clear();
    const accountId = currentAccount?.id ?? null;
    const savedMoneyBankContractIds = readMoneyBankHistoryClaims(getMoneyBankHistoryStorage(), accountId);
    claimDerivHistoryFeatureContractIds(
      historyFeatureOwnersRef.current,
      accountId,
      "money-bank",
      moneyBankClaimedHistoryIdsRef.current,
      savedMoneyBankContractIds,
    );
    setMoneyBankHistoryClaims({ accountId, ids: savedMoneyBankContractIds });
    setDigitFlipPendingHistoryIds(new Set());
    setEdgeHiddenHistoryIds(new Set());
    setTradeXHiddenHistoryIds(new Set());
    setDigitFlipHiddenHistoryIds(new Set());
    setBulkTraderHiddenHistoryIds(new Set());
    setCashGrabHiddenHistoryIds(new Set());
    setClockWorkHiddenHistoryIds(new Set());
    setEdgeAccountBalance(currentAccountBalance == null ? "" : currentAccountBalance.toFixed(2));
    setDigitFlipAccountBalance(currentAccountBalance == null ? "" : currentAccountBalance.toFixed(2));
  }, [currentAccount?.id]);

  useEffect(() => {
    setDigitFlipPendingHistoryIds((current) => {
      const next = removeSettledHistoryAcknowledgements(current, digitFlipAllRows);
      return next.size === current.size ? current : next;
    });
  }, [rows]);

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
    const newlySettled = unprocessedDigitFlipSettlements(
      digitFlipSessionRows,
      digitFlipClaimedHistoryIdsRef.current,
      watch.knownIds,
      watch.processedIds,
    );
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
      marketType: tradeXMarketType,
      symbol: tradeXSymbol,
      stake: tradeXStake,
      selectedDigit: tradeXEntryDigit,
      duration: tradeXDuration,
      manualSelect: tradeXManualSelect,
      frameworkSignalReady: tradeXFrameworkSignalReady,
      rankedDigits: tradeXRankedDigits,
    };
  }, [
    tradeXMarketType,
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

  const claimMoneyBankContract = (contractId: string) => {
    const accountId = currentAccountRef.current?.id ?? null;
    claimFeatureRows("money-bank", moneyBankClaimedHistoryIdsRef.current, [contractId]);
    const ids = saveMoneyBankHistoryClaims(
      getMoneyBankHistoryStorage(),
      accountId,
      [...moneyBankClaimedHistoryIdsRef.current],
    );
    setMoneyBankHistoryClaims({ accountId, ids });
  };

  const waitForEdgeSettlement = async (contractIds: readonly string[]) => {
    if (!contractIds.length) return true;
    const expectedIds = new Set(contractIds);
    let attempt = 0;
    while (runningRef.current) {
      try {
        const historySnapshot = await readHistorySnapshot();
        if (historySnapshot.fresh) {
          const matching = historySnapshot.rows.filter((trade) => expectedIds.has(trade.contract_id));
          if (
            matching.length === expectedIds.size
            && matching.every((trade) => !isDerivHistoryOpen(trade.status))
          ) {
            queryClient.setQueryData(getGetDerivHistoryQueryKey(), historySnapshot.rows);
            return true;
          }
          if (attempt % 3 === 0) {
            setConnectionMessage({
              kind: "info",
              text: "EDGE remains active and is waiting for Deriv to confirm every contract has settled. No next entry will be sent yet.",
            });
          }
        } else if (attempt % 3 === 0) {
          setConnectionMessage({
            kind: "info",
            text: "EDGE remains active and is waiting for fresh Deriv history before another entry.",
          });
        }
      } catch {
        if (attempt % 3 === 0) {
          setConnectionMessage({
            kind: "info",
            text: "EDGE remains active and will check Deriv history again before another entry.",
          });
        }
      }
      attempt += 1;
      await sleep(1_000);
    }
    return false;
  };

  const updateEdgeSessionPnlAndStopIfNeeded = (
    latestRows: readonly {
      contract_id: string;
      contract_type: string;
      status: string;
      profit: number;
    }[],
  ) => {
    const knownAtSessionStart = edgeSessionKnownIdsRef.current;
    const settledSessionRows = latestRows.filter(
      (trade) =>
        (trade.contract_type === "DIGITOVER"
          || trade.contract_type === "DIGITUNDER")
        && edgeClaimedHistoryIdsRef.current.has(trade.contract_id)
        && !knownAtSessionStart?.has(trade.contract_id)
        && !isDerivHistoryOpen(trade.status),
    );
    const latestSessionPnl = realizedProfit(settledSessionRows);
    setSessionPnl(latestSessionPnl);

    const stopReason = sessionStopReason(
      latestSessionPnl,
      takeProfit,
      stopLoss,
    );
    if (!stopReason) return false;

    runningRef.current = false;
    setRunning(false);
    setConnectionMessage({
      kind: "info",
      text: `EDGE stopped at its ${
        stopReason === "take-profit" ? "profit" : "loss"
      } threshold (${latestSessionPnl.toFixed(2)} ${
        currentAccount?.currency ?? "USD"
      }). No next contract was sent.`,
    });
    return true;
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
    if (!historySnapshot.fresh) {
      throw new Error("EDGE is waiting for fresh Deriv history before another entry.");
    }
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
    if (updateEdgeSessionPnlAndStopIfNeeded(latestRows)) return;
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
    if (!await waitForEdgeSettlement(result.buys.map((buy) => buy.contract_id))) return;
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
    if (!historySnapshot.fresh) {
      throw new Error("EDGE is waiting for fresh Deriv history before another dual entry.");
    }
    for (let attempt = 0; historySnapshot.fresh && latestRows.some((trade) => isDerivHistoryOpen(trade.status)) && attempt < 20; attempt += 1) {
      await sleep(500);
      historySnapshot = await readHistorySnapshot();
      latestRows = historySnapshot.rows;
    }
    if (historySnapshot.fresh && latestRows.some((trade) => isDerivHistoryOpen(trade.status))) {
      throw new Error("The previous contract is still settling. EDGE stopped without sending another dual trade.");
    }
    if (!runningRef.current) return;
    if (updateEdgeSessionPnlAndStopIfNeeded(latestRows)) return;
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
    if (!await waitForEdgeSettlement(result.buys.map((buy) => buy.contract_id))) return;
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
        if (isConfirmedNoContractRejection(error)) {
          setConnectionMessage(null);
          await sleep(5_000);
          continue;
        }
        const message = errorMessage(error);
        if (/stake exceeds.*balance|total stake exceeds.*balance/i.test(message)) {
          runningRef.current = false;
          setRunning(false);
          setConnectionMessage({
            kind: "info",
            text: `EDGE stopped before sending another contract because the next stake exceeds the available balance. ${message}`,
          });
          break;
        }
        if (message.includes("still settling")) {
          setConnectionMessage({
            kind: "info",
            text: "Deriv is still settling the previous contract. EDGE will retry after the server confirms it is safe to continue.",
          });
          await sleep(500);
          continue;
        }
        if (
          (error instanceof ApiTransportError && !error.tradeOutcomeUncertain)
          || /balance|fresh deriv history|no trade was sent|could not select/i.test(message)
        ) {
          setConnectionMessage({
            kind: "info",
            text: `EDGE remains active and is waiting to retry safely: ${message}`,
          });
          await sleep(1_500);
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
    const actionInFlight = moneyBankActionLockRef.current;
    moneyBankRunningRef.current = false;
    moneyBankAccountIdRef.current = null;
    setMoneyBankRunning(false);
    setMoneyBankAutoKnockoutCountdown(null);
    if (actionInFlight) {
      setMoneyBankClosing(true);
      return;
    }
    void closeMoneyBankContracts().catch((error) => {
      setConnectionMessage({ kind: "error", text: `Money Bank could not close every open contract: ${errorMessage(error)}` });
    });
  };

  const executeMoneyBankTrade = async () => {
    const config = moneyBankConfigRef.current;
    if (!config || !moneyBankRunningRef.current || moneyBankActionLockRef.current) return;
    if (moneyBankBudgetExhaustedRef.current) {
      setConnectionMessage({
        kind: "info",
        text: "Money Bank remains active, but its planned recovery cycle is exhausted. No further orders will be sent until you stop and start a new cycle.",
      });
      await sleep(2_000);
      return;
    }
    if (!isConnectedRef.current) {
      setConnectionMessage({ kind: "info", text: "Money Bank remains active and is waiting for the Deriv connection." });
      await sleep(1_500);
      return;
    }
    const accountBalance = currentAccountBalanceRef.current;
    if (accountBalance == null || accountBalance <= 0) {
      setConnectionMessage({ kind: "info", text: "Money Bank remains active and is waiting for the account balance to refresh." });
      await sleep(1_500);
      return;
    }

    let historySnapshot = await readHistorySnapshot();
    if (!moneyBankRunningRef.current) return;
    let latestRows = historySnapshot.rows;
    if (!historySnapshot.fresh) {
      setConnectionMessage({ kind: "info", text: "Money Bank remains active and is waiting for fresh Deriv history before another entry." });
      await sleep(1_500);
      return;
    }
    const openContractId = moneyBankOpenContractIdRef.current;
    for (let attempt = 0; moneyBankRunningRef.current && historySnapshot.fresh && attempt < 240; attempt += 1) {
      const stillOpen = openContractId
        ? latestRows.some((trade) => trade.contract_id === openContractId && isDerivHistoryOpen(trade.status))
        : latestRows.some((trade) =>
          trade.contract_type === "ACCU"
          && !cashGrabClaimedHistoryIdsRef.current.has(trade.contract_id)
          && isDerivHistoryOpen(trade.status),
        );
      if (!stillOpen) break;
      await sleep(500);
      if (!moneyBankRunningRef.current) return;
      historySnapshot = await readHistorySnapshot();
      if (!moneyBankRunningRef.current) return;
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
      let recoveryCycleExhausted = false;
      if (settledAccumulator.profit > 0) {
        moneyBankLevelRef.current = 0;
        if (config.reinvestProfit) {
          const reinvestedProfit = settledAccumulator.profit * (config.reinvestPercent / 100);
          const nextBase = Math.max(1, config.ladder[0].stake + reinvestedProfit);
          const cycleBudget = config.ladder.at(-1)?.cumulative ?? 0;
          moneyBankConfigRef.current = {
            ...config,
            manualBase: nextBase,
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
        recoveryCycleExhausted = moneyBankLevelRef.current + 1 >= currentLadder.length;
        if (!recoveryCycleExhausted) moneyBankLevelRef.current += 1;
      }
      const stopReason = getMoneyBankSessionStopReason(nextSessionPnl, config);
      if (stopReason) throw new Error(stopReason);
      if (recoveryCycleExhausted) {
        throw new Error("Money Bank reached the planned recovery limit; no planned recovery level remains.");
      }
    }

    if (!moneyBankRunningRef.current) return;
    const currentConfig = moneyBankConfigRef.current ?? config;
    const configError = getMoneyBankStartConfigError(
      currentConfig,
      currentAccountBalanceRef.current,
      MONEY_BANK_AUTO_SYMBOLS,
      false,
    );
    if (configError) throw new Error(configError);
    const sessionStopReason = getMoneyBankSessionStopReason(
      moneyBankSessionPnlRef.current,
      currentConfig,
    );
    if (sessionStopReason) throw new Error(sessionStopReason);
    const tradeSymbol = currentConfig.symbol;
    if (moneyBankJdyEnabled) {
      // The Money Bank gate evaluates the market selected in the form.
      const decision = await scanJdyMoneyBank(currentConfig, tradeSymbol);
      if (!moneyBankRunningRef.current) return;
      if (!decision?.safe) {
        setMoneyBankJdyState("not-good");
        setConnectionMessage({
          kind: "info",
          text: decision
            ? `Shadows is waiting on the selected setup: ${decision.holdReason ?? `estimated ${decision.estimatedLossStreak}-loss streak risk`}. Money Bank remains active and will check again.`
            : "Shadows could not confirm the selected setup. Money Bank remains active and will check again.",
        });
        await sleep(2_000);
        return;
      }
      setMoneyBankJdyState("safe");
      setConnectionMessage({
        kind: "info",
        text: `Shadows confirmed the selected ${tradeSymbol} setup before entry.`,
      });
    }
    const level = currentConfig.ladder?.[Math.min(6, moneyBankLevelRef.current)];
    if (!level) throw new Error("Money Bank reached the planned recovery limit; no planned recovery level remains.");
    const availableBalance = currentAccountBalanceRef.current ?? 0;
    if (!availableBalance || level.stake > availableBalance) {
      throw new Error(`Money Bank is waiting because ${level.stake.toFixed(2)} ${currentAccount?.currency ?? "USD"} exceeds the connected balance.`);
    }

    if (tradeSymbol !== moneyBankSymbol) {
      setMoneyBankSymbol(tradeSymbol);
      if (!await selectMarket(tradeSymbol)) {
        throw new Error("Money Bank could not confirm the selected Deriv market.");
      }
    }

    if (!moneyBankRunningRef.current) return;
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

      const freshStatus = await status.refetch();
      if (!moneyBankRunningRef.current) return;
      if (!freshStatus.isSuccess || !freshStatus.data?.connected || !freshStatus.data.authorized) {
        throw new Error("Money Bank is waiting for a fresh Deriv connection status.");
      }
      if (
        !moneyBankAccountIdRef.current
        || freshStatus.data.account?.id !== moneyBankAccountIdRef.current
      ) {
        throw new Error("Money Bank stopped because the selected Deriv account changed during the run.");
      }
      if (freshStatus.data.symbol !== tradeSymbol) {
        throw new Error("Money Bank stopped because Deriv's selected market changed during the run.");
      }
      const freshBalance = getAccountBalance(freshStatus.data.account);
      if (freshBalance == null || freshBalance <= 0) {
        throw new Error("Money Bank is waiting for a fresh positive account balance.");
      }
      if (level.stake > freshBalance) {
        throw new Error(`Money Bank is waiting because ${level.stake.toFixed(2)} ${freshStatus.data.currency || "USD"} exceeds the fresh account balance.`);
      }
      const freshConfigError = getMoneyBankStartConfigError(
        currentConfig,
        freshBalance,
        MONEY_BANK_AUTO_SYMBOLS,
        false,
      );
      if (freshConfigError) throw new Error(freshConfigError);

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
        claimMoneyBankContract(contractId);
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
        if (isConfirmedNoContractRejection(error)) {
          setConnectionMessage(null);
          await sleep(5_000);
          continue;
        }
        if (message.includes("still settling")) {
          setConnectionMessage({
            kind: "info",
            text: "Deriv is still settling the previous Accumulator. Money Bank will retry when the server confirms it is safe to continue.",
          });
          await sleep(750);
          continue;
        }
        if (message.includes("reached the planned recovery limit")) {
          moneyBankBudgetExhaustedRef.current = true;
          setConnectionMessage({
            kind: "info",
            text: `${message} Money Bank remains active but will send no further orders in this cycle. Stop the feature before starting a new cycle.`,
          });
          await sleep(2_000);
          continue;
        }
        if (message.includes("session Profit target") || message.includes("session Loss limit")) {
          stopMoneyBank();
          setConnectionMessage({ kind: "info", text: message });
          return;
        }
        if (message.includes("Buy cooldown active")) {
          await sleep(1000);
          continue;
        }
        if (
          (error instanceof ApiTransportError && !error.tradeOutcomeUncertain)
          || /balance|account balance|fresh deriv history|deriv connection/i.test(message)
        ) {
          setConnectionMessage({
            kind: "info",
            text: `Money Bank remains active and is waiting to retry safely: ${message}`,
          });
          await sleep(1_500);
          continue;
        }
        stopMoneyBank();
        setConnectionMessage({ kind: "error", text: message });
      }
    }
  };

  const startMoneyBank = async (config: MoneyBankStartConfig) => {
    if (
      moneyBankStartingRef.current
      || moneyBankRunningRef.current
      || moneyBankActionLockRef.current
      || moneyBankClosePromiseRef.current
    ) {
      setConnectionMessage({
        kind: "info",
        text: "Money Bank is already starting, placing, or closing a contract.",
      });
      return;
    }
    if (!isConnectedRef.current) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before starting Money Bank." });
      return;
    }
    if (!currentAccount || currentAccountBalance == null) {
      setConnectionMessage({ kind: "error", text: "Select a Deriv account before starting Money Bank." });
      return;
    }
    const configError = getMoneyBankStartConfigError(
      config,
      currentAccountBalance,
      MONEY_BANK_AUTO_SYMBOLS,
    );
    if (configError) {
      setConnectionMessage({ kind: "error", text: configError });
      return;
    }

    moneyBankStartingRef.current = true;
    setMoneyBankStarting(true);
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
       moneyBankBudgetExhaustedRef.current = false;
      moneyBankConfigRef.current = config;
      moneyBankAccountIdRef.current = currentAccount.id;
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
    } finally {
      moneyBankStartingRef.current = false;
      setMoneyBankStarting(false);
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

  const cashGrabEntryBlockMessage = (
    reason: Exclude<ReturnType<typeof getCashGrabEntryBlockReason>, null>,
    currency: string,
  ) => {
    switch (reason) {
      case "connection-unavailable":
        return "Cash Grab remains active and is waiting for the Deriv connection.";
      case "account-unavailable":
        return "Cash Grab is waiting for a selected Deriv account.";
      case "account-unbound":
        return "Cash Grab has no confirmed session account. Stop and start the run again.";
      case "account-changed":
        return "Cash Grab stopped because the selected Deriv account changed.";
      case "market-unsupported":
        return "Cash Grab stopped because its selected market is not supported.";
      case "stake-invalid":
        return "Cash Grab stopped because its next stake is invalid.";
      case "balance-unavailable":
        return "Cash Grab remains active and is waiting for a fresh account balance.";
      case "insufficient-balance":
        return "Cash Grab remains active and is waiting for enough available balance for the selected stake.";
      case "contract-status-unavailable":
        return "Cash Grab remains active and is waiting for Deriv to confirm the open-contract status.";
      case "contract-open":
        return "Cash Grab remains active and is waiting for the current contract to settle.";
      case "take-profit-limit-reached":
        return `Cash Grab stopped at its ${cashGrabConfigRef.current?.takeProfit.toFixed(2) ?? "configured"} ${currency} take-profit limit.`;
      case "loss-limit-reached":
        return `Cash Grab stopped at its ${cashGrabConfigRef.current?.lossLimit.toFixed(2) ?? "configured"} ${currency} session loss limit.`;
      case "session-pnl-invalid":
        return "Cash Grab stopped because its settled session P/L could not be validated.";
    }
  };

  const scanCashGrabAutoSwitch = async (
    candidateConfig?: CashGrabStartConfig,
  ): Promise<CashGrabAutoSwitchRecommendation | null> => {
    if (!isConnectedRef.current || cashGrabAutoSwitchBusyRef.current) return cashGrabAutoSwitchRecommendationRef.current;
    const config = candidateConfig ?? cashGrabConfigRef.current;
    if (!config) return null;
    cashGrabAutoSwitchBusyRef.current = true;
    setCashGrabAutoSwitchSafestPairStatus("watching");
    try {
      const freshStatus = await status.refetch();
      const freshData = freshStatus.data;
      if (!freshStatus.isSuccess || !freshData?.connected || !freshData.authorized) {
        setCashGrabAutoSwitchSafestPairStatus("quiet");
        setConnectionMessage({ kind: "info", text: "Cash Grab is waiting for a fresh Deriv connection before switching markets." });
        return null;
      }
      if (freshData.account?.id !== cashGrabAccountIdRef.current) {
        setConnectionMessage({ kind: "error", text: "Cash Grab stopped because the selected Deriv account changed." });
        stopCashGrab();
        return null;
      }
      const signals = freshData.market_signals ?? [];
      const balance = getAccountBalance(freshData.account);
      if (balance == null) {
        setCashGrabAutoSwitchSafestPairStatus("quiet");
        setConnectionMessage({ kind: "info", text: "Cash Grab is waiting for a fresh account balance before switching markets." });
        return null;
      }
      const minimumStake = .35;
      const currentStake = Math.max(minimumStake, cashGrabCurrentStakeRef.current || config.stake);
      if (!Number.isFinite(currentStake)) {
        setCashGrabAutoSwitchSafestPairStatus("quiet");
        setConnectionMessage({ kind: "info", text: "Cash Grab is waiting for a valid next stake before switching markets." });
        return null;
      }
      const candidates: CashGrabAutoSwitchRecommendation[] = [];

      for (const signal of signals) {
        if (
          !cashGrabSymbols.some((item) => item.value === signal.symbol)
          || !Number.isInteger(signal.sample_count)
          || signal.sample_count < AI_SCANNER_MIN_SAMPLE
        ) continue;
        const observedWinRate = config.direction === "PUT"
          ? signal.fall_percentage ?? 0
          : signal.rise_percentage ?? 0;
        if (!isValidObservedPercentage(observedWinRate) || currentStake > balance || observedWinRate < 50) continue;
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
          text: `Auto-switch selected ${recommendation.symbol} for the next entry.`,
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
    const completed = getCashGrabSessionSettlements(
      latestRows,
      cashGrabSessionContractIdsRef.current,
      cashGrabProcessedSettlementIdsRef.current,
    );
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
    const profits = completed.map((trade) => Number(trade.profit));
    if (profits.some((profit) => !Number.isFinite(profit))) {
      setConnectionMessage({ kind: "error", text: "Cash Grab stopped because a settled contract result could not be verified." });
      stopCashGrab();
      return;
    }
    const netSettledProfit = profits.reduce((total, profit) => total + profit, 0);
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
    if (!initial.isSuccess || !initial.data?.connected || !initial.data.authorized) {
      setConnectionMessage({ kind: "info", text: "Auto Direction is waiting for a fresh Deriv connection. No trade was sent." });
      return null;
    }
    if (initial.data.account?.id !== cashGrabAccountIdRef.current) {
      setConnectionMessage({ kind: "error", text: "Cash Grab stopped because the selected Deriv account changed." });
      stopCashGrab();
      return null;
    }
    const signal = initial.data.market_signals?.find((entry) => entry.symbol === marketSymbol);
    const initialRise = Number(signal?.rise_percentage);
    const initialFall = Number(signal?.fall_percentage);
    if (
      !signal
      || !Number.isInteger(signal.sample_count)
      || signal.sample_count < AI_SCANNER_MIN_SAMPLE
      || !isValidObservedPercentage(initialRise)
      || !isValidObservedPercentage(initialFall)
    ) {
      setConnectionMessage({ kind: "info", text: `Auto Direction is waiting for live Rise/Fall samples on ${marketSymbol}. No trade was sent.` });
      return null;
    }
    const rise = initialRise;
    const fall = initialFall;
    if (rise === fall) {
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
      if (!latest.isSuccess || !latest.data?.connected || !latest.data.authorized) continue;
      if (latest.data.account?.id !== cashGrabAccountIdRef.current) {
        setConnectionMessage({ kind: "error", text: "Cash Grab stopped because the selected Deriv account changed." });
        stopCashGrab();
        return null;
      }
      const latestSignal = latest.data?.market_signals?.find((entry) => entry.symbol === marketSymbol);
      if (!latestSignal || latestSignal.tick_sequence <= lastSequence) continue;
      freshTicks += latestSignal.tick_sequence - lastSequence;
      lastSequence = latestSignal.tick_sequence;
      if (freshTicks < 2) continue;

      const latestRise = Number(latestSignal.rise_percentage);
      const latestFall = Number(latestSignal.fall_percentage);
      if (
        !Number.isInteger(latestSignal.sample_count)
        ||
        latestSignal.sample_count < AI_SCANNER_MIN_SAMPLE
        || !isValidObservedPercentage(latestRise)
        || !isValidObservedPercentage(latestFall)
      ) {
        setConnectionMessage({ kind: "info", text: `Auto Direction is waiting for valid Rise/Fall samples on ${marketSymbol}. No trade was sent.` });
        return null;
      }
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
    const configError = getCashGrabStartConfigError(config, cashGrabSymbols.map((item) => item.value));
    if (configError) {
      setConnectionMessage({ kind: "error", text: `Cash Grab stopped: ${configError}` });
      stopCashGrab();
      return;
    }
    if (!isConnectedRef.current) {
      setConnectionMessage({ kind: "info", text: "Cash Grab remains active and is waiting for the Deriv connection." });
      await sleep(1_500);
      return;
    }
    let historySnapshot = await readHistorySnapshot();
    let latestRows = historySnapshot.rows;
    if (!historySnapshot.fresh) {
      setConnectionMessage({ kind: "info", text: "Cash Grab remains active and is waiting for fresh Deriv history before another entry." });
      await sleep(1_500);
      return;
    }
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
      await sleep(1_000);
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
      if (!await selectMarket(recommendation.symbol)) {
        cashGrabAutoSwitchNextAtRef.current = Date.now();
        setConnectionMessage({ kind: "info", text: "Cash Grab remains active and is waiting to select its next market." });
        await sleep(1_500);
        return;
      }
      cashGrabConfigRef.current = config;
      setCashGrabSymbol(recommendation.symbol);
    }
    if (!cashGrabRunningRef.current) return;

    if (config.autoSelectBest) {
      const freshSelection = await status.refetch();
      if (!freshSelection.isSuccess || !freshSelection.data?.connected || !freshSelection.data.authorized) {
        setConnectionMessage({ kind: "info", text: "Cash Grab remains active and is waiting for fresh market data." });
        await sleep(1_500);
        return;
      }
      if (freshSelection.data.account?.id !== cashGrabAccountIdRef.current) {
        setConnectionMessage({ kind: "error", text: "Cash Grab stopped because the selected Deriv account changed." });
        stopCashGrab();
        return;
      }
      const bestSymbol = chooseCashGrabDirectionalMarket(
        (freshSelection.data.market_signals ?? []) as AiScannerMarketSignal[],
        cashGrabSymbols.map((item) => item.value),
        config.direction,
      );
      if (!bestSymbol) {
        setConnectionMessage({ kind: "info", text: "Cash Grab remains active and is waiting for a supported market with enough valid samples for the selected side." });
        await sleep(1_500);
        return;
      }
      if (bestSymbol !== config.symbol) {
        if (!await selectMarket(bestSymbol)) {
          setConnectionMessage({ kind: "info", text: "Cash Grab remains active and is waiting to select its next market." });
          await sleep(1_500);
          return;
        }
        config = { ...config, symbol: bestSymbol };
        cashGrabConfigRef.current = config;
        setCashGrabSymbol(bestSymbol);
      }
    }
    if (!cashGrabRunningRef.current) return;
    const amount = Number(cashGrabCurrentStakeRef.current.toFixed(2));
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
    setCashGrabScannerBusy(true);
    try {
      const freshStatus = await status.refetch().catch(() => null);
      if (!cashGrabRunningRef.current) return;
      if (!freshStatus?.isSuccess || !freshStatus.data) {
        setConnectionMessage({ kind: "info", text: "Cash Grab remains active and is waiting for a fresh Deriv status check." });
        await sleep(1_500);
        return;
      }
      const freshAccount = freshStatus.data.account;
      if (freshAccount?.type === "real" && !freshStatus.data.live_trading_enabled) {
        setConnectionMessage({ kind: "error", text: "Cash Grab stopped because live trading is disabled for this workspace." });
        stopCashGrab();
        return;
      }
      const entryBlock = getCashGrabEntryBlockReason({
        connectionReady: Boolean(freshStatus.data.connected && freshStatus.data.authorized),
        selectedAccountId: freshAccount?.id ?? null,
        sessionAccountId: cashGrabAccountIdRef.current,
        symbol: config.symbol,
        supportedSymbols: cashGrabSymbols.map((item) => item.value),
        stake: amount,
        balance: getAccountBalance(freshAccount),
        activeContractCount: freshStatus.data.open_contracts_ready
          && Number.isInteger(freshStatus.data.active_contract_count)
          ? freshStatus.data.active_contract_count
          : null,
        sessionPnl: cashGrabSessionPnlRef.current,
        takeProfit: config.takeProfit,
        lossLimit: config.lossLimit,
      });
      if (entryBlock) {
        const stopReasons = new Set([
          "account-unavailable",
          "account-unbound",
          "account-changed",
          "market-unsupported",
          "stake-invalid",
          "take-profit-limit-reached",
          "loss-limit-reached",
          "session-pnl-invalid",
        ]);
        const shouldStop = stopReasons.has(entryBlock);
        setConnectionMessage({
          kind: shouldStop ? "error" : "info",
          text: cashGrabEntryBlockMessage(entryBlock, freshAccount?.currency ?? "USD"),
        });
        if (shouldStop) stopCashGrab();
        else await sleep(1_500);
        return;
      }
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
      if (!result.buys.length) throw new Error("Deriv did not return a confirmed Cash Grab contract.");
      contractConfirmed = true;
      setConnectionMessage(null);
      result.buys.forEach((buy) => {
        const contractId = String(buy.contract_id);
        cashGrabSessionContractIdsRef.current.add(contractId);
        cashGrabOpenContractIdsRef.current.add(contractId);
      });
      if (result.buys.length !== 1) {
        setConnectionMessage({ kind: "error", text: "Deriv returned an unexpected number of Cash Grab contracts. The run is stopping for review." });
        stopCashGrab();
        return;
      }
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
          kind: cashGrabOpenContractIdsRef.current.size > 0 ? "info" : "error",
          text: cashGrabOpenContractIdsRef.current.size > 0
            ? `Deriv accepted the Cash Grab contract, but history is temporarily unavailable. Cash Grab remains active and will wait for settlement confirmation before another entry.`
            : `Deriv returned a trade acknowledgement without a contract ID. Cash Grab needs a history review before it can safely continue.`,
        });
        if (cashGrabOpenContractIdsRef.current.size > 0) {
          await sleep(1_000);
          return;
        }
      } else if (error instanceof ApiTransportError && error.tradeOutcomeUncertain) {
        setConnectionMessage({
          kind: "error",
          text: `Cash Grab trade status is unconfirmed. ${errorMessage(error)} Cash Grab is paused; confirm there is no open Rise/Fall contract in Deriv before restarting.`,
        });
      } else if (isConfirmedNoContractRejection(error)) {
        setConnectionMessage(null);
        await sleep(5_000);
        return;
      } else {
        setConnectionMessage({ kind: "error", text: `Cash Grab could not place the contract: ${errorMessage(error)}` });
      }
      // Keep the existing safety hold for outcomes that cannot be confirmed.
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
        setConnectionMessage({
          kind: "info",
          text: `Cash Grab remains active and is waiting to retry safely: ${errorMessage(error)}`,
        });
        await sleep(1_500);
      }
    }
  };

  const closeCashGrabContracts = async () => {
    if (cashGrabClosePromiseRef.current) return cashGrabClosePromiseRef.current;
    const operation = (async () => {
      try {
        if (cashGrabAccountIdRef.current) {
          const accountStatus = await status.refetch().catch(() => null);
          if (
            !accountStatus?.isSuccess
            || accountStatus.data?.account?.id !== cashGrabAccountIdRef.current
          ) {
            throw new Error("Cash Grab could not verify the account used for this run. Select that same account before managing its contracts.");
          }
        }
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
              cashGrabAccountIdRef.current = null;
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
        cashGrabAccountIdRef.current = null;
      } finally {
        setCashGrabStopping(false);
        cashGrabClosePromiseRef.current = null;
      }
    })();
    cashGrabClosePromiseRef.current = operation;
    return operation;
  };

  const stopCashGrab = () => {
    cashGrabStartAttemptIdRef.current += 1;
    cashGrabStartingRef.current = false;
    setCashGrabStarting(false);
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
    if (
      cashGrabRunningRef.current
      || cashGrabStartingRef.current
      || cashGrabActionLockRef.current
      || bulkBuyMutation.isPending
    ) return;
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
    if (!config) {
      setConnectionMessage({ kind: "error", text: "Set up Cash Grab before starting a run." });
      return;
    }
    const configError = getCashGrabStartConfigError(config, cashGrabSymbols.map((item) => item.value));
    if (configError) {
      setConnectionMessage({ kind: "error", text: configError });
      return;
    }

    const attemptId = ++cashGrabStartAttemptIdRef.current;
    cashGrabStartingRef.current = true;
    setCashGrabStarting(true);
    try {
      const initialStatus = await status.refetch().catch(() => null);
      if (cashGrabStartAttemptIdRef.current !== attemptId) return;
      if (!initialStatus?.isSuccess || !initialStatus.data?.connected || !initialStatus.data.authorized) {
        setConnectionMessage({ kind: "error", text: "Connect Deriv and wait for account status before starting Cash Grab." });
        return;
      }
      const startingAccountId = initialStatus.data.account?.id ?? null;
      if (!startingAccountId) {
        setConnectionMessage({ kind: "error", text: "Select a Deriv account before starting Cash Grab." });
        return;
      }
      if (initialStatus.data.account?.type === "real" && !initialStatus.data.live_trading_enabled) {
        setConnectionMessage({ kind: "error", text: "Live trading is disabled for this workspace." });
        return;
      }

      const historySnapshot = await readHistorySnapshot();
      if (cashGrabStartAttemptIdRef.current !== attemptId) return;
      if (!historySnapshot.fresh) {
        setConnectionMessage({ kind: "info", text: "Cash Grab is waiting for fresh Deriv history before it starts." });
        return;
      }
      if (historySnapshot.rows.some((trade) => isDerivHistoryOpen(trade.status))) {
        setConnectionMessage({ kind: "info", text: "Cash Grab cannot start until Deriv confirms that the existing contract has settled." });
        return;
      }

      const finalStatus = await status.refetch().catch(() => null);
      if (cashGrabStartAttemptIdRef.current !== attemptId) return;
      if (!finalStatus?.isSuccess || !finalStatus.data?.connected || !finalStatus.data.authorized) {
        setConnectionMessage({ kind: "info", text: "Cash Grab is waiting for a fresh Deriv connection check before starting." });
        return;
      }
      const finalAccount = finalStatus.data.account;
      if (finalAccount?.type === "real" && !finalStatus.data.live_trading_enabled) {
        setConnectionMessage({ kind: "error", text: "Live trading is disabled for this workspace." });
        return;
      }
      const startBlock = getCashGrabEntryBlockReason({
        connectionReady: Boolean(finalStatus.data.connected && finalStatus.data.authorized),
        selectedAccountId: finalAccount?.id ?? null,
        sessionAccountId: startingAccountId,
        symbol: config.symbol,
        supportedSymbols: cashGrabSymbols.map((item) => item.value),
        stake: config.stake,
        balance: getAccountBalance(finalAccount),
        activeContractCount: finalStatus.data.open_contracts_ready
          && Number.isInteger(finalStatus.data.active_contract_count)
          ? finalStatus.data.active_contract_count
          : null,
        sessionPnl: 0,
        takeProfit: config.takeProfit,
        lossLimit: config.lossLimit,
      });
      if (startBlock) {
        setConnectionMessage({
          kind: "error",
          text: cashGrabEntryBlockMessage(startBlock, finalAccount?.currency ?? "USD"),
        });
        return;
      }

      const existingIds = historySnapshot.rows
        .filter((trade) => cashGrabManagedContractTypes.includes(trade.contract_type as typeof cashGrabManagedContractTypes[number]))
        .map((trade) => trade.contract_id);
      cashGrabOpenContractIdsRef.current.clear();
      cashGrabSessionContractIdsRef.current.clear();
      cashGrabSessionKnownIdsRef.current = new Set(existingIds);
      cashGrabProcessedSettlementIdsRef.current = new Set(existingIds);
      cashGrabAccountIdRef.current = startingAccountId;
      cashGrabConfigRef.current = config;
      cashGrabCurrentStakeRef.current = Number(config.stake.toFixed(2));
      cashGrabSessionPnlRef.current = 0;
      setCashGrabSessionPnl(0);
      cashGrabAutoSwitchNextAtRef.current = config.autoSwitchSafestPair ? 0 : null;
      setCashGrabStopping(false);
      setCashGrabAutoSwitchSafestPairStatus(config.autoSwitchSafestPair ? "watching" : "off");
      cashGrabStartingRef.current = false;
      setCashGrabStarting(false);
      cashGrabRunningRef.current = true;
      setCashGrabRunning(true);
      const runId = ++cashGrabRunIdRef.current;
      void runCashGrabLoop(runId);
    } catch (error) {
      if (cashGrabStartAttemptIdRef.current === attemptId) {
        setConnectionMessage({ kind: "error", text: `Cash Grab could not start safely: ${errorMessage(error)}` });
      }
    } finally {
      if (cashGrabStartAttemptIdRef.current === attemptId) {
        cashGrabStartingRef.current = false;
        setCashGrabStarting(false);
      }
    }
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
    setClockWorkAiEnabled(false);
    setClockWorkRunning(false);
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
    setClockWorkAiEnabled(false);
    setClockWorkRunning(false);
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
    setClockWorkAiEnabled(false);
    setClockWorkRunning(false);
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
  const notifyTradeX = (message: string) => {
    addNotification("connection", "Trade X", message);
  };

  const executeTradeX = async (
    count = 1,
    durationOverride = tradeXDuration,
    digitOverride?: number,
    symbolOverride?: string,
  ) => {
    if (!tradeXEnabled) {
      notifyTradeX("Enable Trade X before sending a contract.");
      return false;
    }
    if (tradeXActionLockRef.current) {
      notifyTradeX("Trade X is already sending. Wait for the current request to finish.");
      return false;
    }
    if (anyContractBuyPending) {
      notifyTradeX("Another trade request is still being sent. Wait for its confirmation before placing a Trade X contract.");
      return false;
    }
    if (tradeSlotBlocked) {
      notifyTradeX(tradeSlotMessage ?? "Deriv has not confirmed that the previous contract settled. No new trade was sent.");
      return false;
    }
    const config = tradeXConfigRef.current;
    const entryDigit = digitOverride ?? (config.manualSelect
      ? config.selectedDigit
      : config.frameworkSignalReady
        ? config.selectedDigit
        : digitForTick(durationOverride, config.rankedDigits, config.selectedDigit));
    if (!isConnected) {
      notifyTradeX("Connect Deriv before sending a Trade X contract.");
      return false;
    }
    if (!isTradingCalendarOpen()) {
      notifyTradeX("Trade X is outside its configured trading calendar.");
      return false;
    }
    const symbol = symbolOverride ?? config.symbol;
    const supportedSymbols = tradeXSymbols
      .filter((market) => market.marketType === config.marketType)
      .map((market) => market.value);
    const lockResult = acquireTradeXActionLock(tradeXActionLockRef, anyContractBuyPending);
    if (lockResult !== "acquired") {
      notifyTradeX(lockResult === "already-sending"
        ? "Trade X is already sending. Wait for the current request to finish."
        : "Another trade request is still being sent. Wait for its confirmation before placing a Trade X contract.");
      return false;
    }
    setTradeXSubmitting(true);
    let buyRequestStarted = false;
    try {
      const freshStatus = await status.refetch();
      const freshData = freshStatus.data;
      if (freshStatus.isError || !freshData) {
        notifyTradeX("Deriv status could not be refreshed. No Trade X contract was sent.");
        return false;
      }
      if (!freshData.open_contracts_ready) {
        notifyTradeX("Deriv has not confirmed that open contracts are clear. No Trade X contract was sent.");
        return false;
      }
      if ((freshData.active_contract_count ?? 0) > 0) {
        const activeCount = freshData.active_contract_count ?? 0;
        notifyTradeX(`Waiting for ${activeCount} open Deriv contract${activeCount === 1 ? "" : "s"} to settle. No Trade X contract was sent.`);
        return false;
      }
      const freshBalance = getAccountBalance(freshData.account);
      if (freshBalance == null) {
        notifyTradeX("Trade X is paused until the selected account balance is refreshed.");
        return false;
      }
      const orderError = validateTradeXEntry({
        stake: config.stake,
        balance: freshBalance,
        symbol,
        supportedSymbols,
        digit: entryDigit,
        duration: durationOverride,
        count,
      });
      if (orderError) {
        notifyTradeX(orderError);
        return false;
      }
      buyRequestStarted = true;
      const result = await bulkBuyMutation.mutateAsync({
        data: buildTradeXOrderData({
          stake: config.stake,
          duration: durationOverride,
          digit: entryDigit,
          symbol,
        }),
      });
      if (result.buys.length) {
        claimFeatureRows("trade-x", tradeXClaimedHistoryIdsRef.current, result.buys.map((buy) => buy.contract_id));
      }
      if (!result.ok || result.buys.length !== count) {
        notifyTradeX(result.message || `Deriv confirmed ${result.buys.length} of ${count} Trade X contracts. Check account history before resubmitting.`);
        refreshTradeResults();
        return false;
      }
      setTradeXTradesSent((value) => value + result.buys.length);
      notifyTradeX(`Deriv confirmed ${result.buys.length} Trade X contract${result.buys.length === 1 ? "" : "s"}. Waiting for settlement.`);
      setConnectionMessage(null);
      refreshTradeResults();
      return true;
    } catch (error) {
      notifyTradeX(buyRequestStarted
        ? `${errorMessage(error)} Check Deriv account history before retrying in case the contract was accepted.`
        : `${errorMessage(error)} No Trade X contract was sent because the fresh safety check did not complete.`);
      return false;
    } finally {
      releaseTradeXActionLock(tradeXActionLockRef);
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
    if (!cashGrabEnabled || !isConnectedRef.current) throw new Error("Enable Cash Grab and connect Deriv before scanning.");
    if (cashGrabRunningRef.current || cashGrabStartingRef.current || cashGrabActionLockRef.current || bulkBuyMutation.isPending) {
      throw new Error("Cash Grab is already running or sending a contract.");
    }
    cashGrabActionLockRef.current = true;
    try {
      if (!Number.isInteger(cashGrabDuration) || cashGrabDuration < 1 || cashGrabDuration > 5) {
        throw new Error("Choose a Cash Grab duration from 1 to 5 ticks first.");
      }
      const amount = Number(cashGrabStake.toFixed(2));
      if (!Number.isFinite(amount) || amount < 0.35) throw new Error("Set a Cash Grab stake of at least 0.35 first.");

      const initialStatus = await status.refetch();
      if (!initialStatus.isSuccess || !initialStatus.data?.connected || !initialStatus.data.authorized) {
        throw new Error("Cash Grab needs a fresh connected Deriv account before scanning.");
      }
      const scanAccountId = initialStatus.data.account?.id ?? null;
      if (!scanAccountId) throw new Error("Select a Deriv account before scanning Cash Grab.");
      if (initialStatus.data.account?.type === "real" && !initialStatus.data.live_trading_enabled) {
        throw new Error("Live trading is disabled for this workspace.");
      }
      if (
        !initialStatus.data.open_contracts_ready
        || !Number.isInteger(initialStatus.data.active_contract_count)
        || initialStatus.data.active_contract_count !== 0
      ) {
        throw new Error(tradeSlotMessage ?? "Deriv has not confirmed that all existing contracts have settled.");
      }
      const initialBalance = getAccountBalance(initialStatus.data.account);
      if (initialBalance == null || amount > initialBalance) {
        throw new Error("Cash Grab is waiting for a fresh balance that can cover the selected stake.");
      }

      const signals = (initialStatus.data.market_signals ?? []) as AiScannerMarketSignal[];
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
      const sessionRows = historySnapshot.rows.filter((trade) =>
        cashGrabClaimedHistoryIdsRef.current.has(trade.contract_id)
        && !cashGrabSessionKnownIdsRef.current?.has(trade.contract_id)
        && !isDerivHistoryOpen(trade.status),
      );
      const sessionPnl = realizedProfit(sessionRows);

      const finalStatus = await status.refetch();
      if (!finalStatus.isSuccess || !finalStatus.data?.connected || !finalStatus.data.authorized) {
        throw new Error("Cash Grab needs a fresh connection check before sending a scanned contract.");
      }
      const finalAccount = finalStatus.data.account;
      if (finalAccount?.type === "real" && !finalStatus.data.live_trading_enabled) {
        throw new Error("Live trading is disabled for this workspace.");
      }
      const scanBlock = getCashGrabEntryBlockReason({
        connectionReady: Boolean(finalStatus.data.connected && finalStatus.data.authorized),
        selectedAccountId: finalAccount?.id ?? null,
        sessionAccountId: scanAccountId,
        symbol: candidate.symbol,
        supportedSymbols: cashGrabSymbols.map((market) => market.value),
        stake: amount,
        balance: getAccountBalance(finalAccount),
        activeContractCount: finalStatus.data.open_contracts_ready
          && Number.isInteger(finalStatus.data.active_contract_count)
          ? finalStatus.data.active_contract_count
          : null,
        sessionPnl,
        takeProfit: cashGrabTakeProfit,
        lossLimit: cashGrabLossLimit,
      });
      if (scanBlock) {
        throw new Error(cashGrabEntryBlockMessage(scanBlock, finalAccount?.currency ?? "USD"));
      }

      setCashGrabSymbol(candidate.symbol);
      setCashGrabDirection(candidate.contractType);
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
      claimFeatureRows("cash-grab", cashGrabClaimedHistoryIdsRef.current, result.buys.map((buy) => buy.contract_id));
      refreshTradeResults();
      if (result.buys.length !== 1) {
        throw new Error("Deriv returned an unexpected number of Cash Grab contracts. Review open contracts before continuing.");
      }
      setConnectionMessage(null);
      const side = candidate.contractType === "CALL" ? "Rise" : "Fall";
      return `Sent one Cash Grab ${side} contract on ${candidate.symbol} for ${cashGrabDuration} ticks at ${amount.toFixed(2)} ${finalAccount?.currency ?? "USD"}.`;
    } finally {
      cashGrabActionLockRef.current = false;
      setCashGrabScannerBusy(false);
    }
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


  const chooseDigitFlipSetup = async (requireThreshold = false): Promise<DigitFlipSetupResult> => {
    const config = digitFlipConfigRef.current;
    const signals = digitFlipMarketSignalsRef.current
      .filter((signal) =>
        Number.isFinite(signal.sampleCount)
        && signal.sampleCount > 0
        && isValidDigitFlipParityRates(signal.evenPercentage, signal.oddPercentage),
      )
      .filter((signal) => config.marketType === "auto" || tradeXSymbols.find((option) => option.value === signal.symbol)?.marketType === config.marketType)
      .map((signal) => ({
        signal,
        parity: signal.evenPercentage >= signal.oddPercentage ? "DIGITEVEN" as const : "DIGITODD" as const,
        rate: Math.max(signal.evenPercentage, signal.oddPercentage),
      }))
      .filter((candidate) => !requireThreshold || candidate.rate >= DIGIT_FLIP_SIGNAL_FLOOR)
      .sort((left, right) => right.rate - left.rate || right.signal.sampleCount - left.signal.sampleCount);
    const best = signals[0];
    if (!best) return "no-candidate";
    if (best.signal.symbol !== config.symbol) {
      if (!await selectMarket(best.signal.symbol)) return "market-selection-failed";
      setDigitFlipSymbol(best.signal.symbol);
    }
    const nextParity = (config.marketType === "auto" || digitFlipMagicRef.current) && !digitFlipAssaultRef.current
      ? best.parity
      : config.parity;
    if (nextParity !== config.parity) setDigitFlipParity(nextParity);
    digitFlipRatesRef.current = {
      even: best.signal.evenPercentage,
      odd: best.signal.oddPercentage,
    };
    digitFlipConfigRef.current = {
      ...digitFlipConfigRef.current,
      symbol: best.signal.symbol,
      parity: nextParity,
    };
    return "selected";
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
    const newlySettled = unprocessedDigitFlipSettlements(
      latestRows,
      digitFlipClaimedHistoryIdsRef.current,
      watch.knownIds,
      watch.processedIds,
    );
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
    if (digitFlipActionLockRef.current) return false;
    if (!isConnected) {
      setConnectionMessage({ kind: "info", text: "DigitFlip remains active and is waiting for the Deriv connection." });
      await sleep(1_000);
      return false;
    }
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
      setConnectionMessage({ kind: "info", text: "DigitFlip remains active and is waiting for the account balance to refresh." });
      await sleep(1_000);
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
    const watch = digitFlipMartingaleWatchRef.current;
    if (config.stakeMode === "martingale" && watch) {
      const newlySettled = unprocessedDigitFlipSettlements(
        latestRows,
        digitFlipClaimedHistoryIdsRef.current,
        watch.knownIds,
        watch.processedIds,
      );
      let nextStake = digitFlipNextStakeRef.current;
      for (const trade of newlySettled) {
        nextStake = nextStakeAfterSettlement(trade.profit, nextStake, config.stake, config.multiplier);
        watch.processedIds.add(String(trade.contract_id));
      }
      digitFlipNextStakeRef.current = nextStake;
    }
    const amount = config.stakeMode === "martingale"
      ? digitFlipNextStakeRef.current
      : config.stake;
    if (amount > declaredAccountBalance || (currentAccountBalance != null && amount > currentAccountBalance)) {
      setConnectionMessage({ kind: "info", text: "DigitFlip remains active and is waiting for enough balance for the selected stake." });
      await sleep(1_000);
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
        const contractId = String(result.buy.contract_id);
        claimFeatureRows("digit-flip", digitFlipClaimedHistoryIdsRef.current, [contractId]);
        setDigitFlipPendingHistoryIds((current) => new Set(current).add(contractId));
      }
      setConnectionMessage(null);
      setDigitFlipTradeCount((value) => value + 1);
      void refreshTradeResults();
      return true;
    } catch (error) {
      if (isConfirmedNoContractRejection(error)) {
        setConnectionMessage(null);
        await sleep(5_000);
      } else if (error instanceof ApiTransportError && error.tradeOutcomeUncertain) {
        digitFlipRunningRef.current = false;
        setDigitFlipRunning(false);
        setConnectionMessage({
          kind: "error",
          text: `${error.message} DigitFlip is paused and will not retry until the account history is checked.`,
        });
      } else if (/global trading protection/i.test(errorMessage(error))) {
        digitFlipRunningRef.current = false;
        setDigitFlipRunning(false);
        setConnectionMessage({
          kind: "error",
          text: "Global trading protection is holding this setup. DigitFlip stopped before another order.",
        });
      } else {
        setConnectionMessage({ kind: "error", text: errorMessage(error) });
      }
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
        const selection = await chooseDigitFlipSetup(digitFlipMagicRef.current);
        if (selection !== "selected") {
          setConnectionMessage(selection === "market-selection-failed"
            ? { kind: "error", text: "DigitFlip could not switch to the scanned market. No trade was sent." }
            : { kind: "info", text: `Standby is waiting for a market with an ${DIGIT_FLIP_SIGNAL_FLOOR}% observed parity signal.` });
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
    setClockWorkAiEnabled(false);
    setClockWorkRunning(false);
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
      digitFlipRows
        .filter((trade) => !isDerivHistoryOpen(trade.status))
        .forEach((trade) => next.add(String(trade.contract_id)));
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
      setClockWorkAiEnabled(false);
      setClockWorkRunning(false);
      digitFlipRunningRef.current = false;
      setDigitFlipRunning(false);
      stop();
      autoSwitchRef.current = false;
      setAutoSwitch(false);
      void selectMarket(tradeXSymbol);
      return;
    }
    notifyTradeX("Trade X paused.");
  };

  const toggleClockWork = (enabled: boolean) => {
    if (enabled && !canUseClockWork) return;
    if (enabled && !isConnected) {
      setConnectionMessage({ kind: "error", text: "Connect Deriv before enabling Clock Work." });
      return;
    }
    setClockWorkEnabled(enabled);
    if (!enabled) {
      setClockWorkAiEnabled(false);
      setClockWorkRunning(false);
      setClockWorkAiStatus("Clock Work is stopped. Open contracts can continue to settle.");
      return;
    }
    deactivateMoneyBank();
    deactivateCashGrab();
    toggleXTrader(false);
    setTradeXEnabled(false);
    setDigitFlipEnabled(false);
    setBulkTraderEnabled(false);
    runningRef.current = false;
    digitFlipRunningRef.current = false;
    setRunning(false);
    setDigitFlipRunning(false);
    autoSwitchRef.current = false;
    setAutoSwitch(false);
    setClockWorkAiEnabled(false);
    setClockWorkRunning(false);
    setClockWorkStatusMessage(null);
    clockWorkAiAttemptAtRef.current = 0;
    setClockWorkAiStatus("Ai Clock is off.");
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
    setClockWorkAiEnabled(false);
    setClockWorkRunning(false);
    runningRef.current = false;
    digitFlipRunningRef.current = false;
    setRunning(false);
    setDigitFlipRunning(false);
    autoSwitchRef.current = false;
    setAutoSwitch(false);
    void selectMarket(bulkTraderSymbol);
  };

  const executeClockWorkOrder = async (contract: ClockWorkContractOrder) => {
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
    setClockWorkAiStatus("Sending the AI-selected order to Deriv.");
    try {
      const result = await clockWorkBuyMutation.mutateAsync({ data: { contracts: [contract] } });
      for (const contract of result.contracts) {
        claimFeatureRows("clock-work", clockWorkClaimedHistoryIdsRef.current, [String(contract.buy.contract_id)]);
      }
      setClockWorkStatusMessage(result.message);
      refreshTradeResults();
      if (!result.ok) {
        clockWorkAiAttemptAtRef.current = Date.now() + (result.contracts.length > 0 ? 5_000 : 2_000);
        setClockWorkAiStatus(result.contracts.length > 0
          ? "Order submitted. Ai Clock is waiting for it to settle."
          : "No order was accepted. Ai Clock will check again.");
      } else {
        setClockWorkAiStatus("Order submitted. Waiting for settlement before checking again.");
      }
      return result.ok;
    } catch (error) {
      const message = errorMessage(error);
      if (isConfirmedNoContractRejection(error)) {
        setConnectionMessage(null);
        setClockWorkStatusMessage(null);
        setClockWorkAiStatus("Deriv did not accept the order. Ai Clock will check again.");
        clockWorkAiAttemptAtRef.current = Date.now() + 5_000;
      } else {
        setClockWorkStatusMessage(message);
        setClockWorkRunning(false);
        setClockWorkAiStatus("Ai Clock paused. Check Deriv history before starting again.");
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
    const amount = roundTradeStakeToCents(bulkTraderStake);
    const orderError = validateBulkTraderEntry({
      stake: amount,
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
        amount,
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
      || roundTradeStakeToCents(bulkTraderStake) * bulkTraderCount > currentAccountBalanceRef.current
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
    || moneyBankStarting
    || clockWorkRunning;
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

  clockWorkAutomationRef.current = () => {
    if (!clockWorkEnabled || !clockWorkAiEnabled || !clockWorkRunning) return;
    if (!canUseClockWork) {
      setClockWorkAiEnabled(false);
      setClockWorkRunning(false);
      setClockWorkAiStatus("Clock Work access is unavailable. Ai Clock has stopped.");
      return;
    }
    if (!isConnected || !currentAccount) {
      setClockWorkAiStatus("Waiting for the Clock Work account connection.");
      return;
    }
    if (isReal && !status.data?.live_trading_enabled) {
      setClockWorkAiStatus("Live-account trading is disabled for this workspace.");
      return;
    }
    if (Date.now() < clockWorkAiAttemptAtRef.current) return;
    if (clockWorkActionLockRef.current || clockWorkBuyMutation.isPending) return;
    if (tradeSlotBlocked) {
      setClockWorkAiStatus(tradeSlotMessage ?? "Waiting for open contracts to settle.");
      return;
    }
    if (clockWorkCurrentQuote == null || clockWorkTickEpoch == null) {
      setClockWorkAiStatus("Waiting for fresh market data.");
      return;
    }
    const quoteAgeMs = Date.now() - Number(clockWorkTickEpoch) * 1_000;
    if (!Number.isFinite(quoteAgeMs) || quoteAgeMs < -10_000 || quoteAgeMs > 60_000) {
      setClockWorkAiStatus("Waiting for fresh market data.");
      return;
    }
    if (!clockWorkAiCandidate) {
      setClockWorkAiStatus(clockWorkQuoteHistory.length < CLOCK_WORK_AI_MIN_SAMPLE_COUNT * CLOCK_WORK_AI_DURATION_TICKS + 1
        ? "Collecting recent market history before trading."
        : "Waiting for a qualifying setup.");
      return;
    }
    if (currentAccountBalance == null) {
      setClockWorkAiStatus("Waiting for the selected account balance.");
      return;
    }
    const amount = roundTradeStakeToCents(clockWorkStake);
    if (amount < 1 || amount > currentAccountBalance) {
      setClockWorkAiStatus("The stake is above the available balance. No order was sent.");
      return;
    }

    const contract: ClockWorkContractOrder = {
      key: "ai-clock",
      amount,
      duration: CLOCK_WORK_AI_DURATION_TICKS,
      duration_unit: "t",
      contract_type: clockWorkAiCandidate.direction,
      barrier: clockWorkAiCandidate.barrier,
      symbol: clockWorkSymbol,
    };
    clockWorkAiAttemptAtRef.current = Date.now() + 5_000;
    setClockWorkAiStatus("Ai Clock found a qualifying setup and is sending one entry.");
    void executeClockWorkOrder(contract);
  };
  useEffect(() => {
    if (!clockWorkEnabled || !clockWorkAiEnabled || !clockWorkRunning) return;
    const timer = window.setInterval(() => clockWorkAutomationRef.current?.(), 1_000);
    return () => window.clearInterval(timer);
  }, [clockWorkEnabled, clockWorkAiEnabled, clockWorkRunning]);

  return (
    <main className="xt-app">
      <header className="xt-header">
        <div className="xt-header-leading">
          <div className="xt-brand">
            <span aria-hidden="true">S</span>
            <div className="xt-brand-copy">
              <div className="xt-brand-heading">
                <strong>Shadow</strong>
                <small>AI Trading</small>
              </div>
            </div>
          </div>
        </div>
        <div className="xt-header-status-actions">
          <div
            className={`xt-connection ${isConnected ? "online" : ""}`}
            aria-label={`API Connection ${statusText}`}
            aria-live="polite"
            data-testid="status-api-connection"
          >
            <i aria-hidden="true" />
            <span>API Connection</span>
            <strong>{statusText}</strong>
          </div>
          <NotificationCenter
            notifications={notifications}
            unreadCount={unreadNotificationCount}
            onMarkRead={markNotificationRead}
            onDismiss={dismissNotification}
            onMarkAllRead={markAllNotificationsRead}
          />
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
            onAccountSelectError={(message) => {
              addNotification(
                "account",
                "Account switch failed",
                message || "Deriv could not switch accounts. Your previous account remains selected; check the connection and try again.",
              );
            }}
          />
        </div>
      </header>

      <nav className="xt-home-navigation" aria-label="Dashboard navigation">
        <Link href="/app" aria-current="page" data-testid="link-trading-dashboard"><Gauge size={15} />Trading dashboard</Link>
        {canUseSettings && <Link href="/settings" data-testid="link-settings"><Settings size={15} />Settings</Link>}
        {accessSession.data?.is_admin === true && (
          <Link href="/admin/users" data-testid="link-admin-panel"><ShieldCheck size={15} />Admin panel</Link>
        )}
        <Link
          href="/auto-trader"
          data-testid="link-home-auto-trader"
          className={canUseAutoTrader ? "" : "xt-home-navigation-link-restricted"}
        >
          <Bot size={15} />Auto Trader
          {!canUseAutoTrader && <span><FeatureStatusText control={featureControl("auto-trader")} isAdmin={isAdmin} fallback="Restricted — admin access only" /></span>}
        </Link>
        <Link
          href="/auto-trader-2"
          data-testid="link-home-auto-trader-2"
          className={canUseAutoTrader2 ? "" : "xt-home-navigation-link-restricted"}
        >
          <Bot size={15} />Auto Trader 2.0
          {!canUseAutoTrader2 && <span><FeatureStatusText control={featureControl("auto-trader-2")} isAdmin={isAdmin} fallback="Restricted — admin access only" /></span>}
        </Link>
        <button
          type="button"
          data-testid="button-logout"
          onClick={handleLogout}
          disabled={isLoggingOut}
        >
          <LogOut size={15} />{isLoggingOut ? "Logging out…" : "Log out"}
        </button>
      </nav>

      <section className="xt-connect-card" id="account-connection">
        <div className="xt-section-title"><LockKeyhole size={17} /><div><b>Brokerage API Connection</b></div></div>
         {!canUseDeriv ? (
           <div className="xt-restricted-message"><ShieldAlert size={17} /><span>Restricted — admin access only. This key has not been granted a trading feature.</span></div>
         ) : !connectedToken ? (
          <form onSubmit={connectPat} className="xt-pat-form">
            <input type="password" value={pat} onChange={(event) => setPat(event.target.value)} placeholder="Paste your Deriv PAT token" autoComplete="off" />
            <button disabled={!pat.trim() || tokenMutation.isPending}>{tokenMutation.isPending ? <Loader2 className="spin" size={16} /> : <Power size={16} />}{tokenMutation.isPending ? "Connecting…" : "Active Connect"}</button>
          </form>
        ) : (
          <div className="xt-connected-row">
            <button onClick={() => void disconnect()} disabled={deleteTokenMutation.isPending}>Disconnect</button>
          </div>
        )}
      </section>

      {adminFeatureSettings.data?.global_announcement_enabled
        && adminFeatureSettings.data.global_announcement.trim()
        && (
          <div className="global-announcement-frame" data-testid="global-announcement-frame">
            <GlobalFeatureAnnouncement
              message={adminFeatureSettings.data.global_announcement}
              revision={adminFeatureSettings.data.global_announcement_revision}
              viewerId={accessSession.data?.key_id ?? "anonymous"}
              identityResolved={accessSession.isFetched}
            />
          </div>
        )}
      <h2 className="xt-trading-strategies-heading">Trading Strategies</h2>

      <section className={`xt-feature-card xt-feature-card-clock-work ${!canUseClockWork ? "xt-feature-card-restricted" : ""}`} id="clock-work-feature">
        <div><Clock3 size={18} /><span><b>Clock Work</b><small><FeatureStatusText control={featureControl("clock-work")} isAdmin={isAdmin} fallback={canUseClockWork ? "Ai Clock · 5-tick Higher / Lower" : "Restricted — admin access only"} /></small></span></div>
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

      {canUseDigitFlip && canViewHistory && shouldShowFeatureHistoryWhenStopped(
        digitFlipEnabled,
        digitFlipOwnedRows,
        digitFlipPendingHistoryIds,
      ) && (
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
            isPlacingTrade={tradeXSubmitting || anyContractBuyPending}
            isRefreshingAnalysis={analysisTickCount === 0 && !isConnected}
            disabled={running || !isConnected || tradeSlotBlocked || tradeXSubmitting || anyContractBuyPending}
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
             onPlaceTrade={() => void executeTradeX(1, tradeXDuration)}
            onAiScan={runTradeXAiScanner}
            onRefreshAnalysis={refreshAnalysis}
          />
          {canViewHistory && <DerivHistory title="Trade X History" strategy="Trade X Strategy" rows={tradeXRows} sessionRows={tradeXVisibleSessionRows} currency={currentAccount?.currency} clearArmed={tradeXHistoryClearArmed} fading={historyFading} onClear={clearTradeXHistory} />}
        </section>
      )}

       {edge2Enabled && canUseMoneyBank && (
        <MoneyBankPanel
          isConnected={isConnected}
          tradeSlotBlocked={tradeSlotBlocked}
          running={moneyBankRunning}
          starting={moneyBankStarting}
          closing={moneyBankClosing}
          symbol={moneyBankSymbol}
          markets={moneyBankMarkets}
          onSymbolChange={(next) => {
            setMoneyBankSymbol(next);
            void selectMarket(next);
          }}
          accountBalance={currentAccountBalance}
          currency={currentAccount?.currency ?? "USD"}
          quote={moneyBankSelectedSignal?.quote}
          marketSignal={moneyBankSelectedSignal}
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
          starting={cashGrabStarting}
          scannerBusy={cashGrabScannerBusy}
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

      {clockWorkEnabled && canUseClockWork && (
        <section className="xt-bottom-feature">
          <ClockWorkPanel
            enabled={clockWorkEnabled}
            symbol={clockWorkSymbol}
            markets={clockWorkSymbols}
            onSymbolChange={(next) => {
              clockWorkMarketResetEpochRef.current = Math.floor(Date.now() / 1000);
              setClockWorkQuoteBuffer({ symbol: next, quotes: [], lastTickId: null });
              clockWorkAiAttemptAtRef.current = 0;
              setClockWorkSymbol(next);
              setClockWorkAiStatus("The selected market changed. Fresh live data is loading.");
              void selectMarket(next);
            }}
            stake={clockWorkStake}
            onStakeChange={(value) => setClockWorkStake(roundTradeStakeToCents(Math.max(1, value)))}
            aiEnabled={clockWorkAiEnabled}
            onAiEnabledChange={(enabled) => {
              setClockWorkAiEnabled(enabled);
              setClockWorkStatusMessage(null);
              if (!enabled) {
                setClockWorkRunning(false);
                setClockWorkAiStatus("Ai Clock is off. Open contracts can continue to settle.");
              } else {
                setClockWorkAiStatus("Ai Clock is ready. Start Clock Work when you want to begin.");
              }
            }}
            running={clockWorkRunning}
            busy={clockWorkBusy || clockWorkBuyMutation.isPending}
            disabled={clockWorkControlsDisabled}
            aiStatus={clockWorkAiStatus}
            statusMessage={clockWorkStatusMessage}
            currency={currentAccount?.currency ?? "USD"}
            onStart={() => {
              if (!clockWorkAiEnabled || clockWorkControlsDisabled) return;
              clockWorkAiAttemptAtRef.current = 0;
              setClockWorkRunning(true);
              setClockWorkAiStatus("Ai Clock is monitoring the selected market.");
            }}
            onStop={() => {
              setClockWorkRunning(false);
              setClockWorkAiStatus("Clock Work stopped. Open contracts can continue to settle.");
            }}
          />
          {canViewHistory && (
            <DerivHistory
              title="Clock Work History"
              strategy="Ai Clock"
              summaryMode="pnl-only"
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
              <div><BookOpen size={18} /><span><b>{guideMode === "trade-x" ? "Trade X Guide" : guideMode === "digit-flip" ? "DigitFlip Guide" : guideMode === "bulk-trader" ? "Bulk Trader Guide" : guideMode === "money-bank" ? "Money Bank Guide" : guideMode === "cash-grab" ? "Cash Grab Guide" : guideMode === "clock-work" ? "Clock Work Guide" : "EDGE Guide"}</b><small>Page {guidePage + 1} of {activeGuidePages.length}</small></span></div>
              <button type="button" aria-label="Close guide" onClick={() => setGuideOpen(false)}><X size={17} /></button>
            </header>
            <div className="xt-guide-progress"><span style={{ width: `${((guidePage + 1) / activeGuidePages.length) * 100}%` }} /></div>
            <article className="xt-guide-page">
               <small className="xt-guide-kicker">{guideMode === "trade-x" ? "TRADE X FIELD GUIDE" : guideMode === "digit-flip" ? "DIGITFLIP FIELD GUIDE" : guideMode === "bulk-trader" ? "BULK TRADER FIELD GUIDE" : guideMode === "money-bank" ? "MONEY BANK FIELD GUIDE" : guideMode === "cash-grab" ? "CASH GRAB FIELD GUIDE" : guideMode === "clock-work" ? "CLOCK WORK FIELD GUIDE" : "EDGE FIELD GUIDE"}</small>
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
                  guideMode === "trade-x" ? toggleTradeX(true) : guideMode === "digit-flip" ? toggleDigitFlip(true) : guideMode === "bulk-trader" ? toggleBulkTrader(true) : guideMode === "money-bank" ? toggleMoneyBank(true) : guideMode === "cash-grab" ? toggleCashGrab(true) : guideMode === "clock-work" ? toggleClockWork(true) : toggleXTrader(true);
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