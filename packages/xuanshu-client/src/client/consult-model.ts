/**
 * 票 10 · 问事门厅与历史回看的纯模型（S6 §2/§3；S7 §2/§3；冻结契约 §1/§2/§3）。
 *
 * 为什么单独成一层：这一票的**每条口径**都要在界面上看得见，而判据又都能写成纯函数 ——
 * 分组、勾选集合、「本次上下文将含」摘要、无源拦截的触发条件、历史的分组与搜索边界。
 * 放在这里就能在 Node 里逐条断言（`tests/assembly/consult-model.test.mjs`），
 * 组件只负责把同一份模型渲染出来（与票 08 的 `onboarding-model.ts` 同一纪律）。
 *
 * 三条来自契约/ADR 的硬口径：
 *   - 会话分类靠**自铸 sessionId 前缀**（ADR-0009）：`session-xs-consult-…`；
 *   - 底座与底稿是**恒定在场项**，不进任何勾选集合（契约 §1：「它们是每场问事的前提，不是这次的选择」）；
 *   - 历史列表的权威是**旁挂清单**，搜索边界只有标题（S7 §3③：「不搜全文」）。
 */
import type { ConsultDrafts, ConsultDraftRound, ConsultMessage, ConsultSummary, MountRef, OptionalSource } from './consult-api.js';

/** 玄枢自铸的问事 sessionId 前缀（ADR-0009 §1；改它等于改数据格式）。 */
export const CONSULT_SESSION_PREFIX = 'session-xs-consult-';

/** 这个 id 是不是问事会话（票 13 的 `session-xs-rikke-…` 等不得混进来）。 */
export function isConsultSession(sessionId: string): boolean {
  return typeof sessionId === 'string' && sessionId.startsWith(CONSULT_SESSION_PREFIX);
}

/**
 * 列表行上的短 id：`#consult-<uuid 前 8 位>`。
 * 整串 uuid 太长会把行挤爆，而「能分辨是哪一次」只需要前 8 位。
 */
export function shortConsultId(sessionId: string): string {
  const rest = isConsultSession(sessionId) ? sessionId.slice(CONSULT_SESSION_PREFIX.length) : sessionId;
  return `#consult-${rest.slice(0, 8)}`;
}

/** 默认勾选：base 级可选谱（S6 §2.1 / `pu-spec-v1.md` §4）。 */
export function initialSelection(optional: readonly OptionalSource[]): string[] {
  return optional.filter((source) => source.level === 'base').map((source) => source.slug);
}

/** 按级别分组（base 在前；**空组不出现**，免得给一个不会长东西的分组头）。 */
export function groupOptional(optional: readonly OptionalSource[]): { level: 'base' | 'optional'; items: OptionalSource[] }[] {
  const groups: { level: 'base' | 'optional'; items: OptionalSource[] }[] = [];
  for (const level of ['base', 'optional'] as const) {
    const items = optional.filter((source) => source.level === level);
    if (items.length > 0) groups.push({ level, items });
  }
  return groups;
}

/** 勾选 / 取消勾选（集合语义；顺序按操作历史保留，便于「这一次勾了什么」的回读）。 */
export function toggleSelection(selected: readonly string[], slug: string): string[] {
  return selected.includes(slug) ? selected.filter((row) => row !== slug) : [...selected, slug];
}

/**
 * 「本次上下文将含」摘要行（S6 §2.1②：勾选或挂载一变就即时更新）。
 * 底座与底稿恒在其中 —— 它们不是这次的勾选结果，而是每场问事的前提。
 */
export function contextSummary(input: { selected: readonly string[]; mounts: readonly MountRef[] }): string {
  const parts = ['底座 + 底稿'];
  if (input.selected.length > 0) parts.push(`${String(input.selected.length)} 个谱`);
  if (input.mounts.length > 0) parts.push(`${String(input.mounts.length)} 项挂载`);
  return parts.join(' + ');
}

