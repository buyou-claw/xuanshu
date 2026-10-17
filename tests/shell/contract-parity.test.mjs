/**
 * #23 · 壳侧契约常量与宿主侧**逐字对拍**（冻结契约 §1 / §2 / §5；两侧夹测的公共断言）。
 *
 * 为什么这组测试存在：壳与宿主之间只有一条 IPC（回环 JSON 通知端点）与一份共享设置文件。
 * 两边的 schema 名 / 取值域 / 环境变量名 / 端口默认值一旦漂移，**两侧各自的测试都还是绿的**
 * （它们只验自己那一半），真机上则表现为「宿主发得对、壳拒收」或「设置写了、壳不认」。
 * 所以这里把宿主侧那几份**真源** import 进来直接比：
 *   - `.scratch/notes/spec002/contract-shell-notify.md` §0/§1/§2/§5（冻结契约）
 *   - `packages/xuanshu-host/lib/notify/contract.mjs`（#24 已合并的 schema 字面量）
 *   - `packages/xuanshu-host/lib/notify/settings.mjs`（#24 已合并的设置读写）
 *   - `scripts/isolation/defaults.mjs`（端口 / profile 的**唯一常量来源**）
 *
 * 壳的本地副本是「parity-tested local copy」：壳要能被单独装进 Electron 应用，不能反向依赖仓库里的
 * `scripts/`；但规则必须与真源同一套 —— 由本文件钉住。
 */
import { describe, expect, it } from 'vitest'

import * as shellContract from '../../packages/xuanshu-shell/lib/contract.mjs'
import { validateNotifyPayload as shellValidate } from '../../packages/xuanshu-shell/lib/notify-payload.mjs'
import * as hostContract from '../../packages/xuanshu-host/lib/notify/contract.mjs'
import { validateNotify as hostValidate } from '../../packages/xuanshu-host/lib/notify/send.mjs'
import { CLOSE_BEHAVIORS, DEFAULT_SHELL_SETTINGS } from '../../packages/xuanshu-host/lib/notify/settings.mjs'
import * as isolationDefaults from '../../scripts/isolation/defaults.mjs'
// R8（#39）：客户端侧的 `OVERVIEW_HASH` —— 从**客户端源码**直接 import（vitest 用 vite 转译 TS），
// 不抄字面量。壳侧那份从 `main-flow.mjs` import（下面那组 describe 用）。
import {
  OVERVIEW_HASH as CLIENT_OVERVIEW_HASH,
  isOverviewHash,
} from '../../packages/xuanshu-client/src/client/overview-hash.ts'
import {
  OVERVIEW_HASH as SHELL_OVERVIEW_HASH,
  overviewUrlWithHash,
} from '../../packages/xuanshu-shell/lib/main-flow.mjs'

