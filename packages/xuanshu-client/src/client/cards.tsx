/**
 * 自我总览四卡（S1 §4 组件树的自研部分；S1 §9 硬约束的界面本体）。
 *
 * 组件与屏稿的对应：
 *   - `XsCardStateShell` → S1 §4「卡级空/加载/错误三态外壳」；皮肤 `assets/skins/skeleton-card.md`
 *   - `XsReadonlyBadge` / `XsPureDerivedBadge` → S1 §9 C1/C2；皮肤 `assets/skins/badge-readonly.md`
 *   - `XsDestinyCard` / `XsRikkeCard` / `XsDigaoCard` → S1 §3.1 ①②③
 *   - `XsQuickLinks` → S1 §3.1④ + §9 C6；皮肤 `assets/skins/quicklinks-cell.md`
 *   - `XsCardStateShell` 的空态说明行 → 皮肤 `assets/skins/why-empty-caption.md`
 *
 * 票 07 的现实（见 `.scratch/assembly-foundation/notes/07-implementation-contract.md`）：
 *   三张数据卡**恒渲染冷启动空态**（读本地文件的 RPC 面属票 08/13），
 *   ready / loading / error 是**结构**，由后续票喂数据；
 *   目标未装配的入口一律 fail-soft 置灰 + `title` 说明（不移除节点，S1 §6④）。
 */
import type { ReactNode } from 'react';

import type { BaziApi } from './bazi-api.js';
import type { BaziUiController } from './bazi-controller.js';
import type { DigaoApi } from './digao-api.js';
import type { DigaoUiController } from './digao-controller.js';
import type { AiReadiness, AiReadinessController } from './ai-model.js';
import { XsAiGate } from './ai-views.js';
import { notifyFailureText, notifyReasonCode } from './notify.js';
import type { HomePathsWatch } from './home-paths.js';
import { ACTION_COPY,
  BADGE_DERIVED,
  BADGE_READONLY,
  CARD_TITLE,
  DISABLED_REASON,
  EMPTY_COPY,
  ERROR_COPY,
  QUICKLINK,
  QUICKLINK_CONSULT_UNREADY,
  QUICKLINKS_BOUNDARY,
  momentOf,
} from './panel.js';
import type { CardName, CardState, PanelNavTarget } from './panel.js';
import {
  GlyphCardDigao,
  GlyphCardMingpan,
  GlyphCardRike,
  GlyphQuickConsult,
  GlyphQuickWorkspace,
  GlyphQuickWorkflow,
  IllusCardsError,
  IllusDigaoEmpty,
  IllusMingpanEmpty,
  IllusRikeEmpty,
} from './glyphs.js';
import type { MainPanelsWatch } from './watch.js';
import { useMainPanels } from './watch.js';
import type { RikkeAiNote, RikkeApi, RikkeNotify } from './rikke-api.js';
import type { RikkeUiController } from './rikke-controller.js';
import { rikkeAiView } from './rikke-model.js';
import type { WanshengApi, WanshengFacts } from './wansheng-api.js';
import type { WanshengUiController } from './wansheng-controller.js';

/* ───────────────────────── 共用：导航与可用性 ───────────────────────── */

/** 四卡共用的注入面（由 `index.tsx` 的 register `inject` 提供）。 */
export interface OverviewInjected {
  /** 面板导航（`conversation` → 回 DSH 原面板；其余 = main key）。 */
  navigate: (target: PanelNavTarget) => void;
  /** 已注册 main 面板键的订阅源（fail-soft 的唯一判据）。 */
  mainPanels: MainPanelsWatch;
  /** 冷启动向导入口（票 08 接线；未接线 → 置灰）。 */
  onStartOnboarding?: () => void;
  /** 命盘详情抽屉（票 08 接线；未接线 → 置灰）。 */
  onOpenDetail?: () => void;
  /** 日课就地生成（票 13 接线；未接线 → 置灰）。 */
  onGenerate?: () => void;
  /** 底稿刷新（票 13 接线；未接线 → 置灰）。 */
  onRefresh?: () => void;
  /** 2026-11-02：刷新正在进行（按钮文案与 role=status 都要能看见这件事）。 */
  refreshing?: boolean;
  /** 2026-11-02：上一次人点刷新的时刻（内容没变时，这是唯一能确认「真的跑了」的东西）。 */
  refreshedAt?: Date;
  /** 卡级重试（票 08/13 接线；未接线 → 置灰）。 */
  onRetry?: () => void;
  /**
   * 命盘数据面（票 08）：**面板级**注入，四卡本身不消费它 ——
   * 只有 `OverviewPanel` 用它取 `bazi.status` 决定命盘卡的四态。
   */
  bazi?: BaziApi;
  /** 命盘取数代次 / 重录预填（票 08）：出盘成功后概览据此重取快照（不重新出盘）。 */
  baziController?: BaziUiController;
  /**
   * 日课数据面与控制器（票 13）：同样是**面板级**注入，四卡不消费 ——
   * `OverviewPanel` 用 `rikke.status` 决定日课卡四态，`rikkeController.generate()` 是
   * 「人点 [立即生成]」的唯一落点（`onGenerate` 由概览自己造，不从注入面来）。
   */
  rikke?: RikkeApi;
  rikkeController?: RikkeUiController;
  /** 底稿数据面与控制器（票 13）：`digao.status` 决定底稿卡四态，`refresh()` 是「人点 [刷新]」的落点。 */
  digao?: DigaoApi;
  digaoController?: DigaoUiController;
  /** #25：晚省数据面与控制器（`wansheng.status` 决定晚省卡四态；**面板级**注入，卡本身不消费）。 */
  wansheng?: WanshengApi;
  wanshengController?: WanshengUiController;
  /**
   * #29「接上 AI」的只读状态控制器：问事入口的门禁读它。
   * 面板级注入（概览用它取一次、传给快捷入口卡），四卡里只有 `XsQuickLinks` 消费。
   * 名字带 `Status` 是为了不与 `XsRikkeCardProps.ai`（日课卡的 AI 三段提示）撞名。
   */
  aiStatus?: AiReadinessController;
  /**
   * 打开 DSH「设置 → 模型」。**给不出就不传**：界面改显示逐字路径，绝不渲染死按钮
   * （DSH rc.2 没有公开的打开设置 API，见 `ai-views.tsx` 文件头）。
   */
  onOpenAiSettings?: () => void;
  /**
   * R3（#35 / AC1）· 宿主回传的 home / dataDir 注入面：**装配期**读一次 `data.overview`
   * 写进来，概览页眉据此显示真实路径；缺席 = 没拿到 → 渲染层回中性占位。
   * 订阅式是为了让晚到的值也能驱动同一棵树重渲染（SSR 下用快照当 server snapshot）。
   */
  homePaths?: HomePathsWatch;
}

