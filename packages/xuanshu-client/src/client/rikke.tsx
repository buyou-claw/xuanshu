/**
 * 票 13 · 日课面板（main key `rikke`，S14 §2【A】的「看完整日课」）+ 加性注册。
 *
 * 三件界面事实（S14 §9 / §3）：
 *   1. **时间基准**：日期 + 生成时刻 + IANA 时区 + 「本机时钟」，并紧跟一句
 *      「不联网取外部资讯」——这条是口径，不是提示，**不可折叠**；
 *   2. **计划时刻 ≠ 生成时刻**：`schedule.time` 是那条 daily 任务的计划时刻（可由人改），
 *      `generatedAt` 是这一份内容的生成时刻；两个值分开显示，不合成一个数字；
 *   3. **生成只能由人点**：`[重新生成（今天）]` 必过一次轻确认（「将覆盖今天的日课，继续？」），
 *      本组件的 effect 只读 `rikke.status`，没有任何自动生成。
 *
 * 内容来源口径：宜 / 忌 / 流日由宿主半读底座 + 本地 horosa 黄历算出（玄枢**不自算干支**），
 * 本屏只展示 `rikke.status` 给的三键，并点到「黄历引擎出处（工具名 + 版本）」。
 * 契约缺字段时（`generatedAt` / `zone` / `huangli` 都是可选的）显示「未回传」，**不编一个值**。
 */
