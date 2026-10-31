/**
 * 票 11 · 合参的客户端状态机与文案口径（S9 §5/§6；契约 §1）。
 *
 * 纯函数 + 一个不带 React 的控制器：**视图只读这里算出来的东西**，于是 C9（判官不自动采用）、
 * H3/H4 的披露、回落文案、费用口径都能在没有浏览器的断言台里逐字验。
 *
 * 三条硬口径：
 *   1. **没有任何自动采用**：`adopt` 由人点触发；`bestof.run` 跑完只是 `ready`。
 *   2. **停止要真的停**：优先调 `bestof.cancel`；宿主没有这个方法时**如实说**「后台仍会跑完」，
 *      不许假装停了（Lead 2026-10-15 把它钉成产品承诺）。
 *   3. **费用未知就说未知**：宿主不给 `costUsd` 时显示「费用未知」，不许拿 0 糊过去。
 */
import type {
  BestofApi,
  BestofCandidate,
  BestofDecision,
  BestofDelivery,
  BestofEstimate,
  BestofRoute,
  BestofView,
  RouteCatalog,
} from './bestof-api.js';

/** 主命令名（S9 §1：`/多模型` 逐字照抄上游）。 */
export const BESTOF_COMMAND_NAME = '多模型';
/** 别名：玄枢的 `/合参` + 上游的 `bestof`（三者等价）。 */
export const BESTOF_COMMAND_ALIASES = ['合参', 'bestof'];
/** 全部命令名（客户端按名字注册三个 contribution；`CommandContribution` 没有 aliases 字段）。 */
export const BESTOF_COMMAND_NAMES = [BESTOF_COMMAND_NAME, ...BESTOF_COMMAND_ALIASES];

/** 首版两个视角（与宿主 `BESTOF_ANGLES` 的 id 对齐）。 */
export const BESTOF_ANGLE_OPTIONS = [
  { id: 'classic', name: '经典派' },
  { id: 'cautious', name: '审慎派' },
];

/** 选路数量闸（票 28：2–4 路）。 */
export const BESTOF_MIN_ROUTES = 2;
export const BESTOF_MAX_ROUTES = 4;

/** 路由去重键：`provider::model`（与宿主的判据逐字相同）。 */
export function routeKey(route: BestofRoute): string {
  return `${route.provider}::${route.model ?? ''}`;
}

/** 路由目录里一条**可选**的候选路由（provider 下每个 model 一条）。 */
export interface CatalogRouteOption {
  provider: string;
  model: string;
  modelName: string | null;
  providerName: string | null;
  label: string;
  keyConfigured: boolean | 'unknown';
  /** 三态：`true` / `false` / `null`（默认路由读不到 = 未知，不降成 false）。 */
  isDefault: boolean | null;
}

/** 三态合取：任一层未知 → 未知（`null`）；两层都明确 → 与。 */
function defaultOfRoute(providerDefault: boolean | null | undefined, modelDefault: boolean | null | undefined): boolean | null {
  if (providerDefault === null || providerDefault === undefined) return null;
  if (modelDefault === null || modelDefault === undefined) return null;
  return providerDefault === true && modelDefault === true;
}

/** 把路由目录摊平成「可选路由」列表；可配置但未注册的家没有 model，不能当候选。 */
export function flattenCatalogRoutes(catalog: RouteCatalog | undefined): CatalogRouteOption[] {
  const options: CatalogRouteOption[] = [];
  for (const provider of catalog?.providers ?? []) {
    for (const model of provider.models ?? []) {
      const modelName = model.name ?? null;
      options.push({
        provider: provider.id,
        model: model.id,
        modelName,
        providerName: provider.name ?? null,
        label: `${provider.id} · ${modelName ?? model.id}`,
        keyConfigured: provider.keyConfigured,
        isDefault: defaultOfRoute(provider.isDefault, model.isDefault),
      });
    }
  }
  return options;
}

