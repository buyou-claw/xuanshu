/**
 * 票 08 · 命盘卡详情（main key `mingpan`）+ 加性注册（S2；冻结契约 §6）。
 *
 * 这一屏是**只读**的（C1）：全屏零输入控件（`input` / `select` / `textarea` / `contenteditable` 计数为 0），
 * 唯一写操作是底部 `[重新录制出生信息]`，且**必过二次确认**（确认后才带预填草稿进向导）。
 * 写操作本身不在这里发生 —— 本屏不出盘、不写任何文件；它只把「要重录」这件事交给
 * `controller.requestRerecord(draft)`，由向导（main key `onboarding`）去走五步与澄清闸。
 *
 * 数据只读 `bazi.snapshot`（快照是唯一事实源，S2 §5.1：打开本屏**不产生新的出盘请求**）。
 * 出盘成功后由 `controller` 的代次变化驱动重取 —— 仍然是读快照，不是重出盘。
 *
 * 快照 schema 的边界（诚实标注）：`xuanshu/bazi-snapshot@1` 只存 `birth` / `pillars` / `basis` / `horosa`
 * 四项，S2 §9 里的**藏干 / 十神 / 大运 / 其它要点**不在其中，因此本屏不假装有它们，
 * 只给一行说明（扩 schema 属后续票）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Context } from '@deepseek-ai/cordis';

import type { BaziApi, BaziSnapshot } from './bazi-api.js';
import type { BaziUiController } from './bazi-controller.js';
import { installBaziStyle } from './bazi-style.js';
import { XsReadonlyBadge } from './cards.js';
import {
  draftFromSnapshot,
  formatCoords,
  formatOffsetMinutes,
  genderLabel,
  placeLabel,
  timeAlgLabel,
} from './onboarding-model.js';
import { ERROR_COPY, MINGPAN_ID, MINGPAN_LABEL, MINGPAN_ORDER, momentOf } from './panel.js';
import type { PanelNavTarget } from './panel.js';
import { dataDirPath, useHomePaths } from './home-paths.js';
import type { HomePathsWatch } from './home-paths.js';
import type { RpcContext } from './rpc.js';

/**
 * 重新录制的二次确认文案（S2 §5.4 逐字：写明会原子替换底座谱、底稿需手动刷新）。
 *
 * 底座谱路径由宿主回传的 dataDir 拼出（产品 `~/.xuanshu/xuanshu` / 开发 `<repo>/.dsh-home/xuanshu`）；
 * 拿不到时给中性占位「玄枢数据目录/pus/_base/bazi.md」，不写死任何一档。
 * @param dataDir - 宿主回传的数据目录；缺席时显示中性占位。
 */
export function rerecordConfirm(dataDir?: string): string {
  return `将重新录制出生信息并重新出盘。当前底座谱（${dataDirPath(dataDir, 'pus', '_base', 'bazi.md')}）会被新结果原子替换；底稿会在下次刷新时随之更新，需要你手动点刷新。`;
}

/** 本屏视图状态（S2 §6：四态 + 部分字段读不出来）。 */
type MingpanView =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready'; snapshot: BaziSnapshot }
  | { kind: 'error'; message: string };

/** 四柱的列序（S2 §9 四柱表：年 / 月 / 日 / 时）。 */
const PILLAR_COLUMNS: readonly { key: keyof NonNullable<BaziSnapshot['pillars']>; label: string }[] = [
  { key: 'year', label: '年柱' },
  { key: 'month', label: '月柱' },
  { key: 'day', label: '日柱' },
  { key: 'hour', label: '时柱' },
];

/** 快照里本屏要用的三块；缺哪块就照实说哪块（不整屏失败，S2 §6）。 */
const SNAPSHOT_SECTIONS: readonly (keyof BaziSnapshot)[] = ['birth', 'pillars', 'basis'];

