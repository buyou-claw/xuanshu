/**
 * 票 29 · 「接上 AI」状态面的纯派生（客户端半边；不碰 React，不碰网络）。
 *
 * 这一层回答票面验收的第一条：**状态面给出 `configured / providers / defaultModel / reason`**，
 * 而且「读不到 ≠ 没配」：
 *   - `configured` 是三态 `true | false | 'unknown'`，`'unknown'` 只表示「这次读不到」，不冒充未配置；
 *   - `providers` 逐家给出 key 三态（`true | false | 'unknown'`）与模型清单是否读得到；
 *   - `reason` 是**给人看的一句原因 + 下一步**（每个状态都有下一步）。
 *
 * 判据来源：`routes.list`（票 28 冻结形状，`packages/xuanshu-host/lib/consult/routes.mjs`）。
 * 为什么 `configured` 还要求默认模型：`consult.send` 的宿主门是
 * `consultAgentCapability()`（`lib/consult/agent.mjs:113-127`）——缺 `agentDefaultModel`
 * 的选择时第一轮请求前就抛 `has no provider/model`。所以「有可用 provider」是必要条件，
 * 「默认模型落在可用 provider 上」才是问事真的能开口的充要条件。
 *
 * 规则（实现里也逐字写一遍，避免只活在测试里）：
 *   usable(p) := p.registered === true && p.keyConfigured !== false
 *                && p.modelsKnown === true && p.models.length > 0
 *   configured := catalog 读不到 → 'unknown'
 *                 default === null → false
 *                 usable 里找不到 default.provider → false
 *                 找得到 → true
 */

import { describe, expect, it } from 'vitest'

import {
  AI_SETTINGS_PATH,
  AI_SETTINGS_SECTION,
  deriveAiReadiness,
} from '../../packages/xuanshu-client/src/client/ai-model.ts'

const ROUTES_SCHEMA = 'xuanshu/routes@1'

const provider = (over = {}) => ({
  id: 'deepseek-official',
  name: 'DeepSeek',
  registered: true,
  keyConfigured: true,
  isDefault: true,
  modelsKnown: true,
  models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', isDefault: true }],
  ...over,
})

const catalog = (over = {}) => ({
  schema: ROUTES_SCHEMA,
  ok: true,
  default: { provider: 'deepseek-official', model: 'deepseek-chat' },
  providers: [provider()],
  configurable: [],
  failures: [],
  ...over,
})

describe('票 29 · AI 状态面 · 已接上（configured === true）', () => {
  it('有可用 provider 且默认模型落在它上面 → configured true，四处字段齐全', () => {
    const readiness = deriveAiReadiness(catalog())
    expect(readiness.configured).toBe(true)
    expect(readiness.known).toBe(true)
    expect(readiness.defaultModel).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    expect(readiness.providers).toHaveLength(1)
    expect(readiness.providers[0]).toMatchObject({
      id: 'deepseek-official',
      name: 'DeepSeek',
      keyConfigured: true,
      usable: true,
      modelCount: 1,
    })
    expect(readiness.reason.code).toBe('ready')
    // 给人看的两句都必须在：原因（已接上谁）与下一步（可以问事）。
    expect(readiness.reason.text).toContain('配置齐了')
    expect(readiness.reason.text).toContain('DeepSeek')
    expect(readiness.reason.text).toContain('deepseek-chat')
    expect(readiness.reason.next).toContain('问事')
  })

  it('默认 provider 的 key 是「未知」→ 仍算可用，但 reason 如实降级为 ready-key-unknown（不静默放行）', () => {
    const readiness = deriveAiReadiness(catalog({ providers: [provider({ keyConfigured: 'unknown' })] }))
    expect(readiness.configured).toBe(true)
    expect(readiness.providers[0].keyConfigured).toBe('unknown')
    expect(readiness.providers[0].usable).toBe(true)
    expect(readiness.reason.code).toBe('ready-key-unknown')
    expect(readiness.reason.text).toContain('密钥状态读不到')
    expect(readiness.reason.next).toContain(AI_SETTINGS_PATH)
  })

  it('默认 provider 之外的一家没配 key 不拖累整份状态（providers 里如实列出，但不算它缺席）', () => {
    const readiness = deriveAiReadiness(
      catalog({
        providers: [
          provider(),
          provider({ id: 'pi-ai', name: 'Pi', keyConfigured: false, models: [{ id: 'gpt-x', name: null, isDefault: false }] }),
        ],
      }),
    )
    expect(readiness.configured).toBe(true)
    expect(readiness.providers).toHaveLength(2)
    expect(readiness.providers.find((row) => row.id === 'pi-ai')).toMatchObject({
      keyConfigured: false,
      usable: false,
    })
    expect(readiness.reason.code).toBe('ready')
  })
})

