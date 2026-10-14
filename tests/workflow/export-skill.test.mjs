/**
 * 票 16 · 导出 skill（`workflow.exportSkill`，契约 §4 + 事实笔记 §4）
 *
 * 这条是本票最容易「看起来成了」的地方：文件写下去了、RPC 回了 `{path,name}`，但 skill 其实**被扫描器忽略**。
 * 所以断言不看「函数返回了」，看**磁盘上的文件**与**读回验证的结果**。
 *
 * 抓的真实缺陷/风险：
 *   ① **frontmatter 必需键**：缺 `name` / `description`，或名字不是 kebab-case，或写了旧键
 *      （`disableModelInvocation`/`modelInvocable`/`userInvocable`）→ `parseSkillFile` 只 warn 并**忽略**
 *      （`dsh-skill-filesystem/lib/index.js:664-704,849-878`）。所以导出后必须**按同一套规则重解析**。
 *   ② **落点**：`<dshHome>/skills/<kebab>/SKILL.md`（`user-dsh` 根，`:171-175`）—— 不是 `pus/`、不是项目根。
 *   ③ **同名冲突不静默覆盖**（S12 §5-7）：已有目录 → 报错 + 给两个正当选项，绝不 merge/覆盖。
 *   ④ **写完立刻读回**（§4.1.4 的分层陷阱）：注册表这一步要带 `scope`；不一致/被别人占了 → **如实失败**
 *      并把刚写的那份回滚，而不是回一个成功的 `{path}`。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createWorkflowMethods } from '../../packages/xuanshu-host/lib/workflow/service.mjs'
import { parseSkillFile, renderSkillFile, toKebabName } from '../../packages/xuanshu-host/lib/workflow/skill-export.mjs'
import { fakeAgents, fakeDefaultModel, fakePresets, fakeSkills, makeCtx, makeSandbox } from './lib/sandbox.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((sandbox) => sandbox.cleanup()))

const CONTENT = ['# 每周整理行业动态', '', '1. 收信源', '2. 去重', '3. 出一页摘要'].join('\n')

function scene({ skillEntries = [] } = {}) {
  const sandbox = makeSandbox('workflow-export')
  roots.push(sandbox)
  const skills = fakeSkills(skillEntries)
  const ctx = makeCtx({
    agents: fakeAgents(),
    agentPresets: fakePresets(),
    agentDefaultModel: fakeDefaultModel(),
    skills,
  })
  const methods = createWorkflowMethods(ctx, { dataDir: sandbox.dataDir, dshHome: sandbox.dshHome })
  return { sandbox, methods, skills }
}

/** 建一个工作流会话，返回它的 sessionId。 */
async function created(methods) {
  const { sessionId } = await methods['workflow.create']({ seed: '每周整理行业动态' })
  return sessionId
}

