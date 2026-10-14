import TradeXPanel from "./_TradeXPanelReference";
import "./_group.css";

const distribution = [
  { digit: 0, percentage: 0, streak: 8, momentum: "up" as const, sampleCount: 8 },
  { digit: 1, percentage: 12.5, streak: 6, momentum: "down" as const, sampleCount: 8 },
  { digit: 2, percentage: 12.5, streak: 2, momentum: "flat" as const, sampleCount: 8 },
  { digit: 3, percentage: 25, streak: 0, momentum: "down" as const, sampleCount: 8 },
  { digit: 4, percentage: 0, streak: 8, momentum: "up" as const, sampleCount: 8 },
  { digit: 5, percentage: 0, streak: 8, momentum: "up" as const, sampleCount: 8 },
  { digit: 6, percentage: 0, streak: 8, momentum: "up" as const, sampleCount: 8 },
  { digit: 7, percentage: 0, streak: 8, momentum: "up" as const, sampleCount: 8 },
  { digit: 8, percentage: 12.5, streak: 4, momentum: "flat" as const, sampleCount: 8 },
  { digit: 9, percentage: 37.5, streak: 1, momentum: "flat" as const, sampleCount: 8 },
];

export default function Reference() {
  return (
    <main className="trade-x-reference-frame">
      <TradeXPanel
        enabled
        marketType="volatility"
        symbol="R_25"
        tradeType="DIGITDIFF"
        stake={1}
        selectedDigit={0}
        duration={1}
        manualSelectMode
        distribution={distribution}
        rankedSafestDigits={[0, 4, 5]}
        analysisTickCount={8}
        analysisUpdatedAt="8 ticks"
        lastDigit={3}
        onMarketTypeChange={() => {}}
        onSymbolChange={() => {}}
        onTradeTypeChange={() => {}}
        onStakeChange={() => {}}
        onSelectedDigitChange={() => {}}
        onDurationChange={() => {}}
        onManualSelectModeChange={() => {}}
        onTradeSelect={() => {}}
        onPlaceTrade={() => {}}
        onAiScan={async () => "Preview only"}
        onRefreshAnalysis={() => {}}
      />
    </main>
  );
}
