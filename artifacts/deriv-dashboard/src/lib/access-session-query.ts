export function shouldRetryAccessSessionQuery(failureCount: number, error: unknown): boolean {
  const status = error && typeof error === "object" && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;

  if (status === 401 || status === 403) return false;
  return failureCount < 2;
}

export const ACCESS_SESSION_QUERY_RETRY = {
  retry: shouldRetryAccessSessionQuery,
  retryDelay: (attempt: number) => Math.min(500 * 2 ** attempt, 2_000),
} as const;
