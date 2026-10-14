/**
 * packages/xuanshu-client/src/client/mounts-model.ts — 票 12 的纯模型（S8 的文案与三档 Tag）。
 *
 * 全是纯函数 / 纯状态，没有任何 React、没有 RPC：界面只做渲染，判据全在这里可断言。
 *
 * S8 的硬要求落在这一层：
 *   - **三档 Tag 缺一不可**（C7①）：`纳入` / `已裁剪 raw→kept 字` / `超预算未纳入`，
 *     且 `dropped` 与 `clipped` 互斥（宿主已经保证，这里再兜一层）；
 *   - **状态栏** `挂载 N 字 / 预算 M 字`（超预算时补「已纳入 N / M 层」），
 *     预算未知时写 `预算未知` —— **不编数**（C7⑤ / §6 error③）；
 *   - **H2 折叠记忆**：新出现的层默认展开、用户手动收起过的保持收起（**按层**记忆，不整块重置）；
 *   - **边界句**：抽屉顶部常驻「对象是工作区 / 工作流。谱不在这里——谱在问事面板里勾选」（C6③）。
 */

import type { MountLayerPreview, MountPreview, MountRef, WorkspaceCandidate } from './mounts-api.js';

/** 边界的机器判据（逐字断言）：谱与挂载是两回事，两处各带一句。 */
export const MOUNT_BOUNDARY_LINE = '对象是工作区 / 工作流。谱不在这里——谱在问事面板里勾选。';

/** 抽屉标题与入口文案。 */
export const MOUNT_DRAWER_TITLE = '临时挂载';
export const MOUNT_CONFIRM_LABEL = '确认挂载到本轮';
export const MOUNT_CANCEL_LABEL = '取消';

/** 挂载对象的唯一键（`kind` 不同就是两回事：同名的工作区与工作流互不影响）。 */
export function mountKey(mount: Pick<MountRef, 'kind' | 'id'>): string {
  return `${mount.kind}\u0000${mount.id}`;
}

/** 选入 / 移出本轮（动词是「挂载 / 移出」，不是「勾选」——C6③ 的措辞约束）。 */
export function toggleMount(selection: readonly MountRef[], mount: MountRef): MountRef[] {
  const key = mountKey(mount);
  const exists = selection.some((row) => mountKey(row) === key);
  if (exists) return selection.filter((row) => mountKey(row) !== key);
  return [...selection, mount];
}

/** 是否已在本轮里。 */
export function isMounted(selection: readonly MountRef[], mount: Pick<MountRef, 'kind' | 'id'>): boolean {
  const key = mountKey(mount);
  return selection.some((row) => mountKey(row) === key);
}

/** 候选行 → `MountRef`（label 取工作区标题；标题空就用 path）。 */
export function toMountRef(candidate: WorkspaceCandidate): MountRef {
  return { kind: 'workspace', id: candidate.id, label: candidate.title !== '' ? candidate.title : candidate.path };
}

