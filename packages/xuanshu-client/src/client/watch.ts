/**
 * `main` 槽已注册面板键的极简订阅源（fail-soft 置灰的唯一判据）。
 *
 * 为什么自写而不引 `@deepseek-ai/dsh-client-store`：
 *   少一个运行期 `require` 就少一条浏览器 module table 的耦合边；
 *   本需求只有「取快照 + 订阅变化」两件事，十几行足够，且快照稳定（字典序数组）
 *   天然满足 `Object.is` 比较（`useSyncExternalStore` 对返回值的要求）。
 *
 * 上游依据（读什么 + 怎么读）：
 *   - `profile/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js:592-599`
 *     官方正是用 `ctx.slots.entries('main')` 取键、`ctx.slots.subscribe('main', …)` 等变化。
 *   - `…/dsh-client-ui-sidebar/lib/client.js:453-469` 同法（`entriesOfSlot` + `subscribe`）。
 */
import { useSyncExternalStore } from 'react';

/** `useSyncExternalStore` 需要的形状：订阅 + 稳定快照。 */
export interface MainPanelsWatch {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly string[];
}

/** `ctx.slots` 上本模块用到的两个只读面（类型见 `types/shims.d.ts`）。 */
export interface SlotEntriesSource {
  /** keyed 槽的条目带 `key`、list 槽带 `id`；本模块只读 keyed 的 `key`。 */
  entries(name: string): { options?: { key?: string; id?: string } }[];
  subscribe(name: string, listener: () => void): () => void;
}

/** 建好的 watch 句柄：`watch` 给组件用，`dispose` 交给插件 fiber 收尾。 */
export interface MainPanelsWatchHandle {
  watch: MainPanelsWatch;
  dispose(): void;
}

/**
 * 建一个 main 面板键的订阅源。
 *
 * @param slots - `ctx.slots`（`entries` + `subscribe`）。
 * @returns watch 与其 disposer（disposer 由调用方挂到插件 fiber 上）。
 */
export function createMainPanelsWatch(slots: SlotEntriesSource): MainPanelsWatchHandle {
  /** 读一次活 registry，去重后按字典序排序 —— 稳定引用便于 `Object.is` 比较。 */
  const read = (): string[] => {
    const keys = new Set<string>();
    for (const entry of slots.entries('main')) {
      const key = entry?.options?.key;
      if (typeof key === 'string' && key !== '') keys.add(key);
    }
    return [...keys].sort();
  };

  let snapshot: readonly string[] = read();
  const listeners = new Set<() => void>();

  const refresh = (): void => {
    const next = read();
    if (next.length === snapshot.length && next.every((key, index) => key === snapshot[index])) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  // 注册/卸载任何 main 条目都重算；`refresh()` 兜住「订阅建立前后已发生的提交」。
  const unsubscribe = slots.subscribe('main', refresh);
  refresh();

  return {
    watch: {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot() {
        return snapshot;
      },
    },
    dispose() {
      listeners.clear();
      unsubscribe();
    },
  };
}

/**
 * React 钩子：订阅 main 面板键快照。
 *
 * `useSyncExternalStore` 的第三参（getServerSnapshot）与 getSnapshot 同源：
 * 快照已缓存且稳定，服务端渲染（`renderToStaticMarkup`）下同样正确。
 *
 * @param watch - 由 `createMainPanelsWatch` 建好的 watch（缺省时由调用方给空 watch）。
 * @returns 已注册的 main 面板键（字典序）。
 */
export function useMainPanels(watch: MainPanelsWatch): readonly string[] {
  return useSyncExternalStore(watch.subscribe, watch.getSnapshot, watch.getSnapshot);
}

/** 空 watch：组件被单独渲染（测试/无 ctx）时使用，恒空快照。 */
export const EMPTY_MAIN_PANELS: MainPanelsWatch = {
  subscribe: () => () => {},
  getSnapshot: () => EMPTY_KEYS,
};

const EMPTY_KEYS: readonly string[] = [];
