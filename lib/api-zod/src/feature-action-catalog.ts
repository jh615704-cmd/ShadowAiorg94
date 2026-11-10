import type { AccessFeature } from "./generated/types/accessFeature";

export type FeatureActionDefinition = {
  feature: AccessFeature;
  control_id: string;
  label: string;
};

const controls: FeatureActionDefinition[] = [];

function add(feature: AccessFeature, control_id: string, label: string) {
  controls.push({ feature, control_id, label });
}

function addMany(
  feature: AccessFeature,
  entries: readonly (readonly [controlId: string, label: string])[],
) {
  entries.forEach(([control_id, label]) => add(feature, control_id, label));
}

function addOptions(
  feature: AccessFeature,
  prefix: string,
  labelPrefix: string,
  options: readonly string[],
) {
  options.forEach((option) => add(
    feature,
    featureActionControlId(prefix, option),
    `${labelPrefix}: ${option}`,
  ));
}

export function featureActionControlId(prefix: string, value: string) {
  return `${prefix}-${value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function featureActionControlIdFromTestId(feature: string, testId: string): string | undefined {
  if (feature === "edge") {
    const edgeDuration = testId.match(/^edge-duration-(\d+)$/)?.[1];
    if (edgeDuration) return `duration-${edgeDuration}`;
  }
  if (feature === "digit-flip") {
    const duration = testId.match(/^digit-flip-duration-(\d+)$/)?.[1];
    if (duration) return `duration-${duration}`;
    if (/switch.*assault/i.test(testId)) return "assault-switch";
    if (/switch.*magic/i.test(testId)) return "magic-switch";
    if (/market-type-auto/i.test(testId)) return "market-type-auto";
    if (/market-type-volatility/i.test(testId)) return "market-type-volatility";
    if (/market-type-jump/i.test(testId)) return "market-type-jumps";
    if (/parity.*even/i.test(testId)) return "parity-even";
    if (/parity.*odd/i.test(testId)) return "parity-odd";
    if (/run|start-stop/i.test(testId)) return "start-stop";
  }
  if (feature === "trade-x") {
    if (testId === "button-market-type-volatility") return "market-family-volatility";
    if (testId === "button-market-type-jumps") return "market-family-jumps";
    if (testId === "button-refresh-trade-x-analysis") return "refresh-analysis";
    if (testId === "button-place-trade-x") return "place-differs";
    const digit = testId.match(/^button-trade-x-digit-(\d+)$/)?.[1];
    if (digit) return `digit-select-${digit}`;
    const rankedDigit = testId.match(/^button-trade-x-ranked-digit-(\d+)$/)?.[1];
    if (rankedDigit) return `ranked-digit-${rankedDigit}`;
    const tappedDigit = testId.match(/^button-trade-x-tap-(\d+)$/)?.[1];
    if (tappedDigit) return `trade-ranked-digit-${tappedDigit}`;
    const duration = testId.match(/^button-trade-x-duration-(\d+)$/)?.[1];
    if (duration) return `duration-${duration}`;
  }
  if (feature === "bulk-trader") {
    const type = testId.match(/^button-type-(over-under|differs)$/)?.[1];
    if (type) return `type-${type}`;
    if (testId === "button-refresh-bulk-analysis") return "refresh-analysis";
    const digit = testId.match(/^button-digit-(\d+)$/)?.[1];
    if (digit) return `digit-${digit}`;
    const prediction = testId.match(/^button-prediction-(\d+)$/)?.[1];
    if (prediction) return `prediction-${prediction}`;
    const duration = testId.match(/^button-duration-(\d+)$/)?.[1];
    if (duration) return `duration-${duration}`;
    const count = testId.match(/^button-count-(\d+)$/)?.[1];
    if (count) return `batch-count-${count}`;
    const trade = testId.match(/^button-trade-(.+)$/)?.[1];
    if (trade) {
      if (trade === "digitover" || trade === "over") return "trade-over";
      if (trade === "digitunder" || trade === "under") return "trade-under";
      if (trade === "digiteven" || trade === "even") return "trade-even";
      if (trade === "digitodd" || trade === "odd") return "trade-odd";
      if (trade === "digitmatch" || trade === "match") return "trade-match";
      if (trade === "digitdiff" || trade === "diff" || trade === "differs") return "trade-differs";
    }
  }
  if (feature === "cash-grab") {
    if (testId === "button-cash-grab-rise") return "direction-rise";
    if (testId === "button-cash-grab-fall") return "direction-fall";
    if (testId === "button-cash-grab-start") return "start";
    if (testId === "button-cash-grab-stop") return "stop";
    if (/switch.*auto.*safe|auto.*switch.*safe/i.test(testId)) return "auto-switch-safe-markets";
    if (/switch.*auto.*direction|auto.*direction/i.test(testId)) return "auto-direction";
    const duration = testId.match(/^cash-grab-duration-(\d+)$/)?.[1];
    if (duration) return `duration-${duration}`;
  }
  if (feature === "jackpot") {
    const group = testId.match(/^button-jackpot-group-(bear|bull|volatility|jump)$/)?.[1];
    if (group) return `market-group-${group}`;
    if (testId === "switch-jackpot-auto-best") return "auto-market";
    if (testId === "switch-jackpot-rise-fall") return "enable-rise-fall";
    if (testId === "switch-jackpot-even-odd") return "enable-even-odd";
    if (testId === "button-jackpot-direction-call") return "rise-fall-call";
    if (testId === "button-jackpot-direction-put") return "rise-fall-put";
    if (testId === "button-jackpot-direction-auto") return "rise-fall-auto";
    if (testId === "button-jackpot-parity-digiteven") return "even-odd-even";
    if (testId === "button-jackpot-parity-digitodd") return "even-odd-odd";
    if (testId === "button-jackpot-parity-auto") return "even-odd-auto";
    if (testId === "switch-jackpot-multiply") return "multiply-after-loss";
    if (testId === "switch-jackpot-ai") return "jackpot-ai";
    if (testId === "button-jackpot-place-batch") return "place-batch";
    if (testId === "button-jackpot-refresh-order-status") return "refresh-order-status";
    const count = testId.match(/^button-jackpot-count-(\d+)$/)?.[1];
    if (count) return `contract-count-${count}`;
    const duration = testId.match(/^button-jackpot-duration-(\d+)$/)?.[1];
    if (duration) return `duration-${duration}`;
  }
  if (feature === "clock-work") {
    if (testId === "button-clock-start") return "start";
    if (testId === "button-clock-stop") return "stop";
    if (testId === "switch-ai-clock") return "ai-clock";
  }
  if (feature === "auto-trader") {
    const filter = testId.match(/^button-filter-(all|regular|jump|one-sec)$/)?.[1];
    if (filter) return `market-filter-${filter}`;
    if (testId === "button-settings") return "settings-toggle";
    if (testId === "switch-auto-magic") return "auto-magic";
    if (testId === "button-rescan") return "rescan";
    if (testId === "button-stop-scan") return "stop";
    if (testId === "button-go-live") return "go-live";
    if (testId === "button-open-guide") return "open-guide";
    if (testId === "button-guide-previous") return "guide-back";
    if (testId === "button-guide-next") return "guide-next";
    if (testId === "button-guide-close") return "guide-close";
    if (testId === "button-retry-status") return "retry-status";
    if (testId === "button-retry-accounts") return "retry-accounts";
    if (testId === "button-dismiss-message") return "dismiss-message";
    if (testId === "button-clear-auto-trader-history") return "clear-history";
    const trade = testId.match(/^button-trade-(3x|6x)-([A-Za-z0-9_]+)-(\d+)$/);
    if (trade) return `trade-${trade[1]}-${trade[2].toLowerCase().replaceAll("_", "-")}-${trade[3]}`;
  }
  if (feature === "auto-trader-2") {
    if (testId === "at2-open-guide") return "open-guide";
    if (testId === "at2-mode-flat") return "stake-mode-flat";
    if (testId === "at2-mode-multiply") return "stake-mode-multiply";
    if (testId === "at2-auto-select") return "auto-select-market";
    if (testId === "at2-ai-enabled") return "ai-filter";
    if (testId === "at2-start") return "start";
    if (testId === "at2-stop") return "stop";
    const family = testId.match(/^at2-contract-(rise-fall|even-odd|differs)$/)?.[1];
    if (family) return family === "differs" ? "contract-family-digit-differs" : `contract-family-${family}`;
    if (testId === "at2-contract-type-rise-fall-auto") return "direction-rise-fall-auto";
    if (testId === "at2-contract-type-even-odd-auto") return "direction-even-odd-auto";
    const contractType = testId.match(/^at2-contract-type-(.+)$/)?.[1];
    if (contractType === "call") return "direction-rise-fall-rise";
    if (contractType === "put") return "direction-rise-fall-fall";
    if (contractType === "digiteven") return "direction-even-odd-even";
    if (contractType === "digitodd") return "direction-even-odd-odd";
  }
  return undefined;
}

function addMarketOptions(feature: AccessFeature, options: readonly (readonly [string, string])[]) {
  options.forEach(([symbol, label]) => add(
    feature,
    featureActionControlId("market", symbol),
    `Select market: ${label}`,
  ));
}

const markets = [
  ["R_10", "Volatility 10"],
  ["R_25", "Volatility 25"],
  ["R_50", "Volatility 50"],
  ["R_75", "Volatility 75"],
  ["R_100", "Volatility 100"],
  ["1HZ10V", "Volatility 10 (1s)"],
  ["1HZ15V", "Volatility 15 (1s)"],
  ["1HZ25V", "Volatility 25 (1s)"],
  ["1HZ30V", "Volatility 30 (1s)"],
  ["1HZ50V", "Volatility 50 (1s)"],
  ["1HZ75V", "Volatility 75 (1s)"],
  ["1HZ90V", "Volatility 90 (1s)"],
  ["1HZ100V", "Volatility 100 (1s)"],
  ["JD10", "Jump 10"],
  ["JD25", "Jump 25"],
  ["JD50", "Jump 50"],
  ["JD75", "Jump 75"],
  ["JD100", "Jump 100"],
] as const;
const tradeXMarkets = markets;
const digits = Array.from({ length: 10 }, (_, digit) => String(digit));
const durations = ["1", "2", "3", "4", "5"];
const historyFeatures: AccessFeature[] = [
  "edge",
  "digit-flip",
  "trade-x",
  "bulk-trader",
  "jackpot",
  "clock-work",
  "cash-grab",
  "money-bank",
  "auto-trader-2",
  "speedbot",
];

for (const feature of historyFeatures) {
  addMany(feature, [
    ["history-filter-all", "History filter: All"],
    ["history-filter-win", "History filter: Wins"],
    ["history-filter-loss", "History filter: Losses"],
    ["history-clear", "Clear feature history"],
  ]);
}

for (const feature of ["edge", "digit-flip", "trade-x", "bulk-trader", "jackpot", "clock-work", "cash-grab", "money-bank", "speedbot"] as const) {
  addMany(feature, [
    ["feature-toggle", "Show or hide feature"],
    ["open-guide", "Open feature guide"],
    ["guide-close", "Close feature guide"],
    ["guide-back", "Previous guide page"],
    ["guide-next", "Next guide page"],
    ["guide-start", "Start from feature guide"],
  ]);
}

addMany("speedbot", [
  ["start", "Start Speedbot"],
  ["stop", "Stop Speedbot"],
  ["market", "Select Speedbot market"],
  ["stake", "Set Speedbot stake"],
  ["duration", "Set Speedbot duration"],
  ["take-profit", "Set Speedbot take-profit limit"],
  ["loss-limit", "Set Speedbot loss limit"],
]);

addMany("edge", [
  ["ai-scanner", "AI Scanner"],
  ["market-picker", "Open market choices"],
  ["market-auto-best", "Choose Auto Best market"],
  ["auto-select-best", "Auto-select best market switch"],
  ["sniper-over-under", "Sniper Over/Under switch"],
  ["direction-over", "Choose Over"],
  ["direction-under", "Choose Under"],
  ["start", "Start EDGE run"],
  ["stop", "Stop EDGE run"],
  ["reset", "Reset EDGE session"],
  ["trade-over", "Trade Over"],
  ["trade-dual", "Trade Dual"],
  ["trade-under", "Trade Under"],
]);
addMarketOptions("edge", markets);
addOptions("edge", "duration", "Choose duration", durations);
addOptions("edge", "digit", "Choose digit", digits);

addMany("digit-flip", [
  ["ai-scanner", "AI Scanner"],
  ["market-type-auto", "Auto-select best market"],
  ["parity-even", "Choose Even"],
  ["parity-odd", "Choose Odd"],
  ["assault-switch", "Assault switch"],
  ["magic-switch", "Magic switch"],
  ["start-stop", "Start or stop DigitFlip"],
]);
addMarketOptions("digit-flip", markets);
addOptions("digit-flip", "duration", "Choose duration", durations);

addMany("trade-x", [
  ["ai-scanner", "AI Scanner"],
  ["market-family-volatility", "Choose Volatility market family"],
  ["market-family-jumps", "Choose Jump market family"],
  ["refresh-analysis", "Refresh digit analysis"],
  ["place-differs", "Place Digit Differs trade"],
]);
addOptions("trade-x", "digit-select", "Select digit", digits);
addOptions("trade-x", "ranked-digit", "Select ranked digit", digits);
addOptions("trade-x", "trade-ranked-digit", "Trade ranked digit", digits);
addOptions("trade-x", "duration", "Choose duration", durations);

addMany("bulk-trader", [
  ["ai-scanner", "AI Scanner"],
  ["type-over-under", "Choose Over / Under trade type"],
  ["type-differs", "Choose Differs trade type"],
  ["refresh-analysis", "Refresh live analysis"],
  ["trade-over", "Trade Over"],
  ["trade-under", "Trade Under"],
  ["trade-even", "Trade Even"],
  ["trade-odd", "Trade Odd"],
  ["trade-match", "Trade Match"],
  ["trade-differs", "Trade Differs"],
]);
addMarketOptions("bulk-trader", markets);
addOptions("bulk-trader", "digit", "Select current digit", digits);
addOptions("bulk-trader", "prediction", "Choose prediction", digits);
addOptions("bulk-trader", "duration", "Choose duration", durations);
addOptions("bulk-trader", "batch-count", "Choose batch size", ["1", "2", "3", "4", "5", "6"]);

addMany("cash-grab", [
  ["auto-switch-safe-markets", "Auto-switch safe markets"],
  ["auto-direction", "Auto Direction switch"],
  ["market-picker", "Open market choices"],
  ["market-auto-best", "Choose Auto Best market"],
  ["direction-rise", "Choose Rise"],
  ["direction-fall", "Choose Fall"],
  ["stake-mode-flat", "Choose Flat stake"],
  ["stake-mode-multiply", "Choose Multiply stake"],
  ["ai-scanner", "AI Scanner"],
  ["start", "Start Cash Grab"],
  ["stop", "Stop Cash Grab"],
]);
addMarketOptions("cash-grab", markets);
addOptions("cash-grab", "duration", "Choose duration", durations);

addMany("jackpot", [
  ["auto-market", "Auto Best market switch"],
  ["enable-rise-fall", "Enable Rise/Fall contracts"],
  ["enable-even-odd", "Enable Even/Odd contracts"],
  ["rise-fall-call", "Choose Rise"],
  ["rise-fall-put", "Choose Fall"],
  ["rise-fall-auto", "Choose automatic Rise/Fall"],
  ["even-odd-even", "Choose Even"],
  ["even-odd-odd", "Choose Odd"],
  ["even-odd-auto", "Choose automatic Even/Odd"],
  ["multiply-after-loss", "Multiply stake after a loss"],
  ["jackpot-ai", "Jackpot AI switch"],
  ["place-batch", "Place Jackpot batch"],
  ["refresh-order-status", "Refresh order status"],
]);
addOptions("jackpot", "market-group", "Choose market group", ["Bear", "Bull", "Volatility", "Jump"]);
addOptions("jackpot", "contract-count", "Choose contract count", Array.from({ length: 20 }, (_, i) => String(i + 1)));
addOptions("jackpot", "duration", "Choose duration", durations);

addMany("clock-work", [
  ["ai-clock", "AI Clock switch"],
  ["direction-higher", "Choose Higher"],
  ["direction-lower", "Choose Lower"],
  ["start", "Start Clock Work"],
  ["stop", "Stop Clock Work"],
]);

addMany("money-bank", [
  ["strategy-budget", "Choose Auto Budget strategy"],
  ["strategy-manual", "Choose Manual strategy"],
  ["reinvest-profit", "Reinvest profit switch"],
  ["start-stop", "Start or stop Money Bank"],
  ["history-download", "Download Money Bank history"],
]);
addOptions("money-bank", "growth-rate", "Choose growth rate", ["1%", "2%", "3%", "4%", "5%"]);
addOptions("money-bank", "quick-tick-target", "Choose quick tick target", ["1 ticks", "5 ticks"]);

addMany("auto-trader", [
  ["open-guide", "Open Auto Trader guide"],
  ["guide-close", "Close Auto Trader guide"],
  ["guide-back", "Previous guide page"],
  ["guide-next", "Next guide page"],
  ["settings-toggle", "Open or close Auto Trader settings"],
  ["auto-magic", "Auto Magic switch"],
  ["rescan", "Rescan markets"],
  ["stop", "Stop Auto Trader"],
  ["go-live", "Go Live"],
  ["trade-over", "Trade Over"],
  ["trade-under", "Trade Under"],
  ["retry-status", "Retry account status"],
  ["retry-accounts", "Retry accounts"],
  ["dismiss-message", "Dismiss trade message"],
  ["clear-history", "Clear Auto Trader history"],
]);
addMany("auto-trader", [
  ["market-filter-all", "Filter markets: All markets"],
  ["market-filter-regular", "Filter markets: Volatility"],
  ["market-filter-jump", "Filter markets: Jump"],
  ["market-filter-one-sec", "Filter markets: Volatility 1s"],
]);
const autoTraderMarkets = markets.filter(([symbol]) => !["1HZ15V", "1HZ30V", "1HZ90V"].includes(symbol));
for (const [symbol, label] of autoTraderMarkets) {
  for (const digit of digits) {
    add("auto-trader", `trade-3x-${symbol.toLowerCase().replaceAll("_", "-")}-${digit}`, `Place three contracts: ${label}, digit ${digit}`);
    add("auto-trader", `trade-6x-${symbol.toLowerCase().replaceAll("_", "-")}-${digit}`, `Place six contracts: ${label}, digit ${digit}`);
  }
}

addMany("auto-trader-2", [
  ["open-guide", "Open Auto Trader 2.0 guide"],
  ["guide-close", "Close Auto Trader 2.0 guide"],
  ["guide-back", "Previous guide page"],
  ["guide-next", "Next guide page"],
  ["start", "Start Auto Trader 2.0"],
  ["stop", "Stop Auto Trader 2.0"],
  ["auto-select-market", "Automatically select a market"],
  ["ai-filter", "AI 2 observed-data filter"],
  ["stake-mode-flat", "Choose Flat stake"],
  ["stake-mode-multiply", "Choose Multiply after loss"],
]);
addOptions("auto-trader-2", "contract-family", "Choose contract family", ["Rise/Fall", "Even/Odd", "Digit Differs"]);
addOptions("auto-trader-2", "direction-rise-fall", "Choose Rise/Fall direction", ["Rise", "Fall", "Auto"]);
addOptions("auto-trader-2", "direction-even-odd", "Choose Even/Odd direction", ["Even", "Odd", "Auto"]);

export const FEATURE_ACTION_CATALOG: readonly FeatureActionDefinition[] = controls;

export function featureActionKey(feature: string, controlId: string) {
  return `${feature}/${controlId}`;
}

export function featureActionAttributes(feature: string, controlId: string) {
  return { "data-feature-action": featureActionKey(feature, controlId) } as const;
}
