/**
 * `packages/xuanshu-client/src/client/breakpoints.ts` — 断点的**唯一来源**。
 *
 * 为什么要有这个文件（spec 003 判据 T-003）：媒体查询吃不了 `var()`，所以断点没法像颜色那样
 * 直接 `var(--xs-…)`。收敛前全仓有 9 处字面 `1100px` / `700px`，改一次断点要全仓搜。
 * 这里把**数值**集中成两个常量，样式里一律模板插值，字面值不再出现在任何 `@media` 里。
 *
 * 值本身仍然只有一份权威：设计字典的 `--xs-size-breakpoint-wide`（`xs-tokens.json`，1100px）。
 * 窄断点在设计字典里**还没有对应 token**（已登记为待补），所以它带一个显式 fallback 住在这里，
 * 而不是散落在样式里。
 */
import tokens from '../../../../docs/design/ui-v1/assets/tokens/xs-tokens.json';

/**
 * 从主题 token 里读一个尺寸值并转成数字。
 *
 * 读不到 / 不是 `px` 值 → **直接抛**，不静默退回一个字面量：
 * 静默 fallback 会把刚收敛掉的字面值又写回产物里，而且「断点悄悄变成 1100」这种事
 * 在界面上表现为「宽屏不换列」——比构建期炸掉难查一百倍。这条 throw 在
 * `node scripts/build-client.mjs` 的物化自检里就会炸，等于把问题挡在提交前。
 */
function sizePx(name: string): number {
  const table = (tokens as { tokens?: Record<string, { light?: string }> }).tokens ?? {};
  const raw = table[name]?.light;
  if (typeof raw !== 'string' || !/^\d+(\.\d+)?px$/u.test(raw)) {
    throw new Error(`breakpoints: token「${name}」读不到或不是 px 值（拿到 ${JSON.stringify(raw)}）—— 断点的值只认设计 token`);
  }
  return Number(raw.replace(/px$/u, ''));
}

/** 宽屏断点（`--xs-size-breakpoint-wide` = 1100px）：`>=` 该宽度走两列布局。 */
export const BREAKPOINT_WIDE_PX = sizePx('--xs-size-breakpoint-wide');

/**
 * 窄屏断点（700px）：设计字典里**没有**对应 token（`--xs-size-breakpoint-narrow` 尚未登记），
 * 所以它在这里显式落一个值，并在设计稿侧登记为待补 —— 而不是在样式里再写一遍字面量。
 */
export const BREAKPOINT_NARROW_PX = 700;
