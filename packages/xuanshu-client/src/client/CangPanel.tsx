/**
 * 票 14 · 藏的**门厅面板**（main key `cang`；S15 §「藏」”。
 *
 * 四条「为什么」：
 *   1. **它是给人看的清单**：登记指针 + 签 + 跳转，**不读内容**。所以这里没有摘要、没有问题框、
 *      没有「让 AI 看看」、没有「加入上下文」、没有「挂载到会话」—— 那句缺失清单（卡片底部那行小字）
 *      是**刻意的负向声明**，不是还没做完。产品硬线见 `cang-model.ts` 的 `CANG_AI_FREE`。
 *   2. **搜索只在登记表的元数据上做**：`filterCangEntries` 只匹配「藏名 + 签」，
 *      **既不去读路径字符串指向的文件，也不去搜路径文本**（路径只做只读展示）。
 *      所以搜索是纯函数、可无 DOM 单测，也不会因为某个藏很大而卡住界面。
 *   3. **取数只在 effect 里、且只读两次**：`cang.list` + `cang.capabilities`（后者决定桌面按钮的可用性）。
 *      写操作（登记 / 移除 / 打开 / 显示位置）**只从按钮的 onClick 走** —— 组件里没有任何自动写。
 *      重取由两个东西触发：controller 的 `revision`（人点了会自增）与本地 `reload`（错误态的重试）。
 *   4. **指针失效必须显形**：卡片显示「指针有效 · 玄枢未读取」或「指针失效 · <原因>」，
 *      失效时打开/显示位置都禁用（`disabled={!entry.pointer.valid}`）—— 不让用户点了才发现文件没了。
 *
 * 槽位与注册面：本组件由 `cang.tsx` 的 `installCangClient` 注进 `main` 槽
 * （槽位面见 `.scratch/notes/dsh-api-facts.md §6.5`；**具体 file:line 未确认**，不编）。
 * 三态（loading / error / empty）+ 空态可执行（空态里就有「登记第一个藏」）。
 *
 * 入口唯一（#69 / 判据 N-001，两个「为什么」）：
 *   5. **这里不再有去谱管理的按钮**：谱管理的门只有侧栏行「谱」一个（十个面板共同的唯一导航原语）。
 *      面板里再放一个「查看谱」就是同一动作的第二扇门 —— 用户要在两个地方决定点哪个。
 *      「藏 vs 谱」这句边界话留着（它是信息，不是门），只是把去路说成侧栏行。
 *   6. **空态只有一扇登记门**：工具条的「登记藏」在空态不渲染（不是置灰 —— 置灰仍是一个门）。
 *      空态自带「登记第一个藏」那一个 CTA（#68 补的可执行空态），两个并排就是 N-001 的重复入口。
 *      两扇门**名字不同是有意的**：它们互斥（同一时刻只出现一扇），判据按**同一时刻**数门
 *      （`browser-nav.mjs` 的 `entriesInWorstSnapshot`），所以不需要、也不该靠「同名」让并集去重 ——
 *      同名只会把「这里其实有两扇门」这件事藏起来（用户在不同状态看到不同的门，找不到同一个按钮）。
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CangApi, CangController, CangEntry, CangList } from './cang-model.js';
import { CANG_AI_FREE, newCangDraft } from './cang-model.js';
import { dataDirPath } from './home-paths.js';

/**
 * 过滤 + 排序（**纯函数**，无 DOM）：只在登记表的元数据上匹配。
 * 排序两种口径：`recent` = 最近登记（`createdAt` 倒序，字符串比较够用，ISO 时间天然可比）；
 * `name` = 名称（`zh-CN` 排序，中文按拼音/笔画走 ICU，不用自己写比较器）。
 */