describe('#23 · 契约常量：壳的本地副本 == 宿主 / 隔离启动器的真源', () => {
  it('schema 名逐字相等（shell-notify / notify / shell-settings）', () => {
    expect(shellContract.SHELL_NOTIFY_SCHEMA).toBe(hostContract.SHELL_NOTIFY_SCHEMA)
    expect(shellContract.SHELL_NOTIFY_SCHEMA).toBe('xuanshu/shell-notify@1')
    expect(shellContract.NOTIFY_SCHEMA).toBe(hostContract.NOTIFY_SCHEMA)
    expect(shellContract.NOTIFY_SCHEMA).toBe('xuanshu/notify@1')
    expect(shellContract.SHELL_SETTINGS_SCHEMA).toBe(hostContract.SHELL_SETTINGS_SCHEMA)
    expect(shellContract.SHELL_SETTINGS_SCHEMA).toBe('xuanshu/shell-settings@1')
  })

  it('通知取值域逐字相等（kind / target）', () => {
    expect([...shellContract.NOTIFY_KINDS]).toEqual([...hostContract.NOTIFY_KINDS])
    expect([...shellContract.NOTIFY_TARGETS]).toEqual([...hostContract.NOTIFY_TARGETS])
    // 契约 §2 的定值（写死在这里，避免「两边一起改错」也算绿）
    expect([...shellContract.NOTIFY_KINDS]).toEqual(['rikke', 'wansheng'])
    expect([...shellContract.NOTIFY_TARGETS]).toEqual(['overview', 'consult'])
  })

  it('关窗语义与默认设置逐字相等（hide / quit；closeBehavior 默认 hide）', () => {
    expect([...shellContract.CLOSE_BEHAVIORS]).toEqual([...CLOSE_BEHAVIORS])
    expect({ ...shellContract.DEFAULT_SHELL_SETTINGS }).toEqual({ ...DEFAULT_SHELL_SETTINGS })
    expect({ ...shellContract.DEFAULT_SHELL_SETTINGS }).toEqual({
      closeBehavior: 'hide',
      autostart: false,
      notifySummary: false,
    })
  })

  it('端口 / profile / home 环境变量名与 scripts/isolation/defaults.mjs 同源', () => {
    expect(shellContract.DEFAULT_WEB_PORT).toBe(isolationDefaults.DEFAULT_WEB_PORT)
    expect(shellContract.DEFAULT_WEB_PORT).toBe(19388)
    expect(shellContract.DESKTOP_WEB_PORT).toBe(isolationDefaults.DESKTOP_WEB_PORT)
    expect(shellContract.DEFAULT_PROFILE).toBe(isolationDefaults.DEFAULT_PROFILE)
    expect(shellContract.DEFAULT_PROFILE).toBe('xuanshu')
    expect(shellContract.DSH_PACKAGE).toBe(isolationDefaults.DSH_PACKAGE)
    expect(shellContract.ENV.home).toBe(isolationDefaults.ENV.home)
    expect(shellContract.ENV.home).toBe('XUANSHU_DSH_HOME')
    expect(shellContract.ENV.webPort).toBe(isolationDefaults.ENV.webPort)
    expect(shellContract.DSH_HOME_ENV).toBe(isolationDefaults.DSH_HOME_ENV)
    expect(shellContract.DATA_DIR_NAME).toBe(isolationDefaults.DATA_DIR_NAME)
    expect([...shellContract.HOME_MODES]).toEqual([...isolationDefaults.HOME_MODES])
  })

  it('状态文件 / 设置文件名与宿主语义一致', () => {
    expect(shellContract.SHELL_NOTIFY_STATE_FILE).toBe('shell-notify.json')
    expect(shellContract.SHELL_SETTINGS_FILE).toBe('shell-settings.json')
    expect(shellContract.NOTIFY_STATE_ENV).toBe('XUANSHU_SHELL_NOTIFY_STATE')
    expect(shellContract.SHELL_PID_ENV).toBe('XUANSHU_SHELL_PID')
  })

  it('P1（复核 #23）：运行时状态文件（shell-status）两侧逐字同源', () => {
    expect(shellContract.SHELL_STATUS_SCHEMA).toBe(hostContract.SHELL_STATUS_SCHEMA)
    expect(shellContract.SHELL_STATUS_SCHEMA).toBe('xuanshu/shell-status@1')
    expect(shellContract.SHELL_STATUS_FILE).toBe(hostContract.SHELL_STATUS_FILE)
    expect(shellContract.SHELL_STATUS_FILE).toBe('shell-status.json')
    // 自启方式与关窗行为的取值域：壳写、宿主读，漂移会表现为「状态永远 unknown」。
    expect([...shellContract.AUTOSTART_METHODS]).toEqual([...hostContract.AUTOSTART_METHODS])
    expect([...shellContract.AUTOSTART_METHODS]).toEqual(['login-item', 'shortcut', 'unsupported'])
    expect([...shellContract.CLOSE_BEHAVIORS]).toEqual(['hide', 'quit'])
    // 「现在这个壳」的判据：状态文件里的 pid 要与子进程 env 里的壳 pid 对得上。
    expect(shellContract.SHELL_PID_ENV).toBe(hostContract.SHELL_PID_ENV)
    expect(hostContract.SHELL_PID_ENV).toBe('XUANSHU_SHELL_PID')
  })
})

