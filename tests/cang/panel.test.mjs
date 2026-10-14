import { expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CangPanel, filterCangEntries } from '../../packages/xuanshu-client/src/client/CangPanel.tsx';

const entry = { id: 'one', name: '经典藏书', path: 'C:/private/password-sentinel.pdf', tags: ['书'], actions: { open: true, reveal: true, copy: true }, pointer: { valid: true, kind: 'file', checkedAt: '2026-10-14T00:00:00Z' } };
const controller = { snapshot: () => ({ revision: 0, draft: undefined }), subscribe: () => () => {}, edit: () => {} };

test('藏 UI keeps its AI-free boundary visible and only exposes local actions', () => {
  const html = renderToStaticMarkup(createElement(CangPanel, { api: {}, controller, initialData: { registryPath: 'registry.jsonl', entries: [entry] }, navigatePus: () => {} }));
  expect(html).toContain('藏永不进 AI：只登记指针、签与跳转');
  expect(html).toContain('经典藏书');
  expect(html).toContain('以默认程序打开');
  expect(html).toContain('编辑登记');
  expect(html).toContain('移除登记');
  expect(html).not.toMatch(/data-action="(ai|mount|context)/);
});

test('藏 search matches names and 签 only, never contents or pointer paths', () => {
  expect(filterCangEntries([entry], 'password-sentinel', '', 'recent')).toEqual([]);
  expect(filterCangEntries([entry], '书', '', 'recent')).toEqual([entry]);
});
