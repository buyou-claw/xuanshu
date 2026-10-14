/**
 * 票 16 · 工作流门厅面板（main key `workflow` + 侧栏行），S12 §2【B】。
 *
 * 门厅只做四件事（**不承载会话正文**，S12 §2【B】④）：
 *   1. `[创建工作流]` —— 人点 → `workflow.create`（新会话 + 种子自动调 `/writing-skills`）→ 切到会话；
 *   2. 进行中的工作流（每条 = 一个会话，`[打开会话]` 走同一条切换路径）；
 *   3. 已导出的工作流（一段只读说明 + 「去技能中心 / 复制产物路径」的下游指路）；
 *   4. 导出表单 —— **人点 `[我认为跑通了 → 导出 skill]` 才调 `workflow.exportSkill`**。
 *
 * 三条界面纪律（各自都能被断言台钉住）：
 *   - **人判定**：本面板不显示「通过 / 失败」，只有那句规则文案（`WORKFLOW_HUMAN_JUDGE_NOTE`）；
 *     导出按钮是最普通的一个按钮，点它之前界面上没有任何系统结论。
 *   - **不动默认面板**：apply 期**不调** `ctx.layout.selectPanel`（默认 `overview` 由根入口切一次；
 *     `verify-assembly` S3 会断言它恰一次）。
 *   - **加性注册**：只 `slots.inject('main')` + `slots.inject('sidebar.panellist')`，
 *     不碰 `root`、不声明 `children`、不给 DSH 既有 key 加 priority。
 *
 * 已知与设计稿的差距（明写在案）：S12 D5 把向导条 / 判定条放在**会话内**的
 * `conversation.input.dock`；本次把导出表单落在门厅（会话内坞位是另一处槽位面，见交接说明）。
 */
