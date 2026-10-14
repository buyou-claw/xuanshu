/**
 * packages/xuanshu-host/lib/sediment/service.mjs — 票 15 的 `sediment.*` RPC 方法组（契约 §3 冻结三个方法）。
 *
 * 与 `pu/service.mjs` / `consult/service.mjs` 同一形态：`lib/index.js` 的 `installRpc(ctx, {...})`
 * 把这一组方法并进同一条 `/xuanshu` 通道（通道实现是 `lib/rpc.mjs`，本票不碰）。
 *
 * 一条**人工确认闸门**（本票唯一不可让的东西，S10 §9 C4）：
 *
 *   - `sediment.draft` 只产出并暂存草稿（`<dataDir>/sediment/<draftId>.json`）；
 *   - `sediment.commit` 在**第一行**检查 `confirmed === true` —— 不是 `truthy`、不是「有确认字段就算」。
 *     不满足就抛可读错误，**在此之前一个字节都不碰**（负路径断言见 `tests/sediment/commit.test.mjs`）；
 *   - 界面上不存在任何「AI 自动写入」的路径：本模块没有定时器、没有监听器、没有「确认过就记住」的开关。
 *
 * 写回**只走票 09 的 `pu.update`**（= `createPuRepository().update()` 的 staging + rename）：
 * 本模块里没有第二份写盘逻辑，也不 import `node:fs` 的写 API（只有草稿仓 `store.mjs` 写自己的暂存区）。
 * 这样「谱怎么原子替换、怎么保留原 source、怎么回滚」全都只有一个实现。
 */
import { consultAgentCapability, resumeConsultAgent } from '../consult/agent.mjs'
import { isConsultSessionId, createConsultStore } from '../consult/store.mjs'
import { waitForTurnEnd } from '../consult/turn.mjs'
import { createPuMethods } from '../pu/service.mjs'
import { resolveDataDir } from '../bazi/service.mjs'
import { ensureConsultAgent } from './agent.mjs'
import { createSedimentPromptMessage } from './message.mjs'
import { buildSedimentPrompt, lastAssistantText, parseDraftAnswer, resolveTarget } from './plan.mjs'
import { sedimentSkillText } from './skill.mjs'
import { normalizeDraftDraft, createSedimentStore } from './store.mjs'

/** 取消（人关掉了卡片 / RPC 断开）时的统一说法：**没落盘**要写清楚。 */
const ABORTED_MESSAGE = '已取消：这次导出汇总被中止，草稿没有落盘。'

