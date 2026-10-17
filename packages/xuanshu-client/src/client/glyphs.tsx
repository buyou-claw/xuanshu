/**
 * 票 03 素材的**形状照抄**（F4：不 require 任何 Harness Client 包、不引外部资源文件；
 * 上游明文规则见 `profile/…/dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:35`
 * 「照抄 markup + CSS，类名改自己的前缀」）。
 *
 * 几何来源（逐枚对照，只改类名/JSX 属性名，坐标与描边阶梯不动）：
 *   - `docs/design/ui-v1/assets/icons/nav/nav-overview.svg`        → asset.S1-1（侧栏「家」行，viewBox 24）
 *   - `docs/design/ui-v1/assets/icons/card/card-mingpan.svg`       → asset.S1-2（命盘卡卡头，viewBox 20）
 *   - `docs/design/ui-v1/assets/icons/card/card-rike.svg`          → asset.S1-3（日课卡卡头，viewBox 20）
 *   - `docs/design/ui-v1/assets/icons/card/card-digao.svg`         → asset.S1-4（底稿卡卡头，viewBox 20）
 *   - `docs/design/ui-v1/assets/icons/nav/nav-quick-consult.svg`   → asset.S1-5（问事格，viewBox 24）
 *   - `docs/design/ui-v1/assets/icons/nav/nav-quick-workspace.svg` → asset.S1-5（工作区格，viewBox 24）
 *   - `docs/design/ui-v1/assets/icons/nav/nav-quick-workflow.svg`  → asset.S1-5（工作流格，viewBox 24）
 *   - `docs/design/ui-v1/assets/illus/empty/mingpan-empty.svg`     → asset.S1-6（命盘卡空态，viewBox 120×80）
 *   - `docs/design/ui-v1/assets/illus/empty/rike-empty.svg`        → asset.S1-7（日课卡空态，viewBox 120×80）
 *   - `docs/design/ui-v1/assets/illus/empty/digao-empty.svg`       → asset.S1-8（底稿卡空态，viewBox 120×80）
 *   - `docs/design/ui-v1/assets/illus/result/cards-error.svg`      → asset.S1-9（四卡共用 error 态，viewBox 120×80）
 *
 * 素材技术契约（assets README §3.1/§3.2）：图标一律 `currentColor` 单色可继承、
 * 无字面颜色；插画的第二层次用 `currentColor` + `opacity`，同样无字面颜色。
 */

/** 通用图标 props（尺寸由消费方给，图标自身不写 width/height 固定属性）。 */
export interface GlyphProps {
  /** 类名（`xs-` 前缀，样式走内容 CSS）。 */
  className?: string;
  /** 方形边长（px）；侧栏/卡头用宿主给的尺寸语义。 */
  size?: number;
}

/** 侧栏「家 / 总览」行图标（asset.S1-1；同枚也是 S15 六行之首）。 */
export function GlyphOverview({ className = 'xs-glyph', size = 20 }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 10.5 L12 4.5 L20 10.5" />
      <path d="M6 9 V19.5 H18 V9" />
      <path d="M10 19.5 V14 H14 V19.5" />
    </svg>
  );
}

/** 命盘卡卡头图标（asset.S1-2）。 */
export function GlyphCardMingpan({ className = 'xs-glyph', size = 20 }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 3.5 V16.5 M3.5 10 H16.5" />
      <circle cx="10" cy="10" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 日课卡卡头图标（asset.S1-3；S14 复用同枚）。 */
export function GlyphCardRike({ className = 'xs-glyph', size = 20 }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5 V10 L13 12.5" />
      <path d="M3.5 13.5 H16.5" />
    </svg>
  );
}

/** 底稿卡卡头图标（asset.S1-4）。 */
export function GlyphCardDigao({ className = 'xs-glyph', size = 20 }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="4.5" y="3.5" width="11" height="13" rx="1.5" />
      <path d="M8 3.5 V2 H12 A1.5 1.5 0 0 1 13.5 3.5" />
      <path d="M7.5 8 H12.5" />
      <path d="M7.5 11 H12.5" />
      <path d="M7.5 14 H10.5" />
    </svg>
  );
}

/** 快捷入口「问事」格图标（asset.S1-5）。 */
export function GlyphQuickConsult({ className = 'xs-glyph', size = 24 }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.5 6 H19.5 V15 H12 L8.5 18.5 V15 H4.5 Z" />
      <path d="M12 9.3 c0 .2 0 .3-.06.5" />
      <path d="M9.8 9.2 A2.2 2.2 0 1 1 13 11.3 c-.6.5-.8.9-.8 1.5" />
      <path d="M12 14.3 v.01" />
    </svg>
  );
}

