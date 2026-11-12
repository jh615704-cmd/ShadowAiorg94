export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(
  response: Response,
  data: unknown,
  requestInfo: { method: string; url: string },
): string {
  const code = getStringField(data, "code");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");
  const tradeOutcome = getStringField(data, "trade_outcome");

  if (
    isTradeMutation(requestInfo.method, getPathname(requestInfo.url))
    && (
      tradeOutcome === "uncertain"
      || ((response.status === 429 || response.status >= 500)
        && tradeOutcome !== "not_sent"
        && tradeOutcome !== "rejected")
    )
  ) {
    const pathname = getPathname(requestInfo.url);
    if (pathname.endsWith("/sell")) {
      return "The server did not confirm whether the contract close completed. Check the selected Deriv account's open contracts and history; do not retry or alter the contract until its status is clear.";
    }
    if (
      pathname.endsWith("/bulk-buy")
      || pathname.endsWith("/dual-buy")
      || pathname.endsWith("/clock-work/buy")
      || pathname.endsWith("/jackpot/buy")
    ) {
      return "The server did not confirm whether every order in this request was accepted. Check the selected Deriv account's open contracts and history; do not resend until each order's status is clear.";
    }
    return "The server did not confirm whether the order was accepted. Check the selected Deriv account's open contracts and history; do not resend until its status is clear.";
  }

  if (code === "DERIV_BUY_RATE_LIMITED") {
    return message
      ?? "Deriv temporarily limited new buys. The app retried confirmed rejections safely; check account history before repeating a batch.";
  }
  if (code === "AUTO_TRADER_2_PAUSED") {
    return message ?? "Auto Trader 2.0 is paused by an administrator. No new order was sent.";
  }
  if (response.status >= 500) {
    if ((tradeOutcome === "not_sent" || tradeOutcome === "rejected") && message) {
      return `${message} No order was sent.`;
    }
    if (isTradeMutation(requestInfo.method, getPathname(requestInfo.url))) {
      return "Deriv has not confirmed this order. Refresh order status before sending another one.";
    }
    return message ?? "The server could not complete this request. Try again shortly.";
  }
  if (response.status === 429) {
    return "This action is being sent too quickly. Wait a moment before trying again.";
  }

  if (typeof data === "string") {
    const text = data.trim();
    const mediaType = getMediaType(response.headers);
    if (
      response.status === 404
      && mediaType === "text/html"
      && /run this app to see the results here|replit diatype/i.test(text)
    ) {
      return "The dashboard preview page was returned instead of the trading API. No order was sent; the API service must be running before retrying.";
    }
    return text ? truncate(text) : "The request could not be completed.";
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");

  if (response.status === 400 && message && /offers no return/i.test(message)) {
    return "Deriv did not offer this contract for the selected duration. No contract was accepted.";
  }

  if (title && detail) return `${title} — ${detail}`;
  if (detail) return detail;
  if (message) return message;
  if (title) return title;

  return "The request could not be completed.";
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data, requestInfo));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

export class ApiTransportError extends Error {
  readonly name = "ApiTransportError";
  readonly method: string;
  readonly url: string;
  readonly requestId: string;
  readonly tradeOutcomeUncertain: boolean;
  readonly cause: unknown;

  constructor(
    cause: unknown,
    requestInfo: { method: string; url: string },
    requestId: string,
    failureKind: "network" | "response" = "network",
  ) {
    const pathname = getPathname(requestInfo.url);
    const tradeOutcomeUncertain = isTradeMutation(requestInfo.method, pathname);
    const recoveryMessage = tradeOutcomeUncertain
      ? failureKind === "response"
        ? pathname.endsWith("/sell")
          ? "The server response did not confirm whether the close completed. Check the selected Deriv account's open contracts and history before acting; do not retry until its status is clear."
          : "The server response did not confirm whether the trade was accepted. Check the selected Deriv account's open contracts and history before acting; do not resend until its status is clear."
        : pathname.endsWith("/sell")
          ? "The connection dropped before the server confirmed the close. The contract may already be closed; refresh order status before trying again. Check the selected Deriv account's open contracts and history, and do not retry while its status is unclear."
          : "The connection dropped before the server confirmed the trade. The contract may already be open; refresh order status before trying again. Check the selected Deriv account's open contracts and history, and do not resend while its status is unclear."
      : `The dashboard API could not be reached for ${requestInfo.method} ${pathname}. Check your connection and retry.`;

    super(`${recoveryMessage} Reference: ${requestId}`);
    Object.setPrototypeOf(this, new.target.prototype);

    this.method = requestInfo.method;
    this.url = pathname;
    this.requestId = requestId;
    this.tradeOutcomeUncertain = tradeOutcomeUncertain;
    this.cause = cause;
  }
}

