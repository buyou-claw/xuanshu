/**
 * #25 · 晚省面板（main key `wansheng`，侧栏 order 110）。
 *
 * 屏稿依据：spec 002 §触达（`:127`）+ 用户故事 14–15。
 * 这一屏只做三件事，且都不替用户下结论：
 *   1. **摆当天的事实**：今天几场问事（含标题）、哪些项目有活动、底稿/日课/事记何时动过；
 *      缺的项写「未知（宿主没回传）」——不把「拿不到」写成 0；
 *   2. **人点的两个动作**：`[立即生成]`（确定性事实，不调模型）与 `[改时刻]`（`wansheng.setTime`）；
 *   3. **投递历史**（折叠块）：读 `traffic.status({limit:50})`，成功/失败/跳过 + 原因 + 是否补。
 *
 * 「点开进问事」在卡上（`XsWanshengCard` 的 `[去问事 ->]`）；本面板给的是完整事实与历史。
 * 生成只由按钮的 onClick 触发；effect 里只读 `wansheng.status`（与 `rikke.tsx` 同一条纪律）。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Context } from '@deepseek-ai/cordis';

import { EMPTY_COPY, clockOf } from './panel.js';
import { WANSHENG_ID, WANSHENG_LABEL, WANSHENG_ORDER } from './panel.js';
import type { PanelNavTarget } from './panel.js';
import type { NotifyApi, TrafficStatus } from './notify-api.js';
import { DeliveryHistoryHost, notifyFailureText, notifyReasonCode } from './notify.js';
import type { RikkeNotify } from './rikke-api.js';
import { installRikkeStyle } from './rikke-style.js';
import type { WanshengApi, WanshengFacts, WanshengStatus, WanshengWorkspace } from './wansheng-api.js';
import type { RpcContext } from './rpc.js';

/** 面板的四态（`busy` 由按钮文案表达：内容保持可读）。 */
type WanshengView =
  | { kind: 'loading' }
  | { kind: 'empty'; status: WanshengStatus }
  | { kind: 'ready'; status: WanshengStatus }
  | { kind: 'error'; message: string; status?: WanshengStatus };

/** 静态预置（测试 / SSR：给了就不取数；`error` 形状直接落错误态）。 */
export type WanshengPreloaded = WanshengStatus | { error: string };

export interface WanshengPanelProps {
  /** 晚省数据面（`index.tsx` 用 `createWanshengApi(ctx)` 造好注入）。 */
  api: WanshengApi;
  /** 面板导航（`[打开自动化任务面板]` → DSH 的 `schedules`）。 */
  navigate: (target: PanelNavTarget) => void;
  /** 投递历史的数据面（缺 = 不渲染历史块）。 */
  notify?: NotifyApi;
  /** 静态预置（测试 / SSR：给了就不发 `wansheng.status`）。 */
  preloaded?: WanshengPreloaded;
  /** 静态预置的投递历史（测试 / SSR：给了就不发 `traffic.status`）。 */
  preloadedHistory?: TrafficStatus;
  /** 静态预置「改时刻」编辑器已展开。 */
  preloadedTimeEdit?: boolean;
}

/** 错误摘要（RPC 拒绝的 message 原样展示，不吞掉）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 由静态预置推初始视图。 */
function initialView(preloaded: WanshengPreloaded | undefined): WanshengView {
  if (preloaded === undefined) return { kind: 'loading' };
  if ('error' in preloaded) return { kind: 'error', message: preloaded.error };
  if (preloaded.exists !== true) return { kind: 'empty', status: preloaded };
  return { kind: 'ready', status: preloaded };
}

