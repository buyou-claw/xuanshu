/**
 * 票 15 · 沉淀的**界面形状**（客户端半边）：入口条、草稿卡、确认弹窗、结果通知，以及三处加性注册。
 *
 * 槽位（S10 §8 的映射；键名以 `docs/design/ui-v1/shared/DSH槽位映射.md` 为准）：
 *   - `conversation.composer.dock`（list/session，`replaceRisk: none`）→ `XsSedimentEntry`（[导出汇总]）；
 *   - `conversation.chat.turnTail`（list/session，语义正是「已完成轮次之后的特性贡献」）
 *     → `XsSedimentDraftCard`（id `xuanshu.sediment-draft`，order 30）；
 *   - `shell.overlay`（list/root，加性、层本身 click-through）→ `XsSedimentNotice`。
 * 三处都在 `conversation` 子树里/框架浮层上：**不新开 main key、不碰 root、不声明 children、不加 priority**。
 *
 * 会话座位（`sessionId`）由槽按 scope 发放（`DSH槽位映射.md` §1.5/§12：session 作用域 → `SessionStandardProps`，
 * 座位里含 `sessionId`）。拿不到会话、或那个会话不是问事会话时，三个组件一律 `return null`
 * —— **绝不猜一个会话去写**。
 *
 * **未确认（如实登记）**：rc.2 的 `@deepseek-ai/dsh-client-ui-slots` 不在本 profile 的 node_modules 里，
 * `SessionStandardProps` 的精确形状只能从文档推断。本实现只读 **`props.sessionId`**（同表 §12 的座位名）；
 * 若真机上的发放方式不是 props（例如组件内 `useSession()` 座位），需要在真机上补一次接线 ——
 * 读取点只有本文件里的 `XsSedimentEntry` / `XsSedimentDraftCard` 两处参数表，改动量很小。
 * 非 DOM 环境下这一点无法证伪（没有真 registry），所以交付报告里按「未验」记。
 *
 * **为什么整套长在会话语境里**（S10 §1 D5 + F1）：`conversation.*` 子槽只在 DSH 原生 `conversation`
 * 面板在屏时渲染（审批卡也只在那一刻可见），所以从 `consult` 门厅发起沉淀时要先切回会话面板。
 *
 * 写法纪律（F4/D9）：不 require 任何 Harness Client 包；类名走 `--xs-` 前缀；样式只用
 * `--xs-*` / `--dsw-alias-*` token 引用；classic 脚本不过 CSS 管线，所以样式随 JS 注入。
 */
import type { Context } from '@deepseek-ai/cordis';
import { useEffect, useState, useSyncExternalStore } from 'react';

import type { SedimentApi, SedimentDraft, SedimentPuView, SedimentTarget, SedimentTargetOption } from './sediment-api.js';
import type { SedimentController, SedimentState } from './sediment-model.js';
import { confirmGate, countWords, diffParagraphs, isConsultSessionId, previewText, puPaths, wordDeltaText } from './sediment-model.js';
import { dataDirPath, useHomePaths } from './home-paths.js';
import type { HomePathsWatch } from './home-paths.js';
import type { PanelNavTarget } from './panel.js';
import { requestPuOpenAndGo } from './PuPanel.js';
import { installXuanshuStyles, registerStyleSheet } from './styles.js'
import { BREAKPOINT_WIDE_PX } from './breakpoints.js'

/** 入口条 cell id（`conversation.composer.dock` 是 list 槽，新 id 是**加**不是替换）。 */
export const SEDIMENT_ENTRY_ID = 'xuanshu.sediment-entry';
/** 草稿卡 cell id（`conversation.chat.turnTail`）。 */
export const SEDIMENT_DRAFT_CARD_ID = 'xuanshu.sediment-draft';
/** 结果通知 cell id（`shell.overlay`）。 */
export const SEDIMENT_NOTICE_ID = 'xuanshu.sediment-notice';
/** 草稿卡的 order（S10 §8 定值；turnTail 上已装先例 deliverables / plan / schedule）。 */
export const SEDIMENT_TURNTAIL_ORDER = 30;

