/**
 * 票 13 · 底稿只读面板（main key `digao`）+ 加性注册（S13；冻结契约 §1 / §3）；
 * 票 27（#27）：正文两段（最近在做什么 / 曾经做过什么），事记条目上带 [删除]。
 *
 * 这一屏是**纯派生视图**（C2 ●）：
 *   - 顶部固定徽标逐字「纯派生 · 不可手改」（与 S1 底稿卡同一枚，跨屏一致）；
 *   - 「要改就改源头」三个跳转（谱 → S5 / 工作区 → DSH / 工作流 → S12）是本屏唯一的「改」的出口；
 *   - **零编辑控件**：没有 input / textarea / select / contenteditable，也不注册任何写底稿的命令；
 *   - 唯一的功能按钮是 `[刷新]`（重算派生文件，不是改底稿）；只读动作 `[查看 MD 形态]` 只切视图。
 *
 * #27 的边界（评审要盯的那条）：**底稿仍然没有写入口**。本屏唯一会写盘的动作是「曾经做过什么」
 * 里每条事记的 `[删除]` —— 它删的是**事记账本里的那一条**（`shiji.remove`，写墓碑），不是改
 * `digao.md`；下一次刷新时那一条不再出现在正文里。恢复不在本屏（RPC 面存在，界面只给一句
 * 「可以在设置里恢复」，不放假按钮）。
 *
 * 数据只读：`digao.status`（在不在 + 元数据 + 事记读面）与 `digao.read`（正文 + 事记读面）。
 * 正文的两段与事记条目由 `digao-model.ts` 从 markdown 里解析 —— **界面是同一份文件的投影**，
 * 不另存一套来源归属（契约 §1：来源标记必须活在 MD 文本里）。
 *
 * 两处**刻意不编造**的地方（诚实边界）：
 *   1. 「下次刷新」不来自本屏：宿主回传 `schedule` 就显示，回传不了就只指路，不显示一个界面
 *      自己算出来的时刻；
 *   2. `[复制路径] / [打开所在目录]`（S13 §2 ⑤）没有落地：冻结契约没有给路径字段，
 *      也没有 open-in-app 能力面 —— 宁可不做，也不在界面上放一个做不到的按钮。
 */
