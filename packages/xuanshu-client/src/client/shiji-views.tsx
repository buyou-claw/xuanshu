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
import { useState } from 'react';

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
`;
  document.head.appendChild(style);
}