export function getUserFacingErrorMessage(
  error: unknown,
  fallback = "The request could not be completed.",
): string {
  if (error instanceof ApiError || error instanceof ApiTransportError) {
    return error.message || fallback;
  }
  if (!error || typeof error !== "object") return fallback;
  const candidate = error as {
    status?: unknown;
    message?: unknown;
    data?: unknown;
  };
  const status = typeof candidate.status === "number" ? candidate.status : null;
  const data = candidate.data && typeof candidate.data === "object"
    ? candidate.data as Record<string, unknown>
    : null;
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const dataMessage = typeof data?.error === "string" ? data.error : "";
  const tradeOutcome = typeof data?.trade_outcome === "string" ? data.trade_outcome : "";
  if (status !== null && status >= 500) {
    if ((tradeOutcome === "not_sent" || tradeOutcome === "rejected") && dataMessage) {
      return `${dataMessage} No order was sent.`;
    }
    return dataMessage || "The server could not complete this request. Try again shortly.";
  }
  if (status === 429) {
    return "This action is being sent too quickly. Wait a moment before trying again.";
  }
  const rawProviderError = /HTTP 5\d\d|Bad Gateway|rate limit for buy|Bulk buy was not completed/i;
  if (rawProviderError.test(message)) {
    return "The trade service could not confirm the request. Check Deriv open contracts and account history before taking another action.";
  }
  if (rawProviderError.test(dataMessage)) {
    return "The trade service could not confirm the request. Check Deriv open contracts and account history before taking another action.";
  }
  return message || dataMessage || fallback;
}

function getPathname(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?", 1)[0] || "/";
  }
}

function isTradeMutation(method: string, pathname: string): boolean {
  return method === "POST" && /^\/api\/deriv\/(?:buy|bulk-buy|dual-buy|sell|clock-work\/buy|jackpot\/buy)$/.test(pathname);
}

const diagnosticTradeFeatures = new Set([
  "edge",
  "digit-flip",
  "trade-x",
  "bulk-trader",
  "jackpot",
  "clock-work",
  "cash-grab",
  "money-bank",
  "jdy-ai-3",
  "auto-trader",
  "auto-trader-2",
  "speedbot",
]);

type DiagnosticOperation = "buy" | "bulk_buy" | "dual_buy" | "sell" | "jackpot_batch" | "clock_work_batch";

function tradeOperationForDiagnostic(pathname: string): DiagnosticOperation | undefined {
  if (pathname.endsWith("/jackpot/buy")) return "jackpot_batch";
  if (pathname.endsWith("/clock-work/buy")) return "clock_work_batch";
  if (pathname.endsWith("/bulk-buy")) return "bulk_buy";
  if (pathname.endsWith("/dual-buy")) return "dual_buy";
  if (pathname.endsWith("/sell")) return "sell";
  if (pathname.endsWith("/buy")) return "buy";
  return undefined;
}

function tradeFeatureForDiagnostic(method: string, pathname: string, body: BodyInit | null | undefined): string | undefined {
  if (!isTradeMutation(method, pathname)) return undefined;
  if (pathname.endsWith("/clock-work/buy")) return "clock-work";
  if (pathname.endsWith("/jackpot/buy")) return "jackpot";

  if (typeof body === "string") {
    try {
      const payload: unknown = JSON.parse(body);
      if (payload && typeof payload === "object") {
        const fields = payload as { access_feature?: unknown; diagnostic_feature?: unknown };
        const feature = pathname.endsWith("/sell") ? fields.diagnostic_feature : fields.access_feature;
        if (typeof feature === "string" && diagnosticTradeFeatures.has(feature)) return feature;
      }
    } catch {
      // Diagnostic attribution must not interfere with the original request.
    }
  }

  if (pathname.endsWith("/sell")) return "dashboard";
  return pathname.endsWith("/dual-buy") ? "edge" : "trade-x";
}

function isUnconfirmedTradeResponse(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const result = payload as { ok?: unknown; message?: unknown };
  const failed = tradeFailureEntries(payload);
  return result.ok === false
    || failed.length > 0
    || (typeof result.message === "string" && /unconfirmed|uncertain|could not be confirmed/i.test(result.message));
}

type TradeDiagnosticSource = "browser_app" | "api_server" | "deriv" | "transport" | "unknown";

const diagnosticSources = new Set<TradeDiagnosticSource>([
  "browser_app",
  "api_server",
  "deriv",
  "transport",
  "unknown",
]);

function diagnosticSource(value: unknown, fallback: TradeDiagnosticSource): TradeDiagnosticSource {
  return typeof value === "string" && diagnosticSources.has(value as TradeDiagnosticSource)
    ? value as TradeDiagnosticSource
    : fallback;
}

function responseDiagnosticSource(payload: unknown, fallback: TradeDiagnosticSource): TradeDiagnosticSource {
  if (!payload || typeof payload !== "object") return fallback;
  return diagnosticSource((payload as { diagnostic_source?: unknown }).diagnostic_source, fallback);
}

