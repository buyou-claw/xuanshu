/**
 * #25 · 晚省的共享控制器（卡上的 `[立即生成]` 与面板的 `[立即生成]` 共用一份）。
 *
 * 与 `rikke-controller.ts` 同一形态、同一个理由：
 *   - 生成结果（失败理由）只能有一个来源；
 *   - 生成成功后卡/面板要重取 `wansheng.status`（代次 +1），而不是自己拼一份事实。
 *
 * **人点才跑**：造控制器不发请求；`generate()` 只由按钮的 `onClick` 调用。
 */
import type { WanshengApi, WanshengGenerateResult } from './wansheng-api.js';

/** 一次「人点的生成」的结果。 */
export interface WanshengOutcome {
  ok: boolean;
  date?: string;
  reason?: string;
}

export interface WanshengUiController {
  /** 取数代次：变一次 = 所有订阅者重取一次 `wansheng.status`。 */
  getRevision(): number;
  subscribe(listener: () => void): () => void;
  /** 最近一次人点的生成结果（没跑过 = undefined）。 */
  getOutcome(): WanshengOutcome | undefined;
  /** 抹掉上一次的生成结果（卡级 `[重试]` 走它）并广播一次取数。 */
  clearOutcome(): void;
  /** **人点的生成**（单飞；失败不抛，理由落进 outcome）。 */
  generate(date?: string): Promise<WanshengOutcome>;
}

/** 错误摘要（RPC 拒绝的 message 原样展示，不吞掉）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 造一个晚省 UI 控制器。
 * @param api - 晚省数据面（`createWanshengApi(ctx)`）。
 * @returns 控制器（由 `index.tsx` 持有并注入给晚省卡与晚省面板）。
 */
export function createWanshengUiController(api: WanshengApi): WanshengUiController {
  let revision = 0;
  let outcome: WanshengOutcome | undefined;
  let running: Promise<WanshengOutcome> | undefined;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const settle = (answer: WanshengGenerateResult): WanshengOutcome => {
    const next: WanshengOutcome = { ok: answer?.ok === true };
    if (answer?.date !== undefined) next.date = answer.date;
    if (next.ok !== true) next.reason = answer?.reason ?? '晚省生成失败：宿主没有给出理由。';
    outcome = next;
    return next;
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
    clearOutcome() {
      outcome = undefined;
      revision += 1;
      notify();
    },
    generate(date) {
      if (running !== undefined) return running; // 单飞：连点不叠加
      running = api
        .generate(date === undefined ? {} : { date })
        .then(settle)
        .catch((error: unknown) => {
          outcome = { ok: false, reason: errorText(error) };
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