/**
 * 默认选路（票 28）：默认路由在前，第二路优先**另一家 provider**（这才叫多家并列）；
 * 家数不够时才用同一家的第二个 model。去重、最多 4 路。
 */
export function defaultRouteSelection(catalog: RouteCatalog | undefined, { min = BESTOF_MIN_ROUTES, max = BESTOF_MAX_ROUTES } = {}): BestofRoute[] {
  const options = flattenCatalogRoutes(catalog);
  if (options.length === 0) return [];
  const preferred = options.find((option) => option.isDefault === true) ?? options[0];
  if (preferred === undefined) return [];
  const preferredProvider = preferred.provider;
  const picked: CatalogRouteOption[] = [];
  const push = (option: CatalogRouteOption | undefined): void => {
    if (option === undefined) return;
    if (picked.some((entry) => routeKey(entry) === routeKey(option))) return;
    picked.push(option);
  };
  push(preferred);
  push(options.find((option) => option.provider !== preferredProvider));
  for (const option of options) {
    // 默认只选到下限（2 路）；剩下的由人在确认屏上自己加（最多 4 路）。
    if (picked.length >= Math.min(min, max, options.length)) break;
    push(option);
  }
  return picked.slice(0, max).map((option) => ({ provider: option.provider, model: option.model }));
}

/** 选中的路由能不能开跑：2–4 路、按 `provider::model` 不重复。返回一句人话或 undefined。 */
export function routeSelectionProblem(routes: BestofRoute[] | undefined): string | undefined {
  const list = Array.isArray(routes) ? routes : [];
  if (list.length < BESTOF_MIN_ROUTES) return `合参至少两路（现在 ${list.length} 路）：再选一家 provider 或 model。`;
  if (list.length > BESTOF_MAX_ROUTES) return `合参最多四路（现在 ${list.length} 路）：去掉几路再跑。`;
  if (new Set(list.map(routeKey)).size !== list.length) return '有重复路由（同一个 provider::model 只能算一路）。';
  return undefined;
}

/** key 配置三态的人话：读不到就说「未知」，不许写成「缺 key」。 */
export function keyConfiguredLabel(value: boolean | 'unknown' | undefined): string {
  if (value === true) return '已配 key';
  if (value === false) return '缺 key';
  return '未知';
}

/** 输入规模（**估算**）；拿不到 estimate 时也如实说未知。 */
export function estimateInputLabel(estimate: BestofEstimate | undefined): string {
  if (estimate === undefined || !Number.isFinite(estimate.inputTokens)) return '输入规模未知（估算不可用）';
  return `≈ ${estimate.inputTokens} tokens/路（估算）`;
}

/** 金额文案（票 28）：钉版没有价表，`price` 恒为 `'unknown'` —— 永远显示「金额未知」。 */
export function estimatePriceLabel(estimate: BestofEstimate | undefined): string {
  // 保留参数是为了让调用点形状稳定；`price === 'unknown'` 是规格，不是「没读到」。
  return estimate?.price === 'unknown' || estimate === undefined ? '金额未知' : '金额未知';
}

/** 这一轮的判官是不是同源（与候选同一家 provider）。 */
export function judgeSameSource(view: BestofView | undefined): boolean {
  return view?.judge?.mode === 'same-source' || view?.judge?.source === 'same-source';
}

/**
 * 判官来源说明（票 28）：异源就写清是谁判的；同源就如实说「没有异源判官」——
 * 绝不说成「异源判官已给出」。
 */
export function judgeSourceNotice(view: BestofView | undefined): string | undefined {
  if (view === undefined) return undefined;
  if (judgeSameSource(view)) {
    return `判官与候选同源：${view.judge.error ?? '没有不在候选里的另一家 provider'}（暂按完成顺序排前）`;
  }
  const provider = view.judge?.provider;
  if (typeof provider !== 'string' || provider === '') return undefined;
  const model = typeof view.judge?.model === 'string' ? view.judge.model : '未知模型';
  return `判官来自 ${provider} · ${model}（不在候选 provider 集合里）。`;
}

