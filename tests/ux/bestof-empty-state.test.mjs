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

import { BestofOverlayHost, BestofSettingsRowHost, BestofTriggerHost } from '../../packages/xuanshu-client/src/client/bestof.tsx';
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
