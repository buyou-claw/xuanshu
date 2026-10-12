/**
 * P0（第二半）· **冻结接口面**：契约 §3.1 的导出名/签名逐一存在，且纯函数是纯的。
 *
 * 抓的真实缺陷/风险：契约把导出名当**接口**冻住了（宿主侧 `bazi-contract.mjs`、文档、客户端都按名字写），
 * 但「名字对不上」在 JS 里只会在**调用点**炸 —— 也就是别人的票里、在真机上、在最不方便的时候。
 * 这条用例把「少一个导出」「export 成了 default」「纯函数偷偷读环境变量」三类问题提前到断言台。
 *
 * 判据来源：契约 §3.1 的代码块（逐行抄下来的名字，不是我想的）。
 */
import { describe, expect, it } from 'vitest'

import { join } from 'node:path'

import * as bazi from '../../packages/xuanshu-host/lib/horosa/bazi.mjs'
import * as constants from '../../packages/xuanshu-host/lib/horosa/constants.mjs'
import * as guard from '../../packages/xuanshu-host/lib/horosa/guard.mjs'
import * as paths from '../../packages/xuanshu-host/lib/horosa/paths.mjs'
import * as plan from '../../packages/xuanshu-host/lib/horosa/plan.mjs'
import * as serve from '../../packages/xuanshu-host/lib/horosa/serve.mjs'
import * as service from '../../packages/xuanshu-host/lib/horosa/service.mjs'
import { isolateProcessEnv } from './lib/env.mjs'

/** 契约 §3.1 的冻结面：模块 → { 名字: 'function' | 'value' }。 */
const FROZEN = {
  constants: {
    module: constants,
    values: ['HOROSA_SERVER_NAME', 'HOROSA_DEFAULT_PORT', 'HOROSA_MCP_PATH', 'HOROSA_DEFAULT_HOST', 'HOROSA_BAZI_TOOL', 'HOROSA_BAZI_ENVELOPE_TOOL', 'HOROSA_GATE_CODE', 'HOROSA_TIME_ALG', 'HOROSA_STATUS_SCHEMA', 'HOROSA_ENVELOPE_REQUIRED_KEYS'],
    functions: [],
  },
  paths: { module: paths, values: [], functions: ['resolveHorosaPaths', 'loopbackHost'] },
  plan: { module: plan, values: [], functions: ['readSetupReport', 'resolveHorosaPlan', 'ensureRuntime'] },
  guard: { module: guard, values: [], functions: ['mcpInitialize', 'mcpToolsList', 'mcpCallTool', 'checkHorosaEndpoint'] },
  serve: { module: serve, values: [], functions: ['startHorosaServe', 'stopHorosaServe', 'ownsServe'] },
  bazi: { module: bazi, values: [], functions: ['buildBaziPayload', 'classifyBaziEnvelope'] },
  service: { module: service, values: [], functions: ['createHorosaRuntime', 'installHorosa'] },
}

