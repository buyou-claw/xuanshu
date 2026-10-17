/**
 * packages/xuanshu-host/lib/notify/reason.mjs — 壳侧失败 token → **可读原因**（#40 / spec 002:130）。
 *
 * 规格把「成功 / 失败 / 权限缺失」并列，但契约 §2 的壳侧回执只有 `delivered:false` + 一个
 * 英文 token（`unsupported` / `permission-denied` / `failed`）。以前宿主把 token 直接拼进账行
 * （`桌面壳没有弹出通知：permission-denied`），界面再把整串渲染出来 —— 用户看到的是壳的内部词表，
 * 不是「权限被关了、去哪开」。
 *
 * 这里做**单点映射**（写入前的形状门 `traffic.mjs::buildTrafficEntry` 调用）：
 *   - 认识的 token → 人话原因 + 保留 `reasonCode` 机器码（可区分、可排查，原始 token 不丢）；
 *   - 不认识的 reason → **原样保留**（其他失败原因照旧可查，绝不抹平）。
 *
 * 与客户端 `notify.tsx::notifyFailureText()` 是**同一份文案的两侧实现**：跨包没有可共享的运行时
 * 模块（同 `xuanshu-shell/lib/contract.mjs` 的 §0 例外），所以两边各留一份、文案逐字对齐。
 * 对齐由 `tests/notify/reason-parity.test.mjs` **对拍**（文案表逐键相等、识别正则 source/flags 相同、
 * 同一组样例两侧结论相同）—— 两边各留一份的前提是有人盯着它们不许漂。
 */

/** token → 人话（含「去哪开」；权限缺失这一档是本票的正面要求）。 */
export const NOTIFY_FAILURE_TEXT = Object.freeze({
  'permission-denied': '权限缺失：系统通知权限被关。请到「系统设置 → 通知 → 玄枢」里打开通知权限，然后再生成一次。',
  unsupported: '系统通知不可用：这台系统 / 环境不支持系统通知。',
  failed: '桌面壳没有弹出通知（壳没给细节）。',
})

/**
 * 失败 token 在 reason 尾部（`桌面壳没有弹出通知：permission-denied` / 裸 token 都认）。
 * 导出是为了与客户端 `notify.tsx` 的同名正则**对拍**（`tests/notify/reason-parity.test.mjs`）：
 * 两侧各留一份文案时，识别规则也必须逐字一致，否则同一行账在宿主与界面会得出不同结论。
 */
export const NOTIFY_FAILURE_TOKEN = /(permission-denied|unsupported|failed)\s*$/u

/**
 * 账行写入前的归一：认识的壳侧 token → 人话原因 + `reasonCode`；其余原样。
 *
 * @param {string|null} reason 原始 reason（可能带中文前缀）
 * @returns {{reason: string|null, reasonCode?: string}}
 */
export function normalizeNotifyFailure(reason) {
  if (typeof reason !== 'string' || reason === '') return { reason: null }
  const match = NOTIFY_FAILURE_TOKEN.exec(reason)
  if (match === null) return { reason }
  return { reason: NOTIFY_FAILURE_TEXT[match[1]], reasonCode: match[1] }
}
