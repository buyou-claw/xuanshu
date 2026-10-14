import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CangApi, CangController, CangDraft, CangPointer } from './cang-model.js';
import { CANG_AI_FREE } from './cang-model.js';

export function CangOverlay({ api, controller }: { api: CangApi; controller: CangController }) {
  const { draft } = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  return draft ? <CangDrawer api={api} controller={controller} initial={draft} /> : null;
}
export function CangDrawer({ api, controller, initial }: { api: CangApi; controller: CangController; initial: CangDraft }) {
  const [draft, setDraft] = useState<CangDraft>(() => ({ ...initial, tags: [...initial.tags], actions: { ...initial.actions } }));
  const [tags, setTags] = useState(initial.tags.join('，'));
  const [pointer, setPointer] = useState<CangPointer>();
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    setPointer(undefined);
    if (draft.path.trim()) api.validate(draft.path, abort.signal).then(value => { if (!abort.signal.aborted) setPointer(value); })
      .catch(reason => { if (!abort.signal.aborted) setError(String(reason.message ?? reason)); });
    return () => abort.abort();
  }, [api, draft.path]);
  useEffect(() => {
    const abort = new AbortController();
    api.capabilities(abort.signal).then(value => { if (!abort.signal.aborted) setPicker(value.directoryPicker); }).catch(() => {});
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { abort.abort(); previous?.focus(); };
  }, [api]);
  function changePath(path: string) {
    const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? '';
    setDraft(value => ({ ...value, path, name: value.name || name })); setError('');
  }
  async function pick() {
    setBusy(true); setError('');
    try { const { path } = await api.pickDirectory(); if (path) changePath(path); }
    catch (reason) { setError(String((reason as Error).message ?? reason)); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setError('');
    const input = { ...draft, tags: tags.split(/[,，]/).map(value => value.trim()).filter(Boolean) };
    try { if (input.id) await api.update(input); else await api.register(input); controller.changed(); controller.close(); }
    catch (reason) { setError(String((reason as Error).message ?? reason)); setBusy(false); }
  }
  return <div className="xs-cang__overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) controller.close(); }}>
    <div ref={dialog} className="xs-cang__drawer" role="dialog" aria-modal="true" aria-labelledby="xs-cang-drawer-title" onKeyDown={event => {
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
      <form onSubmit={event => { event.preventDefault(); if (pointer?.valid && draft.name.trim() && !busy) void submit(); }}>
        <label>本地文件 / 文件夹路径<input value={draft.path} onChange={event => changePath(event.target.value)} disabled={busy} required /></label>
        <button type="button" onClick={() => void pick()} disabled={busy || !picker} title={!picker ? '宿主未提供系统目录选择器，可粘贴本地路径' : undefined}>选择文件夹…</button>
        <p>系统选择器只取指针。文件藏请粘贴本地路径；玄枢不复制、不移动、不修改内容。</p>
        <label>名称<input value={draft.name} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} maxLength={200} required disabled={busy} /></label>
        <label>签（用逗号分隔）<input value={tags} onChange={event => setTags(event.target.value)} disabled={busy} /></label>
        <fieldset disabled={busy}><legend>跳转入口</legend>{(['open', 'reveal', 'copy'] as const).map((key, index) => <label key={key}><input type="checkbox" checked={draft.actions[key]} onChange={event => setDraft(value => ({ ...value, actions: { ...value.actions, [key]: event.target.checked } }))} />{['以默认程序打开', '在文件管理器中显示', '复制路径'][index]}</label>)}</fieldset>
        <p>校验只做路径可达性判断，不读取内容、不列目录、不算大小、不建索引。</p>
        <p role="status">{!draft.path.trim() ? '请选择或粘贴本地路径。' : !pointer ? '正在校验指针…' : pointer.valid ? `指针有效 · 类型=${pointer.kind === 'directory' ? '文件夹' : '文件'} · 玄枢未读取` : pointer.reason}</p>
        {error && <p role="alert">{error}</p>}
        <div className="xs-cang__toolbar"><button type="submit" disabled={busy || !pointer?.valid || !draft.name.trim()}>{busy ? '正在处理…' : draft.id ? '保存登记' : '登记'}</button><button type="button" onClick={controller.close} disabled={busy}>取消</button></div>
      </form>
    </div>
  </div>;
}
