export const DERIV_STATUS_WARNING_GRACE_MS = 15_000;

export const DERIV_STATUS_QUERY_RECOVERY_OPTIONS = {
  retry: 2,
  retryDelay: (attemptIndex: number) => Math.min(1_000 * 2 ** attemptIndex, 4_000),
  refetchOnReconnect: true,
  refetchOnWindowFocus: true,
} as const;
