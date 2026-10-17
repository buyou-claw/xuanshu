/**
 * packages/xuanshu-shell/lib/single-instance.mjs — 单实例锁（验收：重复启动只唤出已有窗口）。
 *
 * Electron 的语义：`app.requestSingleInstanceLock()` 只有第一个进程拿到 `true`；
 * 后启动的进程拿 `false`，应当 `app.quit()`（它没有窗口可展示），而**第一个**进程会收到
 * `second-instance` 事件 —— 「唤出已有窗口」只能由第一个进程做。
 *
 * 所以这里的两条分支是硬边界：
 *   - 拿不到锁：绝不启动子进程 / 不建窗口（否则两个 DSH 抢 19388）；
 *   - 拿到锁：注册 second-instance → showExisting，再 start()。
 *
 * 不 import electron（`app` 由 `electron-adapter.mjs` 注入）。
 */

/**
 * @param {{app: {requestSingleInstanceLock: Function, on: Function, quit: Function},
 *          start: () => void, showExisting: () => void,
 *          logger?: {warn?: Function}}} options
 * @returns {{first: boolean, started: boolean}}
 */
export function bootstrapSingleInstance({ app, start, showExisting, logger = console }) {
  const first = app.requestSingleInstanceLock() === true
  if (!first) {
    app.quit()
    return { first: false, started: false }
  }
  app.on('second-instance', () => {
    // 第二个进程只把事件送到这里；真正「唤出窗口」的是第一个进程。
    try {
      showExisting()
    } catch (error) {
      logger?.warn?.(`[shell] 唤出已有窗口失败（已兜住）：${String(error?.message ?? error)}`)
    }
  })
  start()
  return { first: true, started: true }
}
