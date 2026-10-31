/**
 * 票 15 · 沉淀的**纯模型**与共享控制器（无 DOM；视图见 `sediment-views.tsx`）。
 *
 * 分三块：
 *   1. **分类判据**（`isConsultSessionId`）：沉淀只对问事会话成立。载体是 ADR-0009 第 1 条那条
 *      自铸 id 前缀 `session-xs-consult-` —— 客户端**不另立一套规则**（服务端 `requireConsultSessionId`
 *      判的是同一个前缀）；`meta.xuanshu.kind` 那条路在 rc.2 上根本读不回来（ADR-0009）。
 *   2. **给人看的两组数**（段落 diff / 字数变化）：S10 §2 B②③ 要求「人在按下去之前看清改了哪几段、
 *      字数从多少到多少」。两处都必须是确定口径，才能既在界面上一致、又能无 DOM 单测。
 *   3. **控制器**（`createSedimentController`）：入口条（`conversation.composer.dock`）与草稿卡
 *      （`conversation.chat.turnTail`）是**两棵独立的 React 树**，共享状态只能挂在这里。
 *      「人点才跑」是这一层的结构性保证：造控制器不发任何请求，只有 `export()` / `commit()` /
 *      `discard()` 三个方法会说话，而它们只由按钮的 `onClick` 调用。
 */
import type { SedimentApi, SedimentDraft, SedimentDraftAnswer, SedimentPuView, SedimentTarget } from './sediment-api.js';
import { dataDirPath } from './home-paths.js';

/* ───────────────────────── 1. 分类判据 ───────────────────────── */

/** 问事会话的 id 前缀（ADR-0009 第 1 条；与宿主的 `CONSULT_SESSION_PREFIX` 同值）。 */
export const CONSULT_SESSION_PREFIX = 'session-xs-consult-';

/**
 * 问事会话 id 的**完整判据**（与宿主**同源**：`packages/xuanshu-host/lib/consult/store.mjs`
 * 的 `isConsultSessionId` 用的是同一条正则）。
 *
 * 为什么不能只判前缀：两份实现各判一半，就等于**没有判据** —— 「客户端认作问事会话、服务端拒绝」
 * 的 id 可以存在（`session-xs-consult-a b`、`…/../`、`…%20` 这类都会让界面把沉淀按钮亮起来，
 * 点下去才被服务端拒绝）。两边是独立产物（宿主包 / 客户端包），不共享代码，
 * 所以靠**parity 用例**互锁：`tests/assembly/consult-session-id-parity.test.mjs`
 * 拿同一组边界样例喂两边，断言逐例结论相同。
 *
 * **改动这条规则时，必须同步改宿主那一份并跑 parity 用例。**
 */
const CONSULT_SESSION_ID_RE = /^session-xs-consult-[A-Za-z0-9._-]+$/u;

/**
 * 是不是问事会话。
 * 判据只有这一条：自铸 id 的形状。`meta` 里读不到分类（rc.2 的 meta 是闭集 7 字段，
 * 额外键静默丢弃，`dsh-session/lib/index.js:1697-1710`），也不要为此新增会话事件类型
 * （会话会打不开，ADR-0009 第 6 条）。
 */
export function isConsultSessionId(value: unknown): boolean {
  return typeof value === 'string' && CONSULT_SESSION_ID_RE.test(value);
}

/* ───────────────────────── 2. 字数 ───────────────────────── */

/** 「字」的口径：去掉空白后的字符数（中文按字算；与 S10 线框的「1,842 字」同口径）。 */
export function countWords(text: string | undefined): number {
  return String(text ?? '').replace(/\s+/gu, '').length;
}