/** 把请求体归一成对象（RPC 允许空载荷；数组/标量一律当空对象）。 */
function asRequest(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** 非严格读一个 cordis service（拿不到就 undefined，绝不抛）。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * 建 `sediment.*` 方法组。
 * @param {object} ctx cordis 宿主上下文（裸 `{}` 也要活：本组方法不依赖任何宿主服务）
 * @param {{dataDir?: string}} [config] 数据目录（缺省按 `profileContext.home` → `$DSH_HOME` → `~/.dsh` 推导）
 * @returns {Record<string, Function>} 契约 §3 的三个方法
 */
export function createSedimentMethods(ctx, config = {}) {
  const dataDir = resolveDataDir(ctx, config)
  const store = createSedimentStore(dataDir)
  /** 旁挂清单（问事会话的权威在哪一场、问过几句）—— 读面只走票 10 的实现。 */
  const consultStore = createConsultStore(dataDir)
  /**
   * 票 09 的写面：**现建一次方法组再调它** —— 与 RPC 上暴露的 `pu.*` 是同一批函数。
   * 不把 `createPuRepository()` 直接拿来用，是为了让「谱的读/写只有一条路」这件事在代码里看得见。
   */
  const puMethods = () => createPuMethods(ctx, { dataDir })
  /** 解析官方 `@deepseek-ai/dsh-llm/message` 的锚点顺序：profile 目录优先（真机就在这里）。 */
  const messageSearchDirs = () => {
    const profile = softGet(ctx, 'profileContext')
    return [typeof profile?.dir === 'string' ? profile.dir : null, process.cwd()].filter((dir) => typeof dir === 'string' && dir !== '')
  }

  /** 校验并取出问事会话 id：**只吃玄枢自铸的前缀**（ADR-0009 第 1 条）。 */
  function requireConsultSessionId(value) {
    if (!isConsultSessionId(value)) {
      throw new Error(`不是问事会话的 id：${JSON.stringify(value) ?? String(value)}（沉淀只对问事会话成立：问事会话的 id 一律是 session-xs-consult-<uuid>）。`)
    }
    return value
  }

  return {
    /**
     * 导出汇总（契约 §3）：`{ sessionId, targetSlug? }` → `{ draftId, target, draft }`。
     *
     * 这是本票里 AI 唯一被允许做的事 —— **产出草稿**，这一步不碰任何谱文件：
     *   - 驱动的是**这场问事会话本身**（它带着全部上下文），不另开一场会话；
     *   - 目标谱在生成前就定下来（`pu.read` 拿到它的现状塞进提示，草稿因而是「既有正文之上的更新」）；
     *   - 模型必须按 skill 的约定吐 JSON，形状不过关就当场拒收、**不落草稿**
     *     （存下一份提交不了的状态，比报错更坏）。
     *
     * 这一步会真的等一轮对话结束（`turn/end`），因此 RPC 调用可能持续数十秒：
     * `signal` 一路透传到 `waitForTurnEnd`，客户端取消得掉；取消时草稿不落盘。
     */
    'sediment.draft': async (request, signal) => {
      const source = asRequest(request)
      if (signal?.aborted === true) throw new Error(ABORTED_MESSAGE)
      const sessionId = requireConsultSessionId(source.sessionId)

      const manifest = consultStore.read(sessionId)
      if (manifest === null) {
        throw new Error(`问事记录不存在：${sessionId}（列表以旁挂清单为准 —— 它不是一场问事，或者记录已经不在 <dataDir>/consult/sessions/ 里了）。`)
      }
      if (!(Number.isInteger(manifest.turns) && manifest.turns >= 1)) {
        throw new Error('这场问事还没有问过任何一句（turn 数为 0）：没有可沉淀的汇总。先在会话里问一句，再回来导出。')
      }

      // 发得出去的门（与 `consult.send` 同一道）：preset / 模型服务缺一个，这一轮一定跑不起来。
      const capability = consultAgentCapability(ctx)
      if (!capability.ok) throw new Error(`这次导出汇总发不出去。${capability.detail}`)

      const available = await puMethods()['pu.list']({})
      const target = resolveTarget({ requestedSlug: source.targetSlug, consultPus: manifest.pus, available })

      let current
      try {
        current = await puMethods()['pu.read']({ slug: target.slug })
      } catch (error) {
        throw new Error(`目标谱读不出来（slug=${target.slug}）：${String(error?.message ?? error)}。`)
      }

      const prompt = buildSedimentPrompt({ skill: sedimentSkillText(), target, current })
      const agent = await ensureConsultAgent(ctx, sessionId, { resume: resumeConsultAgent })
      if (signal?.aborted === true) throw new Error(ABORTED_MESSAGE)

      // **先订阅再 followup**：反过来会漏掉快路径上的 `turn/end`，症状是永久挂起（票 10 turn.mjs 同款纪律）。
      const waiting = waitForTurnEnd(ctx, sessionId, { signal })
      agent.followup(await createSedimentPromptMessage(prompt, { searchDirs: messageSearchDirs() }))

      const ended = await waiting
      if (ended.kind !== 'ended') throw new Error(ABORTED_MESSAGE)

      const query = softGet(ctx, 'sessionQuery')
      if (typeof query?.readSession !== 'function') {
        throw new Error('DSH 会话查询服务（ctx.sessionQuery）不可得：读不出这一轮的答复，草稿没有落盘。')
      }
      let snapshot
      try {
        snapshot = await query.readSession(sessionId)
      } catch (error) {
        throw new Error(`这一轮的答复读不出来（${sessionId}）：${String(error?.message ?? error)}。`)
      }
      const text = lastAssistantText(snapshot)
      if (text === null) throw new Error('这一轮没有助手文本：模型没有给出可沉淀的内容，请重试。')

      const draft = parseDraftAnswer(text)
      const record = store.create({ sessionId, target, draft })
      return { draftId: record.draftId, target: record.target, draft: record.draft }
    },

    /**
     * 提交一份草稿到目标谱（契约 §3）：`{ draftId, confirmed: true, draft? }` → `{ pu }`。
     *
     * 顺序是契约的一部分：
     *   1. 闸门（`confirmed === true`）——**在任何读盘/写盘之前**；
     *   2. 读草稿（不存在 → 可读错误，一个字节都不写）；
     *   3. 读目标谱当前态（拿 `name` / `level`：写回是**更新**，不是按草稿另起一本谱）；
     *   4. `pu.update`（staging + rename，原子替换）；
     *   5. 草稿删掉 —— 它已经进了谱，留着只会让同一次沉淀被应用第二遍。
     */
    'sediment.commit': async (request) => {
      const source = asRequest(request)
      if (source.confirmed !== true) {
        throw new Error(
          '需要人工确认后才写谱：`confirmed` 必须是布尔 true（人要亲手点过「确认更新」）。'
            + ' 这条闸门是「AI 会动你的东西由人兜底」的接口，不接受任何默认值。',
        )
      }

      const record = store.read(source.draftId)
      if (record === null) {
        throw new Error(`沉淀草稿不存在或读不出来：${JSON.stringify(source.draftId) ?? String(source.draftId)}（草稿只存在 <dataDir>/sediment/<draftId>.json 里；丢弃或提交过的草稿不会留下第二份）。`)
      }

      // 人改过的草稿（契约 §3 的 `draft?`）优先；形状校验与草稿仓同一份（store 的 normalizeDraftDraft）。
      const body = source.draft === undefined ? record.draft : normalizeDraftDraft(source.draft)

      let current
      try {
        current = await puMethods()['pu.read']({ slug: record.target.slug })
      } catch (error) {
        throw new Error(`目标谱读不出来（slug=${record.target.slug}）：${String(error?.message ?? error)}。写回是「更新既有的谱」，不会顺手新建一本 —— 谱可能被人改名或删掉了，请回 S5 谱管理确认。`)
      }

      const pu = await puMethods()['pu.update']({
        slug: record.target.slug,
        draft: {
          // 名字与级别取**当前谱**的：沉淀改的是内容，不是身份（改名是 S5 的事）。
          name: current.name,
          level: current.level,
          description: body.description,
          body: body.body,
          summary: body.summary,
        },
        confirmed: true,
      })

      store.remove(record.draftId)
      return { pu }
    },

    /**
     * 丢弃一份草稿（契约 §3）：`{ draftId }` → `{ ok: true }`。
     *
     * 草稿不在就抛错（而不是静默 `ok:true`）：让人知道「你以为丢掉的那份其实早就不在了」，
     * 比回一个假的成功更有用。会话本身不受影响（丢弃只删草稿文件）。
     */
    'sediment.discard': async (request) => {
      const source = asRequest(request)
      const removed = store.remove(source.draftId)
      if (!removed) throw new Error(`沉淀草稿不存在：${JSON.stringify(source.draftId) ?? String(source.draftId)}（没什么可丢的）。`)
      return { ok: true }
    },
  }
}
