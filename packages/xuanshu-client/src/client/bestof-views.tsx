/**
 * 票 11 · 合参浮层的视图（S9 §2.2–§2.7 的线框；C9 / H3 / H4 的界面落点）。
 *
 * 全是**纯展示组件**（props 进、标记出）：断言台用 `renderToStaticMarkup` 直接渲染，
 * 于是「判官区没有建议采用」「生成中只有停止全部」「回落文案写清效力边界」「费用未知」这些
 * 票面验收里最容易被糊过去的措辞，都能逐字钉住。
 *
 * 形状全部自研 `Xs*`（README §6.4 D9 / F4：不 import 任何 Harness Client 包）。
 */
import type { BestofCandidate, BestofView } from './bestof-api.js';
import {
  BESTOF_ANGLE_OPTIONS,
  canAdopt,
  canMerge,
  candidateStatusLabel,
  costLabel,
  deliveryNotice,
  fallbackNotice,
  judgeUnavailable,
  rankTag,
  rankedCandidates,
  usableCandidates,
} from './bestof-model.js';
import type { BestofUiState } from './bestof-model.js';

/** 浮层要调的动作（由 `bestof.tsx` 的控制器提供）。 */
export interface BestofOverlayActions {
  onEditQuestion(question: string): void;
  onStart(): void;
  onCancel(): void;
  onStop(): void;
  onAdopt(candidateId: string): void;
  onMerge(): void;
  onReject(): void;
  onRetry(): void;
  onOpenSettings?(): void;
}

/**
 * 浮层根：**没有内容就 `return null`** —— `shell.overlay` 的 click-through 约定
 * （事实笔记 §6.1：无内容时不占指针）。
 */
export function XsBestofOverlay({ state, actions }: { state: BestofUiState; actions: BestofOverlayActions }) {
  if (state.phase === 'idle') return null;
  return (
    <div className="xs-bestof-backdrop" role="dialog" aria-label="多 AI 合参">
      <div className="xs-bestof">
        {state.phase === 'confirm' && <XsBestofCostConfirm state={state} actions={actions} />}
        {state.phase === 'disabled' && <XsBestofDisabled state={state} actions={actions} />}
        {state.phase === 'error' && <XsBestofError state={state} actions={actions} />}
        {state.view !== undefined && state.phase !== 'confirm' && state.phase !== 'disabled' && state.phase !== 'error' && (
          <XsBestofRun state={state} actions={actions} />
        )}
      </div>
    </div>
  );
}

/** 触发说明行（常驻两句：首版 2 路；候选不带工具）。 */
function XsBestofTriggerNote() {
  return (
    <p className="xs-bestof__note">
      首版 2 路：{BESTOF_ANGLE_OPTIONS.map((option) => option.name).join(' + ')}（同一模型两视角）。
      候选只回答、不执行任何动作（不带工具、不读写你的文件）。
    </p>
  );
}

/** 费用确认框（S9 §2.1 ②：没有价表也要确认，且写明费用未知）。 */
export function XsBestofCostConfirm({ state, actions }: { state: BestofUiState; actions: BestofOverlayActions }) {
  const confirmed = state.view;
  return (
    <div data-xs-bestof="confirm">
      <div className="xs-bestof__head">
        <h3>多 AI 合参 · 预估费用确认</h3>
        <span className="xs-bestof__tag">候选 {BESTOF_ANGLE_OPTIONS.length} 路</span>
      </div>
      <XsBestofTriggerNote />
      <p className="xs-bestof__note">预估费用：{costLabel(confirmed)}（模型与密钥复用 DSH 的 provider 配置，玄枢不另配密钥）</p>
      <label>
        <span className="xs-bestof__note">这一轮要合参的问题是？</span>
        <textarea
          value={state.question}
          onChange={(event) => actions.onEditQuestion((event.target as HTMLTextAreaElement).value)}
          placeholder="写上要合参的问题"
        />
      </label>
      {state.error !== undefined && <p className="xs-bestof__error" role="alert">{state.error}</p>}
      <div className="xs-bestof__actions">
        <button type="button" className="xs-btn--primary" onClick={actions.onStart}>开始合参</button>
        <button type="button" onClick={actions.onCancel}>取消</button>
      </div>
    </div>
  );
}

/** 禁用态（S9 §6：开关关着 → 说明去哪打开，**不静默改走普通问答**）。 */
export function XsBestofDisabled({ state, actions }: { state: BestofUiState; actions: BestofOverlayActions }) {
  return (
    <div data-xs-bestof="disabled">
      <h3>多 AI 合参当前是关的</h3>
      <p className="xs-bestof__note">{state.notice ?? '去 设置 · 通用 里打开「多 AI 合参」。'}</p>
      <XsBestofTriggerNote />
      <div className="xs-bestof__actions">
        {actions.onOpenSettings !== undefined && <button type="button" onClick={actions.onOpenSettings}>去设置</button>}
        <button type="button" onClick={actions.onCancel}>照常问（带工具）</button>
      </div>
    </div>
  );
}