/** 未读 / 最近一次触达失败（沿用 #24 的 `unread` / `notify` 风格）。 */
function touchLines(status: WanshengStatus | undefined): ReactElement | null {
  const notify: RikkeNotify | undefined = status?.notify;
  if ((status?.unread ?? 0) === 0 && notify?.status !== 'failed') return null;
  return (
    <>
      {(status?.unread ?? 0) > 0 ? (
        <p className="xs-wansheng__note" data-xuanshu-note="unread">{`未读 ${status?.unread} 条晚省通知`}</p>
      ) : null}
      {notify?.status === 'failed' ? (
        <p
          className="xs-wansheng__alert"
          role="alert"
          data-xuanshu-notify="failed"
          data-xuanshu-reason-code={notifyReasonCode(notify)}
        >
          {`上一次通知没发出去：${notifyFailureText(notify)}`}
        </p>
      ) : null}
    </>
  );
}

/** 两路活动共用展示，数据缺席与已知空列表分别表述（空态两路同一句式，复核 A3）。 */
function ActivityList({ items, kind, label }: {
  items?: WanshengWorkspace[];
  kind: 'workspace' | 'workflow';
  label: string;
}) {
  return <>
    <p className="xs-wansheng__fact" data-xuanshu-fact={`${kind}s`}>
      {items === undefined ? `哪些${label}有活动：未知（宿主没回传）`
        : items.length === 0 ? `今天没有${label}活动`
          : `今天 ${items.length} 个${label}有活动`}
    </p>
    {items === undefined || items.length === 0 ? null : (
      <ul className="xs-wansheng__workspace-list">
        {items.map((item) => (
          <li key={item.id} {...(kind === 'workspace' ? { 'data-xuanshu-workspace': item.id } : { 'data-xuanshu-workflow': item.id })}>
            {`${item.title} · ${item.sessionCount} 场会话`}
            {item.lastActiveAt === undefined ? null : <span className="xs-wansheng__note">{` · 最后活跃 ${item.lastActiveAt}`}</span>}
          </li>
        ))}
      </ul>
    )}
  </>;
}

/** 事实区：拿不到的项写「未知」（不写 0 / false 冒充已知）。 */
function FactsSection({ facts }: { facts?: WanshengFacts }) {
  const sessions = facts?.consultSessions;
  return (
    <section className="xs-wansheng__facts" data-xuanshu-facts="wansheng">
      <h2>今天的事实</h2>
      <p className="xs-wansheng__fact" data-xuanshu-fact="consult">
        {sessions === undefined
          ? '今天几场问事：未知（宿主没回传）'
          : `今天 ${sessions.count} 场问事`}
      </p>
      {sessions === undefined || sessions.items.length === 0 ? null : (
        <ul className="xs-wansheng__consult-list">
          {sessions.items.map((item) => (
            <li key={item.sessionId} data-xuanshu-consult={item.sessionId}>
              {item.title}
              {item.lastTurnAt === undefined ? null : <span className="xs-wansheng__note">{` · 最后一句 ${item.lastTurnAt}`}</span>}
            </li>
          ))}
        </ul>
      )}
      <ActivityList items={facts?.activeWorkspaces} kind="workspace" label="项目" />
      <ActivityList items={facts?.activeWorkflows} kind="workflow" label="工作流" />
      {facts?.rikke?.generatedAt === undefined ? null : (
        <p className="xs-wansheng__fact" data-xuanshu-fact="rikke">{`日课：${facts.rikke.generatedAt} 生成`}</p>
      )}
      {facts?.digao?.generatedAt === undefined ? null : (
        <p className="xs-wansheng__fact" data-xuanshu-fact="digao">{`底稿：${facts.digao.generatedAt} 刷新过`}</p>
      )}
      {facts?.shiji?.updatedAt === undefined ? null : (
        <p className="xs-wansheng__fact" data-xuanshu-fact="shiji">{`事记：${facts.shiji.updatedAt} 有更新`}</p>
      )}
    </section>
  );
}

/**
 * 晚省面板。
 * @param props - 数据面、导航与静态预置。
 * @returns 晚省面板节点。
 */
