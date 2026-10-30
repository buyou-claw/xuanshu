#!/usr/bin/env node
/**
 * `scripts/ux/collect/browser.mjs` —— **浏览器半边**的证据采集器（spec 003 · 模块 3b）。
 *
 * 它只做三件事，一件都不多做：
 *   1. 起一个**隔离实例**（独立 home + 独立端口），拿到带 cookie 的页面地址；
 *   2. 让 AI 以「第一次用的人」的身份跑**任务剧本**（不是逐屏截图），把点击 / 焦点 / 尺寸 / 滚动
 *      这些只有真浏览器才给得出的事实记下来；
 *   3. 把事实交成与静态半边**同一种形状**的证据，判定仍只发生在 `scripts/ux/judge.mjs`。
 *
 * 三条硬规矩（spec 003 §12–§15）：
 *   - **产物必须新于源码**：客户端产物不重建，实例里跑的就是旧 UI —— 落后就拒绝采集，不静默出数；
 *   - **只连隔离实例**：真实 home 一律只读（这里用的是临时目录 + link 模式 profile）；
 *   - **采不到就说采不到**：起不来 / 没有浏览器 / 剧本没跑完，都是带原因的 `collection-failed`，
 *     绝不当成「通过」。
 *
 * 依赖：系统 Edge（`channel: 'msedge'`）+ 全局 `playwright`。缺席时本模块返回不可用原因，
 * 由调用方写进报告 —— 不假装采集过（本机实测：`npm root -g` 在 Windows 上不可靠，故按目录探）。
 *
 * 仅使用 Node 内置模块（playwright 由宿主环境提供）。ESM。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer, request } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { SCRIPTS } from './browser-scripts.mjs'

export const BROWSER_COLLECTOR = 'browser'

/** 浏览器半边的可读失败（调用方按「没跑成」处理，退出码 2）。 */
export class BrowserCollectorError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BrowserCollectorError'
  }
}

const CLIENT_ARTIFACT = 'packages/xuanshu-client/lib/client.js'
const CLIENT_SRC_DIR = 'packages/xuanshu-client/src/client'

/** 目录下最新的 mtime（跳过 node_modules / .tmp）。 */
function newestMtime(directory) {
  let newest = 0
  const stack = [directory]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.tmp') continue
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) stack.push(absolute)
      else if (entry.isFile()) newest = Math.max(newest, statSync(absolute).mtimeMs)
    }
  }
  return newest
}

/**
 * 客户端产物是否落后于源码。落后就不许采集（spec 003 §13）。
 * @param {{repoRoot: string}} input
 * @returns {{fresh: boolean, artifactAt: number, sourceAt: number, reason?: string}}
 */
export function checkClientArtifact({ repoRoot }) {
  const artifact = join(repoRoot, CLIENT_ARTIFACT)
  if (!existsSync(artifact)) {
    return { fresh: false, artifactAt: 0, sourceAt: 0, reason: `${CLIENT_ARTIFACT} 不存在：先跑 node scripts/build-client.mjs` }
  }
  const artifactAt = statSync(artifact).mtimeMs
  const sourceAt = newestMtime(join(repoRoot, CLIENT_SRC_DIR))
  if (sourceAt > artifactAt) {
    return {
      fresh: false,
      artifactAt,
      sourceAt,
      reason: `客户端产物落后于源码（src 最新 ${new Date(sourceAt).toISOString()} > 产物 ${new Date(artifactAt).toISOString()}）：` +
        '实例里跑的是旧 UI，先跑 node scripts/build-client.mjs 再巡检',
    }
  }
  return { fresh: true, artifactAt, sourceAt }
}

/** 找全局 playwright：本仓没装（也不想给巡检增依赖），所以按已知全局目录探。 */
export function resolvePlaywright() {
  const require = createRequire(import.meta.url)
  const candidates = [
    'playwright',
    join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'playwright'),
    join(process.env.LOCALAPPDATA ?? '', 'pnpm', 'global', '5', 'node_modules', 'playwright'),
  ]
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch {
      /* 下一个候选 */
    }
  }
  return null
}