/** 空态与引导文案（S6 §6；逐字固定，便于测试与跨屏一致）。 */
export const historyEmptyCopy = {
  /** 一个可选谱都没有时的追加行（S6 §6 empty 行）。 */
  // 2026-11-01：原来写「（去 S5）」—— S5 是设计稿的屏幕编号，界面上没有这个编号。
  // 这扇门就是侧栏行「谱」（判据 N-001 只留那一扇），所以直接点名它。
  noneOptionalPu: '谱都非必填；你可以先空手问一句，或先去建一个谱（点侧栏「谱」）。',
  /** 历史子页首次空态（S7 §2.3①）。 */
  noRecords: '还没有问事记录',
  noRecordsSub: '每次问事都会自动存成本地文件，随时能回来接着读。',
  /** 数据形态说明行（S7 §2.1③）。 */
  storageNote: '会话记录 = 本地文件（JSONL 事件日志），玄枢只读不改',
  searchBoundary: '列表按本地时间倒序；搜索只搜本次问事的标题与首句，不搜全文',
  /** 无源拦截引导的标题与两条去路（S6 §5 步骤 5a）。 */
  nudgeTitle: '需要先给这一问一点依据',
  nudgePathPu: '在勾选区勾一个谱',
  // 2026-11-01：原来写「（去 S8）」—— S8 是设计稿的屏幕编号，界面上没有这个编号。
  // 改成点名这一屏上真有的那个按钮。
  nudgePathMount: '临时挂载一个工作区 / 工作流（点「临时挂载…」）',
  /** 末条：显式的泛问出口 —— 不是「没有谱就不能问」。 */
  nudgePlainExit: '只带底座 + 底稿问一次',
} as const;

/**
 * 无源拦截引导的触发条件（S6 §7 同名行已把条件收窄）。
 *
 * 只在**要发出去**这一刻有意义：有问题、但既没勾可选谱也没挂载项。
 * 底座与底稿一直在场，但它们不构成针对具体事项的依据 —— 这就是这条引导存在的理由；
 * 而「空问题只开会话」不该被拦（那时还没有「这一问」）。
 *
 * **`selectableCount`（2026-10-18 真机）**：勾选区里**一个可选谱都没有**时，不拦。
 * 理由有两条，都是真机事实：
 *   1. 引导给的两条路这时都是死路 —— 「勾一个谱」无谱可勾；
 *   2. 挂载必须挂在**会话**上（`mounts-views` 的既有规则：没有会话就没有可挂的账本），
 *      而问事门厅此刻还没建会话 —— 第一次问事的人被拦下来，两条路都走不通。
 * 所以「第一次什么都没有」= 直接空手开问，不再多一次点击。缺省值保持旧的「有路可走」语义。
 */
export function nudgeNeeded(input: {
  question: string;
  selected: readonly string[];
  mounts: readonly MountRef[];
  selectableCount?: number;
}): boolean {
  if (input.question.trim() === '') return false;
  if (input.selected.length > 0 || input.mounts.length > 0) return false;
  return (input.selectableCount ?? Number.POSITIVE_INFINITY) > 0;
}

/** 本地日期键（`YYYY-MM-DD`，按**本机时区**取 —— 列表口径是「本地时间倒序」）。 */
function localDateKey(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '未知';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** 本地时刻（`HH:mm`）。 */
function localClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '--:--';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * 历史列表分组：按本地日期倒序，今天单独一组，其余按天分组（S7 §2.1①）。
 * @param items - 旁挂清单里的会话（宿主已按 createdAt 倒序）。
 * @param now - 判定「今天」的参照时刻（测试注入固定值）。
 * @returns 分组（`label` 供界面直接渲染，`key` 供 React 做 key）。
 */
export function groupHistory(
  items: readonly ConsultSummary[],
  now: Date = new Date(),
): { key: string; label: string; items: ConsultSummary[] }[] {
  const today = localDateKey(now.toISOString());
  const groups = new Map<string, ConsultSummary[]>();
  for (const item of items) {
    const key = localDateKey(item.createdAt);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [item]);
    else bucket.push(item);
  }
  return [...groups.entries()]
    .sort((left, right) => (left[0] < right[0] ? 1 : left[0] > right[0] ? -1 : 0))
    .map(([key, rows]) => ({
      key,
      label: key === today ? `今天 · ${String(rows.length)} 条` : `更早 · ${key.slice(5)} · ${String(rows.length)} 条`,
      items: rows,
    }));
}

/** 历史行的元信息：`HH:mm · N 轮 · 谱 M`（挂载为 0 时不写，免得每行都是「挂载 0」）。 */
export function formatHistoryMeta(item: ConsultSummary): string {
  const parts = [localClock(item.createdAt), `${String(item.turns)} 轮`, `谱 ${String(item.pus.length)}`];
  if (item.mounts.length > 0) parts.push(`挂载 ${String(item.mounts.length)}`);
  return parts.join(' · ');
}

/** 历史筛选的范围档（S7 §2.1 工具条的 `范围 [全部 ▾]`）。 */
export type HistoryRange = 'all' | 'today' | 'earlier';

