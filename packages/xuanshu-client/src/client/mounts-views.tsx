/**
 * packages/xuanshu-client/src/client/mounts-views.tsx — 票 12 的**受控视图**（S8 全屏账本）。
 *
 * 一条纪律：视图**只渲染 props**，不取数、不算账（判据在 `mounts-model.ts`，取数在 `mounts.tsx`）。
 * 于是「三档 Tag 缺一不可」「状态栏文案」「预算未知」「工作流空态」这些都能在 Node 里
 * 用 `renderToStaticMarkup` 逐条断言（本仓库没有 jsdom，见票 10 的视图断言台）。
 *
 * 组件树（S8 §7）：
 *   `XsMountDrawer`（抽屉）
 *     ├─ ① 边界句（对象是工作区/工作流，谱不在这里）
 *     ├─ ② 工作区分区（只读引用：标题 + path + 文件数/最近改动；选入即挂载）
 *     ├─ ③ 工作流分区（空态 + 理由：数据源属票 16）
 *     ├─ ④ 本轮挂载上下文（预览）：逐层 Tag + 保留/裁掉两行 + H2 折叠记忆
 *     └─ ⑤ 状态栏 `挂载 N 字 / 预算 M 字` + [取消] / [确认挂载到本轮]
 *   `XsMountStatusBar`（常驻锚点：门厅 + 会话面板同一口径）
 *   `XsMountSection`（门厅的挂载区：已挂清单 + 打开抽屉）
 */
import { useState } from 'react';
import type { MountRef, WorkspaceCandidate } from './mounts-api.js';
import type { LayerRow } from './mounts-model.js';
import {
  BUDGET_UNKNOWN_NOTE,
  MOUNT_BOUNDARY_LINE,
  MOUNT_CANCEL_LABEL,
  MOUNT_CONFIRM_LABEL,
  MOUNT_DRAWER_TITLE,
  WORKFLOW_EMPTY_NOTE,
  WORKSPACE_EMPTY_NOTE,
  WORKSPACE_UNAVAILABLE_NOTE,
  formatChars,
  isMounted,
  layerRows,
  mountsSummary,
  statusLine,
  type MountStatus,
} from './mounts-model.js';

/**
 * 状态栏：`挂载 N 字 / 预算 M 字` 的**读数**（C7⑤ 要它常驻，门厅与会话面板同一口径）。
 *
 * 它不是门（#69 / 判据 N-001）：从前它带 `onOpen`，点一下就地重开同一个抽屉 —— 门厅里于是有
 * 「临时挂载…」和它两扇门指同一个动作，用户要在两个地方决定点哪个。现在门只留给「临时挂载…」，
 * 这里退回纯读数：数字照旧常驻、`title` 照旧解释来源，只是不再可点。
 */
export function XsMountStatusBar({ status, budgetSource, hint }: {
  status?: MountStatus;
  budgetSource?: 'config' | 'model-window' | 'unknown';
  /** 还没读过预览时的说明（S8 loading 态：预算先显示，字数待算）。 */
  hint?: string;
}) {
  const text = status === undefined ? (hint ?? '挂载 … 字 / 预算 …') : statusLine(status);
  return (
    <span
      className="xs-mounts__status"
      data-xuanshu-mount-status="1"
      data-xuanshu-budget-unknown={status?.budget === null ? '1' : '0'}
      title={status?.budget === null ? BUDGET_UNKNOWN_NOTE : `本次挂载的裁剪结果（来源：${budgetSource ?? 'unknown'}）`}
    >
      {text}
    </span>
  );
}

/** 门厅的挂载区（S8 §1：`consult` 面板的挂载入口同样开这一个抽屉）。 */
export function XsMountSection({ mounts, status, canMount, reason, revision, onOpen }: {
  mounts: readonly MountRef[];
  status?: MountStatus;
  /** 有会话才能挂（挂载落在会话的旁挂清单上）：没有会话时给 `false` + 理由。 */
  canMount: boolean;
  reason?: string;
  /** 写入计数（每次「确认挂载到本轮」+1）：门厅据此重读会话，也是断言它能刷新的锚点。 */
  revision?: number;
  onOpen?: () => void;
}) {
  return (
    <section className="xs-mounts__section" data-xuanshu-section="mounts" data-xuanshu-mounts-revision={revision === undefined ? undefined : String(revision)}>
      <header className="xs-mounts__section-head">
        <h3>临时挂载</h3>
        <button type="button" className="xs-mounts__open" data-xuanshu-action="open-mounts" onClick={onOpen} disabled={!canMount || onOpen === undefined}>
          临时挂载…
        </button>
      </header>
      <p className="xs-mounts__summary" data-xuanshu-mount-summary="1">{mountsSummary(mounts)}</p>
      {canMount ? null : <p className="xs-mounts__note" data-xuanshu-note="mounts-need-session">{reason ?? '先生成一次问事，再临时挂载：挂载落在那次问事的清单上。'}</p>}
      {/* 门只有上面那一扇「临时挂载…」：状态栏只报账（#69 / N-001，见 `XsMountStatusBar` 的注释）。 */}
      <XsMountStatusBar status={status} hint={canMount ? undefined : '挂载 0 字 / 预算 …'} />
    </section>
  );
}

