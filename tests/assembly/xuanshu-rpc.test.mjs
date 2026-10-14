import { expect, test } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { installRpc } from '../../packages/xuanshu-host/lib/rpc.mjs';

let profile; let dir = dirname(fileURLToPath(import.meta.url));
while (dir !== dirname(dir)) {
  if (existsSync(join(dir, 'profile/node_modules/@deepseek-ai/dsh-client-connection/package.json'))) { profile = join(dir, 'profile'); break; }
  dir = dirname(dir);
}
test.skipIf(!profile)('registered XuanShu RPC route uses real DSH Connection admission, envelopes, and method dispatch', async () => {
  const require = createRequire(join(profile, 'package.json'));
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
  const { HostConnectionService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-connection')).href);
  const ctx = new Context(); let route; let authenticated = true;
  ctx.provide('webServer', { register(value) { route = value; return () => {}; } });
  new HostConnectionService(ctx, [], { isAuthenticated: () => authenticated });
  const registration = installRpc(ctx, { 'pu.list': async () => [{ name: '编程', level: 'base' }] });
  await registration;
  expect(route.path).toBe('/xuanshu');
  const send = async (method) => {
    const req = Readable.from([Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'test-rpc', method, payload: {} }))]);
    Object.assign(req, { method: 'POST', url: `/xuanshu/${method}`, headers: { host: '127.0.0.1:3000', 'content-type': 'application/json' } });
    let status; let body = '';
    const res = Object.assign(new EventEmitter(), { writableEnded: false, writeHead(code) { status = code; }, end(data) { body += data ?? ''; this.writableEnded = true; }, write(data) { body += Buffer.from(data).toString('utf8'); return true; } });
    await route.handler(req, res);
    return { status, body };
  };
  try {
    const response = await send('pu.list');
    expect(JSON.parse(response.body)).toMatchObject({ type: 'server-response', rpcId: 'test-rpc', result: { ok: true, value: [{ name: '编程' }] } });
    const unknown = await send('missing'); expect(JSON.parse(unknown.body).result.ok).toBe(false);
    authenticated = false; expect((await send('pu.list')).status).toBe(401);
  } finally { await registration.dispose(); }
});
