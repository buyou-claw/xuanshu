/**
 * scripts/setup/mirrors.mjs — GitHub 下载 URL 的镜像前缀重写（票 05 契约 §3.4）。
 *
 * **语义照抄上游** `.upstream/horosa-skill/horosa-skill/src/horosa_skill/runtime/mirrors.py`：
 *   - `HOROSA_RUNTIME_MIRROR`（或 CLI `--mirror`）是一串逗号分隔的**前缀**，用来替换 `https://github.com`；
 *   - 镜像变体在前、**原始 URL 永远排最后**（所以同一份值可以直接交给 horosa 自己的 installer）；
 *   - 非 github.com 的 URL（自己的代理、`file://` 归档、本地测试 server）**原样返回**。
 *
 * 为什么必须照抄而不是「自己写一个更好用的」：这份值将来会同时喂给上游 installer（同一个环境变量名、
 * 同一套语义），两边只要有一处理解不同，就会出现「我们的 SHA256 门验的是 A、上游装的是 B」——
 * 那是这条链上最贵的一类 bug。
 *
 * 本机实测（2026-10-12）直连 `objects.githubusercontent.com` 只有 12–24 KB/s（719MB ≈ 8–16 小时，不可用），
 * 而 `https://gh-proxy.com/https://github.com` 21.9 MB/s、`https://ghfast.top/https://github.com` 19.3 MB/s。
 * 镜像**只换传输**：SHA256 门不变，第三方代理正是需要校验的理由。
 *
 * 纯函数：只读环境变量（可显式传入），不碰文件系统、不发请求。
 */

/** 上游写死的原始 origin（`mirrors.py` 的 `GITHUB`），导出给测试与调用方共用一份。 */
export const GITHUB_ORIGIN = 'https://github.com'

/** 上游认的环境变量名（我们与 horosa 自己的 installer 共用，值可以直接转交）。 */
export const MIRROR_ENV = 'HOROSA_RUNTIME_MIRROR'

/**
 * 镜像候选 URL 列表：各 prefix 变体在前、原 URL 最后。
 *
 * @param {string} url 目标 URL（通常是 release 资产）
 * @param {string[]|string|undefined|null} prefixes 前缀数组，或逗号分隔的原始串（`--mirror a,b`）；
 *        缺省时读 `HOROSA_RUNTIME_MIRROR`（与上游 `mirrors=None` 的行为一致）。
 * @returns {string[]} 至少含 `[url]` 的数组
 */
export function mirrorCandidates(url, prefixes) {
  const target = String(url ?? '')
  const list = parseMirrorPrefixes(prefixes === undefined || prefixes === null ? process.env[MIRROR_ENV] : prefixes)
  // 上游：prefix 末尾的 `/` 一律剥掉，空段丢掉（`a,,b,` → ['a','b']）。
  if (list.length === 0 || !target.startsWith(`${GITHUB_ORIGIN}/`)) return [target]
  const suffix = target.slice(GITHUB_ORIGIN.length) // 含开头的 '/'
  return [...list.map((prefix) => `${prefix}${suffix}`), target]
}

/** 「这份 URL 现在实际会先打哪儿」：有镜像就第一个镜像，否则原 URL（对应上游 `preferred_mirror_url`）。 */
export function preferredMirrorUrl(url, prefixes) {
  return mirrorCandidates(url, prefixes)[0]
}

/** 单个前缀的清洗（一处定义，字符串形态与数组形态共用 —— 见 parseMirrorPrefixes）。 */
const cleanPrefix = (item) => String(item).trim().replace(/\/+$/, '')

/**
 * 逗号分隔的镜像串（或已经切好的数组）→ 干净前缀数组：去空白、剥尾斜杠、丢空段。
 * 顺序与判空口径照上游 `m.strip().rstrip("/")`（先 strip 再 rstrip('/')，所以 `' //x/ '` → `'//x'`）。
 * 两个差异，都是「不让坏候选进表」：
 *   - 剥完斜杠后**变空**的段丢掉（上游会留下空前缀，产出 `/owner/repo/...` 这种相对 URL）；
 *   - **数组形态走同一条清洗**：`['https://gh-proxy.com/']` 与 `'https://gh-proxy.com/'` 必须逐元素同结果
 *     —— 只在字符串分支剥尾斜杠，会造出 `https://gh-proxy.com//Horace-Maxwell/...` 这种静默 404 的坏候选。
 */
export function parseMirrorPrefixes(raw) {
  if (Array.isArray(raw)) return raw.map(cleanPrefix).filter((item) => item !== '')
  if (typeof raw !== 'string') return []
  return raw.split(',').map(cleanPrefix).filter((item) => item !== '')
}

/**
 * 解析这次运行真正生效的镜像前缀，并说明来源（报告 notes 要能回答「这个 URL 是哪来的」）。
 *
 * 优先级（契约 §2 参数表 + §3.4）：`--mirror <prefix[,prefix]>` ＞ `$HOROSA_RUNTIME_MIRROR` ＞ 空。
 * `--mirror` 给了（哪怕给的是空串）就**不再**读环境变量 —— 「显式给了空」必须能表达「这次不要镜像」。
 *
 * @returns {{ prefixes: string[], source: string }}
 */
export function resolveMirrorPrefixes({ mirror, env = process.env } = {}) {
  if (typeof mirror === 'string') return { prefixes: parseMirrorPrefixes(mirror), source: '--mirror' }
  const fromEnv = env?.[MIRROR_ENV]
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return { prefixes: parseMirrorPrefixes(fromEnv), source: MIRROR_ENV }
  }
  return { prefixes: [], source: 'none' }
}
