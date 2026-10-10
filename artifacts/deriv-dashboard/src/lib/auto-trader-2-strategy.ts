export type AutoTrader2Family = "differs" | "rise-fall" | "even-odd";
export type AutoTrader2ContractType = "DIGITDIFF" | "CALL" | "PUT" | "DIGITEVEN" | "DIGITODD";

export type AutoTrader2Signal = {
  symbol: string;
  sample_count: number;
  recent_digits: number[];
  recent_quotes?: number[];
  rise_percentage?: number;
  fall_percentage?: number;
};

export type AutoTrader2Candidate = {
  symbol: string;
  contractType: AutoTrader2ContractType;
  barrier?: number;
  observedRate: number;
  confidenceLowerRate: number;
  sampleCount: number;
  edgeOverBaseline: number;
  confidenceEdgeOverBaseline: number;
};

export const AUTO_TRADER_2_MIN_SAMPLE = 50;
export const AUTO_TRADER_2_MIN_EDGE = 8;
export const AUTO_TRADER_2_MIN_CONFIDENCE_EDGE = 0;
export const AUTO_TRADER_2_MAX_LOSSES_PER_TYPE = 2;

export function getAutoTrader2OppositeType(
  contractType: AutoTrader2ContractType,
): AutoTrader2ContractType | null {
  switch (contractType) {
    case "CALL": return "PUT";
    case "PUT": return "CALL";
    case "DIGITEVEN": return "DIGITODD";
    case "DIGITODD": return "DIGITEVEN";
    default: return null;
  }
}

function wilsonLowerBoundPercent(wins: number, sampleCount: number): number {
  if (sampleCount <= 0) return 0;
  const z = 1.96;
  const probability = wins / sampleCount;
  const zSquared = z * z;
  const denominator = 1 + zSquared / sampleCount;
  const center = probability + zSquared / (2 * sampleCount);
  const margin = z * Math.sqrt(
    (probability * (1 - probability) + zSquared / (4 * sampleCount)) / sampleCount,
  );
  return ((center - margin) / denominator) * 100;
}

export type AutoTrader2LossState = {
  lossStreaks: Partial<Record<AutoTrader2ContractType, number>>;
  pausedContractTypes: AutoTrader2ContractType[];
};

export function updateAutoTrader2LossState(input: {
  state: AutoTrader2LossState;
  contractType: AutoTrader2ContractType;
  settledProfit: number;
}): AutoTrader2LossState {
  if (!Number.isFinite(input.settledProfit)) return input.state;
  if (input.settledProfit === 0) return input.state;
  const lossStreaks = { ...input.state.lossStreaks };
  let pausedContractTypes = [...input.state.pausedContractTypes];

  if (input.settledProfit < 0) {
    const lossStreak = (lossStreaks[input.contractType] ?? 0) + 1;
    lossStreaks[input.contractType] = lossStreak;
    if (
      input.contractType !== "DIGITDIFF"
      && lossStreak > AUTO_TRADER_2_MAX_LOSSES_PER_TYPE
      && !pausedContractTypes.includes(input.contractType)
    ) {
      pausedContractTypes = [...pausedContractTypes, input.contractType];
    }
  } else if (input.settledProfit > 0) {
    lossStreaks[input.contractType] = 0;
  }

  return { lossStreaks, pausedContractTypes };
}

export type AutoTrader2RecoveryState = {
  active: boolean;
  targetPnl: number | null;
};

export function updateAutoTrader2Recovery(input: {
  state: AutoTrader2RecoveryState;
  contractType: AutoTrader2ContractType;
  settledProfit: number;
  pnlBefore: number;
  pnlAfter: number;
  aiEnabled: boolean;
}): AutoTrader2RecoveryState {
  let targetPnl = input.state.targetPnl;

  if (
    input.aiEnabled
    && input.contractType === "DIGITDIFF"
    && input.settledProfit < 0
  ) {
    targetPnl = Math.max(targetPnl ?? input.pnlBefore, input.pnlBefore);
  }

  if (targetPnl !== null && input.pnlAfter > targetPnl) {
    return { active: false, targetPnl: null };
  }

  return { active: targetPnl !== null, targetPnl };
}