export function WanshengPanel({
  api, navigate, notify, preloaded, preloadedHistory, preloadedTimeEdit,
}: WanshengPanelProps) {
  const seeded = preloaded !== undefined;
  const [view, setView] = useState<WanshengView>(() => initialView(preloaded));
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(preloadedTimeEdit === true);
  const [timeDraft, setTimeDraft] = useState<string>(() =>
    clockOf(preloaded !== undefined && !('error' in preloaded) ? preloaded.schedule?.time : undefined),
  );
  const [note, setNote] = useState<string | undefined>(undefined);
  const sequence = useRef(0);

  /** 只读取数：`wansheng.status`（effect 里**只**允许这一件事）。 */
  const load = (): void => {
    const mine = ++sequence.current;
    void api
      .status()
      .then((status) => {
        if (mine !== sequence.current) return;
        setView(initialView(status));
        setTimeDraft(clockOf(status.schedule?.time));
      })
      .catch((error: unknown) => {
        if (mine !== sequence.current) return;
        setView({ kind: 'error', message: errorText(error) });
      });
  };

  useEffect(() => {
    if (seeded) return; // 静态预置：不取数
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, seeded]);

  /** 人点 `[立即生成]`：确定性事实，不调模型；失败理由可见。 */
  const generate = (): void => {
    setBusy(true);
    setNote(undefined);
    const mine = ++sequence.current;
    void api
      .generate()
      .then(async (answer) => {
        if (mine !== sequence.current) return;
        if (answer?.ok !== true) {
          setView({ kind: 'error', message: answer?.reason ?? '晚省生成失败：宿主没有给出理由。' });
          return;
        }
        const status = await api.status();
        if (mine !== sequence.current) return;
        setView(initialView(status));
      })
      .catch((error: unknown) => {
        if (mine !== sequence.current) return;
        setView({ kind: 'error', message: errorText(error) });
      })
      .finally(() => {
        if (mine === sequence.current) setBusy(false);
      });
  };

  /** 人点 `[保存]`：改的是播种出去的那条任务（`wansheng.setTime`，宿主 compare-and-update）。 */
  const saveTime = (): void => {
    if (timeDraft === '') return;
    setBusy(true);
    setNote(undefined);
    void api
      .setTime({ time: timeDraft })
      .then((answer) => {
        setNote(`已改时刻：每天 ${clockOf(answer.schedule.time)}（${answer.schedule.timeZone}）`);
        setEditing(false);
      })
      .catch((error: unknown) => {
        setNote(`改时刻失败：${errorText(error)}`);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const status = view.kind === 'empty' || view.kind === 'ready'
    ? view.status
    : view.kind === 'error'
      ? view.status
      : undefined;
  const date = status?.date ?? '—';
  const schedule = status?.schedule;

  return (
    <main className="xs-wansheng" data-xuanshu-panel={WANSHENG_ID}>
      <header className="xs-wansheng__head">
        <h1>{`晚省 · ${date}`}</h1>
        {status?.missed === true ? <XsMissedMark /> : null}
        <span className="xs-wansheng__note" data-xuanshu-state={view.kind}>
          {view.kind === 'ready' ? '今天的晚省已到' : view.kind === 'empty' ? '今天还没有晚省' : view.kind === 'error' ? '读取失败' : '读取中…'}
        </span>
      </header>

      <p className="xs-wansheng__note" data-xuanshu-note="schedule">
        {schedule === undefined
          ? '计划时刻：宿主未回传（在「自动化任务」面板里看这条 daily 任务）'
          : `计划时刻：每天 ${clockOf(schedule.time)}（${schedule.timeZone}）· 可在「自动化任务」面板里改或停用`}
      </p>
      {status?.generatedAt === undefined ? null : (
        <p className="xs-wansheng__note" data-xuanshu-note="generated-at">{`生成于 ${status.generatedAt}`}</p>
      )}
      {status?.missed === true ? (
        <p className="xs-wansheng__note" data-xuanshu-note="missed">
          这是补生成的一份（过去的日期），不是今天的。
        </p>
      ) : null}

      {view.kind === 'loading' ? (
        <p className="xs-wansheng__note" data-xuanshu-view="loading">正在读今天的晚省…</p>
      ) : null}

      {view.kind === 'empty' ? (
        <section className="xs-wansheng__empty" data-xuanshu-view="empty">
          <p>{EMPTY_COPY.wansheng.why}</p>
          <p className="xs-wansheng__note">{EMPTY_COPY.wansheng.sub}</p>
        </section>
      ) : null}

      {view.kind === 'error' ? (
        <section className="xs-wansheng__alert" data-xuanshu-view="error" role="alert">
          <p data-xuanshu-reason="generate">{view.message}</p>
          <div className="xs-wansheng__actions">
            <button type="button" data-xuanshu-action="retry" onClick={load}>重试</button>
          </div>
        </section>
      ) : null}

      <FactsSection facts={status?.facts} />
      {touchLines(status)}

      <div className="xs-wansheng__actions">
        <button
          type="button"
          className="xs-btn xs-btn--primary"
          data-xuanshu-action="generate-wansheng"
          disabled={busy}
          onClick={generate}
        >
          {busy ? '生成中…' : '立即生成'}
        </button>
        <button type="button" data-xuanshu-action="edit-time" onClick={() => { setEditing(!editing); }}>改时刻</button>
        <button type="button" data-xuanshu-nav="schedules" onClick={() => { navigate('schedules'); }}>打开自动化任务面板</button>
        <button type="button" data-xuanshu-nav="consult" onClick={() => { navigate('consult'); }}>去问事</button>
      </div>

      {note === undefined ? null : (
        <p className="xs-wansheng__note" role="status" data-xuanshu-note="time-result">{note}</p>
      )}

      <div className="xs-wansheng__time-edit" data-xuanshu-time-edit="wansheng" hidden={!editing}>
        <label>
          晚省时刻
          <input
            type="time"
            value={timeDraft}
            onChange={(event) => { setTimeDraft(event.target.value); }}
          />
        </label>
        <span className="xs-wansheng__note">{`时区 ${schedule?.timeZone ?? '（未回传）'}（IANA，不手改）`}</span>
        <div className="xs-wansheng__actions">
          <button type="button" data-xuanshu-action="save-time" disabled={busy} onClick={saveTime}>保存</button>
        </div>
      </div>

      {/* 投递历史（#25 契约 §3/§4）：成功 / 失败 / 跳过 + 原因 + 时间 + 是否补。 */}
      <details className="xs-wansheng__history" data-xuanshu-history="wansheng">
        <summary>投递历史</summary>
        <DeliveryHistoryHost notify={notify} preloaded={preloadedHistory} />
      </details>
    </main>
  );
}

/** 面板里的「补」标记（与卡片徽标同文案、同 data 属性）。 */
function XsMissedMark() {
  return <span className="xs-badge xs-badge--missed" data-xuanshu-badge="missed">补</span>;
}

/** 侧栏行图标（单色线性，与 `RikkeIcon` / `DigaoIcon` 同族）。 */
function WanshengIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

/** 晚省面板安装所需的依赖（由 `index.tsx` 造好）。 */
export interface WanshengInstallDeps {
  api: WanshengApi;
  navigate: (target: PanelNavTarget) => void;
  notify?: NotifyApi;
}

/**
 * 晚省面板的**加性**注册（main key `wansheng` + 侧栏行 `wansheng`，order 110）。
 *
 * 两条纪律同 `installRikke`：apply 期不调 `ctx.layout.selectPanel`、不新增运行期 `require`；
 * 非 DOM 环境下只有样式注入被守卫挡掉（复用日课样式表，复用同一个视觉语言）。
 *
 * @param ctx - 客户端上下文（需 `slots`）。
 * @param deps - 数据面与导航。
 */
export function installWansheng(ctx: Context & RpcContext, deps: WanshengInstallDeps): void {
  installRikkeStyle();
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      { name: 'main', key: WANSHENG_ID, inject: () => ({ ...deps }) },
      WanshengPanel as never,
    ),
  );
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: WANSHENG_ID, order: WANSHENG_ORDER, label: WANSHENG_LABEL },
      WanshengIcon as never,
    ),
  );
}
