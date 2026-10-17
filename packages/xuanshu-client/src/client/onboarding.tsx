/**
 * 票 08 · 八字冷启动向导（main key `onboarding`）+ 加性注册（S3；冻结契约 §6）。
 *
 * 这一层只做三件事，界面事实全在 `onboarding-steps.tsx`、口径全在 `onboarding-model.ts`：
 *   1. **五步状态机 + 草稿**（草稿只在本次向导会话内，S3 §6 防脏状态 H1）；
 *   2. **时区重算**：坐标或出生日期一变就问 `bazi.timezone`（客户端**不自己算**，契约 §4）；
 *   3. **出盘编排**：请求序号丢弃过期回包、出盘期间单飞、一次落定（S3 §5 第 8 步）。
 *
 * 出盘的三条硬约束都落在这里的调用路径上：
 *   - `confirmed: true` 只可能来自人点 `[确认并出盘]`（或澄清闸里的 `[回答并重新出盘]`）；
 *   - 缺经纬度 / 时区未定 / 未勾核对 → `buildCastRequest` 直接返回 `undefined`，**一个请求都不发**；
 *   - 澄清闸拦截 → 原文展示，**不落谱、不点亮命盘卡**（不动 controller，也不切面板）。
 *
 * 出盘成功才 `controller.invalidate()` + 回总览：命盘卡从 `empty` 变 `ready` 读的是快照，
 * **不重新出盘**（S2 §5.1：快照是唯一事实源）。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Context } from '@deepseek-ai/cordis';

import type { BaziApi, CastGate, CastResult, ZoneResult } from './bazi-api.js';
import type { BaziUiController } from './bazi-controller.js';
import { installBaziStyle } from './bazi-style.js';
import { CITY_RESULT_LIMIT, createCityQuery } from './cities.js';
import type { City, CityQueryState } from './cities.js';
import {
  buildCastRequest,
  defaultDraft,
  manualLocation,
  nudgeDateTime,
  nowStamp,
} from './onboarding-model.js';
import type { NudgeGrain, OnboardingDraft } from './onboarding-model.js';
import {
  AI_STEP,
  STEP_COUNT,
  XsAiStep,
  XsConfirmStep,
  XsPlaceStep,
  XsStepBar,
  XsTimeAlgStep,
  XsTimeStep,
  XsZoneStep,
} from './onboarding-steps.js';
import type { AiReadinessController } from './ai-model.js';
import { useAiReadiness } from './ai-views.js';
import { ONBOARDING_ID, ONBOARDING_LABEL, ONBOARDING_ORDER } from './panel.js';
import type { PanelNavTarget } from './panel.js';
import type { RpcContext } from './rpc.js';

/** 手输被忽略时的提示（非法值忽略不回填，但要让人知道发生了什么）。 */
const MANUAL_REJECTED_HINT = '经纬度不合法，已忽略（经度在前，例如 118.78 / 32.06）';

