import { expect, test } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { createCangMethods } from '../../packages/xuanshu-host/lib/cang/service.mjs';

test('cang RPC opens registered pointers with the real DSH associated-path adapter without session or AI services', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cang-rpc-'));
  try {
    const path = join(dir, 'secret.html');
    await writeFile(path, 'never-read-secret');
    const calls = [];
    const profileDir = fileURLToPath(new URL('../../profile/', import.meta.url));
    const ctx = { get: (key) => { if (key === 'profileContext') return { dir: profileDir, home: dir }; throw new Error(`Forbidden service: ${key}`); } };
    const methods = createCangMethods(ctx, { dataDir: join(dir, 'data'), nativeInternals: { platform: 'win32', run: async (command, args) => { calls.push({ command, args }); return { stdout: '', stderr: '' }; } } });
    const entry = await methods['cang.register']({ path, name: '收藏', tags: ['书'] });
    await methods['cang.open']({ id: entry.id }, new AbortController().signal);
    expect(calls).toEqual([{ command: 'explorer.exe', args: [pathToFileURL(path).href] }]);
    expect(JSON.stringify(await methods['cang.list']())).not.toContain('never-read-secret');
    await expect(methods['cang.open']({ id: 'unknown', path })).rejects.toThrow('不存在');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
