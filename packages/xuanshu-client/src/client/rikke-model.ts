/**
 * #24 · 日课两段式的**纯映射**（卡与面板共用一份文案口径）。
 *
 * 为什么单独一个文件：AI 段有三态，而「三态怎么写成人话」必须只有一处 —— 否则卡上写「已关闭」、
 * 面板上写「失败」，同一个产物在两处说两件事。这个模块没有 React、没有 RPC，可无 DOM 断言。
 */
import type { RikkeAiNote } from './rikke-api.js';

/** 关掉 AI 段时的逐字文案（关闭 ≠ 失败：用户看到的是自己做的选择）。 */
export const RIKKE_AI_OFF_TEXT = '今天没有 AI 建议（已关闭）';

/** AI 段视图（`none` = 旧产物没有 ai 键：整段不渲染，也不编一句「没有建议」）。 */
export type RikkeAiView =
  | { kind: 'none' }
  | { kind: 'ok'; text: string }
  | { kind: 'off'; text: string }
  | { kind: 'failed'; text: string };

/**
 * `ai` 三态 → 界面文案。
 * @param ai - `rikke.status.ai`（可能缺席：旧产物 / 压缩 profile）。
 * @returns 视图（`kind` 同时是 `data-xuanshu-ai` 的取值）。
 */
export function rikkeAiView(ai: RikkeAiNote | undefined): RikkeAiView {
  if (ai === undefined) return { kind: 'none' };
  if (ai.mode === 'ok') {
    const text = typeof ai.text === 'string' ? ai.text.trim() : '';
    // 「ok 但没有文本」是宿主侧的形状违约：按失败说，不假装有内容。
    return text === ''
      ? { kind: 'failed', text: 'AI 建议生成失败：宿主没有回传内容。' }
      : { kind: 'ok', text };
  }
  if (ai.mode === 'off') return { kind: 'off', text: RIKKE_AI_OFF_TEXT };
  if (ai.mode === 'failed') {
    const reason = typeof ai.reason === 'string' && ai.reason.trim() !== '' ? ai.reason.trim() : '（没有给理由）';
    return { kind: 'failed', text: `AI 建议生成失败：${reason}` };
  }
  return { kind: 'none' };
}