/**
 * 解析一行斜杠命令（S9 §2.1 / §5 步骤 1：命令名到第一个空白为界；`//` 开头不算命令）。
 * @returns `{ matched, question }`；`matched=false` 时调用方走普通发送。
 */
export function parseBestofCommand(line: string): { matched: boolean; question: string } {
  const text = String(line ?? '');
  const trimmed = text.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return { matched: false, question: '' };
  const body = trimmed.slice(1);
  const space = body.search(/\s/u);
  const name = space === -1 ? body : body.slice(0, space);
  if (!BESTOF_COMMAND_NAMES.includes(name)) return { matched: false, question: '' };
  return { matched: true, question: (space === -1 ? '' : body.slice(space + 1)).trim() };
}

/** 浮层的阶段（S9 §6 的状态词表；`empty` 由「没有内容就 return null」承担）。 */
export type BestofPhase = 'idle' | 'confirm' | 'running' | 'ready' | 'stopped' | 'adopted' | 'rejected' | 'disabled' | 'error';

/** 一份候选能不能被采用（跑完的、或被人停下但已经有文字的）。 */
export function isUsable(candidate: BestofCandidate): boolean {
  return (candidate.status === 'done' || candidate.status === 'stopped') && candidate.text !== '';
}

/** 有没有至少一份可用候选。 */
export function usableCandidates(view: BestofView | undefined): BestofCandidate[] {
  return (view?.candidates ?? []).filter(isUsable);
}

/** 从 view 推出浮层阶段（人停下的那一轮与判官失败都是 `ready`，只是文案不同）。 */
export function bestofPhase(view: BestofView | undefined, { skippedByUser = false } = {}): BestofPhase {
  if (view === undefined) return 'idle';
  if (view.rejected === true) return 'rejected';
  if (view.adoptedId !== null) return 'adopted';
  if (view.finished !== true) return 'running';
  if (skippedByUser) return 'stopped';
  return 'ready';
}

/** 能不能点「采用某一份」。 */
export function canAdopt(view: BestofView): boolean {
  return view.finished === true && usableCandidates(view).length >= 1;
}

/** 能不能点「合并为一稿」（S9 §2.2 ③：≥2 份有效候选）。 */
export function canMerge(view: BestofView): boolean {
  return view.finished === true && usableCandidates(view).length >= 2;
}

