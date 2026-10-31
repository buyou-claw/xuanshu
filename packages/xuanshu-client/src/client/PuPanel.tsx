import { useEffect, useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import { readService } from './ctx-service.js';
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';
import { installXuanshuStyles, registerStyleSheet } from './styles.js'
import { BREAKPOINT_WIDE_PX } from './breakpoints.js'
import type { PanelNavTarget } from './panel.js'

type Level = 'base' | 'optional';
interface Pu { slug: string; name: string; level: Level; description: string; body: string; summary: string; source: string; updatedAt: string; stale?: boolean; error?: string }
interface Draft { name: string; level: Level; description: string; body: string; summary: string }
interface Job { id: string; sessionId: string; status: 'running' | 'ready' | 'error' | 'canceled'; draft?: Draft; error?: string }
/**
 * 面板需要的 ctx 面。
 *
 * **不写成 `interface PuClient extends Context`**：cordis 的 `Context` 上已经声明了
 * `uiWorkspace: UiWorkspace`（非可选），再声明一个可选的同名属性会让接口「错误地扩展」
 * （`TS2430`：`undefined` 不可赋给非可选）。而这里**恰恰**要的是「拿不到就置灰」——
 * 服务缺席是真实运行状态（票 07 的 fail-soft 约定），所以显式把它从基类型里摘掉再补可选版。
 */
type PuClient = Omit<Context, 'uiWorkspace'> &
  RpcContext & { uiWorkspace?: { openSession(id: string): void } };
let pendingJob: Job | undefined;
let pendingView: 'create' | 'detail' = 'create';
let pendingSelected: Pu | undefined;

/**
 * ── 跨面板**意图**：谱面板的第二个模块级槽（`pendingJob` / `pendingView` 那套的同款写法，
 *    不另造一套机制）────────────────────────────────────────────────────────────
 *
 * **为什么要有它**（要解决的不是「实现没写完」，是**两个权威打架**）：
 *   - 判据 N-001：同一个动作出现在两个及以上入口即红 —— 谱面板的门只能有侧栏行「谱」那一扇；
 *   - 设计稿 S7（`docs/design/ui-v1/screens/S7-问事历史回看.md:65`）：历史首次空态**必须**有
 *     「主按钮（去开一次问事）+ 次按钮（先建谱）」；沉淀刚写完那一刻的追问路径也不能删。
 * 三处调用点原先都只做 `navigate('pus')`，于是它们就是同一动作的第二、第三扇门：门数没少，
 * 只是换了个位置。让它们变成**真正不同的动作**（建一个新谱 / 打开刚写进的那张谱）之后，
 * 「谱管理」才重新只剩侧栏那一扇门，而 S7 要的那颗次按钮也留得下来。
 *
 * **为什么不给 `navigate()` 加参数**：`navigate` 是从根一路当 prop 透传下来的（12 个组件的
 * props 里都有），改签名会波及全部透传点；而这两个意图只跟谱面板有关，模块级一个槽就够。
 *
 * **消费纪律**：
 *   - 设意图与跳面板是**两件事**，由调用点成对做（`requestPuCreateAndGo` / `requestPuOpenAndGo`）；
 *   - 谱面板挂载时**只读**一次（`peekPuIntent()`）算初始视图，挂载完成后才销账（`consumePuIntent()`）：
 *     严格模式会把组件函数连同 `useState` 初始化器跑两遍，若在初始化器里就地清空，
 *     第二遍就读不到意图 —— 向导被吃掉一次；
 *   - 面板**已经挂在墙上**时切回来不会重跑初始化器，所以另订阅一份通知（同一次意图只生效一次）。
 */
export interface PuRef {
  slug: string;
  name: string;
  body: string;
  /**
   * 其余字段可缺省：沉淀那边递过来的是一份刚写回的谱视图（`SedimentPuView`，`level` 是
   * `string`、其余可选）。硬套面板的 `Pu` 只会逼调用点写 `as`，缺的按「可选输入级 + 空」补齐。
   */
  level?: string;
  description?: string;
  summary?: string;
  source?: string;
  updatedAt?: string;
}
export type PuIntent = { kind: 'create' } | { kind: 'open'; pu: PuRef };
let pendingIntent: PuIntent | undefined;
const intentListeners = new Set<() => void>();

/** 把递进来的谱视图补成面板详情页能直接渲染的 `Pu`（受控 `select` 不能拿 `undefined` 当值）。 */
function toPuPoint(ref: PuRef): Pu {
  return {
    slug: ref.slug,
    name: ref.name,
    body: ref.body,
    level: ref.level === 'base' ? 'base' : 'optional',
    description: ref.description ?? '',
    summary: ref.summary ?? '',
    source: ref.source ?? '',
    updatedAt: ref.updatedAt ?? '',
  };
}
/** 读一眼意图，**不清空**：给首次挂载算初始视图（清空的事交给挂载后的那一遍）。 */
function peekPuIntent(): PuIntent | undefined { return pendingIntent; }
/**
 * 取走并清空：**消费一次即消失**，否则下次切回谱面板又会自动弹向导。
 * 导出是因为面板挂载后由 effect 调它，而 effect 在 SSR 里不跑 —— 用例要点得到这条纪律。
 */
export function consumePuIntent(): PuIntent | undefined {
  const taken = pendingIntent;
  pendingIntent = undefined;
  return taken;
}
function announcePuIntent(): void { for (const listener of [...intentListeners]) listener(); }

/** 「建一个谱」：谱面板一进来就是建谱向导第 1 步（S7:65 的次按钮走这条）。 */
export function requestPuCreate(): void { pendingIntent = { kind: 'create' }; announcePuIntent(); }
/** 「打开这张谱」：谱面板一进来就是这张谱的详情（沉淀刚写完的那一跳走这条）。 */
export function requestPuOpen(pu: PuRef): void { pendingIntent = { kind: 'open', pu }; announcePuIntent(); }

/**
 * 「设意图 + 跳面板」成对的两条接线（导出是为了让用例点得到这条链：SSR 拿不到 onClick，
 * 只能从元素树上取按钮再手动触发它的处理器）。
 */
export function requestPuCreateAndGo(navigate: (target: PanelNavTarget) => void): void {
  requestPuCreate(); navigate('pus');
}
export function requestPuOpenAndGo(pu: PuRef, navigate: (target: PanelNavTarget) => void): void {
  requestPuOpen(pu); navigate('pus');
}

/** 初始视图：`pendingJob` 优先（沿用现在的行为：一进就回原来那步），其次建谱意图，再次打开意图。 */
function initialViewOf(intent: PuIntent | undefined): 'list' | 'create' | 'detail' {
  if (pendingJob !== undefined) return pendingView;
  if (intent === undefined) return 'list';
  return intent.kind === 'create' ? 'create' : 'detail';
}

const blank: Draft = { name: '', level: 'optional', description: '', body: '# 概览\n', summary: '' };
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
async function fileData(file: File): Promise<{ name: string; data: string }> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file);
  });
  return { name: file.name, data };
}
function PuPanel({ ctx, openSession }: { ctx: PuClient; openSession?: (sessionId: string) => void }) {
  const [rows, setRows] = useState<Pu[]>([]); const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(''); const [level, setLevel] = useState(''); const [source, setSource] = useState('');
  /**
   * 挂载那一眼：只**读**意图（不清空），据此算初始视图与初始选中。
   *
   * 为什么不在 `useState` 初始化器里就地 `consumePuIntent()`：严格模式会把组件函数连同初始化器
   * 跑两遍 —— 第一遍清空、第二遍读到空，向导被吃掉一次。清空放在挂载后的 effect 里做，
   * 两遍读到的是同一份意图（「别让一次意图被吃掉又被弹两次」那条就靠这个分工）。
   */
  const [mount] = useState(() => {
    const intent = peekPuIntent();
    const view = initialViewOf(intent);
    // 打开意图带着谱；有进行中的转换作业时仍以 `pendingSelected` 为准（那是作业自己的落点）。
    const selected = intent !== undefined && intent.kind === 'open' && pendingJob === undefined
      ? toPuPoint(intent.pu)
      : pendingSelected;
    return { intent, view, selected, draft: view === 'detail' && selected !== undefined ? selected : blank };
  });
  const [view, setView] = useState<'list' | 'detail' | 'create'>(mount.view);
  const [step, setStep] = useState(pendingJob ? 3 : 1); const [job, setJob] = useState<Job | undefined>(pendingJob);
  const [text, setText] = useState(''); const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<Draft>(mount.draft); const [selected, setSelected] = useState<Pu | undefined>(mount.selected);
  const [original, setOriginal] = useState(mount.selected === undefined ? '' : JSON.stringify(mount.selected)); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
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
  /**
   * 意图的两处消费点（同一份 `pendingIntent`，一进一出）：
   *
   *   ① **首次挂载**：初始化时只读过它（`peekPuIntent`），这里正式销账 —— 一次意图只生效一次，
   *      否则下次切回谱面板又自动弹向导。
   *   ② **面板已经在墙上**：切回来不会重跑 `useState` 初始化器，所以订阅一份；收到就把视图切过去
   *      并当场清空。两处都走 `consumePuIntent()`，语义只有一份。
   */
  useEffect(() => {
    if (mount.intent !== undefined && peekPuIntent() === mount.intent) consumePuIntent();
    const applyIntent = () => {
      const intent = consumePuIntent();
      if (intent === undefined) return;
      setError('');
      if (intent.kind === 'create') {
        // 建谱：第 1 步从头开始；进行中的转换作业仍然接着走（`pendingJob` 比新点的按钮更重要）。
        setSelected(undefined); setDraft(blank); setOriginal('');
        setJob(pendingJob); setStep(pendingJob ? 3 : 1); setView('create');
        return;
      }
      const pu = toPuPoint(intent.pu);
      setSelected(pu); setDraft(pu); setOriginal(JSON.stringify(pu)); setView('detail');
    };
    intentListeners.add(applyIntent);
    return () => { intentListeners.delete(applyIntent); };
  }, []);
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
        <section><h2>基础输入级 base · {filtered.filter(p => p.level === 'base').length} 个</h2><p>进底稿提炼源 · 级别≠必填：所有谱都非必填，唯一必填项是底座八字。</p><p>🔒 底座（八字） · 只读 · 由出生信息与底座生成 · 默认在场 · 不可关 <button onClick={() => window.alert('底座默认在场、不可关；要修改，请重新录制出生信息并确认。')}>打开</button></p></section>
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
      {step === 2 && <><label>谱名<input value={draft.name} onChange={e => field('name', e.target.value)} /></label>{levels}<p>谱名唯一 · 目录名小写、- 连接、可含中文。所有谱均非必填。</p><p>预览：pus/{draft.name.trim().normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '')}/</p><button onClick={() => setStep(1)}>返回改资料</button><button disabled={busy || !draft.name.trim()} onClick={generate}>开始转换</button></>}
      {step === 3 && <p role="status">{job?.status === 'running' ? 'AI 正在读取资料、分节并提炼汇总。' : job?.error ?? '转换已中断，可重新开始。'} 借用 DSH coding 工具；中断不落盘。<button disabled={job?.status !== 'running'} onClick={() => void run(async () => { const canceled = await call<Job>('pu.cancel', { id: job?.id }); setJob(canceled); pendingJob = undefined; })}>中断</button><button onClick={() => setStep(2)}>返回改</button></p>}
      {step === 4 && <>{preview}<p>这一步只是预览，pus/ 下还没有任何文件。落盘后会出现在谱列表。</p><button onClick={() => setStep(2)}>返回改</button><button disabled={busy || job?.status !== 'ready'} onClick={() => void run(async () => { await call('pu.confirm', { id: job?.id, draft, level: draft.level, confirmed: true }); pendingJob = undefined; setJob(undefined); setStep(5); await reload(); })}>确认落盘</button></>}
      {step === 5 && <><p>已落盘：manifest.md + content.md + summary.md</p><button onClick={back}>回谱列表</button></>}
    </>}
    {job?.status === 'running' && <p>审批由 DSH 决定，玄枢不自建审批。{typeof openSession === 'function' && <button onClick={() => openSession(job.sessionId)}>在会话里看审批</button>}{view === 'detail' && <button onClick={() => void run(async () => { const canceled = await call<Job>('pu.cancel', { id: job.id }); setJob(canceled); pendingJob = undefined; })}>中断汇总提炼（不落盘）</button>}<span>返回「谱」可继续查看生成预览。</span></p>}
  </main>;
}
/**
 * 谱面板的**加性**注册（main key `pus` + 侧栏行 `pus`）。
 *
 * 由客户端根入口 `index.tsx` 的 `apply()` 调用（总装配）；单独调用也成立，
 * 因此断言台（`tests/assembly/pu-management.test.mjs`）可以直接调它。
 * 样式注入必须在非 DOM 环境（Node 里的产物物化、SSR 渲染断言）下安全返回 ——
 * 与 `cang-style.ts` / `style.ts` 同款守卫。
 */