/** 订阅 main 面板键（卡片渲染期判定 fail-soft）。 */
function useAvailable(mainPanels: MainPanelsWatch): readonly string[] {
  return useMainPanels(mainPanels);
}

/** 目标面板是否已注册（`conversation` 也按注册事实判：由 ui-conversation 声明）。 */
function isAvailable(available: readonly string[], target: PanelNavTarget): boolean {
  return available.includes(target);
}

/* ───────────────────────── 共用：按钮 / 链接 / 单元格 ───────────────────────── */

interface ActionButtonProps {
  action: string;
  children: ReactNode;
  primary?: boolean;
  disabled?: boolean;
  reason?: string;
  onClick?: () => void;
}

/** 动作按钮（`data-xuanshu-action`；置灰时给 `disabled` + `title` 理由）。 */
function ActionButton({ action, children, primary, disabled, reason, onClick }: ActionButtonProps) {
  const className = primary ? 'xs-btn xs-btn--primary' : 'xs-btn';
  return (
    <button
      type="button"
      className={disabled ? `${className} xs-btn--disabled` : className}
      data-xuanshu-action={action}
      disabled={disabled === true ? true : undefined}
      title={disabled === true ? reason : undefined}
      onClick={disabled === true ? undefined : onClick}
    >
      {children}
    </button>
  );
}

interface NavLinkProps {
  target: PanelNavTarget;
  children: ReactNode;
  disabled: boolean;
  reason?: string;
  onClick: () => void;
}

/** 文字链（`data-xuanshu-nav`；跳面板类入口统一走它）。 */
function NavLink({ target, children, disabled, reason, onClick }: NavLinkProps) {
  return (
    <button
      type="button"
      className={disabled ? 'xs-link xs-link--disabled' : 'xs-link'}
      data-xuanshu-nav={target}
      disabled={disabled === true ? true : undefined}
      title={disabled === true ? reason : undefined}
      onClick={disabled === true ? undefined : onClick}
    >
      {children}
    </button>
  );
}

/* ───────────────────────── 卡壳与三态 ───────────────────────── */

interface XsCardShellProps {
  card: CardName;
  title: string;
  state: CardState;
  icon: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}

/** 卡壳：四卡共用同一张卡面（骨架/空态/错误/就绪都不换壳，S1 §4）。 */
export function XsCardShell({ card, title, state, icon, badge, children }: XsCardShellProps) {
  return (
    <section className="xs-card" data-xuanshu-card={card} data-xs-state={state}>
      <header className="xs-card__head">
        {icon}
        <h2 className="xs-card__title">{title}</h2>
        {badge}
      </header>
      {children}
    </section>
  );
}

/** 只读徽标（C1；文案逐字固定，非控件、不可关闭）。 */
export function XsReadonlyBadge() {
  return (
    <span className="xs-badge xs-badge--readonly" data-xuanshu-badge="readonly">
      {BADGE_READONLY}
    </span>
  );
}

/** 纯派生徽标（C2；文案逐字固定，非控件、不可关闭）。 */
export function XsPureDerivedBadge() {
  return (
    <span className="xs-badge xs-badge--derived" data-xuanshu-badge="derived">
      {BADGE_DERIVED}
    </span>
  );
}

/** 空态 / 错误态块（说明行三要素：为什么空 + 下一步 + 指向哪；皮肤 why-empty-caption）。 */
export function XsEmptyBlock({
  illus,
  why,
  sub,
  actions,
  variant = 'empty',
}: {
  illus: ReactNode;
  why: string;
  sub?: string;
  actions: ReactNode;
  variant?: 'empty' | 'error';
}) {
  return (
    <div className={variant === 'error' ? 'xs-card__error' : 'xs-card__empty'}>
      {illus}
      <p className="xs-empty__why">{why}</p>
      {sub === undefined ? null : <p className="xs-empty__sub">{sub}</p>}
      <div className="xs-card__actions">{actions}</div>
    </div>
  );
}