import { useEffect, useRef, useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';

import { EMPTY_COPY, clockOf } from './panel.js';
import { RIKKE_ID, RIKKE_LABEL, RIKKE_ORDER } from './panel.js';
import type { PanelNavTarget } from './panel.js';
import type { RikkeApi, RikkeStatus } from './rikke-api.js';
import { installRikkeStyle } from './rikke-style.js';
import type { RpcContext } from './rpc.js';

/** 不联网声明（S14 §9 附带说明：A ① 与 B 区同文案，不可折叠）。 */
export const RIKKE_NO_NETWORK_NOTE = '不联网取外部资讯：本次内容只用底座 + 上面的时间基准。';

/** 重新生成的人工闸门文案（S14 §5 第 3 步逐字）。 */
export const RIKKE_REGENERATE_CONFIRM = '将覆盖今天的日课，继续？';

/** 面板的四态（`running` 由 `busy` 表达：内容保持可读，按钮转进行中文案）。 */
type RikkeView =
  | { kind: 'loading' }
  | { kind: 'empty'; status: RikkeStatus }
  | { kind: 'ready'; status: RikkeStatus }
  | { kind: 'error'; message: string; status?: RikkeStatus };

/** 静态预置（测试 / SSR：给了就不取数；`error` 形状直接落错误态）。 */
export type RikkePreloaded = RikkeStatus | { error: string };

export interface RikkePanelProps {
  /** 日课数据面（`index.tsx` 用 `createRikkeApi(ctx)` 造好注入）。 */
  api: RikkeApi;
  /** 面板导航（`[打开自动化任务面板]` → DSH 的 `schedules`）。 */
  navigate: (target: PanelNavTarget) => void;
  /** 静态预置（测试 / SSR：给了就不发 `rikke.status`）。 */
  preloaded?: RikkePreloaded;
  /** 静态预置「改时刻」编辑器已展开（静态渲染点不了按钮）。 */
  preloadedTimeEdit?: boolean;
}

/** 错误摘要（RPC 拒绝的 message 原样展示，不吞掉）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 由静态预置推初始视图。 */
function initialView(preloaded: RikkePreloaded | undefined): RikkeView {
  if (preloaded === undefined) return { kind: 'loading' };
  if ('error' in preloaded) return { kind: 'error', message: preloaded.error };
  if (preloaded.exists !== true) return { kind: 'empty', status: preloaded };
  if (preloaded.content === undefined) {
    // 「exists 但没有 content」是宿主侧的形状违约：按失败处理，不假装今天有内容。
    return { kind: 'error', message: '当日日课文件在，但内容没读回来（content 缺失）。', status: preloaded };
  }
  return { kind: 'ready', status: preloaded };
}

/**
 * 日课面板。
 * @param props - 数据面、导航与静态预置。
 * @returns 日课面板节点。
 */
export function RikkePanel({ api, navigate, preloaded, preloadedTimeEdit }: RikkePanelProps) {
  const seeded = preloaded !== undefined;
  const [view, setView] = useState<RikkeView>(() => initialView(preloaded));
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(preloadedTimeEdit === true);
  const [timeDraft, setTimeDraft] = useState<string>(() =>
    clockOf(preloaded !== undefined && !('error' in preloaded) ? preloaded.schedule?.time : undefined),
  );
  const [note, setNote] = useState<string | undefined>(undefined);
  const sequence = useRef(0);

  /** 只读取数：`rikke.status`（effect 里**只**允许这一件事）。 */
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
    // `load` 是每渲染重建的闭包；依赖只留数据面与预置标记（与 MingpanPanel / DigaoPanel 同法）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, seeded]);

  /** 人点 `[继续生成]`：**唯一**调用 `rikke.generate` 的地方。 */
  const generate = (): void => {
    setConfirming(false);
    setBusy(true);
    setNote(undefined);
    const mine = ++sequence.current;
    void api
      .generate()
      .then(async (answer) => {
        if (mine !== sequence.current) return;
        if (answer?.ok !== true) {
          // 底座未立 / 推运失败：理由必须可见（契约 §2 不许静默）。
          setView({
            kind: 'error',
            message: answer?.reason ?? '日课生成失败：宿主没有给出理由。',
            ...(view.kind === 'ready' ? { status: view.status } : {}),
          });
          return;
        }
        const status = await api.status();
        if (mine !== sequence.current) return;
        setView(initialView(status));
        setTimeDraft(clockOf(status.schedule?.time));
      })
      .catch((error: unknown) => {
        if (mine !== sequence.current) return;
        setView({ kind: 'error', message: errorText(error) });
      })
      .finally(() => {
        if (mine === sequence.current) setBusy(false);
      });
  };

  /** 人点 `[保存]`：改的是**播种出去的那条任务**（`ctx.schedule.update`，宿主侧 compare-and-update）。 */
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

  const status = view.kind === 'empty' || view.kind === 'ready' ? view.status : view.kind === 'error' ? view.status : undefined;
  const date = status?.date ?? '—';
  const schedule = status?.schedule;
  const content = status?.content;
  const openGenerate = view.kind === 'empty' ? '立即生成（今天）' : '重新生成（今天）';

  return (
    <main className="xs-rikke" data-xuanshu-panel={RIKKE_ID}>
      <header className="xs-rikke__head">
        <h1>{`日课 · ${date}`}</h1>
        <span className="xs-rikke__note" data-xuanshu-state={view.kind}>
          {view.kind === 'ready' ? '今日日课已到' : view.kind === 'empty' ? '今天还没有生成日课' : view.kind === 'error' ? '生成失败' : '读取中…'}
        </span>
      </header>

      {/* ① 时间基准（生成时使用）+ 不联网声明：都不可折叠。 */}
      <p className="xs-rikke__basis" data-xuanshu-note="time-basis">
        {`时间基准：${date} ${status?.generatedAt ?? '（生成时刻未回传）'} · ${status?.zone ?? '（时区未回传）'} · 本机时钟`}
      </p>
      <p className="xs-rikke__basis xs-rikke__no-network" data-xuanshu-note="no-network">
        {RIKKE_NO_NETWORK_NOTE}
      </p>
      <p className="xs-rikke__note" data-xuanshu-note="schedule">
        {schedule === undefined
          ? '计划时刻：宿主未回传（在「自动化任务」面板里看这条 daily 任务）'
          : `计划时刻：每天 ${clockOf(schedule.time)}（${schedule.timeZone}）· 可在「自动化任务」面板里改或停用`}
      </p>
      {status?.huangli === undefined ? null : (
        <p className="xs-rikke__note" data-xuanshu-note="engine">
          {`黄历引擎：${status.huangli.tool ?? 'huangli'} ${status.huangli.version ?? '（版本未回传）'}（本地，不联网）`}
        </p>
      )}
      {status?.generatedAt === undefined ? null : (
        <p className="xs-rikke__note" data-xuanshu-note="generated-at">
          {`生成于 ${status.generatedAt}`}
        </p>
      )}

      {view.kind === 'loading' ? (
        <p className="xs-rikke__note" data-xuanshu-view="loading">
          正在读今天的日课…
        </p>
      ) : null}

      {view.kind === 'empty' ? (
        <section className="xs-rikke__empty" data-xuanshu-view="empty">
          <p>{EMPTY_COPY.rike.why}</p>
          <p className="xs-rikke__note">{EMPTY_COPY.rike.sub}</p>
        </section>
      ) : null}

      {view.kind === 'error' ? (
        <section className="xs-rikke__alert" data-xuanshu-view="error" role="alert">
          <p data-xuanshu-reason="generate">{view.message}</p>
          <div className="xs-rikke__actions">
            <button
              type="button"
              data-xuanshu-action="retry"
              onClick={() => {
                load();
              }}
            >
              重试
            </button>
          </div>
        </section>
      ) : null}

      {content === undefined ? null : (
        <div className="xs-lines" data-xuanshu-content="rikke">
          <p className="xs-line">
            <span className="xs-line__label">宜</span>
            <span className="xs-line__value">{content.yi}</span>
          </p>
          <p className="xs-line">
            <span className="xs-line__label">忌</span>
            <span className="xs-line__value">{content.ji}</span>
          </p>
          <p className="xs-line">
            <span className="xs-line__label">流日</span>
            <span className="xs-line__value">{content.liuri}</span>
          </p>
        </div>
      )}

      {/* ④ 动作：重新生成（人点 + 轻确认）/ 改时刻 / 打开自动化任务面板。 */}
      <div className="xs-rikke__actions">
        <button
          type="button"
          className="xs-btn xs-btn--primary"
          data-xuanshu-action="generate-rikke"
          disabled={busy}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {busy ? '生成中…' : openGenerate}
        </button>
        <button
          type="button"
          data-xuanshu-action="edit-time"
          onClick={() => {
            setEditing(!editing);
          }}
        >
          改时刻
        </button>
        <button
          type="button"
          data-xuanshu-nav="schedules"
          onClick={() => {
            navigate('schedules');
          }}
        >
          打开自动化任务面板
        </button>
      </div>

      {note === undefined ? null : (
        <p className="xs-rikke__note" role="status" data-xuanshu-note="time-result">
          {note}
        </p>
      )}

      {/*
        人工闸门：未确认时整块 `hidden`（节点在、动作不在）——与 S2 的重录确认同法，
        不用 `window.confirm`（那样文案就不可断言）。
      */}
      <div className="xs-rikke__confirm" data-xuanshu-confirm="regenerate" hidden={!confirming}>
        <p data-xuanshu-confirm-text="regenerate">{RIKKE_REGENERATE_CONFIRM}</p>
        <div className="xs-rikke__actions">
          <button
            type="button"
            data-xuanshu-action="regenerate-cancel"
            onClick={() => {
              setConfirming(false);
            }}
          >
            取消
          </button>
          <button type="button" data-xuanshu-action="regenerate-go" onClick={generate}>
            {'继续生成 ->'}
          </button>
        </div>
      </div>

      {/* [改时刻] 的内联编辑：保存即调 rikke.setTime（宿主走 ctx.schedule.update）。 */}
      <div className="xs-rikke__time-edit" data-xuanshu-time-edit="rikke" hidden={!editing}>
        <label>
          日课时刻
          <input
            type="time"
            value={timeDraft}
            onChange={(event) => {
              setTimeDraft(event.target.value);
            }}
          />
        </label>
        <span className="xs-rikke__note">{`时区 ${schedule?.timeZone ?? '（未回传）'}（IANA，不手改）`}</span>
        <div className="xs-rikke__actions">
          <button type="button" data-xuanshu-action="save-time" disabled={busy} onClick={saveTime}>
            保存
          </button>
        </div>
      </div>
    </main>
  );
}

/** 侧栏行图标（单色线性，与 `DigaoIcon` / `MingpanIcon` 同族；S14 §10 的 icon 位）。 */
function RikkeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
      <path d="M8 14h4" />
    </svg>
  );
}

/** 日课面板安装所需的依赖（由 `index.tsx` 造好，与日课卡共用同一份数据面）。 */
export interface RikkeInstallDeps {
  api: RikkeApi;
  navigate: (target: PanelNavTarget) => void;
}

/**
 * 日课面板的**加性**注册（main key `rikke` + 侧栏行 `rikke`）。
 *
 * 两条纪律同 `installDigao`：**apply 期不调 `ctx.layout.selectPanel`**（默认面板 `overview`
 * 由根入口切且只切一次）、不新增运行期 `require`；非 DOM 环境下只有样式注入被守卫挡掉。
 *
 * @param ctx - 客户端上下文（需 `slots`）。
 * @param deps - 数据面与导航（与日课卡共用同一份数据面）。
 */
export function installRikke(ctx: Context & RpcContext, deps: RikkeInstallDeps): void {
  installRikkeStyle();
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      { name: 'main', key: RIKKE_ID, inject: () => ({ ...deps }) },
      RikkePanel as never,
    ),
  );
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: RIKKE_ID, order: RIKKE_ORDER, label: RIKKE_LABEL },
      RikkeIcon as never,
    ),
  );
}
