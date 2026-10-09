export type AutoTrader2Family = "differs" | "rise-fall" | "even-odd";
export type AutoTrader2ContractType = "DIGITDIFF" | "CALL" | "PUT" | "DIGITEVEN" | "DIGITODD";

export type AutoTrader2Signal = {
  symbol: string;
  sample_count: number;
  recent_digits: number[];
  rise_percentage?: number;
  fall_percentage?: number;
};

export type AutoTrader2Candidate = {
  symbol: string;
  contractType: AutoTrader2ContractType;
  barrier?: number;
  observedRate: number;
  sampleCount: number;
  edgeOverBaseline: number;
};

export const AUTO_TRADER_2_MIN_SAMPLE = 20;
export const AUTO_TRADER_2_MIN_EDGE = 4;

function candidatesForSignal(
  signal: AutoTrader2Signal,
  family: AutoTrader2Family | "recovery",
  barrier: number,
  preferredType: AutoTrader2ContractType,
  minimumSample: number,
  minimumEdge: number,
): AutoTrader2Candidate[] {
  const digits = signal.recent_digits.filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
  const sampleCount = Math.min(signal.sample_count, digits.length);
  if (!Number.isFinite(sampleCount) || sampleCount < minimumSample) return [];

  const types: AutoTrader2ContractType[] = family === "recovery"
    ? ["CALL", "PUT", "DIGITEVEN", "DIGITODD"]
    : family === "differs"
      ? ["DIGITDIFF"]
      : family === "rise-fall"
        ? ["CALL", "PUT"]
        : ["DIGITEVEN", "DIGITODD"];
  const candidates: AutoTrader2Candidate[] = [];

  for (const contractType of types) {
    if (family !== "recovery" && family === "differs") {
      for (let selectedBarrier = 0; selectedBarrier <= 9; selectedBarrier += 1) {
        const observedRate = ((sampleCount - digits.filter((digit) => digit === selectedBarrier).length) / sampleCount) * 100;
        const edgeOverBaseline = observedRate - 90;
        if (edgeOverBaseline >= minimumEdge) {
          candidates.push({
            symbol: signal.symbol,
            contractType,
            barrier: selectedBarrier,
            observedRate,
            sampleCount,
            edgeOverBaseline,
          });
        }
      }
      continue;
    }

    let observedRate: number;
    let baseline: number;
    if (contractType === "CALL" || contractType === "PUT") {
      observedRate = Number(contractType === "CALL" ? signal.rise_percentage : signal.fall_percentage);
      baseline = 50;
    } else {
      const evenCount = digits.filter((digit) => digit % 2 === 0).length;
      observedRate = contractType === "DIGITEVEN"
        ? (evenCount / sampleCount) * 100
        : ((sampleCount - evenCount) / sampleCount) * 100;
      baseline = 50;
    }
    const edgeOverBaseline = observedRate - baseline;
    if (Number.isFinite(observedRate) && observedRate <= 100 && edgeOverBaseline >= minimumEdge) {
      candidates.push({ symbol: signal.symbol, contractType, observedRate, sampleCount, edgeOverBaseline });
    }
  }

  return candidates;
}

export function chooseAutoTrader2Candidate(input: {
  signals: readonly AutoTrader2Signal[];
  family: AutoTrader2Family | "recovery";
  preferredType: AutoTrader2ContractType;
  barrier: number;
  selectedMarket: string;
  autoSelect: boolean;
  minimumSample?: number;
  minimumEdge?: number;
}): AutoTrader2Candidate | null {
  const minimumSample = input.minimumSample ?? AUTO_TRADER_2_MIN_SAMPLE;
  const minimumEdge = input.minimumEdge ?? AUTO_TRADER_2_MIN_EDGE;
  const signals = input.signals.filter((signal) => input.autoSelect || signal.symbol === input.selectedMarket);
  const candidates = signals.flatMap((signal) => candidatesForSignal(
    signal,
    input.family,
    input.barrier,
    input.preferredType,
    minimumSample,
    minimumEdge,
  ));

  candidates.sort((left, right) =>
    right.edgeOverBaseline - left.edgeOverBaseline
    || right.sampleCount - left.sampleCount
    || left.symbol.localeCompare(right.symbol)
    || (left.barrier ?? -1) - (right.barrier ?? -1)
    || left.contractType.localeCompare(right.contractType),
  );
  return candidates[0] ?? null;
}

