/**
 * 票 10 · 问事**门厅**（main key `consult`）+ 加性注册（S6 §2；冻结契约 §4）。
 *
 * 这一层只做三件事，界面事实全在 `consult-views.tsx`、口径全在 `consult-model.ts`：
 *   1. **两路取数**（`consult.defaults` 勾选区 / `consult.list` 最近会话）各自 fail-soft ——
 *      谱清单读不到不该把整个门厅锁死（S6 §6 error③ 明写「保留会话区可用」）；
 *   2. **开会话编排**：`consult.create` →（有话才）`consult.send` → `ctx.uiWorkspace.openSession(id)`；
 *      客户端**不造 sessionId**（ADR-0009 §1：id 由宿主半铸，客户端只搬运）；
 *   3. **历史子页**：`consult.list` → 点行 `consult.read` → 只读阅读器（S7）。
 *
 * 三条硬边界落在调用路径上：
 *   - 门厅**不发起工具调用**、不渲染消息流（F1/D5：审批卡只在 DSH 原生 `conversation` 面板可见）；
 *   - 会话分类只靠自铸 id 前缀与旁挂清单，**不碰 `meta`**（ADR-0009 §6）；
 *   - `apply` 期**不调 `ctx.layout.selectPanel`**（默认面板语义只属于 overview）。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Context } from '@deepseek-ai/cordis';

import type { ConsultApi, ConsultDefaults, ConsultDrafts, ConsultMessage, ConsultSummary, MountRef } from './consult-api.js';
import { contextSummary, initialSelection, nudgeNeeded, openConsultSession, shortConsultId, toggleSelection } from './consult-model.js';
import type { HistoryRange } from './consult-model.js';
import {
  XsConsultAsk,
  XsConsultHistoryList,
  XsConsultHistoryReader,
  XsConsultMountPlaceholder,
  XsConsultPicker,
  XsConsultRecentCard,
} from './consult-views.js';
import { CONSULT_ID, CONSULT_LABEL, CONSULT_ORDER } from './panel.js';
import type { PanelNavTarget } from './panel.js';
import type { RpcContext } from './rpc.js';

/** 取数三态（门厅的勾选区与列表各自持有，互不拖累）。 */
type Loadable<T> = { kind: 'loading' } | { kind: 'ready'; value: T } | { kind: 'error'; message: string };

/** 阅读器状态（`idle` = 还没点开任何一条）。 */
type ReaderState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; session: ConsultSummary; messages: ConsultMessage[]; drafts?: ConsultDrafts }
  | { kind: 'error'; session: ConsultSummary; message: string };

/** 安装依赖（`index.tsx` 造好后注入；三处共用同一份数据面）。 */
export interface ConsultInstallDeps {
  api: ConsultApi;
  /** 面板导航（去谱管理 / 回总览）。 */
  navigate: (target: PanelNavTarget) => void;
  /**
   * `ctx.sessions.refresh()` —— 打开宿主建的会话**之前**刷一次客户端会话目录
   * （`ISessions.refresh`，幂等、单飞）。为什么必须先刷：见 `openConsultSession` 的文档。
   * 不可用时给 `undefined`（界面按可读失败处理）。
   */
  refreshSessions?: () => Promise<void>;
  /**
   * `ctx.uiWorkspace.openSession(sessionId)` —— **只导航、不创建**（`dsh-api-facts.md` §6.2）。
   * 不可用时给 `undefined`：界面照实说明「DSH 会话面板不可用」并把 sessionId 显示出来，
   * 而不是假装切过去了。
   */
  openSession?: (sessionId: string) => void;
  /**
   * 票 12 的挂载区插槽（S8 抽屉入口 + 状态栏）。宿主接线时给；不给就退回票 10 的占位说明 ——
   * 门厅不会因为挂载面缺席而空一块，票 10 的断言台也不用改。
   */
  mountSlot?: (session: ConsultSummary | undefined) => ReactNode;
}

export interface ConsultPanelProps extends ConsultInstallDeps {
  /** 静态预置（测试 / SSR 断言）：给了就不取数。 */
  preloaded?: {
    defaults?: ConsultDefaults;
    items?: ConsultSummary[];
    view?: 'lobby' | 'history';
  };
}

