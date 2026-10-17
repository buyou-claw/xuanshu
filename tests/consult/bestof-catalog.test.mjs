/**
 * 票 28 · 只读路由清单（`routes.list`）：providers → models → keyConfigured、默认路由、可配置未注册。
 *
 * 硬线（票面 + 侦察笔记 §2.2）：
 *   ① **只读**：不调 `settings.mutate/update`、不调 `credentials.set/unset` —— 配置与密钥归 DSH「设置 → 模型」；
 *   ② **数据不可得就是「未知」**：`settings` / `credentials` 不在场时 `keyConfigured === 'unknown'`，
 *      绝不写成 `false`（`false` 会被读成「这家没配」）；
 *   ③ `listProviders()` 只列**已注册**路由，`listConfigurableProviders()` 才是「可配置但未注册」；
 *   ④ 默认路由来自 `agentDefaultModel.currentSelection()`；读不到就是 `null`（不编）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createRouteMethods } from '../../packages/xuanshu-host/lib/consult/routes.mjs'
import { fakeAgentDefaultModel, makeHost, makeSandbox } from './lib/sandbox.mjs'
import { fakeLlm } from './lib/bestof-llm.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

/** 可配置路由目录（未注册的 `openrouter` 只能从这里看到）。 */
const CONFIGURABLE = [
  { provider: 'deepseek', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
  { provider: 'pi-ai', displayName: 'Pi AI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'pi-ai'] },
  { provider: 'openrouter', displayName: 'OpenRouter', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openrouter'] },
]

/** 假 settings：`describe()` 给命名空间值；任何写操作记下来并抛。 */
function fakeSettings(valueByNs) {
  const calls = []
  return {
    calls,
    service: {
      describe(options) {
        calls.push({ name: 'describe', options })
        return Object.entries(valueByNs).map(([ns, value]) => ({ ns, value }))
      },
      mutate() {
        calls.push({ name: 'mutate' })
        throw new Error('票 28 只读：不许写 settings')
      },
      update() {
        calls.push({ name: 'update' })
        throw new Error('票 28 只读：不许写 settings')
      },
    },
  }
}

/** 假 credentials：只有 `configuredRefs` 里的 ref 算已配置；写操作记下来并抛。 */
function fakeCredentials(configuredRefs = []) {
  const calls = []
  return {
    calls,
    service: {
      async describe(ref) {
        calls.push({ name: 'describe', ref })
        return { configured: configuredRefs.includes(ref) }
      },
      async set() {
        calls.push({ name: 'set' })
        throw new Error('票 28 只读：不许写 credentials')
      },
      async unset() {
        calls.push({ name: 'unset' })
        throw new Error('票 28 只读：不许写 credentials')
      },
    },
  }
}

/** 一套路由清单宿主；`withCredentials:false` 时拿掉 settings / credentials。 */
function scene({ withCredentials = true, providers, configurable = CONFIGURABLE, defaultSelection = { provider: 'deepseek', model: 'deepseek-chat' }, llm } = {}) {
  const sandbox = makeSandbox('bestof-catalog')
  roots.push(sandbox)
  const fake = fakeLlm([], providers === undefined ? undefined : { providers })
  if (llm !== undefined) Object.assign(fake.service, llm)
  fake.service.listConfigurableProviders = () => configurable.map((entry) => ({ ...entry, settingsPath: [...entry.settingsPath] }))
  const settings = fakeSettings({
    'llm-deepseek': { apiKeyEnv: 'DEEPSEEK_API_KEY' },
    'llm-pi-ai': { providers: { 'pi-ai': { apiKeyEnv: 'PI_AI_KEY' }, openrouter: { apiKeyEnv: 'OPENROUTER_KEY' } } },
  })
  const credentials = fakeCredentials(['DEEPSEEK_API_KEY'])
  const services = {
    llm: fake.service,
    agentDefaultModel: defaultSelection === null ? undefined : fakeAgentDefaultModel(defaultSelection).service,
    ...(withCredentials ? { settings: settings.service, credentials: credentials.service } : {}),
  }
  const host = makeHost({ services })
  const methods = createRouteMethods(host.ctx)
  return { sandbox, host, llm: fake, settings, credentials, methods }
}

const catalog = (methods) => methods['routes.list']({})

describe('routes.list · 形状与三态 keyConfigured', () => {
  it('providers → models → keyConfigured / 默认路由 / 可配置但未注册（冻结形状）', async () => {
    const { methods } = scene()
    const value = await catalog(methods)

    expect(value.schema).toBe('xuanshu/routes@1')
    expect(value.ok).toBe(true)
    expect(value.providers.map((provider) => provider.id)).toEqual(['deepseek', 'pi-ai'])
    expect(value.providers.map((provider) => provider.keyConfigured)).toEqual([true, false])
    expect(value.providers[0]).toMatchObject({
      id: 'deepseek',
      name: 'DeepSeek',
      registered: true,
      isDefault: true,
      modelsKnown: true,
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', isDefault: true }],
    })
    expect(value.providers[1].isDefault).toBe(false)
    expect(value.providers[1].models).toEqual([{ id: 'pi-chat', name: 'Pi Chat', isDefault: false }])

    // 默认路由逐字段（读的是 agentDefaultModel.currentSelection()）。
    expect(value.default).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })

    // 可配置但未注册：只有 openrouter（deepseek / pi-ai 已注册）。
    expect(value.configurable).toEqual([{ id: 'openrouter', name: 'OpenRouter', keyConfigured: false }])
    expect(value.failures).toEqual([])
  })

  it('settings / credentials 缺席 → keyConfigured 一律「unknown」，绝不写成 false', async () => {
    const { methods } = scene({ withCredentials: false })
    const value = await catalog(methods)
    expect(value.providers.every((provider) => provider.keyConfigured === 'unknown')).toBe(true)
    expect(value.configurable.every((provider) => provider.keyConfigured === 'unknown')).toBe(true)
  })

  it('默认模型读不到 → default=null，且 isDefault 是 unknown（null）而不是 false', async () => {
    const { methods } = scene({ defaultSelection: null })
    const value = await catalog(methods)
    expect(value.default).toBeNull()
    // S7（复核）：把「读不到默认路由」写成 false，界面会读成「这些都不是默认的」——那是编的。
    expect(value.providers.every((provider) => provider.isDefault === null)).toBe(true)
    expect(value.providers.every((provider) => provider.models.every((model) => model.isDefault === null))).toBe(true)
  })

  it('llm 服务不在场 → ok=false + 可读 reason，其余字段是空/未知而不是假数据', async () => {
    const host = makeHost()
    const value = await createRouteMethods(host.ctx)['routes.list']({})
    expect(value.ok).toBe(false)
    expect(value.reason).toMatch(/LLM 服务|routes/u)
    expect(value.providers).toEqual([])
    expect(value.configurable).toEqual([])
    expect(value.default).toBeNull()
    expect(value.failures).toEqual([])
  })
})

describe('routes.list · 单家失败隔离与只读纪律', () => {
  it('某家 listModels 失败 → 记在 failures 里，其它家照常列出（modelsKnown=false）', async () => {
    const { methods } = scene({
      llm: {
        async listModels(provider) {
          if (provider === 'pi-ai') throw new Error('UNKNOWN_MODEL：pi 没有可用模型')
          return [{ provider, id: 'deepseek-chat', name: 'DeepSeek Chat' }]
        },
      },
    })
    const value = await catalog(methods)
    const pi = value.providers.find((provider) => provider.id === 'pi-ai')
    expect(pi.modelsKnown).toBe(false)
    expect(pi.models).toEqual([])
    expect(value.failures).toEqual([{ provider: 'pi-ai', reason: expect.stringMatching(/UNKNOWN_MODEL/u) }])
    // 一家失败不拖累另一家。
    expect(value.providers.find((provider) => provider.id === 'deepseek').modelsKnown).toBe(true)
  })

  it('一次写操作都没有：settings 只 describe、credentials 只 describe', async () => {
    const { methods, settings, credentials } = scene()
    await catalog(methods)
    expect(settings.calls.map((call) => call.name)).toEqual(['describe'])
    expect(credentials.calls.every((call) => call.name === 'describe')).toBe(true)
    expect(credentials.calls.map((call) => call.ref)).toContain('DEEPSEEK_API_KEY')
  })
})
