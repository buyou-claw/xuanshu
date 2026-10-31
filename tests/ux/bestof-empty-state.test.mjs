/**
 * 票 UX-03（#65）· 多 AI 合参三个入口的**空态**（判据 `S-001`）。
 *
 * 三个面（浮层 / 设置项 / 输入框触发器）共用同一个源文件（`bestof.tsx`），
 * 所以这里钉两件事：
 *   1. **行为**：每一面在「真的空着」时说出人话（「还没有…」），并指得出下一步；
 *      不空的时候**不许**冒出一句空态（否则「空」就变成装饰）；
 *   2. **采集口径**：`S-001` 在这三个面上判绿 —— 口径要求同一个源文件里既有判空分支、
 *      又有一句中文空态说明（`scripts/ux/state-vocabulary.mjs` 文件头）。
 *
 * 渲染环境：`renderToStaticMarkup`（Node 里没有 jsdom），因此只驱动**受控组件**。
 */
import { join } from 'node:path';

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BestofOverlayHost, BestofSettingsRowHost, BestofTriggerHost, bestofEmptyOf } from '../../packages/xuanshu-client/src/client/bestof.tsx';
import { createBestofController } from '../../packages/xuanshu-client/src/client/bestof-model.ts';
import { collectStatic } from '../../scripts/ux/collect/static.mjs';
import { run as judgeRun } from '../../scripts/ux/judge.mjs';
import { projectCriteria } from '../../scripts/ux/project.mjs';
import { faceManifest } from '../assembly/lib/panel-surface.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

/** 三个面的 id（与 `tests/assembly/lib/panel-surface.mjs` 的登记逐字相同）。 */
const OVERLAY_FACE = 'slot:shell.overlay#xuanshu-bestof-overlay';
const SETTINGS_FACE = 'slot:settings.general.item#xuanshu.bestof';
const TRIGGER_FACE = 'slot:conversation.composer.dock#xuanshu-bestof-trigger';

/** 一份「一轮跑完、一份候选都没有」的视图（各字段取真实形状，别用空对象糊过去）。 */
function emptyView() {
  return {
    runId: 'bestof-empty-1',
    sessionId: 'session-xs-consult-0000',
    question: '要不要换工作？',
    candidates: [],
    judge: {},
    adoptedId: null,
    rejected: false,
    finished: true,
  };
}

/** 一份有内容的一轮（用来验「不空就别说话」）。 */
function filledView() {
  return {
    ...emptyView(),
    candidates: [{ id: 'c1', angle: 'classic', angleName: '经典派', provider: 'deepseek', model: 'deepseek-chat', status: 'done', text: '正文。' }],
  };
}

/** 只读控制器：`useSyncExternalStore` 读它，`subscribe` 不触发（静态渲染只读一次快照）。 */
function controllerOf(state) {
  return { snapshot: () => state, subscribe: () => () => {} };
}

const render = (element) => renderToStaticMarkup(element);

describe('票 UX-03 · 浮层（slot:shell.overlay）：一轮跑完但没有任何候选', () => {
  it('说「还没有…」并给出下一步（重试合参 / 去 设置 → 模型 换一家）', () => {
    const state = { phase: 'ready', enabled: true, question: '问', view: emptyView() };
    const html = render(h(BestofOverlayHost, { controller: controllerOf(state), api: {} }));
    expect(html, '空着的时候必须有一句人话，不能只留一个空网格').toContain('还没有');
    expect(html, '空态要指得出下一步：重试').toContain('重试合参');
    expect(html, '空态要指得出下一步：去配置').toContain('设置 → 模型');
  });

  it('有候选的一轮不冒空态（空态不是装饰）', () => {
    const state = { phase: 'ready', enabled: true, question: '问', view: filledView() };
    const html = render(h(BestofOverlayHost, { controller: controllerOf(state), api: {} }));
    expect(html).toContain('deepseek-chat');
    expect(html).not.toContain('还没有');
  });

  it('idle 仍然 return null（`shell.overlay` 的 click-through 不许被空态破坏）', () => {
    const html = render(h(BestofOverlayHost, { controller: controllerOf({ phase: 'idle', enabled: true, question: '' }), api: {} }));
    expect(html).toBe('');
  });
});