/** 错误文本归一（宿主 RPC 抛 Error，也可能是字符串）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 问事门厅面板。
 * @param props - 数据面、导航与静态预置。
 * @returns 门厅 / 历史子页节点。
 */
export function ConsultPanel({ api, navigate, openSession, refreshSessions, mountSlot, preloaded }: ConsultPanelProps) {
  const [view, setView] = useState<'lobby' | 'history'>(preloaded?.view ?? 'lobby');
  const [defaults, setDefaults] = useState<Loadable<ConsultDefaults>>(
    preloaded?.defaults === undefined ? { kind: 'loading' } : { kind: 'ready', value: preloaded.defaults },
  );
  const [items, setItems] = useState<Loadable<ConsultSummary[]>>(
    preloaded?.items === undefined ? { kind: 'loading' } : { kind: 'ready', value: preloaded.items },
  );
  const [selected, setSelected] = useState<string[]>(
    preloaded?.defaults === undefined ? [] : initialSelection(preloaded.defaults.optional),
  );
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const [nudge, setNudge] = useState(false);
  /** 「打开那个会话」失败的可读原因（不可用 / 目录刷新失败 / 导航抛错）——绝不静默。 */
  const [openError, setOpenError] = useState<string | undefined>(undefined);
  const [reader, setReader] = useState<ReaderState>({ kind: 'idle' });
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<HistoryRange>('all');
  /** 用户是否动过勾选（动过之后，晚到的 defaults 不许覆盖他的选择）。 */
  const touched = useRef(preloaded?.defaults !== undefined);

  const seeded = preloaded !== undefined;
  const reloadDefaults = (): void => {
    setDefaults({ kind: 'loading' });
    void api
      .defaults()
      .then((value) => {
        setDefaults({ kind: 'ready', value });
        if (!touched.current) {
          setSelected(initialSelection(value.optional));
          touched.current = true;
        }
      })
      .catch((error: unknown) => { setDefaults({ kind: 'error', message: errorText(error) }); });
  };
  const reloadItems = (): void => {
    setItems({ kind: 'loading' });
    void api
      .list()
      .then((answer) => { setItems({ kind: 'ready', value: answer.items }); })
      .catch((error: unknown) => { setItems({ kind: 'error', message: errorText(error) }); });
  };

  useEffect(() => {
    if (seeded) return; // 静态预置：不取数（SSR 断言不该多发两次请求）
    reloadDefaults();
    reloadItems();
    // 只在挂载时取一次；重试走各自的 [重试] 按钮。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded]);

  /**
   * 本次问事的挂载恒为空：`consult.create` 的请求体只有 `pus`（契约 §2），
   * 挂载是**建会话之后**由票 12 的账本加进去的。这里绝不能借用「最近一次会话」的挂载数 ——
   * 那会让摘要行与无源引导判定都算在别人的账上（最近一次的挂载数在摘要卡里显示）。
   */
  const mountsNow: MountRef[] = [];
  const summary = contextSummary({ selected, mounts: mountsNow });

  /**
   * 进入正式对话：**先刷客户端会话目录、再切到 DSH 原生 `conversation` 面板**（只导航）。
   *
   * 二者顺序不可颠倒、失败也不许静默 —— 编排在 `openConsultSession`（可单测），
   * 这里只负责把结果搬进界面（失败时给可读错误条）。
   */
  const enterConversation = (sessionId: string): void => {
    setOpenError(undefined);
    void openConsultSession({ sessionId, refresh: refreshSessions, open: openSession }).then((result) => {
      if (!result.ok) setOpenError(result.message);
    });
  };

  /** 开一次问事：create →（有话才）send → openSession。 */
  const start = (plain = false): void => {
    const text = question.trim();
    if (!plain && nudgeNeeded({ question: text, selected, mounts: mountsNow })) {
      setNudge(true);
      return;
    }
    setNudge(false);
    setBusy(true);
    setCreateError(undefined);
    void (async () => {
      let session: ConsultSummary;
      try {
        const answer = await api.create(selected.length > 0 ? { pus: selected } : {});
        session = answer.session;
      } catch (error) {
        // S6 §6 error①：错误条 + [重试开会话] + [改从历史里接着问]，且不清掉已勾的谱。
        setCreateError(`开问事失败：${errorText(error)}`);
        setBusy(false);
        return;
      }
      setItems((current) => ({
        kind: 'ready',
        value: [session, ...(current.kind === 'ready' ? current.value : []).filter((row) => row.sessionId !== session.sessionId)],
      }));
      if (text !== '') {
        try {
          await api.send({ sessionId: session.sessionId, text });
        } catch (error) {
          // 会话已经建好：把 id 明说出来，别让人以为「什么都没发生」。
          setCreateError(
            `会话已建好（${shortConsultId(session.sessionId)}），但这一问没发出去：${errorText(error)}（可点「继续这次问事」进会话重发）`,
          );
          setBusy(false);
          return;
        }
      }
      setQuestion('');
      setBusy(false);
      enterConversation(session.sessionId);
    })();
  };

  /** 打开一条历史：只读回看（不进会话、不追加事件）。 */
  const openRow = (sessionId: string): void => {
    const known = items.kind === 'ready' ? items.value.find((row) => row.sessionId === sessionId) : undefined;
    if (known === undefined) return;
    setView('history');
    setReader({ kind: 'loading' });
    void api
      .read({ sessionId })
      .then((answer) => {
        // 票 31：`drafts` 是加性字段（没有合参记录时缺席）—— 原样交给阅读器，客户端不自己算当前性。
        setReader({ kind: 'ready', session: answer.session, messages: answer.messages, drafts: answer.drafts });
      })
      .catch((error: unknown) => { setReader({ kind: 'error', session: known, message: errorText(error) }); });
  };

  const required = defaults.kind === 'ready' ? defaults.value.required : [];
  const optional = defaults.kind === 'ready' ? defaults.value.optional : [];
  const historyItems = items.kind === 'ready' ? items.value : [];
  const latest = historyItems[0];

  return (
    <main className="xs-consult" data-xuanshu-panel={CONSULT_ID}>
      <header className="xs-consult__head">
        <h1>问事</h1>
        <button
          type="button"
          data-xuanshu-action="toggle-history"
          onClick={() => { setView(view === 'lobby' ? 'history' : 'lobby'); setReader({ kind: 'idle' }); }}
        >
          {view === 'lobby' ? '历史回看 ▸' : '← 回到当前会话'}
        </button>
      </header>

      {openError === undefined ? null : (
        <div className="xs-consult__error" data-xuanshu-error="open-session" role="alert">
          <p>{openError}</p>
        </div>
      )}

      {view === 'lobby' ? (
        <>
          <section className="xs-consult__block" data-xuanshu-block="landing">
            <p data-xuanshu-note="lobby-what">
              一次问事 = 勾选谱 → 说事 →（可选）多 AI 合参 → 结束沉淀
            </p>
            <p data-xuanshu-note="lobby-parallel">
              与工作区并列、不属于任何工作区；带 DSH 全套工具能力
            </p>
            <p className="xs-consult__note" data-xuanshu-note="lobby-f1">
              ⓘ 本面板是「书房门厅」：进会话后切到 DSH 会话面板，工具轨迹与审批卡在那里。
            </p>
          </section>

          {defaults.kind === 'loading' ? (
            <p className="xs-consult__note" data-xuanshu-state="pu-loading">正在读谱清单…</p>
          ) : null}
          {defaults.kind === 'error' ? (
            <div className="xs-consult__error" data-xuanshu-error="defaults" role="alert">
              <p>{`谱清单读不到：${defaults.message}`}</p>
              <div className="xs-consult__actions">
                <button type="button" data-xuanshu-action="retry-defaults" onClick={reloadDefaults}>重试</button>
                <button type="button" data-xuanshu-action="goto-manage-pu" onClick={() => { navigate('pus'); }}>
                  {'去谱管理 ▸ S5'}
                </button>
              </div>
            </div>
          ) : null}
          {defaults.kind === 'ready' ? (
            <XsConsultPicker
              required={required}
              optional={optional}
              selected={selected}
              onToggle={(slug) => { touched.current = true; setSelected((current) => toggleSelection(current, slug)); }}
              onManagePu={() => { navigate('pus'); }}
              onOpenDetail={() => { navigate('mingpan'); }}
            />
          ) : null}

          {/* 票 12：挂载区。宿主接线时用真的挂载区（S8 的抽屉入口 + 状态栏）；
              没接线时仍是票 10 的占位说明 —— 门厅不会因为挂载面缺席而空一块。 */}
          {mountSlot === undefined ? <XsConsultMountPlaceholder mounts={mountsNow} /> : mountSlot(latest)}

          <XsConsultAsk
            question={question}
            selected={selected}
            mounts={mountsNow}
            busy={busy}
            nudge={nudge}
            summary={summary}
            error={createError}
            onQuestion={setQuestion}
            onStart={() => { start(); }}
            onPlainAsk={() => { start(true); }}
            onClearNudge={() => { setNudge(false); }}
            onGotoHistory={() => { setView('history'); }}
          />

          {latest === undefined ? null : (
            <XsConsultRecentCard
              session={latest}
              onContinue={() => { enterConversation(latest.sessionId); }}
              onHistory={() => { setView('history'); }}
            />
          )}
        </>
      ) : null}

      {view === 'history' && reader.kind === 'idle' ? (
        <XsConsultHistoryList
          items={historyItems}
          loading={items.kind === 'loading'}
          error={items.kind === 'error' ? items.message : undefined}
          query={query}
          range={range}
          now={new Date()}
          onQuery={setQuery}
          onRange={setRange}
          onOpen={openRow}
          onBack={() => { setView('lobby'); }}
          onStart={() => { setView('lobby'); }}
          onManagePu={() => { navigate('pus'); }}
          onRetry={reloadItems}
        />
      ) : null}

      {view === 'history' && reader.kind !== 'idle' ? (
        reader.kind === 'loading' ? (
          <XsConsultHistoryReader
            session={historyItems[0] ?? FALLBACK_SESSION}
            messages={[]}
            loading
            onBack={() => { setReader({ kind: 'idle' }); }}
            onContinue={() => {}}
            onRetry={() => {}}
          />
        ) : (
          <XsConsultHistoryReader
            session={reader.session}
            messages={reader.kind === 'ready' ? reader.messages : []}
            drafts={reader.kind === 'ready' ? reader.drafts : undefined}
            error={reader.kind === 'error' ? reader.message : undefined}
            onBack={() => { setReader({ kind: 'idle' }); }}
            onContinue={() => { enterConversation(reader.session.sessionId); }}
            onRetry={() => { openRow(reader.session.sessionId); }}
          />
        )
      ) : null}
    </main>
  );
}

/** 阅读器加载态需要一个 `session` 形状；这里是**只用于占位**的空值，不显示任何真实数据。 */
const FALLBACK_SESSION: ConsultSummary = {
  sessionId: 'session-xs-consult-',
  title: '正在读…',
  createdAt: '',
  pus: [],
  mounts: [],
  turns: 0,
};

/** 侧栏行图标（书房：一卷书轴）。 */
function ConsultIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6.5c0-1.1 1.3-2 3-2s3 .9 3 2v11c0-.9-1.3-1.6-3-1.6s-3 .7-3 1.6z" />
      <path d="M10 6.5c0-1.1 1.3-2 3-2s3 .9 3 2v11c0-.9-1.3-1.6-3-1.6s-3 .7-3 1.6z" />
      <path d="M16 7h3.5M16 11h3.5M16 15h3.5" />
    </svg>
  );
}