/** 展示顺序：判官排序在前，没被排到的按原候选序跟在后面（回落时 ranking = 完成顺序）。 */
export function rankedCandidates(view: BestofView): BestofCandidate[] {
  const position = new Map((view.judge?.ranking ?? []).map((id, index) => [id, index]));
  return [...view.candidates].sort(
    (a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** 排名 Tag：判官给了有效排序就是「排序 N」，回落时改口径为「完成顺序 N」（S9 §2.3 ②）。 */
export function rankTag(view: BestofView, candidateId: string): string | undefined {
  const index = (view.judge?.ranking ?? []).indexOf(candidateId);
  if (index === -1) return undefined;
  return judgeUnavailable(view) ? `完成顺序第 ${index + 1}` : `排序 ${index + 1}`;
}

/** 判官有没有给出**有效**排序（回落 / 没跑 / 失败 / 同源都算「不可用」）。 */
export function judgeUnavailable(view: BestofView): boolean {
  const mode = view.judge?.mode;
  // `same-source`（票 28）的 ranking 是**完成顺序**，不是异源判官的排序：展示口径也必须改。
  if (mode === 'skipped' || mode === 'failed' || mode === 'same-source') return true;
  return typeof view.judge?.error === 'string' && view.judge.error !== '';
}

/** 判官不可用时的解释行（S9 §2.3 ①：一句人话 + 效力边界）。 */
export function fallbackNotice(view: BestofView): string | undefined {
  if (!judgeUnavailable(view)) return undefined;
  if (judgeSameSource(view)) {
    return `没有不在候选里的另一家 provider：这一轮没有异源判官，暂按先完成的一份排前（${view.judge?.error ?? '判官与候选同源'}）。这只影响排序展示，采用与否仍然由你点。`;
  }
  if (view.judge?.mode === 'skipped') {
    return view.judge.error ?? '只有一份可用候选，这一轮不跑判官（照样由你点采用）。';
  }
  return `判官不可用，暂按先完成的一份排前（${view.judge?.error ?? '判官未给出有效排序'}）。这只影响排序展示，不替你选 —— 采用与否仍然由你点。`;
}

/**
 * 费用文案（S9 §2.1 ② / §2.4 ②）：宿主没有价表就没有 `costUsd` → **「费用未知」**，
 * 绝不显示 `$0.0000` 那种看起来像实测值的假数。
 */
export function costLabel(view: BestofView | undefined): string {
  if (view === undefined || view.costUsd === undefined) return '费用未知';
  const amount = `$${view.costUsd.toFixed(4)}`;
  return view.costUsdComplete === false ? `${amount}（部分未知）` : amount;
}

/** 候选卡状态位（S9 §2.2 ①：`生成中` / `失败` / `{N} 字`，有值再追加耗时）。 */
export function candidateStatusLabel(candidate: BestofCandidate): string {
  if (candidate.status === 'running') return '生成中…';
  if (candidate.status === 'error') return `失败：${candidate.error ?? '未知原因'}`;
  const prefix = candidate.status === 'stopped' ? '已停止 · ' : '';
  const parts = [`${candidate.text.length} 字`];
  if (typeof candidate.elapsedMs === 'number') parts.push(`${(candidate.elapsedMs / 1000).toFixed(1)}s`);
  return `${prefix}${parts.join(' · ')}`;
}

/** 拍板载荷（三个动作的请求形状；`mergedText` 只有调用方真的要人手合并时才给）。 */
export function decisionPayload(
  runId: string,
  decision: BestofDecision,
  options: { adoptedId?: string; mergedText?: string } = {},
): { runId: string; decision: BestofDecision; adoptedId?: string; mergedText?: string } {
  const payload: { runId: string; decision: BestofDecision; adoptedId?: string; mergedText?: string } = { runId, decision };
  if (decision === 'adopt') {
    if (options.adoptedId === undefined) throw new Error('采用需要指明哪一份候选。');
    payload.adoptedId = options.adoptedId;
  }
  if (decision === 'merge' && options.mergedText !== undefined) payload.mergedText = options.mergedText;
  return payload;
}

/** 控制器对外暴露的状态快照。 */
export interface BestofUiState {
  phase: BestofPhase;
  /** 设置开关（默认**关**：用户故事 18「平时轻量、需要时再开」）。 */
  enabled: boolean;
  question: string;
  sessionId?: string;
  view?: BestofView;
  /**
   * 「有没有问事会话」这件事**问过一次**吗（`probeSession()` / `ask()` 会给）。
   *
   * 为什么要这个位：`sessionId === undefined` 只说明**还没问过**，不是「没有会话」。
   * 把两者混成一个，空态就永远不显示（首屏 `undefined`），或者反过来在还没问的时候
   * 就对用户说「你还没有会话」—— 前者是空态不可达，后者是编事实。
   */
  sessionKnown?: boolean;
  /**
   * 路由目录**读过一次**了吗（`loadRoutes()` / 估算成功会给）。
   *
   * 同一道理：`routes === undefined` 可能是「还没读」，也可能是「老宿主没有 `routes.list`」。
   * 只有**真读过**且确实 < 2 路，才够说「还没有两路可并列」。
   */
  routesKnown?: boolean;
  /** 可读失败（能力门 / 未知方法 / 网络）。 */
  error?: string;
  /** 一句提示（停不下来的降级、禁用态等）。 */
  notice?: string;
  /**
   * 同一轮合参的候选路由（票 28）：2–4 路，`provider::model` 去重。
   * 由路由目录的默认选路初始化，人可以在确认屏上增删；每次改动重算 estimate。
   */
  routes?: BestofRoute[];
  /** 只读路由目录（providers → models → keyConfigured、默认路由、可配置未注册）。 */
  catalog?: RouteCatalog;
  /** 跑前估算（`price` 恒为 `'unknown'`）。 */
  estimate?: BestofEstimate;
  /** 老宿主没有 `routes.list` / `bestof.estimate` 时的可读降级原因（不挡人跑 legacy 路径）。 */
  estimateError?: string;
  /**
   * 「采用稿到底有没有写进会话」的回执（task-15）。
   * 字段缺席 = 还没拍板，或宿主是老版本（没有投递面）→ 界面按成功态渲染。
   */
  delivery?: BestofDelivery;
}

/**
 * 采用态要不要挂警告（task-15）：只有**明确失败**才挂。
 *
 * 为什么 `ok !== false` 一律当成功：`delivery` 缺席是**老宿主**（契约里 `delivery` 是加性字段），
 * 那时采用稿照旧投递（旧宿主的行为），没有理由把「不知道」渲染成「失败」。
 */
export function deliveryNotice(delivery: BestofDelivery | undefined): string | undefined {
  if (delivery === undefined || delivery.ok !== false) return undefined;
  return `采用稿没能写进会话：${delivery.error ?? '原因未知'}`;
}

/** 控制器（浮层与设置行共用一份）。 */
export interface BestofController {
  snapshot(): BestofUiState;
  subscribe(listener: () => void): () => void;
  /** 设置开关。 */
  setEnabled(enabled: boolean): void;
  /** 命令 / 按钮触发：带问题直接进费用确认；不带问题先停在输入。 */
  ask(input: { question: string; sessionId: string }): void;
  /**
   * 报告一次「有没有问事会话」的探测结果（触发按钮挂载时问一次）。
   *
   * 只补「还不知道」的那一格：`undefined` = 探过、确实没有（触发路径拿不到会话）；
   * 已经有非空 `sessionId` 时不被这次探测覆盖（命令面给的 id 更准）。
   */
  probeSession(sessionId: string | undefined): void;
  /**
   * 读一次路由目录（设置项挂载时调；只读、不花钱）。
   * 没有 `routes.list` 的老宿主也记 `routesKnown`，但**不**把「拿不到」说成「只有零路」。
   */
  loadRoutes(signal?: AbortSignal): Promise<void>;
  /** 改问题（按钮触发时的那一行输入）。 */
  editQuestion(question: string): void;
  /** 重新读路由目录 + 重算 estimate（纯只读；确认屏打开时自动调一次）。 */
  refreshEstimate(signal?: AbortSignal): Promise<void>;
  /** 在确认屏上增删一路路由（上限 4 路；每次改动重算 estimate）。 */
  toggleRoute(route: BestofRoute): Promise<void>;
  /** 费用确认框的 `[开始合参]`（**唯一**会发起 run 的入口；带 `confirm:true`）。 */
  confirm(signal?: AbortSignal): Promise<void>;
  /** 费用确认框的 `[取消]`。 */
  dismiss(): void;
  /** 「停止全部」：优先真停，调不到就如实降级。 */
  stop(): Promise<void>;
  adopt(adoptedId: string): Promise<void>;
  merge(mergedText?: string): Promise<void>;
  reject(): Promise<void>;
}

/**
 * 造一个合参控制器。
 * @param options.api 数据面（`createBestofApi`）
 * @param options.pollMs 轮询间隔（缺省 400ms；断言台用 1ms）
 */
export function createBestofController({ api, pollMs = 400 }: { api: BestofApi; pollMs?: number }): BestofController {
  let state: BestofUiState = { phase: 'idle', enabled: false, question: '' };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stoppedByUser = false;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const set = (patch: Partial<BestofUiState>): void => {
    state = { ...state, ...patch };
    notify();
  };
  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const message = (error: unknown): string => String((error as Error)?.message ?? error);
  /** 估算请求的代次：改问题 / 改路由之后，旧回包一律丢弃（与轮询的换轮丢弃同一口径）。 */
  let estimateToken = 0;
  /** estimate 是对哪一版问题算的：问题改了它就作废（不在每次按键都发请求）。 */
  let estimateFor: string | undefined;

  /**
   * 读路由目录 + 算 estimate（**纯只读**）。老宿主没有这两个方法时如实记 `estimateError`，
   * 由 `confirm()` 退回 legacy 载荷 —— 不因为读不到估计就挡住人。
   */
  async function loadEstimate(signal?: AbortSignal): Promise<void> {
    const token = estimateToken + 1;
    estimateToken = token;
    const question = state.question.trim();
    const sessionId = state.sessionId;
    if (sessionId === undefined || sessionId === '') return;
    if (question === '') return;
    try {
      let catalog = state.catalog;
      if (catalog === undefined && typeof api.listRoutes === 'function') {
        try {
          catalog = await api.listRoutes(signal);
        } catch {
          // 路由目录读不到不挡路：estimate 仍可按默认路由算（或老宿主直接降级）。
          catalog = undefined;
        }
      }
      if (token !== estimateToken) return;
      const routes = state.routes ?? (catalog === undefined ? undefined : defaultRouteSelection(catalog));
      if (typeof api.estimate !== 'function') throw new Error('这个宿主没有 bestof.estimate（老版本）：无法给出跑前估算。');
      const estimate = await api.estimate({ sessionId, question, ...(routes === undefined || routes.length === 0 ? {} : { routes }) }, signal);
      if (token !== estimateToken) return;
      estimateFor = question;
      const selected = state.routes ?? estimate.routes.map(({ provider, model }) => ({ provider, model }));
      // 估算拿到手 = 路由是**真读过**的一版，从此「有没有两路」可以据实说（空态才敢开口）。
      set({ ...(catalog === undefined ? {} : { catalog }), estimate, estimateError: undefined, routes: selected, routesKnown: true });
    } catch (error) {
      if (token !== estimateToken) return;
      set({ estimate: undefined, estimateError: message(error) });
    }
  }

  /** 轮询到这一轮结束（`finished`）；失败也停（界面显示可读错误）。 */
  async function poll(runId: string): Promise<void> {
    try {
      const view = await api.state({ runId });
      if (state.view?.runId !== runId) return; // 已经换了另一轮：旧回包丢掉
      // 冷读的视图里宿主会在投递失败时带 `delivery`；成功时带 `deliveredAt` —— 说同一句话。
      set({ view, phase: bestofPhase(view, { skippedByUser: stoppedByUser }), delivery: view.delivery });
      if (view.finished === true) {
        clearTimer();
        return;
      }
    } catch (error) {
      clearTimer();
      set({ error: message(error), phase: 'error' });
      return;
    }
    timer = setTimeout(() => {
      void poll(runId);
    }, pollMs);
  }

  /** 在同一轮里只发一次目录读（设置行与浮层可能同时挂载；重复读没有意义）。 */
  let catalogInFlight: Promise<void> | undefined;

  /**
   * 读一次路由目录（**只读**，不算 estimate、不花钱）。
   *
   * 为什么需要它：`routes` 原先只在 `loadEstimate()`（要问题 + 会话）成功后才有值，
   * 所以设置项在首屏永远是空白 —— 空态写着「还没有两路可并列」，却一次都没去读过目录。
   * 这条路径让人一打开设置就能得到真答案：确实不足两路 → 空态；读不到 → `routesKnown` 置位
   * 但 `routes` 保持缺席（不冒充「零路」）。
   */
  async function loadRoutes(signal?: AbortSignal): Promise<void> {
    if (state.routesKnown === true) return;
    if (catalogInFlight !== undefined) return catalogInFlight;
    if (typeof api.listRoutes !== 'function') {
      // 老宿主没有 `routes.list`：读不到 ≠ 只有零路，如实记「问过了、拿不到」。
      set({ routesKnown: true });
      return;
    }
    catalogInFlight = (async () => {
      try {
        const catalog = await api.listRoutes(signal);
        set({ catalog, routes: state.routes ?? defaultRouteSelection(catalog), routesKnown: true });
      } catch (error) {
        set({ routesKnown: true, estimateError: message(error) });
      } finally {
        catalogInFlight = undefined;
      }
    })();
    return catalogInFlight;
  }

  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setEnabled(enabled) {
      set({ enabled });
      if (enabled && state.phase === 'disabled') set({ phase: 'idle', notice: undefined });
    },
    ask({ question, sessionId }) {
      stoppedByUser = false;
      if (!state.enabled) {
        // S9 §6 禁用态：不静默改走普通问答，也不假装开始。
        set({ phase: 'disabled', question, sessionId, sessionKnown: true, view: undefined, error: undefined, notice: '多 AI 合参当前是关的：去 设置 · 通用 里打开它。' });
        return;
      }
      // 确认屏先开，**只读**的 estimate 在后台补上（不调 run；人点「开始合参」才跑）。
      set({
        phase: 'confirm',
        question,
        sessionId,
        // 这一次触发已经给出了会话 id（哪怕是空串 = 确实没有）：从此别再说「还不知道」。
        sessionKnown: true,
        view: undefined,
        error: undefined,
        notice: undefined,
        catalog: undefined,
        estimate: undefined,
        estimateError: undefined,
        routes: undefined,
      });
      estimateFor = undefined;
      void loadEstimate();
    },
    probeSession(sessionId) {
      // 只补「还不知道」的那一格：已经有的会话（命令面 / 触发面给过）不许被一次探测覆盖。
      const known = state.sessionId;
      const resolved = sessionId ?? '';
      set({ ...(known === undefined || known === '' ? { sessionId: resolved } : {}), sessionKnown: true });
    },
    async loadRoutes(signal) {
      await loadRoutes(signal);
    },
    editQuestion(question) {
      // 问题一变，「≈ N tokens」就作废；但**不在每次按键都发请求**（下一次 confirm 会补算）。
      const stale = estimateFor !== undefined && estimateFor !== question.trim();
      set({ question, ...(stale ? { estimate: undefined, estimateError: undefined } : {}) });
    },
    async refreshEstimate(signal) {
      await loadEstimate(signal);
    },
    async toggleRoute(route) {
      const current = state.routes ?? [];
      const key = routeKey(route);
      const exists = current.some((entry) => routeKey(entry) === key);
      let next = exists
        ? current.filter((entry) => routeKey(entry) !== key)
        : [...current, { provider: route.provider, ...(route.model === undefined ? {} : { model: route.model }) }];
      // 超过 4 路的点击直接不生效（界面上的 checkbox 也会因此保持未选中）。
      if (next.length > BESTOF_MAX_ROUTES) next = current;
      set({ routes: next, estimate: undefined, estimateError: undefined });
      await loadEstimate();
    },
    async confirm(signal) {
      const question = state.question.trim();
      if (question === '') {
        set({ phase: 'confirm', error: '写上要合参的问题。' });
        return;
      }
      // 空串也是「没有会话」：按钮触发那条路径拿不到 sessionId 时会走到这里。
      if (state.sessionId === undefined || state.sessionId === '') {
        set({ phase: 'confirm', error: '还没有问事会话：先去「问事」开一次会话。' });
        return;
      }
      // 人点的时候 estimate 可能还在路上：等它一次（只读，不花钱），再决定走哪条载荷。
      if (state.estimate === undefined && state.estimateError === undefined) await loadEstimate(signal);
      const routes = state.routes;
      if (routes !== undefined && routes.length > 0) {
        // 人已经选了路由，但 estimate 读不到：**不许**静默退回 legacy（那会换掉他选的路由）。
        if (state.estimate === undefined) {
          set({ phase: 'confirm', error: `跑前估算不可用（${state.estimateError ?? '未知原因'}）：不能带着显式路由开跑，稍后重试或换回默认两路。` });
          return;
        }
        const problem = routeSelectionProblem(routes);
        if (problem !== undefined) {
          set({ phase: 'confirm', error: problem });
          return;
        }
      }
      // estimate 可用 → 走票 28 的显式路由 + `confirm:true`；老宿主/估算失败 → 退回票 11 的 legacy 载荷。
      const explicit = state.estimate !== undefined && routes !== undefined && routes.length >= BESTOF_MIN_ROUTES;
      const payload = explicit
        ? {
          sessionId: state.sessionId,
          question,
          routes: routes.map((route) => ({ provider: route.provider, model: route.model })),
          confirm: true,
        }
        : { sessionId: state.sessionId, question, angles: BESTOF_ANGLE_OPTIONS.map((option) => option.id) };
      try {
        const view = await api.run(payload, signal);
        stoppedByUser = false;
        set({ phase: bestofPhase(view), view, error: undefined, notice: undefined });
        if (view.finished !== true) {
          clearTimer();
          timer = setTimeout(() => {
            void poll(view.runId);
          }, pollMs);
        }
      } catch (error) {
        set({ phase: 'error', error: message(error) });
      }
    },
    dismiss() {
      clearTimer();
      estimateToken += 1; // 丢掉在途 estimate
      set({
        phase: 'idle',
        view: undefined,
        question: '',
        error: undefined,
        notice: undefined,
        catalog: undefined,
        estimate: undefined,
        estimateError: undefined,
        routes: undefined,
      });
    },
    async stop() {
      const view = state.view;
      if (view === undefined) return;
      stoppedByUser = true;
      clearTimer();
      try {
        const { bestOf } = await api.cancel({ runId: view.runId });
        set({ view: bestOf, phase: bestofPhase(bestOf, { skippedByUser: true }), notice: undefined });
      } catch (error) {
        // 宿主没有 `bestof.cancel`（老版本）或调用失败：本地停止 + **如实说明**。
        set({
          view: { ...view, finished: true, judge: { ...view.judge, mode: 'skipped', skipped: true, error: '已停止（本地）：这一轮仍在后台跑完，结果会在下次打开时出现。' } },
          phase: 'stopped',
          notice: `停不下来这一轮（${message(error)}）：已在本机停止查看，后台仍会跑完。`,
        });
      }
    },
    async adopt(adoptedId) {
      const view = state.view;
      if (view === undefined) return;
      try {
        const { bestOf, delivery } = await api.adopt(decisionPayload(view.runId, 'adopt', { adoptedId }));
        set({ view: bestOf, phase: bestofPhase(bestOf), error: undefined, delivery });
      } catch (error) {
        set({ error: message(error) });
      }
    },
    async merge(mergedText) {
      const view = state.view;
      if (view === undefined) return;
      try {
        const { bestOf, delivery } = await api.adopt(decisionPayload(view.runId, 'merge', { mergedText }));
        set({ view: bestOf, phase: bestofPhase(bestOf), error: undefined, delivery });
      } catch (error) {
        set({ error: message(error) });
      }
    },
    async reject() {
      const view = state.view;
      if (view === undefined) return;
      try {
        const { bestOf, delivery } = await api.adopt(decisionPayload(view.runId, 'reject'));
        // 否决不投递：把上一轮可能剩下的回执清掉（否则界面会拿旧警告说新状态）。
        set({ view: bestOf, phase: bestofPhase(bestOf), error: undefined, delivery });
      } catch (error) {
        set({ error: message(error) });
      }
    },
  };
}
