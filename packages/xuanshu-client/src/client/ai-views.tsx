/**
 * 票 29 · 「接上 AI」的界面事实（受控组件；状态全由 props 给）。
 *
 * 三块：
 *   1. `XsAiReadiness` —— 完整状态面（向导第 6 步）：`configured / providers / defaultModel / reason`
 *      四件事全在屏上；`'unknown'` 显示「未知」，永不冒充「未接上 / 没配」。
 *   2. `XsAiGate` —— 问事入口旁的**门禁行**（总览快捷入口卡）：未接上 → 可见原因 + 逐字去向
 *      「设置 → 模型」+ 重试；状态未知 → 明说未知（不静默禁用，也不静默放行）。
 *   3. `useAiReadiness` —— 把只读轮询控制器接成 React 订阅（挂载即取一次，卸载即停）。
 *
 * **「去设置」按钮只在真有打开动作时渲染**：DSH 0.2.0-rc.2 没有公开的「打开设置」客户端 API
 * （`openSection` 只经 `settings.onboarding` 的 owner props 下发；见票 28 侦察 §5.3），
 * 所以没有 handler 时只显示逐字路径文本。**绝不渲染一个点了没反应的按钮**——那正是本票要修的 bug。
 */
import { useEffect, useSyncExternalStore } from 'react';

import { AI_SETTINGS_PATH } from './ai-model.js';
import type { AiReadiness, AiReadinessController, AiReadinessSnapshot } from './ai-model.js';

/** 没有控制器时的稳定空快照（`useSyncExternalStore` 要求引用稳定）。 */
const EMPTY_SNAPSHOT: AiReadinessSnapshot = { checking: false };
const getEmptySnapshot = (): AiReadinessSnapshot => EMPTY_SNAPSHOT;
const NOOP_SUBSCRIBE = (): (() => void) => () => {};

/**
 * 订阅「接上 AI」的只读状态。
 *
 * 挂载 → `controller.start()` + 取一次；卸载 → 释放（最后一个消费者离开才真正停定时器）。
 * 没有控制器（SSR 断言 / 旧装配）→ `undefined`（界面据此显示「未知」，不是「未接上」）。
 *
 * @param controller - `index.tsx` 造好的共享控制器。
 * @returns 快照；没有控制器时 `undefined`。
 */
export function useAiReadiness(
  controller: AiReadinessController | undefined,
): AiReadinessSnapshot | undefined {
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? NOOP_SUBSCRIBE,
    controller?.snapshot ?? getEmptySnapshot,
    controller?.snapshot ?? getEmptySnapshot,
  );
  useEffect(() => {
    if (controller === undefined) return () => {};
    const release = controller.start();
    void controller.refresh();
    return release;
  }, [controller]);
  return controller === undefined ? undefined : snapshot;
}

/** 三态 + 检测中（界面只认这一个状态）。 */
type AiViewState = 'configured' | 'missing' | 'unknown' | 'checking';

/** 由快照算界面状态：`readiness` 缺席且没在检测 → 未知（不是「未接上」）。 */
function viewStateOf(readiness: AiReadiness | undefined, checking: boolean): AiViewState {
  if (readiness === undefined) return checking ? 'checking' : 'unknown';
  if (readiness.configured === true) return 'configured';
  if (readiness.configured === 'unknown') return 'unknown';
  return 'missing';
}

/** key 三态的中文（`'unknown'` 必须显示「未知」，不许写成「未配置」）。 */
function keyLabel(value: boolean | 'unknown'): string {
  if (value === true) return '已配置';
  if (value === false) return '未配置';
  return '未知';
}

/** 状态面的标题（逐字固定，测试与屏稿共用）。 */
const STATE_TITLE: Record<AiViewState, string> = {
  /**
   * 2026-11-02 改：原来是「已接上 AI」。
   * 这条判定只看路由清单（provider 有没有注册、密钥状态、默认模型指向哪），**从不真发一次请求**。
   * 实测撞过一次：界面说「已接上」，真去提炼时 AI 一句话都没回 ——
   * 用户照着「已接上」以为万事俱备，其实谁都没试过能不能调通。
   * 改成说事实：配置齐了。
   */
  configured: 'AI 配置齐了',
  missing: '未接上 AI',
  unknown: 'AI 状态未知',
  checking: '正在检测 AI …',
};

