const derivQuoteFormatter = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  minimumIntegerDigits: 4,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatDerivQuote(value: number): string {
  return Number.isFinite(value) ? derivQuoteFormatter.format(value) : "—";
}
