/**
 * packages/xuanshu-host/lib/notify/service.mjs — 触达账 / 共享设置的 RPC 面（#24 建、#25 扩）。
 *
 * 挂在现有 `/xuanshu` 通道上（`lib/rpc.mjs`），六个方法：
 *   - `traffic.status({limit?})`  → `{entries[最新在前], unread, lastFailure?}`
 *   - `traffic.markRead({ids})`   → `{ok:true, updated}`
 *   - `traffic.settings.get()`    → `{notifySummary}`
 *   - `traffic.settings.set({notifySummary})` → `{notifySummary}`
 *   - `shell.settings.get()`      → `{closeBehavior, autostart, notifySummary}`（契约 §5 点名的宿主半边）
 *   - `shell.settings.set({...})` → 改完回读后的完整设置
 *
 * 加性纪律（与 `rikke/service.mjs:16-18` 同款）：**拿不到就省略键**，不写 false/0 冒充已读。
 * `traffic.status` 的 `lastFailure` 只在账里真有 failed 时才出现。
 */

import { resolveDataDir } from '../bazi/service.mjs'
import { readShellSettings, writeShellSettings } from './settings.mjs'
import { markTrafficRead, readTraffic } from './traffic.mjs'

/** 请求对象兜底（非对象一律当空请求）。 */
function requestOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * 建触达环的方法组。
 * @param {object} ctx cordis 宿主上下文（裸 `{}` 也要活）
 * @param {{dataDir?: string}} [config] 数据目录（缺省按 DSH_HOME 推导，与 `rikke.*` 同源）
 * @returns {Record<string, Function>} 六个方法
 */
export function createTrafficMethods(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)

  return {
    /** 账本读面（最新在前）。`unread` 按全账算：badge 不能用被截断的那一页算。 */
    'traffic.status': async (request) => {
      const source = requestOf(request)
      const ledger = readTraffic(dataDir, { limit: source.limit })
      const out = { entries: ledger.entries, unread: ledger.unread }
      if (ledger.lastFailure !== undefined) out.lastFailure = ledger.lastFailure
      return out
    },

    /** 标已读（只改 `read`；失败**抛**，RPC 层折成 `{ok:false,error}`）。 */
    'traffic.markRead': async (request) => markTrafficRead(dataDir, requestOf(request).ids),

    /** 触达设置：通知摘要 + #25 的两个计划时刻（缺失 = 宿主缺省值）。 */
    'traffic.settings.get': async () => {
      const settings = readShellSettings(dataDir)
      return { notifySummary: settings.notifySummary, rikkeTime: settings.rikkeTime, wanshengTime: settings.wanshengTime }
    },

    /**
     * 改触达设置（部分更新）：`notifySummary` / `rikkeTime` / `wanshengTime` 三选一以上；
     * 交给 `writeShellSettings` 校验 + 写后回读，非法值**抛**（写操作不许静默）。
     * 时刻只是「期望值」：实际生效的权威是 `ctx.schedule` 里那条任务（改它走 `rikke.setTime` / `wansheng.setTime`）。
     */
    'traffic.settings.set': async (request) => {
      const source = requestOf(request)
      const keys = ['notifySummary', 'rikkeTime', 'wanshengTime']
      const patch = {}
      for (const key of keys) {
        if (Object.hasOwn(source, key)) patch[key] = source[key]
      }
      if (Object.keys(patch).length === 0) {
        throw new Error('traffic.settings.set 要 notifySummary / rikkeTime / wanshengTime 之一')
      }
      const saved = writeShellSettings(dataDir, patch)
      return { notifySummary: saved.notifySummary, rikkeTime: saved.rikkeTime, wanshengTime: saved.wanshengTime }
    },

    /** 契约 §5 点名的宿主半边（壳读同一份文件；这里给宿主一个可测的读写面）。 */
    'shell.settings.get': async () => readShellSettings(dataDir),
    'shell.settings.set': async (request) => writeShellSettings(dataDir, requestOf(request)),
  }
}