/**
 * 历史筛选：**只搜标题**（S7 §3③ 明写「不搜全文」，界面也照这句话说明边界）。
 * @param items - 会话清单。
 * @param query - 关键词（空 = 不过滤）。
 * @param range - 全部 / 今天 / 更早。
 * @param now - 判定「今天」的参照时刻。
 * @returns 过滤后的清单（保持输入顺序 = 宿主给的倒序）。
 */
export function filterHistory(
  items: readonly ConsultSummary[],
  query: string,
  range: HistoryRange = 'all',
  now: Date = new Date(),
): ConsultSummary[] {
  const keyword = query.trim().toLowerCase();
  const today = localDateKey(now.toISOString());
  return items.filter((item) => {
    if (keyword !== '' && !item.title.toLowerCase().includes(keyword)) return false;
    if (range === 'all') return true;
    const isToday = localDateKey(item.createdAt) === today;
    return range === 'today' ? isToday : !isToday;
  });
}

/** 阅读器里的角色标签（S7 §2.2：「你：…」/「AI：…」）。 */
export function roleLabel(role: 'user' | 'assistant'): string {
  return role === 'user' ? '你' : 'AI';
}

/**
 * 采用稿的 `source.kind`（与宿主 `message.mjs` 的 `BESTOF_ADOPTED_SOURCE_KIND` **逐字一致**）。
 * 改它等于改数据格式：日志里的消息按这个 kind 认「这是一份被拍板的合参稿」。
 */
export const ADOPTED_DRAFT_SOURCE = 'xuanshu-bestof-adopted';

/**
 * 一份采用稿在**这一轮**里的处境（票 31）：
 *   - `current`：这轮当前的采用稿；
 *   - `rejected`：这一轮被否决，它不作数（「曾经采用过」不等于「现在是当前」）；
 *   - `superseded`：同一轮里被后来改选的那一份取代；
 *   - `unknown`：判不出来（老宿主 / 账本缺证据）—— 此时**不声称**任何一份被取代。
 */
export type DraftRoundState = 'current' | 'rejected' | 'superseded' | 'unknown';

/** 轮次组里的一条采用稿（每条各有自己的处境；一轮可能先后投过两份）。 */
export interface ReviewDraftItem {
  message: ConsultMessage;
  state: DraftRoundState;
}

/**
 * 回看里的一项：普通消息，或一轮合参（按轮分组的采用稿）。
 *
 * 为什么按轮成组而不是平铺：Spec 002 的「当前采用稿」已经从**全场一份**变成**各轮各一份**，
 * 平铺会让读者以为「最后一条就是唯一采用稿」；分组才看得见「第 1 轮采用了 A、第 3 轮否掉了」。
 */
export type ReviewItem =
  | { kind: 'message'; key: string; message: ConsultMessage }
  | { kind: 'round'; key: string; round: number; runId: string; state: DraftRoundState; items: ReviewDraftItem[] };

/** 一份采用稿在这一轮里的处境（判不出来时不乱说）。 */
function draftStateOf(round: ConsultDraftRound, messageId: string, drafts: ConsultDrafts): DraftRoundState {
  if (drafts.resolved !== true) return 'unknown';
  if (round.currentId === messageId) return 'current';
  if (round.rejected) return 'rejected';
  return round.currentId === undefined ? 'unknown' : 'superseded';
}

/**
 * 回看时间线（票 31）：普通消息照旧平铺，采用稿按**轮**收成一组。
 *
 * 判据只来自宿主（`consult.read` 的 `drafts`）：客户端不重算「哪一份算当前」——
 * 那套按轮语义在服务端已经落地（复核 R2/R3），两处各算一遍必然漂移。
 *
 * 三个保守口径：
 *   - `drafts` 缺席（老宿主 / 没有合参记录）⇒ **全部按普通消息**渲染，老回看一个字符都不变；
 *   - 采用稿对不上任何轮次（账本里没有它）⇒ 也当普通消息，**不声称**它是当前或被取代；
 *   - 相邻的同轮采用稿才合成一组（不为了分组而打乱日志顺序）。
 *
 * @param messages 会话日志投影（顺序 = 日志顺序）
 * @param drafts 宿主给的轮次表（可缺席）
 * @returns 渲染项（`round` 组内保持日志顺序）
 */