import { useEffect, useRef, useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';

import { XsPureDerivedBadge } from './cards.js';
import type { DigaoApi, DigaoMeta, DigaoRead, DigaoSchedule, DigaoShijiRead, DigaoStatus } from './digao-api.js';
import { matchShijiEntries, parseDigaoMarkdown } from './digao-model.js';
import type { DigaoGroup, DigaoSegment } from './digao-model.js';
import { installDigaoStyle } from './digao-style.js';
import { DIGAO_ID, DIGAO_LABEL, DIGAO_ORDER, EMPTY_COPY, clockOf, momentOf } from './panel.js';
import type { PanelNavTarget } from './panel.js';
import type { RpcContext } from './rpc.js';
import type { ShijiApi, ShijiEntry } from './shiji-api.js';

/** 负向声明（S13 §9 C2 逐字：本屏没有编辑框、没有保存按钮；#27 补一句「删的是事记」）。 */
export const DIGAO_NO_EDIT_NOTE =
  '本面板没有编辑框、没有保存按钮：内容由「规则骨架 + AI 摘要」生成；改了源头，刷新即变。'
  + '唯一能删的是「曾经做过什么」里的事记（删的是账本里的那一条，不是改底稿），删完可在设置里恢复。';

/** 三源头跳转的前缀（S13 §3 ②：文案统一为「要改就改源头」）。 */
export const DIGAO_JUMP_NOTE = '要改就改源头：';

/**
 * 三个源头跳转的文案（S13 §9 C2：并列在标记右侧）。
 *
 * 2026-11-01 改：原来写作「改谱 → S5」「改工作流 → S12」—— `S5`/`S12` 是**设计稿里的屏幕编号**，
 * 只在 `docs/design/ui-v1/screens/` 里有意义，界面上没有这个编号，用户读到只会以为自己漏掉了什么。
 * 第三个原本是「改工作区 → 工作区」，箭头两边同一个词，同样没信息量。
 * 现在统一成「改 X」：按钮本身就长在「要改就改源头」那一行里，去向由点击给出。
 */
export const DIGAO_JUMPS: readonly { target: PanelNavTarget; label: string }[] = [
  { target: 'pus', label: '改谱' },
  { target: 'conversation', label: '改工作区' },
  { target: 'workflow', label: '改工作流' },
];

/** 「下次刷新」的指路文案：值不在本屏（契约 §2 无 schedule 字段），只指到管理面。 */
export const DIGAO_NEXT_REFRESH_NOTE =
  '下次刷新：由「自动化任务」面板里的底稿 daily 任务决定（播种默认 03:30，可在那里改或停用）。';

/** 没有事记读面时「曾经」那一段的说明（不许自己编 id 去删）。 */
export const DIGAO_NO_SHIJI_READ_NOTE =
  '没有读到事记账本：这一段的条目暂时不能在这里删（正文照原文展示；刷新一次底稿就会写账本）。';

/** 面板的四态（`running` 用 `busy` 表达：内容保持可读，按钮转「刷新中…」）。 */
type DigaoView =
  | { kind: 'loading' }
  | { kind: 'empty'; meta: DigaoMeta | null; schedule?: DigaoSchedule }
  | { kind: 'ready'; meta: DigaoMeta | null; markdown: string; schedule?: DigaoSchedule; shiji?: DigaoShijiRead; shijiReason?: string }
  | { kind: 'error'; message: string };

/** 静态预置（测试 / SSR：给了就不取数；`error` 形状直接落错误态）。 */
export type DigaoPreloaded = { status: DigaoStatus; read?: DigaoRead } | { error: string };

export interface DigaoPanelProps {
  /** 底稿数据面（`index.tsx` 用 `createDigaoApi(ctx)` 造好注入）。 */
  api: DigaoApi;
  /** 事记数据面（删除动作走它；**拿不到就不给删除入口**，不猜一个 id 去写）。 */
  shiji?: ShijiApi;
  /** 面板导航（三个源头跳转都是跨面板跳转）。 */
  navigate: (target: PanelNavTarget) => void;
  /** 静态预置（测试 / SSR：给了就不发 `digao.status` / `digao.read`）。 */
  preloaded?: DigaoPreloaded;
  /** 静态预置「查看 MD 形态」已展开（静态渲染点不了按钮）。 */
  preloadedRawView?: boolean;
}

/** 由静态预置推初始视图。 */
function initialView(preloaded: DigaoPreloaded | undefined): DigaoView {
  if (preloaded === undefined) return { kind: 'loading' };
  if ('error' in preloaded) return { kind: 'error', message: preloaded.error };
  if (preloaded.status.exists !== true) {
    return {
      kind: 'empty',
      meta: preloaded.status.meta,
      ...(preloaded.status.schedule === undefined ? {} : { schedule: preloaded.status.schedule }),
    };
  }
  if (preloaded.read === undefined) return { kind: 'error', message: '底稿文件存在但正文没读回来。' };
  const schedule = preloaded.read.schedule ?? preloaded.status.schedule;
  const shiji = preloaded.read.shiji ?? preloaded.status.shiji;
  const shijiReason = preloaded.read.shijiReason ?? preloaded.status.shijiReason;
  return {
    kind: 'ready',
    meta: preloaded.read.meta ?? preloaded.status.meta,
    markdown: preloaded.read.markdown,
    ...(schedule === undefined ? {} : { schedule }),
    ...(shiji === undefined ? {} : { shiji }),
    ...(shijiReason === undefined ? {} : { shijiReason }),
  };
}

/** 错误摘要（RPC 拒绝的 message 原样展示，不吞掉）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


/**
 * 底稿只读面板。
 * @param props - 数据面、导航与静态预置。
 * @returns 只读面板节点。
 */
export function DigaoPanel({ api, shiji, navigate, preloaded, preloadedRawView }: DigaoPanelProps) {
  const seeded = preloaded !== undefined;
  const [view, setView] = useState<DigaoView>(() => initialView(preloaded));
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState(preloadedRawView === true);
  /** 刷新失败的横幅：内容仍在时**不整屏失败**（S13 §6 error 分两级）。 */
  const [note, setNote] = useState<string | undefined>(undefined);
  const sequence = useRef(0);

  /** 只读取数：status → （存在时）read。静态预置下不取数。 */
  const load = (): void => {
    const mine = ++sequence.current;
    setNote(undefined);
    void api
      .status()
      .then(async (status) => {
        if (mine !== sequence.current) return;
        if (status.exists !== true) {
          setView({
            kind: 'empty',
            meta: status.meta,
            ...(status.schedule === undefined ? {} : { schedule: status.schedule }),
          });
          return;
        }
        const read = await api.read();
        if (mine !== sequence.current) return;
        const schedule = read.schedule ?? status.schedule;
        const shiji = read.shiji ?? status.shiji;
        // 事记读面坏 ≠ 底稿坏：只把原因带进 `ready` 态（卡态仍 ready），由正文那一段的 note 展示。
        const shijiReason = read.shijiReason ?? status.shijiReason;
        setView({
          kind: 'ready',
          meta: read.meta ?? status.meta,
          markdown: read.markdown,
          ...(schedule === undefined ? {} : { schedule }),
          ...(shiji === undefined ? {} : { shiji }),
          ...(shijiReason === undefined ? {} : { shijiReason }),
        });
      })
      .catch((error: unknown) => {
        if (mine !== sequence.current) return;
        setView({ kind: 'error', message: errorText(error) });
      });
  };

  useEffect(() => {
    if (seeded) return; // 静态预置：不取数
    load();
    // `load` 是每渲染重建的闭包；依赖只留数据面与预置标记（与 MingpanPanel 同法）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, seeded]);

  /**
   * `[刷新]`：**人点**才走（重算派生文件，再读回同一个文件）。
   *
   * 面板走裸 `api.refresh()` 而不经 `DigaoUiController`：控制器存在的理由是**跨面板**的两件事
   * （卡片要重取 status、失败理由要有一个来源），而面板本身就是那个动作的现场 ——
   * 它的结果直接落在本屏的 `view` / `note` 上，不需要再绕一圈共享状态。
   */
  const refresh = (): void => {
    const mine = ++sequence.current;
    setBusy(true);
    setNote(undefined);
    void api
      .refresh()
      .then(async () => {
        const read = await api.read();
        if (mine !== sequence.current) return;
        setView({
          kind: 'ready',
          meta: read.meta,
          markdown: read.markdown,
          ...(read.schedule === undefined ? {} : { schedule: read.schedule }),
          ...(read.shiji === undefined ? {} : { shiji: read.shiji }),
          ...(read.shijiReason === undefined ? {} : { shijiReason: read.shijiReason }),
        });
      })
      .catch((error: unknown) => {
        if (mine !== sequence.current) return;
        setNote(`刷新失败：${errorText(error)}`);
      })
      .finally(() => {
        if (mine === sequence.current) setBusy(false);
      });
  };

  /**
   * 删除一条事记之后**重读**底稿（`digao.read`）：正文里的那一条由「读面里没有它」而消失
   * （md 要等下一次刷新才会重写 —— 这正是「删了不再长回来」的可观察边界）。
   *
   * 只更新 `ready` 态里的三样（meta / 正文 / 事记读面），保留 `schedule`（它不是这次动作的产物）。
   */
  const reloadAfterDelete = async (): Promise<void> => {
    const mine = sequence.current;
    const read = await api.read();
    if (mine !== sequence.current) return;
    setView((previous) => {
      if (previous.kind !== 'ready') return previous;
      return {
        ...previous,
        meta: read.meta,
        markdown: read.markdown,
        ...(read.shiji === undefined ? {} : { shiji: read.shiji }),
        shijiReason: read.shijiReason,
      };
    });
  };

  const meta = view.kind === 'empty' || view.kind === 'ready' ? view.meta : null;
  const schedule = view.kind === 'empty' || view.kind === 'ready' ? view.schedule : undefined;

  return (
    <main className="xs-digao" data-xuanshu-panel={DIGAO_ID}>
      {/* ① 吸顶徽标：不随滚动消失、不可关闭（S13 §9 C2）。 */}
      <header className="xs-digao__head">
        <h1>底稿</h1>
        <XsPureDerivedBadge />
      </header>

      {/* ② 要改就改源头：本屏唯一的「改」的出口。 */}
      <p className="xs-digao__jumps" data-xuanshu-note="source-jumps">
        <span>{DIGAO_JUMP_NOTE}</span>
        {DIGAO_JUMPS.map((jump) => (
          <button
            key={jump.target}
            type="button"
            data-xuanshu-nav={jump.target}
            onClick={() => {
              navigate(jump.target);
            }}
          >
            {jump.label}
          </button>
        ))}
      </p>

      {/* ⑥ 负向声明（评审验点）。 */}
      <p className="xs-digao__note xs-digao__no-edit" data-xuanshu-note="no-edit">
        {DIGAO_NO_EDIT_NOTE}
      </p>

      {/* ③ 时间信息：上次刷新来自 meta；下次刷新不编造。 */}
      <p className="xs-digao__note" data-xuanshu-note="last-refresh">
        {meta?.generatedAt === undefined ? '上次刷新：（还没有生成过）' : `上次刷新 ${momentOf(meta.generatedAt)}`}
      </p>
      <p className="xs-digao__note" data-xuanshu-note="next-refresh">
        {schedule === undefined
          ? DIGAO_NEXT_REFRESH_NOTE
          : `下次刷新 ${clockOf(schedule.time)}（${schedule.timeZone}）· 由「自动化任务」面板里的 daily 任务决定（可在那里改或停用）`}
      </p>

      {/* ④ 唯一的功能按钮 + ⑤ 只读动作。 */}
      <div className="xs-digao__actions">
        <button
          type="button"
          className="xs-btn xs-btn--primary"
          data-xuanshu-action="refresh-digao"
          disabled={busy}
          onClick={refresh}
        >
          {busy ? '刷新中…' : '刷新'}
        </button>
        <button
          type="button"
          data-xuanshu-action="view-md"
          onClick={() => {
            setRaw(!raw);
          }}
        >
          {raw ? '收起 MD 形态' : '查看 MD 形态'}
        </button>
      </div>

      {note === undefined ? null : (
        <p className="xs-digao__alert" role="alert" data-xuanshu-alert="refresh">
          {note}
        </p>
      )}

      {view.kind === 'loading' ? (
        <p className="xs-digao__note" data-xuanshu-view="loading">
          正在读底稿…
        </p>
      ) : null}

      {view.kind === 'empty' ? (
        <section className="xs-digao__empty" data-xuanshu-view="empty">
          <p>{EMPTY_COPY.digaoNeverRefreshed.why}</p>
          <p className="xs-digao__note">
            底稿由谱 / 工作区 / 工作流 / 事记四路来源提炼而成；点一次 [刷新] 就会拼出「最近在做什么」与「曾经做过什么」两段。
          </p>
        </section>
      ) : null}

      {view.kind === 'error' ? (
        <section className="xs-digao__alert" data-xuanshu-view="error" role="alert">
          <p>{view.message}</p>
          <div className="xs-digao__actions">
            <button type="button" data-xuanshu-action="retry" onClick={load}>
              重试
            </button>
          </div>
        </section>
      ) : null}

      {view.kind === 'ready' ? (
        <DigaoBody
          markdown={view.markdown}
          meta={view.meta}
          raw={raw}
          {...(view.shiji === undefined ? {} : { shijiRead: view.shiji })}
          {...(view.shijiReason === undefined ? {} : { shijiReason: view.shijiReason })}
          {...(shiji === undefined ? {} : { shiji })}
          reload={reloadAfterDelete}
        />
      ) : null}
    </main>
  );
}

/**
 * 生成方式说明（契约 §1：骨架与来源标记是确定性规则；摘要可能降级为规则骨架）。
 *
 * 2026-11-01 改：三句原文分别是
 *   「骨架＝确定性规则 · 摘要＝规则骨架（LLM 不可用或提炼失败，未提炼）」
 *   「骨架＝确定性规则 · 摘要＝AI 提炼」
 *   「骨架＝确定性规则 · 摘要＝未标注（meta 里没有 digest 这一位，按未提炼对待）」
 *
 * 三个问题：①「骨架＝确定性规则」是拿等号解释实现；② 第二句里「摘要＝规则骨架」自相矛盾
 * （骨架和摘要本来就是两样东西）；③ 第三句把 `meta` 与 `digest` 两个内部字段名直接印出来，
 * 而这句恰好会在「读不到生成记录」时出现 —— 那正是用户最需要看懂的时刻。
 *
 * 现在三句都回答同一个问题：**这份底稿里，哪一半是算出来的、哪一半没有**。
 */
export function digestLine(meta: DigaoMeta | null | undefined): string {
  const digest = meta?.digest;
  if (digest === 'skeleton') {
    /**
     * 2026-11-02 改：`skeleton` 有两种成因，原来一律说成「AI 用不了或没用成」。
     * 实测 0 段素材时（谱是 optional 级、工作区工作流没活动）AI **根本没被调用** ——
     * 用户照「AI 用不了」去查 provider，方向完全错了。没素材时直说没素材。
     */
    return (meta?.segments ?? 0) === 0
      ? '生成方式：只有规则骨架（还没有可提炼的来源：谱 / 工作区 / 工作流都还是空的）'
      : '生成方式：只有规则骨架（AI 这次用不了或没用成，摘要没生成）';
  }
  if (digest === 'llm') return '生成方式：规则骨架 + AI 摘要';
  return '生成方式：只有规则骨架（读不到生成记录，按「摘要没生成」处理）';
}

/** 一段里的每个段（旧形态的三章与新形态的三路都用同一枚渲染）。 */
function SegmentList({ segments }: { segments: DigaoSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
        <article key={`${segment.kind}-${String(index)}`} className="xs-digao__segment">
          <p className="xs-digao__segment-head">
            <span className="xs-digao__tag" data-xuanshu-source-tag={segment.label}>
              {`[${segment.label}]`}
            </span>
            <span className="xs-digao__segment-name">{segment.name}</span>
          </p>
          <p className="xs-digao__segment-body">{segment.body}</p>
          {segment.origin === undefined ? null : (
            <p className="xs-digao__origin" data-xuanshu-origin={segment.kind}>
              {`源自：${segment.origin}`}
            </p>
          )}
        </article>
      ))}
    </>
  );
}

