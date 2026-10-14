import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CangApi, CangController, CangEntry, CangList } from './cang-model.js';
import { CANG_AI_FREE, newCangDraft } from './cang-model.js';

/** Registry metadata only: neither path text nor pointed-to content is searched. */
export function filterCangEntries(entries: CangEntry[], query: string, tag: string, sort: 'recent' | 'name'): CangEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter(entry => (!tag || entry.tags.includes(tag)) && (!needle || [entry.name, ...entry.tags].some(value => value.toLocaleLowerCase().includes(needle))))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : b.createdAt.localeCompare(a.createdAt));
}
export interface CangPanelProps { api: CangApi; controller: CangController; navigatePus?: () => void; initialData?: CangList }
export function CangPanel({ api, controller, navigatePus, initialData }: CangPanelProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const [data, setData] = useState<CangList | undefined>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [desktop, setDesktop] = useState(true);
  const [remove, setRemove] = useState<CangEntry>();
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError('');
    api.list(abort.signal).then(result => { if (!abort.signal.aborted) setData(result); })
      .catch(reason => { if (!abort.signal.aborted) setError(String(reason.message ?? reason)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    api.capabilities(abort.signal).then(value => { if (!abort.signal.aborted) setDesktop(value.desktop); }).catch(() => { if (!abort.signal.aborted) setDesktop(false); });
    return () => abort.abort();
  }, [api, state.revision, reload]);
  async function action(operation: () => Promise<unknown>) {
    setBusy(true); setNotice('');
    try { await operation(); } catch (reason) { setNotice(String((reason as Error).message ?? reason)); } finally { setBusy(false); }
  }
  const entries = data?.entries ?? [];
  const tags = [...new Set(entries.flatMap(entry => entry.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const filtered = filterCangEntries(entries, query, tag, sort);
  const groups = new Map<string, CangEntry[]>();
  for (const entry of filtered) for (const label of entry.tags.length ? entry.tags : ['未贴签']) groups.set(label, [...(groups.get(label) ?? []), entry]);
  return <section className="xs-cang" data-xuanshu-panel="cang">
    <h1>藏库</h1>
    <p className="xs-cang__boundary" data-xuanshu-note="no-ai">{CANG_AI_FREE}</p>
    <p>谱会被 AI 读进上下文；藏只是你自己的本地文件入口。<button type="button" disabled={!navigatePus} onClick={navigatePus}>查看谱</button></p>
    <p>藏不是挂载对象；工作区与工作流走临时挂载。</p>
    <div className="xs-cang__toolbar">
      <button type="button" disabled={loading || !!error} onClick={() => controller.edit(newCangDraft())}>登记藏</button>
      <label>搜藏名 / 签 <input value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>签 <select value={tag} onChange={event => setTag(event.target.value)}><option value="">全部</option>{tags.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>排序 <select value={sort} onChange={event => setSort(event.target.value as 'recent' | 'name')}><option value="recent">最近登记</option><option value="name">名称</option></select></label>
    </div>
    {loading && <p role="status">正在读取藏库注册表…</p>}
    {error && <div role="alert"><p>注册表读取失败：{error}</p><button type="button" onClick={() => setReload(value => value + 1)}>重试</button></div>}
    {notice && <p role="alert">{notice}</p>}
    {!loading && !error && !entries.length && <div className="xs-cang__empty"><p>你还没有登记任何藏。藏只登记指针，不复制文件。</p><button type="button" onClick={() => controller.edit(newCangDraft())}>登记第一个藏</button></div>}
    {!loading && !error && !!entries.length && !filtered.length && <p>没有匹配的藏名或签。</p>}
    {!loading && !error && [...groups].map(([label, items]) => <details open key={label} className="xs-cang__group"><summary>签「{label}」（{items.length}）</summary>{items.map(entry => <article className="xs-cang__card" key={entry.id} data-cang-id={entry.id}>
      <h2>{entry.name} <span className="xs-cang__status">已登记</span></h2>
      <p>签：{entry.tags.join(' · ') || '未贴签'}</p>
      <p>路径（只读）：<code>{entry.path}</code></p>
      <p>{entry.pointer.valid ? '指针有效 · 玄枢未读取' : `指针失效 · ${entry.pointer.reason ?? ''}`} <small>最后校验：{entry.pointer.checkedAt}</small></p>
      <div className="xs-cang__actions">
        {entry.actions.open && <button type="button" data-action="open" disabled={busy || !desktop || !entry.pointer.valid} title={!desktop ? '宿主没有可用桌面，请复制路径在本机打开' : entry.pointer.reason} onClick={() => void action(() => api.open(entry.id))}>以默认程序打开</button>}
        <details className="xs-cang__more"><summary>更多操作</summary><div>
          {entry.actions.reveal && <button type="button" disabled={busy || !desktop || !entry.pointer.valid} onClick={() => void action(() => api.reveal(entry.id))}>显示所在位置</button>}
          {entry.actions.copy && <button type="button" disabled={busy} onClick={() => void action(() => navigator.clipboard.writeText(entry.path))}>复制路径</button>}
          <button type="button" onClick={() => controller.edit(entry)}>{entry.pointer.valid ? '编辑登记' : '重新定位'}</button>
          <button type="button" onClick={() => setRemove(entry)}>移除登记</button>
        </div></details>
      </div>
      <small>本卡没有：摘要 / 问答 / 「让 AI 看看」/ 加入上下文 / 挂载到会话</small>
    </article>)}</details>)}
    {remove && <div className="xs-cang__confirm" role="alertdialog" aria-label="确认移除登记"><p>只从藏库移除「{remove.name}」的登记，不会删除你的文件。</p><button type="button" disabled={busy} onClick={() => void action(async () => { await api.remove(remove.id); setRemove(undefined); controller.changed(); })}>确认移除登记</button><button type="button" disabled={busy} onClick={() => setRemove(undefined)}>取消</button></div>}
    <footer><code>{data?.registryPath ?? '~/.dsh/xuanshu/cang/registry.jsonl'}</code><p>只存指针 + 签 + 跳转，不存内容。拷走注册表 ≠ 拷走这些文件；换机器后请重新定位。</p></footer>
  </section>;
}