function tradeFailureEntries(payload: unknown): Array<{ source: unknown; outcome: unknown; error: unknown }> {
  if (!payload || typeof payload !== "object") return [];
  const failed = (payload as { failed?: unknown }).failed;
  if (!Array.isArray(failed)) return [];
  return failed.filter((item): item is { source: unknown; outcome: unknown; error: unknown } =>
    Boolean(item && typeof item === "object"),
  );
}

function reportAdminDiagnostic(
  code: "api_server_error" | "trade_outcome_uncertain",
  severity: "warning" | "error",
  feature?: string,
  source: TradeDiagnosticSource = "unknown",
  operation?: DiagnosticOperation,
) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("shadow-admin-diagnostic", {
      detail: {
        code,
        severity,
        source,
        ...(feature ? { feature } : {}),
        ...(operation ? { operation } : {}),
      },
    }));
  } catch {
    // Diagnostics must never interfere with the original request.
  }
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAbortError(error: unknown, signal?: AbortSignal | null): boolean {
  return signal?.aborted === true
    || (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };
  const requestId = createRequestId();
  const requestPath = getPathname(requestInfo.url);
  const tradeFeature = tradeFeatureForDiagnostic(method, requestPath, init.body);
  const tradeOperation = tradeOperationForDiagnostic(requestPath);
  headers.set("x-client-request-id", requestId);
  const requestInit: RequestInit = {
    ...init,
    method,
    headers,
    // Access-key and Clerk sessions are browser cookies on web. Keep this
    // explicit so the session survives the shared preview proxy as well as
    // same-origin navigation.
    credentials: init.credentials ?? "same-origin",
  };
  const signalAbortedBeforeFetch = requestInit.signal?.aborted === true;

  let response: Response;
  try {
    response = await fetch(input, requestInit);
  } catch (error) {
    if (isAbortError(error, requestInit.signal)) {
      if (tradeFeature && !signalAbortedBeforeFetch) {
        reportAdminDiagnostic("trade_outcome_uncertain", "warning", tradeFeature, "transport", tradeOperation);
        throw new ApiTransportError(error, requestInfo, requestId);
      }
      throw error;
    }

    // Reads are safe to replay after a transient browser/proxy failure.
    // A trade mutation is deliberately never retried: the server may have
    // completed it even if the browser did not receive its response.
    if (method !== "GET" && method !== "HEAD") {
      reportAdminDiagnostic(
        tradeFeature ? "trade_outcome_uncertain" : "api_server_error",
        tradeFeature ? "warning" : "error",
        tradeFeature,
        "transport",
        tradeOperation,
      );
      throw new ApiTransportError(error, requestInfo, requestId);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      response = await fetch(input, requestInit);
    } catch (retryError) {
      if (isAbortError(retryError, init.signal)) throw retryError;
      reportAdminDiagnostic("api_server_error", "error", undefined, "transport");
      throw new ApiTransportError(retryError, requestInfo, requestId);
    }
  }

  if (!response.ok) {
    const errorData = await parseErrorBody(response, method);
    const outcome = getStringField(errorData, "trade_outcome");
    if (
      response.status >= 500
      || (tradeFeature && (response.status === 429 || outcome === "uncertain"))
    ) {
      const source = responseDiagnosticSource(errorData, tradeFeature ? "unknown" : "api_server");
      const tradeOutcomeUncertain = tradeFeature
        && (outcome === "uncertain"
          || ((response.status >= 500 || response.status === 429)
            && outcome !== "not_sent"
            && outcome !== "rejected"));
      reportAdminDiagnostic(
        tradeOutcomeUncertain ? "trade_outcome_uncertain" : "api_server_error",
        tradeOutcomeUncertain ? "warning" : "error",
        tradeFeature,
        source,
        tradeOperation,
      );
    }
    throw new ApiError(response, errorData, requestInfo);
  }

  let payload: unknown;
  try {
    payload = await parseSuccessBody(response, responseType, requestInfo);
  } catch (error) {
    if (!tradeFeature) throw error;
    reportAdminDiagnostic("trade_outcome_uncertain", "warning", tradeFeature, "transport", tradeOperation);
    throw new ApiTransportError(error, requestInfo, requestId, "response");
  }
  if (tradeFeature && isUnconfirmedTradeResponse(payload)) {
    const failed = tradeFailureEntries(payload);
    const sources = failed.length
      ? Array.from(new Set(failed.map((entry) => diagnosticSource(entry.source, "unknown"))))
      : [responseDiagnosticSource(payload, "unknown")];
    const uncertain = failed.length === 0
      || failed.some((entry) => entry.outcome !== "not_sent" && entry.outcome !== "rejected");
    for (const source of sources) {
      reportAdminDiagnostic(
        uncertain ? "trade_outcome_uncertain" : "api_server_error",
        uncertain ? "warning" : "error",
        tradeFeature,
        source,
        tradeOperation,
      );
    }
  }
  return payload as T;
}
