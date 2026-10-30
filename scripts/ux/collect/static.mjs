#!/usr/bin/env node
/**
 * `scripts/ux/collect/static.mjs` —— **静态半边**的证据采集器（spec 003 · 模块 3a）。
 *
 * 它不做判定、不启浏览器、不写源码：只把「这个界面面的这批源文件里，事实是什么」收成证据。
 * 判定全部落在 `scripts/ux/judge.mjs`（唯一判定点），所以本文件永远不该出现 pass/fail 字样。
 *
 * 两种失败必须分得开（spec 003 §15）：
 *   - `collection-failed`：检查器自己炸了（读不到文件、形状不对）——这是采集失败；
 *   - 没有证据：调用方根本没采（例如这条判据是 `browser` 的）——这是「未采到」。
 * 两者都**不等于通过**，只是原因不同。
 *
 * 仅使用 Node 内置模块。ESM。
 */
import { createSourceCache } from './source-cache.mjs'
import { probeFor } from '../probes/index.mjs'
import { applicableFaces } from '../scope.mjs'

/** 证据来源标识（报告里区分两半，判定引擎不区分）。 */
export const STATIC_COLLECTOR = 'static'

/**
 * 跑静态半边。
 *
 * @param {{repoRoot: string, criteria: {criteria: object[]}, faces: object[], facesWithSources: object[]}} input
 *   `facesWithSources` 是带 `sources` 的界面面清单（`faceManifest()`）；`faces` 只用于适用范围。
 * @returns {{evidence: object[], notes: string[], scannedFiles: number}}
 */
export function collectStatic({ repoRoot, criteria, faces }) {
  const cache = createSourceCache({ repoRoot })
  const evidence = []
  const notes = []

  for (const criterion of criteria.criteria) {
    if (criterion.tombstone === true) continue
    if (criterion.check !== STATIC_COLLECTOR) continue
    const probe = probeFor(criterion)
    for (const face of applicableFaces(criterion, faces)) {
      const base = { criterionId: criterion.id, face: face.id, collector: STATIC_COLLECTOR }
      try {
        const collected = probe({ face, read: cache.read, repoRoot })
        evidence.push({ ...base, status: 'observed', facts: collected.facts, evidence: collected.evidence ?? [] })
      } catch (error) {
        // 采集失败照实说：不编一个空 facts 让判定器误判成「没问题」。
        evidence.push({
          ...base,
          status: 'collection-failed',
          reason: error?.message ?? String(error),
          facts: null,
          evidence: [],
        })
      }
    }
  }

  const scannable = faces.filter((face) => Array.isArray(face.sources) && face.sources.length > 0)
  if (scannable.length !== faces.length) {
    notes.push(`有 ${faces.length - scannable.length} 个界面面没有登记源文件，静态半边采不到它们`)
  }
  return { evidence, notes, scannedFiles: cache.reads() }
}