interface XsSkeletonProps {
  /** 正文占位条数（按卡定数：命盘 1 行 + 4 方块、日课 3 行、底稿 2 行 + 徽标位）。 */
  lines: number;
  /** 命盘卡的 4 个四柱方块占位。 */
  blocks?: number;
  /** 卡头右侧的徽标占位（命盘/底稿有）。 */
  badgePlaceholder?: boolean;
}

/** 卡级骨架（D2：不整页转圈；占位不带任何文字）。 */
export function XsSkeleton({ lines, blocks = 0, badgePlaceholder = false }: XsSkeletonProps) {
  const bars = Array.from({ length: lines }, (_, index) => (
    <div key={`line-${String(index)}`} className="xs-skeleton__bar xs-skeleton__shimmer" />
  ));
  return (
    <div className="xs-skeleton" data-xuanshu-skeleton="card">
      <div className="xs-skeleton__bar xs-skeleton__bar--head xs-skeleton__shimmer" />
      {badgePlaceholder ? (
        <div className="xs-skeleton__bar xs-skeleton__bar--badge xs-skeleton__shimmer" />
      ) : null}
      {blocks > 0 ? (
        <div className="xs-skeleton__blocks">
          {Array.from({ length: blocks }, (_, index) => (
            <div key={`block-${String(index)}`} className="xs-skeleton__block xs-skeleton__shimmer" />
          ))}
        </div>
      ) : null}
      {bars}
    </div>
  );
}

/* ───────────────────────── ① 命盘卡（只读） ───────────────────────── */

/** 命盘卡 ready 态的四柱与口径行（票 08 喂数据）。 */
export interface DestinySnapshot {
  /** 年/月/日/时柱干支（缺项用「—」，见 S2 四柱表口径）。 */
  pillars: { year: string; month: string; day: string; hour: string };
  /** 起盘口径行（只读展示，不可切换 timeAlg；S1 §7 复用来源）。 */
  basis: { trueSolar: string; clock: string };
}

export interface XsDestinyCardProps extends OverviewInjected {
  state?: CardState;
  snapshot?: DestinySnapshot;
}

const PILLAR_ORDER: { key: keyof DestinySnapshot['pillars']; label: string }[] = [
  { key: 'year', label: '年柱' },
  { key: 'month', label: '月柱' },
  { key: 'day', label: '日柱' },
  { key: 'hour', label: '时柱' },
];

/** 命盘卡：只读快照 + 唯一出口「看详情」；空态是冷启动主行动（S1 §3.1①、§9 C1）。 */
export function XsDestinyCard({
  state = 'empty',
  snapshot,
  mainPanels,
  onOpenDetail,
  onStartOnboarding,
  onRetry,
}: XsDestinyCardProps) {
  useAvailable(mainPanels);
  const onboardingDisabled = onStartOnboarding === undefined;
  const detailDisabled = onOpenDetail === undefined;
  const retryDisabled = onRetry === undefined;

  return (
    <XsCardShell
      card="mingpan"
      title={CARD_TITLE.mingpan}
      state={state}
      icon={<GlyphCardMingpan className="xs-card__icon" />}
      badge={<XsReadonlyBadge />}
    >
      {state === 'loading' ? <XsSkeleton lines={1} blocks={4} badgePlaceholder /> : null}
      {state === 'empty' ? (
        <XsEmptyBlock
          illus={<IllusMingpanEmpty />}
          why={EMPTY_COPY.mingpan.why}
          sub={EMPTY_COPY.mingpan.sub}
          actions={
            <ActionButton
              action="start-onboarding"
              primary
              disabled={onboardingDisabled}
              reason={DISABLED_REASON.onboarding}
              onClick={onStartOnboarding}
            >
              {ACTION_COPY.startOnboarding}
            </ActionButton>
          }
        />
      ) : null}
      {state === 'error' ? (
        <XsEmptyBlock
          variant="error"
          illus={<IllusCardsError />}
          why={ERROR_COPY.mingpan}
          actions={
            <ActionButton
              action="retry"
              disabled={retryDisabled}
              reason={DISABLED_REASON.retry}
              onClick={onRetry}
            >
              {ACTION_COPY.retry}
            </ActionButton>
          }
        />
      ) : null}
      {state === 'ready' ? (
        <div className="xs-card__body" data-xuanshu-ready="mingpan">
          <div className="xs-pillars">
            {PILLAR_ORDER.map(({ key, label }) => (
              <div key={key} className="xs-pillar">
                <span className="xs-pillar__name">{label}</span>
                <span className="xs-pillar__value">{snapshot?.pillars[key] ?? '—'}</span>
              </div>
            ))}
          </div>
          <p className="xs-basis">
            <span data-xuanshu-basis="true-solar">真太阳时 {snapshot?.basis.trueSolar ?? '—'}</span>
            <span data-xuanshu-basis="clock">钟表时 {snapshot?.basis.clock ?? '—'}</span>
          </p>
          <div className="xs-card__actions">
            <ActionButton
              action="open-detail"
              disabled={detailDisabled}
              reason={DISABLED_REASON.openDetail}
              onClick={onOpenDetail}
            >
              {ACTION_COPY.openDetail}
            </ActionButton>
          </div>
        </div>
      ) : null}
      {/* 命盘卡内**没有任何输入控件**（C1①）：本组件不渲染 input/select/switch/保存。 */}
    </XsCardShell>
  );
}

