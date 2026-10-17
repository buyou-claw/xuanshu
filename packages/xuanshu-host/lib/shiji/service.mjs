/**
 * packages/xuanshu-host/lib/shiji/service.mjs —— 事记的六个 RPC（票 05 / #26 契约 §1/§2）。
 *
 * | method | request | response |
 * |---|---|---|
 * | `shiji.list` | `{ includeDeleted? }` | `{ entries, notes? }`（`lastActiveAt` 倒序；默认不含墓碑） |
 * | `shiji.remove` | `{ id, confirmed: true }` | `{ ok, entry }`（写墓碑；confirm 闸门） |
 * | `shiji.restore` | `{ id, confirmed: true }` | `{ ok, entry }`（清墓碑；下一轮扫描重建） |
 * | `shiji.fromSession` | `{ sessionId, confirmed: true }` | `{ ok, entry }`（只处理玄枢问事会话） |
 * | `shiji.settings.get` | `{}` | `{ excludedDirs }` |
 * | `shiji.settings.set` | `{ excludedDirs }` | `{ ok, excludedDirs }` |
 *
 * **独立方法组**（契约 §1）：不塞进 `createDigaoMethods()` —— 那边 `Object.keys()` 被
 * `tests/digao/service.test.mjs` 全量钉死；也是「事记只可删、不可改」的机器判据（没有 write/update）。
 *
 * 写操作失败一律回**可读** `{ok:false, error}`，不静默；`confirmed !== true` 一律拒收（人确认闸门）。
 * 会话正文只走 `ctx.sessionQuery.readSession()`（不自己解压 zstd）；摘要只走 `ctx.llm`（可缺席）。
 */

import { resolveDataDir } from '../bazi/service.mjs'
import { projectConsultMessages } from '../consult/history.mjs'
import { createConsultStore, isConsultSessionId } from '../consult/store.mjs'
import { listShiji, recordSessionShiji, removeShijiEntry, restoreShijiEntry } from './ledger.mjs'
import { resolveShijiDshHome } from './scan.mjs'
import { readShijiSettings, writeShijiSettings } from './store.mjs'
import { summarizeSessionHistory } from './summary.mjs'

/** 请求对象兜底。 */
function requestOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** 非空字符串规范化。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 非严格读一个 cordis service。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/** 人确认闸门：`confirmed !== true` → 可读拒绝（不静默、不写）。 */
function confirmationError() {
  return {
    ok: false,
    error: { code: 'confirmation-required', message: '这个操作会改写事记：请求里必须带 confirmed: true（人确认闸门）。' },
  }
}

/** 写盘失败折成可读错误（不把异常抛给 RPC 层去猜）。 */
function writeFailure(operation, error) {
  return { ok: false, error: { code: 'write-failed', message: `${operation} 失败：${String(error?.message ?? error)}` } }
}

/**
 * 建 `shiji.*` 方法组（契约 §1 的六个方法）。
 * @param {object} ctx cordis 宿主上下文
 * @param {{dataDir?: string, dshHome?: string}} [config]
 */
export function createShijiMethods(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  const dshHome = resolveShijiDshHome(ctx, dataDir, config.dshHome)

  return {
    /** 列事记（默认不含墓碑；`includeDeleted` 用于审计/设置页）。 */
    'shiji.list': async (request) => {
      const source = requestOf(request)
      return listShiji(dataDir, { includeDeleted: source.includeDeleted === true })
    },

    /** 删除 = 写墓碑（条目保留在文件里；自动扫描此后永不重建）。 */
    'shiji.remove': async (request) => {
      const source = requestOf(request)
      if (source.confirmed !== true) return confirmationError()
      const id = text(source.id)
      if (id === '') return { ok: false, error: { code: 'invalid-id', message: 'shiji.remove 需要事记 id。' } }
      try {
        return removeShijiEntry(dataDir, { id })
      } catch (error) {
        return writeFailure('shiji.remove', error)
      }
    },

    /** 恢复 = 显式清墓碑；下一轮扫描按在场源头重新出现。 */
    'shiji.restore': async (request) => {
      const source = requestOf(request)
      if (source.confirmed !== true) return confirmationError()
      const id = text(source.id)
      if (id === '') return { ok: false, error: { code: 'invalid-id', message: 'shiji.restore 需要事记 id。' } }
      try {
        return restoreShijiEntry(dataDir, { id })
      } catch (error) {
        return writeFailure('shiji.restore', error)
      }
    },

    /**
     * 「存成今天的事记」：只处理玄枢自铸的问事会话（`session-xs-consult-*`）。
     *
     * 摘要来源 = 该会话的文本历史（复用 `consult/history.mjs` 的投影，不另写一份解析）；
     * LLM 不可用 / 报错 → `summary-unavailable`，**不写空条目、不编摘要**。
     * 同 `refId` 已存在则更新而不是新增（`recordSessionShiji`）。
     */
    'shiji.fromSession': async (request) => {
      const source = requestOf(request)
      if (source.confirmed !== true) return confirmationError()
      const sessionId = text(source.sessionId)
      if (!isConsultSessionId(sessionId)) {
        return {
          ok: false,
          error: {
            code: 'invalid-session',
            message: `只处理玄枢自铸的问事会话（session-xs-consult-*）：${JSON.stringify(sessionId)}。`,
          },
        }
      }

      const query = softGet(ctx, 'sessionQuery')
      if (typeof query?.readSession !== 'function') {
        return {
          ok: false,
          error: { code: 'session-unavailable', message: 'DSH 会话查询服务（ctx.sessionQuery）不可得：读不到这场问事的正文，不写空条目。' },
        }
      }
      let snapshot
      try {
        snapshot = await query.readSession(sessionId)
      } catch (error) {
        return {
          ok: false,
          error: { code: 'session-unavailable', message: `会话正文读不出来（${sessionId}）：${String(error?.message ?? error)}` },
        }
      }

      const messages = projectConsultMessages(snapshot)
      const manifest = createConsultStore(dataDir).read(sessionId)
      const name = text(manifest?.title) || '今天的问事'
      const summary = await summarizeSessionHistory(ctx, { name, messages })
      if (!summary.ok) {
        const empty = String(summary.reason ?? '').includes('没有可摘要')
        return {
          ok: false,
          error: {
            code: empty ? 'nothing-to-summarize' : 'summary-unavailable',
            message: empty
              ? '这场问事还没有可摘要的文本：先问两句再存（不写空条目）。'
              : `摘要未能生成（模型不可用）：${String(summary.reason ?? '未知原因')}。本次没有写入任何事记。`,
          },
        }
      }
      try {
        return recordSessionShiji(dataDir, { sessionId, name, summary: summary.text, summaryMode: 'llm' })
      } catch (error) {
        return writeFailure('shiji.fromSession', error)
      }
    },

    /** 读设置：`{excludedDirs}`（缺失/坏文件回空数组，扫描不会因一份坏设置停摆）。 */
    'shiji.settings.get': async () => ({ excludedDirs: readShijiSettings(dataDir).excludedDirs }),

    /** 写设置：归一后落 `<dataDir>/shiji-settings.json`；非法输入回可读错误、绝不写半份。 */
    'shiji.settings.set': async (request) => {
      const source = requestOf(request)
      try {
        const value = writeShijiSettings(dataDir, { excludedDirs: source.excludedDirs })
        return { ok: true, excludedDirs: value.excludedDirs }
      } catch (error) {
        return { ok: false, error: { code: 'invalid-settings', message: String(error?.message ?? error) } }
      }
    },
  }
}
