import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPuRepository } from '../../packages/xuanshu-host/lib/pu/repository.mjs';
import { createPuMethods } from '../../packages/xuanshu-host/lib/pu/service.mjs';
const roots = [];
afterEach(() => roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })));
test('AI candidate stays outside pus until human confirms its complete pu/1 files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xs-pu-')); roots.push(root);
  const pu = createPuRepository(root);
  const draft = { name: '软件开发', level: 'optional', description: '我的开发背景', body: '# 概览\n编程经历\n# 工具\nRust', summary: '擅长 Rust' };
  expect(pu.list()).toEqual([]);
  expect(() => pu.confirm(draft, false)).toThrow(/确认/);
  expect(pu.list()).toEqual([]);
  const saved = pu.confirm(draft, true);
  expect(saved.slug).toBe('软件开发');
  expect(readdirSync(join(root, 'pus', '软件开发')).sort()).toEqual(['content.md', 'manifest.md', 'summary.md']);
  expect(readFileSync(join(root, 'pus', '软件开发', 'manifest.md'), 'utf8')).toMatch(/spec: pu\/1/);
  expect(pu.read(saved.slug)).toMatchObject({ name: '软件开发', level: 'optional', source: 'ai-assisted', summary: '擅长 Rust' });
});
test('pu discovery never follows a directory junction into private cang files', () => {
  const root = mkdtempSync(join(tmpdir(), 'xs-pu-')); roots.push(root);
  mkdirSync(join(root, 'pus')); mkdirSync(join(root, 'cang'));
  writeFileSync(join(root, 'cang', 'private.txt'), 'never sent to AI');
  symlinkSync(join(root, 'cang'), join(root, 'pus', 'secret'), 'junction');
  const pu = createPuRepository(root);
  expect(() => pu.read('secret')).toThrow(/符号链接/);
  expect(pu.list()).toEqual([]);
});
test('minimal single-file pu without summary remains readable and becomes a directory when a human adds a summary', () => {
  const root = mkdtempSync(join(tmpdir(), 'xs-pu-')); roots.push(root); mkdirSync(join(root, 'pus'));
  writeFileSync(join(root, 'pus', 'life.md'), '---\nspec: pu/1\nname: Life\nlevel: base\ntags: []\nsource: manual\nupdated_at: 2026-10-11\n---\n# 概览\n生活事实\n# 经历\n曾在上海工作');
  const pu = createPuRepository(root);
  const current = pu.read('life');
  expect(current.summary).toBe('');
  expect(pu.list()).toMatchObject([{ name: 'Life', body: '# 概览\n生活事实\n# 经历\n曾在上海工作' }]);
  pu.update('life', { ...current, summary: '人维护的生活摘要' }, true);
  expect(pu.read('life').summary).toBe('人维护的生活摘要');
  expect(readdirSync(join(root, 'pus', 'life')).sort()).toEqual(['content.md', 'manifest.md', 'summary.md']);
});
test('invalid frontmatter text never becomes a partially persisted spectrum', () => {
  const root = mkdtempSync(join(tmpdir(), 'xs-pu-')); roots.push(root);
  const pu = createPuRepository(root);
  expect(() => pu.confirm({ name: '坏\n谱', level: 'optional', description: '概览', body: '# 概览\n事实', summary: '事实' }, true)).toThrow(/谱名/);
  expect(pu.list()).toEqual([]);
});
test('DSH conversion accepts attachments, exposes its approval session, previews then confirms without AI writing pus', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xs-pu-')); roots.push(root);
  let accepted; let sessionCwd;
  const ctx = { get(name) { return this[name]; }, sessionController: {
    async create(request) { sessionCwd = request.cwd; return { sessionId: 'fixture-session' }; },
    async prompt(request) { accepted = request; return { accepted: true }; },
    async resolveAgent() { return { agent: { whenIdle: async () => {}, session: { snapshotEvents: () => [{ type: 'assistant/message', data: { content: [{ type: 'text', text: JSON.stringify({ name: '编程', level: 'optional', description: '开发经历', body: '# 概览\nRust', summary: '使用 Rust' }) }] } }] } } }; },
  } };
  const methods = createPuMethods(ctx, { dataDir: root });
  const signal = new AbortController().signal;
  const job = await methods['pu.generate']({ name: '编程', level: 'optional', text: '我的背景', attachments: [{ name: 'notes.md', data: Buffer.from('# 经历\nRust').toString('base64') }] }, signal);
  expect(job.sessionId).toBe('fixture-session');
  let state;
  for (let i = 0; i < 10; i++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await methods['pu.job']({ id: job.id }, signal); if (state.status === 'ready') break; }
  expect(state).toMatchObject({ status: 'ready', draft: { summary: '使用 Rust' } });
  expect(readFileSync(join(sessionCwd, 'notes.md'), 'utf8')).toBe('# 经历\nRust');
  expect(accepted.content[0].text).toMatch(/xuanshu:create-pu/);
  expect(createPuRepository(root).list()).toEqual([]);
  await methods['pu.confirm']({ id: job.id, confirmed: true }, signal);
  expect(createPuRepository(root).list()).toMatchObject([{ name: '编程' }]);
});
test('human edits summary, body and level; search uses body and filters and base sources reflect edited level', () => {
  const root = mkdtempSync(join(tmpdir(), 'xs-pu-')); roots.push(root);
  const pu = createPuRepository(root);
  const saved = pu.confirm({ name: 'My Work', level: 'optional', description: '职业侧面', body: '# 概览\n原始经历', summary: '旧摘要' }, true);
  pu.update(saved.slug, { ...saved, level: 'base', body: '# 概览\n学习 Rust', summary: '人更正的事实' }, true);
  expect(pu.list({ query: 'Rust', level: 'base', source: 'ai-assisted' })).toMatchObject([{ slug: 'my-work', summary: '人更正的事实' }]);
  expect(pu.baseSources()).toMatchObject([{ slug: 'my-work', summary: '人更正的事实' }]);
  expect(pu.list({ level: 'optional' })).toEqual([]);
});