/* ───────────────────────── ② 日课卡 ───────────────────────── */

/** 日课 ready 态内容（票 13 喂数据）。 */
export interface RikkeContent {
  yi: string;
  ji: string;
  liuri: string;
}

export interface XsRikkeCardProps extends OverviewInjected {
  state?: CardState;
  /** 当日日期（YYYY-MM-DD）；缺省由面板注入本机日期。 */
  today: string;
  content?: RikkeContent;
  /** 失败理由（票 13：生成失败 / 底座未立时必须看得见，不许静默）。 */
  reason?: string;
  /** #24：AI 段三态（缺 = 旧产物，不渲染这一段）。 */
  ai?: RikkeAiNote;
  /** #24：未读条数（>0 才出徽标；缺 = 账本没读到，不出徽标而不是显示 0）。 */
  unread?: number;
  /** #24：最近一次触达（failed 才在卡内给 role=alert 行与可读原因）。 */
  notify?: RikkeNotify;
}

/** 未读徽标（#24：`delivered && !read` 的条数；非控件、不可关闭）。 */
export function XsUnreadBadge({ count }: { count: number }) {
  return (
    <span className="xs-badge xs-badge--unread" data-xuanshu-badge="unread">
      {`未读 ${count}`}
    </span>
  );
}

/** AI 段一行（三态文案的唯一来源是 `rikke-model.ts` 的 `rikkeAiView`）。 */
function RikkeAiLine({ ai }: { ai?: RikkeAiNote }) {
  const view = rikkeAiView(ai);
  if (view.kind === 'none') return null;
  return (
    <p className="xs-card__note" data-xuanshu-ai={view.kind}>
      {view.text}
    </p>
  );
}

/** 最近一次通知失败的原因行（#24：通知失败要在界面看得见，但**不影响**日课内容；#40：已知 token 说人话）。 */
function RikkeNotifyLine({ notify }: { notify?: RikkeNotify }) {
  if (notify?.status !== 'failed') return null;
  return (
    <p
      className="xs-card__note"
      role="alert"
      data-xuanshu-notify="failed"
      data-xuanshu-reason-code={notifyReasonCode(notify)}
    >
      {`通知没发出去：${notifyFailureText(notify)}`}
    </p>
  );
}

/** 宜 / 忌 / 流日三行（ready 与 error 两态共用：失败时已有内容照常可读）。 */
function RikkeLines({ content }: { content?: RikkeContent }) {
  return (
    <div className="xs-lines">
      <p className="xs-line">
        <span className="xs-line__label">宜</span>
        <span className="xs-line__value">{content?.yi ?? '—'}</span>
      </p>
      <p className="xs-line">
        <span className="xs-line__label">忌</span>
        <span className="xs-line__value">{content?.ji ?? '—'}</span>
      </p>
      <p className="xs-line">
        <span className="xs-line__label">流日</span>
        <span className="xs-line__value">{content?.liuri ?? '—'}</span>
      </p>
    </div>
  );
}

