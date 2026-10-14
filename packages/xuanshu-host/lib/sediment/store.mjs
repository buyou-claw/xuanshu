/**
 * packages/xuanshu-host/lib/sediment/store.mjs — 沉淀草稿的**暂存区**（契约 §3；S10 §1「草稿区」）。
 *
 * 草稿落 `<dataDir>/sediment/<draftId>.json`，schema `xuanshu/sediment@1`。
 *
 * **为什么草稿不落在 `pus/` 里**（S10 §1 的一句话边界）：草稿区与谱目录是两件事 ——
 * 草稿进去不等于「已写入」，`pus/**` 只由 `sediment.commit`（人点确认）经票 09 的写路径碰。
 * 把草稿混进谱目录，最轻的症状是谱列表里冒出一本没确认过的谱；最重的症状是
 * 「AI 已经动过我的谱」这条产品红线被静默越过去。
 *
 * **为什么是「一草稿一文件」而不是一份总索引**：与票 10 的旁挂清单同款理由（ADR-0009
 * Consequences：只在单份记录之上做只读聚合，不引入第二份权威）。丢弃一份草稿 = 删一个文件，
 * 没有需要同步的索引。
 *
 * 写入与票 10 的旁挂清单同法：**同目录临时文件 + rename**。半个 JSON 的草稿比没有草稿更坏
 * （读回来的是语法错误，界面只能说「读不出来」，而真正的原因已经丢了）。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { puSlug } from '../pu/repository.mjs'

/** 草稿 schema（契约 §3 冻结；换结构时它就是迁移锚点）。 */
export const SEDIMENT_SCHEMA = 'xuanshu/sediment@1'
/** 数据目录下的草稿子目录名（契约 §3 定值）。 */
export const SEDIMENT_DIR = 'sediment'
/** 草稿 id 的字符面：`randomUUID()` 的产物 + 将来可能的人工可读后缀。 */
const DRAFT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u

/** 草稿区根目录。 */
export function sedimentRoot(dataDir) {
  return resolve(dataDir, SEDIMENT_DIR)
}

/** 铸一个新草稿 id（`randomUUID()`；字符面天然落在 `DRAFT_ID_PATTERN` 内）。 */
export function newDraftId() {
  return randomUUID()
}

/**
 * 草稿 id 是否安全（**路径穿越面**的判据）。
 * id 直接参与文件名，所以只认 `[A-Za-z0-9._-]`，且不许是 `.` / `..`。
 */
export function isDraftId(value) {
  if (typeof value !== 'string' || !DRAFT_ID_PATTERN.test(value)) return false
  return value !== '.' && value !== '..'
}

/** 草稿文件路径；`draftId` 必须先过 `isDraftId()`（调用方负责）。 */
export function sedimentDraftPath(dataDir, draftId) {
  return join(sedimentRoot(dataDir), `${draftId}.json`)
}

/**
 * 归一一份草稿正文（`{description, body, summary}`）。
 *
 * 三条口径与票 09 的谱规范 v1 对齐（`validatePuDraft`）：概览非空、正文含 `# 概览`、
 * summary 是文本。**在草稿这一步就校验**，是为了让「存下来的草稿一定是可提交的」成立 ——
 * 否则人点了确认才第一次发现模型没给 summary，那次点击就白费了。
 *
 * @param {unknown} value 待归一的草稿（模型产出的、或人改过的）
 * @returns {{description: string, body: string, summary: string}}
 */
export function normalizeDraftDraft(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('草稿正文必须是对象（description / body / summary）。')
  }
  const description = typeof value.description === 'string' ? value.description.trim() : ''
  if (description === '') throw new Error('草稿缺少概览（description）：沉淀必须先说清「这本谱讲什么」。')
  const body = typeof value.body === 'string' ? value.body.trim() : ''
  if (body === '') throw new Error('草稿正文为空（body）。')
  if (!/^#\s+.*概览.*$/m.test(body)) throw new Error('草稿正文必须包含一级「概览」节（谱规范 v1）。')
  if (value.summary !== undefined && typeof value.summary !== 'string') throw new Error('草稿 summary 必须是文本。')
  return { description, body, summary: typeof value.summary === 'string' ? value.summary : '' }
}