/**
 * 门厅的**加性**注册（main key `consult` + 侧栏行 `consult`）。
 *
 * 三条纪律（与票 08 的两块面板同款，Lead 在票 10 开工时又点了一遍）：
 *   1. **apply 期不许调 `ctx.layout.selectPanel`**：`verify-assembly` 的 S3 断言默认面板
 *      `selectPanel` 恰一次且值为 `overview`；
 *   2. **不新增运行期 `require`**：产物只许 require `react` / `react/jsx-runtime`；
 *   3. 非 DOM 环境（Node 里的产物物化 / SSR 断言）要**安全**：样式注入被 `document` 守卫挡掉，
 *      注册照做 —— 否则「注册形状」就没法在 Node 里断言。
 *
 * @param ctx - 客户端上下文（需 `slots`）。
 * @param deps - 数据面 / 导航 / `openSession`（由 `index.tsx` 造好）。
 */
export function installConsult(ctx: Context & RpcContext, deps: ConsultInstallDeps): void {
  installConsultStyle();
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      { name: 'main', key: CONSULT_ID, inject: () => ({ ...deps }) },
      ConsultPanel as never,
    ),
  );
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: CONSULT_ID, order: CONSULT_ORDER, label: CONSULT_LABEL },
      ConsultIcon as never,
    ),
  );
}