export function reviewTimeline(
  messages: readonly ConsultMessage[],
  drafts: ConsultDrafts | undefined | null,
): ReviewItem[] {
  const byMessage = new Map<string, ConsultDraftRound>();
  if (drafts !== undefined && drafts !== null) {
    for (const round of drafts.rounds) {
      for (const messageId of round.messageIds) byMessage.set(messageId, round);
    }
  }
  const items: ReviewItem[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) continue;
    const key = `${String(index)}-${message.role}`;
    const messageId = message.messageId;
    const round = drafts === undefined || drafts === null || message.source !== ADOPTED_DRAFT_SOURCE || messageId === undefined
      ? undefined
      : byMessage.get(messageId);
    if (round === undefined || drafts === undefined || drafts === null || messageId === undefined) {
      items.push({ kind: 'message', key, message });
      continue;
    }
    const state = draftStateOf(round, messageId, drafts);
    const last = items[items.length - 1];
    if (last !== undefined && last.kind === 'round' && last.runId === round.runId && last.round === round.round) {
      last.items.push({ message, state });
      if (state === 'current') last.state = 'current';
      continue;
    }
    items.push({
      kind: 'round',
      key: `${key}-round-${round.runId}`,
      round: round.round,
      runId: round.runId,
      state,
      items: [{ message, state }],
    });
  }
  return items;
}

/** 轮次组头（票 31；逐字断言的对象）：`第 2 轮合参 · 当前采用稿`。 */
export function draftRoundLabel(item: { round: number; state: DraftRoundState }): string {
  const prefix = `第 ${String(item.round)} 轮合参`;
  if (item.state === 'current') return `${prefix} · 当前采用稿`;
  if (item.state === 'rejected') return `${prefix} · 已否决（不列为当前）`;
  if (item.state === 'superseded') return `${prefix} · 已被后来的一份取代`;
  return `${prefix} · 当前性未知`;
}

/** 单条采用稿的徽标（与组头同口径，逐条说清它自己的处境）。 */
export function draftBadgeLabel(state: DraftRoundState): string {
  if (state === 'current') return '当前采用稿';
  if (state === 'rejected') return '已被否决 · 非当前';
  if (state === 'superseded') return '已被后一份取代 · 非当前';
  return '当前性未知';
}

/** 打开会话的结果：`ok` 或一份**可读失败**（界面必须显示出来，不许静默）。 */
export type OpenSessionResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'refresh-failed' | 'open-failed'; message: string };

/**
 * 「打开那个会话」的编排：**先刷目录、再导航**，失败一律返回可读原因。
 *
 * 为什么不是一句 `openSession(id)` 就完事（实证见 `dsh-api-facts.md` 附录 F）：
 *   - `openSession(id)` 内部直接 `retain(id, {source:'mainView'})`，**没有 try/catch**
 *     （`dsh-client-ui-workspace/lib/client.js:821-823,973`）；
 *   - `retain` 对**不在客户端会话目录里**的 id **同步抛** `unknown session`
 *     （`dsh-api-session-controller/.../sessions/manager.js:63-71`）；
 *   - 我们的会话是**宿主半**用 `ctx.agents.create` 建的，它只靠 `api-session/added` 推送进目录，
 *     而**推送与 RPC 回包的到达顺序没有被证明有序** —— 所以「RPC 一返回就开」不可靠。
 * 先 `refresh()`（幂等、单飞，拉一次 `session.list`，含还没落盘的活会话）再开，是官方同款做法
 * （`dsh-client-ui-schedule/lib/client.js:6762-6764` 打开宿主建的会话前先确认它在目录里）。
 *
 * @param options - 会话 id + 两个注入面（都可缺席：缺席按可读失败处理，不假装成功）。
 * @returns `{ok:true}` 或 `{ok:false, reason, message}`；**不抛**。
 */
export async function openConsultSession(options: {
  sessionId: string;
  refresh?: () => Promise<void>;
  open?: (sessionId: string) => void;
}): Promise<OpenSessionResult> {
  const { sessionId, refresh, open } = options;
  // 失败文案一律带上短 id：会话是**已经建好**的，人要能自己找到它（回不到会话 ≠ 白建）。
  const tail = `会话已建好（${shortConsultId(sessionId)}）`;
  if (open === undefined) {
    return { ok: false, reason: 'unavailable', message: `${tail}，但 DSH 会话面板不可用：请在侧栏工作区里打开它。` };
  }
  if (refresh !== undefined) {
    try {
      await refresh();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: 'refresh-failed',
        message: `${tail}，但刷新 DSH 会话目录失败：${reason}。请重试，或在侧栏工作区里打开它。`,
      };
    }
  }
  try {
    open(sessionId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: 'open-failed',
      message: `${tail}，但 DSH 会话面板没能打开：${reason}。请重试，或在侧栏工作区里打开它。`,
    };
  }
  return { ok: true };
}
