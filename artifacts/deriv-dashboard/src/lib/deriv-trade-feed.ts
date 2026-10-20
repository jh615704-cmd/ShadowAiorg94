export type DerivTradeFeedRow = {
  account_id: string;
  contract_id: string;
  status: string;
  buy_time?: number | null;
};

export function mergeDerivTradeUpdate<T extends DerivTradeFeedRow>(
  rows: readonly T[] | undefined,
  update: T,
): T[] {
  const currentRows = [...(rows ?? [])];
  const rowIndex = currentRows.findIndex(
    (row) => row.account_id === update.account_id && row.contract_id === update.contract_id,
  );
  if (rowIndex === -1) return [update, ...currentRows];
  currentRows[rowIndex] = { ...currentRows[rowIndex], ...update };
  return currentRows;
}

export function waitForSettledDerivTrade<T extends DerivTradeFeedRow>({
  accountId,
  contractId,
  getRows,
  subscribe,
  isSettled,
  signal,
  timeoutMs = 120_000,
}: {
  accountId: string;
  contractId: string;
  getRows: () => readonly T[] | undefined;
  subscribe: (listener: () => void) => () => void;
  isSettled: (status: string) => boolean;
  signal?: AbortSignal;
  timeoutMs?: number | null;
}): Promise<T | null> {
  const findSettled = () => getRows()?.find(
    (row) => row.account_id === accountId
      && row.contract_id === contractId
      && isSettled(row.status),
  ) ?? null;
  const alreadySettled = findSettled();
  if (alreadySettled) return Promise.resolve(alreadySettled);
  if (signal?.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      unsubscribe?.();
      unsubscribe = null;
      if (timeout !== null) clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    const finish = (row: T | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(row);
    };
    const abort = () => finish(null);
    const check = () => {
      const row = findSettled();
      if (row) finish(row);
    };
    if (timeoutMs !== null) {
      timeout = setTimeout(() => finish(null), Math.max(1, timeoutMs));
    }

    unsubscribe = subscribe(check);
    signal?.addEventListener("abort", abort, { once: true });
    check();
    if (settled) cleanup();
  });
}
