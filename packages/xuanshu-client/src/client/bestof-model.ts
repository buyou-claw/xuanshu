/**
 * 票 11 · 合参的客户端状态机与文案口径（S9 §5/§6；契约 §1）。
 *
 * 纯函数 + 一个不带 React 的控制器：**视图只读这里算出来的东西**，于是 C9（判官不自动采用）、
 * H3/H4 的披露、回落文案、费用口径都能在没有浏览器的断言台里逐字验。
 *
 * 三条硬口径：
 *   1. **没有任何自动采用**：`adopt` 由人点触发；`bestof.run` 跑完只是 `ready`。
 *   2. **停止要真的停**：优先调 `bestof.cancel`；宿主没有这个方法时**如实说**「后台仍会跑完」，
 *      不许假装停了（Lead 2026-10-15 把它钉成产品承诺）。
 *   3. **费用未知就说未知**：宿主不给 `costUsd` 时显示「费用未知」，不许拿 0 糊过去。
 */
import type { BestofApi, BestofCandidate, BestofDecision, BestofDelivery, BestofView } from './bestof-api.js';

/** 主命令名（S9 §1：`/多模型` 逐字照抄上游）。 */
export const BESTOF_COMMAND_NAME = '多模型';
/** 别名：玄枢的 `/合参` + 上游的 `bestof`（三者等价）。 */
export const BESTOF_COMMAND_ALIASES = ['合参', 'bestof'];
/** 全部命令名（客户端按名字注册三个 contribution；`CommandContribution` 没有 aliases 字段）。 */
export const BESTOF_COMMAND_NAMES = [BESTOF_COMMAND_NAME, ...BESTOF_COMMAND_ALIASES];

/** 首版两个视角（与宿主 `BESTOF_ANGLES` 的 id 对齐）。 */
export const BESTOF_ANGLE_OPTIONS = [
  { id: 'classic', name: '经典派' },
  { id: 'cautious', name: '审慎派' },
];

/**
 * 解析一行斜杠命令（S9 §2.1 / §5 步骤 1：命令名到第一个空白为界；`//` 开头不算命令）。
 * @returns `{ matched, question }`；`matched=false` 时调用方走普通发送。
 */
export function parseBestofCommand(line: string): { matched: boolean; question: string } {
  const text = String(line ?? '');
  const trimmed = text.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return { matched: false, question: '' };
  const body = trimmed.slice(1);
  const space = body.search(/\s/u);
  const name = space === -1 ? body : body.slice(0, space);
  if (!BESTOF_COMMAND_NAMES.includes(name)) return { matched: false, question: '' };
  return { matched: true, question: (space === -1 ? '' : body.slice(space + 1)).trim() };
}

/** 浮层的阶段（S9 §6 的状态词表；`empty` 由「没有内容就 return null」承担）。 */
export type BestofPhase = 'idle' | 'confirm' | 'running' | 'ready' | 'stopped' | 'adopted' | 'rejected' | 'disabled' | 'error';

/** 一份候选能不能被采用（跑完的、或被人停下但已经有文字的）。 */
export function isUsable(candidate: BestofCandidate): boolean {
  return (candidate.status === 'done' || candidate.status === 'stopped') && candidate.text !== '';
}

/** 有没有至少一份可用候选。 */
export function usableCandidates(view: BestofView | undefined): BestofCandidate[] {
  return (view?.candidates ?? []).filter(isUsable);
}

/** 从 view 推出浮层阶段（人停下的那一轮与判官失败都是 `ready`，只是文案不同）。 */
export function bestofPhase(view: BestofView | undefined, { skippedByUser = false } = {}): BestofPhase {
  if (view === undefined) return 'idle';
  if (view.rejected === true) return 'rejected';
  if (view.adoptedId !== null) return 'adopted';
  if (view.finished !== true) return 'running';
  if (skippedByUser) return 'stopped';
  return 'ready';
}

/** 能不能点「采用某一份」。 */
export function canAdopt(view: BestofView): boolean {
  return view.finished === true && usableCandidates(view).length >= 1;
}

/** 能不能点「合并为一稿」（S9 §2.2 ③：≥2 份有效候选）。 */
export function canMerge(view: BestofView): boolean {
  return view.finished === true && usableCandidates(view).length >= 2;
}

