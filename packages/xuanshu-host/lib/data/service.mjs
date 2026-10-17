/**
 * packages/xuanshu-host/lib/data/service.mjs — 「我的数据」的宿主方法组（票 30 · #30）。
 *
 * 方法并进同一条 `/xuanshu` 通道（`lib/index.js` 的 `installRpc`）：
 *   - `data.overview()`：8 组体积 + 总计 + 排除项（契约 §1）；
 *   - `data.backup({targetDir, confirmed:true})`：一键备份 + 每文件 sha256 清单（契约 §2）。
 *
 * 三条边界，都是「这一屏只是如实报数」的落地：
 *   1. **不重算 home**：`home` / `dataDir` 由 `lib/index.js` 传进来（#22 的解析结果）。
 *      本组缺这两个值时**报错而不是自己兜底** —— 自己兜底就会重演「报告写 A、数据落 B」。
 *   2. **不依赖任何宿主 service**（没有 `ctx.get`）：体积与备份都是本地文件操作。
 *   3. **失败给可读原因，不把异常丢给界面**：`data.backup` 永远返回
 *      `{ok:false, error:{code,message}}`（契约 §2），不 throw。
 */

import { runBackup } from './backup.mjs'
import { buildOverview } from './overview.mjs'

/** 缺 home/dataDir 时的同一句可读原因（装配错误，不该发生在运行时）。 */
const MISSING_PATHS =
  'data.* 方法组缺少 home/dataDir：它们必须由 lib/index.js 传入宿主解析结果（本组不重算 home）。'

/**
 * 造 `data.*` 方法组。
 * @param _ctx - cordis 宿主上下文（本组不使用任何 service）。
 * @param {{home: string, dataDir: string, clock?: () => Date, limits?: object}} config - 宿主解析出的两个路径。
 */
export function createDataMethods(_ctx, config = {}) {
  const { home, dataDir, limits } = config
  const clock = typeof config.clock === 'function' ? config.clock : () => new Date()

  const assertPaths = () => {
    if (typeof home !== 'string' || home === '' || typeof dataDir !== 'string' || dataDir === '') {
      throw new Error(MISSING_PATHS)
    }
  }

  return {
    async 'data.overview'() {
      assertPaths()
      return buildOverview({ home, dataDir, limits })
    },
    async 'data.backup'(input) {
      assertPaths()
      return runBackup({
        home,
        dataDir,
        targetDir: input?.targetDir,
        confirmed: input?.confirmed,
        clock,
        limits,
      })
    },
  }
}
