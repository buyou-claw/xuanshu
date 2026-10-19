import { expect, test } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installRpc } from '../../packages/xuanshu-host/lib/rpc.mjs';

let profile; let dir = dirname(fileURLToPath(import.meta.url));
while (dir !== dirname(dir)) {
  if (existsSync(join(dir, 'profile/node_modules/@deepseek-ai/dsh-client-connection/package.json'))) { profile = join(dir, 'profile'); break; }
  dir = dirname(dir);
}

/**
 * 契约（2026-10-18 真机改正）：玄枢 RPC 挂在 rc.2 的 **exact Fetch 路由** `/api/xuanshu` 上，
 * 不是 `connection.rpc.handle('/xuanshu')` —— 后者在 `register()` 内部读 `owner.webServer`，
 * 真机上必然抛（见 `packages/xuanshu-host/lib/rpc.mjs` 文件头）。
 * 这里用**真的** HostConnectionService，验注册面、信封与方法派发。
 */
test.skipIf(!profile)('XuanShu RPC 挂在 /api/xuanshu 的 exact Fetch 路由上，信封与方法派发正确', async () => {
  const require = createRequire(join(profile, 'package.json'));
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
  const { HostConnectionService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-connection')).href);

  const ctx = new Context();
  ctx.provide('webServer', { register() { return () => {}; } });
  const service = new HostConnectionService(ctx, [], { isAuthenticated: () => true });

  // 抓注册面：真的 HostConnectionService 把路由存进私有表，这里只拦一次拿到 route 对象。
  let captured;
  const originalRegister = service.registerFetchRoute.bind(service);
  service.registerFetchRoute = (owner, route) => { captured = route; return originalRegister(owner, route); };

  const registration = installRpc(ctx, {
    'pu.list': async () => [{ name: '编程', level: 'base' }],
    'boom.teapot': async () => {
      const error = new Error('需要先确认');
      error.xuanshuCode = 'needs-confirmation';
      error.details = { estimate: 3 };
      throw error;
    },
  });
  await registration;

  expect(captured.path).toBe('/api/xuanshu');
  expect(captured.methods).toEqual(['POST']);

  const send = async (method, payload = {}) => {
    const request = new Request('http://127.0.0.1/api/xuanshu', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, payload }),
    });
    const response = await captured.fetch(request);
    return { status: response.status, body: await response.json() };
  };

  try {
    const ok = await send('pu.list');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, value: [{ name: '编程' }] });

    const unknown = await send('missing');
    expect(unknown.body.ok).toBe(false);
    expect(unknown.body.error.code).toBe('xuanshu/invalid');

    const controlled = await send('boom.teapot');
    expect(controlled.body.error.code).toBe('needs-confirmation');
    expect(controlled.body.error.details).toEqual({ estimate: 3 });

    // 非 JSON body：400，且给可读原因
    const bad = await captured.fetch(new Request('http://127.0.0.1/api/xuanshu', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }));
    expect(bad.status).toBe(400);
  } finally {
    await registration.dispose();
  }
});