function candidatesForSignal(
  signal: AutoTrader2Signal,
  family: AutoTrader2Family | "recovery",
  barrier: number,
  duration: number,
  minimumSample: number,
  minimumEdge: number,
  minimumConfidenceEdge: number,
): AutoTrader2Candidate[] {
  const digits = signal.recent_digits.filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
  const digitSampleCount = Math.min(signal.sample_count, digits.length);
  const expiryDigits = digits.slice(duration);
  const expiryDigitSampleCount = Math.min(digitSampleCount - duration, expiryDigits.length);
  const quotes = signal.recent_quotes?.every(Number.isFinite) ? signal.recent_quotes : [];
  const quoteSampleCount = Math.max(0, quotes.length - duration);

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
      if (expiryDigitSampleCount < minimumSample) continue;
      for (let selectedBarrier = 0; selectedBarrier <= 9; selectedBarrier += 1) {
        const wins = expiryDigitSampleCount - expiryDigits.slice(0, expiryDigitSampleCount)
          .filter((digit) => digit === selectedBarrier).length;
        const observedRate = (wins / expiryDigitSampleCount) * 100;
        const edgeOverBaseline = observedRate - 90;
        const confidenceLowerRate = wilsonLowerBoundPercent(wins, expiryDigitSampleCount);
        const confidenceEdgeOverBaseline = confidenceLowerRate - 90;
        if (edgeOverBaseline >= minimumEdge && confidenceEdgeOverBaseline >= minimumConfidenceEdge) {
          candidates.push({
            symbol: signal.symbol,
            contractType,
            barrier: selectedBarrier,
            observedRate: Number(observedRate.toFixed(1)),
            confidenceLowerRate,
            sampleCount: expiryDigitSampleCount,
            edgeOverBaseline,
            confidenceEdgeOverBaseline,
          });
        }
      }
      continue;
    }

    let observedRate: number;
    let baseline: number;
    let wins: number;
    if (contractType === "CALL" || contractType === "PUT") {
      if (quoteSampleCount < minimumSample) continue;
      wins = Array.from({ length: quoteSampleCount }, (_, index) =>
        contractType === "CALL"
          ? quotes[index + duration]! > quotes[index]!
          : quotes[index + duration]! < quotes[index]!,
      ).filter(Boolean).length;
      observedRate = (wins / quoteSampleCount) * 100;
      baseline = 50;
    } else {
      if (expiryDigitSampleCount < minimumSample) continue;
      const sampledExpiryDigits = expiryDigits.slice(0, expiryDigitSampleCount);
      const evenCount = sampledExpiryDigits.filter((digit) => digit % 2 === 0).length;
      wins = contractType === "DIGITEVEN" ? evenCount : expiryDigitSampleCount - evenCount;
      observedRate = (wins / expiryDigitSampleCount) * 100;
      baseline = 50;
    }
    if (!Number.isFinite(observedRate) || observedRate > 100) continue;
    const confidenceLowerRate = wilsonLowerBoundPercent(
      wins,
      contractType === "CALL" || contractType === "PUT" ? quoteSampleCount : expiryDigitSampleCount,
    );
    observedRate = Number(observedRate.toFixed(1));
    const edgeOverBaseline = observedRate - baseline;
    const confidenceEdgeOverBaseline = confidenceLowerRate - baseline;
    if (edgeOverBaseline >= minimumEdge && confidenceEdgeOverBaseline >= minimumConfidenceEdge) {
      candidates.push({
        symbol: signal.symbol,
        contractType,
        observedRate,
        confidenceLowerRate,
        sampleCount: contractType === "CALL" || contractType === "PUT" ? quoteSampleCount : expiryDigitSampleCount,
        edgeOverBaseline,
        confidenceEdgeOverBaseline,
      });
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
  duration?: number;
  excludedContractTypes?: readonly AutoTrader2ContractType[];
  requiredContractType?: AutoTrader2ContractType | null;
  minimumSample?: number;
  minimumEdge?: number;
  minimumConfidenceEdge?: number;
}): AutoTrader2Candidate | null {
  const minimumSample = input.minimumSample ?? AUTO_TRADER_2_MIN_SAMPLE;
  const minimumEdge = input.minimumEdge ?? AUTO_TRADER_2_MIN_EDGE;
  const minimumConfidenceEdge = input.minimumConfidenceEdge ?? AUTO_TRADER_2_MIN_CONFIDENCE_EDGE;
  const duration = Number.isInteger(input.duration) && (input.duration ?? 0) > 0
    ? input.duration!
    : 1;
  const excludedContractTypes = new Set(input.excludedContractTypes ?? []);
  const signals = input.signals.filter((signal) => input.autoSelect || signal.symbol === input.selectedMarket);
  const candidates = signals.flatMap((signal) => candidatesForSignal(
    signal,
    input.family,
    input.barrier,
    duration,
    minimumSample,
    minimumEdge,
    minimumConfidenceEdge,
  )).filter((candidate) =>
    !excludedContractTypes.has(candidate.contractType)
    && (!input.requiredContractType || candidate.contractType === input.requiredContractType)
  );

  candidates.sort((left, right) =>
    right.confidenceEdgeOverBaseline - left.confidenceEdgeOverBaseline
    || right.edgeOverBaseline - left.edgeOverBaseline
    || right.sampleCount - left.sampleCount
    || Number(right.contractType === input.preferredType) - Number(left.contractType === input.preferredType)
    || left.symbol.localeCompare(right.symbol)
    || (left.barrier ?? -1) - (right.barrier ?? -1)
    || left.contractType.localeCompare(right.contractType),
  );
  return candidates[0] ?? null;
}

