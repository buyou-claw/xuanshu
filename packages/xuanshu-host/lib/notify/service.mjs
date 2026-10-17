/**
 * packages/xuanshu-host/lib/notify/service.mjs — 触达账 / 共享设置的 RPC 面（#24 建、#25 扩）。
 *
 * 挂在现有 `/xuanshu` 通道上（`lib/rpc.mjs`），六个方法：
 *   - `traffic.status({limit?})`  → `{entries[最新在前], unread, lastFailure?}`
 *   - `traffic.markRead({ids})`   → `{ok:true, updated}`
 *   - `traffic.settings.get()`    → `{notifySummary}`
 *   - `traffic.settings.set({notifySummary})` → `{notifySummary}`
 *   - `shell.settings.get()`      → `{settings, effective?}`（契约 §5 点名的宿主半边；
 *     `effective` 只在壳在跑时出现 —— P1 复核 #23 的加性扩展）
 *   - `shell.settings.set({...})` → `{settings}`（改完回读；写失败抛）
 *
 * 加性纪律（与 `rikke/service.mjs:16-18` 同款）：**拿不到就省略键**，不写 false/0 冒充已读。
 * `traffic.status` 的 `lastFailure` 只在账里真有 failed 时才出现；`shell.settings.get` 的
 * `effective` 只在壳写了运行时状态文件时才出现（读不到 ≠ 自启没生效）。
 */

import { resolveDataDir } from '../home.mjs'
import { readShellSettings, readTouchTimes, writeShellSettings } from './settings.mjs'
import { resolveShellStatus } from './shell-status.mjs'
import { markTrafficRead, readTraffic } from './traffic.mjs'

/** 请求对象兜底（非对象一律当空请求）。 */
function requestOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * 建触达环的方法组。
 * @param {object} ctx cordis 宿主上下文（裸 `{}` 也要活）
 * @param {{dataDir?: string, env?: Record<string, string|undefined>}} [config] 数据目录与壳的运行时
 *        状态文件来源（生产 `env: process.env`；断言台注入假壳路径 —— 缺省 `{}` = 没有壳）
 * @returns {Record<string, Function>} 六个方法
 */
export function createTrafficMethods(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  // P1（复核 #23）：壳的实际生效状态从 env 指到的那个 runtime 目录读；缺省 {} = 没有壳。
  const env = config.env

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
    'traffic.settings.get': async () => ({
      notifySummary: readShellSettings(dataDir).notifySummary,
      ...readTouchTimes(dataDir),
    }),

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
      return { notifySummary: saved.notifySummary, ...readTouchTimes(dataDir) }
    },

    /**
     * 契约 §5 点名的宿主半边（壳读同一份文件）。
     *
     * P1（复核 #23）：返回 `{settings, effective?}` —— `effective` 是壳**实际生效**的自启方式与
     * 关窗行为，只在壳写了运行时状态文件时才出现。读不到就**省略这个键**：把「读不到」写成
     * `autostart.enabled:false` 会被用户读成「开机自启没开」，那是编的。
     */
    'shell.settings.get': async () => {
      const settings = readShellSettings(dataDir)
      const resolved = resolveShellStatus({ env })
      return resolved.ok ? { settings, effective: resolved.status } : { settings }
    },
    /** 写设置（校验 + 原子写 + 回读；失败**抛**）。壳通过 `fs.watch` 重读并重写自己的生效状态。 */
    'shell.settings.set': async (request) => ({ settings: writeShellSettings(dataDir, requestOf(request)) }),
  }
}
