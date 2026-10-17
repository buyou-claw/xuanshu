/**
 * tests/shell/lib/sandbox.mjs — #23 桌面壳断言台的**临时沙箱**（不读真机 home、不碰真壳）。
 *
 * 硬约束（与 `tests/notify/lib/sandbox.mjs` 同一套纪律）：
 *   - 一次性 home 落在 `tests/shell/.tmp/**`（`.gitignore` 覆盖 `tests/**​/.tmp/`），
 *     `makeScratch()` 起来、`cleanup()` 删掉，过旧的现场由 `pruneStaleDirs()` 顺手清；
 *   - 不读 `.dsh-home`、不读 `~/.xuanshu`、不动机器 env（env 一律由用例注入）。
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { pruneStaleDirs } from '../../lib/sandbox-prune.mjs'
import { DEFAULT_SHELL_SETTINGS, SHELL_SETTINGS_SCHEMA } from '../../../packages/xuanshu-shell/lib/contract.mjs'

const TMP_ROOT = join(import.meta.dirname, '..', '.tmp')

/** 壳写、宿主读的 token 形状（64 hex，契约 §1）。 */
export const FAKE_TOKEN = 'a'.repeat(64)

/** 契约 §1 的状态文件路径。 */
export function notifyStatePath(dataDir) {
  return join(dataDir, 'runtime', 'shell-notify.json')
}

/**
 * 一个一次性 home + 它的 dataDir（`<home>/xuanshu`）。
 * @param {string} [label]
 */
export function makeScratch(label = 'shell') {
  mkdirSync(TMP_ROOT, { recursive: true })
  pruneStaleDirs(TMP_ROOT)
  const root = mkdtempSync(join(TMP_ROOT, `${label}-`))
  const home = join(root, 'home')
  const dataDir = join(home, 'xuanshu')
  mkdirSync(dataDir, { recursive: true })
  return {
    root,
    home,
    dataDir,
    path: (...parts) => join(dataDir, ...parts),
    write(rel, text) {
      const file = join(dataDir, rel)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
      return file
    },
    read(...parts) {
      return readFileSync(join(dataDir, ...parts), 'utf8')
    },
    readJson(...parts) {
      return JSON.parse(readFileSync(join(dataDir, ...parts), 'utf8'))
    },
    exists(...parts) {
      try {
        readFileSync(join(dataDir, ...parts))
        return true
      } catch {
        return false
      }
    },
    files() {
      const out = []
      const walk = (dir, prefix) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name)
          const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
          if (entry.isDirectory()) walk(full, rel)
          else out.push(rel)
        }
      }
      walk(dataDir, '')
      return out.sort()
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** 写一份合法设置（缺省键用契约默认值）。 */
export function writeShellSettings(box, patch = {}) {
  const file = join(box.dataDir, 'shell-settings.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ schema: SHELL_SETTINGS_SCHEMA, ...DEFAULT_SHELL_SETTINGS, ...patch }, null, 2)}\n`)
  return file
}

/** 契约 §2 的请求体（宿主发的就是它；两侧夹测的公共夹具）。 */
export function notifyPayload(over = {}) {
  return {
    schema: 'xuanshu/notify@1',
    id: 'notify-00000000-0000-4000-8000-000000000000',
    kind: 'rikke',
    title: '今日日课已生成',
    body: '',
    silent: false,
    target: 'overview',
    createdAt: '2026-10-17T00:00:00.000Z',
    ...over,
  }
}