/** 快捷入口「工作区」格图标（asset.S1-5）。 */
export function GlyphQuickWorkspace({ className = 'xs-glyph', size = 24 }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 7.5 A1.5 1.5 0 0 1 5.5 6 H10 L12 8 H18.5 A1.5 1.5 0 0 1 20 9.5 V16.5 A1.5 1.5 0 0 1 18.5 18 H5.5 A1.5 1.5 0 0 1 4 16.5 Z" />
    </svg>
  );
}

/** 快捷入口「工作流」格图标（asset.S1-5）。 */
export function GlyphQuickWorkflow({ className = 'xs-glyph', size = 24 }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="5" cy="8" r="1.8" />
      <circle cx="19" cy="8" r="1.8" />
      <circle cx="12" cy="17" r="1.8" />
      <path d="M6.7 9 L10.6 15.6 M15.4 15.6 L17.3 9" />
    </svg>
  );
}

/** 通用插画 props（比例由 viewBox 承担，不写固定宽高）。 */
export interface IllusProps {
  /** 类名（`xs-` 前缀）。 */
  className?: string;
}

/** 命盘卡空态插画（asset.S1-6：「底座还没立起来」，卡内 1/3 高语义）。 */
export function IllusMingpanEmpty({ className = 'xs-empty__illus' }: IllusProps) {
  return (
    <svg className={className} viewBox="0 0 120 80" fill="none" aria-hidden="true" focusable="false">
      <circle cx="60" cy="29" r="21" stroke="currentColor" strokeWidth={1.5} />
      <circle cx="60" cy="29" r="12" stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" opacity={0.3} />
      <path d="M60 17v24M48 29h24" stroke="currentColor" strokeWidth={1} opacity={0.3} />
      <path d="M60 50v15" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      <path d="M60 50l7 5-7 5z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M52 65h16" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeDasharray="4 3" opacity={0.4} />
    </svg>
  );
}

/** 日课卡空态插画（asset.S1-7：「今天还没有生成日课」）。 */
export function IllusRikeEmpty({ className = 'xs-empty__illus' }: IllusProps) {
  return (
    <svg className={className} viewBox="0 0 120 80" fill="none" aria-hidden="true" focusable="false">
      <circle cx="86" cy="22" r="8" stroke="currentColor" strokeWidth={1.2} opacity={0.4} />
      <path d="M86 8v-3M86 36v3M72 22h-3M100 22h3" stroke="currentColor" strokeWidth={1} opacity={0.25} />
      <rect x="22" y="28" width="58" height="36" rx="4" stroke="currentColor" strokeWidth={1.5} />
      <path d="M30 40h42M30 47h42M30 54h28" stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" opacity={0.3} />
      <path d="M22 34h58" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/** 底稿卡空态插画（asset.S1-8：两种空因共用一张）。 */
export function IllusDigaoEmpty({ className = 'xs-empty__illus' }: IllusProps) {
  return (
    <svg className={className} viewBox="0 0 120 80" fill="none" aria-hidden="true" focusable="false">
      <rect x="30" y="16" width="60" height="48" rx="4" stroke="currentColor" strokeWidth={1.5} />
      <path d="M30 24h60" stroke="currentColor" strokeWidth={1} strokeLinecap="round" opacity={0.4} />
      <path d="M38 34h30M38 42h42M38 50h24" stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" opacity={0.3} />
      <path d="M44 58h8M60 58h8M76 58h8" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" opacity={0.4} />
    </svg>
  );
}

/** 四卡共用 error 态插画（asset.S1-9：断线 / 读不到）。 */
export function IllusCardsError({ className = 'xs-empty__illus' }: IllusProps) {
  return (
    <svg className={className} viewBox="0 0 120 80" fill="none" aria-hidden="true" focusable="false">
      <rect x="28" y="20" width="56" height="40" rx="5" stroke="currentColor" strokeWidth={1.5} />
      <path d="M28 32h56" stroke="currentColor" strokeWidth={1} opacity={0.4} />
      <path d="M36 44h16M36 51h24" stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" opacity={0.3} />
      <path d="M88 44l6 6M94 44l-6 6" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      <path d="M16 24l8 8M24 24l-8 8" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" opacity={0.35} />
    </svg>
  );
}
