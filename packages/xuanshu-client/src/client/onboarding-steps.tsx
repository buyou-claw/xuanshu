/**
 * 票 08 · S3 向导的五步视图（**受控组件**：所有状态由 props 给，交互回调往上抛）。
 *
 * 为什么拆成受控步骤组件而不是一个大组件：
 *   向导的交互链路（出盘编排、时区重算、防抖搜索）与**界面事实**（文案、禁用理由、回问原文）
 *   是两件不同的事，前者在 `onboarding.tsx` 与纯模型里，后者在这里。Node 里没有 jsdom，
 *   受控组件能用 `renderToStaticMarkup` 逐条断言「这一刻屏幕上写了什么」
 *   （`tests/assembly/onboarding-wizard.test.mjs`），这正对着票面「界面上怎么让人看出来」那一列。
 *
 * 屏稿：`docs/design/ui-v1/screens/S3-八字冷启动向导.md` §2.1–§2.7（宽/窄两态共用同一份节点）。
 * 文案纪律（照屏稿逐字）：
 *   - 固定小字**「当地时间」**（用户填的是钟表时间，不是真太阳时）；
 *   - 微调粒度含**「四分钟」**（= 1° 经度时差，不许改写成「加减分秒」）；
 *   - 无匹配 = **「无匹配城市，可改用手输经纬度」**（上游原话引导去地图，玄枢没有地图）；
 *   - 缺经纬度的理由必须**写明缺什么 + 因果 + 两个修复入口**，且**没有旁路按钮**。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';

import type { City, CityQueryState } from './cities.js';
import type { CastGate, ZoneResult } from './bazi-api.js';
import type { AiReadiness } from './ai-model.js';
import { XsAiReadiness } from './ai-views.js';
import {
  CAST_BLOCK_REASON,
  CAST_MISSING_REASON,
  GENDER_OPTIONS,
  NUDGE_GRAINS,
  NOTE_OPTIONS,
  TIME_ALG_OPTIONS,
  UNNAMED_PLACE,
  ZONE_OFFSETS,
  castBlockers,
  formatCoords,
  formatOffsetMinutes,
  genderLabel,
  missingCoordinates,
  placeLabel,
  timeAlgLabel,
} from './onboarding-model.js';
import type { NudgeGrain, OnboardingDraft } from './onboarding-model.js';

/** 各步的步名（步骤条与页头共用；顺序即线框顺序）。 */
export const STEP_TITLES = [
  '出生日期与钟表时间',
  '出生地（必填：缺经纬度不能出盘）',
  '时区（随出生地自动推导，含 DST）',
  '起盘口径',
  '确认你的出生信息',
  // #29：冷启动从「八字 → 就绪」变成「八字 → 接上 AI → 就绪」。
  // 放在最后一步而不是新开一块面板：不新增 main key / 侧栏行，注册面零变化。
  '接上 AI',
] as const;

/** 各步的短名（窄屏步骤条折成一行用它）。 */
export const STEP_SHORT = ['时间', '出生地', '时区', '口径', '确认', '接 AI'] as const;

/** 步数（步骤条的「第 n / N 步」与所有越界夹取都读它，只有一处真相）。 */
export const STEP_COUNT = STEP_TITLES.length;

/** 「接上 AI」是最后一步（出盘成功后落到这里；也可从第 5 步按 [下一步] 进来）。 */
export const AI_STEP = STEP_COUNT;

