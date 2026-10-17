/**
 * packages/xuanshu-host/lib/workflow/skill-export.mjs — 导出 skill 落 DSH 的扫描路径（票 16 契约 §4）。
 *
 * 落点：`<dshHome>/skills/<kebab-name>/SKILL.md` —— 那是 `dsh-skill-filesystem` 的 **`user-dsh`** 根
 * （`dsh-skill-filesystem/lib/index.js:171-175`），「无需用户指定路径」就是用它做缺省。
 *
 * 三条真机事实（`.scratch/notes/dsh-api-facts.md` §4.1/§4.1.3，逐条有 file:line）： *   1. frontmatter **必填 `name`（kebab-case）+ `description`**；缺一个、名字不合规、YAML 坏 →
 *      扫描器**只打一条 warn 然后把整个 skill 忽略**（`:664-704` `parseSkillFile`）。所以这里**只写**
 *      确认过的键，不写 `whenToUse` / `disable-model-invocation` / `user-invocable`（用户没给就不编）。
 *   2. **旧键 `disableModelInvocation` / `modelInvocable` / `userInvocable` 会让 skill 被直接忽略**
 *      （`:849-878` `parseInvocationPolicy` 显式拒绝）—— 本模块一个都不产生。
 *   3. **分层陷阱**：web profile 把宿主层 `skill-filesystem` 关了、改由 agent preset 每 agent 挂载，
 *      于是宿主 `ctx.skills.list()` 不传 `scope` 只看得到 global 层（§4.1.4）。所以**写完必须读回**：
 *      先按同一套规则**自己重解析磁盘文件**（这一步不依赖任何服务，永远做），
 *      再在 `ctx.skills` 可得时用 `scope` 查注册表；两处任何一处与期望不符 → **如实失败**，不报成功。
 *
 * 「工作流不是谱」：本模块与 `pus/` 无关，产物是 skill（DSH 的技能中心管它）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** skill 目录名（kebab-case）的判据：小写字母/数字，单连字符分隔，首尾不是连字符。 */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** DSH 的 skill 名上限（`isSkillName` 的常见约束；超了扫描器直接忽略）。 */
const NAME_LIMIT = 64

/**
 * 名字是不是合法的 skill 目录名（与导出 / DSH 扫描器**同一条判据**）。
 *
 * 为什么单独导出（票 31）：工作流挂载会按清单里的 `skillName` 去拼
 * `<dshHome>/skills/<name>/SKILL.md`，而清单是本地 JSON（可被手改）——
 * 不校验就把 `../..` 之类拼进路径，等于允许从挂载读任意文件。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSkillName(value) {
  return typeof value === 'string' && value.length <= NAME_LIMIT && KEBAB.test(value)
}

/** `<dshHome>/skills`（`user-dsh` 根）。 */
export function skillsRoot(dshHome) {
  return join(dshHome, 'skills')
}

/** 一个 skill 的目录 / 文件。 */
export function skillDir(dshHome, name) {
  return join(skillsRoot(dshHome), name)
}

export function skillFile(dshHome, name) {
  return join(skillDir(dshHome, name), 'SKILL.md')
}

/**
 * 用户给的名字 → kebab-case（**不静默改写**：改不出合法名就抛，让用户自己起）。
 * 允许的输入：已经是 kebab、或含空格/下划线/大写/中文的展示名（转写不出汉字 → 抛）。
 */
export function toKebabName(value) {
  const raw = String(value ?? '').trim()
  const candidate = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (candidate === '' || !KEBAB.test(candidate) || candidate.length > NAME_LIMIT) {
    throw new Error(`skill 名不合法：${JSON.stringify(raw)}（要 kebab-case：小写字母、数字、单连字符，≤${NAME_LIMIT} 字符；中文名请给一个英文名）。`)
  }
  return candidate
}

/** frontmatter 的最小合法形状（**只有确认过的两个键**；可选键用户没给就不写）。 */
export function renderSkillFile({ name, description, content }) {
  const desc = String(description ?? '').trim().replace(/\r?\n+/g, ' ')
  if (desc === '') throw new Error('skill 缺 description：DSH 的扫描器把 `description` 当必填，缺了会整个忽略这个 skill。')
  const body = String(content ?? '').trim()
  if (body === '') throw new Error('skill 正文为空：导出一个空技能没有意义。')
  return `---\nname: ${name}\ndescription: ${JSON.stringify(desc)}\n---\n\n${body}\n`
}

/**
 * 按 DSH 扫描器的同一套规则解析一份 SKILL.md（**读回验证**用；不依赖任何服务）。
 * @returns {{ok: boolean, name?: string, description?: string, content?: string, reason?: string}}
 */
