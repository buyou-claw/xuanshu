/**
 * scripts/setup/proc.mjs — 子进程的唯一启动/收集入口（票 05 契约 §6 的 Windows 卫生条款）。
 *
 * 三件必须一次做对的事（每一件都在本机踩过或已被上游记过账）：
 *
 * 1. **收字节再按 UTF-8 解**。本机控制台是 cp936：直接读文本、或用 PowerShell `Get-Content`，
 *    horosa 的中文输出就是乱码。这里一律 `encoding: 'buffer'`，解完若出现替换字符就标 `lossy`。
 * 2. **stdout 绝不许漏进我们的 stdout**。`--json` 时 stdout 只许有报告 JSON，所以子进程的
 *    stdout/stderr 统一转发到**我们的 stderr**（带 `[cmd]` 前缀），并各自攒一份受限副本供解析。
 * 3. **`.cmd`/`.bat` 不能走 shell:false**。node 18.20/20.12 起拒绝对 `.cmd` 直接 spawn（EINVAL，
 *    `install-profile.mjs` 里记过这笔）；开 `shell: true` 又会对「带 args 开 shell」发 DEP0190。
 *    Lead 冻结的写法是 `cmd.exe /d /s /c "<已引号化的 argv>"` + `windowsVerbatimArguments: true`
 *    —— args 原样透传给 cmd.exe，引号由我们自己加（见 `buildInvocation`）。
 *
 * 仅使用 Node 内置模块。ESM。
 */

import { spawn } from 'node:child_process'

/** 单条流最多留多少字节做解析副本：install/doctor 的输出远小于它，真超了也只截尾。 */
const CAPTURE_LIMIT_BYTES = 4 * 1024 * 1024

/** 默认超时：真 CLI 冷启动实测 3~15s；180s 足够宽又不至于挂死 CI（与票 04 同量级）。 */
export const DEFAULT_TIMEOUT_MS = 180_000

/**
 * UTF-8 解码（带 BOM 容忍 + 残缺标记）。
 * @returns {{ text: string, lossy: boolean }}
 */
export function decodeUtf8(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  const body = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes
  const text = new TextDecoder('utf-8', { fatal: false }).decode(body)
  return { text, lossy: text.includes('\uFFFD') }
}