/** 工作区候选行（只读引用：标题 + path + 会话数 + 最近改动）。 */
function WorkspaceRow({ candidate, selected, onToggle }: { candidate: WorkspaceCandidate; selected: boolean; onToggle: () => void }) {
  const when = candidate.updatedAt === '' ? '' : candidate.updatedAt.slice(0, 10);
  return (
    <li className="xs-mounts__row" data-xuanshu-mount-row={`workspace:${candidate.id}`}>
      <label>
        <input type="checkbox" checked={selected} onChange={onToggle} data-xuanshu-mount-check={candidate.id} />
        <span className="xs-mounts__row-title">{candidate.title}</span>
        <span className="xs-mounts__row-path">{candidate.path}</span>
        <span className="xs-mounts__row-meta">{`${String(candidate.sessionCount)} 个会话${when === '' ? '' : ` · 最近 ${when}`}`}</span>
      </label>
    </li>
  );
}

/** 预览区的逐层行：Tag 三档 + 保留/裁掉两行（H2：手动收起过的保持收起）。 */
function LayerRowView({ row, open, onToggle }: { row: LayerRow; open: boolean; onToggle: () => void }) {
  return (
    <li className="xs-mounts__layer" data-xuanshu-layer={row.layer.label} data-xuanshu-layer-tone={row.tag.tone}>
      <div className="xs-mounts__layer-head">
        <button type="button" className="xs-mounts__layer-toggle" aria-expanded={open} onClick={onToggle} data-xuanshu-action="fold-layer">
          {open ? '▾' : '▸'}
        </button>
        <span className="xs-mounts__layer-name">{row.layer.head ?? row.layer.label}</span>
        <span className="xs-mounts__tag" data-xuanshu-tag={row.tag.tone}>{row.tag.text}</span>
      </div>
      {row.note === undefined ? null : <p className="xs-mounts__layer-note" data-xuanshu-layer-note="1">{row.note}</p>}
      {open && row.keptLabels.length > 0 ? (
        <p className="xs-mounts__layer-kept" data-xuanshu-layer-kept="1">{`保留了：${row.keptLabels.join(' · ')}（${formatChars(row.layer.keptChars)} 字）`}</p>
      ) : null}
      {open && row.droppedLabels.length > 0 ? (
        <p className="xs-mounts__layer-dropped" data-xuanshu-layer-dropped="1">
          {`裁掉的：${row.droppedLabels.slice(0, 6).join(' · ')}`}
          {row.droppedLabels.length > 6 ? ` 等 ${String(row.droppedLabels.length)} 项` : ''}
        </p>
      ) : null}
    </li>
  );
}

/**
 * 抽屉本体（受控）。
 *
 * 状态只有「当前选择」与「折叠记忆」是本地的 —— 其余（候选、预览、忙碌、错误）都由外面传进来，
 * 于是同一个抽屉既能给门厅用，也能给会话面板用（S8 §1 的两个入口）。
 */
