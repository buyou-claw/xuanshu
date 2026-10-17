/**
 * 票 27（#27）· 会话内「存成今天的事记」的界面形状（客户端半边）。
 *
 * 落位（契约 §3 + 探路笔记的槽位表）：
 *   - `conversation.composer.dock`（list/session，`replaceRisk: none`）→ `XsShijiSaveEntry`；
 *   - **不新增 main key、不新增侧栏行**：这是一次会话内的动作，不是第六块面板。
 *
 * 三条纪律：
 *   1. **只在问事会话里出现**（判据是自铸 id 前缀 `session-xs-consult-`，与宿主
 *      `shiji.fromSession` 的门一致；拿不到会话座位就 `return null` —— 绝不猜一个会话去写）；
 *   2. **不点不写**：造组件、静态渲染都不发请求；第一道按钮只展开确认条，
 *      `shiji.fromSession` 的请求体里 `confirmed: true` 由数据面写死（`shiji-api.ts`）；
 *   3. **失败要看得见**：宿主的方法级失败被折成可读 Error，理由原样显示在入口条里，不静默。
 *
 * 成功之后：入口条里给「已存成今天的事记：<名字>」+ 一个 [打开底稿 →] 的跳转
 * （事记的可读位置是底稿的「曾经做过什么」那一段）。
 *
 * 环境：本模块会在 Node 里被执行（产物物化 / SSR 断言）—— 样式注入被 `document` 守卫挡掉，
 * 注册面照做（与 `sediment-views.tsx` / `digao.tsx` 同法）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { useEffect, useState } from 'react';

import type { PanelNavTarget } from './panel.js';
import { isConsultSessionId } from './sediment-model.js';
import type { ShijiApi, ShijiEntry } from './shiji-api.js';

/** 入口条 cell id（`conversation.composer.dock` 是 list 槽，新 id 是**加**不是替换）。 */
export const SHIJI_ENTRY_ID = 'xuanshu.shiji-entry';

/** 入口条上的一行说明（写清「点了才写」这件事，别让人以为它会自动存）。 */
export const SHIJI_SAVE_NOTE = '这一场的要点可以在你点了并确认之后，存成今天的一条事记。';

/** 确认条上的那句话（第二道确认；契约 §2 的人确认闸门）。 */
export const SHIJI_SAVE_CONFIRM = '存成今天的事记？会把这场的要点写成一条事记，存下后可以在底稿里看到，也可以删掉。';

/** 安装依赖（`index.tsx` 造好后注入）。 */
export interface ShijiInstallDeps {
  api: ShijiApi;
  /** 面板导航（成功后的 [打开底稿 →] 跳到底稿面板）。 */
  navigate?: (target: PanelNavTarget) => void;
}

/** 槽位标准座位：会话作用域槽会带 `sessionId`（其余键我们用不到）。 */
export interface ShijiSlotSeat {
  sessionId?: string;
}

/** 错误文本归一（宿主 RPC 抛 Error，也可能是字符串）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 成功 / 失败的结果（一次人点的动作只会有一个）。 */
type SaveResult = { kind: 'ok'; entry: ShijiEntry } | { kind: 'error'; message: string };

export interface XsShijiSaveEntryProps extends Partial<ShijiInstallDeps>, ShijiSlotSeat {}

/**
 * 会话收尾条上的 `[存成今天的事记]`。
 *
 * 只在**问事会话**里渲染（判据：`session-xs-consult-` 前缀）；工作区 / 工作流会话里不出现，
 * 也**不注册任何行为**。点击 → 就地展开确认条 → `[确认存下]` 才真的写。
 */