export function filterCangEntries(entries: CangEntry[], query: string, tag: string, sort: 'recent' | 'name'): CangEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter(entry => (!tag || entry.tags.includes(tag)) && (!needle || [entry.name, ...entry.tags].some(value => value.toLocaleLowerCase().includes(needle))))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : b.createdAt.localeCompare(a.createdAt));
}
export interface CangPanelProps { api: CangApi; controller: CangController; initialData?: CangList }
export function CangPanel({ api, controller, initialData }: CangPanelProps) {
  // 与抽屉共享同一个 controller：`revision` 变了就重取（见 cang.tsx 文件头第 1 条）。
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
  // 桌面能力：探不到就当**没有**（宁可禁用按钮，也不给一个点下去会报错的按钮）。
  const [desktop, setDesktop] = useState(true);
  const [remove, setRemove] = useState<CangEntry>();
  useEffect(() => {
    // 只读两次取数；卸载/重取时 abort，避免旧响应覆盖新状态。
    const abort = new AbortController();
    setLoading(true); setError('');
    api.list(abort.signal).then(result => { if (!abort.signal.aborted) setData(result); })
      .catch(reason => { if (!abort.signal.aborted) setError(String(reason.message ?? reason)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    api.capabilities(abort.signal).then(value => { if (!abort.signal.aborted) setDesktop(value.desktop); }).catch(() => { if (!abort.signal.aborted) setDesktop(false); });
    return () => abort.abort();
  }, [api, state.revision, reload]);
  /** 一个写操作的外壳：忙态 + 把宿主的拒绝原话落到 `notice`（**不吞错**）。 */
  async function action(operation: () => Promise<unknown>) {
    setBusy(true); setNotice('');
    try { await operation(); } catch (reason) { setNotice(String((reason as Error).message ?? reason)); } finally { setBusy(false); }
  }
  const entries = data?.entries ?? [];
  // 空态（有分支、无条目）：由空态那一块给唯一的一扇登记门，工具条的「登记藏」让位。
  const empty = !loading && !error && !entries.length;
  const tags = [...new Set(entries.flatMap(entry => entry.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const filtered = filterCangEntries(entries, query, tag, sort);
  // 按「签」分组（没贴签的归到「未贴签」）；同一个藏挂了几个签就在几组里各出现一次。
  const groups = new Map<string, CangEntry[]>();
  for (const entry of filtered) for (const label of entry.tags.length ? entry.tags : ['未贴签']) groups.set(label, [...(groups.get(label) ?? []), entry]);
  return <section className="xs-cang" data-xuanshu-panel="cang">
    <h1>藏库</h1>
    <p className="xs-cang__boundary" data-xuanshu-note="no-ai">{CANG_AI_FREE}</p>
    <p>谱会被 AI 读进上下文；藏只是你自己的本地文件入口。<span className="xs-cang__how">（要找谱：点侧栏「谱」。）</span></p>
    <p>藏不是挂载对象；工作区与工作流走临时挂载。</p>
    <div className="xs-cang__toolbar">
      {empty ? null : <button type="button" disabled={loading || !!error} onClick={() => controller.edit(newCangDraft())}>登记藏</button>}
      <label>搜藏名 / 签 <input value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>签 <select value={tag} onChange={event => setTag(event.target.value)}><option value="">全部</option>{tags.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>排序 <select value={sort} onChange={event => setSort(event.target.value as 'recent' | 'name')}><option value="recent">最近登记</option><option value="name">名称</option></select></label>
    </div>
    {loading && <p role="status">正在读取藏库注册表…</p>}
    {error && <div role="alert"><p>注册表读取失败：{error}</p><button type="button" onClick={() => setReload(value => value + 1)}>重试</button></div>}
    {notice && <p role="alert">{notice}</p>}
    {empty && <div className="xs-cang__empty"><p>你还没有登记任何藏。藏只登记指针，不复制文件。</p><button type="button" onClick={() => controller.edit(newCangDraft())}>登记第一个藏</button></div>}
    {!loading && !error && !!entries.length && !filtered.length && <p>没有匹配的藏名或签。</p>}
    {!loading && !error && [...groups].map(([label, items]) => <details open key={label} className="xs-cang__group"><summary>签「{label}」（{items.length}）</summary>{items.map(entry => <article className="xs-cang__card" key={entry.id} data-cang-id={entry.id}>
      <h2>{entry.name} <span className="xs-cang__status">已登记</span></h2>
      <p>签：{entry.tags.join(' · ') || '未贴签'}</p>
      <p>路径（只读）：<code>{entry.path}</code></p>
      <p>{entry.pointer.valid ? '指针有效 · 玄枢未读取' : `指针失效 · ${entry.pointer.reason ?? ''}`} <small>最后校验：{entry.pointer.checkedAt}</small></p>
      <div className="xs-cang__actions">
        {/* 三个入口各自受 `entry.actions` 开关控制；打开/显示位置还要桌面可用 + 指针有效。 */}
        {entry.actions.open && <button type="button" data-action="open" disabled={busy || !desktop || !entry.pointer.valid} title={!desktop ? '宿主没有可用桌面，请复制路径在本机打开' : entry.pointer.reason} onClick={() => void action(() => api.open(entry.id))}>以默认程序打开</button>}
        <details className="xs-cang__more"><summary>更多操作</summary><div>
          {entry.actions.reveal && <button type="button" disabled={busy || !desktop || !entry.pointer.valid} onClick={() => void action(() => api.reveal(entry.id))}>显示所在位置</button>}
          {/* 复制路径是纯客户端动作（不经过宿主），所以只要不忙就能点。 */}
          {entry.actions.copy && <button type="button" disabled={busy} onClick={() => void action(() => navigator.clipboard.writeText(entry.path))}>复制路径</button>}
          <button type="button" onClick={() => controller.edit(entry)}>{entry.pointer.valid ? '编辑登记' : '重新定位'}</button>
          <button type="button" onClick={() => setRemove(entry)}>移除登记</button>
        </div></details>
      </div>
      <small>本卡没有：摘要 / 问答 / 「让 AI 看看」/ 加入上下文 / 挂载到会话</small>
    </article>)}</details>)}
    {/* 移除只删**登记**，不删文件 —— 确认文案把这件事说死（宿主那侧也只追加一行 remove 事件）。 */}
    {remove && <div className="xs-cang__confirm" role="alertdialog" aria-label="确认移除登记"><p>只从藏库移除「{remove.name}」的登记，不会删除你的文件。</p><button type="button" disabled={busy} onClick={() => void action(async () => { await api.remove(remove.id); setRemove(undefined); controller.changed(); })}>确认移除登记</button><button type="button" disabled={busy} onClick={() => setRemove(undefined)}>取消</button></div>}
    {/* 注册表路径由宿主 `cang.list` 回传（真实绝对路径）；拿不到时给中性占位，不写死任何一档。 */}
    <footer><code>{data?.registryPath ?? dataDirPath(undefined, 'cang', 'registry.jsonl')}</code><p>只存指针 + 签 + 跳转，不存内容。拷走注册表 ≠ 拷走这些文件；换机器后请重新定位。</p></footer>
  </section>;
}