/** cmd.exe 的引号化：整段加双引号，内部双引号翻倍（`""`）。 */
export function cmdQuote(value) {
  const text = String(value)
  if (text === '') return '""'
  if (!/[\s"&|<>^()%!]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * 把「可执行文件 + 参数」折成 spawn 能吃的形态（Lead 冻结的 Windows 约定）。
 *   `.mjs/.cjs/.js` → `node <file> <args…>`（测试替身是 ESM 脚本，Windows 上裸 spawn 不可执行）
 *   `.cmd/.bat`     → `cmd.exe /d /s /c "<已引号化 argv>"` + `windowsVerbatimArguments: true`
 *   其余            → 直接 spawn(shell: false)（真 `uvx.exe` / `node` / `pnpm`）
 */
export function buildInvocation(bin, args = []) {
  const command = String(bin)
  const rest = args.map(String)
  if (/\.(mjs|cjs|js)$/i.test(command)) return { command: process.execPath, args: [command, ...rest], shell: false }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    const inner = [command, ...rest].map(cmdQuote).join(' ')
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${inner}"`],
      shell: false,
      windowsVerbatimArguments: true,
    }
  }
  return { command, args: rest, shell: false }
}

/** `uvx` 可执行文件：`XUANSHU_UVX_BIN` 覆盖（测试注入点，契约 §10）＞ PATH 上的 `uvx`。 */
export function uvxBin(env = process.env) {
  const override = env?.XUANSHU_UVX_BIN
  return typeof override === 'string' && override.trim() !== '' ? override.trim() : 'uvx'
}

/** 把一条流按行切给 `onLine`（最后不足一行也交付），并顺手攒解析副本。 */
function makeSink({ label, onLine, log }) {
  let carry = ''
  let captured = Buffer.alloc(0)
  let truncated = false
  return {
    push(chunk) {
      if (captured.length < CAPTURE_LIMIT_BYTES) captured = Buffer.concat([captured, chunk])
      else truncated = true
      carry += chunk.toString('utf8')
      const lines = carry.split(/\r?\n/)
      carry = lines.pop() ?? ''
      for (const line of lines) {
        if (typeof onLine === 'function') onLine(line)
        else if (typeof log === 'function') log(`[${label}] ${line}`)
      }
    },
    end() {
      if (carry !== '') {
        if (typeof onLine === 'function') onLine(carry)
        else if (typeof log === 'function') log(`[${label}] ${carry}`)
        carry = ''
      }
      return { text: decodeUtf8(captured).text, truncated }
    },
  }
}

/**
 * 跑一条命令，把两个流转发到 stderr，返回收集到的结果（**不抛**，由调用方翻译成退出码）。
 *
 * @param {string} bin 可执行文件（或测试替身脚本路径）
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, timeoutMs?: number, log?: Function,
 *          label?: string, onStdoutLine?: Function, prefix?: string, stdinIgnore?: boolean }} [options]
 * @returns {Promise<{ status: number|null, signal: string|null, error: string|null, timedOut: boolean,
 *                     stdout: string, stderr: string, stdoutLossy: boolean, stderrLossy: boolean,
 *                     truncated: boolean, durationMs: number, commandLine: string }>}
 */
export function runCommand(bin, args = [], options = {}) {
  const {
    env = process.env,
    cwd,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    log,
    label = 'cmd',
    onStdoutLine,
  } = options

  const invocation = buildInvocation(bin, args)
  const commandLine = [invocation.command, ...invocation.args].join(' ')
  const started = Date.now()

  return new Promise((resolveResult) => {
    let child
    try {
      child = spawn(invocation.command, invocation.args, {
        cwd,
        env,
        shell: invocation.shell,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolveResult({
        status: null,
        signal: null,
        error: `${error?.code ?? 'spawn'} ${error?.message ?? String(error)}`,
        timedOut: false,
        stdout: '',
        stderr: '',
        stdoutLossy: false,
        stderrLossy: false,
        truncated: false,
        durationMs: Date.now() - started,
        commandLine,
      })
      return
    }

    const outSink = makeSink({ label: `${label} out`, onLine: onStdoutLine, log })
    const errSink = makeSink({ label: `${label} err`, onLine: undefined, log })

    let timedOut = false
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true
        if (typeof log === 'function') log(`[${label}] 超时 ${timeoutMs}ms，终止进程`)
        try {
          child.kill()
        } catch {
          /* 杀不掉也要落到 timedOut 分支，不能吞掉结果 */
        }
      }, timeoutMs)
      : undefined

    child.stdout?.on('data', (chunk) => outSink.push(chunk))
    child.stderr?.on('data', (chunk) => errSink.push(chunk))

    const finish = (status, signal, error) => {
      if (timer !== undefined) clearTimeout(timer)
      const out = outSink.end()
      const err = errSink.end()
      resolveResult({
        status,
        signal,
        error: error ?? null,
        timedOut,
        stdout: out.text,
        stderr: err.text,
        stdoutLossy: decodeUtf8(Buffer.from(out.text, 'utf8')).lossy,
        stderrLossy: decodeUtf8(Buffer.from(err.text, 'utf8')).lossy,
        truncated: out.truncated || err.truncated,
        durationMs: Date.now() - started,
        commandLine,
      })
    }

    child.on('error', (error) => finish(null, null, `${error?.code ?? 'spawn'} ${error?.message ?? String(error)}`))
    child.on('close', (status, signal) => finish(status, signal ?? null, null))
  })
}

/** 取一段文本的尾部若干行（报告 evidence 只放小体积关键字段）。 */
export function tailLines(text, lines = 8, maxChars = 1200) {
  const all = String(text ?? '').split(/\r?\n/).filter((line) => line.trim() !== '')
  const tail = all.slice(-lines).join('\n')
  return tail.length > maxChars ? tail.slice(-maxChars) : tail
}
