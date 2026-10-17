/**
 * 设计 token 覆盖层（票 03 交付物 → 票 07 接线）。
 *
 * 权威：`docs/design/ui-v1/assets/tokens/xs-tokens.json`（机读）+ `xs-tokens.css`（人读镜像）。
 * 裁决（assets README §4、字典 §13.3）：采用**叠加覆盖层**
 * `ctx.theme.overrideTokens(source, tokens)`，不注册独立具名主题 ——
 * 玄枢界面寄生在 DSH 主题之上、只做别名叠加。
 *
 * 形状同构证据：`profile/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/types/client/index.d.ts:153-178`
 *   `overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void`，
 *   `ThemeTokenOverrides` 值 = `{ light, dark }`（双模必填）——
 *   `xs-tokens.json` 的 `tokens` 字段正是这个形状。
 *
 * 为什么**直接引用** docs 下的 json 而不是复制一份进包：
 *   构建在仓库内跑（esbuild 把 JSON 内联进单文件产物），复制会让取值出现第二个源、
 *   与 assets README §4「取值以 xs-tokens.css 为权威」相悖。
 *   证据：`docs/design/ui-v1/assets/README.md:37`（实现票可「复制/接线」；本票选接线）。
 */
import tokens from '../../../../docs/design/ui-v1/assets/tokens/xs-tokens.json';

/** 覆盖层 source 名（`ctx.theme.overrideTokens` 的第一参；同 source 重复调用整层替换）。 */
export const THEME_SOURCE: string = tokens.source;

/** 玄枢 token 覆盖层取值：`{ '--xs-…': { light, dark } }`，与 overrideTokens 契约同构。 */
export const THEME_TOKENS: Record<string, { light: string; dark: string }> = tokens.tokens;
