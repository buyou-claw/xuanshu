import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import { resolvePlaywright } from '../ux/collect/browser.mjs'

const exec = promisify(execFile)
const repo = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const sha256 = data => createHash('sha256').update(data).digest('hex')
const redact = text => String(text).replace(/([?&]token=)[^\s"'&]+/gi, '$1[redacted]')
const urlPath = value => {
  const url = new URL(value)
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin + url.pathname : url.protocol
}
const writeJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n')
const edgePrefix = process.platform === 'win32' ? process.env['ProgramFiles(x86)'] ?? `${process.env.SystemDrive ?? 'C:'}\\Program Files (x86)` : undefined
const installedEdge = edgePrefix && join(edgePrefix, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
const edgePath = installedEdge && existsSync(installedEdge) ? installedEdge : undefined

function freePort(port = 0) {
  return new Promise((done, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(port, '127.0.0.1', () => {
      const picked = probe.address().port
      probe.close(error => error ? fail(error) : done(picked))
    })
  })
}

function runNode(args, options = {}) {
  return exec(process.execPath, args, { cwd: repo, windowsHide: true, timeout: 120_000, ...options })
}

function locatorFor(page, target) {
  const scope = target.within ? locatorFor(page, target.within) : page
  if (target.role) return scope.getByRole(target.role, { name: target.name, exact: true })
  if (target.label) return scope.getByLabel(target.label, { exact: true })
  if (target.placeholder) return scope.getByPlaceholder(target.placeholder, { exact: true })
  if (target.text) return scope.getByText(target.text, { exact: true })
  throw new Error('Provide a visible role/name, label, placeholder, or text')
}

export async function createScout({ out, playwrightDir, actionTimeout = 5000, viewport = { width: 1280, height: 900 } }) {
  const pw = playwrightDir ? require(resolve(playwrightDir)) : resolvePlaywright()
  if (!pw) throw new Error('Playwright unavailable. Use the existing resolver or supply playwrightDir.')
  out = resolve(out)
  mkdirSync(out)
  mkdirSync(join(out, 'screens'), { recursive: true })
  const homes = join(repo, '.scratch', 'experience-scout')
  mkdirSync(homes, { recursive: true })
  const home = await mkdtemp(join(homes, 'home-'))
  let port = await freePort()
  while (port === 19387 || port === 19388 || port === 8765) port = await freePort()
  const horosaPort = await freePort()
  const args = ['scripts/isolation/startup.mjs', '--home', home, '--web-port', String(port), '--horosa-port', String(horosaPort)]
  const origin = `http://127.0.0.1:${port}`
  let browser, context, page, server, tokenUrl
  let step = 0
  let generation = 0
  const counters = new Map()
  const consoleEvents = []
  function record(stream, data) {
    const entry = { at: new Date().toISOString(), generation, step, ...data }
    if (stream === 'console') consoleEvents.push(entry)
    appendFileSync(join(out, stream + '.jsonl'), JSON.stringify(entry) + '\n')
  }
  for (const stream of ['steps', 'console', 'network', 'service', 'persistence']) {
    record(stream, { event: 'capture-start' })
  }

  async function stopService() {
    if (!server) return
    const owned = server
    if (owned.child.exitCode === null && owned.child.signalCode === null) {
      if (process.platform === 'win32') {
        await exec('taskkill.exe', ['/PID', String(owned.child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 })
      } else {
        process.kill(-owned.child.pid, 'SIGTERM')
      }
    }
    const exit = await owned.exited
    await freePort(port)
    record('service', { event: 'stopped', launcherPid: owned.child.pid, port, portReleased: true, ...exit })
    server = undefined
    tokenUrl = undefined
  }

  async function startService() {
    generation += 1
    const { stdout } = await runNode([...args, '--mode', 'doctor', '--json'])
    const doctor = JSON.parse(stdout)
    await writeJson(join(out, `doctor-${generation}.json`), { mode: doctor.mode, checks: doctor.checks, exitCode: doctor.exitCode })
    const child = spawn(process.execPath, [...args, '--mode', 'web'], {
      cwd: repo,
      env: { ...process.env, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server = {
      child,
      exited: new Promise(done => {
        child.once('close', (code, signal) => done({ code, signal }))
        child.once('error', error => done({ error: error.message }))
      }),
    }
    for (const stream of ['stdout', 'stderr']) {
      child[stream].setEncoding('utf8')
      let remainder = ''
      child[stream].on('data', chunk => {
        const lines = (remainder + chunk).split('\n')
        remainder = lines.pop()
        for (const line of lines) {
          tokenUrl ??= line.match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[A-Za-z0-9_-]+`))?.[0]
          record('service', { event: stream, text: redact(line) })
        }
      })
      child[stream].on('end', () => {
        if (remainder) record('service', { event: stream, text: redact(remainder) })
      })
    }
    record('service', { event: 'started', launcherPid: child.pid, port })
    await Promise.race([
      (async () => {
        const deadline = Date.now() + 30_000
        while (!tokenUrl && Date.now() < deadline && server?.child === child) await sleep(100)
        if (!tokenUrl) throw new Error('No authentication URL from the isolated launcher. See service.jsonl.')
      })(),
      server.exited.then(() => { throw new Error('Isolated launcher exited before authentication. See service.jsonl.') }),
    ])
  }

  async function openEdge() {
    context = await browser.newContext({ viewport, colorScheme: 'light' })
    await context.tracing.start({ screenshots: true, snapshots: true })
    page = await context.newPage()
    page.setDefaultTimeout(actionTimeout)
    page.on('console', msg => record('console', { event: msg.type(), text: redact(msg.text()) }))
    page.on('pageerror', error => record('console', { event: 'pageerror', text: redact(error.stack ?? error.message) }))
    const requests = new WeakMap()
    let count = 0
    page.on('request', req => {
      const id = ++count
      requests.set(req, { id, startedAtStep: step })
      const body = req.url() === origin + '/api/xuanshu' ? req.postDataJSON() : undefined
      record('network', { event: 'request', id, method: req.method(), url: urlPath(req.url()), rpc: body?.method })
    })
    page.on('response', res => record('network', { event: 'response', ...requests.get(res.request()), url: urlPath(res.url()), status: res.status() }))
    page.on('requestfailed', req => record('network', { event: 'failed', ...requests.get(req), url: urlPath(req.url()), error: req.failure()?.errorText }))
    const auth = await context.request.get(tokenUrl, { maxRedirects: 0, timeout: 10_000 })
    const cookies = (await context.cookies(origin)).filter(cookie => cookie.name.startsWith('dsh-auth-')).length
    record('network', { event: 'auth', status: auth.status(), cookies })
    if (auth.status() !== 303 || cookies === 0) throw new Error('Isolated authentication failed')
    const boot = await page.goto(origin, { waitUntil: 'domcontentloaded' })
    const hasBootMarker = (await boot?.text())?.includes('__DSH_BOOT__') ?? false
    record('network', { event: 'boot', status: boot?.status(), hasBootMarker })
    if (boot?.status() !== 200 || !hasBootMarker) throw new Error('Edge did not receive the DSH application')
  }

  async function closeEdge() {
    if (!context) return
    const current = context
    context = undefined
    page = undefined
    try {
      await current.tracing.stop({ path: join(out, `trace-${generation}.zip`) })
    } finally {
      await current.close()
    }
  }

  async function close() {
    try {
      await closeEdge()
    } finally {
      try {
        await browser?.close()
      } finally {
        await stopService()
      }
    }
  }

  async function registry() {
    const relative = 'xuanshu/cang/registry.jsonl'
    const data = await readFile(join(home, relative), 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    const rows = data === null ? [] : data.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line))
    const result = { relative, present: data !== null, sha256: data === null ? null : sha256(data), rows }
    record('persistence', { event: 'registry', ...result })
    return result
  }

  async function snapshot() {
    const index = (counters.get(step) ?? 0) + 1
    counters.set(step, index)
    const prefix = `screens/${String(step).padStart(3, '0')}-${index}`
    const aria = await page.locator('body').ariaSnapshot({ timeout: 3000 })
    await writeFile(join(out, prefix + '.yml'), aria + '\n')
    await page.screenshot({ path: join(out, prefix + '.png'), timeout: 5000 })
    return { aria, screenshot: prefix + '.png', snapshot: prefix + '.yml' }
  }

  async function matches(check) {
    const target = check.state === 'console' ? undefined : locatorFor(page, check.target)
    const deadline = Date.now() + (check.timeout ?? actionTimeout)
    do {
      if (check.state === 'console') {
        if (consoleEvents.some(event => event.generation === generation && event.event === check.level && event.text.includes(check.value))) return true
        await sleep(80)
        continue
      }
      const count = await target.count()
      const visible = count === 1 && await target.isVisible()
      if (check.state === 'hidden' && (count === 0 || (count === 1 && !visible))) return true
      if (visible && check.state === 'visible') return true
      if (visible && check.state === 'disabled' && await target.isDisabled({ timeout: 500 })) return true
      if (visible && check.state === 'enabled' && await target.isEnabled({ timeout: 500 })) return true
      if (visible && check.state === 'value' && await target.inputValue({ timeout: 500 }) === check.value) return true
      await sleep(80)
    } while (Date.now() < deadline)
    return false
  }

  async function perform(action) {
    step += 1
    record('steps', { event: 'start', action })
    try {
      let result
      if (action.type === 'observe') {
        result = await snapshot()
      } else if (action.type === 'registry') {
        result = await registry()
      } else if (action.type === 'check') {
        result = { matches: await matches(action), ...await snapshot() }
      } else if (action.type === 'restart') {
        await closeEdge()
        await stopService()
        await startService()
        await openEdge()
      } else if (action.type === 'reload') {
        await page.reload({ waitUntil: 'domcontentloaded' })
      } else {
        const locator = locatorFor(page, action.target)
        if (action.type === 'click') await locator.click()
        else if (action.type === 'fill') await locator.fill(action.value)
        else if (action.type === 'press') await locator.press(action.key)
        else throw new Error(`Unknown action: ${action.type}`)
      }
      const { aria, ...files } = result ?? {}
      record('steps', { event: 'finish', action, result: result ? files : undefined })
      return { step, ...result }
    } catch (error) {
      const evidence = page ? await snapshot().catch(() => undefined) : undefined
      record('steps', { event: 'error', action, message: redact(error.message), screenshot: evidence?.screenshot, snapshot: evidence?.snapshot })
      throw error
    }
  }

  async function verifyLive() {
    record('steps', { event: 'verify-live-start' })
    return runNode(['scripts/verify-live.mjs'], {
      env: {
        ...process.env, XUANSHU_LIVE_URL: tokenUrl,
        ...(playwrightDir ? { NODE_PATH: resolve(playwrightDir, '..') } : {}),
        ...(edgePath ? { 'PROGRAMFILES(X86)': edgePrefix } : {}),
      },
    }).then(result => ({ ...result, code: 0 }), error => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code }))
      .then(async result => {
        await writeFile(join(out, 'verify-live.log'), redact(result.stdout + result.stderr))
        record('steps', { event: 'verify-live-finish', code: result.code, file: 'verify-live.log' })
        return result.code
      })
  }

  try {
    const install = await runNode(['scripts/install-profile.mjs', '--copy', '--home', home])
    await writeFile(join(out, 'install.log'), redact(install.stdout + install.stderr))
    const profile = join(home, 'profiles', 'xuanshu')
    const installedClient = await readFile(join(profile, 'node_modules', 'xuanshu-client', 'lib', 'client.js'))
    const client = await readFile(join(repo, 'packages', 'xuanshu-client', 'lib', 'client.js'))
    if (await realpath(profile) !== profile || !installedClient.equals(client)) throw new Error('Expected a copy profile with a matching client bundle')
    await startService()
    browser = await pw.chromium.launch({ channel: 'msedge', executablePath: edgePath, headless: true })
    await openEdge()
    const freeze = JSON.parse(await readFile(join(repo, 'docs', 'design', 'ui-v1', 'criteria', 'freeze.json'), 'utf8'))
    const git = async (...args) => (await exec('git', args, { cwd: repo, windowsHide: true })).stdout.trim()
    await writeJson(join(out, 'environment.json'), {
      commit: await git('rev-parse', 'HEAD'), status: await git('status', '--porcelain'),
      clientSha256: sha256(client), criteriaVersion: freeze.version,
      node: process.version, edge: browser.version(), edgePath, userAgent: await page.evaluate(() => navigator.userAgent),
      playwright: playwrightDir ? require(join(resolve(playwrightDir), 'package.json')).version : undefined,
      home, profile, port, horosaPort, viewport, colorScheme: 'light',
    })
    return { perform, close, verifyLive }
  } catch (error) {
    record('steps', { event: 'setup-error', message: redact(error.message), stderr: redact(error.stderr ?? '') })
    await close()
    throw error
  }
}