/** 城市搜索的调度器（小库即时 + 180ms 防抖后的大库），生命周期绑在组件上。 */
function useCityQuery(api: BaziApi, query: string): CityQueryState {
  const controller = useMemo(
    () =>
      createCityQuery({
        // 失败**不在这里吞**：让 `bazi.cities` 的拒绝走到调度器里，由它静默回落小库。
        loadFull: (keyword, signal) =>
          api.cities({ query: keyword, limit: CITY_RESULT_LIMIT }, signal).then((result) => result.items),
      }),
    [api],
  );
  useEffect(() => {
    controller.setQuery(query);
  }, [controller, query]);
  useEffect(() => () => { controller.dispose(); }, [controller]);
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

export interface OnboardingPanelProps {
  /** 命盘数据面（`index.tsx` 用 `createBaziApi(ctx)` 造好注入）。 */
  api: BaziApi;
  /** 跨面板控制器：出盘成功后通知概览重取数、重录时带预填草稿。 */
  controller: BaziUiController;
  /** 面板导航（出盘成功 → 回总览；取消 → 也回总览）。 */
  navigate: (target: PanelNavTarget) => void;
  /** 静态预置草稿（重录预填 / 测试与 SSR 断言用；给了就不从 controller 取）。 */
  preloadedDraft?: OnboardingDraft;
  /** #29：「接上 AI」的只读状态（与概览共用同一个控制器；缺席 → 未知，不静默禁用）。 */
  aiStatus?: AiReadinessController;
  /** 能真的打开 DSH「设置 → 模型」时才给（没有就只显示路径文本）。 */
  onOpenAiSettings?: () => void;
}

/**
 * 冷启动向导（八字五步 + 「接上 AI」）。
 * @param props - 数据面、控制器、导航与「接上 AI」状态面。
 * @returns 向导面板节点。
 */
export function OnboardingPanel({ api, controller, navigate, preloadedDraft, aiStatus, onOpenAiSettings }: OnboardingPanelProps) {
  const [draft, setDraft] = useState<OnboardingDraft>(() => preloadedDraft ?? defaultDraft());
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState('');
  const [zone, setZone] = useState<ZoneResult | undefined>(undefined);
  const [zonePending, setZonePending] = useState(false);
  const [manualHint, setManualHint] = useState<string | undefined>(undefined);
  const [gateAnswer, setGateAnswer] = useState('');
  const [result, setResult] = useState<CastResult | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const castSequence = useRef(0);
  const zoneSequence = useRef(0);

  const aiSnapshot = useAiReadiness(aiStatus);

  const cityResults = useCityQuery(api, query);

  const patch = (next: Partial<OnboardingDraft>): void => {
    setDraft((current) => ({ ...current, ...next }));
  };

  // 重录预填：**取走即清**（H1）——下一次进向导必须是第 1 步空表单。
  useEffect(() => {
    const prefill = controller.consumePrefill();
    if (prefill === undefined) return;
    setDraft(prefill);
    setStep(1);
    setResult(undefined);
    setGateAnswer('');
  }, [controller]);

  // 时区：坐标或出生日期变了、且**没手改过** → 问底座（客户端不许自己算，契约 §4）。
  const { lon, lat, date, time, zoneManual } = draft;
  useEffect(() => {
    if (zoneManual) return;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || date.trim() === '') {
      setZone(undefined);
      setZonePending(false);
      return;
    }
    const mine = ++zoneSequence.current;
    setZonePending(true);
    void api
      .timezone({ lat: lat as number, lon: lon as number, date, time: time === '' ? undefined : time })
      .then((answer) => {
        if (mine !== zoneSequence.current) return; // 过期回包丢弃
        setZone(answer);
        setZonePending(false);
        // 推导失败（zone=null）时把草稿的时区清空：宁可挡住出盘，也不留一个假的。
        patch({ zone: answer.zone ?? '' });
      })
      .catch(() => {
        if (mine !== zoneSequence.current) return;
        setZone({ zone: null, offsetMinutes: null, dst: null });
        setZonePending(false);
        patch({ zone: '' });
      });
    // `zone` 不是依赖：回包写回的正是 zone，写进去再触发就会打转。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, lon, lat, date, time, zoneManual]);

  const gotoStep = (target: number): void => {
    setStep(Math.min(STEP_COUNT, Math.max(1, target)));
  };

  const pickCity = (city: City): void => {
    setManualHint(undefined);
    patch({ place: city.name, lon: city.lon, lat: city.lat });
  };

  const applyManual = (lonText: string, latText: string): void => {
    const point = manualLocation(lonText, latText);
    if (point === undefined) {
      // 非法值忽略、**不回填**；同时把旧地名清掉（不留旧地名，S3 §3.2③）。
      setManualHint(MANUAL_REJECTED_HINT);
      return;
    }
    setManualHint(undefined);
    patch({ place: '', lon: point.lon, lat: point.lat });
  };

  const nudge = (grain: NudgeGrain, delta: number): void => {
    if (delta === 0) return; // [确定] 只表示「落定」，不改变值
    const next = nudgeDateTime(draft.date, draft.time, grain, delta);
    patch({ date: next.date, time: next.time });
  };

  const useNow = (): void => {
    patch(nowStamp());
  };

  const cancel = (): void => {
    setDraft(defaultDraft());
    setStep(1);
    setResult(undefined);
    setGateAnswer('');
    navigate('overview');
  };

  /**
   * 离开「接上 AI」这一步（完成或跳过都走这里）。
   *
   * 跳过的语义是**入口仍禁用**：不清任何 provider 配置（本来也没写），只是回总览；
   * 门禁读的是只读状态面，未接上时问事格继续置灰并指向「设置 → 模型」。
   */
  const leaveAiStep = (): void => {
    setDraft(defaultDraft());
    setStep(1);
    setResult(undefined);
    setGateAnswer('');
    navigate('overview');
  };

  /**
   * 出盘。`answer === undefined` = 走第 5 步的确认；给了 `answer` = 澄清闸里的「回答并重新出盘」。
   */
  const cast = (answer?: string): void => {
    const source = answer === undefined ? draft : { ...draft, gateAnswer: answer };
    const request = buildCastRequest(source);
    if (request === undefined) return; // 阻塞项没解决：一个请求都不发
    const mine = ++castSequence.current;
    setBusy(true);
    setResult(undefined);
    void api
      .cast(request)
      .then((answer2) => {
        if (mine !== castSequence.current) return; // 过期回包丢弃
        setResult(answer2);
        setBusy(false);
        if (answer2.phase !== 'ok') return; // 澄清闸 / 失败：留在向导内
        // 落谱成功：通知概览重取数，然后走最后一步「接上 AI」（不重新出盘、不直接回总览）。
        controller.invalidate();
        setStep(AI_STEP);
      })
      .catch((error: unknown) => {
        if (mine !== castSequence.current) return;
        setResult({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
        setBusy(false);
      });
  };

  const gate: CastGate | undefined = result?.phase === 'gate' ? result.gate : undefined;

  return (
    <main className="xs-wizard" data-xuanshu-panel={ONBOARDING_ID}>
      <header className="xs-wizard__head">
        <h1>八字冷启动向导</h1>
        <p className="xs-wizard__note">
          填一次出生信息 → 出盘 → 落底座谱 → 点亮命盘卡，之后不再重复录入。
        </p>
      </header>

      <XsStepBar step={step} />

      {step === 1 ? (
        <XsTimeStep draft={draft} onChange={patch} onNudge={nudge} onNow={useNow} />
      ) : null}
      {step === 2 ? (
        <XsPlaceStep
          draft={draft}
          query={query}
          results={cityResults}
          manualHint={manualHint}
          onQuery={setQuery}
          onPick={pickCity}
          onManual={applyManual}
        />
      ) : null}
      {step === 3 ? (
        <XsZoneStep
          draft={draft}
          zone={zone}
          pending={zonePending}
          onZone={(value) => { patch({ zone: value, zoneManual: value !== '' }); }}
          onAuto={() => { patch({ zoneManual: false, zone: '' }); }}
        />
      ) : null}
      {step === 4 ? <XsTimeAlgStep draft={draft} onChange={patch} /> : null}
      {step === 5 ? (
        <XsConfirmStep
          draft={draft}
          zone={zone}
          gate={gate}
          busy={busy}
          gateAnswer={gateAnswer}
          onEdit={gotoStep}
          onToggleNote={(id) => {
            patch({ notes: draft.notes.includes(id) ? draft.notes.filter((row) => row !== id) : [...draft.notes, id] });
          }}
          onToggleVerified={() => { patch({ verified: !draft.verified }); }}
          onGateAnswer={setGateAnswer}
          onCast={() => { cast(); }}
          onAnswerGate={() => { cast(gateAnswer); }}
          onGotoPlace={() => { gotoStep(2); }}
          onGotoManual={() => { gotoStep(2); }}
        />
      ) : null}
      {step === AI_STEP ? (
        <XsAiStep
          {...(aiSnapshot?.readiness === undefined ? {} : { readiness: aiSnapshot.readiness })}
          checking={aiSnapshot?.checking === true}
          {...(aiStatus === undefined ? {} : { onRetry: () => { void aiStatus.refresh(); } })}
          {...(onOpenAiSettings === undefined ? {} : { onOpenSettings: onOpenAiSettings })}
          onFinish={leaveAiStep}
          onSkip={leaveAiStep}
        />
      ) : null}

      {result === undefined || result.phase === 'gate' ? null : (
        <div
          className="xs-wizard__cast-result"
          data-xuanshu-cast={result.phase}
          role={result.phase === 'ok' ? 'status' : 'alert'}
        >
          <p>{result.message}</p>
          {result.phase === 'ok' ? null : (
            <div className="xs-wizard__actions">
              <button type="button" data-xuanshu-action="cast-retry" onClick={() => { cast(); }}>重试</button>
              <button type="button" data-xuanshu-action="cast-edit" onClick={() => { gotoStep(1); }}>改出生信息</button>
            </div>
          )}
        </div>
      )}

      <footer className="xs-wizard__footer">
        <button type="button" data-xuanshu-action="prev" disabled={step === 1} onClick={() => { gotoStep(step - 1); }}>
          {'<- 上一步'}
        </button>
        <button type="button" data-xuanshu-action="next" disabled={step === STEP_COUNT} onClick={() => { gotoStep(step + 1); }}>
          {'下一步 ->'}
        </button>
        <span className="xs-wizard__spacer" />
        <button type="button" data-xuanshu-action="cancel" onClick={cancel}>取消向导</button>
      </footer>
    </main>
  );
}

/** 侧栏行图标（guide 用「填」字标；风格与 `OverviewIcon` / `CangIcon` 同族）。 */
function OnboardingIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h16" />
      <path d="M6 20V9.5L12 4l6 5.5V20" />
      <path d="M9.5 20v-5h5v5" />
    </svg>
  );
}

/** 向导安装所需的依赖（由 `index.tsx` 统一造好，保证三块面板共用同一份状态）。 */
export interface BaziInstallDeps {
  api: BaziApi;
  controller: BaziUiController;
  navigate: (target: PanelNavTarget) => void;
  /** #29：与概览共用同一个「接上 AI」只读控制器（向导第 6 步读它）。 */
  aiStatus?: AiReadinessController;
  /** #29：能真的打开设置时才给。 */
  onOpenAiSettings?: () => void;
}

/**
 * 向导的**加性**注册（main key `onboarding` + 侧栏行 `onboarding`）。
 *
 * 两条纪律（Lead 在票 08 开工时点名的硬边界）：
 *   1. **apply 期不许调 `ctx.layout.selectPanel`**：`verify-assembly.mjs` 的 S3 断言
 *      「默认面板 selectPanel 恰好一次、值必须是 overview」。导航只由用户动作触发。
 *   2. **不新增运行期 `require`**：产物只许 require `react` / `react/jsx-runtime`；
 *      `import type` 不产生 require，所以类型可以随便引。
 *
 * 非 DOM 环境（Node 里的产物物化 / SSR 断言）要**安全**：只有样式注入被 `document` 守卫挡掉，
 * 注册面照做 —— 否则「注册形状」就没法在 Node 里断言了（`cang-style.ts` 同款）。
 *
 * @param ctx - 客户端上下文（需 `slots`；`layout` 只在用户点击时才用）。
 * @param deps - 数据面 / 控制器 / 导航（三块面板共用同一份）。
 */
export function installOnboarding(ctx: Context & RpcContext, deps: BaziInstallDeps): void {
  installBaziStyle();
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      { name: 'main', key: ONBOARDING_ID, inject: () => ({ ...deps }) },
      OnboardingPanel as never,
    ),
  );
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: ONBOARDING_ID, order: ONBOARDING_ORDER, label: ONBOARDING_LABEL },
      OnboardingIcon as never,
    ),
  );
}
