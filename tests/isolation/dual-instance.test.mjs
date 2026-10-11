/**
 * 隔离验收 · I5 / I6 / I7（双实例真跑 + 真 home 零写入 + desktop 19387 没被碰）
 *
 * 覆盖的断言面（契约 §5）：
 *   I5  两个隔离 home 各真跑一次 `--mode headless`（= 走一遍 boot + dispose + exit 0，不调 LLM、
 *       不开端口），各自写出**自己的** `sessions`/`storages`/`assembly-report.json`，两份清单不相交
 *   I6  跑完之后用户真实 `~/.dsh` 顶层 + sessions/storages 的 mtime+size 指纹**无新增无删除**
 *   I7  xuanshu 的 web 端口 ≠ desktop 的 19387（计划命令里也不许出现 19387）
 *
 * 本文件只跑 `scripts/verify-isolation.mjs --json --only dual-instance,no-crosstalk,no-real-home-write`：
 * 真跑、临时 home、指纹采集、清单比对全部在验收台里，测试断言它的结论 + 现场回收是否干净。
 *
 * 两条安全断言（本文件独有，因为只有它会创建/删除临时 home）：
 *   1) 临时 home 的 `profiles/<name>` 是指向仓库 profile 的 junction：跑完必须证明 profile 本体还在
 *      （rmSync 跟随联接去删就是灾难，这里钉住它没发生）；
 *   2) 绿的时候临时 home 必须被清掉（不往仓库里留垃圾）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  DSH_HOME, PROFILE, PROFILE_DIR, REAL_HOME, REPO_ROOT, TMP_ROOT,
  expectCheckPass, runVerifier, withProfileGate,
} from './lib/verifier.mjs'

const SELECTED = ['dual-instance', 'no-crosstalk', 'no-real-home-write']
const DUAL_DIR_A = join(TMP_ROOT, 'dual-a')
const DUAL_DIR_B = join(TMP_ROOT, 'dual-b')
/** desktop（Electron）独占的端口：xuanshu 必须用别的端口才能和它同跑。 */
const DESKTOP_PORT = 19387

/** Windows 路径比较（大小写不敏感）；这里只用于「报告里的 home 是不是它自己那个」。 */
const samePath = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

