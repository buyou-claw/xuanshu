/**
 * 票 08 · 命盘取数的共享控制器（跨面板的两件小事）。
 *
 * 为什么不能各面板各拿一份 state：
 *   1. **出盘成功后概览要重新取数**——向导（main key `onboarding`）出盘落谱，
 *      概览（`overview`）的命盘卡必须从 `empty` 变 `ready`；两者是**两块面板**，
 *      需要一个共同的「取数代次」把重取广播出去（不是重新出盘：快照是唯一事实源，S2 §5.1）。
 *   2. **重录预填**——S2 底部的「重新录制出生信息」要把现值带进向导的五步
 *      （S2 §5.4），跨面板传递的只有这一份草稿。
 *
 * 形态照 `cang.tsx` 的 `createCangController`（`subscribe` + 快照），
 * 因为它同样只做「外部可变状态 + 订阅」，不必引 `@deepseek-ai/dsh-client-store`
 * （少一个运行期 require 就少一条浏览器 module table 的耦合边）。
 */
import type { OnboardingDraft } from './onboarding-model.js';

export interface BaziUiController {
  /** 取数代次：变一次 = 所有订阅者重取一次（不重新出盘）。 */
  getRevision(): number;
  subscribe(listener: () => void): () => void;
  /** 出盘成功 / 手动重试 → 通知概览与详情重新取数。 */
  invalidate(): void;
  /** 请求重录：记下预填草稿，等向导挂载时取走（S2 §5.4）。 */
  requestRerecord(draft: OnboardingDraft): void;
  /**
   * 取走预填草稿（**取走即清**）。
   *
   * 「消费即清」是 S3 §6 的防脏状态 H1：草稿只在本次向导会话内有效，
   * 取走过一次之后，下一次进向导必须是第 1 步空表单，不能带着上一轮的值。
   */
  consumePrefill(): OnboardingDraft | undefined;
}

/**
 * 造一个命盘 UI 控制器。
 * @returns 控制器（单例由 `index.tsx` 持有并注入给三块面板）。
 */
export function createBaziUiController(): BaziUiController {
  let revision = 0;
  let prefill: OnboardingDraft | undefined;
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
    invalidate() {
      revision += 1;
      notify();
    },
    requestRerecord(draft) {
      prefill = draft;
      // 预填本身就是一次「该重取数了」的信号（切面板不一定重挂载）。
      revision += 1;
      notify();
    },
    consumePrefill() {
      const current = prefill;
      prefill = undefined;
      return current;
    },
  };
}