/** 千分位（`1204` → `1,204`；不引 Intl，保证任何环境下同形）。 */
function group(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

/**
 * 字数变化的一行文案（S10 §2 B③ 逐字口径）：
 * `1,204 → 1,842 字（+638 字 / +53%）`。
 * 从 0 开始 / 归零各自有话说（不做除法除零的假百分比）。
 */
export function wordDeltaText(before: number, after: number): string {
  const head = `${group(before)} → ${group(after)} 字`;
  const delta = after - before;
  if (delta === 0) return `${head}（未变）`;
  const sign = delta > 0 ? '+' : '-';
  const body = `${sign}${group(Math.abs(delta))} 字`;
  if (before === 0) return `${head}（${body} / 新增）`;
  if (after === 0) return `${head}（${body} / 清空）`;
  const ratio = Math.round((Math.abs(delta) / before) * 100);
  return `${head}（${body} / ${sign}${ratio}%）`;
}

/* ───────────────────────── 3. 逐段 diff ───────────────────────── */

/** 一段的记号：`= 未变` / `~ 替换` / `+ 新增` / `- 删除（草稿里没有了）`。 */
export type DiffKind = '=' | '~' | '+' | '-';

export interface DiffItem {
  kind: DiffKind;
  text: string;
}

export interface DiffCounts {
  unchanged: number;
  replaced: number;
  added: number;
  removed: number;
}

/** 按空行切段（段内单换行保留：`# 标题\n正文` 是一段）。 */
function paragraphs(text: string | undefined): string[] {
  return String(text ?? '')
    .split(/\n{2,}/u)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * 逐段 diff（S10 §2 B②）。
 *
 * 口径（确定性优先，不引 diff 库）：**位置对应优先，其次全篇找同文段落**。
 * 这样「段落只是被重排」不会显示成整本重写，「该位置换了内容」显示成 `~`，
 * 真正新写的段才是 `+`；草稿里没了的原文段记 `-`（删掉的内容也要让人看见）。
 */
export function diffParagraphs(currentBody: string, draftBody: string): { items: DiffItem[]; counts: DiffCounts } {
  const current = paragraphs(currentBody);
  const draft = paragraphs(draftBody);
  const remaining = current.map((text, index) => ({ text, index, used: false }));
  const items: DiffItem[] = [];
  const counts: DiffCounts = { unchanged: 0, replaced: 0, added: 0, removed: 0 };

  for (let index = 0; index < draft.length; index += 1) {
    // `index < draft.length` 保证有值；这一行只为把类型收窄（`noUncheckedIndexedAccess`）。
    const text = draft[index];
    if (text === undefined) continue;
    const sameSpot = remaining[index];
    if (sameSpot !== undefined && sameSpot.used !== true && sameSpot.text === text) {
      sameSpot.used = true;
      items.push({ kind: '=', text });
      counts.unchanged += 1;
      continue;
    }
    const elsewhere = remaining.find((entry) => entry.used !== true && entry.text === text);
    if (elsewhere !== undefined) {
      elsewhere.used = true;
      items.push({ kind: '=', text });
      counts.unchanged += 1;
      continue;
    }
    if (sameSpot !== undefined && sameSpot.used !== true) {
      sameSpot.used = true;
      items.push({ kind: '~', text });
      counts.replaced += 1;
      continue;
    }
    items.push({ kind: '+', text });
    counts.added += 1;
  }

  for (const entry of remaining) {
    if (entry.used === true) continue;
    items.push({ kind: '-', text: entry.text });
    counts.removed += 1;
  }

  return { items, counts };
}

/* ───────────────────────── 4. 只读展示 ───────────────────────── */

/** 草稿预览：折叠首尾空白、超长截断（S10 §2 A③「内滚 maxHeight≈8 行」的内容来源）。 */
export function previewText(text: string | undefined, maxChars = 480): string {
  const raw = String(text ?? '').trim();
  return raw.length <= maxChars ? raw : `${raw.slice(0, maxChars)}…`;
}

/**
 * 写入路径的只读展示（与 S5 谱管理同一份数据源：`<dataDir>/pus/<slug>/`）。
 *
 * `dataDir` 由宿主回传（`data.overview.dataDir`，产品 `~/.xuanshu/xuanshu` /
 * 开发 `<repo>/.dsh-home/xuanshu`）；拿不到时给中性占位「玄枢数据目录/pus/<slug>/…」，
 * 不写死任何一档（ADR-0014：玄枢不读写 DSH 桌面版的 home）。
 * @param slug - 目标谱的 slug。
 * @param dataDir - 宿主回传的数据目录；缺席时显示中性占位。
 */
export function puPaths(slug: string, dataDir?: string): { content: string; summary: string; manifest: string } {
  return {
    content: dataDirPath(dataDir, 'pus', slug, 'content.md'),
    summary: dataDirPath(dataDir, 'pus', slug, 'summary.md'),
    manifest: dataDirPath(dataDir, 'pus', slug, 'manifest.md'),
  };
}

/* ───────────────────────── 5. 确认闸门的可用性 ───────────────────────── */

export interface ConfirmGateInput {
  hasDraft: boolean;
  targetSlug: string;
  /** 目标谱在预览之后被改动过（`updatedAt` 变了）：必须先重新预览。 */
  stale: boolean;
  busy: boolean;
}

/**
 * `[确认更新]` 能不能点；不能点时**理由必须可见**（S1 §6④ 的 fail-soft 约定 / S10 §6 disabled 行）。
 * 返回的 `reason` 直接渲染在按钮下面 —— 置灰而不说为什么，等于把闸门藏起来。
 */
export function confirmGate(input: ConfirmGateInput): { ok: boolean; reason?: string } {
  if (input.busy) return { ok: false, reason: '正在写入（写入期间按钮不可再点）。' };
  if (input.hasDraft !== true) return { ok: false, reason: '还没有草稿：先点 [导出汇总]。' };
  if (input.targetSlug === '') return { ok: false, reason: '还没有目标谱：沉淀只能写进谱（工作区 / 工作流不是谱）。' };
  if (input.stale) return { ok: false, reason: '目标谱在预览后被改动，请先 [重新预览]（本页不会覆盖你没看过的内容）。' };
  return { ok: true };
}

/* ───────────────────────── 6. 控制器（跨槽共享状态） ───────────────────────── */

/** 草稿卡 / 入口条 / 弹窗共用的会话级状态。 */
export interface SedimentState {
  kind: 'empty' | 'loading' | 'ready' | 'error' | 'done';
  /** `ready` 时的草稿（含目标谱）。 */
  answer?: SedimentDraftAnswer;
  /** 失败理由（`error` 态必须显示它）。 */
  reason?: string;
  /** 已写入的谱（`done` 态的 [查看谱] 用它）。 */
  pu?: SedimentPuView;
}

/** 一次人点动作的结果（不抛：失败理由落进 `reason`，界面永远有话说）。 */
export interface SedimentOutcome {
  ok: boolean;
  reason?: string;
}

/**
 * 结果通知（S10 §2 线框的「写入成功 → 结果通知（`shell.overlay`）」）。
 *
 * 它是**全局**的一份（`shell.overlay` 是 root 作用域，没有会话座位）：只记最近一次的写入结果。
 * 通知里的信息就是「写到哪本谱」，别的都不放 —— 通知不是第二份状态，卡片才是权威。
 */
export interface SedimentNotice {
  kind: 'committed';
  pu: SedimentPuView;
}

const EMPTY: SedimentState = { kind: 'empty' };

export interface SedimentController {
  subscribe(listener: () => void): () => void;
  /** 快照**必须是稳定引用**（`useSyncExternalStore` 用 `Object.is` 比较，现造对象会死循环）。 */
  getState(sessionId: string): SedimentState;
  /** 人点 `[导出汇总]`：调 `sediment.draft`，产出并暂存草稿。 */
  export(sessionId: string, targetSlug?: string): Promise<SedimentOutcome>;
  /** 人点 `[确认更新]`：唯一会写谱的动作（`confirmed` 在数据面里写死为 true 字面量）。 */
  commit(sessionId: string, draft?: SedimentDraft): Promise<SedimentOutcome>;
  /** 人点 `[丢弃这份草稿]`：正当路径，只删草稿。 */
  discard(sessionId: string): Promise<SedimentOutcome>;
  /** 最近一次的写入通知（没有就 undefined；通知挂 `shell.overlay`，是全局的一份）。 */
  getNotice(): SedimentNotice | undefined;
  /** 人点通知上的关闭 / [查看谱]：清掉它。 */
  dismissNotice(): void;
  /** 关闭通知 / 重新开始一次沉淀。 */
  reset(sessionId: string): void;
}

/** 错误文本归一（宿主 RPC 抛 Error，也可能是字符串）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 造一个沉淀控制器。
 *
 * **造它不发任何请求**（S10 §9 C4 的结构判据之一）：只有 `export()` / `commit()` / `discard()`
 * 三个方法会说话，而这三个只由按钮的 `onClick` 调用；`apply` 期与渲染期都不碰它们。
 * 每个会话一份状态（同一场问事被两处槽共享），互不串台。
 */
export function createSedimentController(api: SedimentApi): SedimentController {
  const states = new Map<string, SedimentState>();
  const listeners = new Set<() => void>();
  let notice: SedimentNotice | undefined;
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const put = (sessionId: string, state: SedimentState): void => {
    states.set(sessionId, state);
    notify();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: (sessionId) => states.get(sessionId) ?? EMPTY,

    async export(sessionId, targetSlug) {
      put(sessionId, { kind: 'loading' });
      try {
        const answer = await api.draft(targetSlug === undefined || targetSlug === '' ? { sessionId } : { sessionId, targetSlug });
        put(sessionId, { kind: 'ready', answer });
        return { ok: true };
      } catch (error: unknown) {
        const reason = errorText(error);
        put(sessionId, { kind: 'error', reason });
        return { ok: false, reason };
      }
    },

    async commit(sessionId, draft) {
      const state = states.get(sessionId);
      // 没有草稿就没有可提交的东西：这一条挡住的是「凭空写谱」，不是交互细节。
      if (state?.answer === undefined) return { ok: false, reason: '还没有草稿：先点 [导出汇总]。' };
      try {
        const answer = await api.commit(draft === undefined ? { draftId: state.answer.draftId } : { draftId: state.answer.draftId, draft });
        notice = { kind: 'committed', pu: answer.pu };
        put(sessionId, { kind: 'done', pu: answer.pu });
        return { ok: true };
      } catch (error: unknown) {
        const reason = errorText(error);
        // 回到 `ready`：草稿还在（宿主没删），人还能再试一次 —— 失败不该把草稿一起吞掉。
        put(sessionId, { kind: 'ready', answer: state.answer, reason });
        return { ok: false, reason };
      }
    },

    async discard(sessionId) {
      const state = states.get(sessionId);
      if (state?.answer === undefined) {
        put(sessionId, { kind: 'empty' });
        return { ok: true };
      }
      try {
        await api.discard({ draftId: state.answer.draftId });
        put(sessionId, { kind: 'empty' });
        return { ok: true };
      } catch (error: unknown) {
        const reason = errorText(error);
        put(sessionId, { kind: 'ready', answer: state.answer, reason });
        return { ok: false, reason };
      }
    },

    getNotice: () => notice,
    dismissNotice() {
      if (notice === undefined) return;
      notice = undefined;
      notify();
    },

    reset(sessionId) {
      put(sessionId, { kind: 'empty' });
    },
  };
}

/** 目标谱的显示名（没有 name 就用 slug：不编名字）。 */
export function targetLabel(target: SedimentTarget | undefined, slug: string): string {
  if (target !== undefined && target.name !== '') return `${target.name}（${target.slug}）`;
  return slug;
}
