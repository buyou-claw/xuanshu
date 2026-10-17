/**
 * tests/shell/lib/fake-spawn.mjs — 子进程替身（#23 看护逻辑的断言台）。
 *
 * 只模拟壳真正会用到的那一小块 ChildProcess 表面：`stdout/stderr.on('data')`、`on('exit'|'error')`、
 * `kill(signal)`、`pid`。这样看护模块的测试**不起真进程**：不装 profile、不占 19388、不调 LLM。
 *
 * 行为可调：
 *   - `fake.autoExitOnKill = true`（默认）：`kill('SIGTERM')` 立即触发 exit —— 模拟「子进程配合地退出」；
 *   - `false`：忽略 SIGTERM —— 用来验证「超时后才 SIGKILL」的升级路径。
 */
import { EventEmitter } from 'node:events'

/**
 * @param {{pidStart?: number}} [options]
 * @returns {((command: string, args: string[], options: object) => object) & {
 *   calls: object[], children: object[], autoExitOnKill: boolean, last: () => object|undefined}}
 */
export function createFakeSpawn({ pidStart = 1000 } = {}) {
  const calls = []
  const children = []
  const auto = { value: true }

  const spawn = (command, args, options = {}) => {
    const child = new EventEmitter()
    child.pid = pidStart + children.length
    child.command = command
    child.args = args
    child.options = options
    child.kills = []
    child.exited = false
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = null

    const emitExit = (code, signal, error) => {
      if (child.exited) return
      child.exited = true
      child.exitCode = code
      child.signalCode = signal
      child.emit('exit', code, signal)
      if (child.listenerCount('close') > 0) child.emit('close', code, signal)
      void error
    }

    child.kill = (signal = 'SIGTERM') => {
      child.kills.push(signal)
      if (auto.value) emitExit(0, signal === 'SIGKILL' ? 'SIGKILL' : null)
      return true
    }
    /** 测试驱动：喂 stdout / stderr。 */
    child.emitStdout = (text) => child.stdout.emit('data', Buffer.from(text))
    child.emitStderr = (text) => child.stderr.emit('data', Buffer.from(text))
    /** 测试驱动：子进程异常退出。 */
    child.emitExit = emitExit
    /** 测试驱动：spawn 失败（命令不存在等）。 */
    child.emitError = (error) => child.emit('error', error)

    calls.push({ command, args, options, child })
    children.push(child)
    return child
  }

  Object.defineProperties(spawn, {
    calls: { get: () => calls },
    children: { get: () => children },
    autoExitOnKill: {
      get: () => auto.value,
      set: (value) => {
        auto.value = value === true
      },
    },
    last: { value: () => calls[calls.length - 1] },
  })
  return spawn
}
