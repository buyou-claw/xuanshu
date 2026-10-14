/**
 * 票 16 · 工作流数据面（`/xuanshu` 通道上 `workflow.*` 三个方法的客户端面；契约 §4）。
 *
 * 契约 §4（冻结）：
 *   - `workflow.create`      ← `{ seed? }` → `{ sessionId, cwd }`（新会话，**seed 自动调 `/writing-skills`**）
 *   - `workflow.list`        ← `{}` → `{ items: [{ id, name, sessionId, exportedAt? }] }`
 *   - `workflow.exportSkill` ← `{ sessionId, name, description, content }` → `{ path, name }`
 *
 * **`exportedAt` 缺失即省略键**（不是回 `null`/空串）：界面因此把它读成「还没导出」，
 * 而不是「导出过但时间未知」—— 两种含义在门厅里是两条不同的列表。
 */
import { rpcCall } from '../rpc.js';
import type { RpcContext } from '../rpc.js';

/** 门厅列表的一条（`exportedAt` 只有导出过才有）。 */
export interface WorkflowItem {
  id: string;
  name: string;
  sessionId: string;
  exportedAt?: string;
}

/** `workflow.list` 的返回。 */
export interface WorkflowList {
  items: WorkflowItem[];
}

/** `workflow.create` 的返回（会话 id 与它的专用工作目录）。 */
export interface WorkflowCreateResult {
  sessionId: string;
  cwd: string;
}

/** `workflow.exportSkill` 的返回（落点与最终 kebab 名）。 */
export interface WorkflowExportResult {
  path: string;
  name: string;
}

/** 方法名（逐字对齐契约 §4；改这里等于改接口面）。 */
export const WORKFLOW_ENDPOINTS = {
  create: 'workflow.create',
  list: 'workflow.list',
  exportSkill: 'workflow.exportSkill',
} as const;

export interface WorkflowApi {
  /** **人点 `[创建工作流]` 才调**：建会话 + 种子调 `/writing-skills`。 */
  create(payload?: { seed?: string }, signal?: AbortSignal): Promise<WorkflowCreateResult>;
  /** 只读：门厅列表。 */
  list(signal?: AbortSignal): Promise<WorkflowList>;
  /** **人点 `[我认为跑通了 → 导出 skill]` 才调**：写 `<dshHome>/skills/<kebab>/SKILL.md`。 */
  exportSkill(payload: { sessionId: string; name: string; description: string; content: string }, signal?: AbortSignal): Promise<WorkflowExportResult>;
}

/**
 * 用连接上下文造一个工作流数据面。
 * @param ctx - 需要 `connection.rpc`（`dsh-client-connection` 提供）。
 */
export function createWorkflowApi(ctx: RpcContext): WorkflowApi {
  return {
    create: (payload, signal) => rpcCall<WorkflowCreateResult>(ctx, WORKFLOW_ENDPOINTS.create, payload ?? {}, signal),
    list: (signal) => rpcCall<WorkflowList>(ctx, WORKFLOW_ENDPOINTS.list, {}, signal),
    exportSkill: (payload, signal) => rpcCall<WorkflowExportResult>(ctx, WORKFLOW_ENDPOINTS.exportSkill, payload, signal),
  };
}
