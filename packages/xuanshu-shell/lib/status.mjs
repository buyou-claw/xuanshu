/**
 * packages/xuanshu-shell/lib/status.mjs — 窗口状态页（纯字符串，不 import electron）。
 *
 * 壳的窗口只有两种内容：
 *   1. **认证后的玄枢首页**（supervisor 从子进程 stdout 认到 URL 之后）；
 *   2. 一张**本地状态页**（还没有 URL / 子进程正在重拉 / 已放弃）。
 *
 * 状态页存在的理由就是「不许加载一个猜的地址」：它只报当前状态，页面里没有任何 http(s) 地址。
 * 同时把自启方式与通知能力显示出来（与托盘 / 设置页同源）——「没推成」不许伪装成「推过了」，
 * 「自启没生效」也不许伪装成「已开」。
 *
 * 仅使用 Node 内置模块，无第三方依赖。ESM。
 */

import { autostartText, supervisorStatusText } from './desktop-behavior.mjs'

/** 最小 HTML 转义（detail / label 里有子进程日志与设置文件内容，不能直接拼）。 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

/**
 * supervisor 状态 + 自启 / 通知 → 窗口视图模型。
 *
 * `url` 只在 `phase === 'ready'` 且有 URL 时出现；没就绪时**没有这个键**，
 * 调用方拿不到地址（从类型上就杜绝「拿 undefined 去 loadURL」）。
 *
 * @param {{supervisorState?: object, autostart?: object, notification?: object}} options
 */
export function shellStatusViewModel({ supervisorState, autostart, notification } = {}) {
  const state = supervisorState !== null && typeof supervisorState === 'object' ? supervisorState : {}
  const phase = state.phase ?? 'stopped'
  const ready = phase === 'ready' && typeof state.url === 'string' && state.url !== ''

  let detail
  switch (phase) {
    case 'ready':
      detail = '玄枢服务已就绪，正在加载玄枢首页。'
      break
    case 'starting':
      detail = '正在启动玄枢服务…（第一次启动可能要装依赖 / 建索引，会比较慢）'
      break
    case 'restarting': {
      const exit = state.lastExit ?? {}
      const code = exit.code === undefined || exit.code === null ? '—' : String(exit.code)
      const signal = exit.signal === undefined || exit.signal === null ? '' : `，signal=${exit.signal}`
      detail = `玄枢服务意外退出（code=${code}${signal}），正在第 ${state.attempt ?? 1} 次重拉`
        + `${state.nextRetryMs === undefined ? '' : `（${state.nextRetryMs}ms 后重试）`}。`
      break
    }
    case 'failed':
      detail = `玄枢服务没能起来：${state.detail ?? '启动失败，已停止重拉'}。`
        + '可以关掉壳重开，或按 runbook 的步骤手动排障。'
      break
    default:
      detail = '玄枢服务已停止。'
  }

  const autostartStatus = autostart !== null && typeof autostart === 'object' ? autostart : { method: 'unsupported', enabled: false }
  const notificationStatus = notification !== null && typeof notification === 'object'
    ? { supported: notification.supported !== false, detail: notification.detail }
    : { supported: true }

  const view = {
    ready,
    phase,
    title: ready ? '服务已就绪' : '服务未就绪',
    detail,
    autostart: {
      method: autostartStatus.method ?? 'unsupported',
      label: autostartStatus.label ?? '不支持',
      enabled: autostartStatus.enabled === true,
      text: autostartText(autostartStatus),
      detail: autostartStatus.detail,
    },
    notification: notificationStatus,
  }
  if (ready) view.url = state.url
  return view
}

/**
 * 生成状态页 HTML（**不含任何地址**）。
 *
 * @param {object} view `shellStatusViewModel()` 的产物
 * @returns {string}
 */
export function statusPageHtml(view) {
  const value = view !== null && typeof view === 'object' ? view : {}
  const title = escapeHtml(value.title ?? '服务未就绪')
  const detail = escapeHtml(value.detail ?? '玄枢服务还没有就绪。')
  const autostart = escapeHtml(value.autostart?.text ?? '开机自启：不支持（未生效）')
  const notification = value.notification?.supported === false
    ? escapeHtml(`系统通知：不可用（${value.notification.detail ?? '平台不支持'}）`)
    : '系统通知：可用'
  const stateLine = escapeHtml(supervisorStatusText({ phase: value.phase ?? 'stopped', ...value }))
  const accent = value.ready === true ? '#3f7d5a' : '#a0522d'

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>玄枢 · ${title}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    background: Canvas; color: CanvasText;
  }
  main { max-width: 34rem; padding: 2.5rem; text-align: center; }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 .75rem; color: ${accent}; }
  p { line-height: 1.7; margin: .4rem 0; opacity: .85; }
  .meta { margin-top: 1.5rem; font-size: .85rem; opacity: .65; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p>${detail}</p>
  <p>${stateLine}</p>
  <div class="meta">
    <div>${autostart}</div>
    <div>${notification}</div>
  </div>
</main>
</body>
</html>
`
}