/** 状态面 / 门禁行共用的「去哪里」：有 handler 才是按钮，没有就只写路径。 */
function AiSettingsAction({
  onOpenSettings,
  showFallback = true,
}: {
  onOpenSettings?: () => void;
  /**
   * 没有 handler 时要不要写那句兜底路径。
   *
   * 2026-11-01 改：门禁行里 `reason.next` 已经在说「打开 DSH「设置 → 模型」给 X 填上密钥」，
   * 兜底那句又写「配置 provider 与默认模型」—— 同一件事两个说法并排出现，
   * 用户会以为要做两件事。所以调用方有 `next` 时把兜底关掉。
   */
  showFallback?: boolean;
}) {
  if (onOpenSettings === undefined) {
    if (!showFallback) return null;
    return (
      <p className="xs-ai__path" data-xuanshu-ai-path={AI_SETTINGS_PATH}>
        {`请打开 DSH「${AI_SETTINGS_PATH}」配置 provider 与默认模型。`}
      </p>
    );
  }
  return (
    <button type="button" className="xs-btn" data-xuanshu-action="open-ai-settings" onClick={onOpenSettings}>
      {`去「${AI_SETTINGS_PATH}」`}
    </button>
  );
}

/** 状态面（向导第 6 步的内容；`onFinish` / `onSkip` 给了才渲染对应按钮）。 */
export interface XsAiReadinessProps {
  readiness?: AiReadiness;
  /** 正在检测（`readiness` 还没出来）。 */
  checking?: boolean;
  onRetry?: () => void;
  /** 能真的打开设置时才给（没有就只显示路径文本）。 */
  onOpenSettings?: () => void;
  /** 已接上才出现（未接上时「完成」是假的）。 */
  onFinish?: () => void;
  /** 任何状态都能跳过（不把人卡在读不到里）。 */
  onSkip?: () => void;
}

/**
 * 「接上 AI」状态面。
 * @param props - 状态面数据与动作（全部受控）。
 * @returns 状态面节点。
 */