/**
 * 门厅与历史子页的样式（token 走票 03 覆盖过的 `--xs-*`，不写死配色）。
 * 与 `cang-style.ts` 同款守卫：Node 里执行时安静跳过，只有碰 DOM 的那一步被挡掉。
 */
function installConsultStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('xs-consult-style') !== null) return;
  const style = document.createElement('style');
  style.id = 'xs-consult-style';
  style.textContent = `
.xs-consult{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-consult h1,.xs-consult h3,.xs-consult h4{font-weight:600}.xs-consult h1{font-size:1.15rem}.xs-consult h3{font-size:.98rem;margin:16px 0 6px}.xs-consult h4{font-size:.85rem;margin:12px 0 4px;color:var(--xs-text-secondary)}
.xs-consult__head,.xs-consult__toolbar,.xs-consult__actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.xs-consult__head{justify-content:space-between}
.xs-consult button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-consult button:disabled{opacity:.5;cursor:not-allowed}
.xs-btn--primary{background:var(--xs-accent);border-color:var(--xs-accent);color:var(--xs-accent-fg)}
.xs-consult input,.xs-consult select,.xs-consult textarea{font:inherit;color:inherit;background:var(--xs-surface-card);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:7px;box-sizing:border-box;max-width:100%}
.xs-consult textarea{display:block;width:100%;min-height:72px}
.xs-consult__block{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad);margin:12px 0}
.xs-consult__row{display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--xs-edge-card);flex-wrap:wrap}
.xs-consult__row--locked{background:var(--xs-surface-card);border-radius:var(--xs-radius-control);padding:8px}
.xs-consult__locked-hit{display:flex;gap:8px;align-items:baseline;width:100%;text-align:left;background:transparent;border:0;padding:6px 0;cursor:pointer}
.xs-consult__lock{font-size:1rem}
.xs-consult__locked-card{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:10px;margin:6px 0 2px 24px}
.xs-consult__row-name{font-weight:600}
.xs-consult__badge{font-size:.72rem;padding:2px 8px;border:1px solid var(--xs-edge-card);border-radius:999px;color:var(--xs-text-secondary)}
.xs-consult__note{font-size:.8rem;color:var(--xs-text-secondary);line-height:1.6}
.xs-consult__field{display:block;margin:10px 0}
.xs-consult__field>span{display:block;margin-bottom:4px;font-size:.85rem}
.xs-consult__locked{list-style:none;margin:0;padding:0}
.xs-consult__rows{list-style:none;margin:0;padding:0}
.xs-consult__row-hit{display:flex;gap:10px;align-items:baseline;width:100%;text-align:left}
.xs-consult__shortid{font-family:var(--font-mono,monospace);color:var(--xs-text-code);font-size:.85rem}
.xs-consult__summary{line-height:1.7}
.xs-consult__nudge,.xs-consult__error{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:12px;margin:10px 0}
.xs-consult__nudge-title{font-weight:600;margin:0 0 6px}
.xs-consult__paths{margin:0 0 8px;padding-left:20px;line-height:1.7}
.xs-consult__empty{text-align:left;padding:16px 0}
.xs-consult__empty-why{font-weight:600;margin:0 0 6px}
.xs-consult__messages{margin-top:12px}
.xs-consult__round{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:8px 10px;margin:12px 0}
.xs-consult__round-head{font-size:.85rem;margin:0 0 4px;color:var(--xs-text-secondary)}
.xs-consult__message{display:grid;grid-template-columns:44px minmax(0,1fr);gap:8px;padding:10px 0;border-bottom:1px solid var(--xs-edge-card)}
/* 角色占第一列；徽标 / 来源 / 正文一律第二列（否则混合行会把正文挤进 44px 那一列）。 */
.xs-consult__message>.xs-consult__badge,.xs-consult__message>.xs-consult__note,.xs-consult__message>.xs-consult__text{grid-column:2}
.xs-consult__role{color:var(--xs-text-secondary);font-size:.85rem}
.xs-consult__text{margin:0;line-height:1.7;white-space:pre-wrap}
@media(max-width:1100px){.xs-consult{padding:16px}.xs-consult__row-hit{flex-direction:column;gap:2px}}
`;
  document.head.appendChild(style);
}
