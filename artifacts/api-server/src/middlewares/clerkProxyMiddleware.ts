/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain, enabling Clerk
 * authentication on custom domains and .replit.app deployments without
 * requiring CNAME DNS configuration.
 *
 * AUTH CONFIGURATION: To manage users, enable/disable login providers
 * (Google, GitHub, etc.), change app branding, or configure OAuth credentials,
 * use the Auth pane in the workspace toolbar. There is no external Clerk
 * dashboard — all auth configuration is done through the Auth pane.
 *
 * IMPORTANT:
 * - Only active in production (Clerk proxying doesn't work for dev instances)
 * - Must be mounted BEFORE express.json() middleware
 *
 * Usage in app.ts:
 *   import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
 *   app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
 */

import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { RequestHandler } from 'express';

const CLERK_FAPI = 'https://frontend-api.clerk.dev';
export const CLERK_PROXY_PATH = '/api/__clerk';

/**
 * Returns the first effective public hostname for the given request,
 * preferring x-forwarded-host over the Host header so callers behind a
 * proxy see the original client-facing host.
 *
 * x-forwarded-host can take three shapes:
 *   - undefined (no proxy involved)
 *   - a single string (one proxy hop)
 *   - a comma-delimited string when an upstream appended rather than
 *     replaced the header (Node folds duplicate headers this way), or a
 *     string[] in some Express typings
 * In the multi-value case, the leftmost value is the original client-
 * facing host. Take that one in all forms. Exported so that app.ts
 * (clerkMiddleware callback) and this proxy middleware agree on which
 * hostname is canonical — otherwise multi-domain/custom-domain flows
 * break.
 */
export function getClerkProxyHost(req: {
  headers: IncomingHttpHeaders;
}): string | undefined {
  const forwarded = req.headers['x-forwarded-host'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstHop = raw?.split(',')[0]?.trim();
  return firstHop || req.headers.host?.trim() || undefined;
}

export function createClerkProxyHandler(
  target: string,
  secretKey: string,
): RequestHandler {
  const targetUrl = new URL(target);
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    throw new TypeError(`Unsupported Clerk proxy protocol: ${targetUrl.protocol}`);
  }
  const sendRequest = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const basePath = targetUrl.pathname.replace(/\/+$/, '');
  const hopByHopHeaders = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]);

  return (req, res) => {
    const forwardedProtocol = req.headers['x-forwarded-proto'];
    const protocol = (Array.isArray(forwardedProtocol)
      ? forwardedProtocol[0]
      : forwardedProtocol)?.split(',')[0]?.trim() || 'https';
    const host = getClerkProxyHost(req) || '';
    const xff = req.headers['x-forwarded-for'];
    const clientIp =
      (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      '';

    const headers: OutgoingHttpHeaders = {
      ...req.headers,
      host: targetUrl.host,
      'clerk-proxy-url': `${protocol}://${host}${CLERK_PROXY_PATH}`,
      'clerk-secret-key': secretKey,
    };
    if (clientIp) headers['x-forwarded-for'] = clientIp;

    const connectionHeader = req.headers.connection;
    const connectionTokens = (Array.isArray(connectionHeader)
      ? connectionHeader.join(',')
      : connectionHeader ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    for (const header of [...hopByHopHeaders, ...connectionTokens]) {
      delete headers[header];
    }

    const requestPath = req.url || '/';
    const path = `${basePath}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`;
    const proxyRequest = sendRequest(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || undefined,
        method: req.method,
        path,
        headers,
      },
      (proxyResponse) => {
        const responseHeaders: OutgoingHttpHeaders = { ...proxyResponse.headers };
        const upstreamConnection = proxyResponse.headers.connection;
        const upstreamConnectionTokens = (Array.isArray(upstreamConnection)
          ? upstreamConnection.join(',')
          : upstreamConnection ?? '')
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        for (const header of [...hopByHopHeaders, ...upstreamConnectionTokens]) {
          delete responseHeaders[header];
        }

        const status = proxyResponse.statusCode ?? 502;
        if (status < 200 || status === 204) {
          delete responseHeaders['content-length'];
        }

        const bodyless =
          req.method === 'HEAD' ||
          status < 200 ||
          status === 204 ||
          status === 304;
        const failResponse = () => {
          if (res.destroyed) return;
          if (res.headersSent) {
            res.destroy();
            return;
          }
          res.writeHead(502, { 'content-length': '0' });
          res.end();
        };

        if (responseHeaders['content-length'] !== undefined || bodyless) {
          res.writeHead(status, responseHeaders);
          proxyResponse.on('error', failResponse);
          proxyResponse.pipe(res);
          return;
        }

        const chunks: Buffer[] = [];
        proxyResponse.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        proxyResponse.on('end', () => {
          if (res.destroyed) return;
          const body = Buffer.concat(chunks);
          responseHeaders['content-length'] = String(body.length);
          res.writeHead(status, responseHeaders);
          res.end(body);
        });
        proxyResponse.on('error', failResponse);
      },
    );

    proxyRequest.on('error', () => {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { 'content-length': '0' });
      res.end();
    });
    req.on('aborted', () => proxyRequest.destroy());
    res.on('close', () => {
      if (!res.writableEnded) proxyRequest.destroy();
    });
    req.pipe(proxyRequest);
  };
}

export function clerkProxyMiddleware(): RequestHandler {
  // Only run proxy in production — Clerk proxying doesn't work for dev instances.
  if (process.env.NODE_ENV !== 'production') {
    return (_req, _res, next) => next();
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return (_req, _res, next) => next();
  }

  return createClerkProxyHandler(CLERK_FAPI, secretKey);
}