/** 步骤条：N 格 + 当前格高亮 + `第 n / N 步` 文案。 */
export function XsStepBar({ step }: { step: number }) {
  return (
    <nav className="xs-wizard__steps" aria-label="向导步骤" data-xuanshu-stepbar={String(step)}>
      <p className="xs-wizard__progress">{`第 ${String(step)} / ${String(STEP_COUNT)} 步`}</p>
      <ol className="xs-wizard__step-list">
        {STEP_TITLES.map((title, index) => {
          const number = index + 1;
          const state = number < step ? 'done' : number === step ? 'current' : 'todo';
          return (
            <li
              key={title}
              className={`xs-wizard__step xs-wizard__step--${state}`}
              data-xuanshu-step={String(number)}
              data-xs-current={number === step ? 'true' : undefined}
              data-xs-state={state}
            >
              <span className="xs-wizard__step-index">{String(number)}</span>
              <span className="xs-wizard__step-name">{STEP_SHORT[index]}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** 步骤壳：`data-xs-step` + 页头 + 内容。 */
function StepShell({ step, title, hint, children }: { step: number; title: string; hint: ReactNode; children: ReactNode }) {
  return (
    <section className="xs-wizard__step-body" data-xs-step={String(step)}>
      <header className="xs-wizard__step-head">
        <h2>{`第 ${String(step)} / ${String(STEP_COUNT)} 步 · ${title}`}</h2>
      </header>
      <div className="xs-wizard__cols">
        <div className="xs-wizard__form">{children}</div>
        <aside className="xs-wizard__aside">{hint}</aside>
      </div>
    </section>
  );
}

/** 步骤 1：出生日期与钟表时间（S3 §2.1）。 */
export interface XsTimeStepProps {
  draft: OnboardingDraft;
  onChange: (patch: Partial<OnboardingDraft>) => void;
  onNudge: (grain: NudgeGrain, delta: number) => void;
  onNow?: () => void;
}

export function XsTimeStep({ draft, onChange, onNudge, onNow }: XsTimeStepProps) {
  const [grain, setGrain] = useState<NudgeGrain>('fourMinute');
  const empty = draft.date.trim() === '' || draft.time.trim() === '';
  const activeLabel = NUDGE_GRAINS.find((row) => row.id === grain)?.label ?? '四分钟';

  return (
    <StepShell
      step={1}
      title={STEP_TITLES[0]}
      hint={
        <>
          <p>▸ 公历即可；农历换算由底座做。</p>
          <p>▸ 「当地时间」是固定小字：你填的是钟表时间，不是真太阳时。</p>
          <p>▸ 微调粒度里的「四分钟」= 1° 经度时差，与真太阳时的换算粒度同源。</p>
        </>
      }
    >
      <label className="xs-wizard__field">
        <span>① 日期</span>
        <input
          type="date"
          data-xuanshu-field="birth-date"
          value={draft.date}
          onChange={(event) => { onChange({ date: event.target.value }); }}
        />
        {/*
          2026-11-02 加：这台机器上 Edge 把原生 date 的占位符渲染成「yyyy-mm-日」
          （英文 yyyy/mm 混中文「日」）。实测 lang="en" 与 lang="zh-CN" 渲染完全一样，
          是浏览器跟系统 locale 的行为，不是我们能改的 —— 所以不换成自定义控件，
          只给一个格式样例，用户不用猜最后那位该填什么。
        */}
        <small className="xs-wizard__note" data-xuanshu-note="date-format">格式如 1990-05-20</small>
      </label>
      <label className="xs-wizard__field">
        <span>② 时间</span>
        <input
          type="time"
          data-xuanshu-field="birth-time"
          value={draft.time}
          onChange={(event) => { onChange({ time: event.target.value }); }}
        />
        <small className="xs-wizard__note" data-xuanshu-note="local-clock">当地时间</small>
      </label>
      {empty ? (
        <p className="xs-wizard__hint" data-xuanshu-hint="need-birth">
          先填出生信息：日期与时刻都填上才能往下走（时刻填当地时间即可）。
        </p>
      ) : null}
      <div className="xs-wizard__nudge" data-xuanshu-nudge="grains">
        <span>③ 内联微调</span>
        <button type="button" data-xuanshu-action="nudge-minus" onClick={() => { onNudge(grain, -1); }}>
          [-]
        </button>
        <span className="xs-wizard__nudge-grains">
          {NUDGE_GRAINS.map((row) => (
            <button
              key={row.id}
              type="button"
              className={row.id === grain ? 'xs-chip xs-chip--on' : 'xs-chip'}
              data-xuanshu-grain={row.id}
              data-xs-active={row.id === grain ? 'true' : undefined}
              onClick={() => { setGrain(row.id); }}
            >
              {row.label}
            </button>
          ))}
        </span>
        <button type="button" data-xuanshu-action="nudge-plus" onClick={() => { onNudge(grain, 1); }}>
          [+]
        </button>
        <button type="button" data-xuanshu-action="nudge-now" onClick={onNow}>
          此刻
        </button>
        <button type="button" data-xuanshu-action="nudge-apply" onClick={() => { onNudge(grain, 0); }}>
          确定
        </button>
        <small className="xs-wizard__note">{`当前粒度：${activeLabel}`}</small>
      </div>
    </StepShell>
  );
}

/** 步骤 2：出生地双通道（S3 §2.2）。 */
export interface XsPlaceStepProps {
  draft: OnboardingDraft;
  query: string;
  results: CityQueryState;
  /** 手输被忽略时的提示（非法值忽略不回填，但要让人知道发生了什么）。 */
  manualHint?: string;
  onQuery: (query: string) => void;
  onPick: (city: City) => void;
  onManual: (lonText: string, latText: string) => void;
}

export function XsPlaceStep({ draft, query, results, manualHint, onQuery, onPick, onManual }: XsPlaceStepProps) {
  const [lonText, setLonText] = useState('');
  const [latText, setLatText] = useState('');
  const missing = missingCoordinates(draft);
  const searching = query.trim() !== '';
  const noMatch = searching && results.items.length === 0;

  return (
    <StepShell
      step={2}
      title={STEP_TITLES[1]}
      hint={
        <>
          <p>▸ 断网可用：小库随程序自带，即时出结果。</p>
          <p>▸ 有输入后 180ms 才去问大库；大库不在（没装 / 被裁掉）就静默只用小库。</p>
          <p>▸ 选城市即带出经纬度；海外与小地名走手输坐标。</p>
        </>
      }
    >
      <h3>① 通道 A — 离线城市库（推荐）</h3>
      <label className="xs-wizard__field">
        <span>搜索城市 / 区县</span>
        <input
          type="text"
          data-xuanshu-field="city-search"
          placeholder="搜索城市 / 区县 ..."
          value={query}
          onChange={(event) => { onQuery(event.target.value); }}
        />
      </label>
      <ul className="xs-wizard__cities" data-xuanshu-cities={String(results.items.length)}>
        {results.items.map((city) => (
          <li key={city.name} data-xuanshu-city={city.name}>
            <span className="xs-wizard__city-name">{city.name}</span>
            <span className="xs-wizard__city-region">{city.region}</span>
            <button type="button" data-xuanshu-action="pick-city" onClick={() => { onPick(city); }}>
              选中
            </button>
          </li>
        ))}
      </ul>
      {searching && results.pending ? (
        <p className="xs-wizard__note" data-xuanshu-note="city-pending">正在搜更大的城市库（小库结果已经在上面了）…</p>
      ) : null}
      {/* 大库失败**静默**：这里不渲染任何错误（契约 §5）。 */}
      {noMatch ? (
        <p className="xs-wizard__hint" data-xuanshu-note="city-no-match">
          无匹配城市，可改用手输经纬度
        </p>
      ) : null}

      <h3>② 通道 B — 手输经纬度（GPS 十进制）</h3>
      <div className="xs-wizard__manual">
        <label className="xs-wizard__field">
          <span>经度（-180 ~ 180）</span>
          <input
            type="text"
            inputMode="decimal"
            data-xuanshu-field="manual-lon"
            placeholder="118.78"
            value={lonText}
            onChange={(event) => { setLonText(event.target.value); }}
          />
        </label>
        <label className="xs-wizard__field">
          <span>纬度（-90 ~ 90）</span>
          <input
            type="text"
            inputMode="decimal"
            data-xuanshu-field="manual-lat"
            placeholder="32.06"
            value={latText}
            onChange={(event) => { setLatText(event.target.value); }}
          />
        </label>
        <button type="button" data-xuanshu-action="apply-manual" onClick={() => { onManual(lonText, latText); }}>
          应用
        </button>
      </div>
      {manualHint === undefined ? null : (
        <p className="xs-wizard__hint" data-xuanshu-note="manual-rejected">{manualHint}</p>
      )}

      <h3>③ 地名与坐标（同框可见）</h3>
      <p className="xs-wizard__place" data-xuanshu-place={placeLabel(draft)}>
        <span className="xs-wizard__place-name">{placeLabel(draft)}</span>
        <span className="xs-wizard__place-coord" data-xuanshu-coord="frame">
          {missing.length === 0 && draft.lon !== undefined && draft.lat !== undefined
            ? formatCoords(draft.lon, draft.lat)
            : `还没定（缺 ${missing.join(' / ')}）`}
        </span>
        {draft.place.trim() === '' ? (
          <small className="xs-wizard__note">手输无地名时据实显示「{UNNAMED_PLACE}」，不留旧地名</small>
        ) : null}
      </p>
      <p className="xs-wizard__status" data-xuanshu-note="has-coords">
        {`当前：${missing.length === 0 ? '有经纬度' : `无经纬度（缺 ${missing.join(' / ')}）`}`}
      </p>

      <h3>④ 地图选点</h3>
      <p className="xs-wizard__note" data-xuanshu-note="no-map">地图选点：玄枢 v1 不做（无联网依赖）</p>
    </StepShell>
  );
}

/** 步骤 3：时区（S3 §2.3）。 */
export interface XsZoneStepProps {
  draft: OnboardingDraft;
  /** `bazi.timezone` 的回答；`undefined` = 还没算过。 */
  zone?: ZoneResult;
  /** 重算中（S3 §6：只有结果区显示「重算中」，步骤切换本身不 loading）。 */
  pending?: boolean;
  onZone: (zone: string) => void;
  onAuto: () => void;
}

export function XsZoneStep({ draft, zone, pending, onZone, onAuto }: XsZoneStepProps) {
  const unresolved = zone !== undefined && zone.zone === null;
  const autoZone = zone?.zone ?? '';
  return (
    <StepShell
      step={3}
      title={STEP_TITLES[2]}
      hint={
        <>
          <p>▸ 依据：经纬度 + 出生日期（客户端不自己算时区，一律问底座）。</p>
          <p>▸ 自动结果只归并 IANA 名，不写死偏移；夏令时由底座判。</p>
          <p>▸ 中国大陆统一北京时间：只把 `Asia/Urumqi` 并入 `Asia/Shanghai`，偏移仍按 IANA 算。</p>
          <p>▸ 时区只负责「钟表时间 → UTC」的偏移归一；真太阳时换算在引擎里，录入层不换算。</p>
        </>
      }
    >
      <h3>① 自动结果</h3>
      <div className="xs-wizard__zone-auto" data-xuanshu-zone="auto">
        {pending === true ? (
          <p className="xs-wizard__note" data-xuanshu-zone="pending">重算中…</p>
        ) : zone === undefined ? (
          <p className="xs-wizard__note">先在第 2 步定下出生地，这里会自动推导。</p>
        ) : autoZone === '' ? (
          <p className="xs-wizard__hint" data-xuanshu-zone="unresolved">
            自动推导失败（坐标越界或该点查不到时区）：请在下面手动指定一个 UTC 偏移，否则不能出盘。
          </p>
        ) : (
          <>
            <p className="xs-wizard__zone-value" data-xuanshu-zone="resolved">
              <strong>{autoZone}</strong>
              <span>{formatOffsetMinutes(zone.offsetMinutes)}</span>
            </p>
            <p className="xs-wizard__note">{`夏令时：${zone.dst === true ? '有' : '无'}`}</p>
          </>
        )}
        <p className="xs-wizard__note">依据：经纬度 + 出生日期</p>
      </div>

      <h3>② 手动覆盖（仅当自动不对）</h3>
      <div className="xs-wizard__zone-manual" data-xuanshu-zone="manual">
        <label className="xs-wizard__field">
          <span>固定 UTC 偏移（28 档）</span>
          <select
            data-xuanshu-field="zone-override"
            value={draft.zoneManual ? draft.zone : ''}
            onChange={(event) => { onZone(event.target.value); }}
          >
            <option value="">跟随自动结果</option>
            {ZONE_OFFSETS.map((row) => (
              <option key={row.value} value={row.value}>{`${row.value} ${row.label}`}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-xuanshu-action="zone-auto"
          disabled={!draft.zoneManual}
          title={draft.zoneManual ? undefined : '还没手改过，[自动] 没有可清除的东西'}
          onClick={onAuto}
        >
          自动
        </button>
        <p className="xs-wizard__note" data-xuanshu-note="zone-current">
          {draft.zoneManual ? `当前：手动指定 ${draft.zone}` : `当前：自动结果 ${draft.zone === '' ? '（未定）' : draft.zone}`}
        </p>
      </div>

      <h3>③ 时区只负责一步</h3>
      <p className="xs-wizard__note" data-xuanshu-note="zone-boundary">
        时区只负责「钟表时间 → UTC」的偏移归一；真太阳时换算在引擎里，录入层不换算。
      </p>
    </StepShell>
  );
}

/** 步骤 4：起盘口径（S3 §2.4）。 */
export interface XsTimeAlgStepProps {
  draft: OnboardingDraft;
  onChange: (patch: Partial<OnboardingDraft>) => void;
}

export function XsTimeAlgStep({ draft, onChange }: XsTimeAlgStepProps) {
  return (
    <StepShell
      step={4}
      title={STEP_TITLES[3]}
      hint={
        <>
          <p>▸ 默认档 = 0（真太阳时）：实现上省略该键，不写默认值。</p>
          <p>▸ 「春分定卯时（= 2）」上游自身未实现 —— 界面上不出现，也不置灰。</p>
          <p>▸ 换算发生在引擎内部：录入层不换算（界面上没有「真太阳时修正」开关，找不到是设计）。</p>
          <p>▸ 其余旋钮玄枢不给：长生 / 神煞 / 晚子时 / 命宫 / 月律分野 / 流派 / 显示区（索引 D4）。</p>
        </>
      }
    >
      <h3>① 时间算法（timeAlg）</h3>
      <div className="xs-wizard__radio-group" data-xuanshu-field="time-alg">
        {TIME_ALG_OPTIONS.map((option) => (
          <label key={option.value} className="xs-wizard__radio">
            <input
              type="radio"
              name="time-alg"
              value={option.value}
              checked={draft.timeAlg === option.value}
              data-xuanshu-radio={`time-alg-${String(option.value)}`}
              onChange={() => { onChange({ timeAlg: option.value }); }}
            />
            <span>{option.label}</span>
            <small className="xs-wizard__note">{option.hint}</small>
          </label>
        ))}
      </div>

      <h3>② 性别（排大运用）</h3>
      <div className="xs-wizard__radio-group" data-xuanshu-field="gender">
        {GENDER_OPTIONS.map((option) => (
          <label key={option.value} className="xs-wizard__radio">
            <input
              type="radio"
              name="gender"
              value={option.value}
              checked={draft.gender === option.value}
              data-xuanshu-radio={`gender-${option.value}`}
              onChange={() => { onChange({ gender: option.value }); }}
            />
            <span>{option.label}</span>
            {option.hint === '' ? null : <small className="xs-wizard__note">{option.hint}</small>}
          </label>
        ))}
      </div>

      <h3>③ 其余旋钮</h3>
      <p className="xs-wizard__note" data-xuanshu-note="no-other-knobs">
        一律由引擎缺省决定，界面不出现：长生 / 神煞查法 / 晚子时四态 / 命宫起法 / 月律分野 /
        南半球月令 / 起运精度 / 藏干版本 / 生肖归属 / 断命流派 / 显示区。
      </p>
      <h3>④ 换算发生在哪一层</h3>
      <p className="xs-wizard__note" data-xuanshu-note="no-conversion-here">
        引擎内部；录入层不换算。
      </p>
    </StepShell>
  );
}

/** 步骤 5：确认表 + 澄清闸 + 出盘（S3 §2.5 / §2.6 / §2.7）。 */
export interface XsConfirmStepProps {
  draft: OnboardingDraft;
  zone?: ZoneResult;
  gate?: CastGate;
  busy?: boolean;
  gateAnswer?: string;
  onEdit: (step: number) => void;
  onToggleNote: (id: string) => void;
  onToggleVerified: () => void;
  onGateAnswer?: (value: string) => void;
  onCast: () => void;
  onAnswerGate: () => void;
  onGotoPlace?: () => void;
  onGotoManual?: () => void;
}

export function XsConfirmStep({
  draft,
  zone,
  gate,
  busy = false,
  gateAnswer = '',
  onEdit,
  onToggleNote,
  onToggleVerified,
  onGateAnswer,
  onCast,
  onAnswerGate,
  onGotoPlace,
  onGotoManual,
}: XsConfirmStepProps) {
  const blockers = castBlockers(draft);
  const coordinates = missingCoordinates(draft);
  const others = blockers.filter((blocker) => blocker !== 'coordinates');
  const ready = blockers.length === 0;

  return (
    <StepShell
      step={5}
      title={STEP_TITLES[4]}
      hint={
        <>
          <p>▸ 五项逐行核对，每行 `[改]` 回跳对应步。</p>
          <p>▸ 「不确定项」把「只知道大概」显式化，写进 `clarification_notes`（不是拒绝出盘）。</p>
          <p>▸ `[x] 以上信息我已核对` 是出盘的解锁条件；底座回问就地展开，回答后重出盘。</p>
        </>
      }
    >
      <fieldset className="xs-wizard__confirm" data-xuanshu-busy={busy ? 'cast' : undefined} disabled={busy}>
        <legend>① 确认你的出生信息</legend>
        <ul className="xs-wizard__confirm-list">
          <li data-xuanshu-confirm="time">
            <span className="xs-wizard__confirm-label">出生时间</span>
            <span className="xs-wizard__confirm-value">
              {`${draft.date === '' ? '（未填）' : draft.date} ${draft.time === '' ? '（未填）' : draft.time} 当地时间`}
            </span>
            <button type="button" data-xuanshu-action="edit-step-1" onClick={() => { onEdit(1); }}>改</button>
          </li>
          <li data-xuanshu-confirm="place">
            <span className="xs-wizard__confirm-label">出生地</span>
            <span className="xs-wizard__confirm-value">
              {`${placeLabel(draft)} ${coordinates.length === 0 && draft.lon !== undefined && draft.lat !== undefined ? formatCoords(draft.lon, draft.lat) : `（缺 ${coordinates.join(' / ')}）`}`}
            </span>
            <button type="button" data-xuanshu-action="edit-step-2" onClick={() => { onEdit(2); }}>改</button>
          </li>
          <li data-xuanshu-confirm="zone">
            <span className="xs-wizard__confirm-label">时区</span>
            <span className="xs-wizard__confirm-value">
              {`${draft.zone === '' ? '（未定）' : draft.zone}${draft.zoneManual ? '（手动指定）' : '（自动）'}${
                zone?.dst === true && !draft.zoneManual ? '，已判 DST' : ''
              }`}
            </span>
            <button type="button" data-xuanshu-action="edit-step-3" onClick={() => { onEdit(3); }}>改</button>
          </li>
          <li data-xuanshu-confirm="timeAlg">
            <span className="xs-wizard__confirm-label">时间算法</span>
            <span className="xs-wizard__confirm-value">
              {`${timeAlgLabel(draft.timeAlg)}${draft.timeAlg === 0 ? '（缺省省略 = 0）' : ` = ${String(draft.timeAlg)}`}`}
            </span>
            <button type="button" data-xuanshu-action="edit-step-4" onClick={() => { onEdit(4); }}>改</button>
          </li>
          <li data-xuanshu-confirm="gender">
            <span className="xs-wizard__confirm-label">性别</span>
            <span className="xs-wizard__confirm-value">{genderLabel(draft.gender)}</span>
            <button type="button" data-xuanshu-action="edit-step-4" onClick={() => { onEdit(4); }}>改</button>
          </li>
        </ul>

        <h3>② 不确定项 → clarification_notes</h3>
        <div className="xs-wizard__notes">
          {NOTE_OPTIONS.map((option) => (
            <label key={option.id} className="xs-wizard__check">
              <input
                type="checkbox"
                data-xuanshu-field={`note-${option.id}`}
                checked={draft.notes.includes(option.id)}
                onChange={() => { onToggleNote(option.id); }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>

        <h3>③ 澄清闸</h3>
        <label className="xs-wizard__check">
          <input
            type="checkbox"
            data-xuanshu-field="verified"
            checked={draft.verified}
            onChange={onToggleVerified}
          />
          <span>以上信息我已核对</span>
        </label>
        <p className="xs-wizard__note">
          勾选后才解锁出盘；底座若回问，会在这里就地展开（拦截期间不落谱、不点亮命盘卡）。
        </p>

        {gate === undefined ? null : (
          <div className="xs-wizard__gate" data-xuanshu-gate="prompt" role="alert">
            <h3>底座需要你确认</h3>
            {/* 回问**原文**展示（不转述、不吞掉）——契约 §2：promptToUser 必须是信封原文。 */}
            <p className="xs-wizard__gate-prompt" data-xuanshu-gate="prompt-text">{gate.promptToUser}</p>
            {gate.questions.map((question) => (
              <p key={question} className="xs-wizard__gate-question" data-xuanshu-gate="question">{question}</p>
            ))}
            <label className="xs-wizard__field">
              <span>你的回答（随 clarification_notes 一起给底座）</span>
              <textarea
                data-xuanshu-field="gate-answer"
                value={gateAnswer}
                onChange={(event) => { onGateAnswer?.(event.target.value); }}
              />
            </label>
            <div className="xs-wizard__actions">
              <button
                type="button"
                data-xuanshu-action="answer-gate"
                disabled={busy || gateAnswer.trim() === ''}
                onClick={onAnswerGate}
              >
                回答并重新出盘
              </button>
              <button type="button" data-xuanshu-action="edit-birth" onClick={() => { onEdit(1); }}>
                改出生信息
              </button>
            </div>
          </div>
        )}
      </fieldset>

      <div className="xs-wizard__cast">
        <button
          type="button"
          className="xs-btn xs-btn--primary"
          data-xuanshu-action="cast"
          disabled={busy || !ready}
          onClick={onCast}
        >
          {busy ? '出盘中…' : '确认并出盘'}
        </button>
        <span className="xs-wizard__status" data-xuanshu-status={ready ? 'ready' : 'blocked'}>
          {ready ? '可出盘' : coordinates.length > 0 ? '缺经纬度（禁用）' : '信息未齐（禁用）'}
        </span>
      </div>

      {ready ? null : (
        <div className="xs-wizard__reason" data-xuanshu-reason="cast-disabled">
          {coordinates.length === 0 ? null : (
            <>
              {/* §2.6 的禁用态：写明缺什么 + 为什么 + 两个修复入口（没有旁路按钮）。 */}
              <p className="xs-wizard__reason-main">{CAST_MISSING_REASON}</p>
              <div className="xs-wizard__actions">
                <button type="button" data-xuanshu-action="goto-place" onClick={onGotoPlace}>去填出生地</button>
                <button type="button" data-xuanshu-action="goto-manual" onClick={onGotoManual}>改用手输经纬度</button>
              </div>
            </>
          )}
          {others.map((blocker) => (
            <p key={blocker} className="xs-wizard__reason-row" data-xuanshu-reason-row={blocker}>
              {CAST_BLOCK_REASON[blocker]}
            </p>
          ))}
        </div>
      )}
    </StepShell>
  );
}

/** 第 6 步：接上 AI（#29；「八字 → 接上 AI → 就绪」的中间那一步）。 */
export interface XsAiStepProps {
  readiness?: AiReadiness;
  checking?: boolean;
  /** 控制器缺席（SSR / 旧装配）时不给：界面只显示状态，不渲染点了没反应的重试。 */
  onRetry?: () => void;
  /** 能真的打开设置时才给（没有就只显示路径文本，绝不渲染死按钮）。 */
  onOpenSettings?: () => void;
  /** 已接上才出现（未接上时「完成」是假的）。 */
  onFinish: () => void;
  /** 任何状态都能跳过；跳过后入口仍禁用（说明在下面那行）。 */
  onSkip: () => void;
  /** 2026-11-02：真发一次最小请求，看 AI 能不能用。 */
  onProbe?: () => Promise<{ ok: boolean; ms: number; route?: { provider: string; model: string }; reply?: string; reason?: string }>
}

export function XsAiStep({
  readiness,
  checking,
  onRetry,
  onOpenSettings,
  onFinish,
  onSkip,
  onProbe,
}: XsAiStepProps) {
  const configured = readiness?.configured === true;
  return (
    <StepShell
      step={AI_STEP}
      title={STEP_TITLES[5]}
      hint={
        <>
          <p>▸ 问事要一家已注册的 provider + 一个默认模型；玄枢只读检测，不替你写配置与密钥。</p>
          <p>▸ 去 DSH「设置 → 模型」配置；配完点「重试」即可，不用重启玄枢。</p>
          <p>▸ 跳过不会让问事入口变可用：未接上时入口仍禁用，并指向「设置 → 模型」。</p>
        </>
      }
    >
      <XsAiReadiness
        {...(readiness === undefined ? {} : { readiness })}
        checking={checking === true}
        onRetry={onRetry}
        {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
        onFinish={onFinish}
        onSkip={onSkip}
        {...(onProbe === undefined ? {} : { onProbe })}
      />
      {configured ? null : (
        <p className="xs-ai__note" data-xuanshu-ai-skip="missing">
          跳过后问事入口仍禁用，并指向「设置 → 模型」——随时可以在总览或向导里重新检测。
        </p>
      )}
    </StepShell>
  );
}