export interface MingpanPanelProps {
  /** 命盘数据面（`index.tsx` 用 `createBaziApi(ctx)` 造好注入）。 */
  api: BaziApi;
  /** 跨面板控制器：订阅取数代次 + 提交重录请求。 */
  controller: BaziUiController;
  /** 面板导航（空态 → 向导；顶部 → 回总览）。 */
  navigate: (target: PanelNavTarget) => void;
  /** 静态预置快照（`null` = 明确「还没有命盘」；测试与 SSR 断言用）。 */
  preloadedSnapshot?: BaziSnapshot | null;
  /** 静态预置错误（测试与 SSR 断言用）。 */
  preloadedError?: string;
  /**
   * 宿主回传的数据目录（`data.overview.dataDir`）：二次确认文案里的底座谱路径据此渲染；
   * 缺席时显示中性占位「玄枢数据目录/pus/_base/bazi.md」。
   */
  dataDir?: string;
  /**
   * R3（#35）· 装配期注入的 home/dataDir 注入面（与概览 / 问事 / 沉淀同一份）；
   * 显式 `dataDir` 优先，其次读注入面，都没有才回中性占位。
   */
  homePaths?: HomePathsWatch;
}

/**
 * 命盘卡详情面板。
 * @param props - 数据面、控制器、导航与静态预置。
 * @returns 只读详情面板节点。
 */
