/**
 * tests/shell/lib/fake-timers.mjs — 看护逻辑的假计时器（确定性重试节奏）。
 *
 * 为什么不用 vitest 的假时钟：重试是「延迟 → 再 spawn → 读完 stdout → 再判断」的链式行为，
 * 手动推进一个只记录 `setTimeout` 的小调度器，测试能把「第几次重试、等多久」逐条断言出来，
 * 也不会被真实时间抖动影响。
 */

/**
 * @returns {{setTimeout: Function, clearTimeout: Function, pending: () => number[],
 *            count: () => number, runNext: () => boolean, runAll: () => boolean, reset: () => void}}
 */
export function createFakeTimers() {
  const timers = new Map()
  let nextId = 1

  const api = {
    setTimeout(fn, ms) {
      const id = nextId
      nextId += 1
      timers.set(id, { fn, ms })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    /** 尚未触发的延迟（毫秒，按到期顺序）。 */
    pending() {
      return [...timers.values()].map((timer) => timer.ms).sort((a, b) => a - b)
    },
    count() {
      return timers.size
    },
    /** 跑最早到期的那一个；没有待触发计时器返回 false。 */
    runNext() {
      const entries = [...timers.entries()].sort((a, b) => a[1].ms - b[1].ms)
      if (entries.length === 0) return false
      const [id, timer] = entries[0]
      timers.delete(id)
      timer.fn()
      return true
    },
    runAll() {
      let ran = false
      while (api.runNext()) ran = true
      return ran
    },
    reset() {
      timers.clear()
    },
  }
  return api
}
