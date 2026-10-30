/**
 * 界面面清单契约（spec 003 · 票 01 / #48）。
 *
 * 体检线的报告分母 = **界面面数 × 判据适用数**。分母一旦有第二份抄本，两轮数字就不能比，
 * 而「新增一个界面面」会以「没人记得加一行」的形式静默缩小覆盖面。所以本文件的断言只有一个方向：
 * **清单与真实注册面互为双射**——注册面多一个、清单少一个，本文件就红。
 *
 * 实测口径（2026-10-30）：32 个 `slots.register` = 10 对面板（main + sidebar）+ 12 个寄生位，
 * 加 3 个命令名 = **25 个界面面**。spec 003 正文与票 01 写的「18 个寄生 / 30 面」是把
 * `4+2+2+3+1+3=15` 估成 18 的算术偏差；分母按真值算，差异记在 `docs/development-status.md` §17。
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BESTOF_COMMAND_NAMES } from '../../packages/xuanshu-client/src/client/bestof-model.js'
import {
  COMMAND_FACES,
  EXTRA_REGISTRATIONS,
  PANEL_KEYS,
  PARASITIC_FACE_META,
  expectedCells,
  faceManifest,
} from './lib/panel-surface.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 面板面对应的两个真实 cell（main + 侧栏行）——侧栏行是这个面的第二个渲染位置。 */
function panelCellsOf(key) {
  return [`main\u0000${key}`, `sidebar.panellist\u0000${key}`]
}

describe('票 01 · 界面面清单只有一个事实源', () => {
  it('25 个面：10 面板 + 12 寄生位 + 3 命令（真值，不是估的 30）', () => {
    const faces = faceManifest()
    expect(faces).toHaveLength(25)
    expect(faces.filter((face) => face.kind === 'panel')).toHaveLength(10)
    expect(faces.filter((face) => face.kind === 'parasitic')).toHaveLength(12)
    expect(faces.filter((face) => face.kind === 'command')).toHaveLength(3)
  })

  it('类别分布与真实槽位一致（4 抽屉 / 2 设置区块 / 2 设置项 / 3 输入框 dock / 1 回合尾 / 3 命令 / 10 面板）', () => {
    const count = (category) => faceManifest().filter((face) => face.category === category).length
    expect(count('panel')).toBe(10)
    expect(count('drawer')).toBe(4)
    expect(count('settings-section')).toBe(2)
    expect(count('settings-item')).toBe(2)
    expect(count('composer-dock')).toBe(3)
    expect(count('turn-tail')).toBe(1)
    expect(count('command')).toBe(3)
  })

  it('清单与 `expectedCells()` 互为双射：真注册面里的每一个 cell 都有且只有一个面', () => {
    const manifestCells = faceManifest()
      .map((face) => face.cell)
      .filter((cell) => cell !== null)
    const registered = expectedCells()
    // 面板的「侧栏行」不是独立面：它是同一个面板面的第二个渲染位置（同一份 label / sources）。
    const sidebarCells = registered.filter((cell) => cell.startsWith('sidebar.panellist\u0000'))
    const panelCells = PANEL_KEYS.flatMap((key) => [panelCellsOf(key)[0]])
    const expected = registered.filter((cell) => !sidebarCells.includes(cell))

    expect([...manifestCells].sort()).toEqual([...expected].sort())
    // 反向：每个面板 key 的 main cell 都在清单里，且侧栏 id 与 main key 同名（DSH 契约）。
    for (const key of PANEL_KEYS) {
      expect(manifestCells, `面板「${key}」的 main cell 不在清单里`).toContain(panelCells[0])
      expect(registered).toContain(`sidebar.panellist\u0000${key}`)
    }
  })

  it('寄生位：`EXTRA_REGISTRATIONS` 里每一个 cell 都在清单里，且没有孤儿面', () => {
    const manifestCells = faceManifest().map((face) => face.cell)
    const extraCells = EXTRA_REGISTRATIONS.flatMap((entry) => entry.cells)
    expect([...manifestCells.filter((cell) => cell !== null)].sort()).toEqual(
      [...PANEL_KEYS.map((key) => `main\u0000${key}`), ...extraCells].sort(),
    )
    for (const cell of extraCells) expect(PARASITIC_FACE_META, `寄生位「${cell}」缺 label / sources`).toHaveProperty([cell])
  })

  it('命令面与 `BESTOF_COMMAND_NAMES` 两边对拍（命令不是槽位，注册面里查不到）', () => {
    expect(COMMAND_FACES.map((command) => command.name).sort()).toEqual([...BESTOF_COMMAND_NAMES].sort())
    expect(faceManifest().map((face) => face.id)).toEqual(
      expect.arrayContaining(BESTOF_COMMAND_NAMES.map((name) => `command:${name}`)),
    )
  })

  it('每个面都有稳定 id / 人读名 / 非空源文件，且源文件真的存在（静态采集的光标不会指向不存在的地方）', () => {
    const ids = new Set()
    for (const face of faceManifest()) {
      expect(face.id).toMatch(/^(panel|slot|command):/)
      expect(ids.has(face.id), `界面面 id 重复：${face.id}`).toBe(false)
      ids.add(face.id)
      expect(face.label.length, `${face.id} 缺人读名`).toBeGreaterThan(0)
      expect(face.sources.length, `${face.id} 缺源文件`).toBeGreaterThan(0)
      for (const source of face.sources) {
        expect(existsSync(join(REPO_ROOT, source)), `${face.id} 的源文件不存在：${source}`).toBe(true)
      }
    }
  })

  it('增删一个注册面时清单与分母同时变化：`faceManifest()` 是唯一的计数入口', () => {
    // 分母不落在任何常量上：它由清单长度算出。这里钉住「清单长度 = 三份派生来源之和」，
    // 任何一侧新增而另一侧没跟上，等式立刻不成立。
    expect(faceManifest()).toHaveLength(
      PANEL_KEYS.length + EXTRA_REGISTRATIONS.flatMap((entry) => entry.cells).length + COMMAND_FACES.length,
    )
    // 清单只读：调用方改不动真源（每次返回新数组，元素里的 sources 也是拷贝）。
    const first = faceManifest()
    first[0].sources.push('packages/不存在.ts')
    expect(faceManifest()[0].sources).not.toContain('packages/不存在.ts')
  })
})
