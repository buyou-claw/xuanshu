import type { Context } from '@deepseek-ai/cordis';
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';
import { CangPanel } from './CangPanel.js';
import { CangOverlay } from './CangDrawer.js';
import { installCangStyle } from './cang-style.js';
import type { CangApi, CangController, CangDraft } from './cang-model.js';

export function createCangController(): CangController {
  let state: { revision: number; draft?: CangDraft } = { revision: 0 };
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    snapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    edit: draft => { state = { ...state, draft }; notify(); },
    close: () => { state = { ...state, draft: undefined }; notify(); },
    changed: () => { state = { ...state, revision: state.revision + 1 }; notify(); },
  };
}

/** Additive main, sidebar and overlay registration; root wires this installer. */
export function installCangClient(ctx: Context & RpcContext): void {
  installCangStyle();
  const api: CangApi = {
    list: signal => rpcCall(ctx, 'cang.list', undefined, signal),
    validate: (path, signal) => rpcCall(ctx, 'cang.validate', { path }, signal),
    register: draft => rpcCall(ctx, 'cang.register', draft),
    update: draft => rpcCall(ctx, 'cang.update', draft),
    remove: id => rpcCall(ctx, 'cang.remove', { id }),
    open: id => rpcCall(ctx, 'cang.open', { id }),
    reveal: id => rpcCall(ctx, 'cang.reveal', { id }),
    capabilities: signal => rpcCall(ctx, 'cang.capabilities', undefined, signal),
    pickDirectory: () => rpcCall(ctx, 'cang.pickDirectory'),
  };
  const controller = createCangController();
  const navigatePus = () => { if (ctx.slots.entries('main').some(entry => entry.options?.key === 'pus')) ctx.layout.selectPanel('pus'); };
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'cang', inject: () => ({ api, controller, navigatePus }) }, CangPanel));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'cang', order: 50, label: '藏' }, CangIcon));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'xuanshu-cang-drawer', inject: () => ({ api, controller }) }, CangOverlay));
}
function CangIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 8 L12 4 L19.5 8" /><rect x="5.5" y="8" width="13" height="11.5" rx="2" /><path d="M12 5.5 V9.5" /><circle cx="12" cy="14" r="1.8" /></svg>;
}