export function parseSkillFile(text) {
  const raw = String(text ?? '')
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!front) return { ok: false, reason: '缺少 YAML frontmatter（扫描器会直接忽略这个 skill）。' }
  const meta = {}
  for (const line of front[1].split(/\r?\n/)) {
    const match = /^([A-Za-z_-]+):\s*(.*)$/.exec(line)
    if (match) meta[match[1]] = match[2].trim()
  }
  const name = meta.name?.replace(/^["']|["']$/g, '') ?? ''
  if (name === '' || !KEBAB.test(name)) return { ok: false, reason: `frontmatter 的 name 缺失或不是 kebab-case（拿到 ${JSON.stringify(name)}）。` }
  let description = meta.description ?? ''
  if (description.startsWith('"') || description.startsWith("'")) {
    try {
      description = JSON.parse(description)
    } catch {
      description = description.slice(1, -1)
    }
  }
  if (description.trim() === '') return { ok: false, reason: 'frontmatter 的 description 缺失或为空（必填）。' }
  for (const legacy of ['disableModelInvocation', 'modelInvocable', 'userInvocable']) {
    if (legacy in meta) return { ok: false, reason: `frontmatter 用了旧键 ${legacy}：DSH 会因为这个键**忽略整个 skill**。` }
  }
  return { ok: true, name, description: description.trim(), content: front[2].trim() }
}

/**
 * 导出 skill：写盘 → **立刻读回验证**。
 *
 * @param {{dshHome: string, name: string, description: string, content: string, ctx?: object}} input
 * @returns {{ok: true, path: string, name: string, verified: string} | never} 失败一律抛可读错误
 */
export function exportSkillFile({ dshHome, name, description, content }) {
  const kebab = toKebabName(name)
  const dir = skillDir(dshHome, kebab)
  const file = skillFile(dshHome, kebab)
  // 同名冲突**不静默覆盖**（S12 §5-7：给「换个名字 / 覆盖」两条正当路，这里只负责拒绝）。
  if (existsSync(dir)) {
    throw new Error(`同名冲突：${dir} 已存在。换一个名字，或先自己备份/删除旧产物再导出（本操作不覆盖任何已有 skill）。`)
  }
  mkdirSync(dir, { recursive: true })
  const text = renderSkillFile({ name: kebab, description, content })
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' })
  try {
    renameSync(tmp, file)
  } catch (error) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* 不掩盖原错误 */
    }
    throw error
  }

  // ① 读回验证（磁盘重解析，不依赖服务）：frontmatter 键、名字、正文逐条对齐。
  const readBack = parseSkillFile(readFileSync(file, 'utf8'))
  if (!readBack.ok) throw new Error(`导出后读回验证失败：${readBack.reason}（文件已写在 ${file}）`)
  if (readBack.name !== kebab) throw new Error(`导出后读回验证失败：文件里的 name=${JSON.stringify(readBack.name)} ≠ ${JSON.stringify(kebab)}。`)
  const expectedBody = String(content).trim()
  if (readBack.content !== expectedBody) throw new Error('导出后读回验证失败：文件正文与导出内容不一致（写盘或编码出了问题）。')
  return { ok: true, path: file, name: kebab, verified: 'file' }
}

/** 非严格读 cordis service。 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name, false) : undefined
  } catch {
    return undefined
  }
}

/**
 * 在 skill 注册表里核对这个名字（**必须带 `scope`**，否则只看得到 global 层 —— §4.1.4 的分层陷阱）。
 *
 * @returns {{checked: boolean, found: boolean, conflict: boolean, reason: string}}
 *   `checked:false` = 注册表不可得（不当作失败：磁盘那一步已经验过格式与内容）
 */
export async function verifySkillRegistered(ctx, { name, scope, description }) {
  const skills = softGet(ctx, 'skills')
  if (typeof skills?.list !== 'function') {
    return { checked: false, found: false, conflict: false, reason: '`ctx.skills` 不可得：只做了磁盘读回验证（格式与内容已核对）。' }
  }
  let entries
  try {
    // **必须 await**：`SkillRegistry.list(options?) => Promise<SkillSummary[]>`（真机取证改出来的，
    // 见文件头 §读回验证）。同步取数组的话 `Array.isArray(Promise)` 永远 false —— 每次都报「没看到」，
    // 听起来像 watcher 没生效，其实是我自己没 await。
    entries = await skills.list(scope === undefined ? {} : { scope })
  } catch (error) {
    return { checked: false, found: false, conflict: false, reason: `读 ctx.skills.list() 失败：${String(error?.message ?? error)}` }
  }
  if (!Array.isArray(entries)) {
    // 官方签名是 `Promise<SkillSummary[]>`；拿到的不是数组说明服务面变了 —— 如实说没核对上，别猜。
    return { checked: false, found: false, conflict: false, reason: `ctx.skills.list() 没回数组（拿到 ${typeof entries}）：这一版服务面与事实笔记 §4.1.3 记的形状不一致，注册表这一步没核对上。` }
  }
  const hit = entries.find((entry) => entry?.name === name)
  if (hit === undefined) {
    // 扫描器是文件系统 watcher，**运行期即时可见性未确认**（事实笔记 §4.4）→ 不把它当失败，
    // 但如实把「注册表这一步没看到」写进 reason，别把没核对的说成核对过了。
    return { checked: true, found: false, conflict: false, reason: `磁盘已写入并按同一套规则读回通过；但注册表这一层暂时没看到 ${name}（宿主层看不到 preset 层扫出来的 user-dsh skill，watcher 即时性也未确认）——它会在 skill 扫描路径里被下一次扫描收进去。` }
  }
  const hitDescription = typeof hit.description === 'string' ? hit.description : ''
  if (description !== undefined && hitDescription !== '' && hitDescription !== description) {
    return { checked: true, found: true, conflict: true, reason: `注册表里同名 skill 的 description 与我们写的不一致（注册表 ${JSON.stringify(hitDescription)} ≠ 导出 ${JSON.stringify(description)}）：名字被别人占了，请换名。` }
  }
  return { checked: true, found: true, conflict: false, reason: '' }
}