/**
 * 事记的一条：来源标记 + 日期区间 + 依据 + 摘要 + [删除]（只有读到 id 才给删除）。
 *
 * `entry` 缺席 = 没有事记读面（没有账本）：条目照原文展示，但**不给删除** —— 猜一个 id 去写
 * 比不做更糟。
 */
function ShijiRecord({
  record,
  entry,
  pending,
  busy,
  onAskDelete,
  onCancel,
  onConfirm,
}: {
  record: DigaoSegment;
  entry?: ShijiEntry;
  pending: boolean;
  busy: boolean;
  onAskDelete: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const range = `${record.since ?? ''}～${record.until ?? ''}`;
  const basis = record.basis ?? { sessions: 0, docs: 0 };
  return (
    <article className="xs-digao__record" {...(entry === undefined ? {} : { 'data-xuanshu-shiji': entry.id })}>
      <p className="xs-digao__segment-head">
        <span className="xs-digao__tag" data-xuanshu-source-tag={record.label}>
          {`[${record.label}]`}
        </span>
        <span className="xs-digao__segment-name">{record.name}</span>
      </p>
      <p className="xs-digao__note" data-xuanshu-shiji-meta={entry?.id ?? record.name}>
        {`${range} · 依据：会话 ${basis.sessions} 场 · 文档 ${basis.docs} 份`}
      </p>
      <p className="xs-digao__segment-body">{record.body}</p>
      {entry === undefined ? null : pending ? (
        // 二次确认就地展开（不用 window.confirm：文案要可断言，窄屏也要排得下）。
        <div className="xs-digao__confirm" role="alertdialog" aria-label="确认删除这条事记" data-xuanshu-confirm="delete-shiji">
          <p data-xuanshu-confirm-text="delete-shiji">
            {`删除事记「${record.name}」？删除后下一次刷新不会再出现；可以在设置里恢复。`}
          </p>
          <div className="xs-digao__actions">
            <button type="button" className="xs-btn xs-btn--primary" data-xuanshu-action="delete-shiji-confirm" disabled={busy} onClick={onConfirm}>
              {busy ? '删除中…' : '确认删除'}
            </button>
            <button type="button" data-xuanshu-action="delete-shiji-cancel" disabled={busy} onClick={onCancel}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <button type="button" data-xuanshu-action="delete-shiji" data-xuanshu-shiji-id={entry.id} onClick={onAskDelete}>
          删除
        </button>
      )}
    </article>
  );
}

/**
 * 「曾经做过什么」那一段：事记条目 = 正文解析出来的记录 ↔ `digao.read.shiji.entries` 配对。
 *
 * 为什么要在客户端配一次：正文里没有 id（人读的标记不带机器键），而删除要 id；
 * 两边是同一个 `listShiji()` 的两种投影（同序同数据），配对是确定性的。
 * 配不上的记录 = 读面里已经没有它（已删除）→ **不渲染**，并明说「可以在设置里恢复」。
 */
function PastSection({
  group,
  shijiRead,
  shiji,
  shijiReason,
  reload,
}: {
  group: DigaoGroup | undefined;
  shijiRead: DigaoShijiRead | undefined;
  shiji: ShijiApi | undefined;
  /** 事记读面降级的原因（账本 EISDIR/EACCES…）：`shiji` 缺席但底稿本身健康。 */
  shijiReason?: string;
  reload: () => Promise<void>;
}) {
  const records = group?.segments ?? [];
  const matched = matchShijiEntries(records, shijiRead?.entries);
  // 没有读面（没有账本）：条目照原文展示，但没有 id → 不给删除；也不许说「已删除」。
  const rows = records.map((record, index) => ({
    record,
    entry: shijiRead === undefined ? undefined : matched[index],
  }));
  const live = rows.filter((row) => shijiRead === undefined || row.entry !== undefined);
  const gone = shijiRead === undefined ? 0 : records.length - live.length;

  const [pendingId, setPendingId] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);

  const remove = (entry: ShijiEntry, name: string): void => {
    if (shiji === undefined) return;
    setBusyId(entry.id);
    setNote(undefined);
    void shiji
      .remove({ id: entry.id })
      .then(async () => {
        setPendingId(undefined);
        await reload();
        setNote(`已删除事记「${name}」：下一次刷新后正文里不会再出现；可以在设置里恢复。`);
      })
      .catch((error: unknown) => {
        setNote(`删除失败：${errorText(error)}`);
      })
      .finally(() => {
        setBusyId(undefined);
      });
  };

  return (
    <section className="xs-digao__section" data-xuanshu-section="past">
      <h2 className="xs-digao__section-head">曾经做过什么</h2>
      {group === undefined || group.note === '' ? null : (
        <p className="xs-digao__note" data-xuanshu-group-note="shiji">
          {group.note}
        </p>
      )}
      <h3 className="xs-digao__group-head">{`来源：事记（${live.length} 条）`}</h3>
      {live.map(({ record, entry }, index) => (
        <ShijiRecord
          key={entry?.id ?? `${record.name}-${String(index)}`}
          record={record}
          {...(entry === undefined ? {} : { entry })}
          pending={entry !== undefined && pendingId === entry.id}
          busy={entry !== undefined && busyId === entry.id}
          onAskDelete={() => {
            if (entry === undefined) return;
            setPendingId(entry.id);
            setNote(undefined);
          }}
          onCancel={() => {
            setPendingId(undefined);
          }}
          onConfirm={() => {
            if (entry === undefined) return;
            remove(entry, record.name);
          }}
        />
      ))}
      {shijiRead === undefined && records.length > 0 ? (
        <p className="xs-digao__note" data-xuanshu-note={shijiReason === undefined ? 'shiji-unread' : 'shiji-read-failed'}>
          {shijiReason ?? DIGAO_NO_SHIJI_READ_NOTE}
        </p>
      ) : null}
      {gone > 0 ? (
        <p className="xs-digao__note" data-xuanshu-note="shiji-removed">
          {`已删除 ${gone} 条事记：下一次刷新后正文里不会再出现；可以在设置里恢复。`}
        </p>
      ) : null}
      {note === undefined ? null : (
        <p className="xs-digao__alert" role="alert" data-xuanshu-alert="shiji">
          {note}
        </p>
      )}
    </section>
  );
}

