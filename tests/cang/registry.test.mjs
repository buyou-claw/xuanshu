import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCangRegistry } from '../../packages/xuanshu-host/lib/cang/registry.mjs';

const sandboxes = [];
afterEach(async () => { for (const dir of sandboxes.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function sandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'xuanshu-cang-'));
  sandboxes.push(dir);
  const dataDir = join(dir, 'xuanshu');
  const pointer = join(dir, 'passwords.txt');
  await mkdir(dataDir);
  await writeFile(pointer, 'private-password-sentinel-never-in-context');
  return { dir, dataDir, pointer };
}

test('登记藏 persists only pointer metadata and can be listed after restart', async () => {
  const { dataDir, pointer } = await sandbox();
  const registry = createCangRegistry({ dataDir });
  const registered = await registry.register({ path: pointer, name: '密码本', tags: ['私密', '私密'], actions: { open: true, reveal: true, copy: true }, content: 'must not persist' });
  const result = await createCangRegistry({ dataDir }).list();
  expect(result.entries).toEqual([expect.objectContaining({ id: registered.id, name: '密码本', path: pointer, tags: ['私密'], pointer: expect.objectContaining({ valid: true, kind: 'file' }) })]);
  expect(JSON.stringify(result)).not.toMatch(/private-password|must not persist|content/);
});

test('editing and removing a 藏 changes registration without changing the original file', async () => {
  const { dataDir, pointer } = await sandbox();
  const registry = createCangRegistry({ dataDir });
  const entry = await registry.register({ path: pointer, name: '旧名', tags: [] });
  await registry.update({ id: entry.id, path: pointer, name: '新名', tags: ['私密'], actions: { open: false, reveal: true, copy: true } });
  expect((await createCangRegistry({ dataDir }).list()).entries).toEqual([expect.objectContaining({ id: entry.id, name: '新名', tags: ['私密'], actions: { open: false, reveal: true, copy: true } })]);
  await registry.remove(entry.id);
  expect((await createCangRegistry({ dataDir }).list()).entries).toEqual([]);
  expect(await readFile(pointer, 'utf8')).toBe('private-password-sentinel-never-in-context');
});

test.skipIf(process.platform !== 'win32')('drive-relative pointers cannot inherit the running host drive', async () => {
  const { dataDir, pointer } = await sandbox();
  const registry = createCangRegistry({ dataDir });
  expect(await registry.validate(pointer.slice(2))).toMatchObject({ valid: false, reason: '请选择本地绝对路径。' });
});

test('existing valid JSONL without a final newline remains readable after another registration', async () => {
  const { dataDir, pointer } = await sandbox();
  const registry = createCangRegistry({ dataDir });
  await registry.register({ path: pointer, name: '第一藏', tags: [] });
  await writeFile(registry.file, (await readFile(registry.file, 'utf8')).trimEnd());
  await registry.register({ path: pointer, name: '第二藏', tags: [] });
  expect((await createCangRegistry({ dataDir }).list()).entries.map(value => value.name)).toEqual(['第一藏', '第二藏']);
});

test('谱 paths and aliases into 谱 are rejected without reading their content', async () => {
  const { dir, dataDir } = await sandbox();
  const puDir = join(dataDir, 'pus', '私密谱');
  await mkdir(puDir, { recursive: true });
  await writeFile(join(puDir, 'manifest.md'), 'must-not-be-read');
  const alias = join(dir, 'alias');
  await symlink(puDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const registry = createCangRegistry({ dataDir });
  await expect(registry.register({ path: puDir, name: '拒绝', tags: [] })).rejects.toThrow('谱会被 AI 读取');
  await expect(registry.register({ path: alias, name: '拒绝链接', tags: [] })).rejects.toThrow('谱会被 AI 读取');
  expect((await registry.list()).entries).toEqual([]);
});

test('corrupt registry fails closed, while moved pointers are listed as stale', async () => {
  const { dataDir, pointer } = await sandbox();
  const registry = createCangRegistry({ dataDir });
  await registry.register({ path: pointer, name: '藏', tags: [] });
  await rm(pointer);
  expect((await registry.list()).entries[0].pointer).toMatchObject({ valid: false });
  await writeFile(registry.file, '{broken-json}\n');
  await expect(registry.list()).rejects.toThrow('损坏');
  await expect(registry.register({ path: pointer, name: '新藏', tags: [] })).rejects.toThrow('损坏');
  expect(await readFile(registry.file, 'utf8')).toBe('{broken-json}\n');
});
