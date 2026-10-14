import { useEffect, useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';

type Level = 'base' | 'optional';
interface Pu { slug: string; name: string; level: Level; description: string; body: string; summary: string; source: string; updatedAt: string; stale?: boolean; error?: string }
interface Draft { name: string; level: Level; description: string; body: string; summary: string }
interface Job { id: string; sessionId: string; status: 'running' | 'ready' | 'error' | 'canceled'; draft?: Draft; error?: string }
interface PuClient extends Context, RpcContext { uiWorkspace: { openSession(id: string): void } }
let pendingJob: Job | undefined;
let pendingView: 'create' | 'detail' = 'create';
let pendingSelected: Pu | undefined;
const blank: Draft = { name: '', level: 'optional', description: '', body: '# 概览\n', summary: '' };
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
async function fileData(file: File): Promise<{ name: string; data: string }> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file);
  });
  return { name: file.name, data };
}
function PuPanel({ ctx }: { ctx: PuClient }) {
  const [rows, setRows] = useState<Pu[]>([]); const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(''); const [level, setLevel] = useState(''); const [source, setSource] = useState('');
  const [view, setView] = useState<'list' | 'detail' | 'create'>(pendingJob ? pendingView : 'list');
  const [step, setStep] = useState(pendingJob ? 3 : 1); const [job, setJob] = useState<Job | undefined>(pendingJob);
  const [text, setText] = useState(''); const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<Draft>(pendingJob && pendingView === 'detail' && pendingSelected ? pendingSelected : blank); const [selected, setSelected] = useState<Pu | undefined>(pendingSelected);
  const [original, setOriginal] = useState(pendingSelected ? JSON.stringify(pendingSelected) : ''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const call = <T,>(method: string, payload?: unknown) => rpcCall<T>(ctx, method, payload);
  const reload = async () => {
    setLoading(true); setError('');
    try { setRows(await call<Pu[]>('pu.list')); } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    if (job?.status !== 'running') return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const current = await call<Job>('pu.job', { id: job.id });
        if (disposed) return; pendingJob = current; setJob(current);
        if (current.status === 'ready' && current.draft && view === 'create') { setDraft(current.draft); setStep(4); }
        if (current.status === 'error') setError(current.error ?? '转换失败');
        if (current.status === 'running') timer = setTimeout(() => { void poll(); }, 1200);
      } catch (e) { if (!disposed) setError(errorText(e)); }
    };
    void poll(); return () => { disposed = true; clearTimeout(timer); };
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (job?.status === 'ready' && job.draft && step === 3 && view === 'create') { setDraft(job.draft); setStep(4); }
  }, [job, step]);
  const run = async (operation: () => Promise<void>) => { setBusy(true); setError(''); try { await operation(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const open = (slug: string) => void run(async () => {
    const pu = await call<Pu>('pu.read', { slug }); setSelected(pu); setDraft(pu); setOriginal(JSON.stringify(pu)); setView('detail');
  });
  const back = () => {
    if (view === 'detail' && original !== JSON.stringify(draft) && !window.confirm('尚有未保存的改动，确认离开？')) return;
    setView('list'); setError('');
  };
  const field = (key: keyof Draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const levels = <label>级别 <select value={draft.level} onChange={e => field('level', e.target.value)}><option value="base">基础输入级 base</option><option value="optional">可选输入级 optional</option></select></label>;
  const preview = <div className="xs-pu-detail">
    <label>名称<input value={draft.name} onChange={e => field('name', e.target.value)} /></label>{levels}
    <label>描述（manifest 概览，AI 优先读）<textarea value={draft.description} onChange={e => field('description', e.target.value)} /></label>
    <label>细节（Markdown 一级标题分节，须含概览）<textarea className="xs-pu-body" value={draft.body} onChange={e => field('body', e.target.value)} /></label>
    <label>汇总 summary.md（AI 快速定位，人可改）<textarea value={draft.summary} onChange={e => field('summary', e.target.value)} /></label>
  </div>;
  const generate = () => void run(async () => {
    const created = await call<Job>('pu.generate', { name: draft.name, level: draft.level, text, attachments: await Promise.all(files.map(fileData)), clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    pendingJob = created; pendingView = 'create'; pendingSelected = undefined; setJob(created); setStep(3);
  });
  const filtered = rows.filter(p => (!level || p.level === level) && (!source || p.source === source) && (!query || `${p.name}\n${p.description}\n${p.body}`.toLowerCase().includes(query.toLowerCase())));
  return <main className="xs-pu" aria-label="谱管理">
    <header><h1>{view === 'create' ? '创建新谱' : view === 'detail' ? `谱管理 / ${selected?.name}` : '谱管理'}</h1>{view !== 'list' && <button onClick={back}>← 返回列表</button>}</header>
    {error && <div role="alert">{error} <button onClick={() => void reload()}>重试</button><p>数据目录：$DSH_HOME/xuanshu/pus/</p></div>}
    {view === 'list' && <>
      <div className="xs-pu-toolbar"><input aria-label="搜索谱" placeholder="搜索 名称 / 描述 / 正文" value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label="级别筛选" value={level} onChange={e => setLevel(e.target.value)}><option value="">全部级别</option><option value="base">基础输入级</option><option value="optional">可选输入级</option></select>
        <select aria-label="来源筛选" value={source} onChange={e => setSource(e.target.value)}><option value="">全部来源</option>{['manual', 'ai-assisted', 'sediment', 'workflow'].map(s => <option key={s}>{s}</option>)}</select>
        <button onClick={() => { setView('create'); setStep(pendingJob ? 3 : 1); setJob(pendingJob); if (!pendingJob) setDraft(blank); }}>＋ 创建新谱</button></div>
      {loading ? <p role="status">正在读取谱…</p> : <>
        <section><h2>基础输入级 base · {filtered.filter(p => p.level === 'base').length} 个</h2><p>进底稿提炼源 · 级别≠必填：所有谱都非必填，唯一必填项是底座八字。</p><p>🔒 底座（八字） · 只读 · 由出生信息与底座生成 · 默认在场 · 不可关</p></section>
        {(['base', 'optional'] as const).map(group => <section key={group}>{group === 'optional' && <><h2>可选输入级 optional · {filtered.filter(p => p.level === group).length} 个</h2><p>底稿不采 · 问事时按需追加</p></>}{filtered.filter(p => p.level === group || (group === 'optional' && p.error)).map(p => <article key={p.slug}><div><strong>{p.name}</strong><p>{p.description}</p><small>{p.source} · {p.updatedAt}{p.stale && ' · 汇总可能过期'}</small>{p.error && <p role="alert">{p.error}</p>}</div><button disabled={!!p.error || busy} onClick={() => open(p.slug)}>打开 / 编辑</button></article>)}</section>)}
        {!filtered.length && <div><p>{rows.length ? '没有匹配的谱' : '还没有可选谱：谱由你积累，非必填、不阻塞使用。'}</p><button onClick={() => { setQuery(''); setLevel(''); setSource(''); }}>清空筛选</button></div>}
      </>}
      <p>本列表只收谱。工作区 / 工作流与谱并列独立、不是谱。你自己的本地文件在藏库里，永不进 AI。</p>
    </>}
    {view === 'detail' && selected && <>{preview}<p>{draft.level === 'base' ? '本谱是底稿提炼源（进底稿）' : '底稿不采；问事时按需追加'} · 级别变更下次底稿刷新生效。</p><p>元信息：spec pu/1 · source {selected.source} · updated_at {selected.updatedAt} · 签：预留字段，暂不启用</p><p>数据目录：$DSH_HOME/xuanshu/pus/{selected.slug}/</p>
      <button disabled={busy} onClick={() => void run(async () => {
        if (draft.body !== selected.body && draft.summary !== selected.summary && !window.confirm(`正文与汇总均改变。${draft.level === 'base' ? '会影响底稿提炼源。' : '只在问事按需追加。'}确认保存这些事实？`)) return;
        const saved = await call<Pu>('pu.update', { slug: selected.slug, draft, confirmed: true }); setSelected(saved); setDraft(saved); setOriginal(JSON.stringify(saved)); await reload();
      })}>保存</button>
      <button disabled={busy || job?.status === 'running'} onClick={() => void run(async () => { const created = await call<Job>('pu.generate', { name: draft.name, level: draft.level, text: `# 当前谱\n${draft.description}\n${draft.body}`, summaryOnly: true }); pendingJob = created; pendingView = 'detail'; pendingSelected = { ...selected, ...draft }; setJob(created); })}>重建 summary（AI 提炼）</button>
      {job?.status === 'ready' && job.draft && <button onClick={() => { field('summary', job.draft!.summary); pendingJob = undefined; setJob(undefined); }}>采用候选汇总（保存后落盘）</button>}
    </>}
    {view === 'create' && <><p aria-label="创建步骤">① 给资料 → ② 定义谱名 → ③ AI 转换中 → ④ 生成预览 → ⑤ 确认落盘</p>
      {step === 1 && <><label>资料文字<textarea value={text} onChange={e => setText(e.target.value)} placeholder="把你知道的先写进来" /></label><label>附件（MD / PDF / 任意文件）<input type="file" multiple onChange={e => setFiles(Array.from(e.target.files ?? []))} /></label><ul>{files.map((f, i) => <li key={i}>{f.name}</li>)}</ul><p>语音输入 v2 再做。</p><button disabled={!text.trim() && !files.length} onClick={() => setStep(2)}>下一步</button></>}
      {step === 2 && <><label>谱名<input value={draft.name} onChange={e => field('name', e.target.value)} /></label>{levels}<p>谱名唯一 · 目录名小写、- 连接、可含中文。所有谱均非必填。</p><button onClick={() => setStep(1)}>返回改资料</button><button disabled={busy || !draft.name.trim()} onClick={generate}>开始转换</button></>}
      {step === 3 && <p role="status">{job?.status === 'running' ? 'AI 正在读取资料、分节并提炼汇总。' : job?.error ?? '转换已中断，可重新开始。'} 借用 DSH coding 工具；中断不落盘。<button disabled={job?.status !== 'running'} onClick={() => void run(async () => { const canceled = await call<Job>('pu.cancel', { id: job?.id }); setJob(canceled); pendingJob = undefined; })}>中断</button><button onClick={() => setStep(2)}>返回改</button></p>}
      {step === 4 && <>{preview}<p>这一步只是预览，pus/ 下还没有任何文件。落盘后会出现在谱列表。</p><button onClick={() => setStep(2)}>返回改</button><button disabled={busy || job?.status !== 'ready'} onClick={() => void run(async () => { await call('pu.confirm', { id: job?.id, draft, level: draft.level, confirmed: true }); pendingJob = undefined; setJob(undefined); setStep(5); await reload(); })}>确认落盘</button></>}
      {step === 5 && <><p>已落盘：manifest.md + content.md + summary.md</p><button onClick={back}>回谱列表</button></>}
    </>}
    {job?.status === 'running' && <p>审批由 DSH 决定，玄枢不自建审批。<button onClick={() => ctx.uiWorkspace.openSession(job.sessionId)}>在会话里看审批</button><span>返回「谱」可继续查看生成预览。</span></p>}
  </main>;
}
export function installPuPanel(ctx: PuClient): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'pus', inject: () => ({ ctx }) }, PuPanel));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'pus', order: 40, label: '谱' }, () => <span aria-hidden="true">谱</span>));
  if (document.getElementById('xs-pu-style')) return;
  const style = document.createElement('style'); style.id = 'xs-pu-style'; style.textContent = `.xs-pu{padding:24px;overflow:auto;height:100%;color:var(--dsw-alias-text-primary);background:var(--dsw-alias-bg-canvas)}.xs-pu header,.xs-pu-toolbar,.xs-pu article{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.xs-pu article{justify-content:space-between;padding:12px;border-bottom:1px solid var(--dsw-alias-border-default)}.xs-pu label{display:block;margin:12px 0}.xs-pu input,.xs-pu select,.xs-pu textarea,.xs-pu button{color:inherit;background:var(--dsw-alias-bg-surface);border:1px solid var(--dsw-alias-border-default);border-radius:8px;padding:8px;font:inherit}.xs-pu button{cursor:pointer;margin:4px}.xs-pu button:disabled{opacity:.5;cursor:default}.xs-pu textarea{display:block;width:100%;min-height:100px;box-sizing:border-box}.xs-pu .xs-pu-body{min-height:220px;font-family:monospace}.xs-pu-detail{display:grid;grid-template-columns:1fr 1fr;gap:12px}.xs-pu section{margin:24px 0}.xs-pu [role=alert]{padding:12px;border:1px solid var(--dsw-alias-border-danger)}@media(max-width:1100px){.xs-pu-detail{grid-template-columns:1fr}.xs-pu{padding:16px}}`; document.head.appendChild(style);
}
