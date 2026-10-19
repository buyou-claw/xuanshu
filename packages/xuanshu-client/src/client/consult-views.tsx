/**
 * 票 10 · 问事门厅与历史回看的**受控视图**（S6 §2；S7 §2）。
 *
 * 与票 08 的 `onboarding-steps.tsx` 同一纪律：状态与副作用在 `consult.tsx`（状态机）里，
 * 口径与文案在这里；组件全部受控（props 进、回调出），因此能用 `renderToStaticMarkup`
 * 逐条断言「这一刻屏幕上写了什么」（`tests/assembly/consult-views.test.mjs`）。
 *
 * 三条一眼要看见的边界：
 *   - **门厅不是会话本体**（F1/D5）：不画消息流、不画工具轨迹、**不发起工具调用** ——
 *     审批卡只在 DSH 原生 `conversation` 面板可见，所以写操作不从本面板发起；
 *   - **底座 / 底稿不可关**（C5）：勾选框 `disabled` + 理由文案，**节点不removed**（契约 §3）；
 *   - **历史只读**（S7 §6）：阅读器零编辑控件，唯一动作为「切回会话」。
 */
import { useState } from 'react';

import type { ConsultDrafts, ConsultMessage, ConsultSummary, MountRef, OptionalSource, RequiredSource } from './consult-api.js';
import {
  contextSummary,
  draftBadgeLabel,
  draftRoundLabel,
  filterHistory,
  formatHistoryMeta,
  groupHistory,
  groupOptional,
  historyEmptyCopy,
  reviewTimeline,
  roleLabel,
  shortConsultId,
} from './consult-model.js';
import type { DraftRoundState, HistoryRange } from './consult-model.js';
import { homePath, withTrailingSeparator } from './home-paths.js';

/**
 * 锁定行说明卡里的因果（点行才展开；S6 §3 表 `:102` 逐字口径）。
 *
 * 「默认在场 · 不可关」不是「暂时禁用」，而是**根本不该有开关** ——
 * 所以说明卡里给的是「要改就改源头」，没有任何取消途径。
 */
function lockedExplain(source: RequiredSource): string {
  return source.kind === 'digao'
    ? '底稿与八字同级、默认必加载的基础谱；它是纯派生的，要改就改源头（谱 / 工作区 / 工作流）。'
    : '底座始终在场、不可关：它是每一场问事的前提。';
}

/** ① 勾选谱区：恒定在场项（锁定行）+ 两组可选谱（S6 §2.1① / §9 C5）。 */
export interface XsConsultPickerProps {
  required: readonly RequiredSource[];
  optional: readonly OptionalSource[];
  selected: readonly string[];
  onToggle: (slug: string) => void;
  onManagePu: () => void;
  /** 底座说明卡里的去路（改出生信息走命盘详情的「重新录制」）。 */
  onOpenDetail?: () => void;
}

