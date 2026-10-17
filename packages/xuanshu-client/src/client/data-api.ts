/**
 * 票 30（#30）· 「我的数据」的数据面（客户端 RPC 面）。
 *
 * 方法名逐字对应宿主 `packages/xuanshu-host/lib/data/service.mjs`（`data.overview` /
 * `data.backup`）—— 名字在这里是**接口面**，改一边不会在编译期报错，只会静默不匹配。
 *
 * 选目录**复用藏库的系统选择器**：宿主方法 `cang.pickDirectory` 是同一台机器上唯一一条
 * 「原生目录选择器」路径（`lib/cang/service.mjs` 调宿主 `directoryPicker` 服务）。
 * 本页不新造第二条原生对话框，否则会出现「两套选目录体验，其中一套没有系统目录」。
 *
 * 备份是**异步 RPC**：`data.backup` 在宿主侧是一段可能很长的文件复制，界面用 busy 态
 * + 阶段文案表达「还在跑」，不阻塞渲染（这里返回 Promise，组件不 await 在渲染路径上）。
 */

import { rpcCall } from './rpc.js'
import type { RpcContext } from './rpc.js'

/** 端点名（契约 §1 / §2 的原文；`pickDirectory` 是藏库既有能力）。 */
export const DATA_ENDPOINTS = {
  overview: 'data.overview',
  backup: 'data.backup',
  pickDirectory: 'cang.pickDirectory',
} as const

/** 一个数据分类（宿主 `data.overview` 的 groups 项）。 */
export interface DataGroup {
  id: string
  label: string
  path: string
  bytes: number
  files: number
}

/** 排除项：为什么这份数据不计体积 / 不进备份。 */
export interface DataExcluded {
  path: string
  reason: string
}

/** `data.overview()` 的回答（契约 §1 的形状）。 */
export interface DataOverview {
  schema: string
  home: string
  dataDir: string
  groups: DataGroup[]
  total: { bytes: number; files: number }
  excluded: DataExcluded[]
  notes: string[]
}

/** 备份清单里的一项（每文件 sha256 + size，可逐项对账）。 */
export interface DataBackupItem {
  path: string
  sha256: string
  size: number
}

/** `manifest.json`（`xuanshu/backup@1`）的形状。 */
export interface DataBackupManifest {
  schema: string
  createdAt: string
  home: string
  dataDir: string
  files: number
  totalBytes: number
  items: DataBackupItem[]
  excluded: DataExcluded[]
  skipped: DataExcluded[]
  notes: string[]
}

/** 备份成功（宿主 `{ok:true, backupDir, manifest}`；`manifestPath` 是加性的便利字段）。 */
export interface DataBackupSuccess {
  ok: true
  backupDir: string
  manifestPath?: string
  manifest: DataBackupManifest
}

/** 备份失败：宿主返回可读原因，不抛到界面。 */
export interface DataBackupFailure {
  ok: false
  error: { code: string; message: string }
}

export type DataBackupResult = DataBackupSuccess | DataBackupFailure

/** 数据面的最小接口（组件与测试共用的注入面）。 */
export interface DataApi {
  overview(signal?: AbortSignal): Promise<DataOverview>
  backup(input: { targetDir: string; confirmed: true }): Promise<DataBackupResult>
  pickDirectory(): Promise<{ path: string }>
}

/**
 * 造数据面（apply 期不打任何请求；只有组件挂载后的 effect 与「一键备份」按钮会用）。
 * @param ctx - 带 `connection` 的客户端上下文。
 */
export function createDataApi(ctx: RpcContext): DataApi {
  return {
    overview: (signal) => rpcCall<DataOverview>(ctx, DATA_ENDPOINTS.overview, {}, signal),
    backup: (input) => rpcCall<DataBackupResult>(ctx, DATA_ENDPOINTS.backup, input),
    pickDirectory: () => rpcCall<{ path: string }>(ctx, DATA_ENDPOINTS.pickDirectory),
  }
}