/** 安装依赖（`index.tsx` 造好后注入；三个 cell 共用同一份数据面与控制器）。 */
export interface SedimentInstallDeps {
  api: SedimentApi;
  /** 跨槽共享状态；**人点才跑**的结构保证在它身上（见 `sediment-model.ts`）。 */
  controller: SedimentController;
  /**
   * 面板导航（[看这张谱] → 谱面板的**那张谱详情**；不新开 main key）。
   * 光跳过去是不够的：谱管理那扇门只有侧栏行「谱」一个（判据 N-001），所以这一跳带
   * `requestPuOpenAndGo` 的打开意图 —— 动作从「去谱管理」变成「打开刚写进的那张谱」。
   */
  navigate: (target: PanelNavTarget) => void;
  /**
   * 宿主回传的数据目录（`data.overview.dataDir`，产品 `~/.xuanshu/xuanshu` /
   * 开发 `<repo>/.dsh-home/xuanshu`）：草稿落点 / 写入路径据此渲染。
   * 缺席时显示中性占位「玄枢数据目录/…」（不写死任何一档，见 `home-paths.ts`）。
   */
  dataDir?: string;
  /**
   * R3（#35）· 装配期注入的 home/dataDir 注入面（与概览 / 问事 / 命盘同一份）。
   * 草稿落点与写入路径两处文案读它；显式 `dataDir` 优先，都没有才回中性占位。
   */
  homePaths?: HomePathsWatch;
}

/** 槽位标准座位：会话作用域槽会带 `sessionId`（其余键我们用不到）。 */
export interface SedimentSlotSeat {
  sessionId?: string;
}

/** 没有控制器时的空订阅 / 空状态（保证 hook 调用**无条件**发生：条件调 hook 是 React 硬错误）。 */
const NO_SUBSCRIBE = (): (() => void) => () => {};
const EMPTY_STATE: SedimentState = { kind: 'empty' };

/** 读一个会话的沉淀状态（订阅式快照；`getSnapshot` 必须返回稳定引用）。 */
function useSedimentState(controller: SedimentController | undefined, sessionId: string | undefined): SedimentState {
  const snapshot = (): SedimentState =>
    controller === undefined || sessionId === undefined ? EMPTY_STATE : controller.getState(sessionId);
  // 第三个参数是 SSR 的 `getServerSnapshot`：没有它 `renderToStaticMarkup` 直接抛
  // （「Missing getServerSnapshot」）—— 断言台与本仓库既有 SSR 断言都走这条路。
  return useSyncExternalStore(controller === undefined ? NO_SUBSCRIBE : controller.subscribe, snapshot, snapshot);
}

/** 错误文本归一（宿主 RPC 抛 Error，也可能是字符串）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ───────────────────────── ① 入口条 [导出汇总] ───────────────────────── */

export interface SedimentEntryProps extends Partial<SedimentInstallDeps>, SedimentSlotSeat {
  /** 静态预置（测试 / SSR 断言）：给了就不取谱列表。 */
  preloadedTargets?: SedimentTargetOption[];
}

/**
 * 会话收尾条上的 `[导出汇总]` + 目标谱选择。
 *
 * 只在**问事会话**里渲染（判据：`session-xs-consult-` 前缀）；工作区 / 工作流会话里不出现，
 * 也**不注册任何行为**。目标谱是必选项：选项只来自 `pu.list()`（谱列表），
 * 工作区 / 工作流不是谱，所以它们不会出现在这里（CONTEXT.md 术语约束）。
 */