export function XsShijiSaveEntry({ sessionId, api, navigate }: XsShijiSaveEntryProps) {
  const consult = isConsultSessionId(sessionId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SaveResult | undefined>(undefined);

  if (!consult || api === undefined || sessionId === undefined) return null;

  /** **人点 [确认存下]** 才走到这里：`confirmed: true` 由数据面写死。 */
  const save = (): void => {
    setBusy(true);
    setResult(undefined);
    void api
      .fromSession({ sessionId })
      .then((answer) => {
        if (answer.ok !== true) {
          setResult({ kind: 'error', message: answer.error?.message ?? '没有写入任何事记（宿主没有给理由）。' });
          return;
        }
        setOpen(false);
        setResult({ kind: 'ok', entry: answer.entry });
      })
      .catch((error: unknown) => {
        setResult({ kind: 'error', message: errorText(error) });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="xs-shiji__entry" data-xuanshu-block="shiji-entry">
      <button
        type="button"
        className="xs-btn"
        data-xuanshu-action="shiji-save-session"
        disabled={busy}
        onClick={() => {
          setOpen(true);
          setResult(undefined);
        }}
      >
        存成今天的事记
      </button>
      <span className="xs-shiji__note">{SHIJI_SAVE_NOTE}</span>

      {open ? (
        <div className="xs-shiji__confirm" data-xuanshu-confirm="save-shiji">
          <p data-xuanshu-confirm-text="save-shiji">{SHIJI_SAVE_CONFIRM}</p>
          <div className="xs-shiji__actions">
            <button type="button" className="xs-btn xs-btn--primary" data-xuanshu-action="shiji-save-confirm" disabled={busy} onClick={save}>
              {busy ? '存下中…' : '确认存下'}
            </button>
            <button
              type="button"
              data-xuanshu-action="shiji-save-cancel"
              disabled={busy}
              onClick={() => {
                setOpen(false);
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {result === undefined ? null : result.kind === 'ok' ? (
        <p className="xs-shiji__notice" role="status" data-xuanshu-notice="shiji">
          {`已存成今天的事记：「${result.entry.name}」（${result.entry.lastActiveAt.slice(0, 10)}）`}
          {navigate === undefined ? null : (
            <button
              type="button"
              className="xs-btn"
              data-xuanshu-nav="digao"
              onClick={() => {
                navigate('digao');
              }}
            >
              打开底稿 →
            </button>
          )}
        </p>
      ) : (
        <p className="xs-shiji__error" role="alert" data-xuanshu-alert="shiji">
          {`没有存成：${result.message}`}
        </p>
      )}
    </div>
  );
}

/**
 * 注册「存成今天的事记」的入口条。
 *
 * 纪律与其它面板同款：**apply 期不调 `ctx.layout.selectPanel`**、不新增运行期 `require`、
 * 非 DOM 环境下样式注入被守卫挡掉而注册照做；**只加一个 cell**（不新增 main key / 侧栏行）。
 *
 * @param ctx - 客户端上下文（需 `slots`）。
 * @param deps - 事记数据面与导航。
 */
export function installShiji(ctx: Context, deps: ShijiInstallDeps): void {
  installShijiStyle();
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      { name: 'conversation.composer.dock', id: SHIJI_ENTRY_ID, inject: () => ({ ...deps }) },
      XsShijiSaveEntry as never,
    ),
  );
}

/**
 * P4（复核 #26）· 事记的设置面（设置 → 事记）。
 *
 * 为什么在这里：底稿面板承诺「删除后可以在设置里恢复」，但复核时设置里没有入口 ——
 * `shiji.restore` / `shiji.settings.get|set` 只到 RPC 面。这个分区把两件事摆到界面上：
 *   - **已删除的事记**（墓碑，`frozenAt` 非空）逐条列出 + [恢复]；
 *   - **不参与自动扫描的目录**（相对项目根）逐条列出 + [移除]，输入框 + [添加]。
 *
 * 落位：`settings.section`（与票 30「我的数据」同一个 list 槽；纯加性 —— 不新增 main key / 侧栏行）。
 * 纪律：apply / 静态渲染期不发请求（取数在挂载后的 effect 里）；写失败的理由显示在分区里。
 */
export const SHIJI_SETTINGS_ID = 'xuanshu.shiji';
export const SHIJI_SETTINGS_LABEL = '事记';
/** 既有分区：account -10 / general 0 / models 10 / plugins 15 / agent-presets 20 / 我的数据 25。 */
export const SHIJI_SETTINGS_ORDER = 26;

/** 分区的全部状态（纯渲染组件的唯一输入）。 */
export interface ShijiSettingsState {
  /** 墓碑（`frozenAt` 非空）。 */
  tombstones: ShijiEntry[];
  excludedDirs: string[];
  /** 输入框里还没提交的目录。 */
  draftDir: string;
  busy: boolean;
  loading?: boolean;
  error?: string;
  note?: string;
}

/** 分区的动作（四个写入口，分别对应 restore / settings.set 的四条调用）。 */
export interface ShijiSettingsActions {
  onDraftDirChange(value: string): void;
  onAddExcludedDir(): void;
  onRemoveExcludedDir(dir: string): void;
  onRestore(id: string): void;
}

/** ISO 时间 → `YYYY-MM-DD`（只显示日期；没值就如实说未回传）。 */
function dayOf(iso: string | null | undefined): string {
  return typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : '日期未回传';
}

/**
 * 纯渲染组件（无取数逻辑；SSR 与静态断言可直接渲染）。
 * @param props - 当前状态与四个动作。
 */
export function XsShijiSettingsSection({ state, actions }: { state: ShijiSettingsState; actions: ShijiSettingsActions }) {
  if (state.loading === true) {
    return (
      <div className="xs-shiji__settings" data-xuanshu-section="shiji">
        <h2>事记</h2>
        <p className="xs-shiji__note" data-xs-state="loading">正在读事记与排除目录…</p>
      </div>
    );
  }
  return (
    <div className="xs-shiji__settings" data-xuanshu-section="shiji">
      <h2>事记</h2>
      <p className="xs-shiji__note">
        这里管理「曾经做过什么」里的事记：删掉的可以恢复；被排除的目录不参与自动扫描。
      </p>

      <section className="xs-shiji__block" data-xuanshu-block="shiji-restore">
        <h3>已删除的事记（可恢复）</h3>
        {state.tombstones.length === 0 ? (
          <p className="xs-shiji__note" data-xuanshu-empty="tombstones">没有被删除的事记。</p>
        ) : (
          <ul className="xs-shiji__list">
            {state.tombstones.map((entry) => (
              <li key={entry.id} className="xs-shiji__row" data-xuanshu-shiji={entry.id}>
                <span>{entry.name}</span>
                <span className="xs-shiji__note">{`删除于 ${dayOf(entry.frozenAt)}`}</span>
                <button
                  type="button"
                  data-xuanshu-action="restore-shiji"
                  data-xuanshu-shiji-id={entry.id}
                  disabled={state.busy}
                  onClick={() => actions.onRestore(entry.id)}
                >
                  {state.busy ? '恢复中…' : '恢复'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="xs-shiji__block" data-xuanshu-block="shiji-excluded">
        <h3>不参与自动扫描的目录</h3>
        <p className="xs-shiji__note">相对项目根的路径（如 node_modules、dist）；绝对路径会被拒绝。</p>
        {state.excludedDirs.length === 0 ? (
          <p className="xs-shiji__note" data-xuanshu-empty="excluded">没有排除目录。</p>
        ) : (
          <ul className="xs-shiji__list">
            {state.excludedDirs.map((dir) => (
              <li key={dir} className="xs-shiji__row" data-xuanshu-excluded-dir={dir}>
                <code>{dir}</code>
                <button
                  type="button"
                  data-xuanshu-action="remove-excluded-dir"
                  data-xuanshu-dir={dir}
                  disabled={state.busy}
                  onClick={() => actions.onRemoveExcludedDir(dir)}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="xs-shiji__actions">
          <label>
            目录
            <input
              type="text"
              data-xuanshu-field="excluded-dir"
              value={state.draftDir}
              placeholder="node_modules"
              onChange={(event) => actions.onDraftDirChange((event.target as HTMLInputElement).value)}
            />
          </label>
          <button type="button" data-xuanshu-action="add-excluded-dir" disabled={state.busy} onClick={actions.onAddExcludedDir}>
            添加
          </button>
        </div>
      </section>

      {state.error === undefined ? null : (
        <p className="xs-shiji__error" role="alert" data-xuanshu-setting-error="shiji">{state.error}</p>
      )}
      {state.note === undefined ? null : (
        <p className="xs-shiji__note" role="status" data-xuanshu-notice="shiji">{state.note}</p>
      )}
    </div>
  );
}

/**
 * 分区宿主：挂载后读一次（墓碑 + 排除目录）；四个动作写回并**重读**。
 *
 * 写失败 → 分区里显示可读理由，状态保持上一次读到的值（不显示一个没写进去的开关）。
 */
export function ShijiSettingsHost({ api }: { api: ShijiApi }) {
  const [state, setState] = useState<ShijiSettingsState>({
    tombstones: [], excludedDirs: [], draftDir: '', busy: false, loading: true,
  });

  const load = (): void => {
    setState((previous) => ({ ...previous, loading: true, error: undefined }));
    void Promise.all([api.list({ includeDeleted: true }), api.getSettings()])
      .then(([list, settings]) => {
        setState((previous) => ({
          ...previous,
          loading: false,
          tombstones: (Array.isArray(list.entries) ? list.entries : []).filter((entry) => entry.frozenAt !== null && entry.frozenAt !== undefined),
          excludedDirs: Array.isArray(settings.excludedDirs) ? settings.excludedDirs : [],
        }));
      })
      .catch((reason: unknown) => {
        setState((previous) => ({ ...previous, loading: false, error: `读不到事记设置：${errorText(reason)}` }));
      });
  };

  useEffect(() => {
    load();
    // `load` 是每渲染重建的闭包；依赖只留数据面（与日课 / 底稿面板同法）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  /** 写排除目录：host 侧归一后的列表是唯一权威（失败抛，理由显示在分区里）。 */
  const writeExcludedDirs = (next: string[], note: string): void => {
    setState((previous) => ({ ...previous, busy: true, error: undefined, note: undefined }));
    void api
      .setSettings({ excludedDirs: next })
      .then((saved) => {
        setState((previous) => ({ ...previous, busy: false, excludedDirs: saved.excludedDirs, note }));
      })
      .catch((reason: unknown) => {
        setState((previous) => ({ ...previous, busy: false, error: errorText(reason) }));
      });
  };

  return (
    <XsShijiSettingsSection
      state={state}
      actions={{
        onDraftDirChange: (value) => {
          setState((previous) => ({ ...previous, draftDir: value, error: undefined }));
        },
        onAddExcludedDir: () => {
          const dir = state.draftDir.trim();
          if (dir === '') {
            setState((previous) => ({ ...previous, error: '排除目录不能为空。' }));
            return;
          }
          if (state.excludedDirs.includes(dir)) {
            setState((previous) => ({ ...previous, error: `「${dir}」已经在列表里了。` }));
            return;
          }
          writeExcludedDirs([...state.excludedDirs, dir], `已排除目录「${dir}」。`);
        },
        onRemoveExcludedDir: (dir) => {
          writeExcludedDirs(state.excludedDirs.filter((entry) => entry !== dir), `已取消排除「${dir}」。`);
        },
        onRestore: (id) => {
          setState((previous) => ({ ...previous, busy: true, error: undefined, note: undefined }));
          void api
            .restore({ id })
            .then(() => {
              setState((previous) => ({ ...previous, busy: false }));
              load();
              setState((previous) => ({ ...previous, note: '已恢复这条事记：下一轮扫描会按在场源头重新出现。' }));
            })
            .catch((reason: unknown) => {
              setState((previous) => ({ ...previous, busy: false, error: errorText(reason) }));
            });
        },
      }}
    />
  );
}

/**
 * 注册「设置 → 事记」分区（**纯加性**：不新增 main key / 侧栏行，apply 期不发请求）。
 * @param ctx - 客户端上下文（需 `slots`）。
 * @param deps - 事记数据面。
 */
export function installShijiSettings(ctx: Context, deps: { api: ShijiApi }): void {
  installShijiStyle();
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: SHIJI_SETTINGS_ID,
        order: SHIJI_SETTINGS_ORDER,
        label: SHIJI_SETTINGS_LABEL,
        inject: () => ({ api: deps.api }),
      },
      ShijiSettingsHost as never,
    ),
  );
}

/**
 * 入口条的样式（token 走票 03 覆盖过的 `--xs-*`，不写死配色）。
 * 与 `sediment-views.tsx` 同款守卫：Node 里执行时安静跳过。
 */
function installShijiStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('xs-shiji-style') !== null) return;
  const style = document.createElement('style');
  style.id = 'xs-shiji-style';
  style.textContent = `
.xs-shiji__entry{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0}
.xs-shiji__entry button{font:inherit}
.xs-shiji__note{font-size:.8rem;color:var(--xs-text-secondary);line-height:1.6}
.xs-shiji__confirm{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:8px 10px;margin:6px 0;flex-basis:100%}
.xs-shiji__confirm p{margin:0 0 6px}
.xs-shiji__actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.xs-shiji__actions button{font:inherit;padding:6px 12px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-shiji__actions button:disabled{opacity:.5;cursor:not-allowed}
.xs-btn--primary{background:var(--xs-constraint-human-gate-bg,var(--xs-accent));border-color:var(--xs-accent);color:var(--xs-constraint-human-gate-fg,var(--xs-accent-fg))}
.xs-shiji__notice,.xs-shiji__error{flex-basis:100%;font-size:.85rem;margin:4px 0;padding:8px 10px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-shiji__settings h2{margin:0 0 6px}
.xs-shiji__settings h3{margin:14px 0 4px;font-size:.95rem}
.xs-shiji__block{border-top:1px solid var(--xs-edge-card);margin-top:12px;padding-top:8px}
.xs-shiji__list{list-style:none;margin:6px 0;padding:0;display:flex;flex-direction:column;gap:6px}
.xs-shiji__row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.xs-shiji__row button{font:inherit;padding:4px 10px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-shiji__row button:disabled{opacity:.5;cursor:not-allowed}
.xs-shiji__settings input[type="text"]{font:inherit;margin-left:6px;padding:4px 8px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);background:var(--xs-surface-card);color:inherit}
.xs-shiji__error{color:var(--xs-text-secondary)}
`;
  document.head.appendChild(style);
}
