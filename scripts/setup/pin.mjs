/**
 * scripts/setup/pin.mjs — 钉版文件的唯一读取入口（票 05 契约 §3.1）。
 *
 * 「钉版只有一个来源」：`scripts/setup/horosa-pin.json`（进版本库，可被 `XUANSHU_SETUP_PIN` 覆盖，
 * 覆盖只给测试用）。代码里**不许**再出现 `0.40.1` / `718649254` 这类字面量 —— 升级 horosa 是一次性动作：
 * 换 pin → 重装同版本 runtime → 重跑自检（ADR-0004 的升级清单）。
 *
 * 三条硬规矩（都在下面的断言里）：
 *   1. **绝不解析 `latest`**：pin 全文出现 `latest` 即拒（那是「悄悄跟随上游」，正是 ADR-0004 否掉的东西）；
 *   2. pin 里没有当前平台 → 失败并**列出 pin 支持的平台**（人需要知道「这台机器能不能装」）；
 *   3. schema 不符即拒（换成 `@2` 时，老代码必须响亮地失败，而不是按老字段读出新含义）。
 *
 * 仅使用 Node 内置模块。ESM。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EXIT, SetupError } from './exit.mjs'

/** pin 的 schema 名（契约 §3.1 冻结）。 */
export const PIN_SCHEMA = 'xuanshu/horosa-pin@1'

/** 缺省 pin 路径：与本文件同目录（`scripts/setup/horosa-pin.json`）。 */
export const DEFAULT_PIN_PATH = join(dirname(fileURLToPath(import.meta.url)), 'horosa-pin.json')

/**
 * 平台键 → pin 的平台键。上游用同一套名字（`horosa-runtime-<platform>-v<ver>.<ext>`）。
 *
 * `PLATFORM_FALLBACKS` 是上游 `PLATFORM_FALLBACKS` 的同义转写：Windows on ARM 跑 win32-x64 载荷
 * **是上游认可的组合**（doctor 会标 `emulated: true`）。没有回退时启动器会去要一个根本不存在的
 * `win32-arm64` 载荷。这里只在 pin 里**确实存在**回退键时才回退。
 */
const PLATFORM_FALLBACKS = { 'win32-arm64': 'win32-x64' }

/** 当前主机的平台键（与上游 `_platform_key()` 同口径）。 */
export function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`
}

/** 读 pin JSON。找不到 / 坏 JSON / schema 不符 / 出现 `latest` → SetupError(fetch)。 */
export function loadPin(pinPath = DEFAULT_PIN_PATH) {
  let raw
  try {
    raw = readFileSync(pinPath, 'utf8')
  } catch (error) {
    throw new SetupError(`钉版文件读不到：${pinPath}（${error?.code ?? error?.message}）`, {
      code: EXIT.fetch,
      hint: `# 仓库里必须有 scripts/setup/horosa-pin.json；若你是在测试里用 XUANSHU_SETUP_PIN 覆盖，请检查那个路径`,
    })
  }

  // 「绝不解析 latest」这条必须在 parse 之前判：坏 JSON 里出现 latest 也是坏消息，先说了更清楚。
  if (/latest/i.test(raw)) {
    throw new SetupError(`钉版文件里出现 "latest" 字样：${pinPath}（ADR-0004 要求钉死具体版本，禁止跟随 latest）`, {
      code: EXIT.fetch,
    })
  }

  let pin
  try {
    pin = JSON.parse(raw)
  } catch (error) {
    throw new SetupError(`钉版文件不是合法 JSON：${pinPath}（${error.message}）`, { code: EXIT.fetch })
  }

  if (pin?.schema !== PIN_SCHEMA) {
    throw new SetupError(`钉版 schema 不符：${JSON.stringify(pin?.schema)}，期望 ${JSON.stringify(PIN_SCHEMA)}`, {
      code: EXIT.fetch,
      hint: `# schema 是不兼容变更的信号：换了 @2 就要同时改 scripts/setup/pin.mjs 的读取口径`,
    })
  }
  if (typeof pin.version !== 'string' || pin.version.trim() === '') {
    throw new SetupError('钉版文件缺 version', { code: EXIT.fetch })
  }
  if (typeof pin.releaseBase !== 'string' || pin.releaseBase.trim() === '') {
    throw new SetupError('钉版文件缺 releaseBase', { code: EXIT.fetch })
  }

  assertArtifact('wheel', pin.wheel)
  const platforms = pin.runtime?.platforms
  if (platforms === null || typeof platforms !== 'object' || Array.isArray(platforms) || Object.keys(platforms).length === 0) {
    throw new SetupError('钉版文件缺 runtime.platforms（至少一个平台）', { code: EXIT.fetch })
  }
  for (const [name, artifact] of Object.entries(platforms)) assertArtifact(`runtime.platforms.${name}`, artifact)

  return pin
}

