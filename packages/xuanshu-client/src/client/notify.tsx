/**
 * #24 · 触达的四项设置行（`settings.general.item`，先例 `bestof.tsx:100-102`）：
 *   - **AI 建议段**（`rikke.settings.*` → `<dataDir>/rikke-settings.json`）：关掉后日课只留确定性骨架；
 *   - **通知摘要**（`traffic.settings.*` → 共享的 `<dataDir>/shell-settings.json`）：打开后系统通知
 *     才带一句泛化短句（默认只有「今日日课已生成」，锁屏不露内容）；
 *   - P1（复核 #23）· **关窗口行为 / 开机自启**（`shell.settings.*` → 同一份共享设置）：两个开关
 *     写进设置文件，壳 `fs.watch` 重读即生效；行下另有一句**实际生效方式**（登录项 / 启动文件夹
 *     快捷方式 / 不支持），它来自壳写的 `runtime/shell-status.json`，不是设置里的「想要」。
 *
 * 四项都**不**在这里发明默认值：默认值由宿主决定（文件缺失 = AI 开 / 摘要关 / 关窗隐藏 / 自启关）。
 * 设置行只做两件事 —— 把宿主的当前值显示出来、把人的点击写回去；写失败就把原因显示在行上
 * （写操作不许静默）。读不到壳设置时那两行**禁用**并给理由，不拿默认值冒充当前值。
 *
 * 装配纪律：`installTouchSettings` 只注册一行；apply 期**不发请求**（取数在组件挂载后的 effect 里）。
 */