export function installPuPanel(ctx: Context & RpcContext): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'pus', inject: () => ({
    ctx,
    // `ctx.uiWorkspace` 会抛（未声明服务），必须软取；拿不到就不渲染那个按钮。
    openSession: (sessionId: string) => {
      readService<{ openSession?(id: string): void }>(ctx, 'uiWorkspace')?.openSession?.(sessionId);
    },
  }) }, PuPanel as never));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'pus', order: 40, label: '谱' }, () => <span aria-hidden="true">谱</span>));
  registerStyleSheet('xs-pu-style', `.xs-pu{padding:24px;overflow:auto;height:100%;color:var(--dsw-alias-text-primary);background:var(--dsw-alias-bg-canvas)}.xs-pu header,.xs-pu-toolbar,.xs-pu article{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.xs-pu article{justify-content:space-between;padding:12px;border-bottom:1px solid var(--dsw-alias-border-default)}.xs-pu label{display:block;margin:12px 0}.xs-pu input,.xs-pu select,.xs-pu textarea,.xs-pu button{color:inherit;background:var(--dsw-alias-bg-surface);border:1px solid var(--dsw-alias-border-default);border-radius:8px;padding:8px;font:inherit}.xs-pu button{cursor:pointer;margin:4px}.xs-pu button:disabled{opacity:.5;cursor:default}.xs-pu textarea{display:block;width:100%;min-height:100px;box-sizing:border-box}.xs-pu .xs-pu-body{min-height:220px;font-family:monospace}.xs-pu-detail{display:grid;grid-template-columns:1fr 1fr;gap:12px}.xs-pu section{margin:24px 0}.xs-pu [role=alert]{padding:12px;border:1px solid var(--dsw-alias-border-danger)}@media(max-width: ${BREAKPOINT_WIDE_PX}px){.xs-pu-detail{grid-template-columns:1fr}.xs-pu{padding:16px}}`)
  installXuanshuStyles()
}