/** 千分位（`8420` → `8,420`；披露与状态栏都用它，别两处各写一种格式）。 */
export function formatChars(value: number): string {
  return String(Math.max(0, Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

/** 三档 Tag（外加读不出来一档，S8 §6 error①）。 */
export type LayerTagTone = 'included' | 'clipped' | 'dropped' | 'error';

/** 一枚 Tag：`{tone, text}` —— 文案逐字来自 S8 §2.1④ / §2.2 / §2.3。 */
export function layerTag(layer: MountLayerPreview): { tone: LayerTagTone; text: string } {
  if (typeof layer.error === 'string' && layer.error !== '') return { tone: 'error', text: '读不出来' };
  // 互斥再兜一层：丢了就不叫裁，裁了就不是丢（宿主已经保证，界面别自相矛盾）。
  // 两份数据自相矛盾时「整层丢弃」是更重的结论 —— 亮它，免得把没进上下文的层说成「已裁剪」。
  if (layer.dropped) return { tone: 'dropped', text: '超预算未纳入' };
  if (layer.clipped) return { tone: 'clipped', text: `已裁剪 ${formatChars(layer.chars)}→${formatChars(layer.keptChars)} 字` };
  if (layer.kept) return { tone: 'included', text: '纳入' };
  return { tone: 'dropped', text: '超预算未纳入' };
}

/** 层的补充说明行（`超预算未纳入 · 本次不会进入上下文` / 读不出来的原因）。 */
export function layerNote(layer: MountLayerPreview): string | undefined {
  if (typeof layer.error === 'string' && layer.error !== '') return layer.error;
  if (layer.dropped) return layer.reason ?? '超预算未纳入 · 本次不会进入上下文';
  if (typeof layer.hint === 'string' && layer.hint !== '') return layer.hint;
  return undefined;
}

/** 状态栏的数字口径（S8 §2.1⑤ / §2.2③）。 */
export interface MountStatus {
  /** `挂载 N 字` 里的 N（= 已纳入的字数）。 */
  keptChars: number;
  /** `预算 M 字` 里的 M；`null` = 未知（界面写「预算未知」，不编数）。 */
  budget: number | null;
  keptLayers: number;
  totalLayers: number;
  /** 是否超预算（超了才补「已纳入 N / M 层」）。 */
  overBudget: boolean;
}

/** 从预览算状态栏。`preview` 缺席（还没读过）→ `undefined`（界面显示读取中）。 */
export function statusFromPreview(preview: MountPreview | undefined): MountStatus | undefined {
  if (preview === undefined) return undefined;
  const keptChars = Number.isFinite(preview.keptChars) ? preview.keptChars : 0;
  const budget = preview.budget === null || preview.budget === undefined ? null : preview.budget;
  return {
    keptChars,
    budget,
    keptLayers: preview.keptLayers,
    totalLayers: preview.totalLayers,
    overBudget: preview.truncatedChars > 0,
  };
}

/**
 * 状态栏文案（逐字断言的对象）：
 * - 正常：`挂载 9,600 字 / 预算 60,000 字`
 * - 超预算：`挂载 8,420 字 / 预算 60,000 字（已纳入 1 / 3 层）`
 * - 预算未知：`挂载 9,600 字 / 预算未知`
 */
export function statusLine(status: MountStatus): string {
  const left = `挂载 ${formatChars(status.keptChars)} 字`;
  const right = status.budget === null ? '预算未知' : `预算 ${formatChars(status.budget)} 字`;
  const denominator = status.overBudget ? `（已纳入 ${status.keptLayers} / ${status.totalLayers} 层）` : '';
  return `${left} / ${right}${denominator}`;
}

/** 预算未知时的解释 + 出路（S8 §6 error③：不假装有预算）。 */
export const BUDGET_UNKNOWN_NOTE = '预算未知：拿不到当前模型的上下文窗口元数据。去 DSH 设置看模型配置（本机 rc.2 的采样参数 maxTokens 不是窗口，玄枢不会替你编一个数）。';

/** 工作流分区的空态（数据源属票 16：如实说「还没接上」，不编造行）。 */
export const WORKFLOW_EMPTY_NOTE = '工作流清单的数据源属票 16（工作流创建向导）：现在还没有可挂载的工作流，先去把工作流建出来。';

/** 工作区分区空态。 */
export const WORKSPACE_EMPTY_NOTE = 'DSH 里还没有工作区：工作区是 DSH 原有的实体，先去 DSH 的工作区界面建一个（本抽屉不提供新建入口）。';

/** 工作区面不可用（裁剪过的 profile）。 */
export const WORKSPACE_UNAVAILABLE_NOTE = '这个 profile 没有客户端工作区面（ctx.workspaces）：工作区清单读不出来，挂载功能暂时不可用。';

/**
 * H2 折叠记忆：**按层**记住「用户手动收起过」的那些层；新出现的层默认展开。
 *
 * 为什么不是「整块重置」：重开抽屉或新增一层时把用户刚收起的层又展开，等于没记住 ——
 * S8 §6.2 H2 明说按层记忆。这里是个不依赖 React 的小状态，可单独断言。
 */
export function createLayerFoldState() {
  const collapsed = new Set<string>();
  return {
    /** 用户手点：展开 ↔ 收起。 */
    toggle(layerId: string): void {
      if (collapsed.has(layerId)) collapsed.delete(layerId);
      else collapsed.add(layerId);
    },
    /** 这一层现在是否展开（**新层默认展开**：不在「收起过」集合里就展开）。 */
    isOpen(layerId: string): boolean {
      return !collapsed.has(layerId);
    },
    /** 已收起过的层 id（调试/断言用）。 */
    collapsedIds(): string[] {
      return [...collapsed].sort();
    },
  };
}

/** 折叠记忆的形状（`mounts-controller.ts` 的快照里挂着一份）。 */
export type LayerFoldState = ReturnType<typeof createLayerFoldState>;

/** 一层在预览区里的行（界面直接渲染它，不用在视图里再算一遍）。 */
export interface LayerRow {
  layer: MountLayerPreview;
  tag: { tone: LayerTagTone; text: string };
  note?: string;
  keptLabels: string[];
  droppedLabels: string[];
}

/** 预览 → 渲染行（顺序就是挂载顺序：用户刚挂的那一层不会跑到别处）。 */
export function layerRows(preview: MountPreview | undefined): LayerRow[] {
  if (preview === undefined) return [];
  return preview.layers.map((layer) => ({
    layer,
    tag: layerTag(layer),
    ...(layerNote(layer) === undefined ? {} : { note: layerNote(layer) }),
    keptLabels: layer.keptSegments.map((segment) => segment.label),
    droppedLabels: layer.droppedSegments.map((segment) => segment.label),
  }));
}

/** 已挂对象的一句话摘要（门厅的挂载区用）。 */
export function mountsSummary(mounts: readonly MountRef[]): string {
  if (mounts.length === 0) return '本次没有临时挂载（只带底座、底稿与勾选的谱）。';
  const workspaces = mounts.filter((mount) => mount.kind === 'workspace').length;
  const workflows = mounts.length - workspaces;
  const parts: string[] = [];
  if (workspaces > 0) parts.push(`${String(workspaces)} 个工作区`);
  if (workflows > 0) parts.push(`${String(workflows)} 个工作流`);
  return `本次临时挂载：${parts.join(' + ')}（${mounts.map((mount) => mount.label).join('、')}）。`;
}
