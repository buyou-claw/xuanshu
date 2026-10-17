/**
 * 票 13 · 日课的共享控制器（跨面板的两件小事）。
 *
 * 为什么需要它：日课的**生成**是一个会写盘的动作（写当日卡 + 投递系统会话），
 * 而入口有两个 —— S1 日课卡的 `[立即生成]` 与日课面板的 `[重新生成（今天）]`。
 * 两个入口必须共用同一份「最近一次生成的结果」与同一个取数代次：
 *   - 卡片的 error 态要显示**失败理由**（底座未立 / 推运失败），理由只能有一个来源；
 *   - 生成成功后卡片要重取 `rikke.status`（代次 +1），而不是自己拼一份内容。
 *
 * **人点才跑**是这一层的结构性保证：`createRikkeUiController` 本身不发任何请求，
 * 只有显式 `generate()` 才会调 `rikke.generate`；`generate()` 只由按钮的 `onClick` 调用
 * （`rikke.tsx` / `OverviewPanel.tsx` 的 effect 里只允许 `rikke.status`）。
 *
 * 形态照 `bazi-controller.ts`（`subscribe` + 快照 + 代次），不引额外的 store 包。
 */
import type { RikkeApi, RikkeGenerateResult, RikkeSetTimeResult } from './rikke-api.js';

/** 一次「人点的生成」的结果（卡片与面板共用；`reason` 是失败时的可读理由）。 */
export interface RikkeOutcome {
  ok: boolean;
  date?: string;
  reason?: string;
}

export interface RikkeUiController {
  /** 取数代次：变一次 = 所有订阅者重取一次 `rikke.status`。 */
  getRevision(): number;
  subscribe(listener: () => void): () => void;
  /** 最近一次人点的生成结果（没跑过 = undefined；卡片据此显示失败理由）。 */
  getOutcome(): RikkeOutcome | undefined;
  /**
   * 抹掉上一次的生成结果（卡级 `[重试]` 走它）：理由不再挂在卡上，并广播一次取数
   * 让卡片回到「宿主说了算」的状态（今天有没有内容，重读一次就知道）。
   */
  clearOutcome(): void;
  /**
   * **人点的生成**（单飞：连点只跑一次）。
   *
   * 失败**不抛**：宿主给的理由（或 RPC 的拒绝原因）落进 `outcome.reason` 返回给调用方，
   * 界面因此永远有话说（契约 §2：不许静默）。
   */
  generate(date?: string): Promise<RikkeOutcome>;
  /** **人点的改时刻**（`HH:mm`）：走 `rikke.setTime`，成功后广播取数代次。 */
  setTime(time: string): Promise<RikkeSetTimeResult>;
}

/** 错误摘要（RPC 拒绝的 message 原样展示，不吞掉）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 造一个日课 UI 控制器。
 * @param api - 日课数据面（`createRikkeApi(ctx)`）。
 * @returns 控制器（单例由 `index.tsx` 持有并注入给日课卡与日课面板）。
 */
export function createRikkeUiController(api: RikkeApi): RikkeUiController {
  let revision = 0;
  let outcome: RikkeOutcome | undefined;
  let running: Promise<RikkeOutcome> | undefined;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const settle = (answer: RikkeGenerateResult): RikkeOutcome => {
    const next: RikkeOutcome = { ok: answer?.ok === true };
    if (answer?.date !== undefined) next.date = answer.date;
    if (next.ok !== true) {
      next.reason = answer?.reason ?? '日课生成失败：宿主没有给出理由。';
    }
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
    async setTime(time) {
      const answer = await api.setTime({ time });
      revision += 1;
      notify();
      return answer;
    },
  };
}