import { useEffect, useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';

import type {
  AutostartMethod, NotifyApi, ShellEffective, ShellSettingsAnswer, TrafficStatus,
} from './notify-api.js';
import { SHELL_SETTINGS_ENDPOINTS } from './notify-api.js';
import type { RikkeApi } from './rikke-api.js';

/** 设置行的槽位 id（`settings.general.item` 由 ui-settings-general 声明；不在场时不抛）。 */
export const TOUCH_SETTINGS_ID = 'xuanshu.touch';

/** P1（复核 #23）：壳那半边的两个方法名（与宿主 `notify/service.mjs` 逐字对齐）。 */
export { SHELL_SETTINGS_ENDPOINTS };

/** 开机自启实际生效方式 → 人话（唯一一份；托盘与设置页同源）。 */
export const AUTOSTART_METHOD_TEXT: Record<AutostartMethod, string> = {
  'login-item': '登录项',
  shortcut: '启动文件夹快捷方式',
  unsupported: '不支持（本平台无法注册）',
};

/**
 * 自启方式的人话；`undefined` = **未知**（壳没在跑 / 读不到状态），不是「没开」。
 * @param method - 宿主回的 `effective.autostart.method`
 */
export function autostartMethodText(method?: AutostartMethod): string {
  if (method === undefined) return '未知（桌面壳未运行）';
  return AUTOSTART_METHOD_TEXT[method] ?? '未知（桌面壳未运行）';
}

/** 投递状态的人话（#25 契约 §3：成功 / 失败 / 跳过 + 原因 + 时间 + 是否补，都能查）。 */
export const TRAFFIC_STATUS_TEXT = {
  delivered: '成功',
  failed: '失败',
  skipped: '跳过',
} as const;

/** 通知失败里最常被壳侧英文 token 挡住的那几种原因（#40）。 */
export interface NotifyFailureLike {
  reason?: string | null;
  reasonCode?: string;
}

/**
 * #40：已知的壳侧失败 token → **人话 + 去哪开**（与宿主 `notify/reason.mjs` 同一份文案，
 * 跨包没有可共享的运行时模块，两边各留一份、逐字对齐）。
 */
export const NOTIFY_FAILURE_TEXT: Record<string, string> = {
  'permission-denied': '权限缺失：系统通知权限被关。请到「系统设置 → 通知 → 玄枢」里打开通知权限，然后再生成一次。',
  unsupported: '系统通知不可用：这台系统 / 环境不支持系统通知。',
  failed: '桌面壳没有弹出通知（壳没给细节）。',
};

/** 失败 token 在 reason 尾部（老账行没有 `reasonCode` 时按它认，`桌面壳没有弹出通知：permission-denied` 也认）。 */
const SHELL_REASON_TOKEN = /(permission-denied|unsupported|failed)\s*$/u;

/**
 * 已知壳侧失败原因的机器码：优先账里记下的 `reasonCode`，老账行再从 reason 尾部认 token。
 * @param notify - 账行 / status 投影里的 notify 对象
 * @returns 机器码；不是已知壳侧原因时 `undefined`（其他失败原因照旧逐字展示）
 */
export function notifyReasonCode(notify?: NotifyFailureLike): string | undefined {
  const explicit = typeof notify?.reasonCode === 'string' && notify.reasonCode !== '' ? notify.reasonCode : undefined;
  if (explicit !== undefined) return explicit;
  const reason = typeof notify?.reason === 'string' ? notify.reason : '';
  const match = SHELL_REASON_TOKEN.exec(reason);
  return match === null ? undefined : match[1];
}

/**
 * 失败原因的人话（#40）：已知 token → 中文并指路；其余 reason **原样返回**（不抹平、可排查）。
 * @param notify - 账行 / status 投影里的 notify 对象
 * @returns 可直接渲染的一句话
 */
export function notifyFailureText(notify?: NotifyFailureLike): string {
  const code = notifyReasonCode(notify);
  if (code !== undefined && NOTIFY_FAILURE_TEXT[code] !== undefined) return NOTIFY_FAILURE_TEXT[code];
  const reason = typeof notify?.reason === 'string' && notify.reason !== '' ? notify.reason : '';
  return reason === '' ? '（没有给理由）' : reason;
}

/**
 * 投递历史（只读账本投影；#25 契约 §3「设置里能看到投递历史」）。
 *
 * 一行一次投递尝试：`日期 · 哪一类（日课/晚省）· 状态 · 原因 · 是否补`。
 * 账本读面是三态的：`unread` 缺席 = **未知**（账存在但读不出来），此时写「未读数未知」
 * 且不谎称空历史；`unread: 0` 是已知的真话（合法空账），与「未知」必须可区分。
 */
export function XsDeliveryHistory({ status }: { status: TrafficStatus }) {
  const entries = Array.isArray(status.entries) ? status.entries : [];
  // 宿主只在账本**可读**时给 `unread`；缺席不是 0，是「读不出来」。
  const unread = typeof status.unread === 'number' ? status.unread : undefined;
  return (
    <section className="xs-touch__history" data-xuanshu-history="traffic">
      <h2 className="xs-touch__history-title">投递历史</h2>
      {unread === undefined ? (
        <p className="xs-touch__note" role="note" data-xuanshu-note="unread-unknown">
          未读数未知（触达账存在但读不出来，不按 0 算）
        </p>
      ) : (
        <p className="xs-touch__note" data-xuanshu-note="unread">{`未读 ${unread} 条`}</p>
      )}
      {status.lastFailure === undefined ? null : (
        <p
          className="xs-touch__note"
          role="alert"
          data-xuanshu-history-error="last-failure"
          data-xuanshu-reason-code={notifyReasonCode(status.lastFailure)}
        >
          {`最近一次失败：${status.lastFailure.kind === 'wansheng' ? '晚省' : '日课'} · ${notifyFailureText(status.lastFailure)}`}
        </p>
      )}
      {entries.length === 0 ? (
        unread === undefined ? (
          <p className="xs-touch__note" data-xuanshu-history-empty="unknown">
            投递历史也读不出来（不是「没有记录」）。
          </p>
        ) : (
          <p className="xs-touch__note" data-xuanshu-history-empty="true">
            还没有投递记录。
          </p>
        )
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
                <span
                  className="xs-touch__history-reason"
                  data-xuanshu-reason-code={notifyReasonCode(entry.notify)}
                >
                  {notifyFailureText(entry.notify)}
                </span>
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

/** 壳那两行的当前值（`shell` 缺席 = 这次读不到，不许拿默认值冒充）。 */
export interface ShellSettingsState {
  closeBehavior: 'hide' | 'quit';
  autostart: boolean;
  /** 实际生效状态（壳在跑才有）；缺席 = 未知。 */
  effective?: ShellEffective;
}

/** 四项开关的当前值。 */
export interface TouchSettingsState {
  aiEnabled: boolean;
  notifySummary: boolean;
  /** P1：关窗行为 / 开机自启（+ 实际生效方式）。 */
  shell?: ShellSettingsState;
  /** P1：读不到壳设置时的可读理由（那两行禁用，其余照常）。 */
  shellError?: string;
}

/** 四项开关的人点动作。 */
export interface TouchSettingsActions {
  onToggleAi(enabled: boolean): void;
  onToggleSummary(enabled: boolean): void;
  /** 传 `true` = 关窗即退出，`false` = 收进托盘（默认）。 */
  onToggleCloseBehavior(quit: boolean): void;
  onToggleAutostart(enabled: boolean): void;
}

/**
 * P1（复核 #23）：写壳设置（`closeBehavior` / `autostart`）的**唯一**写路径。
 *
 * 成功把宿主**回读后的答案**交给 `onChanged`（含 `effective`）；失败把可读理由交给 `onError`
 * 且**不外抛**（设置行不该把界面打挂）。两条都由调用方决定回滚 / 显示。
 *
 * @param options - 数据面与两个回调。
 */
export function createShellSettingsWriter({
  api,
  onChanged,
  onError,
}: {
  api: Pick<NotifyApi, 'setShellSettings'>;
  onChanged?: (answer: ShellSettingsAnswer) => void;
  onError?: (message: string) => void;
}): (patch: { closeBehavior?: 'hide' | 'quit'; autostart?: boolean }) => Promise<ShellSettingsAnswer | undefined> {
  return async (patch) => {
    try {
      const answer = await api.setShellSettings(patch);
      onChanged?.(answer);
      return answer;
    } catch (reason: unknown) {
      onError?.(`设置没写成：${reason instanceof Error ? reason.message : String(reason)}`);
      return undefined;
    }
  };
}

/**
 * 设置行（静态可渲染；不带任何取数逻辑）。
 * @param props - 当前值与 onChange。
 * @returns 四行开关的节点。
 */
export function XsTouchSettingsRow({ state, actions }: { state: TouchSettingsState; actions: TouchSettingsActions }) {
  const shell = state.shell;
  const shellKnown = shell !== undefined;
  const effective = shell?.effective;
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

      {/* P1（复核 #23）：关窗行为 / 开机自启 —— 写的是共享设置文件，壳下次重读即生效。 */}
      {state.shellError === undefined ? null : (
        <p className="xs-touch__note" role="alert" data-xuanshu-setting-error="shell">
          {state.shellError}
        </p>
      )}
      <div className="xs-touch__row" data-xuanshu-setting="close-behavior">
        <div>
          <strong>关窗口行为</strong>
          <p className="xs-touch__note">
            勾上 = 点 × 直接退出（先停 DSH 子进程再退壳）；不勾 = 收进托盘继续跑，日课与晚省仍会到点。
            这个开关写进共享设置，壳下次重读即生效。
          </p>
        </div>
        <label>
          <input
            type="checkbox"
            checked={shellKnown && shell.closeBehavior === 'quit'}
            disabled={!shellKnown}
            onChange={(event) => actions.onToggleCloseBehavior((event.target as HTMLInputElement).checked)}
          />
          <span className="xs-touch__note">
            {shellKnown ? (shell.closeBehavior === 'quit' ? '关窗即退出' : '收进托盘') : '未知'}
          </span>
        </label>
      </div>
      <div className="xs-touch__row" data-xuanshu-setting="autostart">
        <div>
          <strong>开机自启</strong>
          <p className="xs-touch__note">
            登录项优先，其次启动文件夹快捷方式；两条路都不可用时如实显示「不支持」。
            下面那行显示的是**这台机器上实际生效**的方式，不是这里勾的值。
          </p>
        </div>
        <label>
          <input
            type="checkbox"
            checked={shellKnown && shell.autostart === true}
            disabled={!shellKnown}
            onChange={(event) => actions.onToggleAutostart((event.target as HTMLInputElement).checked)}
          />
          <span className="xs-touch__note">{shellKnown ? (shell.autostart ? '开' : '关') : '未知'}</span>
        </label>
      </div>
      <p
        className="xs-touch__note"
        data-xuanshu-effective="autostart"
        data-xuanshu-effective-known={effective === undefined ? 'false' : 'true'}
      >
        {effective === undefined
          ? '实际生效方式：未知（桌面壳未运行）—— 这里的开关会写进共享设置，下次桌面壳启动时生效。'
          : `实际生效：${autostartMethodText(effective.autostart.method)}（${effective.autostart.enabled ? '已开' : '已关'}）`
            + ` · 关窗：${effective.closeBehavior === 'quit' ? '退出' : '收进托盘'}`
            + `${effective.autostart.enabled === shell?.autostart ? '' : '（注意：设置里的开关与实际生效不一致，可能是系统启动项被拦下了）'}`}
      </p>
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
        // P1（复核 #23）：壳的三项单独读 —— 老宿主没有 `shell.settings.get` 时，
        // 上面两行仍然可用；失败只把壳那两行标成「读不到」，不拿默认值冒充当前值。
        void notify
          .getShellSettings()
          .then((answer) => {
            if (!alive) return;
            setState((previous) => previous === undefined
              ? previous
              : {
                ...previous,
                shell: {
                  closeBehavior: answer.settings.closeBehavior,
                  autostart: answer.settings.autostart === true,
                  ...(answer.effective === undefined ? {} : { effective: answer.effective }),
                },
              });
          })
          .catch((reason: unknown) => {
            if (!alive) return;
            setState((previous) => previous === undefined
              ? previous
              : { ...previous, shellError: `读不到壳设置：${reason instanceof Error ? reason.message : String(reason)}` });
          });
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

  /** P1：写壳设置；失败回滚成写之前的值（界面不显示一个没写进去的开关）。 */
  const writeShell = (patch: { closeBehavior?: 'hide' | 'quit'; autostart?: boolean }): void => {
    const before = state.shell;
    const optimistic: ShellSettingsState | undefined = before === undefined
      ? before
      : {
        ...before,
        ...(patch.closeBehavior === undefined ? {} : { closeBehavior: patch.closeBehavior }),
        ...(patch.autostart === undefined ? {} : { autostart: patch.autostart }),
      };
    setState({ ...state, shell: optimistic, shellError: undefined });
    setError(undefined);
    void createShellSettingsWriter({
      api: notify,
      onChanged: (answer) => {
        setState((previous) => previous === undefined
          ? previous
          : {
            ...previous,
            shellError: undefined,
            shell: {
              closeBehavior: answer.settings.closeBehavior,
              autostart: answer.settings.autostart === true,
              ...(answer.effective === undefined ? {} : { effective: answer.effective }),
            },
          });
      },
      onError: (message) => {
        setState({ ...state, shell: before, shellError: undefined });
        setError(message);
      },
    })(patch);
  };

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
          onToggleCloseBehavior: (quit) => {
            writeShell({ closeBehavior: quit ? 'quit' : 'hide' });
          },
          onToggleAutostart: (enabled) => {
            writeShell({ autostart: enabled });
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