export function XsConsultPicker({ required, optional, selected, onToggle, onManagePu, onOpenDetail }: XsConsultPickerProps) {
  const groups = groupOptional(optional);
  /** 当前展开的说明卡（`undefined` = 都收起；锁定行不给任何取消途径）。 */
  const [explaining, setExplaining] = useState<string | undefined>(undefined);
  return (
    <section className="xs-consult__block" data-xuanshu-block="pu-picker">
      <h3>① 本次要用的谱（勾选）</h3>
      {/* 三重区分之一：分组头（S6 §2.1① 的「── 默认在场 · 不可关 ──」）。 */}
      <h4 className="xs-consult__group-head" data-xuanshu-group-head="locked">── 默认在场 · 不可关 ──</h4>
      <ul className="xs-consult__locked" data-xuanshu-locked-list={String(required.length)}>
        {required.map((source) => (
          <li className="xs-consult__row xs-consult__row--locked" key={source.kind} data-xuanshu-locked={source.kind}>
            {/*
              S6 §9 C5（`S6-问事面板.md:192`，另见 `:48`/`:102`/`:110`/`:223` 四处一致）：
              锁定行**无 checkbox** —— 它不是「被禁用的复选框」，它是根本不该有复选框；
              点击只弹说明卡，不给任何取消途径。票 02 的验收把 C5 列为逐屏核过的硬约束。
            */}
            <button
              type="button"
              className="xs-consult__locked-hit"
              data-xuanshu-action="locked-why"
              onClick={() => { setExplaining(explaining === source.kind ? undefined : source.kind); }}
            >
              <span className="xs-consult__lock" aria-hidden="true">🔒</span>
              <span className="xs-consult__row-name">{source.name}</span>
              <span aria-hidden="true">·</span>
              <span className="xs-consult__badge" data-xuanshu-badge="locked">默认在场 · 不可关</span>
              {source.kind === 'digao' ? (
                <span className="xs-consult__badge" data-xuanshu-badge="derived">纯派生 · 不可手改</span>
              ) : null}
            </button>
            <div
              className="xs-consult__locked-card"
              data-xuanshu-locked-card={source.kind}
              hidden={explaining !== source.kind}
            >
              <p>{lockedExplain(source)}</p>
              {source.present ? null : (
                <p className="xs-consult__note" data-xuanshu-note={`locked-absent-${source.kind}`}>
                  {source.reason ?? '这一项现在不在场'}
                </p>
              )}
              <div className="xs-consult__actions">
                {source.kind === 'digao' ? (
                  <>
                    <button type="button" data-xuanshu-action="locked-goto-pu" onClick={onManagePu}>
                      {'去谱管理 ▸'}
                    </button>
                    <span className="xs-consult__note">
                      三个源头：谱（在谱管理里改）/ 工作区 / 工作流；底稿本身在底稿面板看。
                    </span>
                  </>
                ) : (
                  <>
                    <button type="button" data-xuanshu-action="locked-goto-mingpan" onClick={onOpenDetail}>
                      {'去命盘详情 ▸'}
                    </button>
                    <span className="xs-consult__note">要改出生信息：走命盘详情里的「重新录制出生信息」。</span>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {groups.map((group) => (
        <div className="xs-consult__group" key={group.level} data-xuanshu-group={group.level}>
          <h4 className="xs-consult__group-head">
            {group.level === 'base' ? '── 基础输入级 base · 默认勾选' : '── 可选输入级 optional'}
          </h4>
          {group.items.map((source) => (
            <label className="xs-consult__row" key={source.slug} data-xuanshu-pu={source.slug}>
              <input
                type="checkbox"
                data-xuanshu-field={`pu-${source.slug}`}
                checked={selected.includes(source.slug)}
                onChange={() => { onToggle(source.slug); }}
              />
              <span className="xs-consult__row-name">{source.name}</span>
              <small className="xs-consult__note">{source.summary}</small>
            </label>
          ))}
        </div>
      ))}
      {optional.length === 0 ? (
        <p className="xs-consult__note" data-xuanshu-note="no-optional-pu">
          {historyEmptyCopy.noneOptionalPu}
        </p>
      ) : null}
      <div className="xs-consult__actions">
        <button type="button" data-xuanshu-action="manage-pu" onClick={onManagePu}>
          {'管理谱 ▸ S5'}
        </button>
      </div>
    </section>
  );
}

/** ② 临时挂载展示位（票 12 才接账本；这里只留位置与边界句，C6③）。 */
export function XsConsultMountPlaceholder({ mounts }: { mounts: readonly MountRef[] }) {
  return (
    <section className="xs-consult__block" data-xuanshu-block="mounts">
      <h3>③ 临时挂载（工作区 / 工作流）</h3>
      <p className="xs-consult__note" data-xuanshu-note="mount-boundary">
        工作区 / 工作流不是谱：它们是**挂载**，谱是**勾选**。
      </p>
      <div className="xs-consult__actions">
        <button
          type="button"
          data-xuanshu-action="open-mounts"
          disabled
          title="临时挂载账本还没装配（属票 12 · 临时挂载账本）"
        >
          {'＋ 临时挂载'}
        </button>
        <span className="xs-consult__note" data-xuanshu-note="mount-placeholder">
          属票 12 · 临时挂载账本还没接上；本票只留展示位（已挂 {mounts.length} 项）。
        </span>
      </div>
    </section>
  );
}

/** ③ 提问区：问题 + 摘要行 + 主按钮 + 无源引导 + 错误条（S6 §2.1②、§5 步骤 5/5a、§6 error①）。 */
export interface XsConsultAskProps {
  question: string;
  selected: readonly string[];
  mounts: readonly MountRef[];
  busy: boolean;
  /** 「本次上下文将含」摘要（由 `contextSummary` 算出，组件不重算）。 */
  summary: string;
  error?: string;
  /** 无源拦截引导是否展开（判定在 `nudgeNeeded`，由状态机给）。 */
  nudge?: boolean;
  /**
   * 引导里那条「临时挂载一个工作区 / 工作流」现在走不走得通。
   *
   * 挂载要挂在**会话**上（`mounts-views` 的既有规则），而门厅此刻还没建会话 ——
   * 所以第一次问事时它是死路，不该出现在引导里（2026-10-18 真机反馈：
   * 「第一次啥都没有如何挂载」）。缺省 `false`：只给走得通的那条。
   */
  mountable?: boolean;
  onQuestion: (value: string) => void;
  onStart: () => void;
  onPlainAsk?: () => void;
  onGotoHistory?: () => void;
  onClearNudge?: () => void;
}

export function XsConsultAsk({
  question,
  selected,
  mounts,
  busy,
  summary,
  error,
  nudge = false,
  mountable = false,
  onQuestion,
  onStart,
  onPlainAsk,
  onGotoHistory,
  onClearNudge,
}: XsConsultAskProps) {
  return (
    <section className="xs-consult__block" data-xuanshu-block="ask">
      <h3>② 说事（可先空手开一个会话）</h3>
      <p className="xs-consult__summary" data-xuanshu-note="context-summary">{`本次上下文将含：${summary}`}</p>
      <p className="xs-consult__note" data-xuanshu-note="ask-selection">
        {`已勾 ${String(selected.length)} 个可选谱 · 已挂 ${String(mounts.length)} 项（底座与底稿恒在场，不在这里计）`}
      </p>
      <label className="xs-consult__field">
        <span>这一次想问什么</span>
        <textarea
          data-xuanshu-field="consult-question"
          placeholder="说这件事…（进会话后仍在 DSH 原生输入区里继续）"
          value={question}
          onChange={(event) => { onQuestion(event.target.value); }}
        />
      </label>
      <div className="xs-consult__actions">
        <button
          type="button"
          className="xs-btn xs-btn--primary"
          data-xuanshu-action="start-consult"
          disabled={busy}
          onClick={onStart}
        >
          {busy ? '开问事中…' : '＋ 开一次问事'}
        </button>
      </div>
      {nudge ? (
        <div className="xs-consult__nudge" data-xuanshu-nudge="no-source" role="alert">
          {/* S6 §5 步骤 5a：标题 + 走得通的去路 + 不回退的显式出口；**不发送**。
              挂载那条只在真有会话可挂时才列（门厅此刻还没有会话 = 死路，不写给人看）。 */}
          <p className="xs-consult__nudge-title">{historyEmptyCopy.nudgeTitle}</p>
          <ol className="xs-consult__paths">
            <li>{historyEmptyCopy.nudgePathPu}</li>
            {mountable ? <li>{historyEmptyCopy.nudgePathMount}</li> : null}
          </ol>
          <div className="xs-consult__actions">
            <button type="button" data-xuanshu-action="clear-nudge" onClick={onClearNudge}>
              回到勾选区
            </button>
            <button type="button" data-xuanshu-action="plain-ask" onClick={onPlainAsk}>
              {historyEmptyCopy.nudgePlainExit}
            </button>
            <button type="button" data-xuanshu-action="goto-history" onClick={onGotoHistory}>
              {'改从历史里接着问 ▸'}
            </button>
          </div>
        </div>
      ) : null}
      {error === undefined ? null : (
        <div className="xs-consult__error" data-xuanshu-error="create" role="alert">
          <p>{error}</p>
          <div className="xs-consult__actions">
            <button type="button" data-xuanshu-action="retry-create" onClick={onStart}>重试开会话</button>
            <button type="button" data-xuanshu-action="goto-history" onClick={onGotoHistory}>
              {'改从历史里接着问 ▸'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** ④ 最近一次会话摘要卡（S6 §2.1④ / §2.2④：门厅不画消息流）。 */
export interface XsConsultRecentCardProps {
  session: ConsultSummary;
  onContinue: () => void;
  onHistory: () => void;
}

export function XsConsultRecentCard({ session, onContinue, onHistory }: XsConsultRecentCardProps) {
  return (
    <section className="xs-consult__block" data-xuanshu-block="recent">
      <h3>④ 最近一次会话</h3>
      <p className="xs-consult__recent-title">
        <span className="xs-consult__shortid" data-xuanshu-short-id={shortConsultId(session.sessionId)}>
          {shortConsultId(session.sessionId)}
        </span>
        <span>{session.title}</span>
        <small className="xs-consult__note">{formatHistoryMeta(session)}</small>
      </p>
      <div className="xs-consult__actions">
        <button type="button" data-xuanshu-action="continue-consult" onClick={onContinue}>
          {'继续这次问事 ▸'}
        </button>
        <button type="button" data-xuanshu-action="toggle-history" onClick={onHistory}>
          {'历史回看 ▸'}
        </button>
      </div>
      <p className="xs-consult__note" data-xuanshu-note="lobby-boundary">
        ⓘ 本面板是「书房门厅」：进会话后切到 DSH 会话面板，工具轨迹与审批卡在那里。
      </p>
    </section>
  );
}

/** ⑤ 历史列表（S7 §2.1 / §2.3 / §6 error①②③）。 */
export interface XsConsultHistoryListProps {
  items: readonly ConsultSummary[];
  loading: boolean;
  error?: string;
  query: string;
  range: HistoryRange;
  now: Date;
  /**
   * 宿主回传的 home（`data.overview.home`）：会话落在 `<home>/sessions/`。
   * 缺席时错误行显示中性占位「玄枢 home/sessions/」（不猜、不写死两档中的任何一档）。
   */
  home?: string;
  onQuery: (value: string) => void;
  onRange: (range: HistoryRange) => void;
  onOpen: (sessionId: string) => void;
  onBack: () => void;
  onStart: () => void;
  onManagePu: () => void;
  onRetry: () => void;
}

export function XsConsultHistoryList({
  items,
  loading,
  error,
  query,
  range,
  now,
  home,
  onQuery,
  onRange,
  onOpen,
  onBack,
  onStart,
  onManagePu,
  onRetry,
}: XsConsultHistoryListProps) {
  const filtered = filterHistory(items, query, range, now);
  const groups = groupHistory(filtered, now);
  const neverAsked = items.length === 0;
  const noMatch = !neverAsked && filtered.length === 0;
  return (
    <section className="xs-consult__history" data-xuanshu-view="history-list">
      <div className="xs-consult__toolbar">
        <button type="button" data-xuanshu-action="back-lobby" onClick={onBack}>
          {'← 回到当前会话'}
        </button>
        <input
          type="search"
          data-xuanshu-field="history-search"
          placeholder="搜索 会话标题 / 首句"
          value={query}
          onChange={(event) => { onQuery(event.target.value); }}
        />
        <select
          data-xuanshu-field="history-range"
          value={range}
          onChange={(event) => { onRange(event.target.value as HistoryRange); }}
        >
          <option value="all">全部</option>
          <option value="today">今天</option>
          <option value="earlier">更早</option>
        </select>
        {/* 导出与删除：契约没冻结这两个 RPC（§2 只有六个方法）——置灰留位，不做假按钮。 */}
        <button
          type="button"
          data-xuanshu-action="export-selected"
          disabled
          title="契约未冻结导出 RPC（属后续票）"
        >
          导出选中
        </button>
        <button type="button" data-xuanshu-action="delete-selected" disabled title="契约未冻结删除 RPC（属后续票）">
          删除
        </button>
      </div>
      <p className="xs-consult__note" data-xuanshu-note="contract-scope">
        契约未冻结导出与删除的 RPC（§2 只有六个方法）：这两个动作先置灰，不做假按钮。
      </p>

      {loading ? (
        <p className="xs-consult__note" data-xuanshu-state="loading">正在读本地会话清单…</p>
      ) : null}

      {error === undefined ? null : (
        <div className="xs-consult__error" data-xuanshu-error="list" role="alert">
          <p>{error}</p>
          <p className="xs-consult__note">{`数据在本地：${withTrailingSeparator(homePath(home, 'sessions'))}（只读展示）`}</p>
          <div className="xs-consult__actions">
            <button type="button" data-xuanshu-action="retry-list" onClick={onRetry}>重试</button>
          </div>
        </div>
      )}

      {!loading && error === undefined && neverAsked ? (
        <div className="xs-consult__empty" data-xuanshu-state="empty">
          <p className="xs-consult__empty-why">{historyEmptyCopy.noRecords}</p>
          <p className="xs-consult__note">{historyEmptyCopy.noRecordsSub}</p>
          <div className="xs-consult__actions">
            <button type="button" className="xs-btn xs-btn--primary" data-xuanshu-action="start-consult" onClick={onStart}>
              {'＋ 开一次问事 ▸ S6'}
            </button>
            <button type="button" data-xuanshu-action="manage-pu" onClick={onManagePu}>
              {'管理谱 ▸ S5'}
            </button>
          </div>
        </div>
      ) : null}

      {!loading && error === undefined && noMatch ? (
        <div className="xs-consult__empty" data-xuanshu-state="no-match">
          <p className="xs-consult__empty-why">{`没有匹配「${query}」的记录`}</p>
          <div className="xs-consult__actions">
            <button type="button" data-xuanshu-action="clear-filter" onClick={() => { onQuery(''); }}>
              清空筛选
            </button>
            <button
              type="button"
              data-xuanshu-action="reset-filter"
              onClick={() => { onQuery(''); onRange('all'); }}
            >
              回到全部
            </button>
            <button type="button" data-xuanshu-action="start-consult" onClick={onStart}>
              {'＋ 开一次问事 ▸ S6'}
            </button>
          </div>
        </div>
      ) : null}

      {groups.map((group) => (
        <div className="xs-consult__group" key={group.key} data-xuanshu-history-group={group.key}>
          <h4 className="xs-consult__group-head">{group.label}</h4>
          <ul className="xs-consult__rows">
            {group.items.map((item) => (
              <li key={item.sessionId}>
                <button
                  type="button"
                  className="xs-consult__row-hit"
                  data-xuanshu-row={item.sessionId}
                  onClick={() => { onOpen(item.sessionId); }}
                >
                  <span className="xs-consult__shortid">{shortConsultId(item.sessionId)}</span>
                  <span className="xs-consult__row-title">{item.title}</span>
                  <small className="xs-consult__note">{formatHistoryMeta(item)}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <p className="xs-consult__note" data-xuanshu-note="history-storage">{historyEmptyCopy.storageNote}</p>
      <p className="xs-consult__note" data-xuanshu-note="history-search-boundary">{historyEmptyCopy.searchBoundary}</p>
    </section>
  );
}

/** ⑥ 历史阅读器（S7 §2.2 / §6 只读态；票 31 的按轮分组）。 */
export interface XsConsultHistoryReaderProps {
  session: ConsultSummary;
  messages: readonly ConsultMessage[];
  /**
   * 合参轮次表（`consult.read` 的加性字段；老宿主 / 没有合参记录时缺席）。
   * 缺席时阅读器与票 10 逐字相同 —— 不显示任何轮次分组。
   */
  drafts?: ConsultDrafts;
  loading?: boolean;
  error?: string;
  onBack: () => void;
  onContinue: () => void;
  onRetry: () => void;
}

/** 一条消息行（普通消息与采用稿共用；采用稿多一枚处境徽标）。 */
function XsConsultMessageRow({ message, draft }: { message: ConsultMessage; draft?: DraftRoundState }) {
  return (
    <article
      className={`xs-consult__message xs-consult__message--${message.role}`}
      data-xuanshu-message={message.role}
      {...(draft === undefined ? {} : { 'data-xuanshu-draft': draft })}
    >
      <span className="xs-consult__role">{roleLabel(message.role)}</span>
      {draft === undefined ? null : (
        <span className="xs-consult__badge" data-xuanshu-draft-badge={draft}>
          {draftBadgeLabel(draft)}
        </span>
      )}
      {message.source === undefined ? null : (
        <small className="xs-consult__note" data-xuanshu-source={message.source}>
          {`注入 · ${message.source}`}
        </small>
      )}
      <p className="xs-consult__text">{message.text}</p>
    </article>
  );
}

export function XsConsultHistoryReader({
  session,
  messages,
  drafts,
  loading = false,
  error,
  onBack,
  onContinue,
  onRetry,
}: XsConsultHistoryReaderProps) {
  // 票 31：采用稿按轮收组（普通消息照旧平铺）。没有 `drafts` 时 `reviewTimeline` 原样返回消息 ——
  // 于是老宿主下的回看与票 10 逐字相同。
  const items = reviewTimeline(messages, drafts);
  return (
    <section className="xs-consult__reader" data-xuanshu-view="reader">
      <div className="xs-consult__toolbar">
        <button type="button" data-xuanshu-action="back-list" onClick={onBack}>← 列表</button>
        <span className="xs-consult__shortid">{shortConsultId(session.sessionId)}</span>
        <span className="xs-consult__row-title">{session.title}</span>
        <small className="xs-consult__note">{formatHistoryMeta(session)}</small>
        <span className="xs-consult__badge" data-xuanshu-badge="readonly">【只读 · 不可编辑】</span>
        <button type="button" data-xuanshu-action="continue-consult" onClick={onContinue}>
          {'继续这次问事 ▸'}
        </button>
      </div>

      {loading ? <p className="xs-consult__note" data-xuanshu-state="loading">正在读这条会话…</p> : null}

      {error === undefined ? null : (
        <div className="xs-consult__error" data-xuanshu-error="read" role="alert">
          <p>{error}</p>
          <div className="xs-consult__actions">
            <button type="button" data-xuanshu-action="retry-read" onClick={onRetry}>重试</button>
            <button type="button" data-xuanshu-action="back-list" onClick={onBack}>返回列表</button>
          </div>
        </div>
      )}

      <div className="xs-consult__messages">
        {items.map((item) => (item.kind === 'message' ? (
          <XsConsultMessageRow key={item.key} message={item.message} />
        ) : (
          <section
            className="xs-consult__round"
            key={item.key}
            data-xuanshu-round={String(item.round)}
            data-xuanshu-round-state={item.state}
          >
            {/* 票 31：每轮一行组头，写清这一轮的处境（当前 / 已否决 / 已被取代）。 */}
            <h4 className="xs-consult__round-head" data-xuanshu-round-head={String(item.round)}>
              {draftRoundLabel(item)}
            </h4>
            {item.items.map((row, index) => (
              <XsConsultMessageRow
                key={`${item.key}-${String(index)}`}
                message={row.message}
                draft={row.state}
              />
            ))}
          </section>
        )))}
      </div>
      <p className="xs-consult__note" data-xuanshu-note="reader-readonly">
        回看是只读的：不改会话记录、不进会话、不追加任何事件。
      </p>
    </section>
  );
}