/**
 * 只读正文：生成方式 + 两段（新形态）或三章（旧文件）。
 *
 * 形态不符（既没有两段也没有来源章节）时按原文只读展示 —— 不假装解析出来源分组。
 */
function DigaoBody({
  markdown,
  meta,
  raw,
  shijiRead,
  shiji,
  shijiReason,
  reload,
}: {
  markdown: string;
  meta: DigaoMeta | null;
  raw: boolean;
  shijiRead?: DigaoShijiRead;
  shiji?: ShijiApi;
  shijiReason?: string;
  reload: () => Promise<void>;
}) {
  const groups: DigaoGroup[] = parseDigaoMarkdown(markdown);
  const recent = groups.filter((group) => group.section === 'recent');
  const past = groups.find((group) => group.section === 'past');
  const legacy = groups.filter((group) => group.section === undefined);
  const twoSections = recent.length > 0 || past !== undefined;

  return (
    <>
      <p className="xs-digao__note" data-xuanshu-note="digest">
        {digestLine(meta)}
      </p>

      {raw ? (
        <pre className="xs-digao__raw" data-xuanshu-raw="digao">
          {markdown}
        </pre>
      ) : null}

      {groups.length === 0 ? (
        <>
          <p className="xs-digao__note" data-xuanshu-note="shape-mismatch">
            正文形态不符（没有「## 最近在做什么 / ## 曾经做过什么」两段，也没有「## 来源：…」章节）：
            按原文只读展示，界面不假装解析出来源分组。
          </p>
          <pre className="xs-digao__raw" data-xuanshu-raw="digao-fallback">
            {markdown}
          </pre>
        </>
      ) : null}

      {twoSections ? (
        <section className="xs-digao__section" data-xuanshu-section="recent">
          <h2 className="xs-digao__section-head">最近在做什么</h2>
          {recent.map((group) => (
            <section key={`${group.kind}-${group.name}`} className="xs-digao__group" data-xuanshu-group={group.kind}>
              <h3 className="xs-digao__group-head">{`来源：${group.name}（${group.segments.length} 段）`}</h3>
              {group.note === '' ? null : (
                <p className="xs-digao__note" data-xuanshu-group-note={group.kind}>
                  {group.note}
                </p>
              )}
              <SegmentList segments={group.segments} />
            </section>
          ))}
        </section>
      ) : null}

      {twoSections ? (
        <PastSection
          group={past}
          shijiRead={shijiRead}
          shiji={shiji}
          {...(shijiReason === undefined ? {} : { shijiReason })}
          reload={reload}
        />
      ) : null}

      {legacy.length > 0 ? (
        <>
          {legacy.map((group) => (
            <section key={`${group.kind}-${group.name}`} className="xs-digao__group" data-xuanshu-group={group.kind}>
              <h2 className="xs-digao__group-head">{`来源：${group.name}（${group.segments.length} 段）`}</h2>
              {group.note === '' ? null : (
                <p className="xs-digao__note" data-xuanshu-group-note={group.kind}>
                  {group.note}
                </p>
              )}
              <SegmentList segments={group.segments} />
            </section>
          ))}
        </>
      ) : null}
    </>
  );
}

