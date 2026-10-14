/**
 * 票 13 · 底稿的共享控制器（跨面板的一件小事）。
 *
 * 底稿的 `[刷新]` 是**重算派生文件**（会写盘），入口有两个 —— S1 底稿卡的 `[刷新]`
 * 与底稿面板的 `[刷新]`。卡片需要两样东西：
 *   1. 刷新成功后重取 `digao.status`（代次 +1），而不是自己拼一份 summary；
 *   2. 刷新失败时**有话说**（理由落在 outcome 上，卡片进 error 态）。
 *
 * **人点才跑**是这一层的结构性保证：`createDigaoUiController` 本身不发任何请求，
 * 只有显式 `refresh()` 才会调 `digao.refresh`；`refresh()` 只由按钮的 `onClick` 调用。
 *
 * 形态照 `rikke-controller.ts` / `bazi-controller.ts`（`subscribe` + 快照 + 代次）。
 */
import type { DigaoApi } from './digao-api.js';

/** 一次「人点的刷新」的结果（卡片据此显示失败理由）。 */
export interface DigaoOutcome {
  ok: boolean;
  reason?: string;
}

export interface DigaoUiController {
  /** 取数代次：变一次 = 所有订阅者重取一次 `digao.status`。 */
  getRevision(): number;
  subscribe(listener: () => void): () => void;
  /** 最近一次人点的刷新结果（没跑过 = undefined）。 */
  getOutcome(): DigaoOutcome | undefined;
  /** **人点的刷新**（单飞：连点只跑一次）；失败**不抛**，理由落进 `outcome.reason`。 */
  refresh(): Promise<DigaoOutcome>;
}

/** 错误摘要（RPC 拒绝的 message 原样展示，不吞掉）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 造一个底稿 UI 控制器。
 * @param api - 底稿数据面（`createDigaoApi(ctx)`）。
 * @returns 控制器（单例由 `index.tsx` 持有并注入给底稿卡与底稿面板）。
 */
export function createDigaoUiController(api: DigaoApi): DigaoUiController {
  let revision = 0;
  let outcome: DigaoOutcome | undefined;
  let running: Promise<DigaoOutcome> | undefined;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    getRevision: () => revision,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getOutcome: () => outcome,
    refresh() {
      if (running !== undefined) return running; // 单飞：连点不叠加
      running = api
        .refresh()
        .then((): DigaoOutcome => {
          outcome = { ok: true };
          return outcome;
        })
        .catch((error: unknown) => {
          outcome = { ok: false, reason: `刷新失败：${errorText(error)}` };
          return outcome;
        })
        .then((answer) => {
          running = undefined;
          revision += 1;
          notify();
          return answer;
        });
      return running;
    },
  };
}
