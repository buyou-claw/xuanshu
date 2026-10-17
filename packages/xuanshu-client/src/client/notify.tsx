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

import type { NotifyApi } from './notify-api.js';
import type { RikkeApi } from './rikke-api.js';

/** 设置行的槽位 id（`settings.general.item` 由 ui-settings-general 声明；不在场时不抛）。 */
export const TOUCH_SETTINGS_ID = 'xuanshu.touch';

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