/** 失败态（S9 §6 ①：整块 error + 两条出路）。 */
export function XsBestofError({ state, actions }: { state: BestofUiState; actions: BestofOverlayActions }) {
  return (
    <div data-xs-bestof="error">
      <h3>这次合参没跑起来</h3>
      <p className="xs-bestof__error" role="alert">{state.error ?? '未知原因。'}</p>
      <div className="xs-bestof__actions">
        <button type="button" className="xs-btn--primary" onClick={actions.onRetry}>重试合参</button>
        <button type="button" onClick={actions.onCancel}>退回普通问法（带工具）</button>
      </div>
    </div>
  );
}

/** 一轮合参的主体：候选网格 + 判官区 + 折叠摘要 + 三动作。 */
export function XsBestofRun({ state, actions }: { state: BestofUiState; actions: BestofOverlayActions }) {
  const view = state.view as BestofView;
  const running = state.phase === 'running';
  const ranked = rankedCandidates(view);
  return (
    <div data-xs-bestof="run">
      <div className="xs-bestof__head">
        <h3>多 AI 合参 · {view.candidates.length} 路</h3>
        <span className="xs-bestof__tag">{running ? '生成中' : state.phase === 'rejected' ? '已否决' : view.adoptedId === null ? '待你拍板' : '已采用'}</span>
      </div>
      <XsBestofTriggerNote />
      {state.notice !== undefined && <p className="xs-bestof__note">{state.notice}</p>}
      {state.error !== undefined && <p className="xs-bestof__error" role="alert">{state.error}</p>}

      {!running && view.rejected === true && (
        <div className="xs-bestof__warn" data-xs-bestof="rejected">
          <h4>本轮合参作废</h4>
          <p className="xs-bestof__note">
            没有任何一份被采用（adoptedId 为空），也不会进入后续对话与历史回看；
            候选正文仍保存在本地合参记录里，可展开、可导出。
          </p>
          <div className="xs-bestof__actions">
            <button type="button" className="xs-btn--primary" onClick={actions.onRetry}>重来一轮（沿用同一个问题）</button>
          </div>
        </div>
      )}

      {!running && view.adoptedId !== null && (
        <div className="xs-bestof__warn" data-xs-bestof="adopted">
          <h4>{view.adoptedId === 'merged' ? '已合并为一稿并采用' : `已采用 ${view.adoptedId}`}</h4>
          {/*
            task-15：投递失败时**不许**还说「历史只带这一份采用稿」—— 那是说了一句没发生的事。
            成功态（`delivery` 缺席或 `ok !== false`）的这两段文案**逐字未动**。
          */}
          {deliveryNotice(state.delivery ?? view.delivery) !== undefined ? (
            <>
              <p className="xs-bestof__error" data-xs-bestof="delivery-failed" role="alert">
                ⚠ {deliveryNotice(state.delivery ?? view.delivery)}
              </p>
              <p className="xs-bestof__note">
                采用只影响这次对话与回看；写进谱要在结束沉淀时由你确认。
                其余候选已折叠保存在本地合参记录里，需要时展开查看。
              </p>
            </>
          ) : (
            <p className="xs-bestof__note">
              采用只影响这次对话与回看；写进谱要在结束沉淀时由你确认。历史只带这一份采用稿。
              其余候选已折叠保存在本地合参记录里，需要时展开查看。
            </p>
          )}
          <p className="xs-bestof__note">合参没有改动本次会话的挂载账本与字数状态（旁路，不写页面态）。</p>
        </div>
      )}

      {fallbackNotice(view) !== undefined && (
        <div className="xs-bestof__warn" data-xs-bestof="fallback">
          <p className="xs-bestof__note">⚠ {fallbackNotice(view)}</p>
        </div>
      )}

      <XsBestofCandidateGrid view={view} />
      {!running && <XsBestofJudgePanel view={view} />}

      <details>
        <summary>▸ 展开候选（{usableCandidates(view).length} 份可用 / 共 {view.candidates.length} 路）</summary>
        <p className="xs-bestof__note">
          候选流不带工具：候选只回答、不执行动作，也不会产生工具调用块。判官只看候选与问题，不读你的谱与挂载内容。
        </p>
      </details>

      <XsBestofActions view={view} running={running} actions={actions} />
    </div>
  );
}

/** 候选卡网格（S9 §2.2 ①：列数取 2，窄屏由 CSS 落到单列；采用按钮统一在底部动作行）。 */
export function XsBestofCandidateGrid({ view }: { view: BestofView }) {
  return (
    <div className="xs-bestof__grid" data-xs-bestof="candidates">
      {rankedCandidates(view).map((candidate) => (
        <XsBestofCandidateCard
          key={candidate.id}
          candidate={candidate}
          rank={rankTag(view, candidate.id)}
          rankIsFallback={judgeUnavailable(view)}
          adopted={view.adoptedId === candidate.id}
        />
      ))}
    </div>
  );
}

