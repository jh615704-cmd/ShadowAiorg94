import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createServer, request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import {
  CLERK_PROXY_PATH,
  createClerkProxyHandler,
} from './clerkProxyMiddleware';

test('Clerk proxy preserves mounted path, forwarded identity headers, and dynamic responses', async (t) => {
  let received:
    | {
        method: string;
        url: string;
        body: string;
        clerkProxyUrl: string | undefined;
        clerkSecretKey: string | undefined;
        forwardedFor: string | undefined;
      }
    | undefined;

  const upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      received = {
        method: req.method ?? '',
        url: req.url ?? '',
        body: Buffer.concat(chunks).toString(),
        clerkProxyUrl: req.headers['clerk-proxy-url'] as string | undefined,
        clerkSecretKey: req.headers['clerk-secret-key'] as string | undefined,
        forwardedFor: req.headers['x-forwarded-for'] as string | undefined,
      };
      const body = JSON.stringify({ ok: true });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.write(body.slice(0, 5));
      res.end(body.slice(5));
    });
  });

  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamPort = (upstream.address() as AddressInfo).port;

  const app = express();
  app.use(
    CLERK_PROXY_PATH,
    createClerkProxyHandler(`http://127.0.0.1:${upstreamPort}`, 'test-only-key'),
  );
  const proxyServer = app.listen(0, '127.0.0.1');
  await once(proxyServer, 'listening');
  t.after(async () => {
    await Promise.all([
      new Promise<void>((resolve, reject) =>
        proxyServer.close((error) => error ? reject(error) : resolve()),
      ),
      new Promise<void>((resolve, reject) =>
        upstream.close((error) => error ? reject(error) : resolve()),
      ),
    ]);
  });

  const proxyPort = (proxyServer.address() as AddressInfo).port;
  const response = await new Promise<{
    statusCode: number | undefined;
    headers: IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const outgoing = request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        path: `${CLERK_PROXY_PATH}/v1/client?region=US`,
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          'content-length': '8',
          'x-forwarded-host': 'login.example.test, proxy.internal',
          'x-forwarded-proto': 'https, http',
          'x-forwarded-for': '198.51.100.10, 10.0.0.4',
        },
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        incoming.on('end', () => resolve({
          statusCode: incoming.statusCode,
          headers: incoming.headers,
          body: Buffer.concat(chunks).toString(),
        }));
      },
    );
    outgoing.on('error', reject);
    outgoing.end('client!!');
  });

  const upstreamBody = JSON.stringify({ ok: true });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body, upstreamBody);
  assert.equal(response.headers['content-length'], String(Buffer.byteLength(upstreamBody)));
  assert.equal(response.headers['transfer-encoding'], undefined);
  assert.deepEqual(received, {
    method: 'POST',
    url: '/v1/client?region=US',
    body: 'client!!',
    clerkProxyUrl: 'https://login.example.test/api/__clerk',
    clerkSecretKey: 'test-only-key',
    forwardedFor: '198.51.100.10',
  });
});