/** 侧栏行图标（单色线性，与 `MingpanIcon` / `OverviewIcon` 同族；S13 §10 的 icon 位）。 */
function DigaoIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5h8l4 4V20.5H6z" />
      <path d="M14 3.5v4h4" />
      <path d="M8.5 12h7M8.5 15.5h7" />
    </svg>
  );
}

/** 底稿面板安装所需的依赖（由 `index.tsx` 造好，与底稿卡共用同一份数据面）。 */
export interface DigaoInstallDeps {
  api: DigaoApi;
  /** 事记数据面（「曾经做过什么」里每条事记的 [删除] 走它）。 */
  shiji: ShijiApi;
  navigate: (target: PanelNavTarget) => void;
}

/**
 * 底稿面板的**加性**注册（main key `digao` + 侧栏行 `digao`）。
 *
 * 与票 08 的两块面板同两条纪律：**apply 期不调 `ctx.layout.selectPanel`**
 * （默认面板 `overview` 由根入口切，且只切一次）、不新增运行期 `require`；
 * 非 DOM 环境（Node 里的产物物化 / SSR 断言）下只有样式注入被 `document` 守卫挡掉，注册照做。
 *
 * @param ctx - 客户端上下文（需 `slots`；`layout` 只在用户点击跳转时才用）。
 * @param deps - 数据面与导航（与底稿卡共用同一份数据面）。
 */
export function installDigao(ctx: Context & RpcContext, deps: DigaoInstallDeps): void {
  installDigaoStyle();
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      { name: 'main', key: DIGAO_ID, inject: () => ({ ...deps }) },
      DigaoPanel as never,
    ),
  );
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: DIGAO_ID, order: DIGAO_ORDER, label: DIGAO_LABEL },
      DigaoIcon as never,
    ),
  );
}
