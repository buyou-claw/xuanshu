/**
 * packages/xuanshu-host/lib/bazi/service.mjs — 票 08 的 `bazi.*` RPC 方法组（契约 §2 冻结六个方法）。
 *
 * 与 `pu/service.mjs` / `cang/service.mjs` 同一形态：`lib/index.js` 的 `installRpc(ctx, {...})`
 * 把这一组方法并进同一条 `/xuanshu` 通道（票 09/14 共用 `lib/rpc.mjs` 的实现，本票不碰它）。
 *
 * 分工（契约 §3「出盘口径」）：
 *   - 出盘**只走** `ctx.get('xuanshuHorosa')` 的 `baziBirth()`（票 06 的宿主服务，自己管 serve 生命周期）。
 *     本模块**不**起 serve、不连 `127.0.0.1:8765`、不 import `scripts/horosa/**`；
 *   - 载荷构造与信封分类复用 `lib/horosa/bazi.mjs` 的 `buildBaziPayload` / `classifyBaziEnvelope`
 *     （票 06 的单源，这里只消费，绝不重写一份）；
 *   - 数据目录与装配报告同源（`config.dataDir` → `<dshHome>/xuanshu`），与 `lib/index.js` 的
 *     `resolveDataDir` 同一口径，避免「报告写在 A、底座谱落在 B」。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import { readBasePu } from './base-pu.mjs'
import { castBazi } from './cast.mjs'
import { createCityLibrary } from './cities.mjs'
import { readSnapshot } from './snapshot.mjs'
import { resolveTimezone } from './timezone.mjs'

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * 数据目录：`config.dataDir` 优先（`lib/index.js` 与测试都显式给），
 * 否则按 `profileContext.home` → `$DSH_HOME` → `~/.dsh` 回退到 `<home>/xuanshu`。
 */
export function resolveDataDir(ctx, config) {
  if (typeof config?.dataDir === 'string' && config.dataDir !== '') return config.dataDir
  const profile = softGet(ctx, 'profileContext')
  const home = typeof profile?.home === 'string' && profile.home !== '' ? profile.home : process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'xuanshu')
}

/**
 * 建 `bazi.*` 方法组。
 * @param {object} ctx cordis 宿主上下文（裸 `{}` 也要活）
 * @param {{dataDir?: string}} [config] 数据目录（缺省按 DSH_HOME 推导）
 * @returns {Record<string, Function>} 六个方法（契约 §2）
 */
export function createBaziMethods(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  // 大库懒加载（首次 bazi.cities 才读盘）；`bundledDir` 只为断言台留，缺省 = 随包 data/。
  const cities = createCityLibrary({ dataDir, bundledDir: config.bundledDir })

  return {
    /** 时区推导（契约 §4）：坐标 + 日期 → `{zone, offsetMinutes, dst}`，三项都可为 null。 */
    'bazi.timezone': async (request) => resolveTimezone(request ?? {}),

    /** 城市大库检索（契约 §2/§5）：大库缺失 → `{items: [], source: 'none'}`，不报错。 */
    'bazi.cities': async (request) => {
      const source = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
      return cities.search(source.query, source.limit)
    },

    /**
     * 出盘（契约 §2/§3）。**只读一次快照、只写一次盘**：本方法自己不含重试，
     * 失败一律折算成 `phase`（RPC 层不该看到异常 —— 界面要的是四态，不是 500）。
     */
    'bazi.cast': async (request) => castBazi({ ctx, dataDir, request }),

    /**
     * 命盘卡的状态（契约 §2 三态）：`empty`（还没出过盘）/ `ready`（快照可读）/
     * `error`（文件在但读不出来）。**无副作用**：二次调用不会重新出盘（验收 4 的机器判据）。
     */
    'bazi.status': async () => {
      const read = readSnapshot(dataDir)
      if (read.state === 'empty') return { state: 'empty' }
      if (read.state === 'error') return { state: 'error', reason: read.reason }
      return { state: 'ready', snapshot: read.snapshot }
    },

    /** 只读快照（契约 §2）：读不出来给 null（三态里的 error 由 `bazi.status` 报）。 */
    'bazi.snapshot': async () => {
      const read = readSnapshot(dataDir)
      return { snapshot: read.state === 'ready' ? read.snapshot : null }
    },

    /** 底座谱读回（契约 §2；票 10 的「默认在场」靠它）：没有 / 读不出来都给 null。 */
    'bazi.basePu': async () => ({ pu: readBasePu(dataDir) }),
  }
}