/** OS 挑一个空闲端口（不占 19387 / 19388 这两个既定位）。 */
function reserveFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer((_req, res) => res.end(''))
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

function httpGet(target, cookie) {
  return new Promise((resolveGet) => {
    const req = request(target, { headers: cookie === undefined ? {} : { cookie } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolveGet({ status: res.statusCode, headers: res.headers, body }))
    })
    req.setTimeout(5000, () => req.destroy(new Error('timeout')))
    req.on('error', (error) => resolveGet({ error: error?.message ?? String(error) }))
    req.end()
  })
}

/**
 * 起一个隔离实例。
 *
 * 为什么用「临时 home + link 模式 profile」：DSH 只从 `$DSH_HOME/profiles/<name>` 启动，而
 * link 模式让这个位置是一个指向仓库 `profile/` 的 junction —— 于是 node_modules 不必重装，
 * 但 sessions / storages / 凭据全在临时 home 里（真实数据一个字节都不碰）。
 *
 * @returns {Promise<{url: string, port: number, home: string, stop: () => Promise<void>}>}
 */
export async function startIsolatedInstance({ repoRoot, log = () => {} }) {
  const home = mkdtempSync(join(tmpdir(), 'xuanshu-ux-'))
  // link 模式让临时 home 的 profile 指向仓库 `profile/`（不重装依赖），代价是 DSH 启动/首跑会**改写**
  // 那个目录里的两个文件：`cordis.yml`（运行期产物，gitignore）与 `cordis.patch.yml`（入库件！）。
  // 实测：关掉首跑的欢迎说明会让 DSH 往 patch 里追加 `welcomeNoticeVersion` —— 于是「只读巡检」
  // 会留下一个脏工作区。所以启动前快照、stop() 时原样写回：巡检一个字都不许留在仓库里。
  const patchFile = join(repoRoot, 'profile', 'cordis.patch.yml')
  const rootConfig = join(repoRoot, 'profile', 'cordis.yml')
  const patchBefore = existsSync(patchFile) ? readFileSync(patchFile) : null
  const rootBefore = existsSync(rootConfig) ? readFileSync(rootConfig) : null
  const restoreProfile = () => {
    try {
      if (patchBefore === null) rmSync(patchFile, { force: true })
      else writeFileSync(patchFile, patchBefore)
      if (rootBefore === null) rmSync(rootConfig, { force: true })
      else writeFileSync(rootConfig, rootBefore)
    } catch { /* 还原失败不该覆盖主结论，但会在报告 notes 里被看到（调用方对比 git status） */ }
  }

  const install = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'install-profile.mjs'), '--home', home, '--skip-install'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (install.status !== 0) {
    restoreProfile()
    throw new BrowserCollectorError(`隔离 home 装配失败（install-profile exit ${install.status}）：${(install.stderr || install.stdout || '').trim().slice(-400)}`)
  }
  const binJs = join(home, 'profiles', 'xuanshu', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(binJs)) throw new BrowserCollectorError(`隔离 home 里没有 DSH CLI：${binJs}`)

  const port = await reserveFreePort()
  log(`起隔离实例：home=${home} port=${port}`)
  const child = spawn(process.execPath, [binJs, '--profile', 'xuanshu', '--port', String(port), '--no-open'], {
    cwd: repoRoot,
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  const deadline = Date.now() + 90_000
  let url
  while (Date.now() < deadline) {
    await sleep(400)
    url = new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[A-Za-z0-9_-]+`).exec(stdout)?.[0]
    if (url !== undefined || child.exitCode !== null) break
  }
  if (url === undefined) {
    const tail = `${stdout}\n${stderr}`.trim().slice(-600)
    child.kill()
    throw new BrowserCollectorError(`实例没在 90s 内打出 token URL（exit=${child.exitCode}）：${tail}`)
  }

  // 信任握手：`GET /?token=…` 回 303 + set-cookie；少了 cookie 只会停在 401/303。
  const token = /token=([A-Za-z0-9_-]+)/.exec(url)[1]
  const handshake = await httpGet(`http://127.0.0.1:${port}/?token=${token}`)
  const jar = (handshake.headers?.['set-cookie'] ?? []).map((cookie) => cookie.split(';')[0]).join('; ')
  if (jar === '') {
    child.kill()
    throw new BrowserCollectorError(`token 握手没有发出会话 cookie（status ${handshake.status}）：拿不到页面`)
  }

  const stop = async () => {
    try { child.kill() } catch { /* 已经退出 */ }
    await sleep(300)
    restoreProfile()
    // 先摘 junction 再删目录：直接递归删会跟穿到仓库 profile（本仓踩过，见 docs/agents/parallel-work.md §2）。
    const profilesDir = join(home, 'profiles')
    if (existsSync(profilesDir)) {
      for (const name of readdirSync(profilesDir)) {
        const link = join(profilesDir, name)
        try {
          if (process.platform === 'win32') spawnSync('cmd', ['/c', 'rmdir', link], { encoding: 'utf8' })
          else rmdirSync(link)
        } catch { /* 不是 junction 就算 */ }
      }
    }
    try { rmSync(home, { recursive: true, force: true }) } catch { /* 临时目录留着不致命 */ }
  }

  return { url, port, home, stop }
}

/** 让页面等一会儿：DSH 的客户端插件是异步装的，等 DOM 稳定比等某个具体选择器稳。 */
const settle = (page, ms = 1200) => page.waitForTimeout(ms)

/**
 * 跑一条剧本，收集证据。
 *
 * @param {object} input
 * @param {import('playwright').Page} input.page
 * @param {{id: string, faces: string[], criteria: string[]}} input.script
 * @param {(faceId: string, targets: object[]) => void} input.record
 * @returns {Promise<{steps: object[], outcome: string}>}
 */
export async function runScript({ page, script, record }) {
  const steps = []
  const step = (name, detail = {}) => {
    steps.push({ step: name, ...detail })
  }
  const result = await script.run({
    page,
    settle,
    step,
    record,
    /** 量当前屏**属于玄枢的**可点目标的可点区域（D/C 族的原始事实）。
     *
     * 为什么必须划「属于玄枢」这条线：整页里还有 DSH 自己的侧栏行（36px）、新建会话按钮（38px）……
     * 那些不是玄枢的界面面（spec 003 §Out of Scope：不改 15 屏稿之外的界面）。判据量错对象，
     * 报告就会去建议改别人的界面 —— 那是最容易被无视的一种红。所以只收「最近的祖上有 xs- 类」的元素：
     * 玄枢的面板根是 `<main class="xs-…">`，寄生位（抽屉 / dock / 区块）也都带 `xs-` 前缀的类。
     */
    measure: async (faceId) => {
      const targets = await page.evaluate(() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        }
        const ownedByXuanshu = (element) => {
          let node = element
          while (node !== null && node !== document.body) {
            const className = typeof node.className === 'string' ? node.className : ''
            if (/(^|\s)xs-/.test(className)) return true
            node = node.parentElement
          }
          return false
        }
        return [...document.querySelectorAll('button,[role="button"],a[href],input:not([type="hidden"]),select,textarea')]
          .filter((element) => visible(element) && !element.hasAttribute('disabled') && ownedByXuanshu(element))
          .map((element) => {
            const rect = element.getBoundingClientRect()
            const label = (element.getAttribute('aria-label') ?? element.textContent ?? element.getAttribute('placeholder') ?? '')
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 32)
            return {
              tag: element.tagName.toLowerCase(),
              label,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }
          })
      })
      if (Array.isArray(faceId)) for (const id of faceId) record(id, targets)
      else record(faceId, targets)
      return targets
    },
  })
  return { steps, outcome: result?.outcome ?? 'unknown' }
}