describe('#23 · 载荷校验：壳的拒收判据 == 宿主的发送前校验', () => {
  const valid = {
    schema: 'xuanshu/notify@1',
    id: 'notify-00000000-0000-4000-8000-000000000000',
    kind: 'rikke',
    title: '今日日课已生成',
    body: '',
    silent: false,
    target: 'overview',
    createdAt: '2026-10-17T00:00:00.000Z',
  }

  it('合法载荷两边都过', () => {
    expect(shellValidate(valid)).toEqual({ ok: true })
    expect(hostValidate(valid)).toEqual({ ok: true })
  })

  it('非法载荷两边都拒（逐条同判）', () => {
    const cases = [
      { ...valid, schema: 'xuanshu/notify@0' },
      { ...valid, id: '' },
      { ...valid, id: 42 },
      { ...valid, kind: 'unknown' },
      { ...valid, kind: undefined },
      { ...valid, title: '' },
      { ...valid, title: 'x'.repeat(121) },
      { ...valid, body: 'y'.repeat(201) },
      { ...valid, body: 7 },
      { ...valid, silent: 'yes' },
      { ...valid, target: 'somewhere' },
      { ...valid, target: undefined },
      { ...valid, createdAt: 'not-a-date' },
      { ...valid, createdAt: undefined },
    ]
    for (const payload of cases) {
      const shell = shellValidate(payload)
      const host = hostValidate(payload)
      expect(shell.ok, JSON.stringify(payload)).toBe(false)
      expect(host.ok, JSON.stringify(payload)).toBe(false)
      expect(typeof shell.reason, JSON.stringify(payload)).toBe('string')
      expect(shell.reason.length).toBeGreaterThan(0)
    }
  })

  it('多余字段两边都忽略、不报错（契约 §2）', () => {
    expect(shellValidate({ ...valid, extra: 1 })).toEqual({ ok: true })
    expect(hostValidate({ ...valid, extra: 1 })).toEqual({ ok: true })
  })

  it('title 两端空白：裁掉后为空才算非法（与宿主同判）', () => {
    for (const title of ['   ', '\n\t']) {
      expect(shellValidate({ ...valid, title }).ok).toBe(hostValidate({ ...valid, title }).ok)
    }
    expect(shellValidate({ ...valid, title: ' 今日日课已生成 ' })).toEqual({ ok: true })
    expect(hostValidate({ ...valid, title: ' 今日日课已生成 ' })).toEqual({ ok: true })
  })
})

/**
 * R8（#39）· `OVERVIEW_HASH` 跨包单事实来源：客户端与壳侧**直接 import 对拍**。
 *
 * 为什么加这组：`#xuanshu-overview` 是壳「点通知 → 把页面带到首页」与客户端「认这个 hash →
 * 切 overview」之间唯一的握手值。两个包各写一份字面量（客户端 bundle 不能 import 壳、壳不能
 * import 客户端 bundle，所以只能各存一份），从前 `tests/assembly/overview-hash.test.mjs` 只钉
 * **客户端自己那份**的字面量 —— 壳侧那份漂移时没有任何用例会红，真机表现是「壳改了 hash、
 * 客户端不认，点通知后停在原地」。
 *
 * 会红的对照（R8 必留证据，两条都实测过）：
 *   ① 把 `packages/xuanshu-client/src/client/overview-hash.ts` 的 `OVERVIEW_HASH` 改一个字符 → 本组红；
 *   ② 把 `packages/xuanshu-shell/lib/main-flow.mjs` 的 `OVERVIEW_HASH` 改一个字符 → 本组红。
 * 断言分两层：常量逐字相等（含钉死的握手值，防「两侧一起改错」也算绿——同本文件 §2 的既有做法）；
 * 以及**行为闭环**（壳造出的地址里的 hash，客户端判据必须认），后者抓的是 `#` 前缀/归一化这类
 * 「常量相等但语义不通」的漂移。
 */
describe('R8（#39）· OVERVIEW_HASH：壳侧与客户端 import 对拍（不是各写一份字面量）', () => {
  it('两侧常量相等，且等于钉死的握手值（防两侧一起改错也算绿）', () => {
    expect(CLIENT_OVERVIEW_HASH).toBe(SHELL_OVERVIEW_HASH)
    expect(CLIENT_OVERVIEW_HASH).toBe('xuanshu-overview')
    expect(SHELL_OVERVIEW_HASH).toBe('xuanshu-overview')
    // 两侧都必须是非空字符串，且**不带** `#`（带 `#` 的写法只有客户端判断一处，见下条）。
    for (const value of [CLIENT_OVERVIEW_HASH, SHELL_OVERVIEW_HASH]) {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
      expect(value.startsWith('#')).toBe(false)
    }
  })

  it('握手闭环：壳造出的地址 hash 能被客户端判据认出来（含「替换旧 hash」）', () => {
    const url = overviewUrlWithHash('http://127.0.0.1:19388/#old')
    expect(url).toBeTypeOf('string')
    const hash = new URL(url).hash
    expect(isOverviewHash(hash)).toBe(true)
    expect(hash).toBe(`#${CLIENT_OVERVIEW_HASH}`)
    expect(hash).toBe(`#${SHELL_OVERVIEW_HASH}`)
  })

  it('负路径：客户端只认这一个 handshake，别的 hash 都不切面板', () => {
    for (const hash of ['#xuanshu-overview-typo', '#overview', '#xuanshu-overview/', '']) {
      expect(isOverviewHash(hash), `hash=${JSON.stringify(hash)}`).toBe(false)
    }
  })
})