describe('P0b · 冻结接口面（§3.1 的导出名一个不少）', () => {
  for (const [name, spec] of Object.entries(FROZEN)) {
    it(`${name}.mjs 导出：${[...spec.values, ...spec.functions].join(' / ')}`, () => {
      for (const key of spec.values) {
        expect(Object.prototype.hasOwnProperty.call(spec.module, key), `${name}.mjs 少了导出 ${key}`).toBe(true)
      }
      for (const key of spec.functions) {
        expect(typeof spec.module[key], `${name}.mjs 的 ${key} 必须是函数`).toBe('function')
      }
      // 不许有人图省事把整块塞进 default（调用方按名字 import）。
      expect(spec.module.default, `${name}.mjs 不该有 default 导出`).toBeUndefined()
    })
  }

  it('定值的值本身也冻着（端口/路径/工具名/schema 都是跨模块判据）', () => {
    expect(constants.HOROSA_SERVER_NAME).toBe('horosa')
    expect(constants.HOROSA_DEFAULT_HOST).toBe('127.0.0.1')
    expect(constants.HOROSA_BAZI_TOOL).toBe('horosa_cn_bazi_birth')
    expect(constants.HOROSA_BAZI_ENVELOPE_TOOL).toBe('bazi_birth')
    expect(constants.HOROSA_GATE_CODE).toBe('agent_guidance.required')
    expect(constants.HOROSA_TIME_ALG).toEqual({ TRUE_SOLAR: 0, CLOCK: 1, MEAN_SOLAR: 3 })
    expect(constants.HOROSA_STATUS_SCHEMA).toBe('xuanshu/horosa-status@1')
    expect(constants.HOROSA_ENVELOPE_REQUIRED_KEYS).toEqual(['ok', 'tool', 'version', 'data', 'summary', 'warnings', 'error'])
  })

  it('loopbackHost：回环字面量原样返回，其余 null（§3.1 的唯一口径）', () => {
    for (const value of ['127.0.0.1', '::1', 'localhost']) {
      expect(paths.loopbackHost(value), `loopbackHost(${JSON.stringify(value)}) 该原样返回`).toBe(value)
    }
    for (const value of ['0.0.0.0', '192.168.1.5', '10.0.0.1', 'example.com', '', null, undefined, 127.0]) {
      expect(paths.loopbackHost(value), `loopbackHost(${JSON.stringify(value)}) 该判非回环`).toBe(null)
    }
  })

  it('resolveHorosaPaths：返回契约 §3.1 的七个键（缺一个调用方就得猜路径）', () => {
    const resolved = paths.resolveHorosaPaths({ dshHome: 'X:\\dsh-home', config: {}, env: {} })
    for (const key of ['dshHome', 'dataDir', 'runtimeRoot', 'cacheDir', 'serveLogFile', 'statusFile', 'setupReportFile']) {
      expect(Object.prototype.hasOwnProperty.call(resolved, key), `resolveHorosaPaths 少了 ${key}`).toBe(true)
    }
    // dataDir 必须是「一切归 xuanshu」的目录（spec：数据目录一律 <dsh-home>/xuanshu/horosa）。
    expect(resolved.dataDir, `dataDir=${resolved.dataDir} 不在 <dsh-home>/xuanshu/horosa 下`).toMatch(/xuanshu[\\/]horosa/)
    expect(resolved.statusFile, 'statusFile 不在 dataDir 下（R7）').toBe(join(resolved.dataDir, 'horosa-status.json'))
    expect(resolved.serveLogFile, 'serveLogFile 不在 dataDir 下（R3）').toBe(join(resolved.dataDir, 'serve.log'))
  })

  it('五个纯函数/解析函数不偷读进程环境：显式 env 优先，process.env 里的真机值不许漏进来', () => {
    const restore = isolateProcessEnv({ HOROSA_RUNTIME_ROOT: 'X:\\real-machine-runtime', HOROSA_SKILL_DATA_DIR: 'X:\\real-machine-data' })
    try {
      const explicit = paths.resolveHorosaPaths({ dshHome: 'X:\\dsh-home', config: {}, env: {} })
      expect(explicit.runtimeRoot, 'process.env 的 HOROSA_RUNTIME_ROOT 漏进了显式 env={} 的调用').not.toBe('X:\\real-machine-runtime')
      expect(explicit.dataDir).not.toBe('X:\\real-machine-data')

      const two = paths.resolveHorosaPaths({ dshHome: 'X:\\dsh-home', config: {}, env: { HOROSA_RUNTIME_ROOT: 'X:\\r2' } })
      expect(two.runtimeRoot, '显式 env 没被尊重').toBe('X:\\r2')

      const payload = bazi.buildBaziPayload({ date: '1990-01-01', time: '12:00', zone: '+08:00', lat: '31n14', lon: '121e29' })
      expect(payload.ok).toBe(true)
      // 纯函数：同一份输入两次分类**值相等**，但**不是同一个对象**（返回的是新对象，不是内部缓存）。
      // 不是同引用这一条很实在：共享内层对象会让调用方「只读改一下」就污染下一次分类的结果。
      const envelope = { ok: true, tool: 'bazi_birth', version: '0.40.1', data: {}, summary: [], warnings: [], error: null }
      const first = bazi.classifyBaziEnvelope(envelope)
      const second = bazi.classifyBaziEnvelope(envelope)
      expect(second).toEqual(first)
      expect(second).not.toBe(first)
    } finally {
      restore()
    }
  })
})
