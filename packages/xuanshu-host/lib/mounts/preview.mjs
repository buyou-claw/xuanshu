/**
 * packages/xuanshu-host/lib/mounts/preview.mjs — 预览的**唯一**编排（票 12；契约 §2 的 `preview`）。
 *
 * 一条路径服务两件事：`consult.setMounts({preview:true})` 的**只算不写**，
 * 与注入前的**真裁剪**。契约修订的核心理由就是这条 —— 校验 / 读取 / 裁剪只有一份实现，
 * 「预览看到的」与「确认后注入的」不可能各算一套。
 *
 * `requireMountableWorkspaces` 在**确认这一刻**做一次可读的存在性校验：
 * 挂一个已经不存在的工作区没有意义，而等到注入时才发现就太晚了（那时用户已经离开抽屉）。
 * registry 服务不在场时**跳过**这项校验（fail-open，形状校验不受影响）——
 * 断言台与裁剪过的 profile 里没有 workspaceRegistry 是正常情况。
 */
import { resolveMountBudget } from './budget.mjs'
import { clipMountLayers } from './clip.mjs'
import { readMountLayer } from './content.mjs'

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）——与 `consult/service.mjs` 同款。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * 校验挂载里的工作区**真的存在**（拿不到 registry 就跳过）。
 *
 * @param {object} ctx - cordis 宿主上下文。
 * @param {readonly {kind: string, id: string, label: string}[]} mounts - 已归一化的挂载清单。
 * @throws {Error} 工作区 id 不在 DSH 清单里时（可读错误，调用方在确认这一刻拒掉）。
 */
export function requireMountableWorkspaces(ctx, mounts) {
  const registry = softGet(ctx, 'workspaceRegistry')
  if (typeof registry?.get !== 'function') return
  for (const mount of mounts) {
    if (mount.kind !== 'workspace') continue
    const workspace = registry.get(mount.id)
    if (workspace === undefined || workspace === null) {
      throw new Error(
        `这个工作区不在 DSH 的工作区清单里：${mount.label}（id=${mount.id}）。挂载一个不存在的工作区没有意义 —— 去 DSH 工作区界面确认，或先移除它。`,
      )
    }
  }
}

/**
 * 读 + 裁，得到给界面 / 注入用的预览。
 *
 * @param {object} ctx - cordis 宿主上下文（用 `ctx.fs` / `ctx.workspaceRegistry`，以及预算探测）。
 * @param {{dataDir?: string, mountBudget?: number, maxFiles?: number, maxFileChars?: number, maxDepth?: number}} [config]
 * @param {readonly object[]} [mounts] - 已归一化的挂载清单。
 * @returns {Promise<object>} `MountPreview`（契约 §2 的四项 + 逐层细节）。
 */
export async function buildMountPreview(ctx, config = {}, mounts = []) {
  const layers = []
  for (const mount of mounts) {
    layers.push(await readMountLayer(ctx, mount, config))
  }
  const budgetRead = await resolveMountBudget(ctx, config)
  const clipped = clipMountLayers(layers, budgetRead.budget)
  return {
    ...clipped,
    layers: disambiguateHeads(clipped.layers),
    budgetSource: budgetRead.source,
    ...(budgetRead.detail === undefined ? {} : { budgetDetail: budgetRead.detail }),
  }
}

/**
 * 两层解析出**完全相同的 head** 时，给它俩补上层的 id。
 *
 * 为什么必须补（复核 48e0e0a 规格轴的第 ③ 条）：交付账与日志之间以 `【来源：挂载 <head>】` 为键
 * （`boundary.mjs` 的对账）—— head 撞车时（两个工作区 id 指向同一个路径、标签也一样）第二层会被
 * 判成「已经交付过」，于是**永远不投**。层的 id 是稳定的（`kind:mountId`），补在 head 后面只多几个字符，
 * 而且披露块与注入正文用的是**同一个** `layer.head`（两边同时改，不会一处有一处没有）。
 *
 * @param {Array<object>} layers `clipMountLayers()` 的层数组
 * @returns {Array<object>} 撞车的那几层换了 head，其余原样
 */
function disambiguateHeads(layers) {
  const counts = new Map()
  for (const layer of layers) counts.set(layer.head, (counts.get(layer.head) ?? 0) + 1)
  return layers.map((layer) => (counts.get(layer.head) > 1 ? { ...layer, head: `${layer.head} · id=${layer.id}` } : layer))
}