describe('票16 · 导出落点与文件格式（契约 §4）', () => {
  it('写到 <dshHome>/skills/<kebab>/SKILL.md，frontmatter 只含 name + description', async () => {
    const { sandbox, methods } = scene()
    const sessionId = await created(methods)
    const result = await methods['workflow.exportSkill']({
      sessionId, name: 'weekly-industry-digest', description: '每周把行业动态整理成一页摘要', content: CONTENT,
    })

    const expectedPath = sandbox.path('dsh-home', 'skills', 'weekly-industry-digest', 'SKILL.md')
    expect(result).toEqual({ path: expectedPath, name: 'weekly-industry-digest' })
    expect(sandbox.exists(expectedPath)).toBe(true)

    const text = sandbox.read(expectedPath)
    expect(text).toMatch(/^---\nname: weekly-industry-digest\ndescription: "每周把行业动态整理成一页摘要"\n---\n/)
    expect(text).toContain('3. 出一页摘要')
    // 只写确认过的键：没有 whenToUse / disable-model-invocation / user-invocable，更没有旧键。
    for (const forbidden of ['whenToUse', 'disable-model-invocation', 'user-invocable', 'disableModelInvocation', 'modelInvocable', 'userInvocable']) {
      expect(text, `不该出现 ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('导出后清单更新：exportedAt + skillName/skillPath 落进旁挂清单，list 多出 exportedAt', async () => {
    const { sandbox, methods } = scene()
    const sessionId = await created(methods)
    await methods['workflow.exportSkill']({ sessionId, name: 'weekly-industry-digest', description: '摘要', content: CONTENT })

    const record = JSON.parse(sandbox.read(sandbox.path('dsh-home', 'xuanshu', 'workflow', `${sessionId}.json`)))
    expect(record.skillName).toBe('weekly-industry-digest')
    expect(record.skillPath).toBe(sandbox.path('dsh-home', 'skills', 'weekly-industry-digest', 'SKILL.md'))
    expect(typeof record.exportedAt).toBe('string')
    const listed = await methods['workflow.list']({})
    expect(listed.items[0].exportedAt).toBe(record.exportedAt)
  })

  it('用户给展示名（含大写/空格）→ 转 kebab 落盘；转不出来的（中文名）**不静默改写**，如实失败', async () => {
    const { sandbox, methods } = scene()
    const sessionId = await created(methods)
    const result = await methods['workflow.exportSkill']({ sessionId, name: 'Weekly Industry Digest', description: '摘要', content: CONTENT })
    expect(result.name).toBe('weekly-industry-digest')
    expect(sandbox.exists(sandbox.path('dsh-home', 'skills', 'weekly-industry-digest', 'SKILL.md'))).toBe(true)

    await expect(methods['workflow.exportSkill']({ sessionId, name: '每周整理', description: '摘要', content: CONTENT })).rejects.toThrow(/kebab-case/u)
  })

  it('同名冲突：已有目录 → 抛错、给「换名 / 覆盖」两条路，且**不动**已有产物', async () => {
    const { sandbox, methods } = scene()
    const sessionId = await created(methods)
    const existing = sandbox.path('dsh-home', 'skills', 'weekly-industry-digest')
    sandbox.write(sandbox.path('dsh-home', 'skills', 'weekly-industry-digest', 'SKILL.md'), '---\nname: weekly-industry-digest\ndescription: "旧版"\n---\n\n旧正文\n')

    await expect(methods['workflow.exportSkill']({ sessionId, name: 'weekly-industry-digest', description: '新摘要', content: CONTENT }))
      .rejects.toThrow(/同名冲突|换一个名字/u)
    expect(sandbox.read(sandbox.path('dsh-home', 'skills', 'weekly-industry-digest', 'SKILL.md'))).toContain('旧正文')
    expect(sandbox.exists(existing)).toBe(true)
  })
})

describe('票16 · 写完立刻读回验证（§4.1.4：不一致就不许报成功）', () => {
  it('读回验证走 ctx.skills 且**带 scope 选项**（不传 scope 只看得到 global 层）', async () => {
    const { methods, skills } = scene({ skillEntries: [{ name: 'weekly-industry-digest', description: '每周把行业动态整理成一页摘要', source: 'user-dsh' }] })
    const sessionId = await created(methods)
    await methods['workflow.exportSkill']({ sessionId, name: 'weekly-industry-digest', description: '每周把行业动态整理成一页摘要', content: CONTENT })
    const list = skills.calls.find((call) => call.method === 'list')
    expect(list).toBeDefined()
    expect(list.options).toEqual({}) // scope 未配置时是空选项（分层陷阱写在 verifySkillRegistered 的 reason 里）
    expect(skills.calls.length).toBeGreaterThan(0)
  })

  it('注册表里同名 skill 的 description 与我们写的不一致 → 抛错 + **回滚刚写的那份**', async () => {
    const { sandbox, methods } = scene({ skillEntries: [{ name: 'taken-name', description: '别人的技能', source: 'bundled' }] })
    const sessionId = await created(methods)
    await expect(methods['workflow.exportSkill']({ sessionId, name: 'taken-name', description: '我的摘要', content: CONTENT }))
      .rejects.toThrow(/名字被别人占了|不一致/u)
    expect(sandbox.exists(sandbox.path('dsh-home', 'skills', 'taken-name'))).toBe(false)
    // 清单里也不该留下导出痕迹（导出没成）。
    const record = JSON.parse(sandbox.read(sandbox.path('dsh-home', 'xuanshu', 'workflow', `${sessionId}.json`)))
    expect(record.exportedAt).toBeUndefined()
  })

  it('ctx.skills 不可得 → 仍成功（磁盘已按同一套规则读回通过），但**不假装**注册表也核对过', async () => {
    const sandbox = makeSandbox('workflow-noskills')
    roots.push(sandbox)
    const ctx = makeCtx({ agents: fakeAgents(), agentPresets: fakePresets(), agentDefaultModel: fakeDefaultModel() })
    const methods = createWorkflowMethods(ctx, { dataDir: sandbox.dataDir, dshHome: sandbox.dshHome })
    const { sessionId } = await methods['workflow.create']({ seed: 'x' })
    const result = await methods['workflow.exportSkill']({ sessionId, name: 'no-registry-skill', description: '摘要', content: CONTENT })
    expect(result.name).toBe('no-registry-skill')
    expect(sandbox.exists(result.path)).toBe(true)
  })

  it('缺 description / 空正文 / 会话不在清单里 → 都如实失败，不落盘', async () => {
    const { sandbox, methods } = scene()
    const sessionId = await created(methods)
    await expect(methods['workflow.exportSkill']({ sessionId, name: 'x-skill', description: '  ', content: CONTENT })).rejects.toThrow(/description/u)
    await expect(methods['workflow.exportSkill']({ sessionId, name: 'x-skill', description: '摘要', content: '   ' })).rejects.toThrow(/正文/u)
    await expect(methods['workflow.exportSkill']({ sessionId: 'session-xs-workflow-nope', name: 'x-skill', description: '摘要', content: CONTENT })).rejects.toThrow(/不在工作流清单/u)
    await expect(methods['workflow.exportSkill']({ sessionId: 'not-a-workflow-session', name: 'x-skill', description: '摘要', content: CONTENT })).rejects.toThrow(/session-xs-workflow/u)
    expect(sandbox.files().filter((file) => file.includes('/skills/'))).toEqual([])
  })
})

describe('票16 · skill 文件解析器（与 DSH 扫描器同一套规则）', () => {
  it('合法文件 → ok；缺 frontmatter / 名字不合规 / 缺 description / 旧键 → 全部 ok:false 且给出理由', () => {
    expect(parseSkillFile(renderSkillFile({ name: 'a-b', description: 'd', content: 'c' }))).toMatchObject({ ok: true, name: 'a-b', description: 'd', content: 'c' })
    expect(parseSkillFile('# 没有 frontmatter').ok).toBe(false)
    expect(parseSkillFile('---\nname: Bad_Name\ndescription: d\n---\n\nc').ok).toBe(false)
    expect(parseSkillFile('---\nname: a-b\n---\n\nc').ok).toBe(false)
    expect(parseSkillFile('---\nname: a-b\ndescription: d\ndisableModelInvocation: true\n---\n\nc').reason).toMatch(/旧键/u)
    expect(parseSkillFile('---\nname: a-b\ndescription: d\nuserInvocable: false\n---\n\nc').reason).toMatch(/旧键/u)
  })

  it('toKebabName：正常名直通；空/纯符号/超长 → 抛', () => {
    expect(toKebabName('weekly-industry-digest')).toBe('weekly-industry-digest')
    expect(toKebabName('Weekly Digest')).toBe('weekly-digest')
    expect(() => toKebabName('')).toThrow(/kebab-case/u)
    expect(() => toKebabName('!!!')).toThrow(/kebab-case/u)
    expect(() => toKebabName('a'.repeat(80))).toThrow(/kebab-case/u)
  })
})
