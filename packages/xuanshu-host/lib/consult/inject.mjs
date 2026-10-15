/**
 * packages/xuanshu-host/lib/consult/inject.mjs — 问事上下文的**读取 + 装配**（单一来源）。
 *
 * 为什么单独一个模块：同一场问事的上下文现在有三个消费方，而它们必须看到**同一份**东西 ——
 *   - `consult.create`：会话建好就灌首轮上下文（见 `service.mjs` 的说明）；
 *   - `consult.send`：挂载变更后补一段增量（票 12）；
 *   - `bestof.run`：N 路候选流的用户消息（票 11）。
 *
 * 各写一份「读底座谱 / 读底稿 / 读勾选谱 / 读挂载」必然漂移，而漂移的症状是安静的那种：
 * 评审实测 —— 合参的候选只拿到一句裸问题，底座谱与底稿一个字符都没带进去，
 * 于是「结合我的信息建议怎么做？」这个问题在合参里**答不出来**（问事里却答得出来）。
 *
 * 读面一条都不新开（与票 10 的纪律一致）：
 *   - 底座谱只走票 08 的 `bazi.basePu`；
 *   - 可选谱只走票 09 的 `pu.read`；
 *   - 底稿就是 `<dataDir>/digao.md` 这个文件（票 13 生产、本模块只探测与注入）；
 *   - 挂载只走票 12 的 `buildMountPreview`（读 + 裁 + 披露的同一条路径）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createBaziMethods, resolveDataDir } from '../bazi/service.mjs'
import { buildMountPreview } from '../mounts/preview.mjs'
import { createPuMethods } from '../pu/service.mjs'
import { buildConsultContext, buildMountUpdateContext } from './context.mjs'
import { mountsKey } from './store.mjs'

/** 底稿文件名（契约 §2/§3：`<dataDir>/digao.md`，由票 13 生产，本模块只探测与注入）。 */
export const DIGAO_FILENAME = 'digao.md'

/** 底稿路径。 */
export function digaoPath(dataDir) {
  return join(dataDir, DIGAO_FILENAME)
}

/**
 * 读底稿：不存在 → null（**不造空底稿**：`present:false` 才是诚实的答案）。
 * 读不出来（权限/目录）也当没生成 —— 探测面不该因为一个文件读不动就整体报错。
 */
export function readDigao(dataDir) {
  const file = digaoPath(dataDir)
  try {
    if (!existsSync(file)) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * 建一个「这场问事的上下文」装配器（同一份实现给 consult 与 bestof 用）。
 *
 * @param {object} ctx cordis 宿主上下文
 * @param {{dataDir?: string, mountBudget?: number}} [config]
 * @returns {{dataDir: string, buildInjection: (manifest: object) => Promise<string>,
 *            buildMountChange: (manifest: object) => Promise<string|null>}}
 */
export function createContextAssembly(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  const basePu = async () => createBaziMethods(ctx, { dataDir })['bazi.basePu']()
  const readPu = async (slug) => createPuMethods(ctx, { dataDir })['pu.read']({ slug })

  /**
   * 全量上下文（底座谱 → 底稿 → 勾选谱 → 临时挂载）。
   *
   * 挂载只在**真有挂载**时才多出那一段（`mounts` 为空时输出与票 10 逐字节相同）——
   * 这是「加性」在这里的具体含义：改动不许影响没有挂载的会话。
   */
  async function buildInjection(manifest) {
    const read = await basePu()
    const selected = []
    for (const slug of manifest.pus ?? []) {
      try {
        selected.push({ slug, pu: await readPu(slug) })
      } catch (error) {
        // 勾选时在、现在读不到：把原因带进注入文本，而不是静默少一段（见 context.mjs）。
        selected.push({ slug, error: String(error?.message ?? error) })
      }
    }
    const mounts = (manifest.mounts ?? []).length > 0
      ? await buildMountPreview(ctx, config, manifest.mounts)
      : undefined
    return buildConsultContext({ dataDir, basePu: read?.pu ?? null, digao: readDigao(dataDir), selected, mounts })
  }

  /**
   * 挂载变更段：**没有变更**（当前挂载与已经注入过的那一份一致）→ `null`。
   *
   * `manifest.mountsInjected` 是旁挂清单里记的「已经交给模型的那一份」（见 store.mjs）；
   * 它缺省 = 还没注入过任何挂载（新会话的 `mounts` 也是空，于是不会凭空冒出一段）。
   *
   * 返回值里的 `delivered` 是**内容有没有真的进去**：挂载内容读不出来（`ctx.fs` 那一刻不可得）
   * 或整层被裁掉时，披露块照样进（那是事实），但**不算交付** —— 调用方据此不写 `mountsInjected`，
   * 于是下一问会再试一次（读不出来往往是一时的）。
   *
   * @returns {Promise<null | {text: string, delivered: boolean}>}
   */
  async function buildMountChange(manifest) {
    const current = Array.isArray(manifest.mounts) ? manifest.mounts : []
    const injected = Array.isArray(manifest.mountsInjected) ? manifest.mountsInjected : []
    if (mountsKey(current) === mountsKey(injected)) return null
    const preview = current.length > 0 ? await buildMountPreview(ctx, config, current) : undefined
    return {
      text: buildMountUpdateContext({ mounts: preview }),
      // 清空也是一种交付（「已全部移除」那句话就是全部内容）；否则至少有一层真的纳入了才算。
      delivered: current.length === 0 || (preview?.layers ?? []).some((layer) => layer.kept === true),
    }
  }

  return { dataDir, buildInjection, buildMountChange }
}