import { useEffect, useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';

import type { PanelNavTarget } from '../panel.js';
import type { RpcContext } from '../rpc.js';
import type { WorkflowApi, WorkflowItem } from './workflow-api.js';
import {
  WORKFLOW_BOUNDARY_NOTE, WORKFLOW_EXPORT_HINT, WORKFLOW_HUMAN_JUDGE_NOTE, WORKFLOW_ID, WORKFLOW_LABEL,
  WORKFLOW_LOCAL_NOTE, WORKFLOW_ORDER, WORKFLOW_OUT_OF_SCOPE_NOTE, exportBlockers, splitWorkflows, workflowSubtitle,
} from './workflow-model.js';

/** 门厅的取数状态（四态：loading / empty / ready / error）。 */
type WorkflowView =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready'; items: WorkflowItem[] }
  | { kind: 'error'; message: string };

/** 静态预置（测试 / SSR：给了就不发 `workflow.list`）。 */
export type WorkflowPreloaded = WorkflowItem[] | { error: string };

export interface WorkflowPanelProps {
  /** 数据面（`index.tsx` 用 `createWorkflowApi(ctx)` 造好注入）。 */
  api: WorkflowApi;
  /** 面板导航（`conversation` = 回会话那一屏）。 */
  navigate: (target: PanelNavTarget) => void;
  /** 静态预置（测试 / SSR）。 */
  preloaded?: WorkflowPreloaded;
}

/** 错误摘要（RPC 拒绝的 message 原样展示，不吞掉）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function initialView(preloaded: WorkflowPreloaded | undefined): WorkflowView {
  if (preloaded === undefined) return { kind: 'loading' };
  if (Array.isArray(preloaded)) return preloaded.length === 0 ? { kind: 'empty' } : { kind: 'ready', items: preloaded };
  return { kind: 'error', message: preloaded.error };
}

/**
 * 门厅面板。
 *
 * 注：effect 里**只允许** `workflow.list()` 这一件只读事 —— 创建与导出都必须由人点
 * （票面验收「人判定跑通」直译：没有系统的自动动作）。
 */
export function WorkflowPanel({ api, navigate, preloaded }: WorkflowPanelProps) {
  const seeded = preloaded !== undefined;
  const [view, setView] = useState<WorkflowView>(() => initialView(preloaded));
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState({ sessionId: '', name: '', description: '', content: '' });
  const [exportError, setExportError] = useState<string | undefined>(undefined);
  const [exported, setExported] = useState<{ path: string; name: string } | undefined>(undefined);

  useEffect(() => {
    if (seeded) return;
    let cancelled = false;
    void (async () => {
      try {
        const listed = await api.list();
        if (cancelled) return;
        setView(listed.items.length === 0 ? { kind: 'empty' } : { kind: 'ready', items: listed.items });
      } catch (error) {
        if (!cancelled) setView({ kind: 'error', message: errorText(error) });
      }
    })();
    return () => { cancelled = true; };
  }, [api, seeded]);

  /** 人点 `[创建工作流]`：建会话 → 进会话（向导本体在会话里）。 */
  const onCreate = (): void => {
    setBusy(true);
    setCreateError(undefined);
    void (async () => {
      try {
        const created = await api.create({ seed: draft.content.trim() === '' ? undefined : draft.content.trim() });
        setDraft((current) => ({ ...current, sessionId: created.sessionId }));
        navigate('conversation');
      } catch (error) {
        setCreateError(errorText(error));
      } finally {
        setBusy(false);
      }
    })();
  };

  const blockers = exportBlockers(draft);
  /** 人点 `[我认为跑通了 → 导出 skill]`：写盘 + 读回验证都在宿主。 */
  const onExport = (): void => {
    setBusy(true);
    setExportError(undefined);
    setExported(undefined);
    void (async () => {
      try {
        const result = await api.exportSkill({
          sessionId: draft.sessionId,
          name: draft.name.trim(),
          description: draft.description.trim(),
          content: draft.content.trim(),
        });
        setExported(result);
      } catch (error) {
        setExportError(errorText(error));
      } finally {
        setBusy(false);
      }
    })();
  };

  const { running, exported: exportedItems } = splitWorkflows(view.kind === 'ready' ? view.items : []);

  return (
    <section className="xs-workflow" aria-label={WORKFLOW_LABEL}>
      <header className="xs-workflow__head">
        <h1 className="xs-workflow__title">{WORKFLOW_LABEL}</h1>
        <button type="button" className="xs-workflow__create" onClick={onCreate} disabled={busy}>
          {busy ? '创建中…' : '创建工作流'}
        </button>
      </header>
      <p className="xs-workflow__note">{WORKFLOW_BOUNDARY_NOTE}</p>
      {createError !== undefined ? <p className="xs-workflow__error" role="alert">创建工作流失败：{createError}</p> : null}

      {view.kind === 'loading' ? <p className="xs-workflow__hint">正在读工作流列表…</p> : null}
      {view.kind === 'error' ? <p className="xs-workflow__error" role="alert">工作流列表读不出来：{view.message}</p> : null}
      {view.kind === 'empty' ? (
        <p className="xs-workflow__hint">还没有工作流：点上面的「创建工作流」说清要求，用会话里的 coding 工具真跑一遍，你觉得跑通了再来导出。</p>
      ) : null}

      {running.length > 0 ? (
        <div className="xs-workflow__group">
          <h2 className="xs-workflow__groupTitle">进行中</h2>
          <ul className="xs-workflow__list">
            {running.map((item) => (
              <li key={item.id} className="xs-workflow__item">
                <span className="xs-workflow__name">{item.name}</span>
                <span className="xs-workflow__sub">{workflowSubtitle(item)}</span>
                <button type="button" className="xs-workflow__open" onClick={() => { setDraft((current) => ({ ...current, sessionId: item.sessionId })); navigate('conversation'); }}>
                  打开会话
                </button>
                <button type="button" className="xs-workflow__pick" onClick={() => setDraft((current) => ({ ...current, sessionId: item.sessionId, name: current.name }))}>
                  选它导出
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="xs-workflow__group">
        <h2 className="xs-workflow__groupTitle">判定与导出</h2>
        <p className="xs-workflow__rule">{WORKFLOW_HUMAN_JUDGE_NOTE}</p>
        <p className="xs-workflow__hint">{WORKFLOW_EXPORT_HINT}</p>
        <label className="xs-workflow__field">
          <span>会话</span>
          <input value={draft.sessionId} onChange={(event) => setDraft((current) => ({ ...current, sessionId: event.target.value }))} placeholder="session-xs-workflow-…" />
        </label>
        <label className="xs-workflow__field">
          <span>名字</span>
          <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="weekly-industry-digest" />
        </label>
        <label className="xs-workflow__field">
          <span>description</span>
          <input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="一句话说清这个工作流做什么" />
        </label>
        <label className="xs-workflow__field">
          <span>正文</span>
          <textarea value={draft.content} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} rows={6} placeholder={'把会话里跑通的那套步骤写进来（SKILL.md 的正文）'} />
        </label>
        {blockers.length > 0 ? <ul className="xs-workflow__blockers">{blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
        <button type="button" className="xs-workflow__export" onClick={onExport} disabled={busy || blockers.length > 0}>
          我认为跑通了 → 导出 skill
        </button>
        {exportError !== undefined ? <p className="xs-workflow__error" role="alert">导出失败：{exportError}</p> : null}
        {exported !== undefined ? (
          <p className="xs-workflow__done">
            已导出 <code>{exported.name}</code> → <code>{exported.path}</code>（在 DSH 技能中心里可见，来源 user-dsh）
          </p>
        ) : null}
      </div>

      {exportedItems.length > 0 ? (
        <div className="xs-workflow__group">
          <h2 className="xs-workflow__groupTitle">已导出</h2>
          <ul className="xs-workflow__list">
            {exportedItems.map((item) => (
              <li key={item.id} className="xs-workflow__item">
                <span className="xs-workflow__name">{item.name}</span>
                <span className="xs-workflow__sub">{workflowSubtitle(item)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="xs-workflow__note">{WORKFLOW_OUT_OF_SCOPE_NOTE}</p>
      <p className="xs-workflow__note">{WORKFLOW_LOCAL_NOTE}</p>
    </section>
  );
}

/** 侧栏图标（与其它面板同款线性风格）。 */
function WorkflowIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="4" width="7" height="6" rx="1.5" />
      <rect x="13.5" y="14" width="7" height="6" rx="1.5" />
      <path d="M7 10v4a3 3 0 0 0 3 3h3.5" />
    </svg>
  );
}

/** 样式（非 DOM 环境安全返回；与其它面板同款「样式随 JS 走」）。 */
export function installWorkflowStyle(): void {
  if (typeof document === 'undefined') return;
  const id = 'xuanshu-workflow-style';
  if (document.getElementById(id) !== null) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = [
    '.xs-workflow{padding:20px 24px;color:var(--dsh-text-primary,inherit);font:inherit}',
    '.xs-workflow__head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
    '.xs-workflow__title{margin:0;font-size:18px}',
    '.xs-workflow__note,.xs-workflow__hint,.xs-workflow__rule{margin:8px 0;opacity:.8;font-size:13px}',
    '.xs-workflow__error{color:var(--dsh-danger,#c33)}',
    '.xs-workflow__group{margin-top:18px;border-top:1px solid var(--dsh-border,#0002);padding-top:12px}',
    '.xs-workflow__groupTitle{margin:0 0 8px;font-size:14px;opacity:.85}',
    '.xs-workflow__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
    '.xs-workflow__item{display:flex;align-items:center;gap:10px}',
    '.xs-workflow__sub{opacity:.7;font-size:12px}',
    '.xs-workflow__field{display:flex;gap:8px;align-items:center;margin:6px 0}',
    '.xs-workflow__field input,.xs-workflow__field textarea{flex:1}',
    '.xs-workflow__blockers{margin:6px 0;padding-left:18px;font-size:12px;opacity:.85}',
    '.xs-workflow__done{margin:8px 0;font-size:13px}',
  ].join('\n');
  document.head.appendChild(style);
}

/** 门厅面板安装所需的依赖（由 `index.tsx` 造好）。 */
export interface WorkflowInstallDeps {
  api: WorkflowApi;
  navigate: (target: PanelNavTarget) => void;
}

/**
 * 门厅面板的**加性**注册（main key `workflow` + 侧栏行 `workflow`）。
 *
 * @param ctx - 客户端上下文（需 `slots`）。
 * @param deps - 数据面与导航。
 */
export function installWorkflowPanel(ctx: Context & RpcContext, deps: WorkflowInstallDeps): void {
  installWorkflowStyle();
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      { name: 'main', key: WORKFLOW_ID, inject: () => ({ ...deps }) },
      WorkflowPanel as never,
    ),
  );
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: WORKFLOW_ID, order: WORKFLOW_ORDER, label: WORKFLOW_LABEL },
      WorkflowIcon as never,
    ),
  );
}