/** 展示顺序：判官排序在前，没被排到的按原候选序跟在后面（回落时 ranking = 完成顺序）。 */
export function rankedCandidates(view: BestofView): BestofCandidate[] {
  const position = new Map((view.judge?.ranking ?? []).map((id, index) => [id, index]));
  return [...view.candidates].sort(
    (a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** 排名 Tag：判官给了有效排序就是「排序 N」，回落时改口径为「完成顺序 N」（S9 §2.3 ②）。 */
export function rankTag(view: BestofView, candidateId: string): string | undefined {
  const index = (view.judge?.ranking ?? []).indexOf(candidateId);
  if (index === -1) return undefined;
  return judgeUnavailable(view) ? `完成顺序第 ${index + 1}` : `排序 ${index + 1}`;
}

/** 判官有没有给出**有效**排序（回落 / 没跑 / 失败都算「不可用」）。 */
export function judgeUnavailable(view: BestofView): boolean {
  const mode = view.judge?.mode;
  if (mode === 'skipped' || mode === 'failed') return true;
  return typeof view.judge?.error === 'string' && view.judge.error !== '';
}

/** 判官不可用时的解释行（S9 §2.3 ①：一句人话 + 效力边界）。 */
export function fallbackNotice(view: BestofView): string | undefined {
  if (!judgeUnavailable(view)) return undefined;
  if (view.judge?.mode === 'skipped') {
    return view.judge.error ?? '只有一份可用候选，这一轮不跑判官（照样由你点采用）。';
  }
  return `判官不可用，暂按先完成的一份排前（${view.judge?.error ?? '判官未给出有效排序'}）。这只影响排序展示，不替你选 —— 采用与否仍然由你点。`;
}

/**
 * 费用文案（S9 §2.1 ② / §2.4 ②）：宿主没有价表就没有 `costUsd` → **「费用未知」**，
 * 绝不显示 `$0.0000` 那种看起来像实测值的假数。
 */
export function costLabel(view: BestofView | undefined): string {
  if (view === undefined || view.costUsd === undefined) return '费用未知';
  const amount = `$${view.costUsd.toFixed(4)}`;
  return view.costUsdComplete === false ? `${amount}（部分未知）` : amount;
}

/** 候选卡状态位（S9 §2.2 ①：`生成中` / `失败` / `{N} 字`，有值再追加耗时）。 */
export function candidateStatusLabel(candidate: BestofCandidate): string {
  if (candidate.status === 'running') return '生成中…';
  if (candidate.status === 'error') return `失败：${candidate.error ?? '未知原因'}`;
  const prefix = candidate.status === 'stopped' ? '已停止 · ' : '';
  const parts = [`${candidate.text.length} 字`];
  if (typeof candidate.elapsedMs === 'number') parts.push(`${(candidate.elapsedMs / 1000).toFixed(1)}s`);
  return `${prefix}${parts.join(' · ')}`;
}

/** 拍板载荷（三个动作的请求形状；`mergedText` 只有调用方真的要人手合并时才给）。 */
export function decisionPayload(
  runId: string,
  decision: BestofDecision,
  options: { adoptedId?: string; mergedText?: string } = {},
): { runId: string; decision: BestofDecision; adoptedId?: string; mergedText?: string } {
  const payload: { runId: string; decision: BestofDecision; adoptedId?: string; mergedText?: string } = { runId, decision };
  if (decision === 'adopt') {
    if (options.adoptedId === undefined) throw new Error('采用需要指明哪一份候选。');
    payload.adoptedId = options.adoptedId;
  }
  if (decision === 'merge' && options.mergedText !== undefined) payload.mergedText = options.mergedText;
  return payload;
}

/** 控制器对外暴露的状态快照。 */
export interface BestofUiState {
  phase: BestofPhase;
  /** 设置开关（默认**关**：用户故事 18「平时轻量、需要时再开」）。 */
  enabled: boolean;
  question: string;
  sessionId?: string;
  view?: BestofView;
  /** 可读失败（能力门 / 未知方法 / 网络）。 */
  error?: string;
  /** 一句提示（停不下来的降级、禁用态等）。 */
  notice?: string;
  /**
   * 「采用稿到底有没有写进会话」的回执（task-15）。
   * 字段缺席 = 还没拍板，或宿主是老版本（没有投递面）→ 界面按成功态渲染。
   */
  delivery?: BestofDelivery;
}

/**
 * 采用态要不要挂警告（task-15）：只有**明确失败**才挂。
 *
 * 为什么 `ok !== false` 一律当成功：`delivery` 缺席是**老宿主**（契约里 `delivery` 是加性字段），
 * 那时采用稿照旧投递（旧宿主的行为），没有理由把「不知道」渲染成「失败」。
 */
export function deliveryNotice(delivery: BestofDelivery | undefined): string | undefined {
  if (delivery === undefined || delivery.ok !== false) return undefined;
  return `采用稿没能写进会话：${delivery.error ?? '原因未知'}`;
}

/** 控制器（浮层与设置行共用一份）。 */
export interface BestofController {
  snapshot(): BestofUiState;
  subscribe(listener: () => void): () => void;
  /** 设置开关。 */
  setEnabled(enabled: boolean): void;
  /** 命令 / 按钮触发：带问题直接进费用确认；不带问题先停在输入。 */
  ask(input: { question: string; sessionId: string }): void;
  /** 改问题（按钮触发时的那一行输入）。 */
  editQuestion(question: string): void;
  /** 费用确认框的 `[开始合参]`（**唯一**会发起请求的入口）。 */
  confirm(signal?: AbortSignal): Promise<void>;
  /** 费用确认框的 `[取消]`。 */
  dismiss(): void;
  /** 「停止全部」：优先真停，调不到就如实降级。 */
  stop(): Promise<void>;
  adopt(adoptedId: string): Promise<void>;
  merge(mergedText?: string): Promise<void>;
  reject(): Promise<void>;
}

/**
 * 造一个合参控制器。
 * @param options.api 数据面（`createBestofApi`）
 * @param options.pollMs 轮询间隔（缺省 400ms；断言台用 1ms）
 */
export function createBestofController({ api, pollMs = 400 }: { api: BestofApi; pollMs?: number }): BestofController {
  let state: BestofUiState = { phase: 'idle', enabled: false, question: '' };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stoppedByUser = false;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const set = (patch: Partial<BestofUiState>): void => {
    state = { ...state, ...patch };
    notify();
  };
  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const message = (error: unknown): string => String((error as Error)?.message ?? error);

  /** 轮询到这一轮结束（`finished`）；失败也停（界面显示可读错误）。 */
  async function poll(runId: string): Promise<void> {
    try {
      const view = await api.state({ runId });
      if (state.view?.runId !== runId) return; // 已经换了另一轮：旧回包丢掉
      // 冷读的视图里宿主会在投递失败时带 `delivery`；成功时带 `deliveredAt` —— 说同一句话。
      set({ view, phase: bestofPhase(view, { skippedByUser: stoppedByUser }), delivery: view.delivery });
      if (view.finished === true) {
        clearTimer();
        return;
      }
    } catch (error) {
      clearTimer();
      set({ error: message(error), phase: 'error' });
      return;
    }
    timer = setTimeout(() => {
      void poll(runId);
    }, pollMs);
  }

  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setEnabled(enabled) {
      set({ enabled });
      if (enabled && state.phase === 'disabled') set({ phase: 'idle', notice: undefined });
    },
    ask({ question, sessionId }) {
      stoppedByUser = false;
      if (!state.enabled) {
        // S9 §6 禁用态：不静默改走普通问答，也不假装开始。
        set({ phase: 'disabled', question, sessionId, view: undefined, error: undefined, notice: '多 AI 合参当前是关的：去 设置 · 通用 里打开它。' });
        return;
      }
      set({ phase: 'confirm', question, sessionId, view: undefined, error: undefined, notice: undefined });
    },
    editQuestion(question) {
      set({ question });
    },
    async confirm(signal) {
      const question = state.question.trim();
      if (question === '') {
        set({ phase: 'confirm', error: '写上要合参的问题。' });
        return;
      }
      // 空串也是「没有会话」：按钮触发那条路径拿不到 sessionId 时会走到这里。
      if (state.sessionId === undefined || state.sessionId === '') {
        set({ phase: 'confirm', error: '还没有问事会话：先去「问事」开一次会话。' });
        return;
      }
      try {
        const view = await api.run({ sessionId: state.sessionId, question, angles: BESTOF_ANGLE_OPTIONS.map((option) => option.id) }, signal);
        stoppedByUser = false;
        set({ phase: bestofPhase(view), view, error: undefined, notice: undefined });
        if (view.finished !== true) {
          clearTimer();
          timer = setTimeout(() => {
            void poll(view.runId);
          }, pollMs);
        }
      } catch (error) {
        set({ phase: 'error', error: message(error) });
      }
    },
    dismiss() {
      clearTimer();
      set({ phase: 'idle', view: undefined, question: '', error: undefined, notice: undefined });
    },
    async stop() {
      const view = state.view;
      if (view === undefined) return;
      stoppedByUser = true;
      clearTimer();
      try {
        const { bestOf } = await api.cancel({ runId: view.runId });
        set({ view: bestOf, phase: bestofPhase(bestOf, { skippedByUser: true }), notice: undefined });
      } catch (error) {
        // 宿主没有 `bestof.cancel`（老版本）或调用失败：本地停止 + **如实说明**。
        set({
          view: { ...view, finished: true, judge: { ...view.judge, mode: 'skipped', skipped: true, error: '已停止（本地）：这一轮仍在后台跑完，结果会在下次打开时出现。' } },
          phase: 'stopped',
          notice: `停不下来这一轮（${message(error)}）：已在本机停止查看，后台仍会跑完。`,
        });
      }
    },
    async adopt(adoptedId) {
      const view = state.view;
      if (view === undefined) return;
      try {
        const { bestOf, delivery } = await api.adopt(decisionPayload(view.runId, 'adopt', { adoptedId }));
        set({ view: bestOf, phase: bestofPhase(bestOf), error: undefined, delivery });
      } catch (error) {
        set({ error: message(error) });
      }
    },
    async merge(mergedText) {
      const view = state.view;
      if (view === undefined) return;
      try {
        const { bestOf, delivery } = await api.adopt(decisionPayload(view.runId, 'merge', { mergedText }));
        set({ view: bestOf, phase: bestofPhase(bestOf), error: undefined, delivery });
      } catch (error) {
        set({ error: message(error) });
      }
    },
    async reject() {
      const view = state.view;
      if (view === undefined) return;
      try {
        const { bestOf, delivery } = await api.adopt(decisionPayload(view.runId, 'reject'));
        // 否决不投递：把上一轮可能剩下的回执清掉（否则界面会拿旧警告说新状态）。
        set({ view: bestOf, phase: bestofPhase(bestOf), error: undefined, delivery });
      } catch (error) {
        set({ error: message(error) });
      }
    },
  };
}
