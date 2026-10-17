/**
 * #24 · 触达的两项设置行（`settings.general.item`，先例 `bestof.tsx:100-102`）：
 *   - **AI 建议段**（`rikke.settings.*` → `<dataDir>/rikke-settings.json`）：关掉后日课只留确定性骨架；
 *   - **通知摘要**（`traffic.settings.*` → 共享的 `<dataDir>/shell-settings.json`）：打开后系统通知
 *     才带一句泛化短句（默认只有「今日日课已生成」，锁屏不露内容）。
 *
 * 两项都**不**在这里发明默认值：默认值由宿主决定（文件缺失 = AI 开 / 摘要关）。设置行只做两件事
 * ——把宿主的当前值显示出来、把人的点击写回去；写失败就把原因显示在行上（写操作不许静默）。
 *
 * 装配纪律：`installTouchSettings` 只注册一行；apply 期**不发请求**（取数在组件挂载后的 effect 里）。
 */
import { useEffect, useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';

import type { NotifyApi, TrafficStatus } from './notify-api.js';
import type { RikkeApi } from './rikke-api.js';

/** 设置行的槽位 id（`settings.general.item` 由 ui-settings-general 声明；不在场时不抛）。 */
export const TOUCH_SETTINGS_ID = 'xuanshu.touch';

/** 投递状态的人话（#25 契约 §3：成功 / 失败 / 跳过 + 原因 + 时间 + 是否补，都能查）。 */
export const TRAFFIC_STATUS_TEXT = {
  delivered: '成功',
  failed: '失败',
  skipped: '跳过',
} as const;

/**
 * 投递历史（只读账本投影；#25 契约 §3「设置里能看到投递历史」）。
 *
 * 一行一次投递尝试：`日期 · 哪一类（日课/晚省）· 状态 · 原因 · 是否补`。
 * 账本读不到时**不编空表**：由宿主 `DeliveryHistoryHost` 把理由显示出来。
 */
export function XsDeliveryHistory({ status }: { status: TrafficStatus }) {
  const entries = Array.isArray(status.entries) ? status.entries : [];
  return (
    <section className="xs-touch__history" data-xuanshu-history="traffic">
      <h2 className="xs-touch__history-title">投递历史</h2>
      {status.lastFailure === undefined ? null : (
        <p className="xs-touch__note" role="alert" data-xuanshu-history-error="last-failure">
          {`最近一次失败：${status.lastFailure.kind === 'wansheng' ? '晚省' : '日课'} · ${status.lastFailure.reason ?? '（没有给理由）'}`}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="xs-touch__note" data-xuanshu-history-empty="true">
          还没有投递记录。
        </p>
      ) : (
        <ul className="xs-touch__history-list">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="xs-touch__history-row"
              data-xuanshu-history-row={entry.notify.status}
              data-xuanshu-history-kind={entry.kind ?? ''}
              data-xuanshu-history-missed={entry.missed === true ? 'true' : undefined}
            >
              <span className="xs-touch__history-when">{entry.at ?? entry.date ?? '时间未回传'}</span>
              <span className="xs-touch__history-kind">{entry.kind === 'wansheng' ? '晚省' : entry.kind === 'rikke' ? '日课' : (entry.kind ?? '未知')}</span>
              <span className="xs-touch__history-status">{TRAFFIC_STATUS_TEXT[entry.notify.status] ?? entry.notify.status}</span>
              {entry.missed === true ? <span className="xs-touch__history-missed" data-xuanshu-badge="missed">补</span> : null}
              {entry.notify.reason === undefined || entry.notify.reason === null ? null : (
                <span className="xs-touch__history-reason">{entry.notify.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 投递历史的取数壳（挂载后读一次 `traffic.status({limit:50})`；只读，不写）。
 * 读不出来就显示可读原因（设置面同样「不许静默」）。
 */
export function DeliveryHistoryHost({ notify, preloaded }: { notify?: NotifyApi; preloaded?: TrafficStatus }) {
  const [status, setStatus] = useState<TrafficStatus | undefined>(preloaded);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (preloaded !== undefined || notify === undefined) return;
    let alive = true;
    void notify
      .status({ limit: 50 })
      .then((answer) => {
        if (alive) setStatus(answer);
      })
      .catch((reason: unknown) => {
        if (alive) setError(`读不到投递历史：${reason instanceof Error ? reason.message : String(reason)}`);
      });
    return () => {
      alive = false;
    };
  }, [notify, preloaded]);

  if (error !== undefined) {
    return (
      <p className="xs-touch__note" role="alert" data-xuanshu-history-error="read">
        {error}
      </p>
    );
  }
  if (status === undefined) return null;
  return <XsDeliveryHistory status={status} />;
}

/** 两项开关的当前值。 */
export interface TouchSettingsState {
  aiEnabled: boolean;
  notifySummary: boolean;
}

/** 两项开关的人点动作。 */
export interface TouchSettingsActions {
  onToggleAi(enabled: boolean): void;
  onToggleSummary(enabled: boolean): void;
}

/**
 * 设置行（静态可渲染；不带任何取数逻辑）。
 * @param props - 当前值与两个 onChange。
 * @returns 一行两开关的节点。
 */
export function XsTouchSettingsRow({ state, actions }: { state: TouchSettingsState; actions: TouchSettingsActions }) {
  return (
    <div className="xs-touch__settings" data-xs-touch="settings">
      <div className="xs-touch__row" data-xuanshu-setting="ai">
        <div>
          <strong>AI 建议段</strong>
          <p className="xs-touch__note">
            日课由「黄历三键（永远有）」+「一段 AI 写的今天注意什么」两段组成。关掉后只留确定性骨架，
            不再调用 LLM（失败也只是没有那一段，不影响日课本身）。
          </p>
        </div>
        <label>
          <input
            type="checkbox"
            checked={state.aiEnabled}
            onChange={(event) => actions.onToggleAi((event.target as HTMLInputElement).checked)}
          />
          <span className="xs-touch__note">{state.aiEnabled ? '开' : '关'}</span>
        </label>
      </div>
      <div className="xs-touch__row" data-xuanshu-setting="notify-summary">
        <div>
          <strong>通知摘要</strong>
          <p className="xs-touch__note">
            默认系统通知只说「今日日课已生成」，不在锁屏上露内容。打开后带一句泛化短句
            （仍不含宜忌 / 流日 / AI 建议的具体内容）。
          </p>
        </div>
        <label>
          <input
            type="checkbox"
            checked={state.notifySummary}
            onChange={(event) => actions.onToggleSummary((event.target as HTMLInputElement).checked)}
          />
          <span className="xs-touch__note">{state.notifySummary ? '开' : '关'}</span>
        </label>
      </div>
    </div>
  );
}

/**
 * 设置行的宿主组件：挂载后读一次两项设置的当前值，点击时写回。
 *
 * 写失败 → 行上显示原因，并把开关恢复成宿主给的值（下一次读回来仍以宿主为准）。
 */
export function TouchSettingsHost({ rikke, notify }: { rikke: RikkeApi; notify: NotifyApi }) {
  const [state, setState] = useState<TouchSettingsState | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void Promise.all([rikke.getSettings(), notify.getSettings()])
      .then(([rikkeSettings, notifySettings]) => {
        if (!alive) return;
        setState({ aiEnabled: rikkeSettings.aiEnabled, notifySummary: notifySettings.notifySummary });
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        // 读不出来就不显示一个猜的值；理由必须看得见（设置面同样是「不许静默」）。
        setError(`读不到设置：${reason instanceof Error ? reason.message : String(reason)}`);
      });
    return () => {
      alive = false;
    };
  }, [rikke, notify]);

  if (state === undefined) {
    return error === undefined
      ? null
      : <p className="xs-touch__note" role="alert" data-xuanshu-setting-error="read">{error}</p>;
  }

  return (
    <>
      <XsTouchSettingsRow
        state={state}
        actions={{
          onToggleAi: (enabled) => {
            setState({ ...state, aiEnabled: enabled });
            setError(undefined);
            void rikke.setSettings({ aiEnabled: enabled }).catch((reason: unknown) => {
              setState({ ...state, aiEnabled: !enabled });
              setError(`AI 段开关没写成：${reason instanceof Error ? reason.message : String(reason)}`);
            });
          },
          onToggleSummary: (enabled) => {
            setState({ ...state, notifySummary: enabled });
            setError(undefined);
            void notify.setSettings({ notifySummary: enabled }).catch((reason: unknown) => {
              setState({ ...state, notifySummary: !enabled });
              setError(`通知摘要开关没写成：${reason instanceof Error ? reason.message : String(reason)}`);
            });
          },
        }}
      />
      {error === undefined ? null : (
        <p className="xs-touch__note" role="alert" data-xuanshu-setting-error="write">{error}</p>
      )}
      {/* #25 契约 §3：设置里能看到投递历史（成功 / 失败 / 跳过 + 原因 + 时间 + 是否补）。 */}
      <DeliveryHistoryHost notify={notify} />
    </>
  );
}

/** 设置行安装所需的依赖（两个数据面都由 `index.tsx` 造好）。 */
export interface TouchSettingsInstallDeps {
  rikke: RikkeApi;
  notify: NotifyApi;
}

/**
 * 注册设置里的一行（**纯加性**：不新增 main key、不新增侧栏行、不动 apply 期请求）。
 * @param ctx - 客户端上下文（需 `slots`）。
 * @param deps - 两个数据面。
 */
export function installTouchSettings(ctx: Context, deps: TouchSettingsInstallDeps): void {
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register(
      { name: 'settings.general.item', id: TOUCH_SETTINGS_ID, order: 70, inject: () => deps },
      TouchSettingsHost as never,
    ),
  );
}