/** 单张候选卡：id + 视角 + 排名 Tag + 状态 + 正文（**卡上不放采用按钮**：三动作统一在底部行）。 */
export function XsBestofCandidateCard({
  candidate,
  rank,
  rankIsFallback,
  adopted,
}: {
  candidate: BestofCandidate;
  rank?: string;
  rankIsFallback?: boolean;
  adopted?: boolean;
}) {
  return (
    <section className="xs-bestof__card" data-xs-bestof="candidate" data-xs-candidate={candidate.id}>
      <header className="xs-bestof__card-head">
        <strong>{candidate.id}</strong>
        <span className="xs-bestof__tag">{candidate.angleName ?? candidate.angle}</span>
        {rank !== undefined && <span className={`xs-bestof__tag${rankIsFallback === true ? '' : ' xs-bestof__tag--rank'}`}>{rank}</span>}
        {adopted === true && <span className="xs-bestof__tag">已采用</span>}
        <span className="xs-bestof__tag">{candidateStatusLabel(candidate)}</span>
        <span className="xs-bestof__tag">{candidate.model}</span>
      </header>
      <div className="xs-bestof__body">{candidate.text}</div>
      {candidate.error !== undefined && <p className="xs-bestof__error">{candidate.error}</p>}
    </section>
  );
}

/** 判官区（C9：标题固定「只排序，不替你做决定」；H4：不读谱与挂载）。 */
export function XsBestofJudgePanel({ view }: { view: BestofView }) {
  const unavailable = judgeUnavailable(view);
  return (
    <section className="xs-bestof__judge" data-xs-bestof="judge">
      <h4>{unavailable ? '判官（本次未给出有效排序）' : '判官（只排序，不替你做决定）'}</h4>
      {rankedCandidates(view).map((candidate) => (
        <div className="xs-bestof__judge-row" key={candidate.id}>
          <strong>{candidate.id}</strong>
          <span className="xs-bestof__tag">{view.judge?.reasons?.[candidate.id] ?? '（判官未给理由）'}</span>
        </div>
      ))}
      <p className="xs-bestof__note">
        判官不会自动采用：排序只是排序，采用与否由你点。判官只看候选与问题，不读你的谱与挂载内容。
      </p>
      <p className="xs-bestof__note">本轮费用：{costLabel(view)}</p>
    </section>
  );
}

/** 三动作（S9 §2.2 ③ / §6：生成中只有「停止全部」；结束后才有采用/合并/否决）。 */
export function XsBestofActions({ view, running, actions }: { view: BestofView; running: boolean; actions: BestofOverlayActions }) {
  if (running) {
    return (
      <div className="xs-bestof__actions" data-xs-bestof="actions">
        <button type="button" onClick={actions.onStop}>停止全部</button>
      </div>
    );
  }
  const usable = usableCandidates(view);
  return (
    <div className="xs-bestof__actions" data-xs-bestof="actions">
      {/* 采用：每个可用候选一枚（判官排序在前），全部等人点。 */}
      {canAdopt(view) &&
        usable.map((candidate) => (
          <button key={candidate.id} type="button" className="xs-btn--primary" onClick={() => actions.onAdopt(candidate.id)}>
            采用 {candidate.id}
          </button>
        ))}
      <button type="button" onClick={actions.onMerge} disabled={!canMerge(view)}>合并为一稿</button>
      <button type="button" onClick={actions.onReject}>否决本轮</button>
      <button type="button" onClick={actions.onCancel}>收起</button>
      {!canMerge(view) && <span className="xs-bestof__note">可合并的候选不足两份。</span>}
      <span className="xs-bestof__note">判官不会自动采用（本轮费用：{costLabel(view)}）</span>
    </div>
  );
}

/**
 * 会话 composer 旁的触发按钮（S9 §1：`/多模型` 与按钮是**等价入口**）。
 *
 * 落位用设计稿 §8 给「当前态 UI」指的那一档（`conversation.composer.dock`）。
 * **未确认**：该槽名在本版 DSH 里是否存在（事实笔记 §6.7 明说槽位键清单没有穷举）；
 * 槽不存在时 `slots.inject` 只是不回调 —— 命令入口照常可用（不会抛、不会空占位）。
 */
export function XsBestofTriggerButton({ onTrigger }: { onTrigger(): void }) {
  return (
    <button type="button" className="xs-btn--primary" data-xs-bestof="trigger" onClick={onTrigger}>
      多 AI 合参
    </button>
  );
}

/** 设置里的开关行（S9 §2.7；`settings.general.item` 是更轻的一项设置行）。 */export function XsBestofSettingsRow({ state, actions }: { state: BestofUiState; actions: { onToggle(enabled: boolean): void } }) {
  return (
    <div className="xs-bestof__settings" data-xs-bestof="settings">
      <div>
        <strong>多 AI 合参</strong>
        <p className="xs-bestof__settings-note">
          打开后可用 /多模型 命令（别名 /合参 · bestof）与「多 AI 合参」按钮；
          候选只回答、不执行动作（不带工具、不读写你的文件）。
        </p>
      </div>
      <label>
        <input type="checkbox" checked={state.enabled} onChange={(event) => actions.onToggle((event.target as HTMLInputElement).checked)} />
        <span className="xs-bestof__settings-note">{state.enabled ? '开' : '关'}</span>
      </label>
    </div>
  );
}