/**
 * 跑浏览器半边（可被测试直接调用：不读 argv）。
 *
 * @param {{repoRoot: string, criteria: object, faces: object[], scriptIds?: string[], log?: Function}} input
 * @returns {Promise<{evidence: object[], notes: string[], available: boolean, reason?: string}>}
 */
export async function collectBrowser({ repoRoot, criteria, faces, scriptIds, log = () => {} }) {
  const notes = []
  const fresh = checkClientArtifact({ repoRoot })
  if (!fresh.fresh) throw new BrowserCollectorError(fresh.reason)

  const playwright = resolvePlaywright()
  if (playwright === null) {
    return { evidence: [], notes: ['浏览器半边不可用：找不到全局 playwright（本仓不装它）——这一轮没有浏览器证据'], available: false, reason: 'no-playwright' }
  }

  const browserCriteria = criteria.criteria.filter((criterion) => criterion.tombstone !== true && criterion.check === BROWSER_COLLECTOR)
  if (browserCriteria.length === 0) {
    return { evidence: [], notes: ['判据集里没有 browser 判据：浏览器半边没有可采的事实'], available: true }
  }

  const ids = scriptIds ?? Object.keys(SCRIPTS)
  const chosen = ids.map((id) => {
    const script = SCRIPTS[id]
    if (script === undefined) throw new BrowserCollectorError(`没有这条剧本：${id}（现有：${Object.keys(SCRIPTS).join(' / ')}）`)
    return script
  })

  let browser
  let instance
  const samples = new Map() // faceId → targets[]
  try {
    browser = await playwright.chromium.launch({ channel: 'msedge', headless: true })
    instance = await startIsolatedInstance({ repoRoot, log })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const consoleErrors = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)) })
    page.on('pageerror', (error) => consoleErrors.push(`pageerror ${error.message.slice(0, 200)}`))
    await page.goto(instance.url, { waitUntil: 'domcontentloaded' })
    await settle(page, 3500)

    const steps = []
    for (const script of chosen) {
      const run = await runScript({
        page,
        script,
        record: (faceId, targets) => { samples.set(faceId, [...(samples.get(faceId) ?? []), ...targets]) },
      })
      steps.push({ script: script.id, outcome: run.outcome, steps: run.steps })
      log(`剧本 ${script.id}：${run.outcome}（${run.steps.length} 步）`)
    }
    if (consoleErrors.length > 0) notes.push(`页面控制台报错 ${consoleErrors.length} 条：${consoleErrors.slice(0, 3).join(' / ')}`)

    const evidence = []
    for (const criterion of browserCriteria) {
      for (const face of faces) {
        if (!samples.has(face.id)) continue // 剧本没走到这个面：留空，判定为「未采到」
        evidence.push({
          criterionId: criterion.id,
          face: face.id,
          collector: BROWSER_COLLECTOR,
          status: 'observed',
          facts: { targets: samples.get(face.id) },
          evidence: [],
        })
      }
    }
    return { evidence, notes, available: true, steps }
  } catch (error) {
    // 整轮采不到：如实说，不编空 facts（空 facts 会被判成「没问题」）。
    const reason = error instanceof BrowserCollectorError ? error.message : `浏览器半边失败：${error?.message ?? error}`
    const evidence = []
    for (const criterion of browserCriteria) {
      for (const face of faces) {
        evidence.push({ criterionId: criterion.id, face: face.id, collector: BROWSER_COLLECTOR, status: 'collection-failed', reason, facts: null, evidence: [] })
      }
    }
    return { evidence, notes: [...notes, reason], available: false, reason }
  } finally {
    try { await browser?.close() } catch { /* 已经关了 */ }
    try { await instance?.stop() } catch { /* 清理失败不覆盖主结论 */ }
  }
}