/** 日课卡：当日产物三行 + 「看完整日课 / 立即生成」（S1 §3.1②）。 */
export function XsRikkeCard({
  state = 'empty',
  today,
  content,
  reason,
  ai,
  unread,
  notify,
  navigate,
  mainPanels,
  onGenerate,
  onRetry,
}: XsRikkeCardProps) {
  const available = useAvailable(mainPanels);
  const schedulesReady = isAvailable(available, 'schedules');
  const rikkeReady = isAvailable(available, 'rikke');
  const generateDisabled = onGenerate === undefined;
  const retryDisabled = onRetry === undefined;

  return (
    <XsCardShell
      card="rike"
      title={`${CARD_TITLE.rike} · 今天 ${today}`}
      state={state}
      icon={<GlyphCardRike className="xs-card__icon" />}
      badge={unread !== undefined && unread > 0 ? <XsUnreadBadge count={unread} /> : undefined}
    >
      {state === 'loading' ? <XsSkeleton lines={3} /> : null}
      {state === 'empty' ? (
        <XsEmptyBlock
          illus={<IllusRikeEmpty />}
          why={EMPTY_COPY.rike.why}
          sub={EMPTY_COPY.rike.sub}
          actions={
            <>
              <ActionButton
                action="generate-rikke"
                disabled={generateDisabled}
                reason={DISABLED_REASON.generate}
                onClick={onGenerate}
              >
                {ACTION_COPY.generate}
              </ActionButton>
              <NavLink
                target="schedules"
                disabled={!schedulesReady}
                reason={DISABLED_REASON.retry}
                onClick={() => navigate('schedules')}
              >
                {ACTION_COPY.changeTime}
              </NavLink>
            </>
          }
        />
      ) : null}
      {state === 'error' ? (
        <>
          <XsEmptyBlock
            variant="error"
            illus={<IllusCardsError />}
            why={ERROR_COPY.rike}
            // 票 13：失败理由（宿主给的可读理由 / RPC 拒绝原因）逐字展示。
            sub={reason}
            actions={
              <ActionButton
                action="retry"
                disabled={retryDisabled}
                reason={DISABLED_REASON.retry}
                onClick={onRetry}
              >
                {ACTION_COPY.retry}
              </ActionButton>
            }
          />
          {/* 失败时若还有上一份内容，照常可读（S14 §6 error 行：保留上一份，不给空白）。 */}
          {content === undefined ? null : (
            <div className="xs-card__body" data-xuanshu-ready="rike">
              <RikkeLines content={content} />
            </div>
          )}
        </>
      ) : null}
      {state === 'ready' ? (
        <div className="xs-card__body" data-xuanshu-ready="rike">
          <RikkeLines content={content} />
          {/* #24：两段式 —— 骨架三行永远在，AI 段按三态追加（关闭 / 失败都有逐字文案）。 */}
          <RikkeAiLine ai={ai} />
          <RikkeNotifyLine notify={notify} />
          <div className="xs-card__actions">
            {/* [看完整日课 ->] 进票 13 的 `rikke` main 面板（S14 日课与定时任务）。 */}
            <NavLink
              target="rikke"
              disabled={!rikkeReady}
              reason={DISABLED_REASON.rikke}
              onClick={() => navigate('rikke')}
            >
              {ACTION_COPY.watchFull}
            </NavLink>
            <ActionButton
              action="generate-rikke"
              disabled={generateDisabled}
              reason={DISABLED_REASON.generate}
              onClick={onGenerate}
            >
              {/*
                2026-11-02 改：ready 态说明当天产物**已经有了**，按钮不该再叫「去生成」——
                截图实测：宜/忌/流日/AI 段全在，底下还挂着「去生成 ->」，用户会以为没生成成功。
                动作不变（还是送到面板，闸门在那一处），只说清是「再生成一次」。
              */}
              {ACTION_COPY.regenerate}
            </ActionButton>
          </div>
        </div>
      ) : null}
    </XsCardShell>
  );
}

/* ───────────────────────── ③ 底稿卡（纯派生） ───────────────────────── */

/** 底稿 ready 态头部（票 13 喂数据）。 */
export interface DigaoSummary {
  segments: number;
  sources: number;
  updatedAt?: string;
}

export interface XsDigaoCardProps extends OverviewInjected {
  state?: CardState;
  summary?: DigaoSummary;
  /** 底座是否已立：决定空态取 (a) 底座未立 还是 (b) 从未刷新（S1 §6 ③）。 */
  baseplateEstablished?: boolean;
  /** 失败理由（票 13：刷新失败 / 读不出来时必须看得见，不许静默）。 */
  reason?: string;
}