export function XsAiReadiness({
  readiness,
  checking = false,
  onRetry,
  onOpenSettings,
  onFinish,
  onSkip,
}: XsAiReadinessProps) {
  const state = viewStateOf(readiness, checking);
  const title = STATE_TITLE[state];

  return (
    <section className="xs-ai" data-xuanshu-ai="readiness" data-xs-state={state}>
      <p className="xs-ai__status" data-xuanshu-ai-status={state}>{title}</p>

      {state === 'checking' ? (
        <p className="xs-ai__note">正在读路由清单（只读检测，不写任何配置）。</p>
      ) : (
        <>
          <p className="xs-ai__reason" data-xuanshu-ai-reason={readiness?.reason.code}>
            {readiness?.reason.text}
          </p>
          {readiness?.reason.next === undefined ? null : (
            <p className="xs-ai__next">{readiness.reason.next}</p>
          )}
          {state === 'unknown' && readiness?.detail !== undefined ? (
            <p className="xs-ai__detail" data-xuanshu-ai-detail="unavailable">{readiness.detail}</p>
          ) : null}

          <p className="xs-ai__default" data-xuanshu-ai-default={readiness?.defaultModel === null || readiness?.defaultModel === undefined ? 'none' : 'set'}>
            {readiness?.defaultModel === null || readiness?.defaultModel === undefined
              ? '默认模型：未定'
              : `默认模型：${readiness.defaultModel.provider} · ${readiness.defaultModel.model}`}
          </p>

          <ul className="xs-ai__providers" data-xuanshu-ai-providers={String(readiness?.providers.length ?? 0)}>
            {(readiness?.providers ?? []).map((provider) => (
              <li
                key={provider.id}
                className="xs-ai__provider"
                data-xuanshu-ai-provider={provider.id}
                data-xs-key={String(provider.keyConfigured)}
                data-xs-usable={provider.usable ? 'true' : undefined}
              >
                <span className="xs-ai__provider-name">{provider.name ?? provider.id}</span>
                {provider.name === null ? null : <small className="xs-ai__provider-id">{provider.id}</small>}
                <span className="xs-ai__provider-key" data-xs-key-label={String(provider.keyConfigured)}>
                  {`密钥：${keyLabel(provider.keyConfigured)}`}
                </span>
                <span className="xs-ai__provider-models">
                  {provider.modelsKnown ? `${String(provider.modelCount)} 个模型` : '模型清单读不到'}
                </span>
                {provider.isDefaultProvider ? <span className="xs-ai__badge">默认</span> : null}
              </li>
            ))}
          </ul>
          {(readiness?.providers.length ?? 0) === 0 ? (
            <p className="xs-ai__note" data-xuanshu-ai-providers-empty="true">一家 provider 都还没有。</p>
          ) : null}
        </>
      )}

      <div className="xs-ai__actions">
        {onRetry === undefined ? null : (
          <button type="button" className="xs-btn" data-xuanshu-action="retry-ai" onClick={onRetry}>
            重试
          </button>
        )}
        {/*
          2026-11-02 修：原来这里没传 `showFallback`，默认 true —— 于是**已经接上 AI** 时，
          向导第 6 步仍然顶着「已接上 AI · 可以问事了」的标题，底下又写「请打开 DSH「设置 → 模型」
          配置 provider 与默认模型。」，旁边还杵着一个「重试」。用户读到的是两句互相打脸的话。
          门禁组件（`XsAiGate`）一直是按 `readiness.reason.next` 判断的，这里照同一套：
          只有未接上（或没有下一步指引）时才显示那句配置路径。
        */}
        <AiSettingsAction
          {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
          showFallback={state !== 'configured'}
        />
        {onFinish === undefined || state !== 'configured' ? null : (
          <button type="button" className="xs-btn xs-btn--primary" data-xuanshu-action="finish-ai" onClick={onFinish}>
            {'完成，回总览 ->'}
          </button>
        )}
        {onSkip === undefined ? null : (
          <button type="button" className="xs-btn" data-xuanshu-action="skip-ai" onClick={onSkip}>
            跳过
          </button>
        )}
      </div>

      <p className="xs-ai__note" data-xuanshu-ai-note="readonly">
        检测只读：玄枢只读路由清单，不写 provider 配置与密钥。
      </p>
    </section>
  );
}

/** 问事入口旁的门禁行（总览快捷入口卡）。 */
export interface XsAiGateProps {
  readiness?: AiReadiness;
  checking?: boolean;
  onRetry?: () => void;
  onOpenSettings?: () => void;
}

/**
 * 门禁行：已接上返回 `null`（不占屏）；未接上 / 未知都写清原因与去向。
 * @param props - 状态与动作。
 * @returns 门禁节点或 `null`。
 */
export function XsAiGate({ readiness, checking = false, onRetry, onOpenSettings }: XsAiGateProps) {
  const state = viewStateOf(readiness, checking);
  if (state === 'configured') return null;

  return (
    <div className="xs-ai-gate" data-xuanshu-ai-gate={state} data-xuanshu-ai-reason={readiness?.reason.code}>
      <p className="xs-ai-gate__reason">
        {state === 'checking' ? '正在检测 AI 状态…' : `${state === 'unknown' ? 'AI 状态未知：' : '问事还开不了：'}${readiness?.reason.text ?? ''}`}
      </p>
      {state === 'checking' ? null : (
        <p className="xs-ai-gate__next">{readiness?.reason.next}</p>
      )}
      <div className="xs-ai-gate__actions">
        {onRetry === undefined ? null : (
          <button type="button" className="xs-btn" data-xuanshu-action="retry-ai" onClick={onRetry}>
            重试
          </button>
        )}
        {state === 'checking' ? null : (
          <AiSettingsAction
            {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
            showFallback={(readiness?.reason.next ?? '') === ''}
          />
        )}
      </div>
    </div>
  );
}