describe('票 UX-03 · 设置项（slot:settings.general.item）：凑不到两路可并列', () => {
  it('说「还没有…」并指到 设置 → 模型（去配置）', () => {
    const state = {
      phase: 'confirm',
      enabled: true,
      question: '问',
      sessionId: 'session-1',
      // 目录**真读过**（`routesKnown`）才够说「凑不到两路」：没读过时 `routes` 只是还没填。
      routesKnown: true,
      routes: [{ provider: 'deepseek', model: 'deepseek-chat' }],
    };
    const html = render(h(BestofSettingsRowHost, { controller: controllerOf(state), api: {} }));
    expect(html).toContain('还没有');
    expect(html).toContain('设置 → 模型');
  });

  it('路由已经够两路时不冒空态', () => {
    const state = {
      phase: 'confirm',
      enabled: true,
      question: '问',
      sessionId: 'session-1',
      routesKnown: true,
      routes: [{ provider: 'deepseek', model: 'deepseek-chat' }, { provider: 'glm', model: 'glm-4' }],
    };
    const html = render(h(BestofSettingsRowHost, { controller: controllerOf(state), api: {} }));
    expect(html).not.toContain('还没有');
  });
});

describe('票 UX-03 · 输入框触发器（slot:conversation.composer.dock）：拿不到问事会话', () => {
  it('说「还没有问事会话」并指出先去开一次（可执行的下一步）', () => {
    const state = { phase: 'confirm', enabled: true, question: '问', sessionId: '' };
    const html = render(h(BestofTriggerHost, { controller: controllerOf(state), onTrigger: () => {}, api: {} }));
    expect(html).toContain('还没有问事会话');
    expect(html, '下一步写在哪：先去「问事」开一次').toContain('问事');
  });

  it('有会话时只有按钮（不冒空态）', () => {
    const state = { phase: 'confirm', enabled: true, question: '问', sessionId: 'session-1' };
    const html = render(h(BestofTriggerHost, { controller: controllerOf(state), onTrigger: () => {}, api: {} }));
    expect(html).toContain('多 AI 合参');
    expect(html).not.toContain('还没有');
  });
});

/* ───────────────────────── 真实初始状态（票 03 收口） ───────────────────────── */

/**
 * 真实初始快照 = `createBestofController()` 造出来的那一份（**不是**手写的 state）：
 * `phase:'idle'`、`enabled:false`、`question:''`，`sessionId` / `routes` 都**缺席**。
 *
 * 这一节钉的正是 2026-10-31 复核发现的那个洞：空态判定原来读 `sessionId === ''` / `routes`，
 * 而初始快照里两者是 `undefined`（`routes` 还要等估算成功才写），于是静态判据 S-001 绿着、
 * 用户看到的却永远是空白。修法是把「未加载」与「确实没有」分成两个位（`sessionKnown` / `routesKnown`），
 * 两个宿主在挂载时各问一次（`probeSession` / `loadRoutes`），问过之后空态才开口。
 * SSR 不跑 effect，所以这里用控制器 API 复现那一次问话，渲染的还是**同一个宿主组件**。
 */
const ONE_ROUTE_CATALOG = {
  schema: 'xuanshu/routes@1',
  ok: true,
  default: { provider: 'deepseek', model: 'deepseek-chat' },
  providers: [{
    id: 'deepseek',
    name: 'DeepSeek',
    registered: true,
    keyConfigured: true,
    isDefault: true,
    modelsKnown: true,
    models: [{ id: 'deepseek-chat', name: 'deepseek-chat', isDefault: true }],
  }],
  configurable: [],
  failures: [],
}

/** 只提供控制器会用到的那几个方法；别的面在本节不该被碰到。 */
const apiOf = (over = {}) => ({ listRoutes: async () => ONE_ROUTE_CATALOG, ...over })

