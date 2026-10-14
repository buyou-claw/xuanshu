/**
 * packages/xuanshu-host/lib/rikke/huangli.mjs — 调本地 horosa 的黄历工具（票 13 契约 §2）。
 *
 * 通道（Lead 2026-10-15 裁决采纳建议 A 后加的）：**只走** `ctx.get('xuanshuHorosa')` 的 `callTool(name, args)`。
 * 那是票 06 的服务面（它自己管 serve 生命周期），本模块**不**起 serve、不连 `127.0.0.1:8765`、
 * 不 import `scripts/horosa/**` —— 与票 08 出盘同一条纪律。
 *
 * 真机事实（2026-10-15 捕获，见 `tests/rikke/fixtures/envelopes/PROVENANCE.md`）：
 *   - 技术必填只有 `date`；`hour` 可选但**必须是整数**（传 `'07:30'` 会被上游判
 *     `tool.invalid_payload`：`Input should be a valid integer`）；
 *   - 确认闸与八字同款：带 `agent_confirmed_settings: true` 才不拦。
 *
 * 失败一律**如实回报**（Lead 明确的纪律）：`callTool` 的 `ok:false` 原话（比如冷启动期
 * `ECONNREFUSED` → `mcp-call-failed`）直接进 `reason`，交给界面显示；这里**不自旋等 serve、不重试**。
 */

import { readHuangliEnvelope } from './content.mjs'

/** MCP 工具名（真机 `mcp_name`，不是 CLI 名）。 */
export const HUANGLI_TOOL = 'horosa_cn_huangli'

/** 出盘确认闸的固定说明（与票 06 的口径同理：这是「用户已确认用默认设置」的凭据）。 */
export const HUANGLI_NOTES = '玄枢日课：只按本地黄历引擎取当日宜忌与流日；用户已在界面上点过生成。'

/** 非严格读 cordis service。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * 调一次黄历。
 * @param {{ctx: object, date: string, hour?: number, timeoutMs?: number}} input
 * @returns {Promise<{ok: boolean, code: string|null, reason: string, tool: string|null, version: string|null,
 *                    content: {yi: string, ji: string, liuri: string}, sections: object}>}
 */
export async function callHuangli({ ctx, date, hour, timeoutMs }) {
  const empty = { ok: false, code: null, reason: '', tool: null, version: null, content: { yi: '', ji: '', liuri: '' }, sections: {} }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ...empty, code: 'invalid-date', reason: `日期格式不对（${JSON.stringify(date)}）：要 YYYY-MM-DD。` }
  }

  const horosa = softGet(ctx, 'xuanshuHorosa') ?? ctx?.xuanshuHorosa
  if (!horosa || typeof horosa.callTool !== 'function') {
    return {
      ...empty,
      code: 'horosa-unavailable',
      reason: 'horosa 服务不可得（或它的服务面还没有 callTool）：先跑 `pnpm setup:xuanshu` 装好底座，'
        + '再看 `/xuanshu-horosa status` 的 serve 状态。',
    }
  }

  const args = { date, agent_confirmed_settings: true, clarification_notes: HUANGLI_NOTES }
  // `hour` 只收 0..23 的整数（真机对字符串直接拒）；算不出就不传 —— 日期才是必填。
  if (Number.isInteger(hour) && hour >= 0 && hour <= 23) args.hour = hour

  let called
  try {
    called = await horosa.callTool(HUANGLI_TOOL, args, timeoutMs === undefined ? undefined : { timeoutMs })
  } catch (error) {
    return { ...empty, code: 'call-tool-threw', reason: `调用 horosa.callTool 抛了异常（已兜住）：${String(error?.message ?? error)}` }
  }

  if (!called || called.ok !== true || !called.envelope) {
    // 走到信封才算 ok（与 `mcpCallTool` 同族语义）；没走到 → 把原话带出去。
    const code = called?.code ?? 'mcp-call-failed'
    const detail = typeof called?.detail === 'string' && called.detail !== '' ? called.detail : '没走到信封'
    return { ...empty, code, reason: `黄历没调通（${code}）：${detail}` }
  }

  const parsed = readHuangliEnvelope(called.envelope)
  if (!parsed.ok) return { ...empty, tool: parsed.tool, version: parsed.version, code: parsed.code, reason: parsed.reason, sections: parsed.sections ?? {} }
  return {
    ok: true,
    code: null,
    reason: '',
    tool: parsed.tool,
    version: parsed.version,
    content: parsed.content,
    sections: parsed.sections,
  }
}
