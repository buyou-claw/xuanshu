/**
 * tests/horosa/lib/sandbox.mjs — 每个用例一个**一次性沙箱目录**。
 *
 * 硬约束：
 *   - 绝不允许碰真实 `~/.dsh`、`C:\horosa`、`%LOCALAPPDATA%\xuanshu`、真实 8765（e2e 除外，且 e2e 也只在
 *     临时目录里写数据、跑完必须把自己起的 serve 停掉）；
 *   - 临时产物一律落 `tests/horosa/.tmp/**`（`.gitignore` 已覆盖 `tests/**​/.tmp/`），绿的留现场便于复盘。
 *
 * 沙箱里的每一件都是**被测实现真正会读/写的东西**：
 *   `dataDir`（`<dshHome>/xuanshu/horosa`）· `runtimeRoot`（`C:\horosa` 的替身）· `wheel`（假 wheel 文件）·
 *   `setupReportFile`（假的 setup 报告）· `uvxLog`（假 uvx 的调用台账）· `serveLog`
 * 而不是「测试自己的目录」。这样断言台读的就是产物本身。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PIN_FILE, RUNTIME_MANIFEST_TEMPLATE, SETUP_REPORT_TEMPLATE, TMP_ROOT } from './paths.mjs'

/** 上一次运行留下的沙箱超过这个岁数就删（当次运行的现场一律保留）。 */
const STALE_MS = 6 * 60 * 60 * 1000

function pruneStale() {
  if (!existsSync(TMP_ROOT)) return
  const now = Date.now()
  for (const entry of readdirSync(TMP_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = join(TMP_ROOT, entry.name)
    try {
      if (now - statSync(full).mtimeMs < STALE_MS) continue
      rmSync(full, { recursive: true, force: true })
    } catch {
      /* Windows 上偶发 EBUSY：临时区是 gitignore 的，留着无害 */
    }
  }
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 仓内 pin（版本 / wheel 名的唯一来源；测试**不**自己抄一份版本号）。 */
export function readPin() {
  return readJson(PIN_FILE)
}

/**
 * 造一个沙箱。返回的是「被测实现的外界」的全套替身，不是一组空目录。
 * @param {string} label 用例名（只用于肉眼分辨 `.tmp/` 下的目录）
 */
export function makeSandbox(label) {
  mkdirSync(TMP_ROOT, { recursive: true })
  pruneStale()
  const root = mkdtempSync(join(TMP_ROOT, `${label}-`))
  const home = join(root, 'dsh-home')
  const dataDir = join(home, 'xuanshu', 'horosa')
  const runtimeRoot = join(root, 'runtime-root')
  const work = join(root, 'work')
  for (const dir of [home, dataDir, runtimeRoot, work]) mkdirSync(dir, { recursive: true })

  const pin = readPin()
  // 假 wheel：真实现只校验「文件在不在」（SHA256 是 setup 票 05 的事），给几十字节的占位就够。
  const wheel = join(root, pin.wheel.name)
  writeFileSync(wheel, 'fake wheel bytes (tests/horosa)')

  const sandbox = {
    root,
    home,
    dataDir,
    runtimeRoot,
    work,
    wheel,
    pin,
    /** 假 uvx 的调用台账（env `XUANSHU_FAKE_UVX_LOG`）。 */
    uvxLog: join(root, 'uvx-calls.jsonl'),
    serveLog: join(dataDir, 'serve.log'),
    statusFile: join(dataDir, 'horosa-status.json'),
    setupReportFile: join(home, 'xuanshu', 'setup-report.json'),
    dir: (name) => join(root, name),
    /** 把一份模板里的占位符填成这个沙箱的路径。 */
    fill(text) {
      return String(text)
        .replaceAll('__VERSION__', pin.version)
        .replaceAll('__WHEEL__', wheel.replace(/\\/g, '\\\\'))
        .replaceAll('__RUNTIME_ROOT__', runtimeRoot.replace(/\\/g, '\\\\'))
        .replaceAll('__DATA_DIR__', dataDir.replace(/\\/g, '\\\\'))
        .replaceAll('__DSH_HOME__', home.replace(/\\/g, '\\\\'))
        .replaceAll('__GENERATED_AT__', new Date().toISOString())
    },
    /**
     * 写一份**形状真实**的 setup 报告（模板来自真机 `captures/setup-e2e-run2.json` 的裁剪）。
     * 被测实现照 R2/§3.1 从它取 `pin.version` 与 `pin.wheel.path`。
     */
    writeSetupReport({ version = pin.version, wheelPath = wheel, ok = true } = {}) {
      const report = JSON.parse(this.fill(readFileSync(SETUP_REPORT_TEMPLATE, 'utf8')))
      report.ok = ok
      report.pin.version = version
      report.pin.wheel.path = wheelPath
      report.runtime.root = runtimeRoot
      report.runtime.version = version
      report.runtime.evidence.versionKey = 'runtime_payload_version'
      mkdirSync(join(home, 'xuanshu'), { recursive: true })
      writeFileSync(this.setupReportFile, `${JSON.stringify(report, undefined, 2)}\n`)
      return report
    },
    /** 写 `current/runtime-manifest.json`（真机形状见 `C:\horosa\current\runtime-manifest.json`）。 */
    writeRuntimeManifest({ version = pin.version, key = 'runtime_payload_version', extra = {} } = {}) {
      const manifest = JSON.parse(this.fill(readFileSync(RUNTIME_MANIFEST_TEMPLATE, 'utf8')))
      if (key === 'version') delete manifest.runtime_payload_version
      manifest.version = version
      if (key === 'runtime_payload_version') manifest.runtime_payload_version = version
      Object.assign(manifest, extra)
      const dir = join(runtimeRoot, 'current')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'runtime-manifest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
      return manifest
    },
    status() {
      return existsSync(this.statusFile) ? readJson(this.statusFile) : undefined
    },
    /** 假 uvx 的台账（每行一个 JSON）：argv + 四个 env + 解析出来的 wheel/host/port。 */
    uvxCalls() {
      if (!existsSync(this.uvxLog)) return []
      return readFileSync(this.uvxLog, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line))
    },
    /** 台账的**文本尾巴**（等就绪超时时塞进失败信息：一眼能看出假 uvx 到底被调起来没有、卡在哪）。 */
    uvxLogTail(maxChars = 1500) {
      if (!existsSync(this.uvxLog)) return '(台账不存在：假 uvx 一次都没被调起来)'
      return readFileSync(this.uvxLog, 'utf8').slice(-maxChars)
    },
    /** serve 日志尾巴（`<dataDir>/serve.log`，R3 的落点）。 */
    serveLogTail(maxChars = 1500) {
      if (!existsSync(this.serveLog)) return '(serve.log 不存在)'
      return readFileSync(this.serveLog, 'utf8').slice(-maxChars)
    },
  }
  // 目录已建好；`work` 之外的其它目录由用例按需填充。
  return sandbox
}

/** 递归列出目录下所有**文件**（相对路径，posix 分隔符）；目录不存在 → 空数组。 */
export function listFiles(dir, { base = dir } = {}) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full, { base }))
    else out.push(full.slice(base.length + 1).split('\\').join('/'))
  }
  return out.sort()
}

/** 等一个条件成立（轮询），超时抛错（错误信息里带上现场）。 */
export async function waitFor(condition, { timeoutMs = 10_000, intervalMs = 100, describe = '条件' } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  for (;;) {
    last = await condition()
    if (last) return last
    if (Date.now() >= deadline) throw new Error(`等 ${describe} 超时（${timeoutMs}ms）`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