export function XsMountDrawer({
  workspaces,
  workspaceAvailable,
  selection,
  preview,
  rows,
  budgetSource,
  busy,
  error,
  canConfirm,
  foldOpen,
  onToggleWorkspace,
  onFold,
  onCancel,
  onConfirm,
  onRetry,
  onRefresh,
  gotoWorkspaces,
}: {
  workspaces: readonly WorkspaceCandidate[];
  workspaceAvailable: boolean;
  selection: readonly MountRef[];
  preview?: { budget: number | null; totalChars: number; keptChars: number; truncatedChars: number; keptLayers: number; totalLayers: number; notice: string; notes: string[] } | undefined;
  rows: readonly LayerRow[];
  budgetSource?: 'config' | 'model-window' | 'unknown';
  busy: boolean;
  error?: string;
  canConfirm: boolean;
  /** 每层是否展开（由 H2 状态给）。 */
  foldOpen: (layerId: string) => boolean;
  onToggleWorkspace: (candidate: WorkspaceCandidate) => void;
  onFold: (layerId: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry?: () => void;
  onRefresh?: () => void;
  gotoWorkspaces?: () => void;
}) {
  const [showAllNotes, setShowAllNotes] = useState(false);
  const status: MountStatus | undefined = preview === undefined
    ? undefined
    : {
        keptChars: preview.keptChars,
        budget: preview.budget,
        keptLayers: preview.keptLayers,
        totalLayers: preview.totalLayers,
        overBudget: preview.truncatedChars > 0,
      };
  return (
    <div className="xs-mounts__overlay" data-xuanshu-overlay="mounts">
      <div className="xs-mounts__drawer" role="dialog" aria-modal="true" aria-labelledby="xs-mounts-title" data-xuanshu-drawer="mounts">
        <header className="xs-mounts__head">
          <h2 id="xs-mounts-title">{MOUNT_DRAWER_TITLE}</h2>
          <button type="button" className="xs-mounts__close" onClick={onCancel} disabled={busy} data-xuanshu-action="close-mounts">关闭</button>
        </header>

        {/* ① 边界句：谱与挂载是两回事（C6③ 的一半） */}
        <p className="xs-mounts__boundary" data-xuanshu-boundary="1">{MOUNT_BOUNDARY_LINE}</p>

        {/* ② 工作区分区（只读引用；选入即挂载 —— 动词不用「勾选」） */}
        <section className="xs-mounts__group" data-xuanshu-group="workspace">
          <div className="xs-mounts__group-head">
            <h3>{'工作区（DSH 原有，只读引用）'}</h3>
            <button type="button" className="xs-mounts__ghost" onClick={gotoWorkspaces} data-xuanshu-action="goto-workspaces">去 DSH 工作区界面</button>
          </div>
          {!workspaceAvailable ? (
            <p className="xs-mounts__note" data-xuanshu-note="workspace-unavailable">{WORKSPACE_UNAVAILABLE_NOTE}</p>
          ) : workspaces.length === 0 ? (
            <p className="xs-mounts__note" data-xuanshu-note="workspace-empty">{WORKSPACE_EMPTY_NOTE}</p>
          ) : (
            <ul className="xs-mounts__rows">
              {workspaces.map((candidate) => (
                <WorkspaceRow
                  key={candidate.id}
                  candidate={candidate}
                  selected={isMounted(selection, { kind: 'workspace', id: candidate.id })}
                  onToggle={() => { onToggleWorkspace(candidate); }}
                />
              ))}
            </ul>
          )}
        </section>

        {/* ③ 工作流分区（数据源属票 16：空态 + 理由，不编造行） */}
        <section className="xs-mounts__group" data-xuanshu-group="workflow">
          <h3>工作流</h3>
          <p className="xs-mounts__note" data-xuanshu-note="workflow-empty">{WORKFLOW_EMPTY_NOTE}</p>
        </section>

        {/* ④ 本轮挂载上下文（预览） */}
        <section className="xs-mounts__group" data-xuanshu-group="preview">
          <h3>{'本轮挂载上下文（预览）'}</h3>
          {/* 错误态：先说人话（读不到），再给下一步（重试 / 换个工作区）；宿主原话附在后面（不吞错）。 */}
          {error === undefined ? null : (
            <p className="xs-mounts__error" data-xuanshu-error="mounts" role="alert">
              {`读不到本轮挂载的预览：${error}。请检查工作区是否还在，然后`}
              {onRetry === undefined ? null : <button type="button" className="xs-mounts__ghost" onClick={onRetry}>重试</button>}
              {'；还是不通就先回门厅、换个工作区再挂。'}
            </p>
          )}
          {busy && preview === undefined ? <p className="xs-mounts__note" data-xuanshu-note="mounts-loading">正在读挂载内容…</p> : null}
          {rows.length === 0 && !busy ? (
            <p className="xs-mounts__note" data-xuanshu-note="preview-empty">还没有挂载任何对象：选上面的工作区（选入即挂载），这里会逐层列出将被注入的内容。</p>
          ) : (
            <ul className="xs-mounts__layers">
              {rows.map((row) => (
                <LayerRowView key={row.layer.id} row={row} open={foldOpen(row.layer.id)} onToggle={() => { onFold(row.layer.id); }} />
              ))}
            </ul>
          )}
          {preview === undefined || preview.notes.length === 0 ? null : (
            <div className="xs-mounts__notes">
              {(showAllNotes ? preview.notes : preview.notes.slice(0, 1)).map((note) => (
                <p key={note} className="xs-mounts__note" data-xuanshu-note="clip-reason">{note}</p>
              ))}
              {preview.notes.length > 1 ? (
                <button type="button" className="xs-mounts__ghost" onClick={() => { setShowAllNotes((value) => !value); }} data-xuanshu-action="more-notes">
                  {showAllNotes ? '收起解释' : `为什么砍（${String(preview.notes.length)} 条）`}
                </button>
              ) : null}
              {preview.truncatedChars > 0 ? (
                <p className="xs-mounts__note" data-xuanshu-note="shrink-hint">{'超预算的处理：整层丢弃；不会静默截断，注入时也会在提示词里注明。想都带上就缩小挂载范围。'}</p>
              ) : null}
              {onRefresh === undefined ? null : <button type="button" className="xs-mounts__ghost" onClick={onRefresh} data-xuanshu-action="refresh-preview">重新读一遍</button>}
            </div>
          )}
        </section>

        {/* ⑤ 状态栏 + 动作条 */}
        <footer className="xs-mounts__foot">
          <XsMountStatusBar status={status} budgetSource={budgetSource} />
          <div className="xs-mounts__actions">
            <button type="button" onClick={onCancel} disabled={busy} data-xuanshu-action="cancel-mounts">{MOUNT_CANCEL_LABEL}</button>
            <button type="button" className="xs-mounts__primary" onClick={onConfirm} disabled={busy || !canConfirm} data-xuanshu-action="confirm-mounts">
              {MOUNT_CONFIRM_LABEL}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
