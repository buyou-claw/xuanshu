import { expect, test } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
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

test('原生适配器从仓库根解析：profile 树不存在（干净 CI）时也能打开路径', async () => {
  // 复核 CI 实测：`profile/` 是 `pnpm install` + `setup` 的产物，干净 CI 上**不存在**。
  // 适配器以前只从 `profile/package.json` 解析 ⇒ `Cannot find module '@deepseek-ai/dsh-native-command'`
  // ⇒ 这个文件直接红。修法：`nativeAnchors()` 先试仓库根（`@deepseek-ai/dsh-native-command` 现在是根
  // devDependency），profile 只作兜底。这条用例把 profile 指向一个**不存在的目录**，钉住前一半。
  const dir = await mkdtemp(join(tmpdir(), 'cang-no-profile-'));
  try {
    const path = join(dir, 'secret.html');
    await writeFile(path, 'never-read-secret');
    const calls = [];
    const missingProfile = join(dir, 'no-such-profile');
    const ctx = { get: (key) => { if (key === 'profileContext') return { dir: missingProfile, home: dir }; throw new Error(`Forbidden service: ${key}`); } };
    const methods = createCangMethods(ctx, { dataDir: join(dir, 'data'), nativeInternals: { platform: 'win32', run: async (command, args) => { calls.push({ command, args }); return { stdout: '', stderr: '' }; } } });
    const entry = await methods['cang.register']({ path, name: '收藏', tags: ['书'] });
    await methods['cang.open']({ id: entry.id }, new AbortController().signal);
    expect(calls, 'profile 不在场时也应经真适配器打开（否则这条在干净 CI 上会红）').toEqual([{ command: 'explorer.exe', args: [pathToFileURL(path).href] }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('@deepseek-ai/dsh-native-command 是仓库根的显式依赖（干净 CI 的解析根）', async () => {
  // 与上一条配对：仓库根解析成立的前提是它真的在根 package.json 里（CI 只跑 install --frozen-lockfile）。
  // 谁把这条依赖删了，红在这条用例上，而不是红在一个「Cannot find module」的收集/运行错误里。
  const root = fileURLToPath(new URL('../../package.json', import.meta.url));
  const pkg = JSON.parse(await readFile(root, 'utf8'));
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  expect(
    declared['@deepseek-ai/dsh-native-command'],
    '@deepseek-ai/dsh-native-command 不在仓库根 dependencies/devDependencies 里：干净 CI 上 cang 会红',
  ).toBeTruthy();
});
