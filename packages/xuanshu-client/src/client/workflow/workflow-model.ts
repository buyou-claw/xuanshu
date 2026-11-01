/**
 * 票 16 · 门厅面板的纯逻辑（可无 DOM 测；S12 §2【B】/ §5）。
 *
 * 这里只放「不改状态、可复现」的东西：列表怎么分成两段、导出按钮什么时候可点、文案常量。
 * 组件（`WorkflowPanel.tsx`）只负责把它们的结论画出来 —— 于是「不许静默覆盖」「人判定」
 * 这类规则可以在断言台里被直接钉住，而不必去点 DOM。
 */
import type { WorkflowItem } from './workflow-api.js';
import { momentOf } from '../panel.js';

/** 面板 id / 侧栏行（S12 §2【B】：两处同字符串）。 */
export const WORKFLOW_ID = 'workflow';
/** 侧栏文案。 */
export const WORKFLOW_LABEL = '工作流';
/** 侧栏段位（S12 §8：接在日课之后、管理入口之前）。 */
export const WORKFLOW_ORDER = 70;

/** 一句边界（S12 §2【B】⑤ / CONTEXT.md）：工作流不是谱。 */
export const WORKFLOW_BOUNDARY_NOTE = '工作流不是谱：它不会出现在谱列表里；它是可复用的 skill 与一次跑通过的会话。';
/** 产物落点说明（S12 §2【A】⑤：无需指定路径，只读展示）。 */
export const WORKFLOW_EXPORT_HINT = '导出一个 skill，落点由宿主决定：<DSH home>/skills/<工作流名>/SKILL.md（无需你指定路径）。';
/** 人判定的规则文案（S12 §2【A】④：本屏不显示通过 / 失败，也不给评分）。 */
export const WORKFLOW_HUMAN_JUDGE_NOTE = '跑没跑通由你判定 —— 玄枢不显示通过 / 失败，也不给评分。';
/** 范围外声明（S12 §1 与 ⑤ 两处明写）。 */
export const WORKFLOW_OUT_OF_SCOPE_NOTE = '「测试 / 反向优化 / 复用」的细流程不在本次范围。';
/** 数据落在本地（S12 §2【B】⑥ / C11）。 */
export const WORKFLOW_LOCAL_NOTE = '产物与会话都在本地：数据目录与 DSH 的 skills / sessions 目录，可整体拷走。';

/** 门厅两段（进行中 / 已导出）——按 `exportedAt` 有无切分，顺序保持宿主给的。 */
export function splitWorkflows(items: readonly WorkflowItem[] | undefined): { running: WorkflowItem[]; exported: WorkflowItem[] } {
  const running: WorkflowItem[] = [];
  const exported: WorkflowItem[] = [];
  for (const item of items ?? []) {
    if (typeof item?.exportedAt === 'string' && item.exportedAt !== '') exported.push(item);
    else running.push(item);
  }
  return { running, exported };
}

/** 导出表单的可提交判据：**没给正文或描述就不许点**（宿主也会拒，这里先拦一次给人看）。 */
export function exportBlockers(draft: { name?: string; description?: string; content?: string } | undefined): string[] {
  const blockers: string[] = [];
  const name = (draft?.name ?? '').trim();
  const description = (draft?.description ?? '').trim();
  const content = (draft?.content ?? '').trim();
  if (name === '') blockers.push('给这个工作流起一个名字（kebab-case，例如 weekly-industry-digest）。');
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) blockers.push('名字要 kebab-case：小写字母、数字、单连字符（中文名请另给一个英文名）。');
  if (description === '') blockers.push('写一句 description（DSH 把它当必填，缺了会忽略这个 skill）。');
  if (content === '') blockers.push('把会话里跑通的那套步骤写进正文。');
  return blockers;
}

/**
 * 列表项的一句话副标题（时间只做展示，缺了就说「未导出」而不是编一个时刻）。
 *
 * 2026-11-02 改：未导出的条目原来一律显示「进行中（等你判定）」。连点几次「创建工作流」
 * 就会出现好几条**名字和副标题都完全一样**的「未命名工作流」，用户没法分辨是哪一条。
 * `createdAt` 记录里本来就有（`listWorkflows` 甚至按它倒序），只是没暴露 —— 现在把它显示出来。
 */
export function workflowSubtitle(item: WorkflowItem): string {
  if (typeof item.exportedAt === 'string' && item.exportedAt !== '') return `已导出 · ${momentOf(item.exportedAt)}`;
  if (typeof item.createdAt === 'string' && item.createdAt !== '') return `进行中（等你判定）· ${momentOf(item.createdAt)} 建`;
  return '进行中（等你判定）';
}