export function MingpanPanel({
  api,
  controller,
  navigate,
  preloadedSnapshot,
  preloadedError,
  dataDir,
  homePaths,
}: MingpanPanelProps) {
  // R3：二次确认里的底座谱路径读注入面（宿主回传的 dataDir）；显式 props 优先。
  const injectedHomePaths = useHomePaths(homePaths);
  const localDataDir = dataDir ?? injectedHomePaths.dataDir;
  const revision = useSyncExternalStore(controller.subscribe, controller.getRevision, controller.getRevision);
  const seeded = preloadedError !== undefined || preloadedSnapshot !== undefined;
  const [view, setView] = useState<MingpanView>(() => {
    if (preloadedError !== undefined) return { kind: 'error', message: preloadedError };
    if (preloadedSnapshot !== undefined) {
      return preloadedSnapshot === null ? { kind: 'empty' } : { kind: 'ready', snapshot: preloadedSnapshot };
    }
    return { kind: 'loading' };
  });
  const [confirming, setConfirming] = useState(false);
  const sequence = useRef(0);

  useEffect(() => {
    if (seeded) return; // 静态预置：不取数（SSR 断言与重录预览都不该多发一次请求）
    const mine = ++sequence.current;
    setView((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    void api
      .snapshot()
      .then((answer) => {
        if (mine !== sequence.current) return;
        const snapshot = answer?.snapshot ?? null;
        setView(snapshot === null ? { kind: 'empty' } : { kind: 'ready', snapshot });
      })
      .catch(() => {
        if (mine !== sequence.current) return;
        setView({ kind: 'error', message: ERROR_COPY.mingpan });
      });
  }, [api, revision, seeded]);

  /** 顶部与各态的出口：回总览（本屏是 main 面板，不再是抽屉，「关闭」= 切面板）。 */
  const backToOverview = (
    <button type="button" data-xuanshu-action="back-overview" onClick={() => { navigate('overview'); }}>
      {'<- 回总览'}
    </button>
  );

  const startOnboarding = (
    <button type="button" data-xuanshu-action="start-onboarding" onClick={() => { navigate('onboarding'); }}>
      {'开始填写出生信息 ->'}
    </button>
  );

  /**
   * 重新录制：二次确认后把**现值**作为预填草稿交给控制器，再切到向导。
   * @param snapshot - 当前快照（预填来源，S2 §5.4「五步全部预填现值」）。
   */
  const goRerecord = (snapshot: BaziSnapshot): void => {
    controller.requestRerecord(draftFromSnapshot(snapshot));
    navigate('onboarding');
  };

  return (
    <main className="xs-mingpan" data-xuanshu-panel={MINGPAN_ID}>
      <header className="xs-mingpan__head">
        <h1>命盘卡详情</h1>
        <XsReadonlyBadge />
        {backToOverview}
      </header>

      {view.kind === 'loading' ? (
        <p className="xs-mingpan__loading" data-xuanshu-view="loading">正在读命盘快照…</p>
      ) : null}

      {view.kind === 'empty' ? (
        <section className="xs-mingpan__empty" data-xuanshu-view="empty">
          <p>还没有命盘：出生信息还没录</p>
          <p className="xs-mingpan__hint">命盘是只读快照：填一次出生信息就点亮了。</p>
          <div className="xs-mingpan__actions">{startOnboarding}</div>
        </section>
      ) : null}

      {view.kind === 'error' ? (
        <section className="xs-mingpan__error" data-xuanshu-view="error" role="alert">
          {/*
            先一句人话（这一屏发生了什么），再贴宿主给的原因原文 —— 顺序反了就是「变量原样输出」：
            人会先看到「命盘快照读不出来（文件缺失或格式不符）」却不知道该做什么。
          */}
          <p>排盘失败：读不到命盘快照。下面是宿主给的原因。</p>
          <p>{view.message}</p>
          <p className="xs-mingpan__hint">
            可以先点「重试」再读一次；如果还是读不到，就去补出生信息——重录会重新出盘并原子替换底座谱。
          </p>
          <div className="xs-mingpan__actions">
            <button type="button" data-xuanshu-action="retry" onClick={() => { controller.invalidate(); }}>
              重试
            </button>
            {startOnboarding}
            <button type="button" data-xuanshu-action="rerecord" onClick={() => { setConfirming(true); }}>
              去重新录制出生信息
            </button>
          </div>
        </section>
      ) : null}

      {view.kind === 'ready' ? (
        <MingpanBody
          snapshot={view.snapshot}
          dataDir={localDataDir}
          confirming={confirming}
          onAskRerecord={() => { setConfirming(true); }}
          onCancelRerecord={() => { setConfirming(false); }}
          onConfirmRerecord={() => { goRerecord(view.snapshot); }}
        />
      ) : null}
    </main>
  );
}

/** 只读正文：出生摘要 + 四柱 + 口径行 + 快照来源 + 唯一写操作。 */
function MingpanBody({
  snapshot,
  dataDir,
  confirming,
  onAskRerecord,
  onCancelRerecord,
  onConfirmRerecord,
}: {
  snapshot: BaziSnapshot;
  dataDir?: string;
  confirming: boolean;
  onAskRerecord: () => void;
  onCancelRerecord: () => void;
  onConfirmRerecord: () => void;
}) {
  const birth = snapshot.birth ?? {};
  const basis = snapshot.basis ?? {};
  const missingSections = SNAPSHOT_SECTIONS.filter((key) => snapshot[key] === undefined);
  const coords =
    Number.isFinite(birth.lon) && Number.isFinite(birth.lat)
      ? formatCoords(birth.lon as number, birth.lat as number)
      : '坐标缺（快照未存）';
  const timeAlg = birth.timeAlg === 1 || birth.timeAlg === 3 ? birth.timeAlg : 0;

  return (
    <>
      <h2>① 出生信息</h2>
      <div className="xs-mingpan__summary" data-xuanshu-summary="birth">
        <p data-xuanshu-summary="clock">
          {`${birth.date ?? '—'} ${birth.time ?? '—'} 当地时间`}
        </p>
        <p data-xuanshu-summary="place">
          <span>{placeLabel({ place: birth.place ?? '' })}</span>
          <span className="xs-mingpan__coord">{` ${coords}`}</span>
          <span>{`　时区 ${birth.zone === undefined || birth.zone === '' ? '—' : birth.zone}`}</span>
          <span>{` ${formatOffsetMinutes(basis.offsetMinutes)}`}</span>
        </p>
      </div>

      <h2>② 四柱</h2>
      <div className="xs-mingpan__pillars" data-xuanshu-pillars="4">
        {PILLAR_COLUMNS.map((column) => (
          <div key={column.key} className="xs-mingpan__pillar" data-xuanshu-pillar={column.key}>
            <span className="xs-mingpan__pillar-name">{column.label}</span>
            <span className="xs-mingpan__pillar-value">{snapshot.pillars?.[column.key] ?? '—'}</span>
          </div>
        ))}
      </div>
      {missingSections.length > 0 ? (
        <p className="xs-mingpan__hint" data-xuanshu-note="partial">
          {`部分要点读不出来（${missingSections.join(' / ')}）`}
        </p>
      ) : null}
      <p className="xs-mingpan__hint" data-xuanshu-note="schema-scope">
        本快照（xuanshu/bazi-snapshot@1）只存四柱与口径；藏干 / 十神 / 大运 / 其它要点不在其中（扩 schema 属后续票）。
      </p>

      <h2>③ 起盘口径（只读）</h2>
      <div className="xs-mingpan__basis" data-xuanshu-basis="readonly">
        <p data-xuanshu-basis="time-alg">{`时间算法 = ${timeAlgLabel(timeAlg)}`}</p>
        <p data-xuanshu-basis="gender">性别 = {genderLabel('unknown')}</p>
        <p data-xuanshu-basis="other-knobs">其余旋钮 = 引擎缺省（本盘未改）</p>
        <p data-xuanshu-basis="two-clocks">
          {`真太阳时 ${basis.trueSolar ?? '—'}　钟表时 ${basis.clock ?? '—'}　夏令时 ${basis.dst === true ? '有' : '无'}`}
        </p>
      </div>

      <h2>④ 快照来源</h2>
      <p className="xs-mingpan__origin" data-xuanshu-origin="snapshot">
        {`horosa ${snapshot.horosa?.version ?? '—'} / 出盘于 ${snapshot.generatedAt === undefined ? '—' : momentOf(snapshot.generatedAt)}`}
      </p>

      <h2>⑤ 重新录制（唯一写操作）</h2>
      <p className="xs-mingpan__hint">改命盘只能重新录制出生信息；本屏不出盘、不写任何文件。</p>
      <div className="xs-mingpan__actions">
        <button type="button" data-xuanshu-action="rerecord" onClick={onAskRerecord}>
          {'重新录制出生信息 ->'}
        </button>
      </div>
      {/*
        二次确认就地展开（不用 `window.confirm`：那样文案就不可断言，也没法在窄屏里排好）。
        未确认时整块 `hidden` —— 节点在、动作不在：C10 要求「写操作必过人工确认」。
      */}
      <div className="xs-mingpan__confirm" data-xuanshu-confirm="rerecord" hidden={!confirming}>
        <p data-xuanshu-confirm-text="rerecord">{rerecordConfirm(dataDir)}</p>
        <div className="xs-mingpan__actions">
          <button type="button" data-xuanshu-action="rerecord-cancel" onClick={onCancelRerecord}>取消</button>
          <button type="button" data-xuanshu-action="rerecord-go" onClick={onConfirmRerecord}>
            {'去重新录制 ->'}
          </button>
        </div>
      </div>
    </>
  );
}

/** 侧栏行图标（与 S2 屏稿同族的命盘标）。 */
function MingpanIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2" />
    </svg>
  );
}

/**
 * 详情的**加性**注册（main key `mingpan` + 侧栏行 `mingpan`）。
 *
 * 与 `installOnboarding` 同两条纪律：apply 期不调 `selectPanel`、不新增运行期 require；
 * 非 DOM 环境下样式注入被守卫挡掉、注册照做。
 *
 * @param ctx - 客户端上下文（需 `slots`）。
 * @param deps - 数据面 / 控制器 / 导航（与概览、向导共用同一份）。
 */
export function installMingpan(ctx: Context & RpcContext, deps: {
  api: BaziApi;
  controller: BaziUiController;
  navigate: (target: PanelNavTarget) => void;
  /** R3：宿主回传的 home/dataDir 注入面（与概览 / 问事 / 沉淀同一份）。 */
  homePaths?: HomePathsWatch;
}): void {
  installBaziStyle();
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      { name: 'main', key: MINGPAN_ID, inject: () => ({ ...deps }) },
      MingpanPanel as never,
    ),
  );
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: MINGPAN_ID, order: MINGPAN_ORDER, label: MINGPAN_LABEL },
      MingpanIcon as never,
    ),
  );
}
