/**
 * 票 14 · 藏的**抽屉**（`shell.overlay` 槽里的登记表单；new / edit 同一个组件）。
 *
 * 五条「为什么」：
 *   1. **无草稿时返回 `null`**：`CangOverlay` 只有在 controller 里有 `draft` 时才渲染抽屉。
 *      返回 `null` 时 overlay 不占任何点击面（槽位语义：没有内容的覆层应当可穿透 ——
 *      出处 `git` 里同款做法的注释（`shell.overlay` 的 click-through），**具体 file:line 未确认**，不编）。
 *   2. **改路径就重新探指针**：`useEffect` 只依赖 `draft.path`，调的是 `cang.validate` ——
 *      宿主那侧的 `validate()` 只做 `stat`/`realpath`（**不读内容、不列目录、不算大小、不建索引**，
 *      见 `packages/xuanshu-host/lib/cang/registry.mjs`）。所以「边打字边校验」不违反那条硬线。
 *   3. **名称自动填、但只填一次**：用户手动改过名称后（`nameTouched`）就不再被路径改写作覆盖 ——
 *      否则改名改到一半、回去微调路径，名字会被悄悄改掉。
 *   4. **键盘可达**：Esc 关（`!busy` 时）、Tab 在抽屉内循环、打开时聚焦第一个输入、关闭时把焦点还给
 *      打开它的那个元素。`role="dialog" aria-modal="true"` + `aria-labelledby` 是给读屏用的同一个事实。
 *   5. **提交按钮在人看清之前是禁用的**：`disabled={busy || !pointer?.valid || !draft.name.trim()}` ——
 *      指针没探通或没起名就不让登记（宿主也会拒，但界面先拦一次，省一次往返与一个错误提示）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CangApi, CangController, CangDraft, CangPointer } from './cang-model.js';
import { CANG_AI_FREE } from './cang-model.js';

/** 覆层：订阅 controller，只有拿到草稿才渲染抽屉（其它时候什么也不画）。 */
export function CangOverlay({ api, controller }: { api: CangApi; controller: CangController }) {
  const { draft } = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  return draft ? <CangDrawer api={api} controller={controller} initial={draft} /> : null;
}
export function CangDrawer({ api, controller, initial }: { api: CangApi; controller: CangController; initial: CangDraft }) {
  // 深拷一份初始草稿：编辑期间不写回 controller（取消 = 直接 close，什么都不用回滚）。
  const [draft, setDraft] = useState<CangDraft>(() => ({ ...initial, tags: [...initial.tags], actions: { ...initial.actions } }));
  // 签用文本输入（逗号分隔）：`，` 与 `,` 都认（中文输入法下几乎敲不出半角逗号）。
  const [tags, setTags] = useState(initial.tags.join('，'));
  const [nameTouched, setNameTouched] = useState(Boolean(initial.name));
  const [pointer, setPointer] = useState<CangPointer>();
  // 系统目录选择器能力（探不到 = 只让粘贴路径，按钮禁用并给 title 说明）。
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 空态：库里一条登记都没有（首次登记）时，抽屉先给一句「这是第一条」——
  // 否则新用户面对的是一片空表单，不知道自己该从哪儿开始。
  const [empty, setEmpty] = useState(false);
  /** 清单读不到时的可读原因（**不吞**：读不到 ≠ 库是空的，那一支要能被看到、也修得动）。 */
  const [listError, setListError] = useState('');
  /** 「重新读取」的重试计数（错误行的下一步得真的能点）。 */
  const [listRetry, setListRetry] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 路径一变就重探（旧请求 abort）：只探指针，不读内容 —— 见文件头第 2 条。
    const abort = new AbortController();
    setPointer(undefined);
    if (draft.path.trim()) api.validate(draft.path, abort.signal).then(value => { if (!abort.signal.aborted) setPointer(value); })
      .catch(reason => { if (!abort.signal.aborted) setError(String(reason.message ?? reason)); });
    return () => abort.abort();
  }, [api, draft.path]);
  useEffect(() => {
    // 挂载时问一次能力 + 聚焦第一个输入；卸载时把焦点还给打开抽屉的那个元素。
    const abort = new AbortController();
    api.capabilities(abort.signal).then(value => { if (!abort.signal.aborted) setPicker(value.directoryPicker); }).catch(() => {});
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { abort.abort(); previous?.focus(); };
  }, [api]);
  useEffect(() => {
    // 空态要先知道「库里是不是一条都没有」：只**读**一次清单（不写、不建索引、不读文件内容）。
    // 读不到就走错误态：既不声称「还没有」（那是编事实），也不静默吞掉 ——
    // 票 06 要的错误态那一支必须真的可复现，否则「读不到清单」会既不算空态也不算失败。
    const abort = new AbortController();
    api.list(abort.signal)
      .then(list => { if (!abort.signal.aborted) { setEmpty(list.entries.length === 0); setListError(''); } })
      .catch(reason => {
        if (abort.signal.aborted) return;
        setEmpty(false);
        setListError(String((reason as Error)?.message ?? reason));
      });
    return () => abort.abort();
  }, [api, listRetry]);
  /** 路径 → 名称兜底：取最后一段（去掉尾部斜杠），仅在用户没手动改过名字时生效。 */
  function changePath(path: string) {
    const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? '';
    setDraft(value => ({ ...value, path, name: nameTouched ? value.name : name })); setError('');
  }
  /** 人点「选择文件夹…」：系统选择器**只取指针**（不复制、不移动、不改内容）。 */
  async function pick() {
    setBusy(true); setError('');
    try { const { path } = await api.pickDirectory(); if (path) changePath(path); }
    catch (reason) { setError(String((reason as Error).message ?? reason)); } finally { setBusy(false); }
  }
  /** 人点「登记 / 保存登记」：`id` 在场 = 改，否则 = 新建；成功后推 revision 并关抽屉。 */
  async function submit() {
    setBusy(true); setError('');
    const input = { ...draft, tags: tags.split(/[,，]/).map(value => value.trim()).filter(Boolean) };
    try { if (input.id) await api.update(input); else await api.register(input); controller.changed(); controller.close(); }
    catch (reason) { setError(String((reason as Error).message ?? reason)); setBusy(false); }
  }
  return <div className="xs-cang__overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) controller.close(); }}>
    <div ref={dialog} className="xs-cang__drawer" role="dialog" aria-modal="true" aria-labelledby="xs-cang-drawer-title" onKeyDown={event => {
      // Esc 关（忙时不许关：提交中关掉会让用户不知道到底登记上没有）；Tab 在抽屉内循环。
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); controller.close(); }
      if (event.key === 'Tab') {
        const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []);
        const first = elements[0]; const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <h2 id="xs-cang-drawer-title">{draft.id ? '编辑登记' : '登记藏'}</h2>
      <p className="xs-cang__boundary">{CANG_AI_FREE}</p>
      {/* 空态（首次登记）：先说清楚「库里还是空的」，再给下一步（填路径 → 起名 → 登记）。 */}
      {empty && <p className="xs-cang__empty">藏库里还没有任何登记 —— 这是第一条：先给本地路径（或点「选择文件夹…」），校验通过、起好名字，再点「登记」。</p>}
      {/* 读不到清单：人话 + 下一步（重新读取）。**不**因为读不到就说「还没有」，
          也不装作什么都没发生 —— 那种静默会让「首次登记提示」与「读失败」这两件事都消失。 */}
      {listError !== '' && <p role="alert" className="xs-cang__empty-note">藏库清单读不到（首次登记提示因此先不说）：{listError}。请点下面的「重新读取」再试一次；还读不到就稍后再开这张表 —— 登记本身不依赖这份清单。<button type="button" onClick={() => setListRetry(value => value + 1)}>重新读取</button></p>}
      <form onSubmit={event => { event.preventDefault(); if (pointer?.valid && draft.name.trim() && !busy) void submit(); }}>
        <label>本地文件 / 文件夹路径<input value={draft.path} onChange={event => changePath(event.target.value)} disabled={busy} required /></label>
        {/* 没有系统选择器时不渲染成「能点但报错」：禁用 + title 说明怎么绕（粘贴路径）。 */}
        <button type="button" onClick={() => void pick()} disabled={busy || !picker} title={!picker ? '宿主未提供系统目录选择器，可粘贴本地路径' : undefined}>选择文件夹…</button>
        <p>系统选择器只取指针。文件藏请粘贴本地路径；玄枢不复制、不移动、不修改内容。</p>
        <label>名称<input value={draft.name} onChange={event => { setNameTouched(true); setDraft(value => ({ ...value, name: event.target.value })); }} maxLength={200} required disabled={busy} /></label>
        <label>签（用逗号分隔）<input value={tags} onChange={event => setTags(event.target.value)} disabled={busy} /></label>
        {/* 三个入口是**每条登记自己的**能力位（不是全局设置）：关掉的入口在面板上直接不出现。 */}
        <fieldset disabled={busy}><legend>跳转入口</legend>{(['open', 'reveal', 'copy'] as const).map((key, index) => <label key={key}><input type="checkbox" checked={draft.actions[key]} onChange={event => setDraft(value => ({ ...value, actions: { ...value.actions, [key]: event.target.checked } }))} />{['以默认程序打开', '在文件管理器中显示', '复制路径'][index]}</label>)}</fieldset>
        <p>校验只做路径可达性判断，不读取内容、不列目录、不算大小、不建索引。</p>
        {/* 状态行把「正在校验 / 指针有效 / 为什么失效」说清楚；有效时也明写「玄枢未读取」。 */}
        <p role="status">{!draft.path.trim() ? '请选择或粘贴本地路径。' : !pointer ? '正在校验指针…' : pointer.valid ? `指针有效 · 类型=${pointer.kind === 'directory' ? '文件夹' : '文件'} · 玄枢未读取` : pointer.reason}</p>
        {/* 错误态：先说人话（读不到 / 失败），再给下一步；宿主的原话附在后面（不吞错），
            但**不**把 `error` 变量原样吐出来当唯一说明 —— 那只让人对着失败干瞪眼。 */}
        {error && <p role="alert">{`登记没有成功：读不到这个指针，或注册表拒绝了这次写入 —— ${error}。请检查路径是否还在、有没有权限，然后重新点「${draft.id ? '保存登记' : '登记'}」；还是不通就换个路径。`}</p>}
        <div className="xs-cang__toolbar"><button type="submit" disabled={busy || !pointer?.valid || !draft.name.trim()}>{busy ? '正在处理…' : draft.id ? '保存登记' : '登记'}</button><button type="button" onClick={controller.close} disabled={busy}>取消</button></div>
      </form>
    </div>
  </div>;
}
