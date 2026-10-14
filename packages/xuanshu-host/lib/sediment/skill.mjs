/**
 * packages/xuanshu-host/lib/sediment/skill.mjs — 内置 skill `xuanshu:sediment`（契约 §3）。
 *
 * 与票 09 的 `pu/service.mjs: installPuSkill` 同一形态：`ctx.skills.register({name, description,
 * source:'bundled', content})` 把**运行期**的 skill 交给 DSH（不落盘、不碰 `$DSH_HOME/skills`）。
 *
 * 三条依据（`.scratch/notes/dsh-api-facts.md` §4）：
 *   - 注册面是 `ctx.skills.register()`（`dsh-skill/lib/types/index.d.ts:257`，返回 disposer）；
 *   - 名字必须是 kebab-case 且与正文标题分得开：DSH 的 `isSkillName` 不认 `xuanshu:sediment`，
 *     所以**注册名**是 `xuanshu-sediment`，正文标题仍是人读的 `# xuanshu:sediment`
 *     （票 09 的 `create-pu.md` 就是这么处理的：注册名 `xuanshu-create-pu`）；
 *   - skill 是「手写正文 + 严格校验」不是「结构化输出」：rc.2 没有 `json_schema`
 *     （ADR-0010），所以正文里逐字写明「只输出一个 JSON 对象」并由 `parseDraftAnswer()` 校验。
 *
 * **为什么不在宿主的 `ctx.skills.list()` 上再读一次做自检**：web profile 把宿主层
 * `skill-filesystem` 关了、改由 agent preset 每 agent 挂载，`list()` 不传 `scope` 只看得到
 * global 层（facts §4.1.4）。注册成功与否的判据只能是「register 没抛」，别的都会假绿。
 */
import { readFileSync } from 'node:fs'

/** skill 正文（`sediment.md`，随包走）。 */
const SKILL_TEXT = readFileSync(new URL('./sediment.md', import.meta.url), 'utf8')

/** DSH 注册名（kebab-case；`xuanshu:sediment` 里的冒号过不了 `isSkillName`）。 */
export const SEDIMENT_SKILL_NAME = 'xuanshu-sediment'
/** 一句话描述（DSH 必填字段；也是模型判断「什么时候用我」的依据）。 */
export const SEDIMENT_SKILL_DESCRIPTION = 'xuanshu:sediment：把一场问事会话汇成「更新到谱」的草稿（只产出草稿，写谱由人确认）'

/** skill 正文文本（seed 进提示时也用它 —— 注册与提示同一份，不许两处措辞漂移）。 */
export function sedimentSkillText() {
  return SKILL_TEXT
}

/**
 * 注册内置 skill（`ctx.skills.register`）。
 * skills 服务不在场时静默跳过：skill 是「模型能不能自己发现这条能力」，而沉淀的主路径
 * （按钮 → `sediment.draft`）不依赖它 —— 提示里内联了同一份正文。
 * @returns {boolean} 是否真的注册上（供装配日志/断言台）
 */
export function installSedimentSkill(ctx) {
  if (typeof ctx?.inject !== 'function') return false
  try {
    ctx.inject(['skills'], (scoped) =>
      scoped.skills.register({
        name: SEDIMENT_SKILL_NAME,
        description: SEDIMENT_SKILL_DESCRIPTION,
        source: 'bundled',
        content: SKILL_TEXT,
      }),
    )
    return true
  } catch {
    return false
  }
}
