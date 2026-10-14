/**
 * 票 13 · 底稿只读面板（main key `digao`）+ 加性注册（S13；冻结契约 §1 / §3）。
 *
 * 这一屏是**纯派生视图**（C2 ●）：
 *   - 顶部固定徽标逐字「纯派生 · 不可手改」（与 S1 底稿卡同一枚，跨屏一致）；
 *   - 「要改就改源头」三个跳转（谱 → S5 / 工作区 → DSH / 工作流 → S12）是本屏唯一的「改」的出口；
 *   - **零编辑控件**：没有 input / textarea / select / contenteditable，也不注册任何写底稿的命令；
 *   - 唯一的功能按钮是 `[刷新]`（重算派生文件，不是改底稿）；只读动作 `[查看 MD 形态]` 只切视图。
 *
 * 数据只读：`digao.status`（在不在 + 元数据）与 `digao.read`（正文）。
 * 正文的来源分组由 `digao-model.ts` 从 markdown 里解析 —— **界面是同一份文件的投影**，
 * 不另存一套来源归属（契约 §1：来源标记必须活在 MD 文本里）。
 *
 * 两处**刻意不编造**的地方（诚实边界）：
 *   1. 「下次刷新」不来自本屏：契约 §2 的 `digao.status` 只有 `{exists, meta}`，
 *      没有 schedule 信息，所以这里只写「由自动化任务面板里的 daily 任务决定（播种默认 03:30）」，
 *      不显示一个界面自己算出来的时刻；
 *   2. `[复制路径] / [打开所在目录]`（S13 §2 ⑤）没有落地：冻结契约没有给路径字段，
 *      也没有 open-in-app 能力面 —— 宁可不做，也不在界面上放一个做不到的按钮。
 */
import { useEffect, useRef, useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';

import { XsPureDerivedBadge } from './cards.js';
import type { DigaoApi, DigaoMeta, DigaoRead, DigaoSchedule, DigaoStatus } from './digao-api.js';
import { parseDigaoMarkdown } from './digao-model.js';
import type { DigaoGroup } from './digao-model.js';
import { installDigaoStyle } from './digao-style.js';
import { DIGAO_ID, DIGAO_LABEL, DIGAO_ORDER, EMPTY_COPY, clockOf } from './panel.js';
import type { PanelNavTarget } from './panel.js';
import type { RpcContext } from './rpc.js';

/** 负向声明（S13 §9 C2 逐字：本屏没有编辑框、没有保存按钮）。 */
export const DIGAO_NO_EDIT_NOTE =
  '本面板没有编辑框、没有保存按钮：内容由「规则骨架 + AI 摘要」生成；改了源头，刷新即变。';

/** 三源头跳转的前缀（S13 §3 ②：文案统一为「要改就改源头」）。 */
export const DIGAO_JUMP_NOTE = '要改就改源头：';

/** 三个源头跳转的文案（S13 §9 C2：并列在标记右侧）。 */
export const DIGAO_JUMPS: readonly { target: PanelNavTarget; label: string }[] = [
  { target: 'pus', label: '改谱 → S5' },
  { target: 'conversation', label: '改工作区 → 工作区' },
  { target: 'workflow', label: '改工作流 → S12' },
];

/** 「下次刷新」的指路文案：值不在本屏（契约 §2 无 schedule 字段），只指到管理面。 */
export const DIGAO_NEXT_REFRESH_NOTE =
  '下次刷新：由「自动化任务」面板里的底稿 daily 任务决定（播种默认 03:30，可在那里改或停用）。';

/** 面板的四态（`running` 用 `busy` 表达：内容保持可读，按钮转「刷新中…」）。 */
type DigaoView =
  | { kind: 'loading' }
  | { kind: 'empty'; meta: DigaoMeta | null; schedule?: DigaoSchedule }
  | { kind: 'ready'; meta: DigaoMeta | null; markdown: string; schedule?: DigaoSchedule }
  | { kind: 'error'; message: string };

/** 静态预置（测试 / SSR：给了就不取数；`error` 形状直接落错误态）。 */
export type DigaoPreloaded = { status: DigaoStatus; read?: DigaoRead } | { error: string };

export interface DigaoPanelProps {
  /** 底稿数据面（`index.tsx` 用 `createDigaoApi(ctx)` 造好注入）。 */
  api: DigaoApi;
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
  return {
    kind: 'ready',
    meta: preloaded.read.meta ?? preloaded.status.meta,
    markdown: preloaded.read.markdown,
    ...(schedule === undefined ? {} : { schedule }),
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
export function DigaoPanel({ api, navigate, preloaded, preloadedRawView }: DigaoPanelProps) {
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
        setView({
          kind: 'ready',
          meta: read.meta ?? status.meta,
          markdown: read.markdown,
          ...(schedule === undefined ? {} : { schedule }),
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

  /** `[刷新]`：**人点**才走（重算派生文件，再读回同一个文件）。 */
  const refresh = (): void => {
    const mine = ++sequence.current;
    setBusy(true);
    setNote(undefined);
    void api
      .refresh()
      .then(async () => {
        const read = await api.read();
        if (mine !== sequence.current) return;
        setView({ kind: 'ready', meta: read.meta, markdown: read.markdown });
      })
      .catch((error: unknown) => {
        if (mine !== sequence.current) return;
        setNote(`刷新失败：${errorText(error)}`);
      })
      .finally(() => {
        if (mine === sequence.current) setBusy(false);
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
        {meta?.generatedAt === undefined ? '上次刷新：（还没有生成过）' : `上次刷新 ${meta.generatedAt}`}
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
            底稿由谱 / 工作区 / 工作流三路来源提炼而成；点一次 [刷新] 就会按三路来源拼出骨架。
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
        <DigaoBody markdown={view.markdown} meta={view.meta} raw={raw} />
      ) : null}
    </main>
  );
}

/** 生成方式说明（契约 §1：骨架与来源标记是确定性规则；摘要可能降级为规则骨架）。 */
export function digestLine(meta: DigaoMeta | null | undefined): string {
  const digest = meta?.digest;
  if (digest === 'skeleton') {
    return '生成方式：骨架＝确定性规则 · 摘要＝规则骨架（LLM 不可用或提炼失败，未提炼）';
  }
  if (digest === 'llm') return '生成方式：骨架＝确定性规则 · 摘要＝AI 提炼';
  return '生成方式：骨架＝确定性规则 · 摘要＝未标注（meta 里没有 digest 这一位，按未提炼对待）';
}

/** 只读正文：生成方式 + 来源分组（形态不符时按原文只读展示）。 */
function DigaoBody({ markdown, meta, raw }: { markdown: string; meta: DigaoMeta | null; raw: boolean }) {
  const groups: DigaoGroup[] = parseDigaoMarkdown(markdown);
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
            正文形态不符（没有「## 来源：…」章节）：按原文只读展示，界面不假装解析出来源分组。
          </p>
          <pre className="xs-digao__raw" data-xuanshu-raw="digao-fallback">
            {markdown}
          </pre>
        </>
      ) : (
        groups.map((group) => (
          <section key={`${group.kind}-${group.name}`} className="xs-digao__group" data-xuanshu-group={group.kind}>
            <h2 className="xs-digao__group-head">
              {`来源：${group.name}（${group.segments.length} 段）`}
            </h2>
            {group.note === '' ? null : (
              <p className="xs-digao__note" data-xuanshu-group-note={group.kind}>
                {group.note}
              </p>
            )}
            {group.segments.map((segment, index) => (
              <article key={`${group.kind}-${String(index)}`} className="xs-digao__segment">
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
          </section>
        ))
      )}
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