export function XsSedimentEntry({ sessionId, api, controller, navigate, preloadedTargets }: SedimentEntryProps) {
  const consult = isConsultSessionId(sessionId);
  const [targets, setTargets] = useState<SedimentTargetOption[] | undefined>(preloadedTargets);
  const [slug, setSlug] = useState(preloadedTargets?.[0]?.slug ?? '');
  const [error, setError] = useState('');
  const state = useSedimentState(controller, sessionId);

  useEffect(() => {
    if (!consult || api === undefined || preloadedTargets !== undefined) return;
    const abort = new AbortController();
    api
      .listTargets(abort.signal)
      .then((rows) => {
        if (abort.signal.aborted) return;
        setTargets(rows);
        setSlug((current) => (current !== '' ? current : (rows[0]?.slug ?? '')));
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted) setError(`谱列表读不出来：${errorText(reason)}`);
      });
    return () => { abort.abort(); };
  }, [api, consult, preloadedTargets]);

  if (!consult || api === undefined || controller === undefined || sessionId === undefined || navigate === undefined) return null;

  const busy = state.kind === 'loading';
  const none = targets !== undefined && targets.length === 0;
  return (
    <div className="xs-sediment__entry" data-xuanshu-block="sediment-entry">
      <label className="xs-sediment__field">
        <span>目标谱（必选）</span>
        <select
          data-xuanshu-field="sediment-target"
          value={slug}
          disabled={busy || none}
          onChange={(event) => { setSlug(event.target.value); }}
        >
          {none ? <option value="">（还没有可选的目标谱）</option> : null}
          {(targets ?? []).map((row) => (
            <option key={row.slug} value={row.slug}>{row.name}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        data-xuanshu-action="sediment-export"
        disabled={busy || slug === ''}
        onClick={() => { void controller.export(sessionId, slug); }}
      >
        {busy ? '正在生成草稿…' : '导出汇总'}
      </button>
      <p className="xs-sediment__note">
        导出只产出草稿：写进谱要你在下一步亲手点「确认更新」，AI 不会自动写。
      </p>
      {none ? (
        <p className="xs-sediment__note" role="status">
          还没有可选的目标谱：沉淀只能写进谱（工作区 / 工作流不是谱），先去侧栏「谱」建一本。
        </p>
      ) : null}
      {error === '' ? null : <p className="xs-sediment__error" role="alert">{error}</p>}
    </div>
  );
}

/* ───────────────────────── ② 草稿卡 ───────────────────────── */

export interface SedimentDraftCardProps extends SedimentInstallDeps, SedimentSlotSeat {
  /** 静态预置（测试 / SSR 断言）：打开确认弹窗，并直接给目标谱现状（不再取数）。 */
  initialConfirmOpen?: boolean;
  preloadedTargetView?: SedimentPuView;
}

/** 状态标记的文案（S10 §6 的状态点）。 */
function stateLabel(kind: SedimentState['kind']): string {
  if (kind === 'loading') return 'loading';
  if (kind === 'ready') return 'ready';
  if (kind === 'error') return 'error';
  if (kind === 'done') return 'done';
  return 'empty';
}

/**
 * 会话内的沉淀草稿卡（`conversation.chat.turnTail`）。
 *
 * 首行固定披露「N 字 · 尚未写进任何谱」；预览只读；三个动作全部由人点。
 * 「更新到谱…」**只开弹窗、不写**（省略号就是这个意思）；真正的写入是弹窗里的第二道确认。
 */
export function XsSedimentDraftCard({ sessionId, api, controller, navigate, dataDir, homePaths, initialConfirmOpen, preloadedTargetView }: SedimentDraftCardProps) {
  const consult = isConsultSessionId(sessionId);
  // R3：草稿落点 / 写入路径读注入面（宿主回传的 dataDir）；显式 props 优先。
  const injectedHomePaths = useHomePaths(homePaths);
  const localDataDir = dataDir ?? injectedHomePaths.dataDir;
  const state = useSedimentState(controller, sessionId);
  const [open, setOpen] = useState(initialConfirmOpen === true);
  const [targetView, setTargetView] = useState<SedimentPuView | undefined>(preloadedTargetView);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const draft = state.answer?.draft;
  const target = state.answer?.target;
  const slug = target?.slug;
  /**
   * `done` 态手里那张**刚写进去的谱**（[看这张谱] 的打开意图用它）。
   * 提成 const 是因为它还要在 `onClick` 这个闭包里用：`state.pu` 是属性访问，闭包里 narrowing 会失效
   * （`SedimentState.done` 的 `pu` 本身也是可选的）；const 一收，判定与用法只看同一份。
   */
  const committedPu = state.kind === 'done' ? state.pu : undefined;

  // 打开弹窗后读一次目标谱现状：diff / 字数 / 陈旧判定的基准都从它来。
  // 静态预置（SSR 断言）给了 `preloadedTargetView` 就不再取数。
  useEffect(() => {
    if (!open || api === undefined || slug === undefined || preloadedTargetView !== undefined) return undefined;
    const abort = new AbortController();
    api
      .readTarget(slug, abort.signal)
      .then((view) => { if (!abort.signal.aborted) setTargetView(view); })
      .catch((reason: unknown) => { if (!abort.signal.aborted) setActionError(`目标谱现状读不出来：${errorText(reason)}`); });
    return () => { abort.abort(); };
  }, [api, open, preloadedTargetView, slug]);

  if (!consult || api === undefined || controller === undefined || sessionId === undefined || navigate === undefined) return null;
  if (state.kind === 'empty') return null;

  /**
   * 第二道确认（人点 `[确认更新]`）。
   *
   * **先重读一次目标谱**：`updated_at` 与预览时用的那份不一致 → 转 `stale`、**不写**
   * （S10 §5 步骤 4 / §6 stale 行）。这一步是本票唯一会写谱的入口，
   * 而它只在人点之后才被调用。
   */
  const confirm = async (): Promise<void> => {
    if (slug === undefined) return;
    setBusy(true);
    setActionError('');
    try {
      const fresh = await api.readTarget(slug);
      if (targetView !== undefined && fresh.updatedAt !== targetView.updatedAt) {
        setTargetView(fresh);
        setStale(true);
        return;
      }
      const outcome = await controller.commit(sessionId);
      if (outcome.ok) {
        setOpen(false);
        setStale(false);
      } else {
        setActionError(outcome.reason ?? '写入失败：宿主没有给出理由。');
      }
    } catch (reason: unknown) {
      setActionError(`写入失败：${errorText(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  /** `[重新预览]`：读完再让人确认一次（stale 的出口）。 */
  const reopen = async (): Promise<void> => {
    if (slug === undefined) return;
    setBusy(true);
    setActionError('');
    try {
      setTargetView(await api.readTarget(slug));
      setStale(false);
    } catch (reason: unknown) {
      setActionError(`目标谱现状读不出来：${errorText(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="xs-sediment__card" data-xuanshu-card="sediment-draft" data-xs-state={state.kind}>
      <header className="xs-sediment__head">
        <h3>沉淀草稿</h3>
        <span className="xs-sediment__badge" data-xuanshu-state={state.kind}>{stateLabel(state.kind)}</span>
      </header>

      {state.kind === 'loading' ? (
        <p data-xuanshu-skeleton="sediment">正在让这场问事汇出草稿……（要等一轮回答，通常几十秒）</p>
      ) : null}

      {state.kind === 'error' ? (
        <div className="xs-sediment__error" role="alert">
          <p>{state.reason ?? '导出汇总失败：宿主没有给出理由。'}</p>
          <button type="button" data-xuanshu-action="sediment-retry" onClick={() => { void controller.export(sessionId, target?.slug); }}>重试</button>
        </div>
      ) : null}

      {state.kind === 'ready' && draft !== undefined && target !== undefined ? (
        <>
          <p className="xs-sediment__meta">
            {`${countWords(draft.body)} 字 · 尚未写进任何谱`}
          </p>
          <p className="xs-sediment__target">
            {`目标谱：${target.name}（${target.slug}）`}
          </p>
          <pre className="xs-sediment__preview" data-xuanshu-preview="sediment">{previewText(draft.body)}</pre>
          <p className="xs-sediment__path">{`草稿落点（只读）：${dataDirPath(localDataDir, 'sediment', `${state.answer?.draftId ?? ''}.json`)}`}</p>
          {state.reason === undefined ? null : <p className="xs-sediment__error" role="alert">{state.reason}</p>}
          {actionError === '' ? null : <p className="xs-sediment__error" role="alert">{actionError}</p>}
          <div className="xs-sediment__actions">
            <button type="button" className="xs-btn--primary" data-xuanshu-action="sediment-open-confirm" onClick={() => { setOpen(true); }}>更新到谱…</button>
            <button type="button" data-xuanshu-action="sediment-discard" onClick={() => { void controller.discard(sessionId); }}>丢弃这份草稿</button>
          </div>
          {open ? (
            <XsSedimentConfirmDialog
              draft={draft}
              target={target}
              base={targetView}
              dataDir={localDataDir}
              stale={stale}
              busy={busy}
              error={actionError === '' ? undefined : actionError}
              onConfirm={() => { void confirm(); }}
              onCancel={() => { setOpen(false); }}
              onReopen={() => { void reopen(); }}
            />
          ) : null}
        </>
      ) : null}

      {committedPu !== undefined ? (
        <div className="xs-sediment__done">
          <p data-xuanshu-state="committed">{`已更新到谱「${committedPu.name}」。`}</p>
          <p className="xs-sediment__note">{`写入路径：${puPaths(committedPu.slug, localDataDir).content}`}</p>
          <div className="xs-sediment__actions">
            {/* 「看这张谱」不是「去谱管理」：它带着**这张刚写进的谱**进详情（`requestPuOpenAndGo`）。
                也**不挂** `data-xuanshu-nav="pus"` —— 谱管理那扇门只有侧栏行「谱」一个（判据 N-001），
                挂上去等于把同一个动作再指一次；换了动作名之后它也不必再借那一扇门的名义。 */}
            <button type="button" data-xuanshu-action="sediment-open-pu" onClick={() => { requestPuOpenAndGo(committedPu, navigate); }}>看这张谱 -&gt;</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ───────────────────────── ③ 确认弹窗（纯展示；状态与取数由草稿卡持有） ───────────────────────── */

export interface SedimentConfirmDialogProps {
  draft?: SedimentDraft;
  target?: SedimentTarget;
  /** 目标谱当前态；`undefined` = 还在读（不编一份现状出来）。 */
  base?: SedimentPuView;
  /** 宿主回传的数据目录（`data.overview.dataDir`）：写入路径只读展示据此渲染；缺席用中性占位。 */
  dataDir?: string;
  /** 目标谱在预览之后被改动过：必须先重新预览。 */
  stale: boolean;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onReopen: () => void;
}

/**
 * 人工确认弹窗（照 `Modal` 的形状与行为自研；DSH 没有确认闸门组件）。
 *
 * 四件东西**同时**可见，缺一即不合格（S10 §9 C4）：
 * ① 目标谱（必选）② 逐段 diff 预览 ③ 字数变化 ④ 只读写入路径。
 * `[确认更新]` 是第二道确认；不可用时**理由渲染在按钮下面**（置灰而不说为什么 = 把闸门藏起来）。
 */
export function XsSedimentConfirmDialog({ draft, target, base, dataDir, stale, busy, error, onConfirm, onCancel, onReopen }: SedimentConfirmDialogProps) {
  const gate = confirmGate({ hasDraft: draft !== undefined, targetSlug: target?.slug ?? '', stale, busy });
  const paths = target === undefined ? undefined : puPaths(target.slug, dataDir);
  const diff = draft === undefined || base === undefined ? undefined : diffParagraphs(base.body, draft.body);
  const words = draft === undefined || base === undefined ? undefined : wordDeltaText(countWords(base.body), countWords(draft.body));

  return (
    <div className="xs-sediment__overlay" role="dialog" aria-modal="true" aria-labelledby="xs-sediment-dialog-title">
      <div className="xs-sediment__dialog">
        <h2 id="xs-sediment-dialog-title">更新到谱 · 人工确认</h2>

        <section className="xs-sediment__part">
          <h4>① 目标谱（必选）</h4>
          <p data-xuanshu-field="sediment-confirm-target">
            {target === undefined ? '（还没有选定目标谱）' : `${target.name}（${target.slug}）`}
          </p>
          <p className="xs-sediment__note">写入目标只能是谱 —— 工作区 / 工作流不是谱，选项里不出现。</p>
          {target === undefined ? (
            <p className="xs-sediment__note" data-xs-gate="no-target" role="status">还没有目标谱：沉淀只能写进谱，先回入口选一本。</p>
          ) : null}
          {stale ? (
            <div className="xs-sediment__stale" data-xs-gate="stale" role="alert">
              <p>目标谱在预览后被改动，请重新预览（本页不会覆盖你没看过的内容）。</p>
              <button type="button" data-xuanshu-action="sediment-reopen" disabled={busy} onClick={onReopen}>重新预览</button>
            </div>
          ) : null}
        </section>

        <section className="xs-sediment__part">
          <h4>② 变更 diff 预览（草稿 → 目标谱）</h4>
          {diff === undefined ? (
            <p className="xs-sediment__note">正在读目标谱现状…</p>
          ) : (
            <>
              <p className="xs-sediment__counts">
                {`+ 新增 ${diff.counts.added} 段 · ~ 替换 ${diff.counts.replaced} 段 · = 未变 ${diff.counts.unchanged} 段`}
                {diff.counts.removed === 0 ? '' : ` · - 删除 ${diff.counts.removed} 段`}
              </p>
              <ol className="xs-sediment__diff" data-xuanshu-diff="sediment">
                {diff.items.map((item, index) => (
                  <li key={`${item.kind}-${String(index)}`} data-xs-diff-kind={item.kind}>
                    <span className="xs-sediment__mark">{item.kind}</span>
                    <span className="xs-sediment__diff-text">{previewText(item.text, 200)}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <section className="xs-sediment__part">
          <h4>③ 字数变化</h4>
          <p data-xuanshu-field="sediment-words">{words ?? '正在读目标谱现状…'}</p>
          <p className="xs-sediment__note">summary 由 AI 重写（草稿里的那一份）；确认之后它就是新的汇总。</p>
        </section>

        <section className="xs-sediment__part">
          <h4>④ 写入路径（只读展示，界面不可改）</h4>
          <ul className="xs-sediment__paths">
            {paths === undefined ? <li>（还没有目标谱）</li> : (
              <>
                <li data-xuanshu-readonly-path="content">{paths.content}</li>
                <li data-xuanshu-readonly-path="summary">{paths.summary}</li>
              </>
            )}
          </ul>
          <p className="xs-sediment__note">写入走谱的原子替换（同目录暂存后整体替换）；不额外留备份目录。</p>
        </section>

        {error === undefined ? null : <p className="xs-sediment__error" role="alert">{error}</p>}

        <div className="xs-sediment__actions">
          <button
            type="button"
            className="xs-btn--primary"
            data-xuanshu-action="sediment-confirm"
            disabled={!gate.ok}
            onClick={onConfirm}
          >
            {busy ? '正在写入…' : '确认更新'}
          </button>
          <button type="button" data-xuanshu-action="sediment-cancel" disabled={busy} onClick={onCancel}>返回改草稿</button>
        </div>
        {/* 置灰时理由必须可见：置灰而不说为什么，等于把闸门藏起来（S1 §6④ / S10 §6 disabled 行）。 */}
        {gate.ok || gate.reason === undefined ? null : <p className="xs-sediment__gate-reason" role="status">{gate.reason}</p>}
        <p className="xs-sediment__note">长期放行请在 DSH 权限设置里改，本屏不提供跳过确认。</p>
      </div>
    </div>
  );
}

/* ───────────────────────── ④ 结果通知（shell.overlay） ───────────────────────── */

export interface SedimentNoticeProps {
  controller: SedimentController;
  navigate: (target: PanelNavTarget) => void;
}

/**
 * 写入结果通知（`shell.overlay`，list/root，加性）。
 * 无内容时 `return null` → 不渲染 DOM → 层天然 click-through（DSH 自带 toast 同法）。
 */
export function XsSedimentNotice({ controller, navigate }: SedimentNoticeProps) {
  const notice = useSyncExternalStore(controller.subscribe, controller.getNotice, controller.getNotice);
  if (notice === undefined) return null;
  return (
    <div className="xs-sediment__notice" data-xuanshu-notice="sediment" role="status">
      <p>{`已更新到谱「${notice.pu.name}」（${countWords(notice.pu.body)} 字）。`}</p>
      <div className="xs-sediment__actions">
        {/* 通知手里**拿得到那张谱**（`SedimentNotice.pu`，`sediment-model.ts`）：所以这里也用打开意图，
            不是裸跳。关通知仍排在后面 —— 先设意图再关，人看到的是「谱面板已经翻到这张谱」。 */}
        <button type="button" data-xuanshu-action="sediment-open-pu" onClick={() => { requestPuOpenAndGo(notice.pu, navigate); controller.dismissNotice(); }}>看这张谱 -&gt;</button>
        <button type="button" data-xuanshu-action="sediment-dismiss" onClick={() => { controller.dismissNotice(); }}>关闭</button>
      </div>
    </div>
  );
}

/* ───────────────────────── ⑤ 加性注册 ───────────────────────── */

/**
 * 注册沉淀的三处贡献。
 *
 * 三条纪律（与票 10 / 13 的面板同款）：
 *   1. **apply 期不许调 `ctx.layout.selectPanel`**（默认面板语义只属于 overview）；
 *   2. **不新增运行期 `require`**（产物只许 require `react` / `react/jsx-runtime`）；
 *   3. 非 DOM 环境（Node 里的产物物化 / SSR 断言）要安全：样式注入被 `document` 守卫挡掉，注册照做。
 *
 * @param ctx - 客户端上下文（需 `slots`）。
 * @param deps - 数据面 / 控制器 / 导航（由 `index.tsx` 造好，三处共用同一份）。
 */
export function installSediment(ctx: Context, deps: SedimentInstallDeps): void {
  installSedimentStyle();
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      { name: 'conversation.composer.dock', id: SEDIMENT_ENTRY_ID, inject: () => ({ ...deps }) },
      XsSedimentEntry as never,
    ),
  );
  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      { name: 'conversation.chat.turnTail', id: SEDIMENT_DRAFT_CARD_ID, order: SEDIMENT_TURNTAIL_ORDER, inject: () => ({ ...deps }) },
      XsSedimentDraftCard as never,
    ),
  );
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: SEDIMENT_NOTICE_ID, inject: () => ({ ...deps }) },
      XsSedimentNotice as never,
    ),
  );
}

/**
 * 沉淀区块的样式（token 走票 03 覆盖过的 `--xs-*`，不写死配色）。
 * 与 `consult.tsx` 同款守卫：Node 里执行时安静跳过。
 */
function installSedimentStyle(): void {
  registerStyleSheet("xuanshu-sediment-style", `
.xs-sediment__entry{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0}
.xs-sediment__field{display:flex;gap:6px;align-items:center;font-size:.85rem}
.xs-sediment__entry select,.xs-sediment__entry button{font:inherit}
.xs-sediment__card{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad);margin:10px 0}
.xs-sediment__head{display:flex;gap:8px;align-items:baseline;justify-content:space-between}
.xs-sediment__head h3{font-size:.98rem;font-weight:600;margin:0}
.xs-sediment__badge{font-size:.72rem;padding:2px 8px;border:1px solid var(--xs-edge-card);border-radius:999px;color:var(--xs-text-secondary)}
.xs-sediment__meta{font-weight:600;margin:8px 0 4px}
.xs-sediment__target{margin:0 0 6px;color:var(--xs-text-secondary)}
.xs-sediment__preview{max-height:8em;overflow:auto;margin:6px 0;padding:8px;background:var(--xs-surface-card);border-radius:var(--xs-radius-control);white-space:pre-wrap;font:inherit}
.xs-sediment__path,.xs-sediment__note{font-size:.8rem;color:var(--xs-text-secondary);line-height:1.6;margin:4px 0}
.xs-sediment__actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0 0}
.xs-sediment__actions button{font:inherit;padding:6px 12px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-sediment__actions button:disabled{opacity:.5;cursor:not-allowed}
.xs-btn--primary{background:var(--xs-constraint-human-gate-bg,var(--xs-accent));border-color:var(--xs-accent);color:var(--xs-constraint-human-gate-fg,var(--xs-accent-fg))}
.xs-sediment__overlay{position:fixed;inset:0;background:var(--xs-surface-overlay-mask);display:flex;align-items:center;justify-content:center;padding:16px;z-index:30}
.xs-sediment__dialog{background:var(--xs-surface-card);color:var(--xs-text-body);border-radius:var(--xs-radius-card);max-width:var(--xs-size-modal-width,720px);max-height:90vh;overflow:auto;padding:var(--xs-space-card-pad);box-sizing:border-box}
.xs-sediment__dialog h2{font-size:1.05rem;font-weight:600;margin:0 0 8px}
.xs-sediment__part{border-top:1px solid var(--xs-edge-card);padding-top:8px;margin-top:8px}
.xs-sediment__part h4{font-size:.85rem;margin:0 0 4px;color:var(--xs-text-secondary)}
.xs-sediment__counts{font-weight:600;margin:4px 0}
.xs-sediment__diff{list-style:none;margin:4px 0;padding:0;max-height:12em;overflow:auto}
.xs-sediment__diff li{display:grid;grid-template-columns:18px minmax(0,1fr);gap:6px;padding:2px 0;border-bottom:1px solid var(--xs-edge-card)}
.xs-sediment__mark{font-family:var(--font-mono,monospace);color:var(--xs-text-code)}
.xs-sediment__diff-text{white-space:pre-wrap}
.xs-sediment__paths{list-style:none;margin:4px 0;padding:0;font-family:var(--font-mono,monospace);color:var(--xs-text-code);font-size:.85rem;word-break:break-all}
.xs-sediment__stale{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:8px;margin:6px 0}
.xs-sediment__error{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:8px;margin:6px 0}
.xs-sediment__gate-reason{font-size:.8rem;color:var(--xs-text-secondary);margin:6px 0 0}
.xs-sediment__notice{position:fixed;right:16px;bottom:16px;z-index:40;background:var(--xs-surface-card);color:var(--xs-text-body);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:12px}
@media(max-width: ${BREAKPOINT_WIDE_PX}px){.xs-sediment__dialog{max-width:none;width:100%;height:100%}}
`);
  installXuanshuStyles()
}