withProfileGate('玄枢隔离验收 · I5/I6/I7（dual-instance / no-crosstalk / no-real-home-write）', () => {
  let result

  beforeAll(() => {
    result = runVerifier(['--json', '--only', SELECTED.join(','), '--home', DSH_HOME, '--profile', PROFILE])
  }, 660_000)

  it('验收台给出结构化结果，且三个 check 都真跑了（没有 skip 冒充绿）', () => {
    expect(result.json, `验收台没有输出可解析的 JSON：\n${result.raw()}`).toBeDefined()
    expect(result.error ?? null, result.raw()).toBeNull()
    expect(result.json.checkedIds).toEqual(SELECTED)
    expect(result.json.skipped).toBe(false)
    for (const id of SELECTED) expectCheckPass(result, id)
    expect(result.json.ok, result.raw()).toBe(true)
    expect(result.status).toBe(0)
  })

  it('I5 两个隔离 home 各真跑一次 headless：exit 0、报告本次新写出、各自认自己的 home', () => {
    const entry = expectCheckPass(result, 'dual-instance')
    const homes = entry.evidence.homes
    expect(homes.map((row) => row.name)).toEqual(['A', 'B'])

    for (const row of homes) {
      const dir = row.name === 'A' ? DUAL_DIR_A : DUAL_DIR_B
      expect(row.home).toBe(dir)
      expect(dir.startsWith(TMP_ROOT), `${dir} 不在 ${TMP_ROOT} 下（临时 home 必须留在 .tmp/）`).toBe(true)
      expect(row.exitCode, `${row.name} headless exit=${row.exitCode}`).toBe(0)
      expect(row.spawnExit).toBe(0)
      expect(row.fresh, `${row.name} 的 assembly-report.json 不是本次新写出（mtime 没前进）`).toBe(true)
      expect(row.underHome, `${row.name} 的报告没落在自己的 home 下`).toBe(true)
      expect(row.reportSchema).toBe('xuanshu/assembly-report@1')
      expect(row.reportOk).toBe(true)
      expect(row.stateIsolated).toBe(true)
      // 报告自报的 home 就是它自己那个 —— 这是「没有串到别人家」最直接的证据。
      expect(samePath(row.assemblyHome, dir), `${row.name} 报告里的 dshHome=${row.assemblyHome} ≠ ${dir}`).toBe(true)
      // sessions / storages 的解析结果必须落在自己的 home 下（`--help` 不建会话，所以在不在是无所谓的）。
      for (const stateDir of row.stateDirs) {
        expect(stateDir.underHome, `${row.name} 的 ${stateDir.key}=${stateDir.path} 跑到自己 home 之外`).toBe(true)
      }
    }
    expect(homes[0].home).not.toBe(homes[1].home)
    // 两次真跑各自生成报告：generatedAt 撞车就说明第二次没真跑。
    expect(homes[0].assemblyGeneratedAt).not.toBe(homes[1].assemblyGeneratedAt)
  })

  it('I5 两份文件清单不相交，且各自都有 xuanshu/assembly-report.json', () => {
    const entry = expectCheckPass(result, 'dual-instance')
    const { manifestA, manifestB, overlap } = entry.evidence
    expect(overlap, `两份清单相交：${overlap.join('、')}`).toEqual([])
    expect(manifestA).toContain('xuanshu/assembly-report.json')
    expect(manifestB).toContain('xuanshu/assembly-report.json')
    // 清单里不该出现 profile 树的内容：临时 home 的 profiles/<name> 是联接，遍历必须跳过它，
    // 否则「两份清单」会把同一份共享代码算两遍，隔离结论就成了假的。
    for (const row of [...manifestA, ...manifestB]) {
      expect(row.startsWith('profiles/'), `清单里混进了共享 profile 的文件：${row}`).toBe(false)
    }
  })

  it('I5 B 跑完之后 A 的状态指纹逐条未变（串扰的直接否证）', () => {
    const entry = expectCheckPass(result, 'no-crosstalk')
    const fingerprint = entry.evidence.stateFingerprintA
    expect(fingerprint.changed, `B 动了 A 的状态：${JSON.stringify(fingerprint.changed)}`).toEqual([])
    expect(fingerprint.after).toBe(fingerprint.before)
    expect(fingerprint.before).toBeGreaterThan(0)
  })

  it('I6 真实 ~/.dsh 无新增无删除（只读指纹），且没有任何一次运行把家安在真实 home 上', () => {
    const entry = expectCheckPass(result, 'no-real-home-write')
    const evidence = entry.evidence
    expect(evidence.realHome).toBe(REAL_HOME)
    expect(evidence.addedStable, `真实 home 多出条目：${evidence.addedStable.join('、')}`).toEqual([])
    expect(evidence.removedStable, `真实 home 少了条目：${evidence.removedStable.join('、')}`).toEqual([])
    expect(evidence.xuanshuDirExists, '真实 home 里出现了 xuanshu/ 数据目录').toBe(false)
    // 每一次运行（doctor / 双实例 / 对照组）的 home 都不是真实 home。
    expect(Object.keys(evidence.runsHomes).length).toBeGreaterThan(0)
    for (const [label, home] of Object.entries(evidence.runsHomes)) {
      expect(home, `${label} 的 home 落在了真实 home 上`).not.toBe(REAL_HOME)
      expect(samePath(home, REAL_HOME), `${label} 的 home 在真实 home 里：${home}`).toBe(false)
    }
    // mtime/size 的变化只当证据记录：本机 desktop 会话与我们并发写同一个真实 home，
    // 指纹法无法把这种变化归因到本次运行（所以判据是「无新增/无删除」+「我们的 home 都在隔离目录」）。
    if (evidence.touchedCount > 0) {
      console.warn(`\nℹ️  真实 home 有 ${evidence.touchedCount} 个既有条目的 mtime/size 变了（并发 desktop 会话在写）：`
        + `${JSON.stringify(evidence.touched)}\n`)
    }
  })

  it('I7 xuanshu 的 web 端口 ≠ desktop 的 19387，计划命令里也不出现 19387', () => {
    const entry = expectCheckPass(result, 'no-crosstalk')
    const { webPorts, planCommandPrimary } = entry.evidence
    expect(webPorts.desktop).toBe(DESKTOP_PORT)
    for (const [who, port] of Object.entries({ A: webPorts.A, B: webPorts.B, primary: webPorts.primary })) {
      expect(port, `${who} 的 webPort 撞上了 desktop 的 ${DESKTOP_PORT}`).not.toBe(DESKTOP_PORT)
      expect(Number.isInteger(port) && port > 0, `${who} 的 webPort=${port} 不合法`).toBe(true)
    }
    expect(planCommandPrimary.some((token) => String(token).includes(String(DESKTOP_PORT)))).toBe(false)
    // desktop 到底在不在跑只是现场信息（本机 Electron 在跑），不参与判断。
    expect(typeof entry.evidence.desktopBusy).toBe('boolean')
  })

  it('现场回收干净：绿的时候临时 home 已删，且仓库 profile 本体毫发无损（junction 没被跟随删除）', () => {
    expectCheckPass(result, 'dual-instance') // 这条断言只在 I5 绿时有意义（红了验收台会故意留现场）
    expect(existsSync(DUAL_DIR_A), `临时 home 没清掉：${DUAL_DIR_A}`).toBe(false)
    expect(existsSync(DUAL_DIR_B), `临时 home 没清掉：${DUAL_DIR_B}`).toBe(false)
    // 最重要的一条：删临时 home 绝不能跟着 junction 把仓库 profile 删了。
    expect(existsSync(join(REPO_ROOT, 'profile', 'package.json')), '仓库 profile 被删了！junction 被跟随').toBe(true)
    expect(existsSync(join(REPO_ROOT, 'profile', 'node_modules')), '仓库 profile 的 node_modules 被删了！').toBe(true)
    // 默认 home 的 profile 联接也还在（我们没碰它）。
    expect(existsSync(join(PROFILE_DIR, 'package.json'))).toBe(true)
  })
})