/**
 * 归一草稿的目标谱（`{slug, name}`）。
 * slug 必须是票 09 `puSlug()` 的规范形：不规范的 slug 一定读不出那本谱，
 * 与其等到提交时才发现，不如在草稿这一步就拒掉。
 */
export function normalizeTarget(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('草稿缺少目标谱（target）。')
  }
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (name === '') throw new Error('目标谱缺少名字（target.name）。')
  const slug = typeof value.slug === 'string' ? value.slug.trim() : ''
  if (slug === '') throw new Error('目标谱缺少 slug（target.slug）。')
  let canonical
  try {
    canonical = puSlug(slug)
  } catch {
    throw new Error(`目标谱 slug 不是规范形式：${JSON.stringify(slug)}。`)
  }
  if (canonical !== slug) throw new Error(`目标谱 slug 不是规范形式：${JSON.stringify(slug)}（规范形是 ${JSON.stringify(canonical)}）。`)
  return { slug, name }
}

/**
 * 草稿仓：一草稿一文件，原子替换写。
 *
 * `read()` 认不出 schema 就返回 null（**不按今天的字段去解释旧结构**，同票 10 的旁挂清单）；
 * 调用方决定怎么把它讲成人话。
 */
export function createSedimentStore(dataDir) {
  const dir = sedimentRoot(dataDir)
  const fileOf = (draftId) => sedimentDraftPath(dataDir, draftId)

  /** 原子写（同目录临时文件 + rename）。 */
  function write(record) {
    mkdirSync(dir, { recursive: true })
    const target = fileOf(record.draftId)
    const tmp = join(dir, `.${record.draftId}.json.${process.pid}.${randomUUID()}.tmp`)
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    try {
      renameSync(tmp, target)
    } catch (error) {
      try {
        rmSync(tmp, { force: true })
      } catch {
        /* 临时文件清不掉不掩盖原错误 */
      }
      throw error
    }
    return record
  }

  return {
    root: sedimentRoot(dataDir),
    dir,
    fileOf,

    /**
     * 存一份草稿（契约 §3 的落盘形状）。
     * @param {{sessionId: string, target: {slug: string, name: string}, draft: object, draftId?: string, createdAt?: string}} input
     */
    create({ sessionId, target, draft, draftId = newDraftId(), createdAt = new Date().toISOString() }) {
      if (typeof sessionId !== 'string' || sessionId === '') throw new Error('草稿缺少来源会话（sessionId）。')
      if (!isDraftId(draftId)) throw new Error(`草稿 id 形状不对：${JSON.stringify(draftId)}。`)
      return write({
        schema: SEDIMENT_SCHEMA,
        draftId,
        sessionId,
        createdAt,
        target: normalizeTarget(target),
        draft: normalizeDraftDraft(draft),
      })
    },

    /** 读一份草稿；不存在 / 读不出来 / 不是本 schema → null。 */
    read(draftId) {
      if (!isDraftId(draftId)) return null
      let raw
      try {
        raw = readFileSync(fileOf(draftId), 'utf8')
      } catch {
        return null
      }
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        return null
      }
      if (parsed === null || typeof parsed !== 'object' || parsed.schema !== SEDIMENT_SCHEMA) return null
      if (parsed.draftId !== draftId) return null
      if (typeof parsed.sessionId !== 'string' || parsed.sessionId === '') return null
      if (typeof parsed.createdAt !== 'string' || parsed.createdAt === '') return null
      try {
        return {
          schema: SEDIMENT_SCHEMA,
          draftId,
          sessionId: parsed.sessionId,
          createdAt: parsed.createdAt,
          target: normalizeTarget(parsed.target),
          draft: normalizeDraftDraft(parsed.draft),
        }
      } catch {
        // 结构自相矛盾（缺字段 / slug 不规范）：当作读不出来，不把半份草稿送进确认流程。
        return null
      }
    },

    /**
     * 删一份草稿。
     * @returns {boolean} 真的删掉了（文件本来就不在 → false，由调用方决定要不要报错）
     */
    remove(draftId) {
      if (!isDraftId(draftId)) return false
      const file = fileOf(draftId)
      if (!existsSync(file)) return false
      rmSync(file, { force: true })
      return true
    },

    /** 现有草稿数（诊断/界面用；不参与任何权威判定）。 */
    count() {
      if (!existsSync(dir)) return 0
      return readdirSync(dir).filter((name) => name.endsWith('.json') && !name.startsWith('.')).length
    },
  }
}