/** 底稿卡：纯派生标记 + 三源头跳转 + 「打开底稿 / 刷新」（S1 §3.1③、§9 C2）。 */
export function XsDigaoCard({
  state = 'empty',
  summary,
  baseplateEstablished = false,
  reason,
  navigate,
  mainPanels,
  onRefresh,
  refreshing = false,
  refreshedAt,
  onStartOnboarding,
  onRetry,
}: XsDigaoCardProps) {
  const available = useAvailable(mainPanels);
  const onboardingDisabled = onStartOnboarding === undefined;
  const refreshDisabled = onRefresh === undefined;
  const retryDisabled = onRetry === undefined;
  const copy = baseplateEstablished ? EMPTY_COPY.digaoNeverRefreshed : EMPTY_COPY.digaoUnready;

  return (
    <XsCardShell
      card="digao"
      title={CARD_TITLE.digao}
      state={state}
      icon={<GlyphCardDigao className="xs-card__icon" />}
      badge={<XsPureDerivedBadge />}
    >
      {state === 'loading' ? <XsSkeleton lines={2} badgePlaceholder /> : null}
      {state === 'empty' ? (
        <XsEmptyBlock
          illus={<IllusDigaoEmpty />}
          why={copy.why}
          sub={copy.sub}
          actions={
            baseplateEstablished ? (
              // 空因 (b)：底座已立、从未刷新 —— 冷启动期的 (a) 不提供 [刷新]（S4 文案表逐条说明）。
              <ActionButton
                action="refresh-digao"
                disabled={refreshDisabled}
                reason={DISABLED_REASON.refreshDigao}
                onClick={onRefresh}
              >
                立即刷新
              </ActionButton>
            ) : (
              // 空因 (a)：冷启动。这个按钮与命盘卡空态**同一个动作**（去填出生信息）——
              // 两者同时可见时不再各给一份主权重（判据 D-002：一屏至多一个主操作）。
              // 读序第一张卡（命盘）承担主行动，这里降为次要按钮：动作、文案、回调都不变，
              // 变的只有视觉权重，用户仍然能从这张卡直接进向导。
              <ActionButton
                action="start-onboarding"
                disabled={onboardingDisabled}
                reason={DISABLED_REASON.onboarding}
                onClick={onStartOnboarding}
              >
                {ACTION_COPY.startOnboarding}
              </ActionButton>
            )
          }
        />
      ) : null}
      {state === 'error' ? (
        <XsEmptyBlock
          variant="error"
          illus={<IllusCardsError />}
          why={ERROR_COPY.digao}
          // 票 13：刷新失败 / 读不出来的理由逐字展示（不静默）。
          sub={reason}
          actions={
            <>
              <ActionButton
                action="retry"
                disabled={retryDisabled}
                reason={DISABLED_REASON.retry}
                onClick={onRetry}
              >
                {ACTION_COPY.retry}
              </ActionButton>
              <NavLink
                target="digao"
                disabled={!isAvailable(available, 'digao')}
                reason={DISABLED_REASON.digao}
                onClick={() => navigate('digao')}
              >
                {ACTION_COPY.openDigao}
              </NavLink>
            </>
          }
        />
      ) : null}
      {state === 'ready' ? (
        <div className="xs-card__body" data-xuanshu-ready="digao">
          {/*
            2026-11-02 加：刷新这件事原来在屏上毫无痕迹 —— 实测后端 generatedAt
            确实变了（14:00:04 → 14:02:49），但卡片一个字不变、role=status 一个都没有。
            内容没变是正常的（同样三条来源），「有没有刷新过」必须另有东西说。
          */}
          {refreshing ? (
            <p className="xs-card__note" role="status" data-xuanshu-note="digao-refreshing">正在重算底稿…</p>
          ) : refreshedAt === undefined ? null : (
            <p className="xs-card__note" role="status" data-xuanshu-note="digao-refreshed">
              {'已刷新 · '}
              {refreshedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          )}
          <p className="xs-digao-summary">
            关于我：{summary?.segments ?? 0} 段 · 来源 {summary?.sources ?? 0} 路
          </p>
          <div className="xs-source-links">
            <span>{ACTION_COPY.adjustSource}</span>
            <NavLink
              target="pus"
              disabled={!isAvailable(available, 'pus')}
              reason={DISABLED_REASON.pus}
              onClick={() => navigate('pus')}
            >
              {ACTION_COPY.sourcePu}
            </NavLink>
            <NavLink
              target="conversation"
              disabled={!isAvailable(available, 'conversation')}
              reason="DSH 工作区面板不可用"
              onClick={() => navigate('conversation')}
            >
              {ACTION_COPY.sourceWorkspace}
            </NavLink>
            <NavLink
              target="workflow"
              disabled={!isAvailable(available, 'workflow')}
              reason={DISABLED_REASON.workflow}
              onClick={() => navigate('workflow')}
            >
              {ACTION_COPY.sourceWorkflow}
            </NavLink>
          </div>
          <div className="xs-card__actions">
            <NavLink
              target="digao"
              disabled={!isAvailable(available, 'digao')}
              reason={DISABLED_REASON.digao}
              onClick={() => navigate('digao')}
            >
              {ACTION_COPY.openDigao}
            </NavLink>
            <ActionButton
              action="refresh-digao"
              disabled={refreshDisabled || refreshing}
              reason={DISABLED_REASON.refreshDigao}
              onClick={onRefresh}
            >
              {refreshing ? '刷新中…' : ACTION_COPY.refresh}
            </ActionButton>
          </div>
        </div>
      ) : null}
    </XsCardShell>
  );
}

/* ───────────────────────── ④ 快捷入口（静态） ───────────────────────── */

export interface XsQuickLinksProps extends OverviewInjected {
  /** 底座是否已立（07 恒 false；票 08 起由取数决定问事格副标题）。 */
  baseplateReady?: boolean;
  /** #29：AI 三态状态面（`undefined` = 这次没拿到 → 按「未知」处理，不静默禁用）。 */
  aiReadiness?: AiReadiness;
  /** #29：正在检测（只影响门禁行文案，不改变已渲染的三态）。 */
  checking?: boolean;
  /** #29：人工重试（未接上 / 未知时才有意义）。 */
  onRetryAi?: () => void;
}

interface CellSpec {
  target: PanelNavTarget;
  icon: ReactNode;
  title: string;
  subtitle: string;
  disabled: boolean;
  reason?: string;
}

/** 快捷入口卡：三格并列 + 边界说明行；静态组件、无骨架、无 empty（S1 §6④）。 */
export function XsQuickLinks({
  baseplateReady = false,
  navigate,
  mainPanels,
  aiReadiness,
  checking = false,
  onRetryAi,
  onOpenAiSettings,
}: XsQuickLinksProps) {
  const available = useAvailable(mainPanels);
  // #29：问事入口的门禁。`undefined` = 这次没拿到状态 → 未知（**不禁用**，但下面明说未知）。
  const aiState = aiReadiness === undefined
    ? (checking ? 'checking' : 'unknown')
    : aiReadiness.configured === true
      ? 'configured'
      : aiReadiness.configured === 'unknown'
        ? 'unknown'
        : 'missing';
  const consultAvailable = isAvailable(available, 'consult');
  const consultDisabled = !consultAvailable || aiState === 'missing';

  const cells: CellSpec[] = [
    {
      target: 'consult',
      icon: <GlyphQuickConsult className="xs-cell__icon" />,
      title: QUICKLINK.consult.title,
      // 底座未立时问事格副标题换提示句，但格**仍可用**（S4 §3④）。
      //
      // 2026-11-01 补：`disabled` 还有第二个来源（AI 没接上）。两个条件正交，
      // 同时成立时副标题说「也能空手先问一句」而按钮是灰的 —— 用户读到的是假话，
      // 而且置灰理由只在 `title`（hover 才有）。所以 AI 没接上时副标题先说这件事。
      subtitle:
        aiState === 'missing'
          ? 'AI 还没接上 · 先看下面那段提示'
          : baseplateReady
            ? QUICKLINK.consult.subtitle
            : QUICKLINK_CONSULT_UNREADY,
      disabled: consultDisabled,
      // 两条理由分开写：面板没装配 ≠ AI 没接上（修复去处不同）。
      reason: consultAvailable ? DISABLED_REASON.consultAi : DISABLED_REASON.consult,
    },
    {
      target: 'conversation',
      icon: <GlyphQuickWorkspace className="xs-cell__icon" />,
      title: QUICKLINK.conversation.title,
      subtitle: QUICKLINK.conversation.subtitle,
      disabled: !isAvailable(available, 'conversation'),
      reason: 'DSH 工作区面板不可用',
    },
    {
      target: 'workflow',
      icon: <GlyphQuickWorkflow className="xs-cell__icon" />,
      title: QUICKLINK.workflow.title,
      subtitle: QUICKLINK.workflow.subtitle,
      disabled: !isAvailable(available, 'workflow'),
      reason: DISABLED_REASON.workflow,
    },
  ];

  return (
    <XsCardShell card="quicklinks" title={CARD_TITLE.quicklinks} state="ready" icon={null}>
      <div className="xs-quicklinks" data-xuanshu-quicklinks="3">
        {cells.map((cell) => (
          <button
            key={cell.target}
            type="button"
            className={cell.disabled ? 'xs-cell xs-cell--disabled' : 'xs-cell'}
            data-xuanshu-nav={cell.target}
            disabled={cell.disabled ? true : undefined}
            title={cell.disabled ? cell.reason : undefined}
            onClick={cell.disabled ? undefined : () => navigate(cell.target)}
          >
            {cell.icon}
            <span className="xs-cell__title">{cell.title}</span>
            <span className="xs-cell__subtitle">{cell.subtitle}</span>
          </button>
        ))}
      </div>
      {/* #29：门禁行（已接上时组件自己返回 null）。禁用理由必须**看得见**，不能只在 title 里。 */}
      <XsAiGate
        {...(aiReadiness === undefined ? {} : { readiness: aiReadiness })}
        checking={checking}
        {...(onRetryAi === undefined ? {} : { onRetry: onRetryAi })}
        {...(onOpenAiSettings === undefined ? {} : { onOpenSettings: onOpenAiSettings })}
      />
      <p className="xs-quicklinks__note" data-xuanshu-note="boundary">
        {QUICKLINKS_BOUNDARY}
      </p>
    </XsCardShell>
  );
}

/* ───────────────────────── ⑤ 晚省卡（#25） ───────────────────────── */

/**
 * 「补」徽标（#25 契约 §4）：补生成的那一份用 `data-xuanshu-badge="missed"` 标出来，
 * 让用户一眼看出「这是过去的，不是今天的」。非控件、不可关闭。
 */
export function XsMissedBadge() {
  return (
    <span className="xs-badge xs-badge--missed" data-xuanshu-badge="missed">
      补
    </span>
  );
}

export interface XsWanshengCardProps extends OverviewInjected {
  state?: CardState;
  /** 当日日期（YYYY-MM-DD）；缺省由面板注入本机日期。 */
  today: string;
  /** 当天事实（拿不到的键整键不出现 → 卡面写「未知」，不写 0）。 */
  facts?: WanshengFacts;
  /** 这一份是补生成的（卡头出「补」徽标）。 */
  missed?: boolean;
  /** 未读条数（>0 才出徽标；缺 = 账本没读到）。 */
  unread?: number;
  /** 最近一次触达（failed 才在卡内给 role=alert 行）。 */
  notify?: RikkeNotify;
  /** 失败理由（人点生成失败 / 读不出来）。 */
  reason?: string;
}

/** 「今天几场问事」这一行（事实缺失 → 未知，不写 0）。 */
function WanshengConsultLine({ facts }: { facts?: WanshengFacts }) {
  const sessions = facts?.consultSessions;
  return (
    <p className="xs-line" data-xuanshu-fact="consult">
      <span className="xs-line__label">问事</span>
      <span className="xs-line__value">
        {sessions === undefined ? '今天几场问事：未知（这边暂时读不到）' : `今天 ${sessions.count} 场问事`}
      </span>
    </p>
  );
}

/** 工作区与工作流各自的活动事实（任一路缺失都写未知；空态两路同一句式，复核 A3）。 */
function WanshengActivityLines({ facts }: { facts?: WanshengFacts }) {
  const groups = [
    { key: 'workspaces', label: '项目', items: facts?.activeWorkspaces },
    { key: 'workflows', label: '工作流', items: facts?.activeWorkflows },
  ];
  return (
    <>{groups.map(({ key, label, items }) => (
      <p key={key} className="xs-line" data-xuanshu-fact={key}>
        <span className="xs-line__label">{label}</span>
        <span className="xs-line__value">
          {items === undefined ? `哪些${label}有活动：未知（这边暂时读不到）`
            : items.length === 0 ? `今天没有${label}活动`
              : `今天 ${items.length} 个${label}有活动`}
        </span>
      </p>
    ))}</>
  );
}

/** 「底稿 / 日课何时动过」这一行（缺项整行不编）。 */
function WanshengArtifactLines({ facts }: { facts?: WanshengFacts }) {
  const lines: ReactNode[] = [];
  if (facts?.rikke?.generatedAt !== undefined) {
    lines.push(
      <p key="rikke" className="xs-line" data-xuanshu-fact="rikke">
        <span className="xs-line__label">日课</span>
        <span className="xs-line__value">{`${momentOf(facts.rikke.generatedAt)} 生成`}</span>
      </p>,
    );
  }
  if (facts?.digao?.generatedAt !== undefined) {
    lines.push(
      <p key="digao" className="xs-line" data-xuanshu-fact="digao">
        <span className="xs-line__label">底稿</span>
        <span className="xs-line__value">{`${momentOf(facts.digao.generatedAt)} 刷新过`}</span>
      </p>,
    );
  }
  if (facts?.shiji?.updatedAt !== undefined) {
    lines.push(
      <p key="shiji" className="xs-line" data-xuanshu-fact="shiji">
        <span className="xs-line__label">事记</span>
        <span className="xs-line__value">{`${momentOf(facts.shiji.updatedAt)} 有更新`}</span>
      </p>,
    );
  }
  return <>{lines}</>;
}

/**
 * 晚省卡（首页第 5 张）：当天事实三行 + 「去问事 / 看完整晚省 / 立即生成」。
 *
 * 「点开进问事」是这张卡的**主行动**（spec 002 用户故事 15）：`[去问事 ->]` 走
 * `navigate('consult')`；`[看完整晚省 ->]` 才进晚省面板。补生成的那一份在卡头标「补」。
 */
export function XsWanshengCard({
  state = 'empty',
  today,
  facts,
  missed = false,
  unread,
  notify,
  reason,
  navigate,
  mainPanels,
  onGenerate,
  onRetry,
}: XsWanshengCardProps) {
  const available = useAvailable(mainPanels);
  const consultReady = isAvailable(available, 'consult');
  const wanshengReady = isAvailable(available, 'wansheng');
  const schedulesReady = isAvailable(available, 'schedules');
  const generateDisabled = onGenerate === undefined;
  const retryDisabled = onRetry === undefined;
  const badge = missed
    ? <XsMissedBadge />
    : unread !== undefined && unread > 0
      ? <XsUnreadBadge count={unread} />
      : undefined;

  return (
    <XsCardShell
      card="wansheng"
      title={`${CARD_TITLE.wansheng} · 今天 ${today}`}
      state={state}
      icon={<GlyphCardRike className="xs-card__icon" />}
      badge={badge}
    >
      {state === 'loading' ? <XsSkeleton lines={3} /> : null}
      {state === 'empty' ? (
        <XsEmptyBlock
          illus={<IllusRikeEmpty />}
          why={EMPTY_COPY.wansheng.why}
          sub={EMPTY_COPY.wansheng.sub}
          actions={
            <>
              <ActionButton
                action="generate-wansheng"
                disabled={generateDisabled}
                reason={DISABLED_REASON.generateWansheng}
                onClick={onGenerate}
              >
                {ACTION_COPY.generateWansheng}
              </ActionButton>
              <NavLink
                target="schedules"
                disabled={!schedulesReady}
                reason={DISABLED_REASON.retry}
                onClick={() => navigate('schedules')}
              >
                {ACTION_COPY.changeTime}
              </NavLink>
            </>
          }
        />
      ) : null}
      {state === 'error' ? (
        <XsEmptyBlock
          variant="error"
          illus={<IllusCardsError />}
          why={ERROR_COPY.wansheng}
          sub={reason}
          actions={
            <ActionButton
              action="retry"
              disabled={retryDisabled}
              reason={DISABLED_REASON.retry}
              onClick={onRetry}
            >
              {ACTION_COPY.retry}
            </ActionButton>
          }
        />
      ) : null}
      {state === 'ready' ? (
        <div className="xs-card__body" data-xuanshu-ready="wansheng">
          <div className="xs-lines">
            <WanshengConsultLine facts={facts} />
            <WanshengActivityLines facts={facts} />
            <WanshengArtifactLines facts={facts} />
          </div>
          <RikkeNotifyLine notify={notify} />
          <div className="xs-card__actions">
            <NavLink
              target="consult"
              disabled={!consultReady}
              reason={DISABLED_REASON.consult}
              onClick={() => navigate('consult')}
            >
              {ACTION_COPY.goConsult}
            </NavLink>
            <NavLink
              target="wansheng"
              disabled={!wanshengReady}
              reason={DISABLED_REASON.wansheng}
              onClick={() => navigate('wansheng')}
            >
              {ACTION_COPY.watchWansheng}
            </NavLink>
            <ActionButton
              action="generate-wansheng"
              disabled={generateDisabled}
              reason={DISABLED_REASON.generateWansheng}
              onClick={onGenerate}
            >
              {/* 2026-11-02：同日课卡 —— 当天产物已经在屏上时，按钮说「重新生成」。 */}
              {ACTION_COPY.regenerate}
            </ActionButton>
          </div>
        </div>
      ) : null}
    </XsCardShell>
  );
}