describe('票 29 · AI 状态面 · 未接上（configured === false，每个都写清原因与下一步）', () => {
  it('一家 provider 都没有 → no-provider', () => {
    const readiness = deriveAiReadiness(catalog({ providers: [], default: null }))
    expect(readiness.configured).toBe(false)
    expect(readiness.known).toBe(true)
    expect(readiness.providers).toEqual([])
    expect(readiness.defaultModel).toBeNull()
    expect(readiness.reason.code).toBe('no-provider')
    expect(readiness.reason.text).toContain('provider')
    expect(readiness.reason.next).toContain(AI_SETTINGS_PATH)
  })

  it('有可用 provider 但没有默认模型 → no-default-model（问事开不了口，不能放行）', () => {
    const readiness = deriveAiReadiness(catalog({ default: null }))
    expect(readiness.configured).toBe(false)
    expect(readiness.defaultModel).toBeNull()
    expect(readiness.providers).toHaveLength(1)
    expect(readiness.reason.code).toBe('no-default-model')
    expect(readiness.reason.text).toContain('默认模型')
    expect(readiness.reason.next).toContain(AI_SETTINGS_PATH)
    // S7（复核）：默认路由**读不到**时，逐家的 isDefaultProvider 不许写成 false（那是编的）；
    // 三态里「未知」必须留成未知（这里是 `null`）。
    expect(readiness.providers[0].isDefaultProvider).toBeNull()
  })

  it('默认 provider 的 key 明确是 false → missing-key（不是「未知」）', () => {
    const readiness = deriveAiReadiness(catalog({ providers: [provider({ keyConfigured: false })] }))
    expect(readiness.configured).toBe(false)
    expect(readiness.providers[0].keyConfigured).toBe(false)
    expect(readiness.reason.code).toBe('missing-key')
    expect(readiness.reason.text).toContain('密钥')
    expect(readiness.reason.next).toContain(AI_SETTINGS_PATH)
  })

  it('模型清单读不到（modelsKnown=false）→ models-unreadable，而不是谎称「没有模型」', () => {
    const readiness = deriveAiReadiness(catalog({ providers: [provider({ modelsKnown: false, models: [] })] }))
    expect(readiness.configured).toBe(false)
    expect(readiness.providers[0]).toMatchObject({ modelsKnown: false, usable: false })
    expect(readiness.reason.code).toBe('models-unreadable')
    expect(readiness.reason.text).toContain('读不到')
    expect(readiness.reason.text).not.toContain('没有可用模型')
  })

  it('模型清单读得到但为空 → no-model', () => {
    const readiness = deriveAiReadiness(catalog({ providers: [provider({ models: [] })] }))
    expect(readiness.configured).toBe(false)
    expect(readiness.reason.code).toBe('no-model')
    expect(readiness.reason.next).toContain(AI_SETTINGS_PATH)
  })

  it('默认模型指向一家没注册的 provider → default-provider-missing（不拿别人顶替）', () => {
    const readiness = deriveAiReadiness(
      catalog({
        default: { provider: 'nowhere', model: 'x' },
        providers: [provider()],
      }),
    )
    expect(readiness.configured).toBe(false)
    expect(readiness.reason.code).toBe('default-provider-missing')
    expect(readiness.reason.text).toContain('nowhere')
  })
})

describe('票 29 · AI 状态面 · 未知（读不到 ≠ 没配）', () => {
  it('catalog 完全拿不到（undefined）→ configured "unknown"，reason unavailable', () => {
    const readiness = deriveAiReadiness(undefined)
    expect(readiness.configured).toBe('unknown')
    expect(readiness.known).toBe(false)
    expect(readiness.providers).toEqual([])
    expect(readiness.defaultModel).toBeNull()
    expect(readiness.reason.code).toBe('unavailable')
    // 关键措辞：不许说成「未配置 / 没配」。
    expect(readiness.reason.text).toContain('读不到')
    expect(readiness.reason.text).toContain('不等于')
    expect(readiness.reason.next).toContain('重试')
  })

  it('宿主明说 ok:false（没有 llm 服务）→ 仍是 unknown，detail 带宿主原话', () => {
    const hostReason = '宿主没有可用的 LLM 服务（ctx.llm）：路由清单读不到。'
    const readiness = deriveAiReadiness({ schema: ROUTES_SCHEMA, ok: false, reason: hostReason, default: null, providers: [], configurable: [], failures: [] })
    expect(readiness.configured).toBe('unknown')
    expect(readiness.reason.code).toBe('unavailable')
    expect(readiness.detail).toBe(hostReason)
  })

  it('形状对不上（schema 不是 xuanshu/routes@1 / providers 不是数组）→ unknown，不瞎猜', () => {
    expect(deriveAiReadiness({ ...catalog(), schema: 'xuanshu/routes@2' }).configured).toBe('unknown')
    expect(deriveAiReadiness({ ...catalog(), providers: undefined }).configured).toBe('unknown')
    expect(deriveAiReadiness(null).configured).toBe('unknown')
  })
})

describe('票 29 · AI 状态面 · 纯函数纪律', () => {
  it('派生不改写输入（只读检测的客户端一半）', () => {
    const input = catalog({ providers: [provider({ keyConfigured: 'unknown' })] })
    const before = JSON.parse(JSON.stringify(input))
    deriveAiReadiness(input)
    expect(input).toEqual(before)
  })

  it('provider 行只投影界面要用的字段，不把整个 catalog 原样透出去', () => {
    const readiness = deriveAiReadiness(catalog({ failures: [{ provider: 'x', reason: 'boom' }] }))
    // failures 不是状态面的一部分；读不到模型的家已经在 modelsKnown 里如实表达。
    expect(readiness).not.toHaveProperty('failures')
    expect(readiness.providers[0]).not.toHaveProperty('isDefaultModelList')
  })

  it('设置页的两个常量逐字固定：路径文案与 section id（界面只读这两处）', () => {
    expect(AI_SETTINGS_PATH).toBe('设置 → 模型')
    expect(AI_SETTINGS_SECTION).toBe('models')
  })
})