/** 单个工件描述的形状校验（缺一即拒，别让 undefined 一路漂到 fetch）。 */
function assertArtifact(label, artifact) {
  if (artifact === null || typeof artifact !== 'object') {
    throw new SetupError(`钉版文件缺 ${label}`, { code: EXIT.fetch })
  }
  for (const key of ['name', 'sha256']) {
    if (typeof artifact[key] !== 'string' || artifact[key].trim() === '') {
      throw new SetupError(`钉版文件 ${label} 缺 ${key}`, { code: EXIT.fetch })
    }
  }
  if (!/^[0-9a-f]{64}$/i.test(artifact.sha256)) {
    throw new SetupError(`钉版文件 ${label}.sha256 不是 64 位 hex：${JSON.stringify(artifact.sha256)}`, { code: EXIT.fetch })
  }
  if (!Number.isInteger(artifact.size) || artifact.size <= 0) {
    throw new SetupError(`钉版文件 ${label}.size 不是正整数：${JSON.stringify(artifact.size)}`, { code: EXIT.fetch })
  }
}

/** 资产 URL：`<releaseBase>/<name>`（pin 的 URL 是**权威**；镜像只换传输，见 mirror.mjs）。 */
export function artifactUrl(pin, artifact) {
  return `${String(pin.releaseBase).replace(/\/+$/, '')}/${artifact.name}`
}

/**
 * 当前平台的 runtime 工件描述。
 *
 * 回退（`PLATFORM_FALLBACKS`）**不静默**：命中了就把「从哪个平台键、走到哪个平台键」一起回传
 * （`platformFallback = {from, to}`），调用方必须把它写进报告 `pin.runtime.platformFallback` 与一条 note ——
 * 契约 §3.1 的字面是「pin 里没有当前平台 → exit 2」，回退是上游认可的唯一例外，那就必须**看得见**
 * （否则「装的到底是哪份载荷」只能靠人去读 pin 才发现）。
 *
 * @returns {{ kind: 'runtime', platform: string, hostPlatform: string, fallback: boolean,
 *             platformFallback: {from: string, to: string}|null,
 *             name: string, sha256: string, size: number, archiveType: string|undefined, url: string }}
 */
export function runtimeArtifact(pin, { platform = process.platform, arch = process.arch } = {}) {
  const host = platformKey(platform, arch)
  const platforms = pin.runtime.platforms
  let key = host
  let fallback = false
  if (platforms[key] === undefined) {
    const candidate = PLATFORM_FALLBACKS[host]
    if (candidate !== undefined && platforms[candidate] !== undefined) {
      key = candidate
      fallback = true
    } else {
      throw new SetupError(
        `钉版文件没有当前平台 ${host} 的 runtime\n  pin 支持：${Object.keys(platforms).join(', ')}`,
        { code: EXIT.fetch, evidence: { hostPlatform: host, supportedPlatforms: Object.keys(platforms) } },
      )
    }
  }
  const artifact = platforms[key]
  return {
    kind: 'runtime',
    platform: key,
    hostPlatform: host,
    fallback,
    // 契约 §3.1 的字面是「没有当前平台 → exit 2」；唯一的例外是上游认可的仿真组合（win32-arm64 → win32-x64），
    // 它必须显式进报告，不许当「本来就有这个平台」。
    platformFallback: fallback ? { from: host, to: key } : null,
    name: artifact.name,
    sha256: String(artifact.sha256).toLowerCase(),
    size: artifact.size,
    archiveType: artifact.archiveType,
    url: artifactUrl(pin, artifact),
  }
}

/** wheel 工件描述（跨平台同一份）。 */
export function wheelArtifact(pin) {
  const artifact = pin.wheel
  return {
    kind: 'wheel',
    platform: 'any',
    hostPlatform: platformKey(),
    fallback: false,
    platformFallback: null,
    name: artifact.name,
    sha256: String(artifact.sha256).toLowerCase(),
    size: artifact.size,
    archiveType: 'whl',
    url: artifactUrl(pin, artifact),
  }
}

/** 一次性拿到本机要用的两个工件（报告 §7 的 pin 段就是它俩）。 */
export function resolveArtifacts(pin, { platform = process.platform, arch = process.arch } = {}) {
  return { wheel: wheelArtifact(pin), runtime: runtimeArtifact(pin, { platform, arch }) }
}