describe('票 UX-03 收口 · 两条空态在真实初始状态下可达', () => {
  it('初始快照：`sessionId` / `routes` 缺席，且空态判定**不**替用户说「没有」', () => {
    const controller = createBestofController({ api: apiOf() })
    const state = controller.snapshot()
    expect(state.sessionId, '初始快照的 sessionId 不再是 undefined：这条用例要跟着改').toBeUndefined()
    expect(state.routes).toBeUndefined()
    expect(state.sessionKnown).toBeUndefined()
    expect(state.routesKnown).toBeUndefined()
    // 没问过 = 还不知道：既不判「没有会话」，也不判「凑不到两路」。
    expect(bestofEmptyOf(state)).toBeUndefined()
  })

  it('触发器：首屏说「正在读」，问过一次之后才说「还没有问事会话」', () => {
    const controller = createBestofController({ api: apiOf() })
    const before = render(h(BestofTriggerHost, { controller, onTrigger: () => {} }))
    expect(before, '还没问过会话就断言「还没有」= 替用户编事实').not.toContain('还没有问事会话')
    expect(before, '未加载时要说清「正在读」，不能一片空白').toContain('正在读取最近一次问事会话');

    // 这就是 `BestofTriggerHost` 挂载时做的那一次探测（`resolveSessionId` 给不出会话）。
    controller.probeSession(undefined)
    const after = render(h(BestofTriggerHost, { controller, onTrigger: () => {} }))
    expect(after, '问过、确实没有 → 空态必须真的出现（否则这条空态永远不可达）').toContain('还没有问事会话')
    expect(after).toContain('先去「问事」开一次会话')
  })

  it('设置项：没读过目录不说「凑不到两路」，读到只有一路才说（空态可达）', async () => {
    const controller = createBestofController({ api: apiOf() })
    const before = render(h(BestofSettingsRowHost, { controller }))
    expect(before, '还没读目录就说「凑不到两路」= 拿猜测占屏').not.toContain('还没有两路可并列')
    expect(before).toContain('正在读取模型目录');

    // 这就是 `BestofSettingsRowHost` 挂载时读的那一次目录（只有一路）。
    await controller.loadRoutes()
    expect(controller.snapshot().routesKnown).toBe(true)
    expect(controller.snapshot().routes).toEqual([{ provider: 'deepseek', model: 'deepseek-chat' }])
    const after = render(h(BestofSettingsRowHost, { controller }))
    expect(after, '读过目录、确实只有一路 → 空态必须真的出现').toContain('还没有两路可并列（现在 1 路）')
    expect(after).not.toContain('正在读取模型目录')
  })

  it('设置项：老宿主没有 `routes.list` → 记「问过了」但不冒充「零路」', async () => {
    const controller = createBestofController({ api: apiOf({ listRoutes: undefined }) })
    await controller.loadRoutes()
    expect(controller.snapshot().routesKnown).toBe(true)
    expect(controller.snapshot().routes).toBeUndefined()
    const html = render(h(BestofSettingsRowHost, { controller }))
    expect(html, '读不到 ≠ 只有零路：不许把「拿不到目录」说成「凑不到两路」').not.toContain('还没有两路可并列')
  })
});

describe('票 UX-03 · 采集口径：S-001 在这三个面上判绿', () => {
  it('三个合参面都不再出现在「缺空态」的判定里', () => {
    const faces = faceManifest();
    const criteria = projectCriteria({ repoRoot: REPO_ROOT, faces }).document;
    const collected = collectStatic({ repoRoot: REPO_ROOT, criteria, faces });
    const { verdicts } = judgeRun({ criteria, evidence: collected.evidence, faces });
    for (const face of [OVERLAY_FACE, SETTINGS_FACE, TRIGGER_FACE]) {
      const verdict = verdicts.find((item) => item.criterionId === 'S-001' && item.face === face);
      expect(verdict, `${face} 没有 S-001 的判定`).toBeTruthy();
      expect(verdict.status, `${face} 的 S-001 仍判 ${verdict.status}：${verdict.message}`).toBe('pass');
    }
  });
});
