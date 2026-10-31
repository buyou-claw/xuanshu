/**
 * 票 14 · 藏的**客户端装配**（controller + RPC 面 + 三处加性注册）。
 *
 * 四条「为什么」：
 *   1. **controller 是两块 UI 的唯一共享状态源**：面板（`main` 槽）与抽屉（`shell.overlay` 槽）
 *      是两棵独立的 React 树，没法互相传 props，只能共用一个订阅源；
 *      `changed()` 推 `revision`，两个组件据此重取列表 —— **只有人会触发它**（按钮的 onClick），
 *      没有任何 effect 会自己推。
 *   2. **三处注册都是加性的**：`main`（key `cang`）、`sidebar.panellist`（id `cang`，order 50）、
 *      `shell.overlay`（id `xuanshu-cang-drawer`）。槽位名与形状见
 *      `.scratch/notes/dsh-api-facts.md §6.5`（槽位面；**具体 file:line 未确认**，不编）。
 *      抽屉走 overlay 而不是另一个 main key：它要在任何面板之上都能划出来。
 *   3. **apply 期不切面板**：`installCangClient` 一次 `selectPanel` 都不调（默认面板由根入口切一次，
 *      `verify-assembly` S3 断言它恰一次、值为 `overview`）。#69 之后**面板里也不再切**：
 *      去谱管理只有侧栏行「谱」这一扇门（判据 N-001），所以这里连 `navigatePus` 的接线都没有了。
 *   4. **RPC 方法名逐字对应宿主**（`packages/xuanshu-host/lib/cang/service.mjs` 的 `cang.*`）：
 *      改一边不会在编译期报错，只会静默不匹配 —— 所以名字在这里是**接口面**，不是字符串常量。
 *
 * `ctx.layout.selectPanel()` 的语义（`null` = 回到当前会话）见本仓 `index.tsx` 的注释，
 * 它引的是 `dsh-client-ui-layout/lib/client.js:118`。
 */
import type { Context } from '@deepseek-ai/cordis';
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';
import { CangPanel } from './CangPanel.js';
import { CangOverlay } from './CangDrawer.js';
import { installCangStyle } from './cang-style.js';
import type { CangApi, CangController, CangDraft } from './cang-model.js';

/** 面板与抽屉共享的最小状态源（订阅式；见文件头第 1 条）。 */
export function createCangController(): CangController {
  let state: { revision: number; draft?: CangDraft } = { revision: 0 };
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    snapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** 打开抽屉编辑某条登记（`draft` 在场 = 抽屉展开）。 */
    edit: draft => { state = { ...state, draft }; notify(); },
    /** 关抽屉（草稿丢弃由调用方决定 —— controller 不管「要不要保存」）。 */
    close: () => { state = { ...state, draft: undefined }; notify(); },
    /** 列表可能过时了：面板与抽屉各取一次（**只由人点触发**）。 */
    changed: () => { state = { ...state, revision: state.revision + 1 }; notify(); },
  };
}

/** 加性注册 main + sidebar + overlay 三处；由根入口（`index.tsx`）调用。 */
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
  // 藏库面板不接「去谱管理」的跳转：谱管理的门只有侧栏行「谱」一个（#69 / 判据 N-001）。
  // 以前这里的 `navigatePus` 是面板里那枚「查看谱」按钮的接线 —— 两个门指同一动作，删掉按钮后接线一起删。
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'cang', inject: () => ({ api, controller }) }, CangPanel));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'cang', order: 50, label: '藏' }, CangIcon));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'xuanshu-cang-drawer', inject: () => ({ api, controller }) }, CangOverlay));
}
/** 侧栏图标（与其它面板同款线性风格）。 */
function CangIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 8 L12 4 L19.5 8" /><rect x="5.5" y="8" width="13" height="11.5" rx="2" /><path d="M12 5.5 V9.5" /><circle cx="12" cy="14" r="1.8" /></svg>;
}
