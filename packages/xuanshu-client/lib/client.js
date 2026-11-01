window.__ModuleLoader__.load({
	id: "xuanshu-client",
	factory: (require) => {
		"use strict";
		var module = { exports: {} };
		var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react24 = require("react");

// src/client/rpc.ts
var RPC_PATH = "/api/xuanshu";
async function rpcCall(_ctx, method, payload = {}, signal) {
  const response = await fetch(RPC_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, payload }),
    ...signal === void 0 ? {} : { signal }
  });
  if (!response.ok) throw new Error(`transport failure for ${RPC_PATH}: HTTP ${response.status}`);
  const body = await response.json();
  if (body?.ok === true) return body.value;
  throw new Error(body?.error?.message ?? `${method} 调用失败（宿主没有给原因）`);
}

// src/client/bazi-api.ts
var BAZI_ENDPOINTS = {
  status: "bazi.status",
  snapshot: "bazi.snapshot",
  basePu: "bazi.basePu",
  cities: "bazi.cities",
  timezone: "bazi.timezone",
  cast: "bazi.cast"
};
function createBaziApi(ctx) {
  return {
    status: (signal) => rpcCall(ctx, BAZI_ENDPOINTS.status, {}, signal),
    snapshot: (signal) => rpcCall(ctx, BAZI_ENDPOINTS.snapshot, {}, signal),
    basePu: (signal) => rpcCall(ctx, BAZI_ENDPOINTS.basePu, {}, signal),
    cities: (payload, signal) => rpcCall(ctx, BAZI_ENDPOINTS.cities, payload, signal),
    timezone: (payload, signal) => rpcCall(ctx, BAZI_ENDPOINTS.timezone, payload, signal),
    cast: (request, signal) => rpcCall(ctx, BAZI_ENDPOINTS.cast, request, signal)
  };
}

// src/client/ctx-service.ts
function readService(ctx, name) {
  const get = ctx?.get;
  if (typeof get !== "function") return void 0;
  return get.call(ctx, name);
}

// src/client/bazi-controller.ts
function createBaziUiController() {
  let revision = 0;
  let prefill;
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    getRevision: () => revision,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    invalidate() {
      revision += 1;
      notify();
    },
    requestRerecord(draft) {
      prefill = draft;
      revision += 1;
      notify();
    },
    consumePrefill() {
      const current = prefill;
      prefill = void 0;
      return current;
    }
  };
}

// src/client/bestof-api.ts
var BESTOF_ENDPOINTS = {
  run: "bestof.run",
  state: "bestof.state",
  adopt: "bestof.adopt",
  cancel: "bestof.cancel",
  /** 票 28：只读路由清单（providers → models → keyConfigured、默认路由、可配置未注册）。 */
  routes: "routes.list",
  /** 票 28：跑前估算（N 路 × model × 输入规模 + price:'unknown'），纯只读。 */
  estimate: "bestof.estimate"
};
function createBestofApi(ctx) {
  return {
    run: (payload, signal) => rpcCall(ctx, BESTOF_ENDPOINTS.run, payload, signal),
    state: (payload, signal) => rpcCall(ctx, BESTOF_ENDPOINTS.state, payload, signal),
    adopt: (payload, signal) => rpcCall(ctx, BESTOF_ENDPOINTS.adopt, payload, signal),
    cancel: (payload, signal) => rpcCall(ctx, BESTOF_ENDPOINTS.cancel, payload, signal),
    listRoutes: (signal) => rpcCall(ctx, BESTOF_ENDPOINTS.routes, {}, signal),
    estimate: (payload, signal) => rpcCall(ctx, BESTOF_ENDPOINTS.estimate, payload, signal)
  };
}

// src/client/ai-api.ts
function createAiApi(ctx) {
  return {
    routes: (signal) => rpcCall(ctx, BESTOF_ENDPOINTS.routes, {}, signal)
  };
}

// src/client/ai-model.ts
var AI_SETTINGS_PATH = "设置 → 模型";
var AI_POLL_MS = 5e3;
var ROUTES_SCHEMA = "xuanshu/routes@1";
function textOf(value) {
  return typeof value === "string" && value !== "" ? value : void 0;
}
var NEXT_TO_SETTINGS = `打开 DSH「${AI_SETTINGS_PATH}」添加 / 选择。`;
function providerLine(entry, defaultProvider) {
  const keyConfigured = entry.keyConfigured === true || entry.keyConfigured === false ? entry.keyConfigured : "unknown";
  const modelsKnown = entry.modelsKnown === true;
  const models = Array.isArray(entry.models) ? entry.models.filter((model) => typeof model === "object" && model !== null).filter((model) => textOf(model.id) !== void 0).map((model) => ({ id: model.id, name: textOf(model.name) ?? null })) : [];
  const id = textOf(entry.id) ?? "";
  return {
    id,
    name: textOf(entry.name) ?? null,
    registered: entry.registered === true,
    keyConfigured,
    modelsKnown,
    modelCount: models.length,
    models,
    isDefaultProvider: defaultProvider === null || defaultProvider === void 0 ? null : defaultProvider === id,
    usable: entry.registered === true && keyConfigured !== false && modelsKnown && models.length > 0
  };
}
function defaultOf(value) {
  if (typeof value !== "object" || value === null) return null;
  const provider = textOf(Reflect.get(value, "provider"));
  const model = textOf(Reflect.get(value, "model"));
  return provider === void 0 || model === void 0 ? null : { provider, model };
}
function unavailable(detail, checkedAt) {
  return {
    configured: "unknown",
    known: false,
    providers: [],
    defaultModel: null,
    reason: {
      code: "unavailable",
      text: "读不到 AI 状态（路由清单服务不可用）—— 这不等于「没配」。",
      next: "点「重试」再检测一次；仍然读不到就去「设置 → 模型」看看。"
    },
    ...detail === void 0 ? {} : { detail },
    checkedAt
  };
}
function deriveAiReadiness(catalog, options = {}) {
  const checkedAt = options.now ?? (/* @__PURE__ */ new Date()).toISOString();
  if (catalog === null || catalog === void 0) return unavailable(options.detail, checkedAt);
  if (catalog.ok !== true) {
    return unavailable(textOf(catalog.reason) ?? options.detail, checkedAt);
  }
  if (catalog.schema !== ROUTES_SCHEMA || !Array.isArray(catalog.providers)) {
    return unavailable(options.detail ?? `路由清单形状不符（期望 ${ROUTES_SCHEMA}）。`, checkedAt);
  }
  const defaultModel = defaultOf(catalog.default);
  const providers = catalog.providers.filter((entry) => typeof entry === "object" && entry !== null).map((entry) => providerLine(entry, defaultModel?.provider)).filter((line) => line.id !== "");
  const base = {
    providers,
    defaultModel,
    // providers 是逐家的「事实上有什么」；configured 另算（见文件头判据）。
    checkedAt
  };
  const usable = providers.filter((line) => line.usable);
  if (defaultModel !== null) {
    const backed = usable.find((line) => line.id === defaultModel.provider);
    if (backed !== void 0) {
      const keyUnknown = backed.keyConfigured === "unknown";
      return {
        configured: true,
        known: true,
        ...base,
        reason: {
          code: keyUnknown ? "ready-key-unknown" : "ready",
          text: keyUnknown ? `配置齐了：${backed.name ?? backed.id} · ${defaultModel.model}，密钥状态读不到（设置服务没回应）：先按可用处理，真发不出去时会有报错。` : `配置齐了：${backed.name ?? backed.id} · ${defaultModel.model}。这是看清单得出的，没有真发一次请求试通；发不出去时会在用的地方告诉你。`,
          next: keyUnknown ? `若问事失败，去「${AI_SETTINGS_PATH}」核对密钥。` : "可以问事了。"
        }
      };
    }
  }
  const reason = missingReason(providers, defaultModel);
  return { configured: false, known: true, ...base, reason };
}
function createAiReadinessController(options) {
  const pollMs = options.pollMs ?? AI_POLL_MS;
  const now = options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const focus = options.focus === void 0 ? typeof globalThis.window === "undefined" ? void 0 : globalThis.window : options.focus ?? void 0;
  let snapshot = { checking: false };
  let consumers = 0;
  let timer;
  let listening = false;
  let disposed = false;
  let sequence = 0;
  const listeners = /* @__PURE__ */ new Set();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const assign = (next) => {
    snapshot = next;
    emit();
  };
  const syncTimer = () => {
    const shouldPoll = !disposed && consumers > 0 && snapshot.readiness?.configured !== true;
    if (shouldPoll && timer === void 0) {
      timer = setInterval(() => {
        void refresh();
      }, pollMs);
    } else if (!shouldPoll && timer !== void 0) {
      clearInterval(timer);
      timer = void 0;
    }
  };
  const refresh = async () => {
    if (disposed) return;
    const mine = ++sequence;
    assign({ ...snapshot, checking: true });
    try {
      const catalog = await options.api.routes();
      if (disposed || mine !== sequence) return;
      assign({ readiness: deriveAiReadiness(catalog, { now: now() }), checking: false });
    } catch (error) {
      if (disposed || mine !== sequence) return;
      const detail = error instanceof Error ? error.message : String(error);
      assign({ readiness: deriveAiReadiness(void 0, { now: now(), detail }), checking: false });
    }
    syncTimer();
  };
  const onFocus = () => {
    void refresh();
  };
  const listen = () => {
    if (listening || disposed) return;
    if (typeof focus?.addEventListener !== "function") return;
    focus.addEventListener("focus", onFocus);
    listening = true;
  };
  const unlisten = () => {
    if (!listening) return;
    if (typeof focus?.removeEventListener === "function") focus.removeEventListener("focus", onFocus);
    listening = false;
  };
  return {
    snapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      if (disposed) return () => {
      };
      consumers += 1;
      if (consumers === 1) listen();
      syncTimer();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        consumers = Math.max(0, consumers - 1);
        if (consumers === 0) unlisten();
        syncTimer();
      };
    },
    refresh,
    dispose: () => {
      disposed = true;
      consumers = 0;
      unlisten();
      if (timer !== void 0) {
        clearInterval(timer);
        timer = void 0;
      }
      listeners.clear();
    }
  };
}
function missingReason(providers, defaultModel) {
  if (providers.length === 0) {
    return {
      code: "no-provider",
      text: "还没有可用的 AI provider（宿主没有注册任何一家）。",
      next: NEXT_TO_SETTINGS
    };
  }
  if (defaultModel === null) {
    return {
      code: "no-default-model",
      text: "有已注册的 provider，但还没有默认模型 —— 问事会因此开不了口。",
      next: `打开 DSH「${AI_SETTINGS_PATH}」选一个默认模型。`
    };
  }
  const target = providers.find((line) => line.id === defaultModel.provider);
  if (target === void 0) {
    return {
      code: "default-provider-missing",
      text: `默认模型指向 ${defaultModel.provider}，但它不在已注册的 provider 里。`,
      next: `打开 DSH「${AI_SETTINGS_PATH}」重新选一个默认模型。`
    };
  }
  if (target.keyConfigured === false) {
    return {
      code: "missing-key",
      text: `${target.name ?? target.id} 已有模型，但这个提供商没有配置密钥（key）。`,
      next: `打开 DSH「${AI_SETTINGS_PATH}」给 ${target.name ?? target.id} 填上密钥。`
    };
  }
  if (!target.modelsKnown) {
    return {
      code: "models-unreadable",
      text: `${target.name ?? target.id} 已注册，但读不到它的模型清单 —— 这不等于「没有模型」。`,
      next: "点「重新检测」再试一次；仍然读不到就去「设置 → 模型」核对。"
    };
  }
  if (target.modelCount === 0) {
    return {
      code: "no-model",
      text: `${target.name ?? target.id} 已注册，但模型清单里还没有可用的模型。`,
      next: `打开 DSH「${AI_SETTINGS_PATH}」给这个提供商加一个模型。`
    };
  }
  return {
    code: "default-provider-missing",
    text: `默认模型 ${defaultModel.provider} · ${defaultModel.model} 还不是一个可用路由。`,
    next: `打开 DSH「${AI_SETTINGS_PATH}」重新选择。`
  };
}

// src/client/bestof-model.ts
var BESTOF_COMMAND_NAME = "多模型";
var BESTOF_COMMAND_ALIASES = ["合参", "bestof"];
var BESTOF_COMMAND_NAMES = [BESTOF_COMMAND_NAME, ...BESTOF_COMMAND_ALIASES];
var BESTOF_ANGLE_OPTIONS = [
  { id: "classic", name: "经典派" },
  { id: "cautious", name: "审慎派" }
];
var BESTOF_MIN_ROUTES = 2;
var BESTOF_MAX_ROUTES = 4;
function routeKey(route) {
  return `${route.provider}::${route.model ?? ""}`;
}
function defaultOfRoute(providerDefault, modelDefault) {
  if (providerDefault === null || providerDefault === void 0) return null;
  if (modelDefault === null || modelDefault === void 0) return null;
  return providerDefault === true && modelDefault === true;
}
function flattenCatalogRoutes(catalog) {
  const options = [];
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
        isDefault: defaultOfRoute(provider.isDefault, model.isDefault)
      });
    }
  }
  return options;
}
function defaultRouteSelection(catalog, { min = BESTOF_MIN_ROUTES, max = BESTOF_MAX_ROUTES } = {}) {
  const options = flattenCatalogRoutes(catalog);
  if (options.length === 0) return [];
  const preferred = options.find((option) => option.isDefault === true) ?? options[0];
  if (preferred === void 0) return [];
  const preferredProvider = preferred.provider;
  const picked = [];
  const push = (option) => {
    if (option === void 0) return;
    if (picked.some((entry) => routeKey(entry) === routeKey(option))) return;
    picked.push(option);
  };
  push(preferred);
  push(options.find((option) => option.provider !== preferredProvider));
  for (const option of options) {
    if (picked.length >= Math.min(min, max, options.length)) break;
    push(option);
  }
  return picked.slice(0, max).map((option) => ({ provider: option.provider, model: option.model }));
}
function routeSelectionProblem(routes) {
  const list = Array.isArray(routes) ? routes : [];
  if (list.length < BESTOF_MIN_ROUTES) return `合参至少两路（现在 ${list.length} 路）：再选一家 provider 或 model。`;
  if (list.length > BESTOF_MAX_ROUTES) return `合参最多四路（现在 ${list.length} 路）：去掉几路再跑。`;
  if (new Set(list.map(routeKey)).size !== list.length) return "有重复路由（同一个 provider::model 只能算一路）。";
  return void 0;
}
function keyConfiguredLabel(value) {
  if (value === true) return "已配 key";
  if (value === false) return "缺 key";
  return "未知";
}
function estimateInputLabel(estimate) {
  if (estimate === void 0 || !Number.isFinite(estimate.inputTokens)) return "输入规模未知（估算不可用）";
  return `≈ ${estimate.inputTokens} tokens/路（估算）`;
}
function estimatePriceLabel(estimate) {
  return estimate?.price === "unknown" || estimate === void 0 ? "金额未知" : "金额未知";
}
function judgeSameSource(view) {
  return view?.judge?.mode === "same-source" || view?.judge?.source === "same-source";
}
function judgeSourceNotice(view) {
  if (view === void 0) return void 0;
  if (judgeSameSource(view)) {
    return `判官与候选同源：${view.judge.error ?? "没有不在候选里的另一家 provider"}（暂按完成顺序排前）`;
  }
  const provider = view.judge?.provider;
  if (typeof provider !== "string" || provider === "") return void 0;
  const model = typeof view.judge?.model === "string" ? view.judge.model : "未知模型";
  return `判官来自 ${provider} · ${model}（不在候选 provider 集合里）。`;
}
function isUsable(candidate) {
  return (candidate.status === "done" || candidate.status === "stopped") && candidate.text !== "";
}
function usableCandidates(view) {
  return (view?.candidates ?? []).filter(isUsable);
}
function bestofPhase(view, { skippedByUser = false } = {}) {
  if (view === void 0) return "idle";
  if (view.rejected === true) return "rejected";
  if (view.adoptedId !== null) return "adopted";
  if (view.finished !== true) return "running";
  if (skippedByUser) return "stopped";
  return "ready";
}
function canAdopt(view) {
  return view.finished === true && usableCandidates(view).length >= 1;
}
function canMerge(view) {
  return view.finished === true && usableCandidates(view).length >= 2;
}
function rankedCandidates(view) {
  const position = new Map((view.judge?.ranking ?? []).map((id, index) => [id, index]));
  return [...view.candidates].sort(
    (a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}
function rankTag(view, candidateId) {
  const index = (view.judge?.ranking ?? []).indexOf(candidateId);
  if (index === -1) return void 0;
  return judgeUnavailable(view) ? `完成顺序第 ${index + 1}` : `排序 ${index + 1}`;
}
function judgeUnavailable(view) {
  const mode = view.judge?.mode;
  if (mode === "skipped" || mode === "failed" || mode === "same-source") return true;
  return typeof view.judge?.error === "string" && view.judge.error !== "";
}
function fallbackNotice(view) {
  if (!judgeUnavailable(view)) return void 0;
  if (judgeSameSource(view)) {
    return `没有不在候选里的另一家 provider：这一轮没有异源判官，暂按先完成的一份排前（${view.judge?.error ?? "判官与候选同源"}）。这只影响排序展示，采用与否仍然由你点。`;
  }
  if (view.judge?.mode === "skipped") {
    return view.judge.error ?? "只有一份可用候选，这一轮不跑判官（照样由你点采用）。";
  }
  return `判官不可用，暂按先完成的一份排前（${view.judge?.error ?? "判官未给出有效排序"}）。这只影响排序展示，不替你选 —— 采用与否仍然由你点。`;
}
function costLabel(view) {
  if (view === void 0 || view.costUsd === void 0) return "费用未知";
  const amount = `$${view.costUsd.toFixed(4)}`;
  return view.costUsdComplete === false ? `${amount}（部分未知）` : amount;
}
function candidateStatusLabel(candidate) {
  if (candidate.status === "running") return "生成中…";
  if (candidate.status === "error") return `失败：${candidate.error ?? "未知原因"}`;
  const prefix = candidate.status === "stopped" ? "已停止 · " : "";
  const parts = [`${candidate.text.length} 字`];
  if (typeof candidate.elapsedMs === "number") parts.push(`${(candidate.elapsedMs / 1e3).toFixed(1)}s`);
  return `${prefix}${parts.join(" · ")}`;
}
function decisionPayload(runId, decision, options = {}) {
  const payload = { runId, decision };
  if (decision === "adopt") {
    if (options.adoptedId === void 0) throw new Error("采用需要指明哪一份候选。");
    payload.adoptedId = options.adoptedId;
  }
  if (decision === "merge" && options.mergedText !== void 0) payload.mergedText = options.mergedText;
  return payload;
}
function deliveryNotice(delivery) {
  if (delivery === void 0 || delivery.ok !== false) return void 0;
  return `采用稿没能写进会话：${delivery.error ?? "原因未知"}`;
}
function createBestofController({ api, pollMs = 400 }) {
  let state = { phase: "idle", enabled: false, question: "" };
  const listeners = /* @__PURE__ */ new Set();
  let timer;
  let stoppedByUser = false;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const set = (patch) => {
    state = { ...state, ...patch };
    notify();
  };
  const clearTimer = () => {
    if (timer !== void 0) clearTimeout(timer);
    timer = void 0;
  };
  const message = (error) => String(error?.message ?? error);
  let estimateToken = 0;
  let estimateFor;
  async function loadEstimate(signal) {
    const token = estimateToken + 1;
    estimateToken = token;
    const question = state.question.trim();
    const sessionId = state.sessionId;
    if (sessionId === void 0 || sessionId === "") return;
    if (question === "") return;
    try {
      let catalog = state.catalog;
      if (catalog === void 0 && typeof api.listRoutes === "function") {
        try {
          catalog = await api.listRoutes(signal);
        } catch {
          catalog = void 0;
        }
      }
      if (token !== estimateToken) return;
      const routes = state.routes ?? (catalog === void 0 ? void 0 : defaultRouteSelection(catalog));
      if (typeof api.estimate !== "function") throw new Error("这个宿主没有 bestof.estimate（老版本）：无法给出跑前估算。");
      const estimate = await api.estimate({ sessionId, question, ...routes === void 0 || routes.length === 0 ? {} : { routes } }, signal);
      if (token !== estimateToken) return;
      estimateFor = question;
      const selected = state.routes ?? estimate.routes.map(({ provider, model }) => ({ provider, model }));
      set({ ...catalog === void 0 ? {} : { catalog }, estimate, estimateError: void 0, routes: selected, routesKnown: true });
    } catch (error) {
      if (token !== estimateToken) return;
      set({ estimate: void 0, estimateError: message(error) });
    }
  }
  async function poll(runId) {
    try {
      const view = await api.state({ runId });
      if (state.view?.runId !== runId) return;
      set({ view, phase: bestofPhase(view, { skippedByUser: stoppedByUser }), delivery: view.delivery });
      if (view.finished === true) {
        clearTimer();
        return;
      }
    } catch (error) {
      clearTimer();
      set({ error: message(error), phase: "error" });
      return;
    }
    timer = setTimeout(() => {
      void poll(runId);
    }, pollMs);
  }
  let catalogInFlight;
  async function loadRoutes(signal) {
    if (state.routesKnown === true) return;
    if (catalogInFlight !== void 0) return catalogInFlight;
    if (typeof api.listRoutes !== "function") {
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
        catalogInFlight = void 0;
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
      if (enabled && state.phase === "disabled") set({ phase: "idle", notice: void 0 });
    },
    ask({ question, sessionId }) {
      stoppedByUser = false;
      if (!state.enabled) {
        set({ phase: "disabled", question, sessionId, sessionKnown: true, view: void 0, error: void 0, notice: "多 AI 合参当前是关的：去 设置 · 通用 里打开它。" });
        return;
      }
      set({
        phase: "confirm",
        question,
        sessionId,
        // 这一次触发已经给出了会话 id（哪怕是空串 = 确实没有）：从此别再说「还不知道」。
        sessionKnown: true,
        view: void 0,
        error: void 0,
        notice: void 0,
        catalog: void 0,
        estimate: void 0,
        estimateError: void 0,
        routes: void 0
      });
      estimateFor = void 0;
      void loadEstimate();
    },
    probeSession(sessionId) {
      const known = state.sessionId;
      const resolved = sessionId ?? "";
      set({ ...known === void 0 || known === "" ? { sessionId: resolved } : {}, sessionKnown: true });
    },
    async loadRoutes(signal) {
      await loadRoutes(signal);
    },
    editQuestion(question) {
      const stale = estimateFor !== void 0 && estimateFor !== question.trim();
      set({ question, ...stale ? { estimate: void 0, estimateError: void 0 } : {} });
    },
    async refreshEstimate(signal) {
      await loadEstimate(signal);
    },
    async toggleRoute(route) {
      const current = state.routes ?? [];
      const key = routeKey(route);
      const exists = current.some((entry) => routeKey(entry) === key);
      let next = exists ? current.filter((entry) => routeKey(entry) !== key) : [...current, { provider: route.provider, ...route.model === void 0 ? {} : { model: route.model } }];
      if (next.length > BESTOF_MAX_ROUTES) next = current;
      set({ routes: next, estimate: void 0, estimateError: void 0 });
      await loadEstimate();
    },
    async confirm(signal) {
      const question = state.question.trim();
      if (question === "") {
        set({ phase: "confirm", error: "写上要合参的问题。" });
        return;
      }
      if (state.sessionId === void 0 || state.sessionId === "") {
        set({ phase: "confirm", error: "还没有问事会话：先去「问事」开一次会话。" });
        return;
      }
      if (state.estimate === void 0 && state.estimateError === void 0) await loadEstimate(signal);
      const routes = state.routes;
      if (routes !== void 0 && routes.length > 0) {
        if (state.estimate === void 0) {
          set({ phase: "confirm", error: `跑前估算不可用（${state.estimateError ?? "未知原因"}）：不能带着显式路由开跑，稍后重试或换回默认两路。` });
          return;
        }
        const problem = routeSelectionProblem(routes);
        if (problem !== void 0) {
          set({ phase: "confirm", error: problem });
          return;
        }
      }
      const explicit = state.estimate !== void 0 && routes !== void 0 && routes.length >= BESTOF_MIN_ROUTES;
      const payload = explicit ? {
        sessionId: state.sessionId,
        question,
        routes: routes.map((route) => ({ provider: route.provider, model: route.model })),
        confirm: true
      } : { sessionId: state.sessionId, question, angles: BESTOF_ANGLE_OPTIONS.map((option) => option.id) };
      try {
        const view = await api.run(payload, signal);
        stoppedByUser = false;
        set({ phase: bestofPhase(view), view, error: void 0, notice: void 0 });
        if (view.finished !== true) {
          clearTimer();
          timer = setTimeout(() => {
            void poll(view.runId);
          }, pollMs);
        }
      } catch (error) {
        set({ phase: "error", error: message(error) });
      }
    },
    dismiss() {
      clearTimer();
      estimateToken += 1;
      set({
        phase: "idle",
        view: void 0,
        question: "",
        error: void 0,
        notice: void 0,
        catalog: void 0,
        estimate: void 0,
        estimateError: void 0,
        routes: void 0
      });
    },
    async stop() {
      const view = state.view;
      if (view === void 0) return;
      stoppedByUser = true;
      clearTimer();
      try {
        const { bestOf } = await api.cancel({ runId: view.runId });
        set({ view: bestOf, phase: bestofPhase(bestOf, { skippedByUser: true }), notice: void 0 });
      } catch (error) {
        set({
          view: { ...view, finished: true, judge: { ...view.judge, mode: "skipped", skipped: true, error: "已停止（本地）：这一轮仍在后台跑完，结果会在下次打开时出现。" } },
          phase: "stopped",
          notice: `停不下来这一轮（${message(error)}）：已在本机停止查看，后台仍会跑完。`
        });
      }
    },
    async adopt(adoptedId) {
      const view = state.view;
      if (view === void 0) return;
      try {
        const { bestOf, delivery } = await api.adopt(decisionPayload(view.runId, "adopt", { adoptedId }));
        set({ view: bestOf, phase: bestofPhase(bestOf), error: void 0, delivery });
      } catch (error) {
        set({ error: message(error) });
      }
    },
    async merge(mergedText) {
      const view = state.view;
      if (view === void 0) return;
      try {
        const { bestOf, delivery } = await api.adopt(decisionPayload(view.runId, "merge", { mergedText }));
        set({ view: bestOf, phase: bestofPhase(bestOf), error: void 0, delivery });
      } catch (error) {
        set({ error: message(error) });
      }
    },
    async reject() {
      const view = state.view;
      if (view === void 0) return;
      try {
        const { bestOf, delivery } = await api.adopt(decisionPayload(view.runId, "reject"));
        set({ view: bestOf, phase: bestofPhase(bestOf), error: void 0, delivery });
      } catch (error) {
        set({ error: message(error) });
      }
    }
  };
}

// src/client/bestof.tsx
var import_react = require("react");

// src/client/styles.ts
var STYLE_TAG_ID = "xuanshu-client/styles.css";
var SHEETS = /* @__PURE__ */ new Map();
var BASE_SHEET = `
[class^="xs-"], [class*=" xs-"] { line-height: 1.6; }

/* 可点目标的下限（判据 D-001：44×44）。放在基础段是因为它是**跨面**的一条纪律；
   各面板自己的 padding 仍然生效，这条只是兜住「做小了没人拦」的底。 */
[class^="xs-"] button, [class*=" xs-"] button,
[class^="xs-"] a[href], [class*=" xs-"] a[href],
[class^="xs-"] select, [class*=" xs-"] select,
[class^="xs-"] input:not([type="hidden"]), [class*=" xs-"] input:not([type="hidden"]),
[class^="xs-"] textarea, [class*=" xs-"] textarea,
[class^="xs-"] [role="button"], [class*=" xs-"] [role="button"] {
  min-height: 44px;
  min-width: 44px;
}
`;
function registerStyleSheet(id, css) {
  SHEETS.set(id, css);
}
function composedStyleText() {
  return [BASE_SHEET, ...SHEETS.values()].join("\n");
}
function installXuanshuStyles() {
  if (typeof document === "undefined") return false;
  const selector = `style[data-plugin-css="${STYLE_TAG_ID}"]`;
  const composed = composedStyleText();
  const existing = document.querySelector(selector);
  if (existing !== null) {
    if (existing.textContent !== composed) existing.textContent = composed;
    return false;
  }
  const tag = document.createElement("style");
  tag.dataset.plugin = "xuanshu-client";
  tag.dataset.pluginCss = STYLE_TAG_ID;
  tag.textContent = composed;
  (document.head ?? document.documentElement).appendChild(tag);
  return true;
}

// src/client/bestof-style.ts
function installBestofStyle() {
  registerStyleSheet("xs-bestof-style", `
.xs-bestof-backdrop{position:fixed;inset:0;background:var(--xs-surface-overlay-mask);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;z-index:40;overflow:auto}
.xs-bestof{width:min(960px,100%);max-height:88vh;overflow:auto;background:var(--xs-surface-card);color:var(--xs-text-body);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad);box-shadow:var(--xs-shadow-card)}
.xs-bestof h3,.xs-bestof h4{margin:0 0 6px;font-weight:600}
.xs-bestof h3{font-size:1.05rem}
.xs-bestof h4{font-size:.9rem;color:var(--xs-text-secondary)}
.xs-bestof__head{display:flex;gap:10px;align-items:baseline;justify-content:space-between;flex-wrap:wrap;margin-bottom:8px}
.xs-bestof__note{color:var(--xs-text-secondary);font-size:.82rem;margin:4px 0}
.xs-bestof__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin:10px 0}
.xs-bestof__card{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:10px;display:flex;flex-direction:column;gap:6px;min-width:0}
.xs-bestof__card-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.xs-bestof__tag{font-size:.74rem;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:1px 6px;color:var(--xs-text-secondary)}
.xs-bestof__tag--rank{color:var(--xs-accent-fg);background:var(--xs-accent);border-color:var(--xs-accent)}
.xs-bestof__body{white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;font-size:.88rem;line-height:1.5}
.xs-bestof__actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
.xs-bestof button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-bestof button:disabled{opacity:.5;cursor:not-allowed}
.xs-bestof .xs-btn--primary{background:var(--xs-accent);border-color:var(--xs-accent);color:var(--xs-accent-fg)}
.xs-bestof textarea,.xs-bestof input{font:inherit;color:inherit;background:var(--xs-surface-card);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:7px;width:100%;box-sizing:border-box}
.xs-bestof textarea{min-height:64px}
.xs-bestof__judge{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:10px;margin:8px 0;background:var(--xs-surface-page)}
.xs-bestof__judge-row{display:flex;gap:8px;align-items:baseline;padding:3px 0;border-bottom:1px dashed var(--xs-edge-card);flex-wrap:wrap}
.xs-bestof__judge-row:last-child{border-bottom:0}
.xs-bestof__warn{border:1px solid var(--xs-edge-card);border-left:3px solid var(--xs-accent);border-radius:var(--xs-radius-control);padding:8px 10px;margin:8px 0;background:var(--xs-surface-page)}
.xs-bestof__error{color:var(--xs-text-danger,var(--xs-text-body));font-size:.86rem;margin:6px 0}
.xs-bestof details{margin:8px 0}
.xs-bestof summary{cursor:pointer;color:var(--xs-text-secondary);font-size:.85rem}
.xs-bestof__settings{display:flex;gap:10px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--xs-edge-card);padding:8px 0}
.xs-bestof__settings-note{color:var(--xs-text-secondary);font-size:.8rem}
`);
  installXuanshuStyles();
}

// src/client/bestof-views.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function XsBestofOverlay({ state, actions }) {
  if (state.phase === "idle") return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "xs-bestof-backdrop", role: "dialog", "aria-label": "多 AI 合参", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof", children: [
    state.phase === "confirm" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(XsBestofCostConfirm, { state, actions }),
    state.phase === "disabled" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(XsBestofDisabled, { state, actions }),
    state.phase === "error" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(XsBestofError, { state, actions }),
    state.view !== void 0 && state.phase !== "confirm" && state.phase !== "disabled" && state.phase !== "error" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(XsBestofRun, { state, actions })
  ] }) });
}
function XsBestofTriggerNote() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", children: "2–4 路不同 provider 并列（缺省两家；同一模型也可以按两个视角各跑一路）。 候选只回答、不执行任何动作（不带工具、不读写你的文件）。" });
}
function XsBestofCostConfirm({ state, actions }) {
  const estimate = state.estimate;
  const selected = state.routes ?? [];
  const selectedKeys = new Set(selected.map(routeKey));
  const problem = selected.length > 0 ? routeSelectionProblem(selected) : void 0;
  const options = flattenCatalogRoutes(state.catalog);
  const catalog = state.catalog;
  const routeLines = estimate?.routes ?? selected.map((route) => ({ ...route, modelName: null }));
  const count = selected.length > 0 ? selected.length : routeLines.length;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "data-xs-bestof": "confirm", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "多 AI 合参 · 预估费用确认" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "xs-bestof__tag", children: [
        "候选 ",
        count > 0 ? count : 2,
        " 路"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(XsBestofTriggerNote, {}),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof__routes", "data-xs-bestof": "routes", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", children: "本次并列的路由：" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: routeLines.map((route) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { "data-xs-route": routeKey(route), children: [
        route.provider,
        " · ",
        route.modelName ?? route.model
      ] }, routeKey(route))) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "xs-bestof__note", children: [
        "输入规模：",
        estimate !== void 0 ? estimateInputLabel(estimate) : state.estimateError !== void 0 ? estimateInputLabel(void 0) : "估算中…"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "xs-bestof__note", children: [
        "预估金额：",
        estimatePriceLabel(estimate),
        "（钉版没有价表；玄枢不编金额）"
      ] }),
      options.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof__route-picker", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", children: "换几家/几个 model（2–4 路；配置与密钥在 DSH「设置 → 模型」里改，玄枢只读）：" }),
        options.map((option) => {
          const key = routeKey(option);
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { "data-xs-route-option": key, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                type: "checkbox",
                checked: selectedKeys.has(key),
                onChange: () => actions.onToggleRoute?.({ provider: option.provider, model: option.model })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "xs-bestof__note", children: [
              option.label,
              "（",
              option.providerName ?? option.provider,
              "）· ",
              keyConfiguredLabel(option.keyConfigured)
            ] })
          ] }, key);
        }),
        (catalog?.configurable.length ?? 0) > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "xs-bestof__note", children: [
          "可配置但未注册：",
          catalog?.configurable.map((entry) => `${entry.name ?? entry.id}（${keyConfiguredLabel(entry.keyConfigured)}）`).join("、"),
          "—— 去 DSH「设置 → 模型」里添加；玄枢不写配置与密钥。"
        ] }),
        (catalog?.failures.length ?? 0) > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "xs-bestof__note", children: [
          "有路由列不出模型：",
          catalog?.failures.map((entry) => `${entry.provider}（${entry.reason}）`).join("、")
        ] })
      ] }),
      state.estimateError !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "xs-bestof__note", children: [
        "估算不可用（",
        state.estimateError,
        "）：将按老路径开跑。"
      ] }),
      problem !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__error", role: "alert", children: problem })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", children: "模型与密钥复用 DSH 的 provider 配置，玄枢不另配密钥。" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xs-bestof__note", children: "这一轮要合参的问题是？" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "textarea",
        {
          value: state.question,
          onChange: (event) => actions.onEditQuestion(event.target.value),
          placeholder: "写上要合参的问题"
        }
      )
    ] }),
    state.error !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__error", role: "alert", children: state.error }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof__actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "xs-btn--primary", onClick: actions.onStart, disabled: problem !== void 0, children: "开始合参" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: actions.onCancel, children: "取消" })
    ] })
  ] });
}
function XsBestofDisabled({ state, actions }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "data-xs-bestof": "disabled", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "多 AI 合参当前是关的" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", children: state.notice ?? "去 设置 · 通用 里打开「多 AI 合参」。" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(XsBestofTriggerNote, {}),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof__actions", children: [
      actions.onOpenSettings !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: actions.onOpenSettings, children: "去设置" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: actions.onCancel, children: "照常问（带工具）" })
    ] })
  ] });
}
function XsBestofError({ state, actions }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "data-xs-bestof": "error", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "这次合参没跑起来" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__error", role: "alert", children: state.error ?? "未知原因。" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof__actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "xs-btn--primary", onClick: actions.onRetry, children: "重试合参" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: actions.onCancel, children: "退回普通问法（带工具）" })
    ] })
  ] });
}
function XsBestofRun({ state, actions }) {
  const view = state.view;
  const running = state.phase === "running";
  const ranked = rankedCandidates(view);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "data-xs-bestof": "run", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { children: [
        "多 AI 合参 · ",
        view.candidates.length,
        " 路"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xs-bestof__tag", children: running ? "生成中" : state.phase === "rejected" ? "已否决" : view.adoptedId === null ? "待你拍板" : "已采用" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(XsBestofTriggerNote, {}),
    state.notice !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", children: state.notice }),
    state.error !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__error", role: "alert", children: state.error }),
    !running && view.rejected === true && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof__warn", "data-xs-bestof": "rejected", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: "本轮合参作废" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", children: "没有任何一份被采用（adoptedId 为空），也不会进入后续对话与历史回看； 候选正文仍保存在本地合参记录里，可展开、可导出。" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "xs-bestof__actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "xs-btn--primary", onClick: actions.onRetry, children: "重来一轮（沿用同一个问题）" }) })
    ] }),
    !running && view.adoptedId !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof__warn", "data-xs-bestof": "adopted", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: view.adoptedId === "merged" ? "已合并为一稿并采用" : `已采用 ${view.adoptedId}` }),
      deliveryNotice(state.delivery ?? view.delivery) !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "xs-bestof__error", "data-xs-bestof": "delivery-failed", role: "alert", children: [
          "⚠ ",
          deliveryNotice(state.delivery ?? view.delivery)
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", children: "采用只影响这次对话与回看；写进谱要在结束沉淀时由你确认。 其余候选已折叠保存在本地合参记录里，需要时展开查看。" })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", children: "采用只影响这次对话与回看；写进谱要在结束沉淀时由你确认。历史只带这一份采用稿。 其余候选已折叠保存在本地合参记录里，需要时展开查看。" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", children: "合参没有改动本次会话的挂载账本与字数状态（旁路，不写页面态）。" })
    ] }),
    fallbackNotice(view) !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "xs-bestof__warn", "data-xs-bestof": "fallback", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "xs-bestof__note", children: [
      "⚠ ",
      fallbackNotice(view)
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(XsBestofCandidateGrid, { view }),
    !running && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(XsBestofJudgePanel, { view }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { children: [
        "▸ 展开候选（",
        usableCandidates(view).length,
        " 份可用 / 共 ",
        view.candidates.length,
        " 路）"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", children: "候选流不带工具：候选只回答、不执行动作，也不会产生工具调用块。判官只看候选与问题，不读你的谱与挂载内容。" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(XsBestofActions, { view, running, actions })
  ] });
}
function XsBestofCandidateGrid({ view }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "xs-bestof__grid", "data-xs-bestof": "candidates", children: rankedCandidates(view).map((candidate) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    XsBestofCandidateCard,
    {
      candidate,
      rank: rankTag(view, candidate.id),
      rankIsFallback: judgeUnavailable(view),
      adopted: view.adoptedId === candidate.id
    },
    candidate.id
  )) });
}
function XsBestofCandidateCard({
  candidate,
  rank,
  rankIsFallback,
  adopted
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "xs-bestof__card", "data-xs-bestof": "candidate", "data-xs-candidate": candidate.id, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "xs-bestof__card-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: candidate.id }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xs-bestof__tag", children: candidate.angleName ?? candidate.angle }),
      rank !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `xs-bestof__tag${rankIsFallback === true ? "" : " xs-bestof__tag--rank"}`, children: rank }),
      adopted === true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xs-bestof__tag", children: "已采用" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xs-bestof__tag", children: candidateStatusLabel(candidate) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xs-bestof__tag", children: candidate.provider }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xs-bestof__tag", children: candidate.model })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "xs-bestof__body", children: candidate.text }),
    candidate.error !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__error", children: candidate.error })
  ] });
}
function XsBestofJudgePanel({ view }) {
  const unavailable2 = judgeUnavailable(view);
  const sameSource = judgeSameSource(view);
  const sourceNotice = judgeSourceNotice(view);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "xs-bestof__judge", "data-xs-bestof": "judge", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: sameSource ? "判官（同源：候选里没有另一家可选）" : unavailable2 ? "判官（本次未给出有效排序）" : "判官（只排序，不替你做决定）" }),
    sourceNotice !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", "data-xs-bestof": "judge-source", children: sourceNotice }),
    rankedCandidates(view).map((candidate) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof__judge-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: candidate.id }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xs-bestof__tag", children: view.judge?.reasons?.[candidate.id] ?? "（判官未给理由）" })
    ] }, candidate.id)),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__note", children: "判官不会自动采用：排序只是排序，采用与否由你点。判官只看候选与问题，不读你的谱与挂载内容。" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "xs-bestof__note", children: [
      "本轮费用：",
      costLabel(view)
    ] })
  ] });
}
function XsBestofActions({ view, running, actions }) {
  if (running) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "xs-bestof__actions", "data-xs-bestof": "actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: actions.onStop, children: "停止全部" }) });
  }
  const usable = usableCandidates(view);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof__actions", "data-xs-bestof": "actions", children: [
    canAdopt(view) && usable.map((candidate) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "xs-btn--primary", onClick: () => actions.onAdopt(candidate.id), children: [
      "采用 ",
      candidate.id
    ] }, candidate.id)),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: actions.onMerge, disabled: !canMerge(view), children: "合并为一稿" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: actions.onReject, children: "否决本轮" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: actions.onCancel, children: "收起" }),
    !canMerge(view) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xs-bestof__note", children: "可合并的候选不足两份。" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "xs-bestof__note", children: [
      "判官不会自动采用（本轮费用：",
      costLabel(view),
      "）"
    ] })
  ] });
}
function XsBestofTriggerButton({ onTrigger }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "xs-btn--primary", "data-xs-bestof": "trigger", onClick: onTrigger, children: "多 AI 合参" });
}
function XsBestofSettingsRow({ state, actions }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-bestof__settings", "data-xs-bestof": "settings", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "多 AI 合参" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-bestof__settings-note", children: "打开后可用 /多模型 命令（别名 /合参 · bestof）与「多 AI 合参」按钮； 候选只回答、不执行动作（不带工具、不读写你的文件）。" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: state.enabled, onChange: (event) => actions.onToggle(event.target.checked) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xs-bestof__settings-note", children: state.enabled ? "开" : "关" })
    ] })
  ] });
}

// src/client/bestof.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var BESTOF_OVERLAY_ID = "xuanshu-bestof-overlay";
var BESTOF_SETTINGS_ID = "xuanshu.bestof";
var BESTOF_TRIGGER_ID = "xuanshu-bestof-trigger";
function bestofActions(deps) {
  const { controller } = deps;
  return {
    onEditQuestion: (question) => controller.editQuestion(question),
    onStart: () => {
      void controller.confirm();
    },
    onCancel: () => controller.dismiss(),
    onStop: () => {
      void controller.stop();
    },
    onAdopt: (candidateId) => {
      void controller.adopt(candidateId);
    },
    onMerge: () => {
      void controller.merge();
    },
    onReject: () => {
      void controller.reject();
    },
    onRetry: () => {
      const { question, sessionId } = controller.snapshot();
      controller.ask({ question, sessionId: sessionId ?? "" });
    },
    // 票 28：确认屏上增删一路（控制器负责 2–4 路上限与重算 estimate）。
    onToggleRoute: (route) => {
      void controller.toggleRoute(route);
    },
    ...deps.openSettings === void 0 ? {} : { onOpenSettings: deps.openSettings }
  };
}
function bestofEmptyOf(state) {
  const sessionMissing = state.sessionId === "" || state.sessionId === void 0 && state.sessionKnown === true;
  if (sessionMissing) {
    return {
      kind: "no-session",
      text: "还没有问事会话：合参要挂在一个问事会话上。",
      next: "先去「问事」开一次会话，再回来点「多 AI 合参」。"
    };
  }
  if (state.routesKnown === true && Array.isArray(state.routes) && state.routes.length < BESTOF_MIN_ROUTES) {
    return {
      kind: "no-route",
      text: `还没有两路可并列（现在 ${state.routes.length} 路）。`,
      next: "去 DSH「设置 → 模型」里再加一家 provider 或 model：合参至少要两路。"
    };
  }
  if (state.view !== void 0 && state.view.finished === true && state.view.candidates.length === 0) {
    return {
      kind: "no-candidate",
      text: "这一轮还没有任何候选回来（几路都没有产出）。",
      next: "点「重试合参」再跑一轮；若还是这样，去 DSH「设置 → 模型」里换一家 provider。"
    };
  }
  return void 0;
}
function XsBestofEmptyNotice({ empty }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "xs-bestof__warn", "data-xs-bestof": "empty", "data-xuanshu-view": "empty", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "xs-bestof__note", children: empty.text }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "xs-bestof__note", children: empty.next })
  ] });
}
function BestofOverlayHost({ controller, openSettings }) {
  const state = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
  const actions = bestofActions({ controller, ...openSettings === void 0 ? {} : { openSettings } });
  if (state.phase === "idle") return null;
  const empty = bestofEmptyOf(state);
  if (empty !== void 0 && empty.kind === "no-candidate") {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "xs-bestof-backdrop", role: "dialog", "aria-label": "多 AI 合参", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "xs-bestof", "data-xs-bestof": "empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "xs-bestof__head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: "多 AI 合参" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "xs-bestof__tag", children: "这一轮 0 路" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(XsBestofEmptyNotice, { empty }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "xs-bestof__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "xs-btn--primary", onClick: actions.onRetry, children: "重试合参" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: actions.onReject, children: "否决本轮" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: actions.onCancel, children: "收起" })
      ] })
    ] }) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(XsBestofOverlay, { state, actions });
}
function BestofSettingsRowHost({ controller }) {
  const state = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
  (0, import_react.useEffect)(() => {
    void controller.loadRoutes();
  }, [controller]);
  const empty = bestofEmptyOf(state);
  const routeGap = empty !== void 0 && empty.kind === "no-route" ? empty : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(XsBestofSettingsRow, { state, actions: { onToggle: (enabled) => controller.setEnabled(enabled) } }),
    state.routesKnown !== true && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "xs-bestof__note", role: "status", children: "正在读取模型目录…" }),
    routeGap !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(XsBestofEmptyNotice, { empty: routeGap })
  ] });
}
function installBestOf(ctx, deps) {
  installBestofStyle();
  ctx.slots.inject(
    "shell.overlay",
    () => ctx.slots.register({ name: "shell.overlay", id: BESTOF_OVERLAY_ID, inject: () => deps }, BestofOverlayHost)
  );
  ctx.slots.inject(
    "settings.general.item",
    () => ctx.slots.register({ name: "settings.general.item", id: BESTOF_SETTINGS_ID, order: 60, inject: () => deps }, BestofSettingsRowHost)
  );
  const commandUi = readService(ctx, "commandUi");
  if (typeof commandUi?.register === "function") {
    for (const name of BESTOF_COMMAND_NAMES) {
      ctx.effect(
        () => commandUi.register({
          name,
          label: () => "多 AI 合参",
          description: () => "一个问题多路 AI 并列给答案、分歧可见、拍板在人",
          // 关着的时候命令也在（S9 §1：关闭时触发一次提示 + 给「去设置打开」）。
          available: () => true,
          ui: {
            kind: "action",
            run: (session) => {
              const snapshot = deps.controller.snapshot();
              deps.controller.ask({ question: snapshot.question, sessionId: session.sessionId });
            }
          }
        })
      );
    }
  }
  const trigger = () => {
    const snapshot = deps.controller.snapshot();
    const resolve = deps.resolveSessionId;
    if (resolve === void 0) {
      deps.controller.ask({ question: snapshot.question, sessionId: "" });
      return;
    }
    void resolve().then((sessionId) => {
      deps.controller.ask({ question: deps.controller.snapshot().question, sessionId: sessionId ?? "" });
    });
  };
  ctx.slots.inject(
    "conversation.composer.dock",
    () => ctx.slots.register(
      {
        name: "conversation.composer.dock",
        id: BESTOF_TRIGGER_ID,
        // `resolveSessionId` 一起注入：空态要在挂载时就问一次「有没有会话」，
        // 只在点击时问意味着首屏永远不显示「还没有问事会话」。
        inject: () => ({
          onTrigger: trigger,
          controller: deps.controller,
          ...deps.resolveSessionId === void 0 ? {} : { resolveSessionId: deps.resolveSessionId }
        })
      },
      BestofTriggerHost
    )
  );
}
function BestofTriggerHost({ controller, onTrigger, resolveSessionId }) {
  const state = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
  (0, import_react.useEffect)(() => {
    let alive = true;
    if (resolveSessionId === void 0) {
      controller.probeSession(void 0);
      return () => {
        alive = false;
      };
    }
    void resolveSessionId().then((sessionId) => {
      if (alive) controller.probeSession(sessionId);
    }).catch(() => {
      if (alive) controller.probeSession(void 0);
    });
    return () => {
      alive = false;
    };
  }, [controller, resolveSessionId]);
  const empty = bestofEmptyOf(state);
  const sessionGap = empty !== void 0 && empty.kind === "no-session" ? empty : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(XsBestofTriggerButton, { onTrigger }),
    state.sessionKnown !== true && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "xs-bestof__note", role: "status", children: "正在读取最近一次问事会话…" }),
    sessionGap !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(XsBestofEmptyNotice, { empty: sessionGap })
  ] });
}

// src/client/CangPanel.tsx
var import_react3 = require("react");

// src/client/home-paths.ts
var import_react2 = require("react");
var DATA_DIR_PLACEHOLDER = "玄枢数据目录";
var HOME_PLACEHOLDER = "玄枢 home";
function isUsablePathValue(value) {
  return typeof value === "string" && value.trim() !== "";
}
var EMPTY_HOME_PATHS = Object.freeze({});
function createHomePathsWatch() {
  let snapshot = EMPTY_HOME_PATHS;
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      snapshot = { ...next };
      for (const listener of [...listeners]) listener();
    }
  };
}
async function resolveHomePathsFromApi(api, signal) {
  try {
    const overview = await api.overview(signal);
    const home = typeof overview?.home === "string" && isUsablePathValue(overview.home) ? overview.home : void 0;
    const dataDir = typeof overview?.dataDir === "string" && isUsablePathValue(overview.dataDir) ? overview.dataDir : void 0;
    return {
      ...home === void 0 ? {} : { home },
      ...dataDir === void 0 ? {} : { dataDir }
    };
  } catch {
    return {};
  }
}
async function primeHomePaths(watch, api) {
  watch.set(await resolveHomePathsFromApi(api));
}
var NO_SUBSCRIBE = () => () => {
};
var EMPTY_SNAPSHOT = () => EMPTY_HOME_PATHS;
function useHomePaths(watch) {
  const subscribe = watch === void 0 ? NO_SUBSCRIBE : watch.subscribe;
  const getSnapshot = watch === void 0 ? EMPTY_SNAPSHOT : watch.getSnapshot;
  return (0, import_react2.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
}
function joinXsDisplayPath(base, segments) {
  const trimmed = base.trim().replace(/[\\/]+$/, "");
  const separator = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  return [trimmed, ...segments.filter((segment) => segment !== "")].join(separator);
}
function withTrailingSeparator(path) {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  const separator = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  return `${trimmed}${separator}`;
}
function dataDirPath(dataDir, ...segments) {
  return joinXsDisplayPath(isUsablePathValue(dataDir) ? dataDir : DATA_DIR_PLACEHOLDER, segments);
}
function homePath(home, ...segments) {
  return joinXsDisplayPath(isUsablePathValue(home) ? home : HOME_PLACEHOLDER, segments);
}

// src/client/panel.ts
var PANEL_ID = "overview";
var PANEL_ORDER = 20;
var PANEL_LABEL = "总览";
var ONBOARDING_ID = "onboarding";
var MINGPAN_ID = "mingpan";
var ONBOARDING_LABEL = "填八字";
var MINGPAN_LABEL = "命盘";
var ONBOARDING_ORDER = 80;
var MINGPAN_ORDER = 90;
var CONSULT_ID = "consult";
var CONSULT_LABEL = "问事";
var CONSULT_ORDER = 30;
var PANEL_TITLE = "自我总览";
var PANEL_HOME = "家";
function panelLocalNote(dataDir) {
  return typeof dataDir === "string" && dataDir.trim() !== "" ? `数据都在本地 ${withTrailingSeparator(dataDirPath(dataDir))}` : `数据都在本地（${withTrailingSeparator(DATA_DIR_PLACEHOLDER)}）`;
}
var CARD_TITLE = {
  mingpan: "命盘 / 八字",
  rike: "日课",
  digao: "底稿",
  quicklinks: "快捷入口",
  wansheng: "晚省"
};
var BADGE_READONLY = "只读 · 由出生信息与底座生成";
var BADGE_DERIVED = "纯派生 · 不可手改";
var QUICKLINK = {
  consult: { title: "问事", subtitle: "书房" },
  conversation: { title: "工作区", subtitle: "车间" },
  workflow: { title: "工作流", subtitle: "流水线" }
};
var QUICKLINK_CONSULT_UNREADY = "底座未立 · 也能空手先问一句";
var QUICKLINKS_BOUNDARY = "谱 / 藏 / 自动化任务是管理入口：都在侧栏，不在这张卡里。";
var EMPTY_COPY = {
  mingpan: {
    why: "底座还没立起来",
    sub: "填一次出生信息，命盘就点亮了。（预计 1 分钟；之后不再重复录入）"
  },
  rike: {
    /**
     * 2026-11-02 改：原来写的是「日课默认每天 07:30 生成」—— 硬编码的出厂时间。
     * 用户一旦在「自动化任务」里改过时刻（截图里就是 09:30），这句就和上面那行
     * 「计划时刻：每天 09:30」正面打架，用户不知道该信哪个。
     * 具体时刻由上方的「计划时刻」那一行负责说，这里只说「会按计划生成」。
     */
    why: "今天还没有生成日课。到计划时刻会自动生成。",
    sub: "（底座未立时生成会失败）"
  },
  digaoUnready: {
    why: "底座未立，还没有可提炼的来源。",
    sub: "这里不会先有内容：提炼源是 0。"
  },
  digaoNeverRefreshed: {
    why: "底稿还没生成过。",
    sub: "刷新一次就会按三路来源拼出骨架。"
  },
  // #25：晚省空态（它只摆事实；没生成时给两个出口：[立即生成] 与 [改时间]）。
  wansheng: {
    /** 同上：`21:30` 也是出厂值，用户改过就打架。 */
    why: "今天还没有晚省。到计划时刻会自动生成。",
    sub: "（它只摆事实、不替你下结论；点开进问事）"
  }
};
var ERROR_COPY = {
  mingpan: "命盘快照读不出来（文件缺失或格式不符）。",
  rike: "日课生成失败：底座未就绪 / 推运调用失败。",
  digao: "底稿读不出来。",
  wansheng: "晚省读不出来（产物缺失或格式不符）。"
};
var ACTION_COPY = {
  startOnboarding: "开始填写出生信息 ->",
  openDetail: "看详情 ->",
  /**
   * 2026-11-02 改：原来叫「立即生成」，点下去**直接**覆盖当天的日课/晚省。
   *
   * 而面板里的同名动作（`RikkePanel` / `WanshengPanel`）都要过一次轻确认
   * （「将覆盖今天的日课，继续？」）—— 同一个动作，在两个入口两种代价。
   * 卡面空间放不下确认块，所以卡片改成「把人送到面板去生成」，由那一处的闸门统一把关。
   * 按钮文案也要跟着变，否则点「立即生成」跳到别的屏会让人意外。
   */
  generate: "去生成 ->",
  watchFull: "看完整日课 ->",
  changeTime: "改时间 ->",
  openDigao: "打开底稿 ->",
  refresh: "刷新",
  retry: "重试",
  sourcePu: "谱",
  sourceWorkspace: "工作区",
  sourceWorkflow: "工作流",
  adjustSource: "要改就改源头：",
  // #25：晚省的四个出口。
  watchWansheng: "看完整晚省 ->",
  goConsult: "去问事 ->",
  /** 2026-11-02：同 `ACTION_COPY.generate` —— 卡片只做跳转，生成闸门在晚省面板里。 */
  generateWansheng: "去生成 ->",
  history: "投递历史"
};
var DISABLED_REASON = {
  consult: "问事面板还没装配（属票 10 · 问事闭环）",
  // #29：AI 没接上时问事入口保持禁用。路径逐字与 `ai-model.ts` 的 AI_SETTINGS_PATH 一致
  // （界面上的可见原因由快捷入口卡的 `XsAiGate` 给，这里只做 title）。
  //
  // 2026-11-01 改：原来这里也写「配置 provider 与默认模型」，与 XsAiGate 里那句说的是两回事
  // （一个是缺 key、一个是缺 provider 选择），并排出现会让人以为要做两件事。
  // 具体缺什么由 XsAiGate 逐字说；这里只给去处。
  consultAi: "问事还开不了：先接上 AI（去「设置 → 模型」）。",
  workflow: "工作流面板还没装配（属票 16 · 工作流创建向导）",
  pus: "谱面板还没装配（属票 09 · 谱管理）",
  digao: "底稿面板还没装配（属票 13 · 底稿与日课）",
  rikke: "日课面板还没装配（属票 13 · 底稿与日课）",
  onboarding: "八字冷启动向导还没装配（属票 08）",
  generate: "日课生成还没接上（属票 13 · 底稿与日课）",
  refreshDigao: "底稿刷新还没接上（属票 13 · 底稿与日课）",
  openDetail: "命盘详情还没装配（属票 08）",
  retry: "取数重试还没接上（属票 08 / 13）",
  wansheng: "晚省面板还没装配（属票 04 · 晚间触达）",
  generateWansheng: "晚省生成还没接上（属票 04 · 晚间触达）"
};
function clockOf(time) {
  if (time === void 0) return "";
  const parts = time.split(":");
  if (parts.length < 2) return time;
  return `${parts[0]}:${parts[1]}`;
}
function momentOf(iso) {
  if (iso === void 0 || iso === "") return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const two = (value) => String(value).padStart(2, "0");
  const day = `${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  const clock = `${two(at.getHours())}:${two(at.getMinutes())}`;
  return at.getFullYear() === (/* @__PURE__ */ new Date()).getFullYear() ? `${day} ${clock}` : `${at.getFullYear()}-${day} ${clock}`;
}
var DIGAO_ID = "digao";
var RIKKE_ID = "rikke";
var WANSHENG_ID = "wansheng";
var DIGAO_LABEL = "底稿";
var RIKKE_LABEL = "日课";
var WANSHENG_LABEL = "晚省";
var DIGAO_ORDER = 60;
var RIKKE_ORDER = 100;
var WANSHENG_ORDER = 110;

// src/client/cang-model.ts
var CANG_AI_FREE = "藏永不进 AI：只登记指针、签与跳转 —— 玄枢不读、不索引、不分析、不进上下文";
var newCangDraft = () => ({ path: "", name: "", tags: [], actions: { open: true, reveal: true, copy: true } });

// src/client/CangPanel.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function filterCangEntries(entries, query, tag, sort) {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => (!tag || entry.tags.includes(tag)) && (!needle || [entry.name, ...entry.tags].some((value) => value.toLocaleLowerCase().includes(needle)))).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "zh-CN") : b.createdAt.localeCompare(a.createdAt));
}
function CangPanel({ api, controller, initialData }) {
  const state = (0, import_react3.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
  const [data, setData] = (0, import_react3.useState)(initialData);
  const [loading, setLoading] = (0, import_react3.useState)(!initialData);
  const [error, setError] = (0, import_react3.useState)("");
  const [notice, setNotice] = (0, import_react3.useState)("");
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [reload, setReload] = (0, import_react3.useState)(0);
  const [query, setQuery] = (0, import_react3.useState)("");
  const [tag, setTag] = (0, import_react3.useState)("");
  const [sort, setSort] = (0, import_react3.useState)("recent");
  const [desktop, setDesktop] = (0, import_react3.useState)(true);
  const [remove, setRemove] = (0, import_react3.useState)();
  (0, import_react3.useEffect)(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    api.list(abort.signal).then((result) => {
      if (!abort.signal.aborted) setData(result);
    }).catch((reason) => {
      if (!abort.signal.aborted) setError(String(reason.message ?? reason));
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    api.capabilities(abort.signal).then((value) => {
      if (!abort.signal.aborted) setDesktop(value.desktop);
    }).catch(() => {
      if (!abort.signal.aborted) setDesktop(false);
    });
    return () => abort.abort();
  }, [api, state.revision, reload]);
  async function action(operation) {
    setBusy(true);
    setNotice("");
    try {
      await operation();
    } catch (reason) {
      setNotice(String(reason.message ?? reason));
    } finally {
      setBusy(false);
    }
  }
  const entries = data?.entries ?? [];
  const empty = !loading && !error && !entries.length;
  const tags = [...new Set(entries.flatMap((entry) => entry.tags))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const filtered = filterCangEntries(entries, query, tag, sort);
  const groups = /* @__PURE__ */ new Map();
  for (const entry of filtered) {
    const labels = tag !== "" ? [tag] : entry.tags.length ? entry.tags : ["未贴签"];
    for (const label of labels) groups.set(label, [...groups.get(label) ?? [], entry]);
  }
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "xs-cang", "data-xuanshu-panel": "cang", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h1", { children: "藏库" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "xs-cang__boundary", "data-xuanshu-note": "no-ai", children: CANG_AI_FREE }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
      "谱会被 AI 读进上下文；藏只是你自己的本地文件入口。",
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-cang__how", children: "（要找谱：点侧栏「谱」。）" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "藏不是挂载对象；工作区与工作流走临时挂载。" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-cang__toolbar", children: [
      empty ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", disabled: loading || !!error, onClick: () => controller.edit(newCangDraft()), children: "登记藏" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
        "搜藏名 / 签 ",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { value: query, onChange: (event) => setQuery(event.target.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
        "签 ",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { value: tag, onChange: (event) => setTag(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "", children: "全部" }),
          tags.map((value) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { children: value }, value))
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
        "排序 ",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { value: sort, onChange: (event) => setSort(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "recent", children: "最近登记" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "name", children: "名称" })
        ] })
      ] })
    ] }),
    loading && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "status", children: "正在读取藏库注册表…" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
        "注册表读取失败：",
        error
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: () => setReload((value) => value + 1), children: "重试" })
    ] }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "alert", children: notice }),
    empty && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-cang__empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "你还没有登记任何藏。藏只登记指针，不复制文件。" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: () => controller.edit(newCangDraft()), children: "登记第一个藏" })
    ] }),
    !loading && !error && !!entries.length && !filtered.length && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "没有匹配的藏名或签。" }),
    !loading && !error && groups.size > 1 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "xs-cang__how", "data-xuanshu-note": "group-by-tag", children: "按「签」分组：一个藏挂了几个签，就会在几组里各出现一次（不是登记了两次）。" }) : null,
    !loading && !error && [...groups].map(([label, items]) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { open: true, className: "xs-cang__group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("summary", { children: [
        "签「",
        label,
        "」（",
        items.length,
        "）"
      ] }),
      items.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("article", { className: "xs-cang__card", "data-cang-id": entry.id, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("h2", { children: [
          entry.name,
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-cang__status", children: "已登记" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
          "签：",
          entry.tags.join(" · ") || "未贴签"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
          "路径（只读）：",
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("code", { children: entry.path })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
          entry.pointer.valid ? "指针有效 · 玄枢未读取" : `指针失效 · ${entry.pointer.reason ?? ""}`,
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("small", { children: [
            "最后校验：",
            momentOf(entry.pointer.checkedAt)
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-cang__actions", children: [
          entry.actions.open && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", "data-action": "open", disabled: busy || !desktop || !entry.pointer.valid, title: !desktop ? "宿主没有可用桌面，请复制路径在本机打开" : entry.pointer.reason, onClick: () => void action(() => api.open(entry.id)), children: "以默认程序打开" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "xs-cang__more", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "更多操作" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              entry.actions.reveal && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", disabled: busy || !desktop || !entry.pointer.valid, onClick: () => void action(() => api.reveal(entry.id)), children: "显示所在位置" }),
              entry.actions.copy && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", disabled: busy, onClick: () => void action(() => navigator.clipboard.writeText(entry.path)), children: "复制路径" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: () => controller.edit(entry), children: entry.pointer.valid ? "编辑登记" : "重新定位" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: () => setRemove(entry), children: "移除登记" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: "本卡没有：摘要 / 问答 / 「让 AI 看看」/ 加入上下文 / 挂载到会话" })
      ] }, entry.id))
    ] }, label)),
    remove && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-cang__confirm", role: "alertdialog", "aria-label": "确认移除登记", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
        "只从藏库移除「",
        remove.name,
        "」的登记，不会删除你的文件。"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", disabled: busy, onClick: () => void action(async () => {
        await api.remove(remove.id);
        setRemove(void 0);
        controller.changed();
      }), children: "确认移除登记" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", disabled: busy, onClick: () => setRemove(void 0), children: "取消" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("footer", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("code", { children: data?.registryPath ?? dataDirPath(void 0, "cang", "registry.jsonl") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "只存指针 + 签 + 跳转，不存内容。拷走注册表 ≠ 拷走这些文件；换机器后请重新定位。" })
    ] })
  ] });
}

// src/client/CangDrawer.tsx
var import_react4 = require("react");
var import_jsx_runtime4 = require("react/jsx-runtime");
function CangOverlay({ api, controller }) {
  const { draft } = (0, import_react4.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
  return draft ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(CangDrawer, { api, controller, initial: draft }) : null;
}
function CangDrawer({ api, controller, initial }) {
  const [draft, setDraft] = (0, import_react4.useState)(() => ({ ...initial, tags: [...initial.tags], actions: { ...initial.actions } }));
  const [tags, setTags] = (0, import_react4.useState)(initial.tags.join("，"));
  const [nameTouched, setNameTouched] = (0, import_react4.useState)(Boolean(initial.name));
  const [pointer, setPointer] = (0, import_react4.useState)();
  const [picker, setPicker] = (0, import_react4.useState)(false);
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [error, setError] = (0, import_react4.useState)("");
  const [empty, setEmpty] = (0, import_react4.useState)(false);
  const [listError, setListError] = (0, import_react4.useState)("");
  const [listRetry, setListRetry] = (0, import_react4.useState)(0);
  const dialog = (0, import_react4.useRef)(null);
  (0, import_react4.useEffect)(() => {
    const abort = new AbortController();
    setPointer(void 0);
    if (draft.path.trim()) api.validate(draft.path, abort.signal).then((value) => {
      if (!abort.signal.aborted) setPointer(value);
    }).catch((reason) => {
      if (!abort.signal.aborted) setError(String(reason.message ?? reason));
    });
    return () => abort.abort();
  }, [api, draft.path]);
  (0, import_react4.useEffect)(() => {
    const abort = new AbortController();
    api.capabilities(abort.signal).then((value) => {
      if (!abort.signal.aborted) setPicker(value.directoryPicker);
    }).catch(() => {
    });
    const previous = document.activeElement;
    dialog.current?.querySelector("input")?.focus();
    return () => {
      abort.abort();
      previous?.focus();
    };
  }, [api]);
  (0, import_react4.useEffect)(() => {
    const abort = new AbortController();
    api.list(abort.signal).then((list) => {
      if (!abort.signal.aborted) {
        setEmpty(list.entries.length === 0);
        setListError("");
      }
    }).catch((reason) => {
      if (abort.signal.aborted) return;
      setEmpty(false);
      setListError(String(reason?.message ?? reason));
    });
    return () => abort.abort();
  }, [api, listRetry]);
  function changePath(path) {
    const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "";
    setDraft((value) => ({ ...value, path, name: nameTouched ? value.name : name }));
    setError("");
  }
  async function pick() {
    setBusy(true);
    setError("");
    try {
      const { path } = await api.pickDirectory();
      if (path) changePath(path);
    } catch (reason) {
      setError(String(reason.message ?? reason));
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    const input = { ...draft, tags: tags.split(/[,，]/).map((value) => value.trim()).filter(Boolean) };
    try {
      if (input.id) await api.update(input);
      else await api.register(input);
      controller.changed();
      controller.close();
    } catch (reason) {
      setError(String(reason.message ?? reason));
      setBusy(false);
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "xs-cang__overlay", onMouseDown: (event) => {
    if (event.target === event.currentTarget && !busy) controller.close();
  }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { ref: dialog, className: "xs-cang__drawer", role: "dialog", "aria-modal": "true", "aria-labelledby": "xs-cang-drawer-title", onKeyDown: (event) => {
    if (event.key === "Escape" && !busy) {
      event.stopPropagation();
      controller.close();
    }
    if (event.key === "Tab") {
      const elements = Array.from(dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []);
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { id: "xs-cang-drawer-title", children: draft.id ? "编辑登记" : "登记藏" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-cang__boundary", children: CANG_AI_FREE }),
    empty && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-cang__empty", children: "藏库里还没有任何登记 —— 这是第一条：先给本地路径（或点「选择文件夹…」），校验通过、起好名字，再点「登记」。" }),
    listError !== "" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { role: "alert", className: "xs-cang__empty-note", children: [
      "藏库清单读不到（首次登记提示因此先不说）：",
      listError,
      "。请点下面的「重新读取」再试一次；还读不到就稍后再开这张表 —— 登记本身不依赖这份清单。",
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: () => setListRetry((value) => value + 1), children: "重新读取" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("form", { onSubmit: (event) => {
      event.preventDefault();
      if (pointer?.valid && draft.name.trim() && !busy) void submit();
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "本地文件 / 文件夹路径",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { value: draft.path, onChange: (event) => changePath(event.target.value), disabled: busy, required: true })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: () => void pick(), disabled: busy || !picker, title: !picker ? "宿主未提供系统目录选择器，可粘贴本地路径" : void 0, children: "选择文件夹…" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "系统选择器只取指针。文件藏请粘贴本地路径；玄枢不复制、不移动、不修改内容。" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "名称",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { value: draft.name, onChange: (event) => {
          setNameTouched(true);
          setDraft((value) => ({ ...value, name: event.target.value }));
        }, maxLength: 200, required: true, disabled: busy })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "签（用逗号分隔）",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { value: tags, onChange: (event) => setTags(event.target.value), disabled: busy })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("fieldset", { disabled: busy, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("legend", { children: "跳转入口" }),
        ["open", "reveal", "copy"].map((key, index) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "checkbox", checked: draft.actions[key], onChange: (event) => setDraft((value) => ({ ...value, actions: { ...value.actions, [key]: event.target.checked } })) }),
          ["以默认程序打开", "显示所在位置", "复制路径"][index]
        ] }, key))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "校验只做路径可达性判断，不读取内容、不列目录、不算大小、不建索引。" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", children: !draft.path.trim() ? "请选择或粘贴本地路径。" : !pointer ? "正在校验指针…" : pointer.valid ? `指针有效 · 类型=${pointer.kind === "directory" ? "文件夹" : "文件"} · 玄枢未读取` : pointer.reason }),
      error && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", children: `登记没有成功：读不到这个指针，或注册表拒绝了这次写入 —— ${error}。请检查路径是否还在、有没有权限，然后重新点「${draft.id ? "保存登记" : "登记"}」；还是不通就换个路径。` }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-cang__toolbar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "submit", disabled: busy || !pointer?.valid || !draft.name.trim(), children: busy ? "正在处理…" : draft.id ? "保存登记" : "登记" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: controller.close, disabled: busy, children: "取消" })
      ] })
    ] })
  ] }) });
}

// ../../docs/design/ui-v1/assets/tokens/xs-tokens.json
var xs_tokens_default = {
  source: "xuanshu-ui-v1",
  tokens: {
    "--xs-static-level-base-bg": {
      light: "#0f111514",
      dark: "#f9fafb1f"
    },
    "--xs-static-level-optional-bg": {
      light: "#81858c1f",
      dark: "#adb2b81f"
    },
    "--xs-static-level-baseplate-fg": {
      light: "#dd8629",
      dark: "#f7ad31"
    },
    "--xs-static-level-baseplate-bg": {
      light: "#fef5e7",
      dark: "#27241f"
    },
    "--xs-static-level-digao-fg": {
      light: "#4176e6",
      dark: "#7aaaff"
    },
    "--xs-static-level-digao-bg": {
      light: "#e4edfd",
      dark: "#34415b"
    },
    "--xs-static-level-nonpu-fg": {
      light: "#2563eb",
      dark: "#60a5fa"
    },
    "--xs-static-level-nonpu-bg": {
      light: "#dbeafe",
      dark: "#0e3074"
    },
    "--xs-static-constraint-readonly-fg": {
      light: "#61666b",
      dark: "#cfd3d6"
    },
    "--xs-static-constraint-readonly-bg": {
      light: "#ebeef2",
      dark: "#43454a"
    },
    "--xs-static-constraint-derived-fg": {
      light: "#4868b2",
      dark: "#b7c8fe"
    },
    "--xs-static-constraint-derived-bg": {
      light: "#edf3fe",
      dark: "#283142"
    },
    "--xs-static-constraint-locked-fg": {
      light: "#81858c",
      dark: "#adb2b8"
    },
    "--xs-static-constraint-locked-bg": {
      light: "#f1f3f5",
      dark: "#353638"
    },
    "--xs-static-constraint-noai-fg": {
      light: "#545557",
      dark: "#d4d4d4"
    },
    "--xs-static-constraint-noai-bg": {
      light: "#f5f5f5",
      dark: "#292929"
    },
    "--xs-static-constraint-budget-bar": {
      light: "#5686fe",
      dark: "#5686fe"
    },
    "--xs-static-constraint-human-gate-fg": {
      light: "#ffffff",
      dark: "#0f1115"
    },
    "--xs-static-constraint-human-gate-bg": {
      light: "#0f1115",
      dark: "#f9fafb"
    },
    "--xs-static-surface-overlay-mask": {
      light: "#0000003d",
      dark: "#00000080"
    },
    "--xs-static-surface-readonly": {
      light: "#f9fafb",
      dark: "#1b1b1c"
    },
    "--xs-static-surface-locked": {
      light: "#f1f3f5",
      dark: "#353638"
    },
    "--xs-static-surface-skeleton": {
      light: "#0000000a",
      dark: "#ffffff14"
    },
    "--xs-static-surface-empty": {
      light: "#f5f6f7",
      dark: "#151517"
    },
    "--xs-static-text-code": {
      light: "#34415b",
      dark: "#b7c8fe"
    },
    "--xs-static-text-on-accent": {
      light: "#ffffff",
      dark: "#0f1115"
    },
    "--xs-static-edge-locked": {
      light: "#e1e5ee",
      dark: "#43454a"
    },
    "--xs-static-edge-readonly": {
      light: "#e9ecf2",
      dark: "#353638"
    },
    "--xs-static-state-stale-fg": {
      light: "#dd8629",
      dark: "#dd8629"
    },
    "--xs-surface-app": {
      light: "var(--dsw-alias-bg-base)",
      dark: "var(--dsw-alias-bg-base)"
    },
    "--xs-surface-panel": {
      light: "var(--dsw-alias-bg-base)",
      dark: "var(--dsw-alias-bg-base)"
    },
    "--xs-surface-card": {
      light: "var(--dsw-alias-bg-layer-1)",
      dark: "var(--dsw-alias-bg-layer-1)"
    },
    "--xs-surface-card-nested": {
      light: "var(--dsw-alias-bg-layer-2)",
      dark: "var(--dsw-alias-bg-layer-2)"
    },
    "--xs-surface-overlay": {
      light: "var(--dsw-alias-bg-overlay)",
      dark: "var(--dsw-alias-bg-overlay)"
    },
    "--xs-surface-overlay-mask": {
      light: "var(--xs-static-surface-overlay-mask)",
      dark: "var(--xs-static-surface-overlay-mask)"
    },
    "--xs-surface-sidebar": {
      light: "var(--dsw-specific-sidebar-fill)",
      dark: "var(--dsw-specific-sidebar-fill)"
    },
    "--xs-surface-interactive-hover": {
      light: "var(--dsw-alias-interactive-bg-hover)",
      dark: "var(--dsw-alias-interactive-bg-hover)"
    },
    "--xs-surface-selected": {
      light: "var(--dsw-alias-interactive-bg-hover)",
      dark: "var(--dsw-alias-interactive-bg-hover)"
    },
    "--xs-surface-readonly": {
      light: "var(--xs-static-surface-readonly)",
      dark: "var(--xs-static-surface-readonly)"
    },
    "--xs-surface-locked": {
      light: "var(--xs-static-surface-locked)",
      dark: "var(--xs-static-surface-locked)"
    },
    "--xs-surface-skeleton": {
      light: "var(--xs-static-surface-skeleton)",
      dark: "var(--xs-static-surface-skeleton)"
    },
    "--xs-surface-empty": {
      light: "var(--xs-static-surface-empty)",
      dark: "var(--xs-static-surface-empty)"
    },
    "--xs-text-brand": {
      light: "var(--dsw-alias-brand-primary)",
      dark: "var(--dsw-alias-brand-primary)"
    },
    "--xs-text-title": {
      light: "var(--dsw-alias-label-primary)",
      dark: "var(--dsw-alias-label-primary)"
    },
    "--xs-text-heading": {
      light: "var(--dsw-alias-label-primary)",
      dark: "var(--dsw-alias-label-primary)"
    },
    "--xs-text-body": {
      light: "var(--dsw-alias-label-primary)",
      dark: "var(--dsw-alias-label-primary)"
    },
    "--xs-text-secondary": {
      light: "var(--dsw-alias-label-secondary)",
      dark: "var(--dsw-alias-label-secondary)"
    },
    "--xs-text-tertiary": {
      light: "var(--dsw-alias-label-tertiary)",
      dark: "var(--dsw-alias-label-tertiary)"
    },
    "--xs-text-caption": {
      light: "var(--dsw-alias-label-caption)",
      dark: "var(--dsw-alias-label-caption)"
    },
    "--xs-text-link": {
      light: "var(--dsw-alias-brand-primary)",
      dark: "var(--dsw-alias-brand-primary)"
    },
    "--xs-text-code": {
      light: "var(--xs-static-text-code)",
      dark: "var(--xs-static-text-code)"
    },
    "--xs-text-on-accent": {
      light: "var(--xs-static-text-on-accent)",
      dark: "var(--xs-static-text-on-accent)"
    },
    "--xs-text-disabled": {
      light: "var(--dsw-alias-label-caption)",
      dark: "var(--dsw-alias-label-caption)"
    },
    "--xs-edge-card": {
      light: "var(--dsw-alias-border-l1)",
      dark: "var(--dsw-alias-border-l1)"
    },
    "--xs-edge-card-strong": {
      light: "var(--dsw-alias-border-l2)",
      dark: "var(--dsw-alias-border-l2)"
    },
    "--xs-edge-divider": {
      light: "var(--dsw-alias-border-l1)",
      dark: "var(--dsw-alias-border-l1)"
    },
    "--xs-edge-locked": {
      light: "var(--xs-static-edge-locked)",
      dark: "var(--xs-static-edge-locked)"
    },
    "--xs-edge-readonly": {
      light: "var(--xs-static-edge-readonly)",
      dark: "var(--xs-static-edge-readonly)"
    },
    "--xs-edge-focus": {
      light: "var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))",
      dark: "var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))"
    },
    "--xs-space-page": {
      light: "24px",
      dark: "24px"
    },
    "--xs-space-section": {
      light: "24px",
      dark: "24px"
    },
    "--xs-space-card-gap": {
      light: "16px",
      dark: "16px"
    },
    "--xs-space-card-pad": {
      light: "16px",
      dark: "16px"
    },
    "--xs-space-row": {
      light: "12px",
      dark: "12px"
    },
    "--xs-space-stack-sm": {
      light: "4px",
      dark: "4px"
    },
    "--xs-space-stack-md": {
      light: "12px",
      dark: "12px"
    },
    "--xs-space-toolbar": {
      light: "8px",
      dark: "8px"
    },
    "--xs-space-overlay-inset": {
      light: "16px",
      dark: "16px"
    },
    "--xs-space-overlay-pad": {
      light: "20px",
      dark: "20px"
    },
    "--xs-radius-card": {
      light: "var(--dsw-radius-xl)",
      dark: "var(--dsw-radius-xl)"
    },
    "--xs-radius-nested": {
      light: "var(--dsw-radius-md)",
      dark: "var(--dsw-radius-md)"
    },
    "--xs-radius-control": {
      light: "var(--dsw-radius-md)",
      dark: "var(--dsw-radius-md)"
    },
    "--xs-radius-chip": {
      light: "999px",
      dark: "999px"
    },
    "--xs-radius-overlay": {
      light: "var(--dsw-radius-xl)",
      dark: "var(--dsw-radius-xl)"
    },
    "--xs-radius-tile": {
      light: "var(--dsw-radius-md)",
      dark: "var(--dsw-radius-md)"
    },
    "--xs-state-empty-fg": {
      light: "var(--dsw-alias-state-idle-primary)",
      dark: "var(--dsw-alias-state-idle-primary)"
    },
    "--xs-state-loading-fg": {
      light: "var(--dsw-alias-state-idle-primary)",
      dark: "var(--dsw-alias-state-idle-primary)"
    },
    "--xs-state-ready-fg": {
      light: "var(--dsw-alias-label-primary)",
      dark: "var(--dsw-alias-label-primary)"
    },
    "--xs-state-running-fg": {
      light: "var(--dsw-alias-brand-primary)",
      dark: "var(--dsw-alias-brand-primary)"
    },
    "--xs-state-done-fg": {
      light: "var(--dsw-alias-state-success-primary)",
      dark: "var(--dsw-alias-state-success-primary)"
    },
    "--xs-state-warning-fg": {
      light: "var(--dsw-alias-state-warn-primary)",
      dark: "var(--dsw-alias-state-warn-primary)"
    },
    "--xs-state-error-fg": {
      light: "var(--dsw-alias-state-error-primary)",
      dark: "var(--dsw-alias-state-error-primary)"
    },
    "--xs-state-stale-fg": {
      light: "var(--xs-static-state-stale-fg)",
      dark: "var(--xs-static-state-stale-fg)"
    },
    "--xs-state-busy-track": {
      light: "var(--dsw-alias-bg-layer-2)",
      dark: "var(--dsw-alias-bg-layer-2)"
    },
    "--xs-level-base-fg": {
      light: "var(--dsw-alias-brand-primary)",
      dark: "var(--dsw-alias-brand-primary)"
    },
    "--xs-level-base-bg": {
      light: "var(--xs-static-level-base-bg)",
      dark: "var(--xs-static-level-base-bg)"
    },
    "--xs-level-optional-fg": {
      light: "var(--dsw-alias-label-tertiary)",
      dark: "var(--dsw-alias-label-tertiary)"
    },
    "--xs-level-optional-bg": {
      light: "var(--xs-static-level-optional-bg)",
      dark: "var(--xs-static-level-optional-bg)"
    },
    "--xs-level-baseplate-fg": {
      light: "var(--xs-static-level-baseplate-fg)",
      dark: "var(--xs-static-level-baseplate-fg)"
    },
    "--xs-level-baseplate-bg": {
      light: "var(--xs-static-level-baseplate-bg)",
      dark: "var(--xs-static-level-baseplate-bg)"
    },
    "--xs-level-digao-fg": {
      light: "var(--xs-static-level-digao-fg)",
      dark: "var(--xs-static-level-digao-fg)"
    },
    "--xs-level-digao-bg": {
      light: "var(--xs-static-level-digao-bg)",
      dark: "var(--xs-static-level-digao-bg)"
    },
    "--xs-level-nonpu-fg": {
      light: "var(--xs-static-level-nonpu-fg)",
      dark: "var(--xs-static-level-nonpu-fg)"
    },
    "--xs-level-nonpu-bg": {
      light: "var(--xs-static-level-nonpu-bg)",
      dark: "var(--xs-static-level-nonpu-bg)"
    },
    "--xs-constraint-readonly-fg": {
      light: "var(--xs-static-constraint-readonly-fg)",
      dark: "var(--xs-static-constraint-readonly-fg)"
    },
    "--xs-constraint-readonly-bg": {
      light: "var(--xs-static-constraint-readonly-bg)",
      dark: "var(--xs-static-constraint-readonly-bg)"
    },
    "--xs-constraint-derived-fg": {
      light: "var(--xs-static-constraint-derived-fg)",
      dark: "var(--xs-static-constraint-derived-fg)"
    },
    "--xs-constraint-derived-bg": {
      light: "var(--xs-static-constraint-derived-bg)",
      dark: "var(--xs-static-constraint-derived-bg)"
    },
    "--xs-constraint-locked-fg": {
      light: "var(--xs-static-constraint-locked-fg)",
      dark: "var(--xs-static-constraint-locked-fg)"
    },
    "--xs-constraint-locked-bg": {
      light: "var(--xs-static-constraint-locked-bg)",
      dark: "var(--xs-static-constraint-locked-bg)"
    },
    "--xs-constraint-noai-fg": {
      light: "var(--xs-static-constraint-noai-fg)",
      dark: "var(--xs-static-constraint-noai-fg)"
    },
    "--xs-constraint-noai-bg": {
      light: "var(--xs-static-constraint-noai-bg)",
      dark: "var(--xs-static-constraint-noai-bg)"
    },
    "--xs-constraint-budget-over-fg": {
      light: "var(--dsw-alias-state-warn-primary)",
      dark: "var(--dsw-alias-state-warn-primary)"
    },
    "--xs-constraint-budget-trimmed-fg": {
      light: "var(--dsw-alias-label-secondary)",
      dark: "var(--dsw-alias-label-secondary)"
    },
    "--xs-constraint-budget-bar": {
      light: "var(--xs-static-constraint-budget-bar)",
      dark: "var(--xs-static-constraint-budget-bar)"
    },
    "--xs-constraint-human-gate-fg": {
      light: "var(--xs-static-constraint-human-gate-fg)",
      dark: "var(--xs-static-constraint-human-gate-fg)"
    },
    "--xs-constraint-human-gate-bg": {
      light: "var(--xs-static-constraint-human-gate-bg)",
      dark: "var(--xs-static-constraint-human-gate-bg)"
    },
    "--xs-size-breakpoint-wide": {
      light: "1100px",
      dark: "1100px"
    },
    "--xs-size-panel-content-max": {
      light: "960px",
      dark: "960px"
    },
    "--xs-size-card-minheight": {
      light: "108px",
      dark: "108px"
    },
    "--xs-size-scrollregion-max": {
      light: "240px",
      dark: "240px"
    },
    "--xs-size-drawer-width": {
      light: "480px",
      dark: "480px"
    },
    "--xs-size-drawer-maxheight": {
      light: "640px",
      dark: "640px"
    },
    "--xs-size-modal-width": {
      light: "480px",
      dark: "480px"
    },
    "--xs-size-icon-sidebar": {
      light: "20px",
      dark: "20px"
    },
    "--xs-size-icon-inline": {
      light: "16px",
      dark: "16px"
    },
    "--xs-size-glyph-brand": {
      light: "32px",
      dark: "32px"
    },
    "--xs-size-control-height": {
      light: "32px",
      dark: "32px"
    },
    "--xs-size-chip-height": {
      light: "20px",
      dark: "20px"
    },
    "--xs-motion-duration-fast": {
      light: "100ms",
      dark: "100ms"
    },
    "--xs-motion-duration-overlay": {
      light: "300ms",
      dark: "300ms"
    },
    "--xs-motion-ease-standard": {
      light: "cubic-bezier(0.4, 0, 0.2, 1)",
      dark: "cubic-bezier(0.4, 0, 0.2, 1)"
    }
  }
};

// src/client/breakpoints.ts
function sizePx(name) {
  const table = xs_tokens_default.tokens ?? {};
  const raw = table[name]?.light;
  if (typeof raw !== "string" || !/^\d+(\.\d+)?px$/u.test(raw)) {
    throw new Error(`breakpoints: token「${name}」读不到或不是 px 值（拿到 ${JSON.stringify(raw)}）—— 断点的值只认设计 token`);
  }
  return Number(raw.replace(/px$/u, ""));
}
var BREAKPOINT_WIDE_PX = sizePx("--xs-size-breakpoint-wide");
var BREAKPOINT_NARROW_PX = 700;

// src/client/cang-style.ts
function installCangStyle() {
  registerStyleSheet("xuanshu-cang-style", `
.xs-cang{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-cang h1,.xs-cang h2{font-weight:600}.xs-cang h2{font-size:1.05rem}.xs-cang p{line-height:1.6}.xs-cang__boundary{position:sticky;top:0;z-index:1;background:var(--xs-constraint-noai-bg);color:var(--xs-constraint-noai-fg);padding:12px;border-radius:8px}
.xs-cang__toolbar,.xs-cang__actions{display:flex;align-items:center;flex-wrap:wrap;gap:var(--xs-space-toolbar);margin:16px 0}.xs-cang button,.xs-cang__drawer button{font:inherit;padding:7px 12px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}.xs-cang button:disabled,.xs-cang__drawer button:disabled{opacity:.5;cursor:not-allowed}
.xs-cang input,.xs-cang select,.xs-cang__drawer input{font:inherit;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:7px;min-width:0}.xs-cang__card{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad);margin:12px 0;background:var(--xs-surface-card)}.xs-cang code{overflow-wrap:anywhere;font-family:var(--font-mono,monospace);color:var(--xs-text-code)}.xs-cang__status{font-size:.8rem;font-weight:400}.xs-cang__how{opacity:.8;font-size:max(16px,var(--dsh-content-font-size,16px))}.xs-cang__more>summary{cursor:pointer}.xs-cang__more>div{display:flex;flex-wrap:wrap;gap:8px}.xs-cang__group>summary{padding:8px;cursor:pointer}.xs-cang footer{margin-top:24px;color:var(--xs-text-secondary)}.xs-cang__confirm{padding:16px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-nested)}
.xs-cang__overlay{position:fixed;inset:0;display:flex;justify-content:flex-end;background:var(--xs-surface-overlay-mask);pointer-events:auto;z-index:100}.xs-cang__drawer{width:min(560px,100%);overflow:auto;background:var(--xs-surface-overlay);color:var(--xs-text-body);padding:var(--xs-space-overlay-pad);box-sizing:border-box;box-shadow:var(--xs-shadow-card)}.xs-cang__drawer form>label{display:block;margin:16px 0}.xs-cang__drawer form>label input{display:block;box-sizing:border-box;width:100%;margin-top:8px}.xs-cang__drawer fieldset label{display:block;margin:8px 0}.xs-cang__drawer fieldset input{margin-right:8px}
@media(min-width: ${BREAKPOINT_WIDE_PX}px){.xs-cang__more>summary{display:none}.xs-cang__more:not([open])>div{display:flex}}
@media(max-width: ${BREAKPOINT_NARROW_PX}px){.xs-cang{padding:14px}.xs-cang__toolbar{align-items:stretch;flex-direction:column}.xs-cang__drawer{padding:16px}}`);
  installXuanshuStyles();
}

// src/client/cang.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function createCangController() {
  let state = { revision: 0 };
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** 打开抽屉编辑某条登记（`draft` 在场 = 抽屉展开）。 */
    edit: (draft) => {
      state = { ...state, draft };
      notify();
    },
    /** 关抽屉（草稿丢弃由调用方决定 —— controller 不管「要不要保存」）。 */
    close: () => {
      state = { ...state, draft: void 0 };
      notify();
    },
    /** 列表可能过时了：面板与抽屉各取一次（**只由人点触发**）。 */
    changed: () => {
      state = { ...state, revision: state.revision + 1 };
      notify();
    }
  };
}
function installCangClient(ctx) {
  installCangStyle();
  const api = {
    list: (signal) => rpcCall(ctx, "cang.list", void 0, signal),
    validate: (path, signal) => rpcCall(ctx, "cang.validate", { path }, signal),
    register: (draft) => rpcCall(ctx, "cang.register", draft),
    update: (draft) => rpcCall(ctx, "cang.update", draft),
    remove: (id) => rpcCall(ctx, "cang.remove", { id }),
    open: (id) => rpcCall(ctx, "cang.open", { id }),
    reveal: (id) => rpcCall(ctx, "cang.reveal", { id }),
    capabilities: (signal) => rpcCall(ctx, "cang.capabilities", void 0, signal),
    pickDirectory: () => rpcCall(ctx, "cang.pickDirectory")
  };
  const controller = createCangController();
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "cang", inject: () => ({ api, controller }) }, CangPanel));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: "cang", order: 50, label: "藏" }, CangIcon));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "xuanshu-cang-drawer", inject: () => ({ api, controller }) }, CangOverlay));
}
function CangIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "M4.5 8 L12 4 L19.5 8" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("rect", { x: "5.5", y: "8", width: "13", height: "11.5", rx: "2" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "M12 5.5 V9.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("circle", { cx: "12", cy: "14", r: "1.8" })
  ] });
}

// src/client/consult-api.ts
var CONSULT_ENDPOINTS = {
  create: "consult.create",
  send: "consult.send",
  list: "consult.list",
  read: "consult.read",
  rename: "consult.rename",
  defaults: "consult.defaults"
};
function createConsultApi(ctx) {
  return {
    create: (payload, signal) => rpcCall(ctx, CONSULT_ENDPOINTS.create, payload, signal),
    send: (payload, signal) => rpcCall(ctx, CONSULT_ENDPOINTS.send, payload, signal),
    list: (signal) => rpcCall(ctx, CONSULT_ENDPOINTS.list, {}, signal),
    read: (payload, signal) => rpcCall(
      ctx,
      CONSULT_ENDPOINTS.read,
      payload,
      signal
    ),
    rename: (payload, signal) => rpcCall(ctx, CONSULT_ENDPOINTS.rename, payload, signal),
    defaults: (signal) => rpcCall(ctx, CONSULT_ENDPOINTS.defaults, {}, signal)
  };
}

// src/client/consult.tsx
var import_react7 = require("react");

// src/client/consult-model.ts
var CONSULT_SESSION_PREFIX = "session-xs-consult-";
function isConsultSession(sessionId) {
  return typeof sessionId === "string" && sessionId.startsWith(CONSULT_SESSION_PREFIX);
}
function shortConsultId(sessionId) {
  const rest = isConsultSession(sessionId) ? sessionId.slice(CONSULT_SESSION_PREFIX.length) : sessionId;
  return `#consult-${rest.slice(0, 8)}`;
}
function initialSelection(optional) {
  return optional.filter((source) => source.level === "base").map((source) => source.slug);
}
function groupOptional(optional) {
  const groups = [];
  for (const level of ["base", "optional"]) {
    const items = optional.filter((source) => source.level === level);
    if (items.length > 0) groups.push({ level, items });
  }
  return groups;
}
function toggleSelection(selected, slug) {
  return selected.includes(slug) ? selected.filter((row) => row !== slug) : [...selected, slug];
}
function contextSummary(input) {
  const parts = ["底座 + 底稿"];
  if (input.selected.length > 0) parts.push(`${String(input.selected.length)} 个谱`);
  if (input.mounts.length > 0) parts.push(`${String(input.mounts.length)} 项挂载`);
  return parts.join(" + ");
}
var historyEmptyCopy = {
  /** 一个可选谱都没有时的追加行（S6 §6 empty 行）。 */
  // 2026-11-01：原来写「（去 S5）」—— S5 是设计稿的屏幕编号，界面上没有这个编号。
  // 这扇门就是侧栏行「谱」（判据 N-001 只留那一扇），所以直接点名它。
  noneOptionalPu: "谱都非必填；你可以先空手问一句，或先去建一个谱（点侧栏「谱」）。",
  /** 历史子页首次空态（S7 §2.3①）。 */
  noRecords: "还没有问事记录",
  noRecordsSub: "每次问事都会自动存成本地文件，随时能回来接着读。",
  /** 数据形态说明行（S7 §2.1③）。 */
  storageNote: "会话记录 = 本地文件（JSONL 事件日志），玄枢只读不改",
  searchBoundary: "列表按本地时间倒序；搜索只搜本次问事的标题与首句，不搜全文",
  /** 无源拦截引导的标题与两条去路（S6 §5 步骤 5a）。 */
  nudgeTitle: "需要先给这一问一点依据",
  nudgePathPu: "在勾选区勾一个谱",
  // 2026-11-01：原来写「（去 S8）」—— S8 是设计稿的屏幕编号，界面上没有这个编号。
  // 改成点名这一屏上真有的那个按钮。
  nudgePathMount: "临时挂载一个工作区 / 工作流（点「临时挂载…」）",
  /** 末条：显式的泛问出口 —— 不是「没有谱就不能问」。 */
  nudgePlainExit: "只带底座 + 底稿问一次"
};
function nudgeNeeded(input) {
  if (input.question.trim() === "") return false;
  if (input.selected.length > 0 || input.mounts.length > 0) return false;
  return (input.selectableCount ?? Number.POSITIVE_INFINITY) > 0;
}
function localDateKey(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "未知";
  const pad = (value) => String(value).padStart(2, "0");
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
function localClock(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "--:--";
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
function groupHistory(items, now = /* @__PURE__ */ new Date()) {
  const today = localDateKey(now.toISOString());
  const groups = /* @__PURE__ */ new Map();
  for (const item of items) {
    const key = localDateKey(item.createdAt);
    const bucket = groups.get(key);
    if (bucket === void 0) groups.set(key, [item]);
    else bucket.push(item);
  }
  return [...groups.entries()].sort((left, right) => left[0] < right[0] ? 1 : left[0] > right[0] ? -1 : 0).map(([key, rows]) => ({
    key,
    label: key === today ? `今天 · ${String(rows.length)} 条` : `更早 · ${key.slice(5)} · ${String(rows.length)} 条`,
    items: rows
  }));
}
function formatHistoryMeta(item) {
  const parts = [localClock(item.createdAt), `${String(item.turns)} 轮`, `谱 ${String(item.pus.length)}`];
  if (item.mounts.length > 0) parts.push(`挂载 ${String(item.mounts.length)}`);
  return parts.join(" · ");
}
function filterHistory(items, query, range = "all", now = /* @__PURE__ */ new Date()) {
  const keyword = query.trim().toLowerCase();
  const today = localDateKey(now.toISOString());
  return items.filter((item) => {
    if (keyword !== "" && !item.title.toLowerCase().includes(keyword)) return false;
    if (range === "all") return true;
    const isToday = localDateKey(item.createdAt) === today;
    return range === "today" ? isToday : !isToday;
  });
}
function roleLabel(role) {
  return role === "user" ? "你" : "AI";
}
var ADOPTED_DRAFT_SOURCE = "xuanshu-bestof-adopted";
function draftStateOf(round, messageId, drafts) {
  if (drafts.resolved !== true) return "unknown";
  if (round.currentId === messageId) return "current";
  if (round.rejected) return "rejected";
  return round.currentId === void 0 ? "unknown" : "superseded";
}
function reviewTimeline(messages, drafts) {
  const byMessage = /* @__PURE__ */ new Map();
  if (drafts !== void 0 && drafts !== null) {
    for (const round of drafts.rounds) {
      for (const messageId of round.messageIds) byMessage.set(messageId, round);
    }
  }
  const items = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === void 0) continue;
    const key = `${String(index)}-${message.role}`;
    const messageId = message.messageId;
    const round = drafts === void 0 || drafts === null || message.source !== ADOPTED_DRAFT_SOURCE || messageId === void 0 ? void 0 : byMessage.get(messageId);
    if (round === void 0 || drafts === void 0 || drafts === null || messageId === void 0) {
      items.push({ kind: "message", key, message });
      continue;
    }
    const state = draftStateOf(round, messageId, drafts);
    const last = items[items.length - 1];
    if (last !== void 0 && last.kind === "round" && last.runId === round.runId && last.round === round.round) {
      last.items.push({ message, state });
      if (state === "current") last.state = "current";
      continue;
    }
    items.push({
      kind: "round",
      key: `${key}-round-${round.runId}`,
      round: round.round,
      runId: round.runId,
      state,
      items: [{ message, state }]
    });
  }
  return items;
}
function draftRoundLabel(item) {
  const prefix = `第 ${String(item.round)} 轮合参`;
  if (item.state === "current") return `${prefix} · 当前采用稿`;
  if (item.state === "rejected") return `${prefix} · 已否决（不列为当前）`;
  if (item.state === "superseded") return `${prefix} · 已被后来的一份取代`;
  return `${prefix} · 当前性未知`;
}
function draftBadgeLabel(state) {
  if (state === "current") return "当前采用稿";
  if (state === "rejected") return "已被否决 · 非当前";
  if (state === "superseded") return "已被后一份取代 · 非当前";
  return "当前性未知";
}
async function openConsultSession(options) {
  const { sessionId, refresh, open } = options;
  const tail = `会话已建好（${shortConsultId(sessionId)}）`;
  if (open === void 0) {
    return { ok: false, reason: "unavailable", message: `${tail}，但 DSH 会话面板不可用：请在侧栏工作区里打开它。` };
  }
  if (refresh !== void 0) {
    try {
      await refresh();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: "refresh-failed",
        message: `${tail}，但刷新 DSH 会话目录失败：${reason}。请重试，或在侧栏工作区里打开它。`
      };
    }
  }
  try {
    open(sessionId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "open-failed",
      message: `${tail}，但 DSH 会话面板没能打开：${reason}。请重试，或在侧栏工作区里打开它。`
    };
  }
  return { ok: true };
}

// src/client/consult-views.tsx
var import_react5 = require("react");
var import_jsx_runtime6 = require("react/jsx-runtime");
function lockedExplain(source) {
  return source.kind === "digao" ? "底稿与八字同级、默认必加载的基础谱；它是纯派生的，要改就改源头（谱 / 工作区 / 工作流）。" : "底座始终在场、不可关：它是每一场问事的前提。";
}
function XsConsultPicker({ required, optional, selected, onToggle, onOpenDetail }) {
  const groups = groupOptional(optional);
  const [explaining, setExplaining] = (0, import_react5.useState)(void 0);
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "xs-consult__block", "data-xuanshu-block": "pu-picker", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { children: "① 本次要用的谱（勾选）" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h4", { className: "xs-consult__group-head", "data-xuanshu-group-head": "locked", children: "── 默认在场 · 不可关 ──" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("ul", { className: "xs-consult__locked", "data-xuanshu-locked-list": String(required.length), children: required.map((source) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("li", { className: "xs-consult__row xs-consult__row--locked", "data-xuanshu-locked": source.kind, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
        "button",
        {
          type: "button",
          className: "xs-consult__locked-hit",
          "data-xuanshu-action": "locked-why",
          onClick: () => {
            setExplaining(explaining === source.kind ? void 0 : source.kind);
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__lock", "aria-hidden": "true", children: "🔒" }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__row-name", children: source.name }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { "aria-hidden": "true", children: "·" }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__badge", "data-xuanshu-badge": "locked", children: "默认在场 · 不可关" }),
            source.kind === "digao" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__badge", "data-xuanshu-badge": "derived", children: "纯派生 · 不可手改" }) : null
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
        "div",
        {
          className: "xs-consult__locked-card",
          "data-xuanshu-locked-card": source.kind,
          hidden: explaining !== source.kind,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: lockedExplain(source) }),
            source.present ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": `locked-absent-${source.kind}`, children: source.reason ?? "这一项现在不在场" }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "xs-consult__actions", children: source.kind === "digao" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_jsx_runtime6.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__note", "data-xuanshu-note": "goto-pu-sidebar", children: "三个源头：谱（点侧栏「谱」改）/ 工作区 / 工作流；底稿本身在底稿面板看。" }) }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "locked-goto-mingpan", onClick: onOpenDetail, children: "去命盘详情 ▸" }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__note", children: "要改出生信息：走命盘详情里的「重新录制出生信息」。" })
            ] }) })
          ]
        }
      )
    ] }, source.kind)) }),
    groups.map((group2) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__group", "data-xuanshu-group": group2.level, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h4", { className: "xs-consult__group-head", children: group2.level === "base" ? "── 基础输入级 base · 默认勾选" : "── 可选输入级 optional" }),
      group2.items.map((source) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { className: "xs-consult__row", "data-xuanshu-pu": source.slug, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "input",
          {
            type: "checkbox",
            "data-xuanshu-field": `pu-${source.slug}`,
            checked: selected.includes(source.slug),
            onChange: () => {
              onToggle(source.slug);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__row-name", children: source.name }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("small", { className: "xs-consult__note", children: source.summary })
      ] }, source.slug))
    ] }, group2.level)),
    optional.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "no-optional-pu", children: historyEmptyCopy.noneOptionalPu }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "goto-pu-sidebar", children: "要改谱：点侧栏「谱」（谱管理只有那一个入口）。" })
  ] });
}
function XsConsultMountPlaceholder({ mounts }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "xs-consult__block", "data-xuanshu-block": "mounts", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { children: "③ 临时挂载（工作区 / 工作流）" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "mount-boundary", children: "工作区 / 工作流不是谱：它们是挂载，谱是勾选。" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "button",
        {
          type: "button",
          "data-xuanshu-action": "open-mounts",
          disabled: true,
          title: "临时挂载账本还没装配（属票 12 · 临时挂载账本）",
          children: "＋ 临时挂载"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { className: "xs-consult__note", "data-xuanshu-note": "mount-placeholder", children: [
        "属票 12 · 临时挂载账本还没接上；本票只留展示位（已挂 ",
        mounts.length,
        " 项）。"
      ] })
    ] })
  ] });
}
function XsConsultAsk({
  question,
  selected,
  mounts,
  busy,
  summary,
  error,
  nudge = false,
  mountable = false,
  onQuestion,
  onStart,
  onPlainAsk,
  onGotoHistory,
  onClearNudge
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "xs-consult__block", "data-xuanshu-block": "ask", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { children: "② 说事（可先空手开一个会话）" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__summary", "data-xuanshu-note": "context-summary", children: `本次上下文将含：${summary}` }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "ask-selection", children: `已勾 ${String(selected.length)} 个可选谱 · 已挂 ${String(mounts.length)} 项（底座与底稿恒在场，不在这里计）` }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { className: "xs-consult__field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: "这一次想问什么" }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "textarea",
        {
          "data-xuanshu-field": "consult-question",
          placeholder: "说这件事…（进会话后仍在 DSH 原生输入区里继续）",
          value: question,
          onChange: (event) => {
            onQuestion(event.target.value);
          }
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "xs-consult__actions", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      "button",
      {
        type: "button",
        className: "xs-btn xs-btn--primary",
        "data-xuanshu-action": "start-consult",
        disabled: busy,
        onClick: onStart,
        children: busy ? "开问事中…" : "＋ 开一次问事"
      }
    ) }),
    nudge ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__nudge", "data-xuanshu-nudge": "no-source", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__nudge-title", children: historyEmptyCopy.nudgeTitle }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("ol", { className: "xs-consult__paths", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("li", { children: historyEmptyCopy.nudgePathPu }),
        mountable ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("li", { children: historyEmptyCopy.nudgePathMount }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "clear-nudge", onClick: onClearNudge, children: "回到勾选区" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "plain-ask", onClick: onPlainAsk, children: historyEmptyCopy.nudgePlainExit }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "goto-history", onClick: onGotoHistory, children: "改从历史里接着问 ▸" })
      ] })
    ] }) : null,
    error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__error", "data-xuanshu-error": "create", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "retry-create", onClick: onStart, children: "重试开会话" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "goto-history", onClick: onGotoHistory, children: "改从历史里接着问 ▸" })
      ] })
    ] })
  ] });
}
function XsConsultRecentCard({ session, onContinue }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "xs-consult__block", "data-xuanshu-block": "recent", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { children: "④ 最近一次会话" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { className: "xs-consult__recent-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__shortid", "data-xuanshu-short-id": shortConsultId(session.sessionId), children: shortConsultId(session.sessionId) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: session.title }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("small", { className: "xs-consult__note", children: formatHistoryMeta(session) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "xs-consult__actions", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "continue-consult", onClick: onContinue, children: "继续这次问事 ▸" }) })
  ] });
}
function XsConsultHistoryList({
  items,
  loading,
  error,
  query,
  range,
  now,
  home,
  onQuery,
  onRange,
  onOpen,
  onBack,
  onStart,
  onCreatePu,
  onRetry
}) {
  const filtered = filterHistory(items, query, range, now);
  const groups = groupHistory(filtered, now);
  const neverAsked = items.length === 0;
  const noMatch = !neverAsked && filtered.length === 0;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "xs-consult__history", "data-xuanshu-view": "history-list", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "back-lobby", onClick: onBack, children: "← 回到当前会话" }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "input",
        {
          type: "search",
          "data-xuanshu-field": "history-search",
          placeholder: "搜索 会话标题 / 首句",
          value: query,
          onChange: (event) => {
            onQuery(event.target.value);
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
        "select",
        {
          "data-xuanshu-field": "history-range",
          value: range,
          onChange: (event) => {
            onRange(event.target.value);
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "all", children: "全部" }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "today", children: "今天" }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "earlier", children: "更早" })
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "button",
        {
          type: "button",
          "data-xuanshu-action": "export-selected",
          disabled: true,
          title: "导出还没做（属后续票）",
          children: "导出选中"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "delete-selected", disabled: true, title: "删除还没做（属后续票）", children: "删除" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "contract-scope", children: "导出与删除还没做，所以这两个按钮是灰的 —— 不是坏了。" }),
    loading ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", "data-xuanshu-state": "loading", children: "正在读本地会话清单…" }) : null,
    error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__error", "data-xuanshu-error": "list", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", children: `数据在本地：${withTrailingSeparator(homePath(home, "sessions"))}（只读展示）` }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "xs-consult__actions", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "retry-list", onClick: onRetry, children: "重试" }) })
    ] }),
    !loading && error === void 0 && neverAsked ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__empty", "data-xuanshu-state": "empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__empty-why", children: historyEmptyCopy.noRecords }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", children: historyEmptyCopy.noRecordsSub }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "xs-btn xs-btn--primary", "data-xuanshu-action": "start-consult", onClick: onStart, children: "＋ 开一次问事 ▸ S6" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "create-pu", onClick: onCreatePu, children: "先建一个谱" })
      ] })
    ] }) : null,
    !loading && error === void 0 && noMatch ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__empty", "data-xuanshu-state": "no-match", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__empty-why", children: `没有匹配「${query}」的记录` }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "clear-filter", onClick: () => {
          onQuery("");
        }, children: "清空筛选" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "button",
          {
            type: "button",
            "data-xuanshu-action": "reset-filter",
            onClick: () => {
              onQuery("");
              onRange("all");
            },
            children: "回到全部"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "start-consult", onClick: onStart, children: "＋ 开一次问事 ▸ S6" })
      ] })
    ] }) : null,
    groups.map((group2) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__group", "data-xuanshu-history-group": group2.key, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h4", { className: "xs-consult__group-head", children: group2.label }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("ul", { className: "xs-consult__rows", children: group2.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
        "button",
        {
          type: "button",
          className: "xs-consult__row-hit",
          "data-xuanshu-row": item.sessionId,
          onClick: () => {
            onOpen(item.sessionId);
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__shortid", children: shortConsultId(item.sessionId) }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__row-title", children: item.title }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("small", { className: "xs-consult__note", children: formatHistoryMeta(item) })
          ]
        }
      ) }, item.sessionId)) })
    ] }, group2.key)),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "history-storage", children: historyEmptyCopy.storageNote }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "history-search-boundary", children: historyEmptyCopy.searchBoundary })
  ] });
}
function XsConsultMessageRow({ message, draft }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
    "article",
    {
      className: `xs-consult__message xs-consult__message--${message.role}`,
      "data-xuanshu-message": message.role,
      ...draft === void 0 ? {} : { "data-xuanshu-draft": draft },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__role", children: roleLabel(message.role) }),
        draft === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__badge", "data-xuanshu-draft-badge": draft, children: draftBadgeLabel(draft) }),
        message.source === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("small", { className: "xs-consult__note", "data-xuanshu-source": message.source, children: `注入 · ${message.source}` }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__text", children: message.text })
      ]
    }
  );
}
function XsConsultHistoryReader({
  session,
  messages,
  drafts,
  loading = false,
  error,
  onBack,
  onContinue,
  onRetry
}) {
  const items = reviewTimeline(messages, drafts);
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "xs-consult__reader", "data-xuanshu-view": "reader", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "back-list", onClick: onBack, children: "← 列表" }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__shortid", children: shortConsultId(session.sessionId) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__row-title", children: session.title }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("small", { className: "xs-consult__note", children: formatHistoryMeta(session) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "xs-consult__badge", "data-xuanshu-badge": "readonly", children: "【只读 · 不可编辑】" }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "continue-consult", onClick: onContinue, children: "继续这次问事 ▸" })
    ] }),
    loading ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", "data-xuanshu-state": "loading", children: "正在读这条会话…" }) : null,
    error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__error", "data-xuanshu-error": "read", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "xs-consult__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "retry-read", onClick: onRetry, children: "重试" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", "data-xuanshu-action": "back-list", onClick: onBack, children: "返回列表" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "xs-consult__messages", children: items.map((item) => item.kind === "message" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(XsConsultMessageRow, { message: item.message }, item.key) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      "section",
      {
        className: "xs-consult__round",
        "data-xuanshu-round": String(item.round),
        "data-xuanshu-round-state": item.state,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h4", { className: "xs-consult__round-head", "data-xuanshu-round-head": String(item.round), children: draftRoundLabel(item) }),
          item.items.map((row, index) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            XsConsultMessageRow,
            {
              message: row.message,
              draft: row.state
            },
            `${item.key}-${String(index)}`
          ))
        ]
      },
      item.key
    )) }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "reader-readonly", children: "回看是只读的：不改会话记录、不进会话、不追加任何事件。" })
  ] });
}

// src/client/PuPanel.tsx
var import_react6 = require("react");
var import_jsx_runtime7 = require("react/jsx-runtime");
var pendingJob;
var pendingView = "create";
var pendingSelected;
var pendingIntent;
var intentListeners = /* @__PURE__ */ new Set();
function toPuPoint(ref) {
  return {
    slug: ref.slug,
    name: ref.name,
    body: ref.body,
    level: ref.level === "base" ? "base" : "optional",
    description: ref.description ?? "",
    summary: ref.summary ?? "",
    source: ref.source ?? "",
    updatedAt: ref.updatedAt ?? ""
  };
}
function peekPuIntent() {
  return pendingIntent;
}
function consumePuIntent() {
  const taken = pendingIntent;
  pendingIntent = void 0;
  return taken;
}
function announcePuIntent() {
  for (const listener of [...intentListeners]) listener();
}
function requestPuCreate() {
  pendingIntent = { kind: "create" };
  announcePuIntent();
}
function requestPuOpen(pu) {
  pendingIntent = { kind: "open", pu };
  announcePuIntent();
}
function requestPuCreateAndGo(navigate) {
  requestPuCreate();
  navigate("pus");
}
function requestPuOpenAndGo(pu, navigate) {
  requestPuOpen(pu);
  navigate("pus");
}
function initialViewOf(intent) {
  if (pendingJob !== void 0) return pendingView;
  if (intent === void 0) return "list";
  return intent.kind === "create" ? "create" : "detail";
}
var blank = { name: "", level: "optional", description: "", body: "# 概览\n", summary: "" };
var errorText = (error) => error instanceof Error ? error.message : String(error);
async function fileData(file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
  return { name: file.name, data };
}
function PuPanel({ ctx, openSession }) {
  const [rows, setRows] = (0, import_react6.useState)([]);
  const [loading, setLoading] = (0, import_react6.useState)(true);
  const [query, setQuery] = (0, import_react6.useState)("");
  const [level, setLevel] = (0, import_react6.useState)("");
  const [source, setSource] = (0, import_react6.useState)("");
  const [mount] = (0, import_react6.useState)(() => {
    const intent = peekPuIntent();
    const view2 = initialViewOf(intent);
    const selected2 = intent !== void 0 && intent.kind === "open" && pendingJob === void 0 ? toPuPoint(intent.pu) : pendingSelected;
    return { intent, view: view2, selected: selected2, draft: view2 === "detail" && selected2 !== void 0 ? selected2 : blank };
  });
  const [view, setView] = (0, import_react6.useState)(mount.view);
  const [baseExplaining, setBaseExplaining] = (0, import_react6.useState)(false);
  const [step, setStep] = (0, import_react6.useState)(pendingJob ? 3 : 1);
  const [job, setJob] = (0, import_react6.useState)(pendingJob);
  const [text, setText] = (0, import_react6.useState)("");
  const [files, setFiles] = (0, import_react6.useState)([]);
  const [draft, setDraft] = (0, import_react6.useState)(mount.draft);
  const [selected, setSelected] = (0, import_react6.useState)(mount.selected);
  const [original, setOriginal] = (0, import_react6.useState)(mount.selected === void 0 ? "" : JSON.stringify(mount.selected));
  const [error, setError] = (0, import_react6.useState)("");
  const [busy, setBusy] = (0, import_react6.useState)(false);
  const call = (method, payload) => rpcCall(ctx, method, payload);
  const reload = async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await call("pu.list"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  (0, import_react6.useEffect)(() => {
    void reload();
  }, []);
  (0, import_react6.useEffect)(() => {
    if (job?.status !== "running") return;
    let disposed = false;
    let timer;
    const poll = async () => {
      try {
        const current = await call("pu.job", { id: job.id });
        if (disposed) return;
        pendingJob = current;
        setJob(current);
        if (current.status === "ready" && current.draft && view === "create") {
          setDraft(current.draft);
          setStep(4);
        }
        if (current.status === "error") setError(current.error ?? "转换失败");
        if (current.status === "running") timer = setTimeout(() => {
          void poll();
        }, 1200);
      } catch (e) {
        if (!disposed) setError(errorText(e));
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status]);
  (0, import_react6.useEffect)(() => {
    if (job?.status === "ready" && job.draft && step === 3 && view === "create") {
      setDraft(job.draft);
      setStep(4);
    }
  }, [job, step]);
  (0, import_react6.useEffect)(() => {
    if (mount.intent !== void 0 && peekPuIntent() === mount.intent) consumePuIntent();
    const applyIntent = () => {
      const intent = consumePuIntent();
      if (intent === void 0) return;
      setError("");
      if (intent.kind === "create") {
        setSelected(void 0);
        setDraft(blank);
        setOriginal("");
        setJob(pendingJob);
        setStep(pendingJob ? 3 : 1);
        setView("create");
        return;
      }
      const pu = toPuPoint(intent.pu);
      setSelected(pu);
      setDraft(pu);
      setOriginal(JSON.stringify(pu));
      setView("detail");
    };
    intentListeners.add(applyIntent);
    return () => {
      intentListeners.delete(applyIntent);
    };
  }, []);
  const run = async (operation) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const open = (slug) => void run(async () => {
    const pu = await call("pu.read", { slug });
    setSelected(pu);
    setDraft(pu);
    setOriginal(JSON.stringify(pu));
    setView("detail");
  });
  const back = () => {
    if (view === "detail" && original !== JSON.stringify(draft) && !window.confirm("尚有未保存的改动，确认离开？")) return;
    setView("list");
    setError("");
  };
  const field = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const levels = /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { children: [
    "级别 ",
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("select", { value: draft.level, onChange: (e) => field("level", e.target.value), children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "base", children: "基础输入级 base" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "optional", children: "可选输入级 optional" })
    ] })
  ] });
  const preview = /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "xs-pu-detail", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { children: [
      "名称",
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { value: draft.name, onChange: (e) => field("name", e.target.value) })
    ] }),
    levels,
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { children: [
      "描述（manifest 概览，AI 优先读）",
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("textarea", { value: draft.description, onChange: (e) => field("description", e.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { children: [
      "细节（Markdown 一级标题分节，须含概览）",
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("textarea", { className: "xs-pu-body", value: draft.body, onChange: (e) => field("body", e.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { children: [
      "汇总 summary.md（AI 快速定位，人可改）",
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("textarea", { value: draft.summary, onChange: (e) => field("summary", e.target.value) })
    ] })
  ] });
  const generate = () => void run(async () => {
    const created = await call("pu.generate", { name: draft.name, level: draft.level, text, attachments: await Promise.all(files.map(fileData)), clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    pendingJob = created;
    pendingView = "create";
    pendingSelected = void 0;
    setJob(created);
    setStep(3);
  });
  const filtered = rows.filter((p) => (!level || p.level === level) && (!source || p.source === source) && (!query || `${p.name}
${p.description}
${p.body}`.toLowerCase().includes(query.toLowerCase())));
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("main", { className: "xs-pu", "data-xuanshu-panel": "pus", "aria-label": "谱管理", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h1", { children: view === "create" ? "创建新谱" : view === "detail" ? `谱管理 / ${selected?.name}` : "谱管理" }),
      view !== "list" && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: back, children: "← 返回列表" })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { role: "alert", children: [
      error,
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: () => void reload(), children: "重试" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "数据目录：$DSH_HOME/xuanshu/pus/" })
    ] }),
    view === "list" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "xs-pu-toolbar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { "aria-label": "搜索谱", placeholder: "搜索 名称 / 描述 / 正文", value: query, onChange: (e) => setQuery(e.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("select", { "aria-label": "级别筛选", value: level, onChange: (e) => setLevel(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "", children: "全部级别" }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "base", children: "基础输入级" }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "optional", children: "可选输入级" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("select", { "aria-label": "来源筛选", value: source, onChange: (e) => setSource(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "", children: "全部来源" }),
          ["manual", "ai-assisted", "sediment", "workflow"].map((s) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { children: s }, s))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: () => {
          setView("create");
          setStep(pendingJob ? 3 : 1);
          setJob(pendingJob);
          if (!pendingJob) setDraft(blank);
        }, children: "＋ 创建新谱" })
      ] }),
      loading ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "status", children: "正在读取谱…" }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("h2", { children: [
            "基础输入级 base · ",
            filtered.filter((p) => p.level === "base").length,
            " 个"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "进底稿提炼源 · 级别≠必填：所有谱都非必填，唯一必填项是底座八字。" }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { children: [
            "🔒 底座（八字） · 只读 · 由出生信息与底座生成 · 默认在场 · 不可关 ",
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { "data-xuanshu-action": "base-why", onClick: () => {
              setBaseExplaining(!baseExplaining);
            }, children: "为什么不能改" })
          ] }),
          baseExplaining ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "xs-pu__note", "data-xuanshu-note": "base-why", children: "底座（八字）由出生信息算出来，默认在场、不可关。要改就重新录一次出生信息并确认 —— 走侧栏「填八字」那个向导。" }) : null
        ] }),
        ["base", "optional"].map((group2) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { children: [
          group2 === "optional" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("h2", { children: [
              "可选输入级 optional · ",
              filtered.filter((p) => p.level === group2).length,
              " 个"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "底稿不采 · 问事时按需追加" })
          ] }),
          filtered.filter((p) => p.level === group2 || group2 === "optional" && p.error).map((p) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("article", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { children: p.name }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: p.description }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("small", { children: [
                p.source,
                " · ",
                momentOf(p.updatedAt),
                p.stale && " · 汇总可能过期"
              ] }),
              p.error && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "alert", children: p.error })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { disabled: !!p.error || busy, onClick: () => open(p.slug), children: "打开 / 编辑" })
          ] }, p.slug))
        ] }, group2)),
        !filtered.length && (rows.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "没有匹配的谱" }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: () => {
            setQuery("");
            setLevel("");
            setSource("");
          }, children: "清空筛选" })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "还没有谱。谱由你积累，非必填、不阻塞使用；想建就从「＋ 创建新谱」开始。" }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: () => {
            setView("create");
          }, children: "创建第一个谱" })
        ] }))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "本列表只收谱。工作区 / 工作流与谱并列独立、不是谱。你自己的本地文件在藏库里，永不进 AI。" })
    ] }),
    view === "detail" && selected && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
      preview,
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { children: [
        draft.level === "base" ? "本谱是底稿提炼源（进底稿）" : "底稿不采；问事时按需追加",
        " · 级别变更下次底稿刷新生效。"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { children: [
        "元信息：spec pu/1 · source ",
        selected.source,
        " · updated_at ",
        momentOf(selected.updatedAt),
        " · 签：预留字段，暂不启用"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { children: [
        "数据目录：$DSH_HOME/xuanshu/pus/",
        selected.slug,
        "/"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { disabled: busy, onClick: () => void run(async () => {
        if (draft.body !== selected.body && draft.summary !== selected.summary && !window.confirm(`正文与汇总均改变。${draft.level === "base" ? "会影响底稿提炼源。" : "只在问事按需追加。"}确认保存这些事实？`)) return;
        const saved = await call("pu.update", { slug: selected.slug, draft, confirmed: true });
        setSelected(saved);
        setDraft(saved);
        setOriginal(JSON.stringify(saved));
        await reload();
      }), children: "保存" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { disabled: busy || job?.status === "running", onClick: () => void run(async () => {
        const created = await call("pu.generate", { name: draft.name, level: draft.level, text: `# 当前谱
${draft.description}
${draft.body}`, summaryOnly: true });
        pendingJob = created;
        pendingView = "detail";
        pendingSelected = { ...selected, ...draft };
        setJob(created);
      }), children: "重建 summary（AI 提炼）" }),
      job?.status === "running" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "xs-pu__note", role: "status", "data-xuanshu-note": "summary-rebuilding", children: "正在让 AI 重新提炼汇总…（原来的汇总先不动，提炼完你决定要不要采用）" }) : null,
      job?.status === "ready" && job.draft && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: () => {
        field("summary", job.draft.summary);
        pendingJob = void 0;
        setJob(void 0);
      }, children: "采用候选汇总（保存后落盘）" }),
      job?.status === "ready" && job.draft ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "xs-pu__note", role: "status", "data-xuanshu-note": "summary-candidate", children: "新汇总已经提炼好了（还在这个框外面）：点「采用候选汇总」才会替换上面的内容，替换后还要点「保存」才真正写入文件。" }) : null,
      job?.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "xs-pu__error", role: "alert", "data-xuanshu-note": "summary-failed", children: [
        "重建没有成功：",
        job.error ?? "没有给出原因"
      ] }) : null
    ] }),
    view === "create" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { "aria-label": "创建步骤", children: "① 给资料 → ② 定义谱名 → ③ AI 转换中 → ④ 生成预览 → ⑤ 确认落盘" }),
      step === 1 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { children: [
          "资料文字",
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("textarea", { value: text, onChange: (e) => setText(e.target.value), placeholder: "把你知道的先写进来" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { children: [
          "附件（MD / PDF / 任意文件）",
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { type: "file", multiple: true, onChange: (e) => setFiles(Array.from(e.target.files ?? [])) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("ul", { children: files.map((f, i) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("li", { children: f.name }, i)) }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "暂时只支持文字与附件；语音还没做。" }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { disabled: !text.trim() && !files.length, onClick: () => setStep(2), children: "下一步" })
      ] }),
      step === 2 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { children: [
          "谱名",
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { value: draft.name, onChange: (e) => field("name", e.target.value) })
        ] }),
        levels,
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "谱名唯一 · 目录名小写、- 连接、可含中文。所有谱均非必填。" }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { "data-xuanshu-note": "path-preview", children: draft.name.trim() === "" ? "预览：填了谱名，这里会显示它落在 pus/ 下的路径。" : `预览：pus/${draft.name.trim().normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-+|-+$/g, "")}/` }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: () => setStep(1), children: "返回改资料" }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { disabled: busy || !draft.name.trim(), onClick: generate, children: "开始转换" })
      ] }),
      step === 3 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { role: "status", children: [
        job?.status === "running" ? "AI 正在读取资料、分节并提炼汇总。" : job?.error ?? "转换已中断，可重新开始。",
        " 借用 DSH coding 工具；中断不落盘。",
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { disabled: job?.status !== "running", onClick: () => void run(async () => {
          const canceled = await call("pu.cancel", { id: job?.id });
          setJob(canceled);
          pendingJob = void 0;
        }), children: "中断" }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: () => setStep(2), children: "返回改" })
      ] }),
      step === 4 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
        preview,
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "这一步只是预览，pus/ 下还没有任何文件。落盘后会出现在谱列表。" }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: () => setStep(2), children: "返回改" }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { disabled: busy || job?.status !== "ready", onClick: () => void run(async () => {
          await call("pu.confirm", { id: job?.id, draft, level: draft.level, confirmed: true });
          pendingJob = void 0;
          setJob(void 0);
          setStep(5);
          await reload();
        }), children: "确认落盘" })
      ] }),
      step === 5 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "已落盘：manifest.md + content.md + summary.md" }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: back, children: "回谱列表" })
      ] })
    ] }),
    job?.status === "running" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { children: [
      "审批由 DSH 决定，玄枢不自建审批。",
      typeof openSession === "function" && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: () => openSession(job.sessionId), children: "在会话里看审批" }),
      view === "detail" && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: () => void run(async () => {
        const canceled = await call("pu.cancel", { id: job.id });
        setJob(canceled);
        pendingJob = void 0;
      }), children: "中断汇总提炼（不落盘）" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: "返回「谱」可继续查看生成预览。" })
    ] })
  ] });
}
function PuIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("rect", { x: "5", y: "3.5", width: "14", height: "17", rx: "2" }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("path", { d: "M8.5 8 H15.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("path", { d: "M8.5 12 H15.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("path", { d: "M8.5 16 H13" })
  ] });
}
function installPuPanel(ctx) {
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "pus", inject: () => ({
    ctx,
    // `ctx.uiWorkspace` 会抛（未声明服务），必须软取；拿不到就不渲染那个按钮。
    openSession: (sessionId) => {
      readService(ctx, "uiWorkspace")?.openSession?.(sessionId);
    }
  }) }, PuPanel));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: "pus", order: 40, label: "谱" }, PuIcon));
  registerStyleSheet("xs-pu-style", `.xs-pu{padding:24px;overflow:auto;height:100%;color:var(--dsw-alias-text-primary);background:var(--dsw-alias-bg-canvas)}.xs-pu header,.xs-pu-toolbar,.xs-pu article{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.xs-pu article{justify-content:space-between;padding:12px;border-bottom:1px solid var(--dsw-alias-border-default)}.xs-pu label{display:block;margin:12px 0}.xs-pu input,.xs-pu select,.xs-pu textarea,.xs-pu button{color:inherit;background:var(--dsw-alias-bg-surface);border:1px solid var(--dsw-alias-border-default);border-radius:8px;padding:8px;font:inherit}.xs-pu button{cursor:pointer;margin:4px}.xs-pu button:disabled{opacity:.5;cursor:default}.xs-pu textarea{display:block;width:100%;min-height:100px;box-sizing:border-box}.xs-pu .xs-pu-body{min-height:220px;font-family:monospace}.xs-pu-detail{display:grid;grid-template-columns:1fr 1fr;gap:12px}.xs-pu section{margin:24px 0}.xs-pu [role=alert]{padding:12px;border:1px solid var(--dsw-alias-border-danger)}@media(max-width: ${BREAKPOINT_WIDE_PX}px){.xs-pu-detail{grid-template-columns:1fr}.xs-pu{padding:16px}}`);
  installXuanshuStyles();
}

// src/client/consult.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
function errorText2(error) {
  return error instanceof Error ? error.message : String(error);
}
function ConsultPanel({ api, navigate, openSession, refreshSessions, mountSlot, homePaths, preloaded }) {
  const home = useHomePaths(homePaths).home;
  const [view, setView] = (0, import_react7.useState)(preloaded?.view ?? "lobby");
  const [defaults, setDefaults] = (0, import_react7.useState)(
    preloaded?.defaults === void 0 ? { kind: "loading" } : { kind: "ready", value: preloaded.defaults }
  );
  const [items, setItems] = (0, import_react7.useState)(
    preloaded?.items === void 0 ? { kind: "loading" } : { kind: "ready", value: preloaded.items }
  );
  const [selected, setSelected] = (0, import_react7.useState)(
    preloaded?.defaults === void 0 ? [] : initialSelection(preloaded.defaults.optional)
  );
  const [question, setQuestion] = (0, import_react7.useState)("");
  const [busy, setBusy] = (0, import_react7.useState)(false);
  const [createError, setCreateError] = (0, import_react7.useState)(void 0);
  const [nudge, setNudge] = (0, import_react7.useState)(false);
  const [openError, setOpenError] = (0, import_react7.useState)(void 0);
  const [reader, setReader] = (0, import_react7.useState)({ kind: "idle" });
  const [query, setQuery] = (0, import_react7.useState)("");
  const [range, setRange] = (0, import_react7.useState)("all");
  const touched = (0, import_react7.useRef)(preloaded?.defaults !== void 0);
  const seeded = preloaded !== void 0;
  const reloadDefaults = () => {
    setDefaults({ kind: "loading" });
    void api.defaults().then((value) => {
      setDefaults({ kind: "ready", value });
      if (!touched.current) {
        setSelected(initialSelection(value.optional));
        touched.current = true;
      }
    }).catch((error) => {
      setDefaults({ kind: "error", message: errorText2(error) });
    });
  };
  const reloadItems = () => {
    setItems({ kind: "loading" });
    void api.list().then((answer) => {
      setItems({ kind: "ready", value: answer.items });
    }).catch((error) => {
      setItems({ kind: "error", message: errorText2(error) });
    });
  };
  (0, import_react7.useEffect)(() => {
    if (seeded) return;
    reloadDefaults();
    reloadItems();
  }, [seeded]);
  const mountsNow = [];
  const summary = contextSummary({ selected, mounts: mountsNow });
  const enterConversation = (sessionId) => {
    setOpenError(void 0);
    void openConsultSession({ sessionId, refresh: refreshSessions, open: openSession }).then((result) => {
      if (!result.ok) setOpenError(result.message);
    });
  };
  const start = (plain = false) => {
    const text = question.trim();
    const selectableCount = defaults.kind === "ready" ? defaults.value.optional.length : 0;
    if (!plain && nudgeNeeded({ question: text, selected, mounts: mountsNow, selectableCount })) {
      setNudge(true);
      return;
    }
    setNudge(false);
    setBusy(true);
    setCreateError(void 0);
    void (async () => {
      let session;
      try {
        const answer = await api.create(selected.length > 0 ? { pus: selected } : {});
        session = answer.session;
      } catch (error) {
        setCreateError(`开问事失败：${errorText2(error)}`);
        setBusy(false);
        return;
      }
      setItems((current) => ({
        kind: "ready",
        value: [session, ...(current.kind === "ready" ? current.value : []).filter((row) => row.sessionId !== session.sessionId)]
      }));
      if (text !== "") {
        try {
          await api.send({ sessionId: session.sessionId, text });
        } catch (error) {
          setCreateError(
            `会话已建好（${shortConsultId(session.sessionId)}），但这一问没发出去：${errorText2(error)}（可点「继续这次问事」进会话重发）`
          );
          setBusy(false);
          return;
        }
      }
      setQuestion("");
      setBusy(false);
      enterConversation(session.sessionId);
    })();
  };
  const openRow = (sessionId) => {
    const known = items.kind === "ready" ? items.value.find((row) => row.sessionId === sessionId) : void 0;
    if (known === void 0) return;
    setView("history");
    setReader({ kind: "loading" });
    void api.read({ sessionId }).then((answer) => {
      setReader({ kind: "ready", session: answer.session, messages: answer.messages, drafts: answer.drafts });
    }).catch((error) => {
      setReader({ kind: "error", session: known, message: errorText2(error) });
    });
  };
  const required = defaults.kind === "ready" ? defaults.value.required : [];
  const optional = defaults.kind === "ready" ? defaults.value.optional : [];
  const historyItems = items.kind === "ready" ? items.value : [];
  const latest = historyItems[0];
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("main", { className: "xs-consult", "data-xuanshu-panel": CONSULT_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("header", { className: "xs-consult__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h1", { children: "问事" }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        "button",
        {
          type: "button",
          "data-xuanshu-action": "toggle-history",
          onClick: () => {
            setView(view === "lobby" ? "history" : "lobby");
            setReader({ kind: "idle" });
          },
          children: view === "lobby" ? "历史回看 ▸" : "← 回到当前会话"
        }
      )
    ] }),
    openError === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "xs-consult__error", "data-xuanshu-error": "open-session", role: "alert", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: openError }) }),
    view === "lobby" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "xs-consult__block", "data-xuanshu-block": "landing", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { "data-xuanshu-note": "lobby-what", children: "一次问事 = 勾选谱 → 说事 →（可选）多 AI 合参 → 结束沉淀" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { "data-xuanshu-note": "lobby-parallel", children: "与工作区并列、不属于任何工作区；带 DSH 全套工具能力" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "lobby-f1", children: "ⓘ 本面板是「书房门厅」：进会话后切到 DSH 会话面板，工具轨迹与审批卡在那里。" })
      ] }),
      defaults.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-consult__note", "data-xuanshu-state": "pu-loading", children: "正在读谱清单…" }) : null,
      defaults.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "xs-consult__error", "data-xuanshu-error": "defaults", role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: `谱清单读不到：${defaults.message}` }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "xs-consult__actions", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", "data-xuanshu-action": "retry-defaults", onClick: reloadDefaults, children: "重试" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "goto-pu-sidebar", children: "谱清单读不到时改不了谱上的内容；要看谱库，点侧栏「谱」。" })
      ] }) : null,
      defaults.kind === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        XsConsultPicker,
        {
          required,
          optional,
          selected,
          onToggle: (slug) => {
            touched.current = true;
            setSelected((current) => toggleSelection(current, slug));
          },
          onOpenDetail: () => {
            navigate("mingpan");
          }
        }
      ) : null,
      mountSlot === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(XsConsultMountPlaceholder, { mounts: mountsNow }) : mountSlot(latest),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        XsConsultAsk,
        {
          question,
          selected,
          mounts: mountsNow,
          busy,
          nudge,
          summary,
          error: createError,
          onQuestion: setQuestion,
          onStart: () => {
            start();
          },
          onPlainAsk: () => {
            start(true);
          },
          onClearNudge: () => {
            setNudge(false);
          },
          onGotoHistory: () => {
            setView("history");
          }
        }
      ),
      latest === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        XsConsultRecentCard,
        {
          session: latest,
          onContinue: () => {
            enterConversation(latest.sessionId);
          }
        }
      )
    ] }) : null,
    view === "history" && reader.kind === "idle" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      XsConsultHistoryList,
      {
        items: historyItems,
        loading: items.kind === "loading",
        error: items.kind === "error" ? items.message : void 0,
        query,
        range,
        now: /* @__PURE__ */ new Date(),
        home,
        onQuery: setQuery,
        onRange: setRange,
        onOpen: openRow,
        onBack: () => {
          setView("lobby");
        },
        onStart: () => {
          setView("lobby");
        },
        onCreatePu: () => {
          requestPuCreateAndGo(navigate);
        },
        onRetry: reloadItems
      }
    ) : null,
    view === "history" && reader.kind !== "idle" ? reader.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      XsConsultHistoryReader,
      {
        session: historyItems[0] ?? FALLBACK_SESSION,
        messages: [],
        loading: true,
        onBack: () => {
          setReader({ kind: "idle" });
        },
        onContinue: () => {
        },
        onRetry: () => {
        }
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      XsConsultHistoryReader,
      {
        session: reader.session,
        messages: reader.kind === "ready" ? reader.messages : [],
        drafts: reader.kind === "ready" ? reader.drafts : void 0,
        error: reader.kind === "error" ? reader.message : void 0,
        onBack: () => {
          setReader({ kind: "idle" });
        },
        onContinue: () => {
          enterConversation(reader.session.sessionId);
        },
        onRetry: () => {
          openRow(reader.session.sessionId);
        }
      }
    ) : null
  ] });
}
var FALLBACK_SESSION = {
  sessionId: "session-xs-consult-",
  title: "正在读…",
  createdAt: "",
  pus: [],
  mounts: [],
  turns: 0
};
function ConsultIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("path", { d: "M4 6.5c0-1.1 1.3-2 3-2s3 .9 3 2v11c0-.9-1.3-1.6-3-1.6s-3 .7-3 1.6z" }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("path", { d: "M10 6.5c0-1.1 1.3-2 3-2s3 .9 3 2v11c0-.9-1.3-1.6-3-1.6s-3 .7-3 1.6z" }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("path", { d: "M16 7h3.5M16 11h3.5M16 15h3.5" })
  ] });
}
function installConsult(ctx, deps) {
  installConsultStyle();
  ctx.slots.inject(
    "main",
    () => ctx.slots.register(
      { name: "main", key: CONSULT_ID, inject: () => ({ ...deps }) },
      ConsultPanel
    )
  );
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      { name: "sidebar.panellist", id: CONSULT_ID, order: CONSULT_ORDER, label: CONSULT_LABEL },
      ConsultIcon
    )
  );
}
function installConsultStyle() {
  registerStyleSheet("xuanshu-consult-style", `
.xs-consult{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body);font-size:max(16px,var(--dsh-content-font-size,16px))}
/* 正文下限钉在面板根上（判据 C-001）：宿主在容器上定义了 --dsh-content-font-size（实测 14px），
   所以 var(…, 16px) 的 fallback 永远不生效，只有 max() 能压住。放根上而不是逐条写，
   是因为 summary / text / 列表正文这些「没有自己 font-size」的句子全靠继承拿字号。
   h3 / h4 是例外：它们原先写死 rem（.98rem = 15.68px、.85rem = 13.6px），绝对值不继承，
   所以各自也要钉一次；两档同为 heading（16px / 600），靠颜色与嵌套分，不靠字号。 */
.xs-consult h1,.xs-consult h3,.xs-consult h4{font-weight:600}.xs-consult h1{font-size:1.15rem}.xs-consult h3{font-size:max(16px,var(--dsh-content-font-size,16px));margin:16px 0 6px}.xs-consult h4{font-size:max(16px,var(--dsh-content-font-size,16px));margin:12px 0 4px;color:var(--xs-text-secondary)}
.xs-consult__head,.xs-consult__toolbar,.xs-consult__actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.xs-consult__head{justify-content:space-between}
.xs-consult button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-consult button:disabled{opacity:.5;cursor:not-allowed}
.xs-btn--primary{background:var(--xs-accent);border-color:var(--xs-accent);color:var(--xs-accent-fg)}
.xs-consult input,.xs-consult select,.xs-consult textarea{font:inherit;color:inherit;background:var(--xs-surface-card);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:7px;box-sizing:border-box;max-width:100%}
.xs-consult textarea{display:block;width:100%;min-height:72px}
.xs-consult__block{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad);margin:12px 0}
.xs-consult__row{display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--xs-edge-card);flex-wrap:wrap}
.xs-consult__row--locked{background:var(--xs-surface-card);border-radius:var(--xs-radius-control);padding:8px}
.xs-consult__locked-hit{display:flex;gap:8px;align-items:baseline;width:100%;text-align:left;background:transparent;border:0;padding:6px 0;cursor:pointer}
.xs-consult__lock{font-size:1rem}
.xs-consult__locked-card{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:10px;margin:6px 0 2px 24px}
.xs-consult__row-name{font-weight:600}
.xs-consult__badge{font-size:.72rem;padding:2px 8px;border:1px solid var(--xs-edge-card);border-radius:999px;color:var(--xs-text-secondary)}
.xs-consult__note{font-size:.8rem;color:var(--xs-text-secondary);line-height:1.6}
.xs-consult__field{display:block;margin:10px 0}
.xs-consult__field>span{display:block;margin-bottom:4px;font-size:max(16px,var(--dsh-content-font-size,16px))}
.xs-consult__locked{list-style:none;margin:0;padding:0}
.xs-consult__rows{list-style:none;margin:0;padding:0}
.xs-consult__row-hit{display:flex;gap:10px;align-items:baseline;width:100%;text-align:left}
.xs-consult__shortid{font-family:var(--font-mono,monospace);color:var(--xs-text-code);font-size:.85rem}
.xs-consult__summary{line-height:1.7;font-size:max(16px,var(--dsh-content-font-size,16px))}
.xs-consult__nudge,.xs-consult__error{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:12px;margin:10px 0}
.xs-consult__nudge-title{font-weight:600;margin:0 0 6px}
.xs-consult__paths{margin:0 0 8px;padding-left:20px;line-height:1.7}
.xs-consult__empty{text-align:left;padding:16px 0}
.xs-consult__empty-why{font-weight:600;margin:0 0 6px}
.xs-consult__messages{margin-top:12px}
.xs-consult__round{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:8px 10px;margin:12px 0}
.xs-consult__round-head{font-size:max(16px,var(--dsh-content-font-size,16px));margin:0 0 4px;color:var(--xs-text-secondary)}
.xs-consult__message{display:grid;grid-template-columns:44px minmax(0,1fr);gap:8px;padding:10px 0;border-bottom:1px solid var(--xs-edge-card)}
/* 角色占第一列；徽标 / 来源 / 正文一律第二列（否则混合行会把正文挤进 44px 那一列）。 */
.xs-consult__message>.xs-consult__badge,.xs-consult__message>.xs-consult__note,.xs-consult__message>.xs-consult__text{grid-column:2}
.xs-consult__role{color:var(--xs-text-secondary);font-size:.85rem}
.xs-consult__text{margin:0;line-height:1.7;white-space:pre-wrap}
@media(max-width: ${BREAKPOINT_WIDE_PX}px){.xs-consult{padding:16px}.xs-consult__row-hit{flex-direction:column;gap:2px}}
`);
  installXuanshuStyles();
}

// src/client/data-api.ts
var DATA_ENDPOINTS = {
  overview: "data.overview",
  backup: "data.backup",
  pickDirectory: "cang.pickDirectory"
};
function createDataApi(ctx) {
  return {
    overview: (signal) => rpcCall(ctx, DATA_ENDPOINTS.overview, {}, signal),
    backup: (input) => rpcCall(ctx, DATA_ENDPOINTS.backup, input),
    pickDirectory: () => rpcCall(ctx, DATA_ENDPOINTS.pickDirectory)
  };
}

// src/client/data.tsx
var import_react8 = require("react");

// src/client/data-style.ts
function installDataStyle() {
  registerStyleSheet("xuanshu-data-style", `
.xs-data{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;box-sizing:border-box;color:var(--xs-text-body)}
.xs-data h2{margin:0 0 8px;font-size:1.15rem;font-weight:600}.xs-data h3{margin:0 0 8px;font-size:1rem;font-weight:600}
.xs-data p,.xs-data li{line-height:1.6}.xs-data code{overflow-wrap:anywhere;font-family:var(--font-mono,monospace);color:var(--xs-text-code)}
.xs-data__lead,.xs-data__note{color:var(--xs-text-secondary);font-size:.9rem}
.xs-data__block{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad);margin:16px 0;background:var(--xs-surface-card)}
.xs-data__groups{width:100%;border-collapse:collapse;font-size:.9rem}.xs-data__groups th,.xs-data__groups td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--xs-edge-card);vertical-align:top}
/* 2026-11-02：体积与文件数是短数字，不该被挤成两行（截图里看到「6 个」/「文件」上下断开）。路径列本来就该换行，单独放行。 */
.xs-data__groups td{white-space:nowrap}.xs-data__groups td:has(code){white-space:normal}
.xs-data__groups thead th{color:var(--xs-text-secondary);font-weight:500}.xs-data__groups tbody th{font-weight:600;white-space:nowrap}
.xs-data__total{margin:12px 0 0;font-weight:600}
.xs-data button{font:inherit;padding:7px 14px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-data button:disabled{opacity:.5;cursor:not-allowed}
.xs-data__error{color:var(--xs-text-error,inherit);border-left:3px solid var(--xs-edge-card);padding-left:10px}
.xs-data__result{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-nested);padding:12px;margin-top:12px}
.xs-data__block ul,.xs-data__block ol{margin:8px 0;padding-left:20px}.xs-data__block li{margin:4px 0}
@media(max-width: ${BREAKPOINT_NARROW_PX}px){.xs-data{padding:14px}.xs-data__groups{display:block;overflow-x:auto}}`);
  installXuanshuStyles();
}

// src/client/data.tsx
var import_jsx_runtime9 = require("react/jsx-runtime");
var DATA_SECTION_ID = "xuanshu.data";
var DATA_SECTION_LABEL = "我的数据";
var DATA_SECTION_ORDER = 25;
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value.toFixed(1)} ${units[unit]}`;
}
function GroupTable({ overview }) {
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("table", { className: "xs-data__groups", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("tr", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("th", { scope: "col", children: "分类" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("th", { scope: "col", children: "位置" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("th", { scope: "col", children: "体积" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("th", { scope: "col", children: "文件" })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("tbody", { children: overview.groups.map((group2) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("tr", { "data-xuanshu-data-group": group2.id, children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("th", { scope: "row", children: group2.label }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("td", { children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("code", { children: group2.path }) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("td", { children: formatBytes(group2.bytes) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("td", { children: [
          group2.files,
          " 个文件"
        ] })
      ] }, group2.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { className: "xs-data__total", "data-xuanshu-data-total": true, children: [
      "总计：",
      formatBytes(overview.total.bytes),
      " · ",
      overview.total.files,
      " 个文件"
    ] })
  ] });
}
function ExcludedList({ overview }) {
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "xs-data__block", "data-xuanshu-data-excluded": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: "不备份 / 不计体积" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("ul", { children: overview.excluded.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("li", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("code", { children: entry.path }),
      "：",
      entry.reason
    ] }, entry.path)) })
  ] });
}
function XsDataSection({ state, actions }) {
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "xs-data", "data-xuanshu-section": "data", children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h2", { children: "我的数据" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "xs-data__lead", children: "玄枢的数据都在本机。这里按分类列出体积，并可一键备份到你选的目录。" }),
    state.overview === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "xs-data__note", "data-xs-state": "loading", children: "正在统计各分类体积…" }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "xs-data__block", "data-xuanshu-data-paths": true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: "位置" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { "data-xuanshu-data-path": "home", children: [
          "home：",
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("code", { children: state.overview.home })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { "data-xuanshu-data-path": "data", children: [
          "数据目录：",
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("code", { children: state.overview.dataDir })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "xs-data__block", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: "分类体积" }),
        state.overview.groups.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "xs-data__note xs-data__empty", role: "note", "data-xs-state": "empty", children: "还没有可统计的数据：这一次连一个分类都没读到（数据目录可能还没建）。先去用一次——写一条谱、藏或事记——再回到本页，这里就会按分类列出体积与文件数。" }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(GroupTable, { overview: state.overview }),
        state.overview.notes.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("ul", { className: "xs-data__note", "data-xuanshu-data-notes": true, children: state.overview.notes.map((note) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("li", { children: note }, note)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(ExcludedList, { overview: state.overview })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "xs-data__block xs-data__backup", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: "一键备份" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: "备份会包含谱 / 藏 / 底稿 / 事记 / 会话记录 / 存储 / skills / 其它；写到一个你选的目录。" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", "data-xuanshu-action": "backup", disabled: state.busy, onClick: actions.onBackup, children: state.busy ? "正在备份…" : "一键备份" }),
      state.busy && state.stage !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "xs-data__note", "data-xuanshu-data-stage": true, children: state.stage }) : null,
      state.error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "xs-data__error", role: "alert", "data-xuanshu-data-error": true, children: state.error }),
      state.result === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "xs-data__result", "data-xuanshu-data-result": true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { children: [
          "备份完成：",
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("code", { children: state.result.backupDir })
        ] }),
        state.result.manifestPath === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { children: [
          "清单：",
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("code", { children: state.result.manifestPath })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: "清单里每个文件都有 sha256 与大小，可逐项对账（manifest.json）。" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "xs-data__block", "data-xuanshu-data-boundary": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: "备份里有什么、没有什么" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("ul", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("li", { children: "备份包含：谱 / 藏 / 底稿 / 事记 / 会话记录 / 存储 / skills / 其它。" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("li", { children: "备份不包含：.credentials.yaml 与任何密钥引用。" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("li", { children: "为什么：密钥不该离开本机凭据库；玄枢不另建密钥库。" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("li", { children: "怎么迁：换机器后在玄枢自己的「设置 → 模型」里重新填 API key。" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "xs-data__block", "data-xuanshu-data-restore": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: "恢复（不提供自动恢复）" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("ol", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("li", { children: "先关掉玄枢，确认没有实例还在运行，再动文件。" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("li", { children: "把备份目录里的 xuanshu/、sessions/、storages/、skills/ 分别放回 home 的对应位置；同名文件覆盖前先自己留一份。" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("li", { children: "密钥不在备份里：在「设置 → 模型」重新填一次 API key。" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("li", { children: "回到本页看一次体积，确认分类都回来了。" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: "不提供自动恢复：玄枢不会自己覆盖现有数据，放回哪一份由你决定。" })
    ] })
  ] });
}
function DataSectionHost({ api }) {
  const [overview, setOverview] = (0, import_react8.useState)(void 0);
  const [busy, setBusy] = (0, import_react8.useState)(false);
  const [stage, setStage] = (0, import_react8.useState)(void 0);
  const [result, setResult] = (0, import_react8.useState)(void 0);
  const [error, setError] = (0, import_react8.useState)(void 0);
  (0, import_react8.useEffect)(() => {
    let alive = true;
    void api.overview().then((value) => {
      if (alive) setOverview(value);
    }).catch((reason) => {
      if (alive) setError(`读不到数据分类：${reason instanceof Error ? reason.message : String(reason)}`);
    });
    return () => {
      alive = false;
    };
  }, [api]);
  const onBackup = () => {
    if (busy) return;
    setError(void 0);
    setResult(void 0);
    setBusy(true);
    setStage("正在打开目录选择器…");
    void (async () => {
      try {
        const picked = await Promise.race([
          api.pickDirectory(),
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error("picker-timeout"));
            }, 12e3);
          })
        ]);
        if (typeof picked?.path !== "string" || picked.path === "") {
          setStage(void 0);
          setError("没有选择备份目录（已取消）。");
          return;
        }
        setStage(`正在备份到 ${picked.path} …（复制并逐个校验 sha256，文件多时会久一点）`);
        const answer = await api.backup({ targetDir: picked.path, confirmed: true });
        if (answer.ok !== true) {
          setError(`备份没有完成：${answer.error?.message ?? "未知原因"}`);
          return;
        }
        setResult(answer);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(
          message === "picker-timeout" ? "目录选择器 12 秒没有回应 —— 这个环境大概打不开系统「选文件夹」的窗口。换一个能弹窗的桌面环境再试；也可以先手动把数据目录整个复制走（位置在本页上方列着）。" : `备份没有完成：${message}`
        );
      } finally {
        setBusy(false);
        setStage(void 0);
      }
    })();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(XsDataSection, { state: { overview, busy, stage, result, error }, actions: { onBackup } });
}
function installDataSettings(ctx, deps) {
  installDataStyle();
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: DATA_SECTION_ID,
        order: DATA_SECTION_ORDER,
        label: DATA_SECTION_LABEL,
        inject: () => ({ api: deps.api })
      },
      DataSectionHost
    )
  );
}

// src/client/digao-api.ts
var DIGAO_ENDPOINTS = {
  status: "digao.status",
  read: "digao.read",
  refresh: "digao.refresh"
};
function createDigaoApi(ctx) {
  return {
    status: (signal) => rpcCall(ctx, DIGAO_ENDPOINTS.status, {}, signal),
    read: (signal) => rpcCall(ctx, DIGAO_ENDPOINTS.read, {}, signal),
    refresh: (signal) => rpcCall(ctx, DIGAO_ENDPOINTS.refresh, {}, signal)
  };
}

// src/client/digao-controller.ts
function errorText3(error) {
  return error instanceof Error ? error.message : String(error);
}
function createDigaoUiController(api) {
  let revision = 0;
  let outcome;
  let running;
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    getRevision: () => revision,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getOutcome: () => outcome,
    clearOutcome() {
      outcome = void 0;
      revision += 1;
      notify();
    },
    refresh() {
      if (running !== void 0) return running;
      running = api.refresh().then(() => {
        outcome = { ok: true };
        return outcome;
      }).catch((error) => {
        outcome = { ok: false, reason: `刷新失败：${errorText3(error)}` };
        return outcome;
      }).then((answer) => {
        running = void 0;
        revision += 1;
        notify();
        return answer;
      });
      return running;
    }
  };
}

// src/client/digao.tsx
var import_react12 = require("react");

// src/client/ai-views.tsx
var import_react9 = require("react");
var import_jsx_runtime10 = require("react/jsx-runtime");
var EMPTY_SNAPSHOT2 = { checking: false };
var getEmptySnapshot = () => EMPTY_SNAPSHOT2;
var NOOP_SUBSCRIBE = () => () => {
};
function useAiReadiness(controller) {
  const snapshot = (0, import_react9.useSyncExternalStore)(
    controller?.subscribe ?? NOOP_SUBSCRIBE,
    controller?.snapshot ?? getEmptySnapshot,
    controller?.snapshot ?? getEmptySnapshot
  );
  (0, import_react9.useEffect)(() => {
    if (controller === void 0) return () => {
    };
    const release = controller.start();
    void controller.refresh();
    return release;
  }, [controller]);
  return controller === void 0 ? void 0 : snapshot;
}
function viewStateOf(readiness, checking) {
  if (readiness === void 0) return checking ? "checking" : "unknown";
  if (readiness.configured === true) return "configured";
  if (readiness.configured === "unknown") return "unknown";
  return "missing";
}
function keyLabel(value) {
  if (value === true) return "已配置";
  if (value === false) return "未配置";
  return "未知";
}
var STATE_TITLE = {
  /**
   * 2026-11-02 改：原来是「已接上 AI」。
   * 这条判定只看路由清单（provider 有没有注册、密钥状态、默认模型指向哪），**从不真发一次请求**。
   * 实测撞过一次：界面说「已接上」，真去提炼时 AI 一句话都没回 ——
   * 用户照着「已接上」以为万事俱备，其实谁都没试过能不能调通。
   * 改成说事实：配置齐了。
   */
  configured: "AI 配置齐了",
  missing: "未接上 AI",
  unknown: "AI 状态未知",
  checking: "正在检测 AI …"
};
function AiSettingsAction({
  onOpenSettings,
  showFallback = true
}) {
  if (onOpenSettings === void 0) {
    if (!showFallback) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai__path", "data-xuanshu-ai-path": AI_SETTINGS_PATH, children: `请打开 DSH「${AI_SETTINGS_PATH}」配置 provider 与默认模型。` });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-btn", "data-xuanshu-action": "open-ai-settings", onClick: onOpenSettings, children: `去「${AI_SETTINGS_PATH}」` });
}
function XsAiReadiness({
  readiness,
  checking = false,
  onRetry,
  onOpenSettings,
  onFinish,
  onSkip,
  onProbe
}) {
  const state = viewStateOf(readiness, checking);
  const title = STATE_TITLE[state];
  const [probing, setProbing] = (0, import_react9.useState)(false);
  const [probe, setProbe] = (0, import_react9.useState)(void 0);
  const runProbe = async () => {
    if (onProbe === void 0 || probing) return;
    setProbing(true);
    setProbe(void 0);
    try {
      setProbe(await onProbe());
    } catch (error) {
      setProbe({ ok: false, ms: 0, reason: error instanceof Error ? error.message : String(error) });
    } finally {
      setProbing(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "xs-ai", "data-xuanshu-ai": "readiness", "data-xs-state": state, children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai__status", "data-xuanshu-ai-status": state, children: title }),
    state === "checking" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai__note", children: "正在读路由清单（只读检测，不写任何配置）。" }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai__reason", "data-xuanshu-ai-reason": readiness?.reason.code, children: readiness?.reason.text }),
      readiness?.reason.next === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai__next", children: readiness.reason.next }),
      state === "unknown" && readiness?.detail !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai__detail", "data-xuanshu-ai-detail": "unavailable", children: readiness.detail }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai__default", "data-xuanshu-ai-default": readiness?.defaultModel === null || readiness?.defaultModel === void 0 ? "none" : "set", children: readiness?.defaultModel === null || readiness?.defaultModel === void 0 ? "默认模型：未定" : `默认模型：${readiness.defaultModel.provider} · ${readiness.defaultModel.model}` }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("ul", { className: "xs-ai__providers", "data-xuanshu-ai-providers": String(readiness?.providers.length ?? 0), children: (readiness?.providers ?? []).map((provider) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
        "li",
        {
          className: "xs-ai__provider",
          "data-xuanshu-ai-provider": provider.id,
          "data-xs-key": String(provider.keyConfigured),
          "data-xs-usable": provider.usable ? "true" : void 0,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "xs-ai__provider-name", children: provider.name ?? provider.id }),
            provider.name === null ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("small", { className: "xs-ai__provider-id", children: provider.id }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "xs-ai__provider-key", "data-xs-key-label": String(provider.keyConfigured), children: `密钥：${keyLabel(provider.keyConfigured)}` }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "xs-ai__provider-models", children: provider.modelsKnown ? `${String(provider.modelCount)} 个模型` : "模型清单读不到" }),
            provider.isDefaultProvider ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "xs-ai__badge", children: "默认" }) : null
          ]
        },
        provider.id
      )) }),
      (readiness?.providers.length ?? 0) === 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai__note", "data-xuanshu-ai-providers-empty": "true", children: "一家 provider 都还没有。" }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "xs-ai__actions", children: [
      onRetry === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-btn", "data-xuanshu-action": "retry-ai", onClick: onRetry, children: "重试" }),
      onProbe === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
        "button",
        {
          type: "button",
          className: "xs-btn",
          "data-xuanshu-action": "probe-ai",
          disabled: probing,
          onClick: () => {
            void runProbe();
          },
          children: probing ? "正在试…" : "试一下能不能用"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
        AiSettingsAction,
        {
          ...onOpenSettings === void 0 ? {} : { onOpenSettings },
          showFallback: state !== "configured"
        }
      ),
      onFinish === void 0 || state !== "configured" ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-btn xs-btn--primary", "data-xuanshu-action": "finish-ai", onClick: onFinish, children: "完成，回总览 ->" }),
      onSkip === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-btn", "data-xuanshu-action": "skip-ai", onClick: onSkip, children: "跳过" })
    ] }),
    probe === void 0 ? null : probe.ok ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai__note", role: "status", "data-xuanshu-ai-probe": "ok", children: `通了：${probe.route === void 0 ? "（路由未报）" : `${probe.route.provider} · ${probe.route.model}`}，耗时 ${(probe.ms / 1e3).toFixed(1)} 秒，回的是「${probe.reply === void 0 || probe.reply === "" ? "（空）" : probe.reply}」。` }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai__error", role: "alert", "data-xuanshu-ai-probe": "failed", children: `没通：${probe.reason ?? "没有给出原因"}` }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai__note", "data-xuanshu-ai-note": "readonly", children: onProbe === void 0 ? "检测只读：玄枢只读路由清单，不写 provider 配置与密钥。" : "检测只读：玄枢只读路由清单，不写 provider 配置与密钥。（「试一下能不能用」会真发一句最短的话，除此之外不做任何事。）" })
  ] });
}
function XsAiGate({ readiness, checking = false, onRetry, onOpenSettings }) {
  const state = viewStateOf(readiness, checking);
  if (state === "configured") return null;
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "xs-ai-gate", "data-xuanshu-ai-gate": state, "data-xuanshu-ai-reason": readiness?.reason.code, children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai-gate__reason", children: state === "checking" ? "正在检测 AI 状态…" : `${state === "unknown" ? "AI 状态未知：" : "问事还开不了："}${readiness?.reason.text ?? ""}` }),
    state === "checking" ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-ai-gate__next", children: readiness?.reason.next }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "xs-ai-gate__actions", children: [
      onRetry === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-btn", "data-xuanshu-action": "retry-ai", onClick: onRetry, children: "重试" }),
      state === "checking" ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
        AiSettingsAction,
        {
          ...onOpenSettings === void 0 ? {} : { onOpenSettings },
          showFallback: (readiness?.reason.next ?? "") === ""
        }
      )
    ] })
  ] });
}

// src/client/notify.tsx
var import_react10 = require("react");

// src/client/notify-api.ts
var NOTIFY_ENDPOINTS = {
  trafficStatus: "traffic.status",
  markRead: "traffic.markRead",
  settingsGet: "traffic.settings.get",
  settingsSet: "traffic.settings.set"
};
var SHELL_SETTINGS_ENDPOINTS = {
  get: "shell.settings.get",
  set: "shell.settings.set"
};
function createNotifyApi(ctx) {
  return {
    status: (payload, signal) => rpcCall(ctx, NOTIFY_ENDPOINTS.trafficStatus, payload ?? {}, signal),
    markRead: (payload, signal) => rpcCall(ctx, NOTIFY_ENDPOINTS.markRead, payload, signal),
    async markDeliveredRead(options, signal) {
      const kind = typeof options?.kind === "string" && options.kind !== "" ? options.kind : void 0;
      const ledger = await rpcCall(ctx, NOTIFY_ENDPOINTS.trafficStatus, {}, signal);
      const ids = (Array.isArray(ledger?.entries) ? ledger.entries : []).filter((entry) => (kind === void 0 || entry?.kind === kind) && entry?.notify?.status === "delivered" && entry.read !== true).map((entry) => entry.id);
      if (ids.length === 0) return { ok: true, updated: 0 };
      return rpcCall(ctx, NOTIFY_ENDPOINTS.markRead, { ids }, signal);
    },
    getSettings: (signal) => rpcCall(ctx, NOTIFY_ENDPOINTS.settingsGet, {}, signal),
    setSettings: (payload, signal) => rpcCall(ctx, NOTIFY_ENDPOINTS.settingsSet, payload, signal),
    getShellSettings: (signal) => rpcCall(ctx, SHELL_SETTINGS_ENDPOINTS.get, {}, signal),
    setShellSettings: (payload, signal) => rpcCall(ctx, SHELL_SETTINGS_ENDPOINTS.set, payload, signal)
  };
}

// src/client/notify.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
var TOUCH_SETTINGS_ID = "xuanshu.touch";
var AUTOSTART_METHOD_TEXT = {
  "login-item": "登录项",
  shortcut: "启动文件夹快捷方式",
  unsupported: "不支持（本平台无法注册）"
};
function autostartMethodText(method) {
  if (method === void 0) return "未知（玄枢的桌面应用没在运行）";
  return AUTOSTART_METHOD_TEXT[method] ?? "未知（玄枢的桌面应用没在运行）";
}
var TRAFFIC_STATUS_TEXT = {
  delivered: "成功",
  failed: "失败",
  skipped: "跳过"
};
var NOTIFY_FAILURE_TEXT = {
  "permission-denied": "权限缺失：系统通知权限被关。请到「系统设置 → 通知 → 玄枢」里打开通知权限，然后再生成一次。",
  unsupported: "系统通知不可用：这台系统 / 环境不支持系统通知。",
  failed: "桌面应用没弹出通知（它没给原因）。"
};
var NOTIFY_FAILURE_TOKEN = /(permission-denied|unsupported|failed)\s*$/u;
function notifyReasonCode(notify) {
  const explicit = typeof notify?.reasonCode === "string" && notify.reasonCode !== "" ? notify.reasonCode : void 0;
  if (explicit !== void 0) return explicit;
  const reason = typeof notify?.reason === "string" ? notify.reason : "";
  const match = NOTIFY_FAILURE_TOKEN.exec(reason);
  return match === null ? void 0 : match[1];
}
function notifyFailureText(notify) {
  const code = notifyReasonCode(notify);
  if (code !== void 0 && NOTIFY_FAILURE_TEXT[code] !== void 0) return NOTIFY_FAILURE_TEXT[code];
  const reason = typeof notify?.reason === "string" && notify.reason !== "" ? notify.reason : "";
  return reason === "" ? "（没有给理由）" : reason;
}
function XsDeliveryHistory({ status }) {
  const entries = Array.isArray(status.entries) ? status.entries : [];
  const unread = typeof status.unread === "number" ? status.unread : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("section", { className: "xs-touch__history", "data-xuanshu-history": "traffic", children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("h2", { className: "xs-touch__history-title", children: "投递历史" }),
    unread === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", role: "note", "data-xuanshu-note": "unread-unknown", children: "未读数未知（触达账存在但读不出来，不按 0 算）" }) : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", "data-xuanshu-note": "unread", children: `未读 ${unread} 条` }),
    status.lastFailure === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
      "p",
      {
        className: "xs-touch__note",
        role: "alert",
        "data-xuanshu-history-error": "last-failure",
        "data-xuanshu-reason-code": notifyReasonCode(status.lastFailure),
        children: `最近一次失败：${status.lastFailure.kind === "wansheng" ? "晚省" : "日课"} · ${notifyFailureText(status.lastFailure)}`
      }
    ),
    entries.length === 0 ? unread === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", "data-xuanshu-history-empty": "unknown", children: "投递历史也读不出来（不是「没有记录」）。" }) : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", "data-xuanshu-history-empty": "true", children: "还没有投递记录。" }) : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("ul", { className: "xs-touch__history-list", children: entries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
      "li",
      {
        className: "xs-touch__history-row",
        "data-xuanshu-history-row": entry.notify.status,
        "data-xuanshu-history-kind": entry.kind ?? "",
        "data-xuanshu-history-missed": entry.missed === true ? "true" : void 0,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "xs-touch__history-when", children: entry.at === void 0 ? entry.date ?? "时间读不到" : momentOf(entry.at) }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "xs-touch__history-kind", children: entry.kind === "wansheng" ? "晚省" : entry.kind === "rikke" ? "日课" : entry.kind ?? "未知" }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "xs-touch__history-status", children: TRAFFIC_STATUS_TEXT[entry.notify.status] ?? entry.notify.status }),
          entry.missed === true ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "xs-touch__history-missed", "data-xuanshu-badge": "missed", children: "补" }) : null,
          entry.notify.reason === void 0 || entry.notify.reason === null ? null : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
            "span",
            {
              className: "xs-touch__history-reason",
              "data-xuanshu-reason-code": notifyReasonCode(entry.notify),
              children: notifyFailureText(entry.notify)
            }
          )
        ]
      },
      entry.id
    )) })
  ] });
}
function DeliveryHistoryHost({ notify, preloaded }) {
  const [status, setStatus] = (0, import_react10.useState)(preloaded);
  const [error, setError] = (0, import_react10.useState)(void 0);
  (0, import_react10.useEffect)(() => {
    if (preloaded !== void 0 || notify === void 0) return;
    let alive = true;
    void notify.status({ limit: 50 }).then((answer) => {
      if (alive) setStatus(answer);
    }).catch((reason) => {
      if (alive) setError(`读不到投递历史：${reason instanceof Error ? reason.message : String(reason)}`);
    });
    return () => {
      alive = false;
    };
  }, [notify, preloaded]);
  if (error !== void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", role: "alert", "data-xuanshu-history-error": "read", children: error });
  }
  if (status === void 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(XsDeliveryHistory, { status });
}
function createShellSettingsWriter({
  api,
  onChanged,
  onError
}) {
  return async (patch) => {
    try {
      const answer = await api.setShellSettings(patch);
      onChanged?.(answer);
      return answer;
    } catch (reason) {
      onError?.(`设置没写成：${reason instanceof Error ? reason.message : String(reason)}`);
      return void 0;
    }
  };
}
function XsTouchSettingsRow({ state, actions }) {
  const shell = state.shell;
  const shellKnown = shell !== void 0;
  const effective = shell?.effective;
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "xs-touch__settings", "data-xs-touch": "settings", children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "xs-touch__row", "data-xuanshu-setting": "ai", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("strong", { children: "AI 建议段" }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", children: "日课由「黄历三键（永远有）」+「一段 AI 写的今天注意什么」两段组成。关掉后只留前一段（黄历三键）， 不再调用 AI（失败也只是没有那一段，不影响日课本身）。" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
          "input",
          {
            type: "checkbox",
            checked: state.aiEnabled,
            onChange: (event) => actions.onToggleAi(event.target.checked)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "xs-touch__note", children: state.aiEnabled ? "开" : "关" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "xs-touch__row", "data-xuanshu-setting": "notify-summary", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("strong", { children: "通知摘要" }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", children: "默认系统通知只说「今日日课已生成」，不在锁屏上露内容。打开后带一句泛化短句 （仍不含宜忌 / 流日 / AI 建议的具体内容）。" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
          "input",
          {
            type: "checkbox",
            checked: state.notifySummary,
            onChange: (event) => actions.onToggleSummary(event.target.checked)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "xs-touch__note", children: state.notifySummary ? "开" : "关" })
      ] })
    ] }),
    state.shellError === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", role: "alert", "data-xuanshu-setting-error": "shell", children: state.shellError }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "xs-touch__row", "data-xuanshu-setting": "close-behavior", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("strong", { children: "关窗口行为" }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", children: "勾上 = 点 × 直接退出；不勾 = 收进托盘继续跑，日课与晚省仍会到点。 改完下次启动生效。" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
          "input",
          {
            type: "checkbox",
            checked: shellKnown && shell.closeBehavior === "quit",
            disabled: !shellKnown,
            onChange: (event) => actions.onToggleCloseBehavior(event.target.checked)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "xs-touch__note", children: shellKnown ? shell.closeBehavior === "quit" ? "关窗即退出" : "收进托盘" : "未知" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "xs-touch__row", "data-xuanshu-setting": "autostart", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("strong", { children: "开机自启" }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", children: "登录项优先，其次启动文件夹快捷方式；两条路都不可用时如实显示「不支持」。 下面那行显示的是这台机器上实际生效的方式，不是这里勾的值。" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
          "input",
          {
            type: "checkbox",
            checked: shellKnown && shell.autostart === true,
            disabled: !shellKnown,
            onChange: (event) => actions.onToggleAutostart(event.target.checked)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "xs-touch__note", children: shellKnown ? shell.autostart ? "开" : "关" : "未知" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
      "p",
      {
        className: "xs-touch__note",
        "data-xuanshu-effective": "autostart",
        "data-xuanshu-effective-known": effective === void 0 ? "false" : "true",
        children: effective === void 0 ? "实际生效方式：未知（桌面应用没在运行）—— 这里的开关会存下来，下次桌面应用启动时才生效。" : `实际生效：${autostartMethodText(effective.autostart.method)}（${effective.autostart.enabled ? "已开" : "已关"}） · 关窗：${effective.closeBehavior === "quit" ? "退出" : "收进托盘"}${effective.autostart.enabled === shell?.autostart ? "" : "（注意：设置里的开关与实际生效不一致，可能是系统启动项被拦下了）"}`
      }
    )
  ] });
}
function TouchSettingsHost({ rikke, notify }) {
  const [state, setState] = (0, import_react10.useState)(void 0);
  const [error, setError] = (0, import_react10.useState)(void 0);
  (0, import_react10.useEffect)(() => {
    let alive = true;
    void Promise.all([rikke.getSettings(), notify.getSettings()]).then(([rikkeSettings, notifySettings]) => {
      if (!alive) return;
      setState({ aiEnabled: rikkeSettings.aiEnabled, notifySummary: notifySettings.notifySummary });
      void notify.getShellSettings().then((answer) => {
        if (!alive) return;
        setState((previous) => previous === void 0 ? previous : {
          ...previous,
          shell: {
            closeBehavior: answer.settings.closeBehavior,
            autostart: answer.settings.autostart === true,
            ...answer.effective === void 0 ? {} : { effective: answer.effective }
          }
        });
      }).catch((reason) => {
        if (!alive) return;
        setState((previous) => previous === void 0 ? previous : { ...previous, shellError: `读不到壳设置：${reason instanceof Error ? reason.message : String(reason)}` });
      });
    }).catch((reason) => {
      if (!alive) return;
      setError(`读不到设置：${reason instanceof Error ? reason.message : String(reason)}`);
    });
    return () => {
      alive = false;
    };
  }, [rikke, notify]);
  if (state === void 0) {
    return error === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", "data-xs-state": "loading", children: "正在读触达开关…" }) : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", role: "alert", "data-xuanshu-setting-error": "read", children: error });
  }
  const writeShell = (patch) => {
    const before = state.shell;
    const optimistic = before === void 0 ? before : {
      ...before,
      ...patch.closeBehavior === void 0 ? {} : { closeBehavior: patch.closeBehavior },
      ...patch.autostart === void 0 ? {} : { autostart: patch.autostart }
    };
    setState({ ...state, shell: optimistic, shellError: void 0 });
    setError(void 0);
    void createShellSettingsWriter({
      api: notify,
      onChanged: (answer) => {
        setState((previous) => previous === void 0 ? previous : {
          ...previous,
          shellError: void 0,
          shell: {
            closeBehavior: answer.settings.closeBehavior,
            autostart: answer.settings.autostart === true,
            ...answer.effective === void 0 ? {} : { effective: answer.effective }
          }
        });
      },
      onError: (message) => {
        setState({ ...state, shell: before, shellError: void 0 });
        setError(message);
      }
    })(patch);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(import_jsx_runtime11.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
      XsTouchSettingsRow,
      {
        state,
        actions: {
          onToggleAi: (enabled) => {
            setState({ ...state, aiEnabled: enabled });
            setError(void 0);
            void rikke.setSettings({ aiEnabled: enabled }).catch((reason) => {
              setState({ ...state, aiEnabled: !enabled });
              setError(`AI 段开关没写成：${reason instanceof Error ? reason.message : String(reason)}`);
            });
          },
          onToggleSummary: (enabled) => {
            setState({ ...state, notifySummary: enabled });
            setError(void 0);
            void notify.setSettings({ notifySummary: enabled }).catch((reason) => {
              setState({ ...state, notifySummary: !enabled });
              setError(`通知摘要开关没写成：${reason instanceof Error ? reason.message : String(reason)}`);
            });
          },
          onToggleCloseBehavior: (quit) => {
            writeShell({ closeBehavior: quit ? "quit" : "hide" });
          },
          onToggleAutostart: (enabled) => {
            writeShell({ autostart: enabled });
          }
        }
      }
    ),
    error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "xs-touch__note", role: "alert", "data-xuanshu-setting-error": "write", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(DeliveryHistoryHost, { notify })
  ] });
}
function installTouchSettings(ctx, deps) {
  ctx.slots.inject(
    "settings.general.item",
    () => ctx.slots.register(
      { name: "settings.general.item", id: TOUCH_SETTINGS_ID, order: 70, inject: () => deps },
      TouchSettingsHost
    )
  );
}

// src/client/glyphs.tsx
var import_jsx_runtime12 = require("react/jsx-runtime");
function GlyphOverview({ className = "xs-glyph", size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "svg",
    {
      className,
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      role: "img",
      "aria-hidden": "true",
      focusable: "false",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M4 10.5 L12 4.5 L20 10.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M6 9 V19.5 H18 V9" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M10 19.5 V14 H14 V19.5" })
      ]
    }
  );
}
function GlyphCardMingpan({ className = "xs-glyph", size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "svg",
    {
      className,
      width: size,
      height: size,
      viewBox: "0 0 20 20",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("circle", { cx: "10", cy: "10", r: "6.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M10 3.5 V16.5 M3.5 10 H16.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("circle", { cx: "10", cy: "10", r: "0.6", fill: "currentColor", stroke: "none" })
      ]
    }
  );
}
function GlyphCardRike({ className = "xs-glyph", size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "svg",
    {
      className,
      width: size,
      height: size,
      viewBox: "0 0 20 20",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("circle", { cx: "10", cy: "10", r: "6.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M10 6.5 V10 L13 12.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M3.5 13.5 H16.5" })
      ]
    }
  );
}
function GlyphCardDigao({ className = "xs-glyph", size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "svg",
    {
      className,
      width: size,
      height: size,
      viewBox: "0 0 20 20",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("rect", { x: "4.5", y: "3.5", width: "11", height: "13", rx: "1.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M8 3.5 V2 H12 A1.5 1.5 0 0 1 13.5 3.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M7.5 8 H12.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M7.5 11 H12.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M7.5 14 H10.5" })
      ]
    }
  );
}
function GlyphQuickConsult({ className = "xs-glyph", size = 24 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "svg",
    {
      className,
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M4.5 6 H19.5 V15 H12 L8.5 18.5 V15 H4.5 Z" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M12 9.3 c0 .2 0 .3-.06.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M9.8 9.2 A2.2 2.2 0 1 1 13 11.3 c-.6.5-.8.9-.8 1.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M12 14.3 v.01" })
      ]
    }
  );
}
function GlyphQuickWorkspace({ className = "xs-glyph", size = 24 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
    "svg",
    {
      className,
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
      children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M4 7.5 A1.5 1.5 0 0 1 5.5 6 H10 L12 8 H18.5 A1.5 1.5 0 0 1 20 9.5 V16.5 A1.5 1.5 0 0 1 18.5 18 H5.5 A1.5 1.5 0 0 1 4 16.5 Z" })
    }
  );
}
function GlyphQuickWorkflow({ className = "xs-glyph", size = 24 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "svg",
    {
      className,
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("circle", { cx: "5", cy: "8", r: "1.8" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("circle", { cx: "19", cy: "8", r: "1.8" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("circle", { cx: "12", cy: "17", r: "1.8" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M6.7 9 L10.6 15.6 M15.4 15.6 L17.3 9" })
      ]
    }
  );
}
function IllusMingpanEmpty({ className = "xs-empty__illus" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("svg", { className, viewBox: "0 0 120 80", fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("circle", { cx: "60", cy: "29", r: "21", stroke: "currentColor", strokeWidth: 1.5 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("circle", { cx: "60", cy: "29", r: "12", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M60 17v24M48 29h24", stroke: "currentColor", strokeWidth: 1, opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M60 50v15", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M60 50l7 5-7 5z", stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M52 65h16", stroke: "currentColor", strokeWidth: 1, strokeLinecap: "round", strokeDasharray: "4 3", opacity: 0.4 })
  ] });
}
function IllusRikeEmpty({ className = "xs-empty__illus" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("svg", { className, viewBox: "0 0 120 80", fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("circle", { cx: "86", cy: "22", r: "8", stroke: "currentColor", strokeWidth: 1.2, opacity: 0.4 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M86 8v-3M86 36v3M72 22h-3M100 22h3", stroke: "currentColor", strokeWidth: 1, opacity: 0.25 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("rect", { x: "22", y: "28", width: "58", height: "36", rx: "4", stroke: "currentColor", strokeWidth: 1.5 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M30 40h42M30 47h42M30 54h28", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M22 34h58", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" })
  ] });
}
function IllusDigaoEmpty({ className = "xs-empty__illus" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("svg", { className, viewBox: "0 0 120 80", fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("rect", { x: "30", y: "16", width: "60", height: "48", rx: "4", stroke: "currentColor", strokeWidth: 1.5 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M30 24h60", stroke: "currentColor", strokeWidth: 1, strokeLinecap: "round", opacity: 0.4 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M38 34h30M38 42h42M38 50h24", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M44 58h8M60 58h8M76 58h8", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", opacity: 0.4 })
  ] });
}
function IllusCardsError({ className = "xs-empty__illus" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("svg", { className, viewBox: "0 0 120 80", fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("rect", { x: "28", y: "20", width: "56", height: "40", rx: "5", stroke: "currentColor", strokeWidth: 1.5 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M28 32h56", stroke: "currentColor", strokeWidth: 1, opacity: 0.4 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M36 44h16M36 51h24", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M88 44l6 6M94 44l-6 6", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M16 24l8 8M24 24l-8 8", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", opacity: 0.35 })
  ] });
}

// src/client/watch.ts
var import_react11 = require("react");
function createMainPanelsWatch(slots) {
  const read = () => {
    const keys = /* @__PURE__ */ new Set();
    for (const entry of slots.entries("main")) {
      const key = entry?.options?.key;
      if (typeof key === "string" && key !== "") keys.add(key);
    }
    return [...keys].sort();
  };
  let snapshot = read();
  const listeners = /* @__PURE__ */ new Set();
  const refresh = () => {
    const next = read();
    if (next.length === snapshot.length && next.every((key, index) => key === snapshot[index])) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  const unsubscribe = slots.subscribe("main", refresh);
  refresh();
  return {
    watch: {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot() {
        return snapshot;
      }
    },
    dispose() {
      listeners.clear();
      unsubscribe();
    }
  };
}
function useMainPanels(watch) {
  return (0, import_react11.useSyncExternalStore)(watch.subscribe, watch.getSnapshot, watch.getSnapshot);
}
var EMPTY_MAIN_PANELS = {
  subscribe: () => () => {
  },
  getSnapshot: () => EMPTY_KEYS
};
var EMPTY_KEYS = [];

// src/client/rikke-model.ts
var RIKKE_AI_OFF_TEXT = "今天没有 AI 建议（已关闭）";
function rikkeAiView(ai) {
  if (ai === void 0) return { kind: "none" };
  if (ai.mode === "ok") {
    const text = typeof ai.text === "string" ? ai.text.trim() : "";
    return text === "" ? { kind: "failed", text: "AI 建议生成失败：宿主没有回传内容。" } : { kind: "ok", text };
  }
  if (ai.mode === "off") return { kind: "off", text: RIKKE_AI_OFF_TEXT };
  if (ai.mode === "failed") {
    const reason = typeof ai.reason === "string" && ai.reason.trim() !== "" ? ai.reason.trim() : "（没有给理由）";
    return { kind: "failed", text: `AI 建议生成失败：${reason}` };
  }
  return { kind: "none" };
}

// src/client/cards.tsx
var import_jsx_runtime13 = require("react/jsx-runtime");
function useAvailable(mainPanels) {
  return useMainPanels(mainPanels);
}
function isAvailable(available, target) {
  return available.includes(target);
}
function ActionButton({ action, children, primary, disabled, reason, onClick }) {
  const className = primary ? "xs-btn xs-btn--primary" : "xs-btn";
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
    "button",
    {
      type: "button",
      className: disabled ? `${className} xs-btn--disabled` : className,
      "data-xuanshu-action": action,
      disabled: disabled === true ? true : void 0,
      title: disabled === true ? reason : void 0,
      onClick: disabled === true ? void 0 : onClick,
      children
    }
  );
}
function NavLink({ target, children, disabled, reason, onClick }) {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
    "button",
    {
      type: "button",
      className: disabled ? "xs-link xs-link--disabled" : "xs-link",
      "data-xuanshu-nav": target,
      disabled: disabled === true ? true : void 0,
      title: disabled === true ? reason : void 0,
      onClick: disabled === true ? void 0 : onClick,
      children
    }
  );
}
function XsCardShell({ card, title, state, icon, badge, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("section", { className: "xs-card", "data-xuanshu-card": card, "data-xs-state": state, children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("header", { className: "xs-card__head", children: [
      icon,
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("h2", { className: "xs-card__title", children: title }),
      badge
    ] }),
    children
  ] });
}
function XsReadonlyBadge() {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-badge xs-badge--readonly", "data-xuanshu-badge": "readonly", children: BADGE_READONLY });
}
function XsPureDerivedBadge() {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-badge xs-badge--derived", "data-xuanshu-badge": "derived", children: BADGE_DERIVED });
}
function XsEmptyBlock({
  illus,
  why,
  sub,
  actions,
  variant = "empty"
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: variant === "error" ? "xs-card__error" : "xs-card__empty", children: [
    illus,
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "xs-empty__why", children: why }),
    sub === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "xs-empty__sub", children: sub }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "xs-card__actions", children: actions })
  ] });
}
function XsSkeleton({ lines, blocks = 0, badgePlaceholder = false }) {
  const bars = Array.from({ length: lines }, (_, index) => /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "xs-skeleton__bar xs-skeleton__shimmer" }, `line-${String(index)}`));
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-skeleton", "data-xuanshu-skeleton": "card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "xs-skeleton__bar xs-skeleton__bar--head xs-skeleton__shimmer" }),
    badgePlaceholder ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "xs-skeleton__bar xs-skeleton__bar--badge xs-skeleton__shimmer" }) : null,
    blocks > 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "xs-skeleton__blocks", children: Array.from({ length: blocks }, (_, index) => /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "xs-skeleton__block xs-skeleton__shimmer" }, `block-${String(index)}`)) }) : null,
    bars
  ] });
}
var PILLAR_ORDER = [
  { key: "year", label: "年柱" },
  { key: "month", label: "月柱" },
  { key: "day", label: "日柱" },
  { key: "hour", label: "时柱" }
];
function XsDestinyCard({
  state = "empty",
  snapshot,
  mainPanels,
  onOpenDetail,
  onStartOnboarding,
  onRetry
}) {
  useAvailable(mainPanels);
  const onboardingDisabled = onStartOnboarding === void 0;
  const detailDisabled = onOpenDetail === void 0;
  const retryDisabled = onRetry === void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
    XsCardShell,
    {
      card: "mingpan",
      title: CARD_TITLE.mingpan,
      state,
      icon: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(GlyphCardMingpan, { className: "xs-card__icon" }),
      badge: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(XsReadonlyBadge, {}),
      children: [
        state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(XsSkeleton, { lines: 1, blocks: 4, badgePlaceholder: true }) : null,
        state === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
          XsEmptyBlock,
          {
            illus: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(IllusMingpanEmpty, {}),
            why: EMPTY_COPY.mingpan.why,
            sub: EMPTY_COPY.mingpan.sub,
            actions: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              ActionButton,
              {
                action: "start-onboarding",
                primary: true,
                disabled: onboardingDisabled,
                reason: DISABLED_REASON.onboarding,
                onClick: onStartOnboarding,
                children: ACTION_COPY.startOnboarding
              }
            )
          }
        ) : null,
        state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
          XsEmptyBlock,
          {
            variant: "error",
            illus: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(IllusCardsError, {}),
            why: ERROR_COPY.mingpan,
            actions: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              ActionButton,
              {
                action: "retry",
                disabled: retryDisabled,
                reason: DISABLED_REASON.retry,
                onClick: onRetry,
                children: ACTION_COPY.retry
              }
            )
          }
        ) : null,
        state === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-card__body", "data-xuanshu-ready": "mingpan", children: [
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "xs-pillars", children: PILLAR_ORDER.map(({ key, label }) => /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-pillar", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-pillar__name", children: label }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-pillar__value", children: snapshot?.pillars[key] ?? "—" })
          ] }, key)) }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: "xs-basis", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("span", { "data-xuanshu-basis": "true-solar", children: [
              "真太阳时 ",
              snapshot?.basis.trueSolar ?? "—"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("span", { "data-xuanshu-basis": "clock", children: [
              "钟表时 ",
              snapshot?.basis.clock ?? "—"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "xs-card__actions", children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
            ActionButton,
            {
              action: "open-detail",
              disabled: detailDisabled,
              reason: DISABLED_REASON.openDetail,
              onClick: onOpenDetail,
              children: ACTION_COPY.openDetail
            }
          ) })
        ] }) : null
      ]
    }
  );
}
function XsUnreadBadge({ count }) {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-badge xs-badge--unread", "data-xuanshu-badge": "unread", children: `未读 ${count}` });
}
function RikkeAiLine({ ai }) {
  const view = rikkeAiView(ai);
  if (view.kind === "none") return null;
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "xs-card__note", "data-xuanshu-ai": view.kind, children: view.text });
}
function RikkeNotifyLine({ notify }) {
  if (notify?.status !== "failed") return null;
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
    "p",
    {
      className: "xs-card__note",
      role: "alert",
      "data-xuanshu-notify": "failed",
      "data-xuanshu-reason-code": notifyReasonCode(notify),
      children: `通知没发出去：${notifyFailureText(notify)}`
    }
  );
}
function RikkeLines({ content }) {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-lines", children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: "xs-line", children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__label", children: "宜" }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__value", children: content?.yi ?? "—" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: "xs-line", children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__label", children: "忌" }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__value", children: content?.ji ?? "—" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: "xs-line", children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__label", children: "流日" }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__value", children: content?.liuri ?? "—" })
    ] })
  ] });
}
function XsRikkeCard({
  state = "empty",
  today,
  content,
  reason,
  ai,
  unread,
  notify,
  navigate,
  mainPanels,
  onGenerate,
  onRetry
}) {
  const available = useAvailable(mainPanels);
  const schedulesReady = isAvailable(available, "schedules");
  const rikkeReady = isAvailable(available, "rikke");
  const generateDisabled = onGenerate === void 0;
  const retryDisabled = onRetry === void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
    XsCardShell,
    {
      card: "rike",
      title: `${CARD_TITLE.rike} · 今天 ${today}`,
      state,
      icon: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(GlyphCardRike, { className: "xs-card__icon" }),
      badge: unread !== void 0 && unread > 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(XsUnreadBadge, { count: unread }) : void 0,
      children: [
        state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(XsSkeleton, { lines: 3 }) : null,
        state === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
          XsEmptyBlock,
          {
            illus: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(IllusRikeEmpty, {}),
            why: EMPTY_COPY.rike.why,
            sub: EMPTY_COPY.rike.sub,
            actions: /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                ActionButton,
                {
                  action: "generate-rikke",
                  disabled: generateDisabled,
                  reason: DISABLED_REASON.generate,
                  onClick: onGenerate,
                  children: ACTION_COPY.generate
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                NavLink,
                {
                  target: "schedules",
                  disabled: !schedulesReady,
                  reason: DISABLED_REASON.retry,
                  onClick: () => navigate("schedules"),
                  children: ACTION_COPY.changeTime
                }
              )
            ] })
          }
        ) : null,
        state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
            XsEmptyBlock,
            {
              variant: "error",
              illus: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(IllusCardsError, {}),
              why: ERROR_COPY.rike,
              sub: reason,
              actions: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                ActionButton,
                {
                  action: "retry",
                  disabled: retryDisabled,
                  reason: DISABLED_REASON.retry,
                  onClick: onRetry,
                  children: ACTION_COPY.retry
                }
              )
            }
          ),
          content === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "xs-card__body", "data-xuanshu-ready": "rike", children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(RikkeLines, { content }) })
        ] }) : null,
        state === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-card__body", "data-xuanshu-ready": "rike", children: [
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(RikkeLines, { content }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(RikkeAiLine, { ai }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(RikkeNotifyLine, { notify }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-card__actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              NavLink,
              {
                target: "rikke",
                disabled: !rikkeReady,
                reason: DISABLED_REASON.rikke,
                onClick: () => navigate("rikke"),
                children: ACTION_COPY.watchFull
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              ActionButton,
              {
                action: "generate-rikke",
                disabled: generateDisabled,
                reason: DISABLED_REASON.generate,
                onClick: onGenerate,
                children: ACTION_COPY.generate
              }
            )
          ] })
        ] }) : null
      ]
    }
  );
}
function XsDigaoCard({
  state = "empty",
  summary,
  baseplateEstablished = false,
  reason,
  navigate,
  mainPanels,
  onRefresh,
  onStartOnboarding,
  onRetry
}) {
  const available = useAvailable(mainPanels);
  const onboardingDisabled = onStartOnboarding === void 0;
  const refreshDisabled = onRefresh === void 0;
  const retryDisabled = onRetry === void 0;
  const copy = baseplateEstablished ? EMPTY_COPY.digaoNeverRefreshed : EMPTY_COPY.digaoUnready;
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
    XsCardShell,
    {
      card: "digao",
      title: CARD_TITLE.digao,
      state,
      icon: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(GlyphCardDigao, { className: "xs-card__icon" }),
      badge: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(XsPureDerivedBadge, {}),
      children: [
        state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(XsSkeleton, { lines: 2, badgePlaceholder: true }) : null,
        state === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
          XsEmptyBlock,
          {
            illus: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(IllusDigaoEmpty, {}),
            why: copy.why,
            sub: copy.sub,
            actions: baseplateEstablished ? (
              // 空因 (b)：底座已立、从未刷新 —— 冷启动期的 (a) 不提供 [刷新]（S4 文案表逐条说明）。
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                ActionButton,
                {
                  action: "refresh-digao",
                  disabled: refreshDisabled,
                  reason: DISABLED_REASON.refreshDigao,
                  onClick: onRefresh,
                  children: "立即刷新"
                }
              )
            ) : (
              // 空因 (a)：冷启动。这个按钮与命盘卡空态**同一个动作**（去填出生信息）——
              // 两者同时可见时不再各给一份主权重（判据 D-002：一屏至多一个主操作）。
              // 读序第一张卡（命盘）承担主行动，这里降为次要按钮：动作、文案、回调都不变，
              // 变的只有视觉权重，用户仍然能从这张卡直接进向导。
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                ActionButton,
                {
                  action: "start-onboarding",
                  disabled: onboardingDisabled,
                  reason: DISABLED_REASON.onboarding,
                  onClick: onStartOnboarding,
                  children: ACTION_COPY.startOnboarding
                }
              )
            )
          }
        ) : null,
        state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
          XsEmptyBlock,
          {
            variant: "error",
            illus: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(IllusCardsError, {}),
            why: ERROR_COPY.digao,
            sub: reason,
            actions: /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                ActionButton,
                {
                  action: "retry",
                  disabled: retryDisabled,
                  reason: DISABLED_REASON.retry,
                  onClick: onRetry,
                  children: ACTION_COPY.retry
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                NavLink,
                {
                  target: "digao",
                  disabled: !isAvailable(available, "digao"),
                  reason: DISABLED_REASON.digao,
                  onClick: () => navigate("digao"),
                  children: ACTION_COPY.openDigao
                }
              )
            ] })
          }
        ) : null,
        state === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-card__body", "data-xuanshu-ready": "digao", children: [
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: "xs-digao-summary", children: [
            "关于我：",
            summary?.segments ?? 0,
            " 段 · 来源 ",
            summary?.sources ?? 0,
            " 路"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-source-links", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { children: ACTION_COPY.adjustSource }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              NavLink,
              {
                target: "pus",
                disabled: !isAvailable(available, "pus"),
                reason: DISABLED_REASON.pus,
                onClick: () => navigate("pus"),
                children: ACTION_COPY.sourcePu
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              NavLink,
              {
                target: "conversation",
                disabled: !isAvailable(available, "conversation"),
                reason: "DSH 工作区面板不可用",
                onClick: () => navigate("conversation"),
                children: ACTION_COPY.sourceWorkspace
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              NavLink,
              {
                target: "workflow",
                disabled: !isAvailable(available, "workflow"),
                reason: DISABLED_REASON.workflow,
                onClick: () => navigate("workflow"),
                children: ACTION_COPY.sourceWorkflow
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-card__actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              NavLink,
              {
                target: "digao",
                disabled: !isAvailable(available, "digao"),
                reason: DISABLED_REASON.digao,
                onClick: () => navigate("digao"),
                children: ACTION_COPY.openDigao
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              ActionButton,
              {
                action: "refresh-digao",
                disabled: refreshDisabled,
                reason: DISABLED_REASON.refreshDigao,
                onClick: onRefresh,
                children: ACTION_COPY.refresh
              }
            )
          ] })
        ] }) : null
      ]
    }
  );
}
function XsQuickLinks({
  baseplateReady = false,
  navigate,
  mainPanels,
  aiReadiness,
  checking = false,
  onRetryAi,
  onOpenAiSettings
}) {
  const available = useAvailable(mainPanels);
  const aiState = aiReadiness === void 0 ? checking ? "checking" : "unknown" : aiReadiness.configured === true ? "configured" : aiReadiness.configured === "unknown" ? "unknown" : "missing";
  const consultAvailable = isAvailable(available, "consult");
  const consultDisabled = !consultAvailable || aiState === "missing";
  const cells = [
    {
      target: "consult",
      icon: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(GlyphQuickConsult, { className: "xs-cell__icon" }),
      title: QUICKLINK.consult.title,
      // 底座未立时问事格副标题换提示句，但格**仍可用**（S4 §3④）。
      //
      // 2026-11-01 补：`disabled` 还有第二个来源（AI 没接上）。两个条件正交，
      // 同时成立时副标题说「也能空手先问一句」而按钮是灰的 —— 用户读到的是假话，
      // 而且置灰理由只在 `title`（hover 才有）。所以 AI 没接上时副标题先说这件事。
      subtitle: aiState === "missing" ? "AI 还没接上 · 先看下面那段提示" : baseplateReady ? QUICKLINK.consult.subtitle : QUICKLINK_CONSULT_UNREADY,
      disabled: consultDisabled,
      // 两条理由分开写：面板没装配 ≠ AI 没接上（修复去处不同）。
      reason: consultAvailable ? DISABLED_REASON.consultAi : DISABLED_REASON.consult
    },
    {
      target: "conversation",
      icon: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(GlyphQuickWorkspace, { className: "xs-cell__icon" }),
      title: QUICKLINK.conversation.title,
      subtitle: QUICKLINK.conversation.subtitle,
      disabled: !isAvailable(available, "conversation"),
      reason: "DSH 工作区面板不可用"
    },
    {
      target: "workflow",
      icon: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(GlyphQuickWorkflow, { className: "xs-cell__icon" }),
      title: QUICKLINK.workflow.title,
      subtitle: QUICKLINK.workflow.subtitle,
      disabled: !isAvailable(available, "workflow"),
      reason: DISABLED_REASON.workflow
    }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(XsCardShell, { card: "quicklinks", title: CARD_TITLE.quicklinks, state: "ready", icon: null, children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "xs-quicklinks", "data-xuanshu-quicklinks": "3", children: cells.map((cell) => /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
      "button",
      {
        type: "button",
        className: cell.disabled ? "xs-cell xs-cell--disabled" : "xs-cell",
        "data-xuanshu-nav": cell.target,
        disabled: cell.disabled ? true : void 0,
        title: cell.disabled ? cell.reason : void 0,
        onClick: cell.disabled ? void 0 : () => navigate(cell.target),
        children: [
          cell.icon,
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-cell__title", children: cell.title }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-cell__subtitle", children: cell.subtitle })
        ]
      },
      cell.target
    )) }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
      XsAiGate,
      {
        ...aiReadiness === void 0 ? {} : { readiness: aiReadiness },
        checking,
        ...onRetryAi === void 0 ? {} : { onRetry: onRetryAi },
        ...onOpenAiSettings === void 0 ? {} : { onOpenSettings: onOpenAiSettings }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "xs-quicklinks__note", "data-xuanshu-note": "boundary", children: QUICKLINKS_BOUNDARY })
  ] });
}
function XsMissedBadge() {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-badge xs-badge--missed", "data-xuanshu-badge": "missed", children: "补" });
}
function WanshengConsultLine({ facts }) {
  const sessions = facts?.consultSessions;
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: "xs-line", "data-xuanshu-fact": "consult", children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__label", children: "问事" }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__value", children: sessions === void 0 ? "今天几场问事：未知（这边暂时读不到）" : `今天 ${sessions.count} 场问事` })
  ] });
}
function WanshengActivityLines({ facts }) {
  const groups = [
    { key: "workspaces", label: "项目", items: facts?.activeWorkspaces },
    { key: "workflows", label: "工作流", items: facts?.activeWorkflows }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_jsx_runtime13.Fragment, { children: groups.map(({ key, label, items }) => /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: "xs-line", "data-xuanshu-fact": key, children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__label", children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__value", children: items === void 0 ? `哪些${label}有活动：未知（这边暂时读不到）` : items.length === 0 ? `今天没有${label}活动` : `今天 ${items.length} 个${label}有活动` })
  ] }, key)) });
}
function WanshengArtifactLines({ facts }) {
  const lines = [];
  if (facts?.rikke?.generatedAt !== void 0) {
    lines.push(
      /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: "xs-line", "data-xuanshu-fact": "rikke", children: [
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__label", children: "日课" }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__value", children: `${momentOf(facts.rikke.generatedAt)} 生成` })
      ] }, "rikke")
    );
  }
  if (facts?.digao?.generatedAt !== void 0) {
    lines.push(
      /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: "xs-line", "data-xuanshu-fact": "digao", children: [
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__label", children: "底稿" }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__value", children: `${momentOf(facts.digao.generatedAt)} 刷新过` })
      ] }, "digao")
    );
  }
  if (facts?.shiji?.updatedAt !== void 0) {
    lines.push(
      /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: "xs-line", "data-xuanshu-fact": "shiji", children: [
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__label", children: "事记" }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-line__value", children: `${momentOf(facts.shiji.updatedAt)} 有更新` })
      ] }, "shiji")
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_jsx_runtime13.Fragment, { children: lines });
}
function XsWanshengCard({
  state = "empty",
  today,
  facts,
  missed = false,
  unread,
  notify,
  reason,
  navigate,
  mainPanels,
  onGenerate,
  onRetry
}) {
  const available = useAvailable(mainPanels);
  const consultReady = isAvailable(available, "consult");
  const wanshengReady = isAvailable(available, "wansheng");
  const schedulesReady = isAvailable(available, "schedules");
  const generateDisabled = onGenerate === void 0;
  const retryDisabled = onRetry === void 0;
  const badge = missed ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(XsMissedBadge, {}) : unread !== void 0 && unread > 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(XsUnreadBadge, { count: unread }) : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
    XsCardShell,
    {
      card: "wansheng",
      title: `${CARD_TITLE.wansheng} · 今天 ${today}`,
      state,
      icon: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(GlyphCardRike, { className: "xs-card__icon" }),
      badge,
      children: [
        state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(XsSkeleton, { lines: 3 }) : null,
        state === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
          XsEmptyBlock,
          {
            illus: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(IllusRikeEmpty, {}),
            why: EMPTY_COPY.wansheng.why,
            sub: EMPTY_COPY.wansheng.sub,
            actions: /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                ActionButton,
                {
                  action: "generate-wansheng",
                  disabled: generateDisabled,
                  reason: DISABLED_REASON.generateWansheng,
                  onClick: onGenerate,
                  children: ACTION_COPY.generateWansheng
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                NavLink,
                {
                  target: "schedules",
                  disabled: !schedulesReady,
                  reason: DISABLED_REASON.retry,
                  onClick: () => navigate("schedules"),
                  children: ACTION_COPY.changeTime
                }
              )
            ] })
          }
        ) : null,
        state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
          XsEmptyBlock,
          {
            variant: "error",
            illus: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(IllusCardsError, {}),
            why: ERROR_COPY.wansheng,
            sub: reason,
            actions: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              ActionButton,
              {
                action: "retry",
                disabled: retryDisabled,
                reason: DISABLED_REASON.retry,
                onClick: onRetry,
                children: ACTION_COPY.retry
              }
            )
          }
        ) : null,
        state === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-card__body", "data-xuanshu-ready": "wansheng", children: [
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-lines", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(WanshengConsultLine, { facts }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(WanshengActivityLines, { facts }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(WanshengArtifactLines, { facts })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(RikkeNotifyLine, { notify }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-card__actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              NavLink,
              {
                target: "consult",
                disabled: !consultReady,
                reason: DISABLED_REASON.consult,
                onClick: () => navigate("consult"),
                children: ACTION_COPY.goConsult
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              NavLink,
              {
                target: "wansheng",
                disabled: !wanshengReady,
                reason: DISABLED_REASON.wansheng,
                onClick: () => navigate("wansheng"),
                children: ACTION_COPY.watchWansheng
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              ActionButton,
              {
                action: "generate-wansheng",
                disabled: generateDisabled,
                reason: DISABLED_REASON.generateWansheng,
                onClick: onGenerate,
                children: ACTION_COPY.generateWansheng
              }
            )
          ] })
        ] }) : null
      ]
    }
  );
}

// src/client/digao-model.ts
var KIND_BY_NAME = {
  谱: "pu",
  工作区: "workspace",
  工作流: "workflow",
  事记: "shiji"
};
var SECTION_BY_HEADING = {
  最近在做什么: "recent",
  曾经做过什么: "past"
};
var SECTION_RE = /^##\s*(最近在做什么|曾经做过什么)\s*$/;
var HEADING_RE = /^##\s*来源：\s*(.+?)\s*$/;
var MARKER_RE = /^【来源：\s*(.+?)\s*】\s*(.*)$/;
var ORIGIN_RE = /^源自：\s*(.*)$/;
var EMPTY_ROUTE_RE = /^（尚无来源[：:]\s*(.+?)）$/;
var NO_SHIJI_PREFIX = "（还没有事记";
var SHIJI_META_RE = /^(\d{4}-\d{2}-\d{2})\s*～\s*(\d{4}-\d{2}-\d{2})\s*·\s*依据：会话\s*(\d+)\s*场\s*·\s*文档\s*(\d+)\s*份$/;
function kindOf(name) {
  const exact = KIND_BY_NAME[name];
  if (exact !== void 0) return exact;
  for (const [label, kind] of Object.entries(KIND_BY_NAME)) {
    if (name.startsWith(label)) return kind;
  }
  return "other";
}
function splitMarker(inner) {
  const [label = "", ...rest] = inner.split(/\s+/).filter((part) => part !== "");
  return { label, name: rest.join(" ") };
}
function parseShijiMeta(trailing) {
  const matched = SHIJI_META_RE.exec(trailing);
  if (matched === null) return void 0;
  return {
    since: matched[1],
    until: matched[2],
    basis: { sessions: Number(matched[3]), docs: Number(matched[4]) }
  };
}
function parseDigaoMarkdown(markdown) {
  const drafts = [];
  const byKey = /* @__PURE__ */ new Map();
  let section;
  let group2;
  let segment;
  const ensureGroup = (kind, name) => {
    const key = `${section ?? ""}\0${kind}\0${name}`;
    const existing = byKey.get(key);
    if (existing !== void 0) return existing;
    const draft = {
      ...section === void 0 ? {} : { section },
      kind,
      name,
      noteLines: [],
      segments: []
    };
    drafts.push(draft);
    byKey.set(key, draft);
    return draft;
  };
  const closeSegment = () => {
    if (segment === void 0) return;
    const current = segment;
    segment = void 0;
    const origins = current.bodyLines.map((line) => ORIGIN_RE.exec(line.trim())).filter((match) => match !== null).map((match) => match[1] ?? "");
    const body = current.bodyLines.filter((line) => ORIGIN_RE.exec(line.trim()) === null).join("\n").trim();
    current.group.segments.push({
      label: current.label,
      kind: current.kind,
      name: current.name,
      body,
      ...origins.length === 0 ? {} : { origin: origins[origins.length - 1] ?? "" },
      ...current.since === void 0 ? {} : { since: current.since },
      ...current.until === void 0 ? {} : { until: current.until },
      ...current.basis === void 0 ? {} : { basis: current.basis }
    });
  };
  const openSegment = (target, label, name, trailing) => {
    const draft = {
      group: target,
      label,
      kind: kindOf(label),
      name,
      bodyLines: []
    };
    const meta = draft.kind === "shiji" && trailing !== "" ? parseShijiMeta(trailing) : void 0;
    if (meta !== void 0) {
      draft.since = meta.since;
      draft.until = meta.until;
      draft.basis = meta.basis;
    } else if (trailing !== "") {
      draft.bodyLines.push(trailing);
    }
    segment = draft;
  };
  for (const rawLine of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = rawLine.trim();
    const sectionHeading = SECTION_RE.exec(trimmed);
    if (sectionHeading !== null) {
      closeSegment();
      section = SECTION_BY_HEADING[sectionHeading[1] ?? ""];
      group2 = void 0;
      continue;
    }
    const heading = HEADING_RE.exec(trimmed);
    if (heading !== null) {
      closeSegment();
      section = void 0;
      const name = heading[1] ?? "";
      group2 = ensureGroup(kindOf(name), name);
      continue;
    }
    if (section !== void 0) {
      const marker2 = MARKER_RE.exec(trimmed);
      if (marker2 !== null) {
        closeSegment();
        const { label, name } = splitMarker(marker2[1] ?? "");
        group2 = ensureGroup(kindOf(label), label);
        openSegment(group2, label, name, marker2[2] ?? "");
        continue;
      }
      const emptyRoute = EMPTY_ROUTE_RE.exec(trimmed);
      if (emptyRoute !== null) {
        closeSegment();
        const title = emptyRoute[1] ?? "";
        const draft = ensureGroup(kindOf(title), title);
        draft.noteLines.push(trimmed);
        group2 = draft;
        continue;
      }
      if (segment !== void 0) {
        segment.bodyLines.push(rawLine);
        continue;
      }
      if (trimmed === "") continue;
      if (trimmed.startsWith(NO_SHIJI_PREFIX)) {
        const draft = ensureGroup("shiji", "事记");
        draft.noteLines.push(trimmed);
        group2 = draft;
        continue;
      }
      if (group2 !== void 0) {
        group2.noteLines.push(rawLine);
        continue;
      }
      const orphan = ensureGroup("other", section === "past" ? "曾经" : "最近");
      orphan.noteLines.push(rawLine);
      continue;
    }
    if (group2 === void 0) continue;
    const marker = MARKER_RE.exec(trimmed);
    if (marker !== null) {
      closeSegment();
      const { label, name } = splitMarker(marker[1] ?? "");
      openSegment(group2, label, name, marker[2] ?? "");
      continue;
    }
    if (segment === void 0) group2.noteLines.push(rawLine);
    else segment.bodyLines.push(rawLine);
  }
  closeSegment();
  return drafts.map((draft) => ({
    ...draft.section === void 0 ? {} : { section: draft.section },
    kind: draft.kind,
    name: draft.name,
    note: draft.noteLines.join("\n").trim(),
    segments: draft.segments
  }));
}
function matchShijiEntries(records, entries) {
  const buckets = /* @__PURE__ */ new Map();
  for (const entry of entries ?? []) {
    const key = `${entry.name ?? ""}\0${String(entry.lastActiveAt ?? "").slice(0, 10)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }
  return records.map((record) => {
    const key = `${record.name}\0${record.until ?? ""}`;
    const bucket = buckets.get(key);
    return bucket === void 0 || bucket.length === 0 ? void 0 : bucket.shift();
  });
}

// src/client/digao-style.ts
function installDigaoStyle() {
  registerStyleSheet("xs-digao-style", `
.xs-digao{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-digao h1,.xs-digao h2{font-weight:600}.xs-digao h1{font-size:1.15rem}.xs-digao h2{font-size:1rem}
.xs-digao__head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;position:sticky;top:0;background:var(--xs-surface-card);padding:8px 0;z-index:1}
.xs-digao__jumps,.xs-digao__actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
.xs-digao button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-digao button:disabled{opacity:.5;cursor:not-allowed}
.xs-digao__jumps button{background:transparent;border-color:transparent;text-decoration:underline;padding:2px 4px}
.xs-digao__note,.xs-digao__origin{color:var(--xs-text-secondary);font-size:.85rem;line-height:1.7}
.xs-digao__no-edit{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:8px 10px}
.xs-digao__group{margin:18px 0;border-left:3px solid var(--xs-edge-card);padding-left:12px}
.xs-digao__group-head{margin:0 0 6px}
/* #27：两段（最近 / 曾经）。段头比组头高一级：段是契约章序，组只是段内的来源路。 */
.xs-digao__section{margin:20px 0}
.xs-digao__section-head{font-size:1.05rem;font-weight:600;margin:0 0 10px;padding-bottom:4px;border-bottom:1px solid var(--xs-edge-card)}
.xs-digao__segment{margin:10px 0;border-left:2px solid var(--xs-edge-card);padding-left:10px}
/* #27：事记条目（曾经做过什么）—— 与「最近」的段同一套边条，但多一枚 [删除] 与确认条。 */
.xs-digao__record{margin:14px 0;border-left:2px solid var(--xs-edge-card);padding-left:12px}
.xs-digao__confirm{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:8px 10px;margin:8px 0}
.xs-digao__confirm p{margin:0 0 6px;line-height:1.7}
.xs-digao__tag{display:inline-block;padding:1px 6px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);font-size:.8rem;color:var(--xs-text-secondary);margin-right:6px}
.xs-digao__segment-body{white-space:pre-wrap;line-height:1.8;margin:4px 0}
.xs-digao__raw{white-space:pre-wrap;font-family:var(--font-mono,monospace);font-size:.85rem;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:10px;overflow:auto;max-height:var(--xs-size-scrollregion-max,420px)}
.xs-digao__alert{padding:10px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);margin:8px 0}
@media(max-width: ${BREAKPOINT_WIDE_PX}px){.xs-digao{padding:16px}}
`);
  installXuanshuStyles();
}

// src/client/digao.tsx
var import_jsx_runtime14 = require("react/jsx-runtime");
var DIGAO_NO_EDIT_NOTE = "本面板没有编辑框、没有保存按钮：内容由「规则骨架 + AI 摘要」生成；改了源头，刷新即变。唯一能删的是「曾经做过什么」里的事记（删的是账本里的那一条，不是改底稿），删完可在设置里恢复。";
var DIGAO_JUMP_NOTE = "要改就改源头：";
var DIGAO_JUMPS = [
  { target: "pus", label: "改谱" },
  { target: "conversation", label: "改工作区" },
  { target: "workflow", label: "改工作流" }
];
var DIGAO_NEXT_REFRESH_NOTE = "下次刷新：由「自动化任务」面板里的底稿 daily 任务决定（播种默认 03:30，可在那里改或停用）。";
var DIGAO_NO_SHIJI_READ_NOTE = "没有读到事记账本：这一段的条目暂时不能在这里删（正文照原文展示；刷新一次底稿就会写账本）。";
function initialView(preloaded) {
  if (preloaded === void 0) return { kind: "loading" };
  if ("error" in preloaded) return { kind: "error", message: preloaded.error };
  if (preloaded.status.exists !== true) {
    return {
      kind: "empty",
      meta: preloaded.status.meta,
      ...preloaded.status.schedule === void 0 ? {} : { schedule: preloaded.status.schedule }
    };
  }
  if (preloaded.read === void 0) return { kind: "error", message: "底稿文件存在但正文没读回来。" };
  const schedule = preloaded.read.schedule ?? preloaded.status.schedule;
  const shiji = preloaded.read.shiji ?? preloaded.status.shiji;
  const shijiReason = preloaded.read.shijiReason ?? preloaded.status.shijiReason;
  return {
    kind: "ready",
    meta: preloaded.read.meta ?? preloaded.status.meta,
    markdown: preloaded.read.markdown,
    ...schedule === void 0 ? {} : { schedule },
    ...shiji === void 0 ? {} : { shiji },
    ...shijiReason === void 0 ? {} : { shijiReason }
  };
}
function errorText4(error) {
  return error instanceof Error ? error.message : String(error);
}
function DigaoPanel({ api, shiji, navigate, preloaded, preloadedRawView }) {
  const seeded = preloaded !== void 0;
  const [view, setView] = (0, import_react12.useState)(() => initialView(preloaded));
  const [busy, setBusy] = (0, import_react12.useState)(false);
  const [raw, setRaw] = (0, import_react12.useState)(preloadedRawView === true);
  const [note, setNote] = (0, import_react12.useState)(void 0);
  const sequence = (0, import_react12.useRef)(0);
  const load = () => {
    const mine = ++sequence.current;
    setNote(void 0);
    void api.status().then(async (status) => {
      if (mine !== sequence.current) return;
      if (status.exists !== true) {
        setView({
          kind: "empty",
          meta: status.meta,
          ...status.schedule === void 0 ? {} : { schedule: status.schedule }
        });
        return;
      }
      const read = await api.read();
      if (mine !== sequence.current) return;
      const schedule2 = read.schedule ?? status.schedule;
      const shiji2 = read.shiji ?? status.shiji;
      const shijiReason = read.shijiReason ?? status.shijiReason;
      setView({
        kind: "ready",
        meta: read.meta ?? status.meta,
        markdown: read.markdown,
        ...schedule2 === void 0 ? {} : { schedule: schedule2 },
        ...shiji2 === void 0 ? {} : { shiji: shiji2 },
        ...shijiReason === void 0 ? {} : { shijiReason }
      });
    }).catch((error) => {
      if (mine !== sequence.current) return;
      setView({ kind: "error", message: errorText4(error) });
    });
  };
  (0, import_react12.useEffect)(() => {
    if (seeded) return;
    load();
  }, [api, seeded]);
  const refresh = () => {
    const mine = ++sequence.current;
    setBusy(true);
    setNote(void 0);
    void api.refresh().then(async () => {
      const read = await api.read();
      if (mine !== sequence.current) return;
      setView({
        kind: "ready",
        meta: read.meta,
        markdown: read.markdown,
        ...read.schedule === void 0 ? {} : { schedule: read.schedule },
        ...read.shiji === void 0 ? {} : { shiji: read.shiji },
        ...read.shijiReason === void 0 ? {} : { shijiReason: read.shijiReason }
      });
    }).catch((error) => {
      if (mine !== sequence.current) return;
      setNote(`刷新失败：${errorText4(error)}`);
    }).finally(() => {
      if (mine === sequence.current) setBusy(false);
    });
  };
  const reloadAfterDelete = async () => {
    const mine = sequence.current;
    const read = await api.read();
    if (mine !== sequence.current) return;
    setView((previous) => {
      if (previous.kind !== "ready") return previous;
      return {
        ...previous,
        meta: read.meta,
        markdown: read.markdown,
        ...read.shiji === void 0 ? {} : { shiji: read.shiji },
        shijiReason: read.shijiReason
      };
    });
  };
  const meta = view.kind === "empty" || view.kind === "ready" ? view.meta : null;
  const schedule = view.kind === "empty" || view.kind === "ready" ? view.schedule : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("main", { className: "xs-digao", "data-xuanshu-panel": DIGAO_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("header", { className: "xs-digao__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h1", { children: "底稿" }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(XsPureDerivedBadge, {})
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("p", { className: "xs-digao__jumps", "data-xuanshu-note": "source-jumps", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { children: DIGAO_JUMP_NOTE }),
      DIGAO_JUMPS.map((jump) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
        "button",
        {
          type: "button",
          "data-xuanshu-nav": jump.target,
          onClick: () => {
            navigate(jump.target);
          },
          children: jump.label
        },
        jump.target
      ))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note xs-digao__no-edit", "data-xuanshu-note": "no-edit", children: DIGAO_NO_EDIT_NOTE }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note", "data-xuanshu-note": "last-refresh", children: meta?.generatedAt === void 0 ? "上次刷新：（还没有生成过）" : `上次刷新 ${momentOf(meta.generatedAt)}` }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note", "data-xuanshu-note": "next-refresh", children: schedule === void 0 ? DIGAO_NEXT_REFRESH_NOTE : `下次刷新 ${clockOf(schedule.time)}（${schedule.timeZone}）· 由「自动化任务」面板里的 daily 任务决定（可在那里改或停用）` }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "xs-digao__actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
        "button",
        {
          type: "button",
          className: "xs-btn xs-btn--primary",
          "data-xuanshu-action": "refresh-digao",
          disabled: busy,
          onClick: refresh,
          children: busy ? "刷新中…" : "刷新"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
        "button",
        {
          type: "button",
          "data-xuanshu-action": "view-md",
          onClick: () => {
            setRaw(!raw);
          },
          children: raw ? "收起 MD 形态" : "查看 MD 形态"
        }
      )
    ] }),
    note === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__alert", role: "alert", "data-xuanshu-alert": "refresh", children: note }),
    view.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note", "data-xuanshu-view": "loading", children: "正在读底稿…" }) : null,
    view.kind === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "xs-digao__empty", "data-xuanshu-view": "empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: EMPTY_COPY.digaoNeverRefreshed.why }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note", children: "底稿由谱 / 工作区 / 工作流 / 事记四路来源提炼而成；点一次 [刷新] 就会拼出「最近在做什么」与「曾经做过什么」两段。" })
    ] }) : null,
    view.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "xs-digao__alert", "data-xuanshu-view": "error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: view.message }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "xs-digao__actions", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { type: "button", "data-xuanshu-action": "retry", onClick: load, children: "重试" }) })
    ] }) : null,
    view.kind === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      DigaoBody,
      {
        markdown: view.markdown,
        meta: view.meta,
        raw,
        ...view.shiji === void 0 ? {} : { shijiRead: view.shiji },
        ...view.shijiReason === void 0 ? {} : { shijiReason: view.shijiReason },
        ...shiji === void 0 ? {} : { shiji },
        reload: reloadAfterDelete
      }
    ) : null
  ] });
}
function digestLine(meta) {
  const digest = meta?.digest;
  if (digest === "skeleton") {
    return (meta?.segments ?? 0) === 0 ? "生成方式：只有规则骨架（还没有可提炼的来源：谱 / 工作区 / 工作流都还没内容）" : "生成方式：只有规则骨架（AI 这次用不了或没用成，摘要没生成）";
  }
  if (digest === "llm") return "生成方式：规则骨架 + AI 摘要";
  return "生成方式：只有规则骨架（读不到生成记录，按「摘要没生成」处理）";
}
function SegmentList({ segments }) {
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_jsx_runtime14.Fragment, { children: segments.map((segment, index) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("article", { className: "xs-digao__segment", children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("p", { className: "xs-digao__segment-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { className: "xs-digao__tag", "data-xuanshu-source-tag": segment.label, children: `[${segment.label}]` }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { className: "xs-digao__segment-name", children: segment.name })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__segment-body", children: segment.body }),
    segment.origin === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__origin", "data-xuanshu-origin": segment.kind, children: `源自：${segment.origin}` })
  ] }, `${segment.kind}-${String(index)}`)) });
}
function ShijiRecord({
  record,
  entry,
  pending,
  busy,
  onAskDelete,
  onCancel,
  onConfirm
}) {
  const range = `${record.since ?? ""}～${record.until ?? ""}`;
  const basis = record.basis ?? { sessions: 0, docs: 0 };
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("article", { className: "xs-digao__record", ...entry === void 0 ? {} : { "data-xuanshu-shiji": entry.id }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("p", { className: "xs-digao__segment-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { className: "xs-digao__tag", "data-xuanshu-source-tag": record.label, children: `[${record.label}]` }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { className: "xs-digao__segment-name", children: record.name })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note", "data-xuanshu-shiji-meta": entry?.id ?? record.name, children: `${range} · 依据：会话 ${basis.sessions} 场 · 文档 ${basis.docs} 份` }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__segment-body", children: record.body }),
    entry === void 0 ? null : pending ? (
      // 二次确认就地展开（不用 window.confirm：文案要可断言，窄屏也要排得下）。
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "xs-digao__confirm", role: "alertdialog", "aria-label": "确认删除这条事记", "data-xuanshu-confirm": "delete-shiji", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { "data-xuanshu-confirm-text": "delete-shiji", children: `删除事记「${record.name}」？删除后下一次刷新不会再出现；可以在设置里恢复。` }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "xs-digao__actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { type: "button", className: "xs-btn xs-btn--primary", "data-xuanshu-action": "delete-shiji-confirm", disabled: busy, onClick: onConfirm, children: busy ? "删除中…" : "确认删除" }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { type: "button", "data-xuanshu-action": "delete-shiji-cancel", disabled: busy, onClick: onCancel, children: "取消" })
        ] })
      ] })
    ) : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { type: "button", "data-xuanshu-action": "delete-shiji", "data-xuanshu-shiji-id": entry.id, onClick: onAskDelete, children: "删除" })
  ] });
}
function PastSection({
  group: group2,
  shijiRead,
  shiji,
  shijiReason,
  reload
}) {
  const records = group2?.segments ?? [];
  const matched = matchShijiEntries(records, shijiRead?.entries);
  const rows = records.map((record, index) => ({
    record,
    entry: shijiRead === void 0 ? void 0 : matched[index]
  }));
  const live = rows.filter((row) => shijiRead === void 0 || row.entry !== void 0);
  const gone = shijiRead === void 0 ? 0 : records.length - live.length;
  const [pendingId, setPendingId] = (0, import_react12.useState)(void 0);
  const [busyId, setBusyId] = (0, import_react12.useState)(void 0);
  const [note, setNote] = (0, import_react12.useState)(void 0);
  const remove = (entry, name) => {
    if (shiji === void 0) return;
    setBusyId(entry.id);
    setNote(void 0);
    void shiji.remove({ id: entry.id }).then(async () => {
      setPendingId(void 0);
      await reload();
      setNote(`已删除事记「${name}」：下一次刷新后正文里不会再出现；可以在设置里恢复。`);
    }).catch((error) => {
      setNote(`删除失败：${errorText4(error)}`);
    }).finally(() => {
      setBusyId(void 0);
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "xs-digao__section", "data-xuanshu-section": "past", children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h2", { className: "xs-digao__section-head", children: "曾经做过什么" }),
    group2 === void 0 || group2.note === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note", "data-xuanshu-group-note": "shiji", children: group2.note }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { className: "xs-digao__group-head", children: `来源：事记（${live.length} 条）` }),
    live.map(({ record, entry }, index) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      ShijiRecord,
      {
        record,
        ...entry === void 0 ? {} : { entry },
        pending: entry !== void 0 && pendingId === entry.id,
        busy: entry !== void 0 && busyId === entry.id,
        onAskDelete: () => {
          if (entry === void 0) return;
          setPendingId(entry.id);
          setNote(void 0);
        },
        onCancel: () => {
          setPendingId(void 0);
        },
        onConfirm: () => {
          if (entry === void 0) return;
          remove(entry, record.name);
        }
      },
      entry?.id ?? `${record.name}-${String(index)}`
    )),
    shijiRead === void 0 && records.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note", "data-xuanshu-note": shijiReason === void 0 ? "shiji-unread" : "shiji-read-failed", children: shijiReason ?? DIGAO_NO_SHIJI_READ_NOTE }) : null,
    gone > 0 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note", "data-xuanshu-note": "shiji-removed", children: `已删除 ${gone} 条事记：下一次刷新后正文里不会再出现；可以在设置里恢复。` }) : null,
    note === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__alert", role: "alert", "data-xuanshu-alert": "shiji", children: note })
  ] });
}
function DigaoBody({
  markdown,
  meta,
  raw,
  shijiRead,
  shiji,
  shijiReason,
  reload
}) {
  const groups = parseDigaoMarkdown(markdown);
  const recent = groups.filter((group2) => group2.section === "recent");
  const past = groups.find((group2) => group2.section === "past");
  const legacy = groups.filter((group2) => group2.section === void 0);
  const twoSections = recent.length > 0 || past !== void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(import_jsx_runtime14.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note", "data-xuanshu-note": "digest", children: digestLine(meta) }),
    raw ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("pre", { className: "xs-digao__raw", "data-xuanshu-raw": "digao", children: markdown }) : null,
    groups.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(import_jsx_runtime14.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note", "data-xuanshu-note": "shape-mismatch", children: "正文形态不符（没有「## 最近在做什么 / ## 曾经做过什么」两段，也没有「## 来源：…」章节）： 按原文只读展示，界面不假装解析出来源分组。" }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("pre", { className: "xs-digao__raw", "data-xuanshu-raw": "digao-fallback", children: markdown })
    ] }) : null,
    twoSections ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "xs-digao__section", "data-xuanshu-section": "recent", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h2", { className: "xs-digao__section-head", children: "最近在做什么" }),
      recent.map((group2) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "xs-digao__group", "data-xuanshu-group": group2.kind, children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { className: "xs-digao__group-head", children: `来源：${group2.name}（${group2.segments.length} 段）` }),
        group2.note === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note", "data-xuanshu-group-note": group2.kind, children: group2.note }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(SegmentList, { segments: group2.segments })
      ] }, `${group2.kind}-${group2.name}`))
    ] }) : null,
    twoSections ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      PastSection,
      {
        group: past,
        shijiRead,
        shiji,
        ...shijiReason === void 0 ? {} : { shijiReason },
        reload
      }
    ) : null,
    legacy.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_jsx_runtime14.Fragment, { children: legacy.map((group2) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "xs-digao__group", "data-xuanshu-group": group2.kind, children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h2", { className: "xs-digao__group-head", children: `来源：${group2.name}（${group2.segments.length} 段）` }),
      group2.note === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "xs-digao__note", "data-xuanshu-group-note": group2.kind, children: group2.note }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(SegmentList, { segments: group2.segments })
    ] }, `${group2.kind}-${group2.name}`)) }) : null
  ] });
}
function DigaoIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("path", { d: "M6 3.5h8l4 4V20.5H6z" }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("path", { d: "M14 3.5v4h4" }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("path", { d: "M8.5 12h7M8.5 15.5h7" })
  ] });
}
function installDigao(ctx, deps) {
  installDigaoStyle();
  ctx.slots.inject(
    "main",
    () => ctx.slots.register(
      { name: "main", key: DIGAO_ID, inject: () => ({ ...deps }) },
      DigaoPanel
    )
  );
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      { name: "sidebar.panellist", id: DIGAO_ID, order: DIGAO_ORDER, label: DIGAO_LABEL },
      DigaoIcon
    )
  );
}

// src/client/MingpanPanel.tsx
var import_react13 = require("react");

// src/client/bazi-style.ts
function installBaziStyle() {
  registerStyleSheet("xs-bazi-style", `
.xs-wizard{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-wizard h1,.xs-wizard h2,.xs-wizard h3{font-weight:600}.xs-wizard h2{font-size:1.05rem}.xs-wizard h3{font-size:.95rem;margin:18px 0 6px}
.xs-wizard__steps{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0}
.xs-wizard__step-list{display:flex;gap:6px;list-style:none;margin:0;padding:0;flex-wrap:wrap}
.xs-wizard__step{display:flex;gap:6px;align-items:center;padding:4px 10px;border:1px solid var(--xs-edge-card);border-radius:999px;font-size:.8rem;color:var(--xs-text-secondary)}
.xs-wizard__step--current{border-color:var(--xs-accent);color:var(--xs-text-body)}
.xs-wizard__step--done{opacity:.75}
.xs-wizard__cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--xs-space-card-pad)}
.xs-wizard__aside{color:var(--xs-text-secondary);font-size:.85rem;line-height:1.7}
.xs-wizard__field{display:block;margin:10px 0}
.xs-wizard__field>span{display:block;margin-bottom:4px;font-size:.85rem}
.xs-wizard input,.xs-wizard select,.xs-wizard textarea{font:inherit;color:inherit;background:var(--xs-surface-card);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:7px;box-sizing:border-box;max-width:100%}
.xs-wizard textarea{display:block;width:100%;min-height:72px}
.xs-wizard button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-wizard button:disabled{opacity:.5;cursor:not-allowed}
.xs-btn--primary{background:var(--xs-accent);border-color:var(--xs-accent);color:var(--xs-accent-fg)}
.xs-wizard__note,.xs-wizard__hint,.xs-wizard__status{font-size:.8rem;color:var(--xs-text-secondary);line-height:1.6}
.xs-wizard__hint{color:var(--xs-text-body)}
.xs-wizard__nudge,.xs-wizard__manual,.xs-wizard__actions,.xs-wizard__cast{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
.xs-wizard__nudge-grains{display:inline-flex;gap:4px}
.xs-chip{font-size:.8rem;padding:3px 8px}
.xs-chip--on{border-color:var(--xs-accent)}
.xs-wizard__cities{list-style:none;margin:6px 0;padding:0;max-height:220px;overflow:auto}
.xs-wizard__cities li{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--xs-edge-card)}
.xs-wizard__city-region{color:var(--xs-text-secondary);font-size:.8rem;flex:1}
.xs-wizard__place{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.xs-wizard__place-coord{font-family:var(--font-mono,monospace);color:var(--xs-text-code)}
.xs-wizard__zone-value{display:flex;gap:8px;align-items:baseline;font-size:1.05rem}
.xs-wizard__confirm{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad)}
.xs-wizard__confirm-list{list-style:none;margin:0;padding:0}
.xs-wizard__confirm-list li{display:flex;gap:12px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--xs-edge-card)}
.xs-wizard__confirm-label{min-width:72px;color:var(--xs-text-secondary);font-size:.85rem}
.xs-wizard__confirm-value{flex:1}
.xs-wizard__radio{display:block;margin:6px 0}
.xs-wizard__radio small{margin-left:8px}
.xs-wizard__check{display:block;margin:6px 0}
.xs-wizard__check input{margin-right:8px}
.xs-wizard__reason{padding:12px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);margin-top:8px}
.xs-wizard__reason-main{color:var(--xs-text-body);line-height:1.7}
.xs-wizard__gate{padding:12px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);margin:12px 0}
.xs-wizard__gate-prompt{font-size:1rem;line-height:1.7}
.xs-wizard__footer{display:flex;gap:8px;align-items:center;margin-top:18px;position:sticky;bottom:0;background:var(--xs-surface-card);padding:10px 0}
.xs-wizard__footer .xs-wizard__spacer{flex:1}
.xs-mingpan{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-mingpan h1,.xs-mingpan h2{font-weight:600}.xs-mingpan h2{font-size:1rem;margin:18px 0 6px}
.xs-mingpan button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-mingpan button:disabled{opacity:.5;cursor:not-allowed}
.xs-mingpan__summary p{margin:4px 0}
.xs-mingpan__coord{font-family:var(--font-mono,monospace);color:var(--xs-text-code)}
.xs-mingpan__pillars{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.xs-mingpan__pillar{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:10px;text-align:center}
.xs-mingpan__pillar-name{display:block;font-size:.8rem;color:var(--xs-text-secondary)}
.xs-mingpan__pillar-value{font-size:1.2rem}
.xs-mingpan__basis,.xs-mingpan__origin{line-height:1.8}
.xs-mingpan__confirm{margin-top:12px;padding:12px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card)}
.xs-mingpan__actions,.xs-mingpan__head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
@media(max-width: ${BREAKPOINT_WIDE_PX}px){.xs-wizard__cols{grid-template-columns:1fr}.xs-wizard{padding:16px}.xs-mingpan{padding:16px}}
`);
  installXuanshuStyles();
}

// src/client/onboarding-model.ts
var UNNAMED_PLACE = "未命名地点";
var TIME_ALG_LABELS = {
  0: "真太阳时（经度 + 均时差）",
  1: "直接时间（钟表时）",
  3: "平太阳时（仅经度差）"
};
var TIME_ALG_OPTIONS = [
  {
    value: 0,
    label: `${TIME_ALG_LABELS[0]} = 0`,
    hint: "v1 默认档：**缺省省略**，玄枢不写这个键，由引擎缺省决定"
  },
  { value: 1, label: `${TIME_ALG_LABELS[1]} = 1`, hint: "透传 timeAlg=1" },
  { value: 3, label: `${TIME_ALG_LABELS[3]} = 3`, hint: "透传 timeAlg=3" }
];
function timeAlgLabel(value) {
  return TIME_ALG_LABELS[value] ?? "未知档位";
}
var GENDER_OPTIONS = [
  { value: "unknown", label: "未知（按男排）", hint: "大运顺逆与小运需要性别择一，故「未知」按男排" },
  { value: "female", label: "女", hint: "" },
  { value: "male", label: "男", hint: "" }
];
function genderLabel(value) {
  return GENDER_OPTIONS.find((option) => option.value === value)?.label ?? "未知（按男排）";
}
var NOTE_OPTIONS = [
  { id: "minute", label: "出生时间只精确到分钟" },
  { id: "place", label: "出生地是大概位置" }
];
function composeNotes(ids) {
  return NOTE_OPTIONS.filter((option) => ids.includes(option.id)).map((option) => option.label).join("；");
}
var ZONE_OFFSETS = [
  { value: "+00:00", label: "东0区" },
  { value: "+01:00", label: "东1区" },
  { value: "+02:00", label: "东2区" },
  { value: "+03:00", label: "东3区" },
  { value: "+04:00", label: "东4区" },
  { value: "+04:30", label: "东4.5" },
  { value: "+05:00", label: "东5区" },
  { value: "+05:30", label: "东5.5" },
  { value: "+06:00", label: "东6区" },
  { value: "+07:00", label: "东7区" },
  { value: "+08:00", label: "东8区" },
  { value: "+09:00", label: "东9区" },
  { value: "+10:00", label: "东10" },
  { value: "+11:00", label: "东11" },
  { value: "+12:00", label: "东12" },
  { value: "-01:00", label: "西1区" },
  { value: "-02:00", label: "西2区" },
  { value: "-03:00", label: "西3区" },
  { value: "-04:00", label: "西4区" },
  { value: "-05:00", label: "西5区" },
  { value: "-05:30", label: "西5.5" },
  { value: "-06:00", label: "西6区" },
  { value: "-07:00", label: "西7区" },
  { value: "-07:30", label: "西7.5" },
  { value: "-08:00", label: "西8区" },
  { value: "-09:00", label: "西9区" },
  { value: "-10:00", label: "西10" },
  { value: "-11:00", label: "西11" }
];
function isFixedOffsetZone(zone) {
  return /^[+-]\d{2}:\d{2}$/.test(zone);
}
var NUDGE_GRAINS = [
  { id: "year", label: "年" },
  { id: "month", label: "月" },
  { id: "day", label: "天" },
  { id: "hour", label: "小时", minutes: 60 },
  // 「四分钟」= 1° 经度时差（S3 §3.1③：**不要改写成「加减分秒」**）。
  { id: "fourMinute", label: "四分钟", minutes: 4 }
];
var TIME_PATTERN = /^(\d{2}):(\d{2})$/;
var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
var pad2 = (value) => String(value).padStart(2, "0");
function stamp(date, time) {
  return { date, time };
}
function nudgeDateTime(date, time, grain, delta) {
  const dateMatch = DATE_PATTERN.exec(date);
  const timeMatch = TIME_PATTERN.exec(time);
  if (dateMatch === null || timeMatch === null) return stamp(date, time);
  const base = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2])
  );
  const spec = NUDGE_GRAINS.find((row) => row.id === grain);
  let shifted = base;
  switch (grain) {
    case "year":
      shifted = Date.UTC(
        Number(dateMatch[1]) + delta,
        Number(dateMatch[2]) - 1,
        Number(dateMatch[3]),
        Number(timeMatch[1]),
        Number(timeMatch[2])
      );
      break;
    case "month":
      shifted = Date.UTC(
        Number(dateMatch[1]),
        Number(dateMatch[2]) - 1 + delta,
        Number(dateMatch[3]),
        Number(timeMatch[1]),
        Number(timeMatch[2])
      );
      break;
    case "day":
      shifted = base + delta * 864e5;
      break;
    default:
      shifted = base + delta * (spec?.minutes ?? 0) * 6e4;
      break;
  }
  const next = new Date(shifted);
  return stamp(
    `${String(next.getUTCFullYear())}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`,
    `${pad2(next.getUTCHours())}:${pad2(next.getUTCMinutes())}`
  );
}
function formatDegreeMinute(value, positive, negative) {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = Math.floor((absolute - degrees) * 60);
  return `${String(degrees)}${value >= 0 ? positive : negative}${pad2(minutes)}`;
}
function formatCoords(lon, lat) {
  return `${formatDegreeMinute(lon, "e", "w")} / ${formatDegreeMinute(lat, "n", "s")}`;
}
function manualLocation(lonText, latText) {
  const lon = Number(lonText.trim());
  const lat = Number(latText.trim());
  if (lonText.trim() === "" || latText.trim() === "") return void 0;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return void 0;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return void 0;
  return { lon, lat };
}
function defaultDraft() {
  return {
    date: "",
    time: "",
    place: "",
    lon: void 0,
    lat: void 0,
    zone: "",
    zoneManual: false,
    timeAlg: 0,
    gender: "unknown",
    notes: [],
    gateAnswer: "",
    verified: false
  };
}
function draftFromSnapshot(snapshot) {
  const birth = snapshot?.birth ?? {};
  const timeAlg = birth.timeAlg === 1 || birth.timeAlg === 3 ? birth.timeAlg : 0;
  const zone = typeof birth.zone === "string" ? birth.zone : "";
  return {
    date: typeof birth.date === "string" ? birth.date : "",
    time: typeof birth.time === "string" ? birth.time : "",
    place: typeof birth.place === "string" ? birth.place : "",
    lon: Number.isFinite(birth.lon) ? birth.lon : void 0,
    lat: Number.isFinite(birth.lat) ? birth.lat : void 0,
    zone,
    zoneManual: isFixedOffsetZone(zone),
    timeAlg,
    gender: "unknown",
    notes: [],
    gateAnswer: "",
    verified: false
  };
}
function placeLabel(draft) {
  return draft.place.trim() === "" ? UNNAMED_PLACE : draft.place;
}
function missingCoordinates(draft) {
  const missing = [];
  if (!Number.isFinite(draft.lon)) missing.push("经度");
  if (!Number.isFinite(draft.lat)) missing.push("纬度");
  return missing;
}
var CAST_BLOCK_REASON = {
  date: "出生日期还没填（公历即可，农历换算由底座做）。",
  time: "出生时刻还没填（填**当地时间**即可，真太阳时由底座换算）。",
  zone: "时区还没定：自动推导失败时，请在第 3 步手动指定一个 UTC 偏移。",
  verified: "请先勾选「以上信息我已核对」—— 这是出盘前的澄清闸。"
};
var CAST_MISSING_REASON = "缺：经度 / 纬度。没有经纬度，真太阳时就算不出来；引擎会悄悄退回钟表口径，玄枢不让这种盘生成。";
function castBlockers(draft) {
  const blockers = [];
  if (draft.date.trim() === "") blockers.push("date");
  if (draft.time.trim() === "") blockers.push("time");
  if (missingCoordinates(draft).length > 0) blockers.push("coordinates");
  if (draft.zone.trim() === "") blockers.push("zone");
  if (!draft.verified) blockers.push("verified");
  return blockers;
}
function buildCastRequest(draft) {
  if (castBlockers(draft).length > 0) return void 0;
  const notes = [composeNotes(draft.notes), draft.gateAnswer.trim()].filter((part) => part !== "").join("；");
  const birth = {
    date: draft.date,
    time: draft.time,
    zone: draft.zone,
    lat: draft.lat,
    lon: draft.lon
  };
  if (draft.place.trim() !== "") birth.place = draft.place;
  if (draft.timeAlg !== 0) birth.timeAlg = draft.timeAlg;
  const request = { birth, confirmed: true };
  if (notes !== "") request.notes = notes;
  return request;
}
function nowStamp(now = /* @__PURE__ */ new Date()) {
  return stamp(
    `${String(now.getFullYear())}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
  );
}
function formatOffsetMinutes(minutes) {
  if (minutes === null || minutes === void 0 || !Number.isFinite(minutes)) return "—";
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
}

// src/client/MingpanPanel.tsx
var import_jsx_runtime15 = require("react/jsx-runtime");
function rerecordConfirm(dataDir) {
  return `将重新录制出生信息并重新出盘。当前底座谱（${dataDirPath(dataDir, "pus", "_base", "bazi.md")}）会被新结果原子替换；底稿会在下次刷新时随之更新，需要你手动点刷新。`;
}
var PILLAR_COLUMNS = [
  { key: "year", label: "年柱" },
  { key: "month", label: "月柱" },
  { key: "day", label: "日柱" },
  { key: "hour", label: "时柱" }
];
var SNAPSHOT_SECTIONS = ["birth", "pillars", "basis"];
function MingpanPanel({
  api,
  controller,
  navigate,
  preloadedSnapshot,
  preloadedError,
  dataDir,
  homePaths
}) {
  const injectedHomePaths = useHomePaths(homePaths);
  const localDataDir = dataDir ?? injectedHomePaths.dataDir;
  const revision = (0, import_react13.useSyncExternalStore)(controller.subscribe, controller.getRevision, controller.getRevision);
  const seeded = preloadedError !== void 0 || preloadedSnapshot !== void 0;
  const [view, setView] = (0, import_react13.useState)(() => {
    if (preloadedError !== void 0) return { kind: "error", message: preloadedError };
    if (preloadedSnapshot !== void 0) {
      return preloadedSnapshot === null ? { kind: "empty" } : { kind: "ready", snapshot: preloadedSnapshot };
    }
    return { kind: "loading" };
  });
  const [confirming, setConfirming] = (0, import_react13.useState)(false);
  const sequence = (0, import_react13.useRef)(0);
  (0, import_react13.useEffect)(() => {
    if (seeded) return;
    const mine = ++sequence.current;
    setView((current) => current.kind === "ready" ? current : { kind: "loading" });
    void api.snapshot().then((answer) => {
      if (mine !== sequence.current) return;
      const snapshot = answer?.snapshot ?? null;
      setView(snapshot === null ? { kind: "empty" } : { kind: "ready", snapshot });
    }).catch(() => {
      if (mine !== sequence.current) return;
      setView({ kind: "error", message: ERROR_COPY.mingpan });
    });
  }, [api, revision, seeded]);
  const backToOverview = /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { type: "button", "data-xuanshu-action": "back-overview", onClick: () => {
    navigate("overview");
  }, children: "<- 回总览" });
  const startOnboarding = /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { type: "button", "data-xuanshu-action": "start-onboarding", onClick: () => {
    navigate("onboarding");
  }, children: "开始填写出生信息 ->" });
  const goRerecord = (snapshot) => {
    controller.requestRerecord(draftFromSnapshot(snapshot));
    navigate("onboarding");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("main", { className: "xs-mingpan", "data-xuanshu-panel": MINGPAN_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("header", { className: "xs-mingpan__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h1", { children: "命盘卡详情" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(XsReadonlyBadge, {}),
      backToOverview
    ] }),
    view.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "xs-mingpan__loading", "data-xuanshu-view": "loading", children: "正在读命盘快照…" }) : null,
    view.kind === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { className: "xs-mingpan__empty", "data-xuanshu-view": "empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: "还没有命盘：出生信息还没录" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "xs-mingpan__hint", children: "命盘是只读快照：填一次出生信息就点亮了。" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "xs-mingpan__actions", children: startOnboarding })
    ] }) : null,
    view.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { className: "xs-mingpan__error", "data-xuanshu-view": "error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: "排盘失败：读不到命盘快照。下面是宿主给的原因。" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: view.message }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "xs-mingpan__hint", children: "可以先点「重试」再读一次；如果还是读不到，就去补出生信息——重录会重新出盘并原子替换底座谱。" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "xs-mingpan__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { type: "button", "data-xuanshu-action": "retry", onClick: () => {
          controller.invalidate();
        }, children: "重试" }),
        startOnboarding,
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { type: "button", "data-xuanshu-action": "rerecord", onClick: () => {
          setConfirming(true);
        }, children: "去重新录制出生信息" })
      ] })
    ] }) : null,
    view.kind === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
      MingpanBody,
      {
        snapshot: view.snapshot,
        dataDir: localDataDir,
        confirming,
        onAskRerecord: () => {
          setConfirming(true);
        },
        onCancelRerecord: () => {
          setConfirming(false);
        },
        onConfirmRerecord: () => {
          goRerecord(view.snapshot);
        }
      }
    ) : null
  ] });
}
function MingpanBody({
  snapshot,
  dataDir,
  confirming,
  onAskRerecord,
  onCancelRerecord,
  onConfirmRerecord
}) {
  const birth = snapshot.birth ?? {};
  const basis = snapshot.basis ?? {};
  const missingSections = SNAPSHOT_SECTIONS.filter((key) => snapshot[key] === void 0);
  const coords = Number.isFinite(birth.lon) && Number.isFinite(birth.lat) ? formatCoords(birth.lon, birth.lat) : "坐标缺（快照未存）";
  const timeAlg = birth.timeAlg === 1 || birth.timeAlg === 3 ? birth.timeAlg : 0;
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h2", { children: "① 出生信息" }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "xs-mingpan__summary", "data-xuanshu-summary": "birth", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { "data-xuanshu-summary": "clock", children: `${birth.date ?? "—"} ${birth.time ?? "—"} 当地时间` }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { "data-xuanshu-summary": "place", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { children: placeLabel({ place: birth.place ?? "" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "xs-mingpan__coord", children: ` ${coords}` }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { children: `　时区 ${birth.zone === void 0 || birth.zone === "" ? "—" : birth.zone}` }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { children: ` ${formatOffsetMinutes(basis.offsetMinutes)}` })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h2", { children: "② 四柱" }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "xs-mingpan__pillars", "data-xuanshu-pillars": "4", children: PILLAR_COLUMNS.map((column) => /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "xs-mingpan__pillar", "data-xuanshu-pillar": column.key, children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "xs-mingpan__pillar-name", children: column.label }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "xs-mingpan__pillar-value", children: snapshot.pillars?.[column.key] ?? "—" })
    ] }, column.key)) }),
    missingSections.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "xs-mingpan__hint", "data-xuanshu-note": "partial", children: `部分要点读不出来（${missingSections.join(" / ")}）` }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "xs-mingpan__hint", "data-xuanshu-note": "schema-scope", children: "本快照（xuanshu/bazi-snapshot@1）只存四柱与口径；藏干 / 十神 / 大运 / 其它要点不在其中（扩 schema 属后续票）。" }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h2", { children: "③ 起盘口径（只读）" }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "xs-mingpan__basis", "data-xuanshu-basis": "readonly", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { "data-xuanshu-basis": "time-alg", children: `时间算法 = ${timeAlgLabel(timeAlg)}` }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { "data-xuanshu-basis": "gender", children: [
        "性别 = ",
        genderLabel("unknown")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { "data-xuanshu-basis": "other-knobs", children: "其余旋钮 = 引擎缺省（本盘未改）" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { "data-xuanshu-basis": "two-clocks", children: `真太阳时 ${basis.trueSolar ?? "—"}　钟表时 ${basis.clock ?? "—"}　夏令时 ${basis.dst === true ? "有" : "无"}` })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h2", { children: "④ 快照来源" }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "xs-mingpan__origin", "data-xuanshu-origin": "snapshot", children: `horosa ${snapshot.horosa?.version ?? "—"} / 出盘于 ${snapshot.generatedAt === void 0 ? "—" : momentOf(snapshot.generatedAt)}` }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h2", { children: "⑤ 重新录制（唯一写操作）" }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "xs-mingpan__hint", children: "改命盘只能重新录制出生信息；本屏不出盘、不写任何文件。" }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "xs-mingpan__actions", children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { type: "button", "data-xuanshu-action": "rerecord", onClick: onAskRerecord, children: "重新录制出生信息 ->" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "xs-mingpan__confirm", "data-xuanshu-confirm": "rerecord", hidden: !confirming, children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { "data-xuanshu-confirm-text": "rerecord", children: rerecordConfirm(dataDir) }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "xs-mingpan__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { type: "button", "data-xuanshu-action": "rerecord-cancel", onClick: onCancelRerecord, children: "取消" }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { type: "button", "data-xuanshu-action": "rerecord-go", onClick: onConfirmRerecord, children: "去重新录制 ->" })
      ] })
    ] })
  ] });
}
function MingpanIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("circle", { cx: "12", cy: "12", r: "8" }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("circle", { cx: "12", cy: "12", r: "3" }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("path", { d: "M12 4v2M12 18v2M4 12h2M18 12h2" })
  ] });
}
function installMingpan(ctx, deps) {
  installBaziStyle();
  ctx.slots.inject(
    "main",
    () => ctx.slots.register(
      { name: "main", key: MINGPAN_ID, inject: () => ({ ...deps }) },
      MingpanPanel
    )
  );
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      { name: "sidebar.panellist", id: MINGPAN_ID, order: MINGPAN_ORDER, label: MINGPAN_LABEL },
      MingpanIcon
    )
  );
}

// src/client/mounts-api.ts
var MOUNTS_ENDPOINTS = { setMounts: "consult.setMounts" };
function createMountsApi(ctx) {
  return {
    async setMounts(payload) {
      return rpcCall(ctx, MOUNTS_ENDPOINTS.setMounts, payload);
    }
  };
}
function createWorkspaceCatalog(ctx) {
  const face = readService(ctx, "workspaces");
  const source = face?.list;
  if (typeof source?.getSnapshot !== "function") {
    return { list: () => [], subscribe: () => () => {
    }, available: false };
  }
  const project = (item) => {
    const id = typeof item.workspaceId === "string" ? item.workspaceId : void 0;
    const path = typeof item.path === "string" ? item.path : "";
    if (id === void 0) return void 0;
    const title = typeof item.title === "string" && item.title !== "" ? item.title : path;
    return {
      id,
      path,
      title,
      sessionCount: Array.isArray(item.sessionIds) ? item.sessionIds.length : 0,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : ""
    };
  };
  return {
    available: true,
    list() {
      let snapshot;
      try {
        snapshot = source.getSnapshot?.();
      } catch {
        return [];
      }
      const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
      return items.map(project).filter((row) => row !== void 0);
    },
    subscribe(listener) {
      try {
        return typeof source.subscribe === "function" ? source.subscribe(listener) : () => {
        };
      } catch {
        return () => {
        };
      }
    }
  };
}

// src/client/mounts.tsx
var import_react15 = require("react");

// src/client/mounts-model.ts
var MOUNT_BOUNDARY_LINE = "对象是工作区 / 工作流。谱不在这里——谱在问事面板里勾选。";
var MOUNT_DRAWER_TITLE = "临时挂载";
var MOUNT_CONFIRM_LABEL = "确认挂载到本轮";
var MOUNT_CANCEL_LABEL = "取消";
function mountKey(mount) {
  return `${mount.kind}\0${mount.id}`;
}
function toggleMount(selection, mount) {
  const key = mountKey(mount);
  const exists = selection.some((row) => mountKey(row) === key);
  if (exists) return selection.filter((row) => mountKey(row) !== key);
  return [...selection, mount];
}
function isMounted(selection, mount) {
  const key = mountKey(mount);
  return selection.some((row) => mountKey(row) === key);
}
function toMountRef(candidate) {
  return { kind: "workspace", id: candidate.id, label: candidate.title !== "" ? candidate.title : candidate.path };
}
function formatChars(value) {
  return String(Math.max(0, Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}
function layerTag(layer) {
  if (typeof layer.error === "string" && layer.error !== "") return { tone: "error", text: "读不出来" };
  if (layer.dropped) return { tone: "dropped", text: "超预算未纳入" };
  if (layer.clipped) return { tone: "clipped", text: `已裁剪 ${formatChars(layer.chars)}→${formatChars(layer.keptChars)} 字` };
  if (layer.kept) return { tone: "included", text: "纳入" };
  return { tone: "dropped", text: "超预算未纳入" };
}
function layerNote(layer) {
  if (typeof layer.error === "string" && layer.error !== "") return layer.error;
  if (layer.dropped) return layer.reason ?? "超预算未纳入 · 本次不会进入上下文";
  if (typeof layer.hint === "string" && layer.hint !== "") return layer.hint;
  return void 0;
}
function statusFromPreview(preview) {
  if (preview === void 0) return void 0;
  const keptChars = Number.isFinite(preview.keptChars) ? preview.keptChars : 0;
  const budget = preview.budget === null || preview.budget === void 0 ? null : preview.budget;
  return {
    keptChars,
    budget,
    keptLayers: preview.keptLayers,
    totalLayers: preview.totalLayers,
    overBudget: preview.truncatedChars > 0
  };
}
function statusLine(status) {
  const left = `挂载 ${formatChars(status.keptChars)} 字`;
  const right = status.budget === null ? "预算未知" : `预算 ${formatChars(status.budget)} 字`;
  const denominator = status.overBudget ? `（已纳入 ${status.keptLayers} / ${status.totalLayers} 层）` : "";
  return `${left} / ${right}${denominator}`;
}
var BUDGET_UNKNOWN_NOTE = "预算未知：拿不到当前模型的上下文窗口元数据。去 DSH 设置看模型配置（本机 rc.2 的采样参数 maxTokens 不是窗口，玄枢不会替你编一个数）。";
var WORKFLOW_EMPTY_NOTE = "工作流清单的数据源属票 16（工作流创建向导）：现在还没有可挂载的工作流，先去把工作流建出来。";
var WORKSPACE_EMPTY_NOTE = "DSH 里还没有工作区：工作区是 DSH 原有的实体，先去 DSH 的工作区界面建一个（本抽屉不提供新建入口）。";
var WORKSPACE_UNAVAILABLE_NOTE = "这台机器上没有可用的工作区面板：工作区清单读不出来，所以暂时没法挂载。换一台装全的机器再试。";
function createLayerFoldState() {
  const collapsed = /* @__PURE__ */ new Set();
  return {
    /** 用户手点：展开 ↔ 收起。 */
    toggle(layerId) {
      if (collapsed.has(layerId)) collapsed.delete(layerId);
      else collapsed.add(layerId);
    },
    /** 这一层现在是否展开（**新层默认展开**：不在「收起过」集合里就展开）。 */
    isOpen(layerId) {
      return !collapsed.has(layerId);
    },
    /** 已收起过的层 id（调试/断言用）。 */
    collapsedIds() {
      return [...collapsed].sort();
    }
  };
}
function layerRows(preview) {
  if (preview === void 0) return [];
  return preview.layers.map((layer) => ({
    layer,
    tag: layerTag(layer),
    ...layerNote(layer) === void 0 ? {} : { note: layerNote(layer) },
    keptLabels: layer.keptSegments.map((segment) => segment.label),
    droppedLabels: layer.droppedSegments.map((segment) => segment.label)
  }));
}
function mountsSummary(mounts) {
  if (mounts.length === 0) return "本次没有临时挂载（只带底座、底稿与勾选的谱）。";
  const workspaces = mounts.filter((mount) => mount.kind === "workspace").length;
  const workflows = mounts.length - workspaces;
  const parts = [];
  if (workspaces > 0) parts.push(`${String(workspaces)} 个工作区`);
  if (workflows > 0) parts.push(`${String(workflows)} 个工作流`);
  return `本次临时挂载：${parts.join(" + ")}（${mounts.map((mount) => mount.label).join("、")}）。`;
}

// src/client/mounts-controller.ts
function emptySnapshot(workspaceAvailable) {
  return {
    open: false,
    mounts: [],
    selection: [],
    busy: false,
    workspaceAvailable,
    fold: createLayerFoldState(),
    revision: 0
  };
}
function mountsFingerprint(mounts) {
  return [...mounts].map((mount) => `${mount.kind}:${mount.id}`).sort().join("|");
}
function createMountsController(options) {
  const listeners = /* @__PURE__ */ new Set();
  const fold = createLayerFoldState();
  const previews = /* @__PURE__ */ new Map();
  let snapshot = { ...emptySnapshot(options.workspaceAvailable ?? true), fold };
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const set = (patch) => {
    snapshot = { ...snapshot, ...patch };
    emit();
  };
  const fail = (error) => {
    set({ busy: false, error: String(error?.message ?? error) });
  };
  async function load(sessionId, mounts, silent = false) {
    if (!silent) set({ busy: true, error: void 0 });
    try {
      const answer = await options.api.setMounts({ sessionId, mounts: [...mounts], preview: true });
      const preview = answer.preview;
      if (preview === void 0) {
        set({ busy: false, error: "宿主没有返回预览（setMounts 的 preview 字段缺失）：这次不显示账本，避免给出没依据的数字。" });
        return;
      }
      previews.set(sessionId, { preview, fingerprint: mountsFingerprint(mounts) });
      if (silent) set({});
      else set({ busy: false, preview, error: void 0 });
    } catch (error) {
      if (silent) return;
      fail(error);
    }
  }
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => snapshot,
    open(sessionId, mounts) {
      const fingerprint = mountsFingerprint(mounts);
      const cached = previews.get(sessionId);
      set({
        open: true,
        sessionId,
        mounts: [...mounts],
        selection: [...mounts],
        error: void 0,
        preview: cached !== void 0 && cached.fingerprint === fingerprint ? cached.preview : void 0
      });
      void load(sessionId, mounts);
    },
    close() {
      set({ open: false, busy: false, error: void 0 });
    },
    toggleWorkspace(candidate) {
      const mount = toMountRef(candidate);
      const selection = toggleMount(snapshot.selection, mount);
      set({ selection, error: void 0 });
      if (snapshot.sessionId !== void 0) void load(snapshot.sessionId, selection);
    },
    fold(layerId) {
      fold.toggle(layerId);
      set({});
    },
    async refreshPreview() {
      if (snapshot.sessionId === void 0) return;
      await load(snapshot.sessionId, snapshot.selection);
    },
    async confirm() {
      const sessionId = snapshot.sessionId;
      if (sessionId === void 0) return;
      set({ busy: true, error: void 0 });
      try {
        const answer = await options.api.setMounts({ sessionId, mounts: [...snapshot.selection] });
        const mounts = Array.isArray(answer.session?.mounts) ? answer.session.mounts : snapshot.selection;
        set({ busy: false, open: false, mounts, selection: mounts, revision: snapshot.revision + 1, error: void 0 });
        await load(sessionId, mounts, true);
      } catch (error) {
        fail(error);
      }
    },
    ensurePreview(sessionId, mounts) {
      if (mounts.length === 0) return;
      const cached = previews.get(sessionId);
      if (cached !== void 0 && cached.fingerprint === mountsFingerprint(mounts)) return;
      void load(sessionId, mounts, true);
    },
    cachedPreview(sessionId) {
      return previews.get(sessionId)?.preview;
    }
  };
}

// src/client/mounts-views.tsx
var import_react14 = require("react");
var import_jsx_runtime16 = require("react/jsx-runtime");
function XsMountStatusBar({ status, budgetSource, hint }) {
  const text = status === void 0 ? hint ?? "挂载 … 字 / 预算 …" : statusLine(status);
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
    "span",
    {
      className: "xs-mounts__status",
      "data-xuanshu-mount-status": "1",
      "data-xuanshu-budget-unknown": status?.budget === null ? "1" : "0",
      title: status?.budget === null ? BUDGET_UNKNOWN_NOTE : `本次挂载的裁剪结果（来源：${budgetSource ?? "unknown"}）`,
      children: text
    }
  );
}
function XsMountSection({ mounts, status, canMount, reason, revision, onOpen }) {
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { className: "xs-mounts__section", "data-xuanshu-section": "mounts", "data-xuanshu-mounts-revision": revision === void 0 ? void 0 : String(revision), children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("header", { className: "xs-mounts__section-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h3", { children: "临时挂载" }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { type: "button", className: "xs-mounts__open", "data-xuanshu-action": "open-mounts", onClick: onOpen, disabled: !canMount || onOpen === void 0, children: "临时挂载…" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "xs-mounts__summary", "data-xuanshu-mount-summary": "1", children: mountsSummary(mounts) }),
    canMount ? null : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "mounts-need-session", children: reason ?? "先生成一次问事，再临时挂载：挂载落在那次问事的清单上。" }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(XsMountStatusBar, { status, hint: canMount ? void 0 : "挂载 0 字 / 预算 …" })
  ] });
}
function WorkspaceRow({ candidate, selected, onToggle }) {
  const when = candidate.updatedAt === "" ? "" : candidate.updatedAt.slice(0, 10);
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("li", { className: "xs-mounts__row", "data-xuanshu-mount-row": `workspace:${candidate.id}`, children: /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("input", { type: "checkbox", checked: selected, onChange: onToggle, "data-xuanshu-mount-check": candidate.id }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "xs-mounts__row-title", children: candidate.title }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "xs-mounts__row-path", children: candidate.path }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "xs-mounts__row-meta", children: `${String(candidate.sessionCount)} 个会话${when === "" ? "" : ` · 最近 ${when}`}` })
  ] }) });
}
function LayerRowView({ row, open, onToggle }) {
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("li", { className: "xs-mounts__layer", "data-xuanshu-layer": row.layer.label, "data-xuanshu-layer-tone": row.tag.tone, children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "xs-mounts__layer-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { type: "button", className: "xs-mounts__layer-toggle", "aria-expanded": open, onClick: onToggle, "data-xuanshu-action": "fold-layer", children: open ? "▾" : "▸" }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "xs-mounts__layer-name", children: row.layer.head ?? row.layer.label }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: "xs-mounts__tag", "data-xuanshu-tag": row.tag.tone, children: row.tag.text })
    ] }),
    row.note === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "xs-mounts__layer-note", "data-xuanshu-layer-note": "1", children: row.note }),
    open && row.keptLabels.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "xs-mounts__layer-kept", "data-xuanshu-layer-kept": "1", children: `保留了：${row.keptLabels.join(" · ")}（${formatChars(row.layer.keptChars)} 字）` }) : null,
    open && row.droppedLabels.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { className: "xs-mounts__layer-dropped", "data-xuanshu-layer-dropped": "1", children: [
      `裁掉的：${row.droppedLabels.slice(0, 6).join(" · ")}`,
      row.droppedLabels.length > 6 ? ` 等 ${String(row.droppedLabels.length)} 项` : ""
    ] }) : null
  ] });
}
function XsMountDrawer({
  workspaces,
  workspaceAvailable,
  selection,
  preview,
  rows,
  budgetSource,
  busy,
  error,
  canConfirm,
  foldOpen,
  onToggleWorkspace,
  onFold,
  onCancel,
  onConfirm,
  onRetry,
  onRefresh,
  gotoWorkspaces
}) {
  const [showAllNotes, setShowAllNotes] = (0, import_react14.useState)(false);
  const status = preview === void 0 ? void 0 : {
    keptChars: preview.keptChars,
    budget: preview.budget,
    keptLayers: preview.keptLayers,
    totalLayers: preview.totalLayers,
    overBudget: preview.truncatedChars > 0
  };
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "xs-mounts__overlay", "data-xuanshu-overlay": "mounts", children: /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "xs-mounts__drawer", role: "dialog", "aria-modal": "true", "aria-labelledby": "xs-mounts-title", "data-xuanshu-drawer": "mounts", children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("header", { className: "xs-mounts__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h2", { id: "xs-mounts-title", children: MOUNT_DRAWER_TITLE }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { type: "button", className: "xs-mounts__close", onClick: onCancel, disabled: busy, "data-xuanshu-action": "close-mounts", children: "关闭" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "xs-mounts__boundary", "data-xuanshu-boundary": "1", children: MOUNT_BOUNDARY_LINE }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { className: "xs-mounts__group", "data-xuanshu-group": "workspace", children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "xs-mounts__group-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h3", { children: "工作区（DSH 原有，只读引用）" }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { type: "button", className: "xs-mounts__ghost", onClick: gotoWorkspaces, "data-xuanshu-action": "goto-workspaces", children: "去 DSH 工作区界面" })
      ] }),
      !workspaceAvailable ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "workspace-unavailable", children: WORKSPACE_UNAVAILABLE_NOTE }) : workspaces.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "workspace-empty", children: WORKSPACE_EMPTY_NOTE }) : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("ul", { className: "xs-mounts__rows", children: workspaces.map((candidate) => /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
        WorkspaceRow,
        {
          candidate,
          selected: isMounted(selection, { kind: "workspace", id: candidate.id }),
          onToggle: () => {
            onToggleWorkspace(candidate);
          }
        },
        candidate.id
      )) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { className: "xs-mounts__group", "data-xuanshu-group": "workflow", children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h3", { children: "工作流" }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "workflow-empty", children: WORKFLOW_EMPTY_NOTE })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { className: "xs-mounts__group", "data-xuanshu-group": "preview", children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h3", { children: "本轮挂载上下文（预览）" }),
      error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { className: "xs-mounts__error", "data-xuanshu-error": "mounts", role: "alert", children: [
        `读不到本轮挂载的预览：${error}。请检查工作区是否还在，然后`,
        onRetry === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { type: "button", className: "xs-mounts__ghost", onClick: onRetry, children: "重试" }),
        "；还是不通就先回门厅、换个工作区再挂。"
      ] }),
      busy && preview === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "mounts-loading", children: "正在读挂载内容…" }) : null,
      rows.length === 0 && !busy ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "preview-empty", children: "还没有挂载任何对象：选上面的工作区（选入即挂载），这里会逐层列出将被注入的内容。" }) : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("ul", { className: "xs-mounts__layers", children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(LayerRowView, { row, open: foldOpen(row.layer.id), onToggle: () => {
        onFold(row.layer.id);
      } }, row.layer.id)) }),
      preview === void 0 || preview.notes.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "xs-mounts__notes", children: [
        (showAllNotes ? preview.notes : preview.notes.slice(0, 1)).map((note) => /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "clip-reason", children: note }, note)),
        preview.notes.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { type: "button", className: "xs-mounts__ghost", onClick: () => {
          setShowAllNotes((value) => !value);
        }, "data-xuanshu-action": "more-notes", children: showAllNotes ? "收起解释" : `为什么砍（${String(preview.notes.length)} 条）` }) : null,
        preview.truncatedChars > 0 ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "shrink-hint", children: "超预算的处理：整层丢弃；不会静默截断，注入时也会在提示词里注明。想都带上就缩小挂载范围。" }) : null,
        onRefresh === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { type: "button", className: "xs-mounts__ghost", onClick: onRefresh, "data-xuanshu-action": "refresh-preview", children: "重新读一遍" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("footer", { className: "xs-mounts__foot", children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(XsMountStatusBar, { status, budgetSource }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "xs-mounts__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { type: "button", onClick: onCancel, disabled: busy, "data-xuanshu-action": "cancel-mounts", children: MOUNT_CANCEL_LABEL }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { type: "button", className: "xs-mounts__primary", onClick: onConfirm, disabled: busy || !canConfirm, "data-xuanshu-action": "confirm-mounts", children: MOUNT_CONFIRM_LABEL })
      ] })
    ] })
  ] }) });
}

// src/client/mounts.tsx
var import_jsx_runtime17 = require("react/jsx-runtime");
function installMountsStyle() {
  const id = "xuanshu-mounts-style";
  registerStyleSheet("xuanshu-mounts-style", [
    ".xs-mounts__section{margin:12px 0;padding:10px;border:1px solid var(--xs-edge-card);border-radius:8px}",
    ".xs-mounts__section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
    // 说明行是正文（16px），只有 note 是元信息（13px）—— 原来一行 12px 让两者一起偏小。
    // 写成 max() 而不是字面 16px：宿主把 --dsh-content-font-size 抬到 20 时它也要跟着抬，
    // 而宿主定在 14px 时（实测值）下限仍压得住 —— 判据 C-001 量的是渲染值。
    ".xs-mounts__summary{margin:6px 0;opacity:.8;font-size:max(16px,var(--dsh-content-font-size,16px))}",
    ".xs-mounts__note{margin:6px 0;opacity:.8;font-size:13px}",
    // 状态栏是读数不是按钮（#69）：去掉 `cursor:pointer` —— 一个不接点击的读数不该摆出可点的样子。
    ".xs-mounts__status{background:none;border:0;padding:0;color:inherit;opacity:.85;font-size:12px}",
    ".xs-mounts__overlay{position:fixed;inset:0;background:var(--xs-surface-overlay-mask);display:flex;justify-content:flex-end;z-index:60}",
    ".xs-mounts__drawer{width:min(720px,92vw);height:100%;overflow:auto;background:var(--xs-surface-overlay);padding:16px;display:flex;flex-direction:column;gap:12px}",
    ".xs-mounts__head{display:flex;align-items:center;justify-content:space-between}",
    ".xs-mounts__boundary{margin:0;padding:8px;border-left:3px solid var(--xs-edge-card-strong);opacity:.9;font-size:12px}",
    ".xs-mounts__rows,.xs-mounts__layers{list-style:none;margin:6px 0;padding:0}",
    ".xs-mounts__row label{display:flex;align-items:center;gap:8px;padding:4px 0}",
    ".xs-mounts__row-path{opacity:.7;font-size:12px}",
    ".xs-mounts__row-meta{opacity:.6;font-size:12px;margin-left:auto}",
    ".xs-mounts__layer{padding:6px 0;border-bottom:1px solid var(--xs-edge-divider)}",
    ".xs-mounts__layer-head{display:flex;align-items:center;gap:8px}",
    ".xs-mounts__layer-name{flex:1}",
    ".xs-mounts__tag{font-size:12px;padding:1px 6px;border-radius:10px;border:1px solid currentColor}",
    '.xs-mounts__tag[data-xuanshu-tag="clipped"]{color:var(--xs-state-warning-fg)}',
    '.xs-mounts__tag[data-xuanshu-tag="dropped"]{color:var(--xs-state-error-fg)}',
    '.xs-mounts__tag[data-xuanshu-tag="error"]{color:var(--xs-state-error-fg)}',
    ".xs-mounts__foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;border-top:1px solid var(--xs-edge-card)}",
    ".xs-mounts__primary{font-weight:600}",
    ".xs-mounts__ghost{background:none;border:0;padding:0;color:inherit;opacity:.75;cursor:pointer;font-size:12px;text-decoration:underline}",
    ".xs-mounts__error{color:var(--xs-state-error-fg);font-size:12px}"
  ].join("\n"));
  installXuanshuStyles();
}
function MountsOverlay({ controller, workspaces, gotoWorkspaces }) {
  const state = (0, import_react15.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
  if (!state.open) return null;
  const rows = layerRows(state.preview);
  return /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
    XsMountDrawer,
    {
      workspaces: workspaces(),
      workspaceAvailable: state.workspaceAvailable,
      selection: state.selection,
      preview: state.preview,
      rows,
      budgetSource: state.preview?.budgetSource,
      busy: state.busy,
      error: state.error,
      canConfirm: state.selection.length > 0 || state.mounts.length > 0,
      foldOpen: (layerId) => state.fold.isOpen(layerId),
      onToggleWorkspace: (candidate) => {
        controller.toggleWorkspace(candidate);
      },
      onFold: (layerId) => {
        controller.fold(layerId);
      },
      onCancel: () => {
        controller.close();
      },
      onConfirm: () => {
        void controller.confirm();
      },
      onRetry: () => {
        void controller.refreshPreview();
      },
      onRefresh: () => {
        void controller.refreshPreview();
      },
      ...gotoWorkspaces === void 0 ? {} : { gotoWorkspaces }
    }
  );
}
function MountsSectionFor({ controller, session, reason }) {
  const state = (0, import_react15.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
  const mounts = session?.mounts ?? [];
  const status = session === void 0 ? void 0 : statusFromPreview(controller.cachedPreview(session.sessionId));
  return /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
    XsMountSection,
    {
      mounts,
      status,
      canMount: session !== void 0,
      revision: state.revision,
      ...reason === void 0 ? {} : { reason },
      ...session === void 0 ? {} : {
        onOpen: () => {
          controller.open(session.sessionId, mounts);
        }
      }
    }
  );
}
function createMountsController2(deps) {
  return createMountsController({
    api: deps.api,
    workspaces: deps.workspaces,
    workspaceAvailable: deps.workspaceAvailable ?? true
  });
}
function installMounts(ctx, deps) {
  installMountsStyle();
  const controller = createMountsController2(deps);
  ctx.slots.inject(
    "shell.overlay",
    () => ctx.slots.register(
      {
        name: "shell.overlay",
        id: "xuanshu-mounts-drawer",
        inject: () => ({ controller, workspaces: deps.workspaces })
      },
      MountsOverlay
    )
  );
  return controller;
}

// src/client/onboarding.tsx
var import_react17 = require("react");

// src/client/cities.ts
var CITY_DEBOUNCE_MS = 180;
var CITY_RESULT_LIMIT = 20;
var SMALL_CITIES = [
  { name: "北京", region: "中国", en: "Beijing", pinyin: "bei jing", lat: 39.9042, lon: 116.4074 },
  { name: "上海", region: "中国", en: "Shanghai", pinyin: "shang hai", lat: 31.2304, lon: 121.4737 },
  { name: "天津", region: "中国", en: "Tianjin", pinyin: "tian jin", lat: 39.3434, lon: 117.3616 },
  { name: "重庆", region: "中国", en: "Chongqing", pinyin: "chong qing", lat: 29.563, lon: 106.5516 },
  { name: "广州", region: "中国·广东", en: "Guangzhou", pinyin: "guang zhou", lat: 23.1291, lon: 113.2644 },
  { name: "深圳", region: "中国·广东", en: "Shenzhen", pinyin: "shen zhen", lat: 22.5431, lon: 114.0579 },
  { name: "成都", region: "中国·四川", en: "Chengdu", pinyin: "cheng du", lat: 30.5728, lon: 104.0668 },
  { name: "杭州", region: "中国·浙江", en: "Hangzhou", pinyin: "hang zhou", lat: 30.2741, lon: 120.1551 },
  { name: "武汉", region: "中国·湖北", en: "Wuhan", pinyin: "wu han", lat: 30.5928, lon: 114.3055 },
  { name: "西安", region: "中国·陕西", en: "Xi'an", pinyin: "xi an", lat: 34.3416, lon: 108.9398 },
  { name: "南京", region: "中国·江苏", en: "Nanjing", pinyin: "nan jing", lat: 32.0603, lon: 118.7969 },
  { name: "苏州", region: "中国·江苏", en: "Suzhou", pinyin: "su zhou", lat: 31.2989, lon: 120.5853 },
  { name: "郑州", region: "中国·河南", en: "Zhengzhou", pinyin: "zheng zhou", lat: 34.7466, lon: 113.6254 },
  { name: "长沙", region: "中国·湖南", en: "Changsha", pinyin: "chang sha", lat: 28.2282, lon: 112.9388 },
  { name: "沈阳", region: "中国·辽宁", en: "Shenyang", pinyin: "shen yang", lat: 41.8057, lon: 123.4315 },
  { name: "大连", region: "中国·辽宁", en: "Dalian", pinyin: "da lian", lat: 38.914, lon: 121.6147 },
  { name: "哈尔滨", region: "中国·黑龙江", en: "Harbin", pinyin: "ha er bin", lat: 45.8038, lon: 126.5349 },
  { name: "长春", region: "中国·吉林", en: "Changchun", pinyin: "chang chun", lat: 43.8171, lon: 125.3235 },
  { name: "济南", region: "中国·山东", en: "Jinan", pinyin: "ji nan", lat: 36.6512, lon: 117.1201 },
  { name: "青岛", region: "中国·山东", en: "Qingdao", pinyin: "qing dao", lat: 36.0671, lon: 120.3826 },
  { name: "石家庄", region: "中国·河北", en: "Shijiazhuang", pinyin: "shi jia zhuang", lat: 38.0428, lon: 114.5149 },
  { name: "太原", region: "中国·山西", en: "Taiyuan", pinyin: "tai yuan", lat: 37.8706, lon: 112.5489 },
  { name: "合肥", region: "中国·安徽", en: "Hefei", pinyin: "he fei", lat: 31.8206, lon: 117.229 },
  { name: "福州", region: "中国·福建", en: "Fuzhou", pinyin: "fu zhou", lat: 26.0745, lon: 119.2965 },
  { name: "厦门", region: "中国·福建", en: "Xiamen", pinyin: "xia men", lat: 24.4798, lon: 118.0894 },
  { name: "南昌", region: "中国·江西", en: "Nanchang", pinyin: "nan chang", lat: 28.682, lon: 115.8579 },
  { name: "昆明", region: "中国·云南", en: "Kunming", pinyin: "kun ming", lat: 25.0389, lon: 102.7183 },
  { name: "贵阳", region: "中国·贵州", en: "Guiyang", pinyin: "gui yang", lat: 26.647, lon: 106.6302 },
  { name: "南宁", region: "中国·广西", en: "Nanning", pinyin: "nan ning", lat: 22.817, lon: 108.3665 },
  { name: "海口", region: "中国·海南", en: "Haikou", pinyin: "hai kou", lat: 20.0444, lon: 110.1989 },
  { name: "兰州", region: "中国·甘肃", en: "Lanzhou", pinyin: "lan zhou", lat: 36.0611, lon: 103.8343 },
  { name: "西宁", region: "中国·青海", en: "Xining", pinyin: "xi ning", lat: 36.6171, lon: 101.7782 },
  { name: "银川", region: "中国·宁夏", en: "Yinchuan", pinyin: "yin chuan", lat: 38.4872, lon: 106.2309 },
  { name: "乌鲁木齐", region: "中国·新疆", en: "Urumqi", pinyin: "wu lu mu qi", lat: 43.8256, lon: 87.6168 },
  { name: "呼和浩特", region: "中国·内蒙古", en: "Hohhot", pinyin: "hu he hao te", lat: 40.8426, lon: 111.7492 },
  { name: "拉萨", region: "中国·西藏", en: "Lhasa", pinyin: "la sa", lat: 29.652, lon: 91.1721 },
  { name: "香港", region: "中国", en: "Hong Kong", pinyin: "xiang gang", lat: 22.3193, lon: 114.1694 },
  { name: "澳门", region: "中国", en: "Macau", pinyin: "ao men", lat: 22.1987, lon: 113.5439 },
  { name: "台北", region: "中国·台湾", en: "Taipei", pinyin: "tai bei", lat: 25.033, lon: 121.5654 },
  { name: "高雄", region: "中国·台湾", en: "Kaohsiung", pinyin: "gao xiong", lat: 22.6273, lon: 120.3014 },
  { name: "温州", region: "中国·浙江", en: "Wenzhou", pinyin: "wen zhou", lat: 27.9939, lon: 120.6994 },
  { name: "宁波", region: "中国·浙江", en: "Ningbo", pinyin: "ning bo", lat: 29.8683, lon: 121.544 },
  { name: "无锡", region: "中国·江苏", en: "Wuxi", pinyin: "wu xi", lat: 31.4912, lon: 120.3119 },
  { name: "东莞", region: "中国·广东", en: "Dongguan", pinyin: "dong guan", lat: 23.0207, lon: 113.7518 },
  { name: "佛山", region: "中国·广东", en: "Foshan", pinyin: "fo shan", lat: 23.0218, lon: 113.1219 },
  { name: "泉州", region: "中国·福建", en: "Quanzhou", pinyin: "quan zhou", lat: 24.8741, lon: 118.6757 },
  { name: "东京", region: "日本", en: "Tokyo", pinyin: "dong jing", lat: 35.6762, lon: 139.6503 },
  { name: "大阪", region: "日本", en: "Osaka", pinyin: "da ban", lat: 34.6937, lon: 135.5023 },
  { name: "京都", region: "日本", en: "Kyoto", pinyin: "jing dou", lat: 35.0116, lon: 135.7681 },
  { name: "首尔", region: "韩国", en: "Seoul", pinyin: "shou er", lat: 37.5665, lon: 126.978 },
  { name: "釜山", region: "韩国", en: "Busan", pinyin: "fu shan", lat: 35.1796, lon: 129.0756 },
  { name: "新加坡", region: "新加坡", en: "Singapore", pinyin: "xin jia po", lat: 1.3521, lon: 103.8198 },
  { name: "吉隆坡", region: "马来西亚", en: "Kuala Lumpur", pinyin: "ji long po", lat: 3.139, lon: 101.6869 },
  { name: "曼谷", region: "泰国", en: "Bangkok", pinyin: "man gu", lat: 13.7563, lon: 100.5018 },
  { name: "雅加达", region: "印尼", en: "Jakarta", pinyin: "ya jia da", lat: -6.2088, lon: 106.8456 },
  { name: "马尼拉", region: "菲律宾", en: "Manila", pinyin: "ma ni la", lat: 14.5995, lon: 120.9842 },
  { name: "河内", region: "越南", en: "Hanoi", pinyin: "he nei", lat: 21.0278, lon: 105.8342 },
  { name: "胡志明市", region: "越南", en: "Ho Chi Minh City", pinyin: "hu zhi ming shi", lat: 10.8231, lon: 106.6297 },
  { name: "新德里", region: "印度", en: "New Delhi", pinyin: "xin de li", lat: 28.6139, lon: 77.209 },
  { name: "孟买", region: "印度", en: "Mumbai", pinyin: "meng mai", lat: 19.076, lon: 72.8777 },
  { name: "迪拜", region: "阿联酋", en: "Dubai", pinyin: "di bai", lat: 25.2048, lon: 55.2708 },
  { name: "伊斯坦布尔", region: "土耳其", en: "Istanbul", pinyin: "yi si tan bu er", lat: 41.0082, lon: 28.9784 },
  { name: "莫斯科", region: "俄罗斯", en: "Moscow", pinyin: "mo si ke", lat: 55.7558, lon: 37.6173 },
  { name: "伦敦", region: "英国", en: "London", pinyin: "lun dun", lat: 51.5074, lon: -0.1278 },
  { name: "巴黎", region: "法国", en: "Paris", pinyin: "ba li", lat: 48.8566, lon: 2.3522 },
  { name: "柏林", region: "德国", en: "Berlin", pinyin: "bo lin", lat: 52.52, lon: 13.405 },
  { name: "汉堡", region: "德国", en: "Hamburg", pinyin: "han bao", lat: 53.5511, lon: 9.9937 },
  { name: "慕尼黑", region: "德国", en: "Munich", pinyin: "mu ni hei", lat: 48.1351, lon: 11.582 },
  { name: "罗马", region: "意大利", en: "Rome", pinyin: "luo ma", lat: 41.9028, lon: 12.4964 },
  { name: "马德里", region: "西班牙", en: "Madrid", pinyin: "ma de li", lat: 40.4168, lon: -3.7038 },
  { name: "巴塞罗那", region: "西班牙", en: "Barcelona", pinyin: "ba sai luo na", lat: 41.3851, lon: 2.1734 },
  { name: "阿姆斯特丹", region: "荷兰", en: "Amsterdam", pinyin: "a mu si te dan", lat: 52.3676, lon: 4.9041 },
  { name: "苏黎世", region: "瑞士", en: "Zurich", pinyin: "su li shi", lat: 47.3769, lon: 8.5417 },
  { name: "维也纳", region: "奥地利", en: "Vienna", pinyin: "wei ye na", lat: 48.2082, lon: 16.3738 },
  { name: "雅典", region: "希腊", en: "Athens", pinyin: "ya dian", lat: 37.9838, lon: 23.7275 },
  { name: "斯德哥尔摩", region: "瑞典", en: "Stockholm", pinyin: "si de ge er mo", lat: 59.3293, lon: 18.0686 },
  { name: "纽约", region: "美国", en: "New York", pinyin: "niu yue", lat: 40.7128, lon: -74.006 },
  { name: "洛杉矶", region: "美国", en: "Los Angeles", pinyin: "luo shan ji", lat: 34.0522, lon: -118.2437 },
  { name: "旧金山", region: "美国", en: "San Francisco", pinyin: "jiu jin shan", lat: 37.7749, lon: -122.4194 },
  { name: "芝加哥", region: "美国", en: "Chicago", pinyin: "zhi jia ge", lat: 41.8781, lon: -87.6298 },
  { name: "华盛顿", region: "美国", en: "Washington D.C.", pinyin: "hua sheng dun", lat: 38.9072, lon: -77.0369 },
  { name: "西雅图", region: "美国", en: "Seattle", pinyin: "xi ya tu", lat: 47.6062, lon: -122.3321 },
  { name: "波士顿", region: "美国", en: "Boston", pinyin: "bo shi dun", lat: 42.3601, lon: -71.0589 },
  { name: "拉斯维加斯", region: "美国", en: "Las Vegas", pinyin: "la si wei jia si", lat: 36.1699, lon: -115.1398 },
  { name: "多伦多", region: "加拿大", en: "Toronto", pinyin: "duo lun duo", lat: 43.6532, lon: -79.3832 },
  { name: "温哥华", region: "加拿大", en: "Vancouver", pinyin: "wen ge hua", lat: 49.2827, lon: -123.1207 },
  { name: "墨西哥城", region: "墨西哥", en: "Mexico City", pinyin: "mo xi ge cheng", lat: 19.4326, lon: -99.1332 },
  { name: "圣保罗", region: "巴西", en: "Sao Paulo", pinyin: "sheng bao luo", lat: -23.5505, lon: -46.6333 },
  { name: "里约热内卢", region: "巴西", en: "Rio de Janeiro", pinyin: "li yue re nei lu", lat: -22.9068, lon: -43.1729 },
  { name: "布宜诺斯艾利斯", region: "阿根廷", en: "Buenos Aires", pinyin: "bu yi nuo si ai li si", lat: -34.6037, lon: -58.3816 },
  { name: "悉尼", region: "澳大利亚", en: "Sydney", pinyin: "xi ni", lat: -33.8688, lon: 151.2093 },
  { name: "墨尔本", region: "澳大利亚", en: "Melbourne", pinyin: "mo er ben", lat: -37.8136, lon: 144.9631 },
  { name: "奥克兰", region: "新西兰", en: "Auckland", pinyin: "ao ke lan", lat: -36.8485, lon: 174.7633 },
  { name: "开罗", region: "埃及", en: "Cairo", pinyin: "kai luo", lat: 30.0444, lon: 31.2357 },
  { name: "约翰内斯堡", region: "南非", en: "Johannesburg", pinyin: "yue han nei si bao", lat: -26.2041, lon: 28.0473 },
  { name: "内罗毕", region: "肯尼亚", en: "Nairobi", pinyin: "nei luo bi", lat: -1.2921, lon: 36.8219 }
];
function matchScore(city, query, compact) {
  const name = city.name.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  const pinyin = city.pinyin.replace(/\s+/g, "");
  const initials = city.pinyin.split(/\s+/).map((word) => word.charAt(0)).join("");
  if (pinyin.startsWith(compact) || initials.startsWith(compact) || (city.en ?? "").toLowerCase().split(/[\s.]+/).filter((word) => word !== "").some((word) => word.startsWith(query)) || city.region.toLowerCase().includes(query)) {
    return 3;
  }
  return null;
}
function searchCities(query, extra = [], limit = CITY_RESULT_LIMIT) {
  const trimmed = query.trim();
  if (trimmed === "") return SMALL_CITIES.slice(0, limit);
  const lowered = trimmed.toLowerCase();
  const compact = lowered.replace(/\s+/g, "");
  const seen = /* @__PURE__ */ new Set();
  const candidates = [];
  for (const city of [...SMALL_CITIES, ...extra]) {
    if (seen.has(city.name)) continue;
    seen.add(city.name);
    candidates.push(city);
  }
  return candidates.map((city) => ({ city, score: matchScore(city, lowered, compact) })).filter((row) => row.score !== null).sort((a, b) => a.score - b.score).slice(0, limit).map((row) => row.city);
}
function createCityQuery(options) {
  const limit = options.limit ?? CITY_RESULT_LIMIT;
  const delayMs = options.delayMs ?? CITY_DEBOUNCE_MS;
  const listeners = /* @__PURE__ */ new Set();
  let state = {
    query: "",
    items: searchCities("", [], limit),
    pending: false,
    fullFailed: false
  };
  let sequence = 0;
  let timer;
  let inflight;
  const publish = (next) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const cancelPending = () => {
    if (timer !== void 0) {
      clearTimeout(timer);
      timer = void 0;
    }
    inflight?.abort();
    inflight = void 0;
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setQuery(query) {
      if (query === state.query) return;
      cancelPending();
      const trimmed = query.trim();
      const immediate = searchCities(trimmed, [], limit);
      if (trimmed === "") {
        publish({ query, items: immediate, pending: false, fullFailed: false });
        return;
      }
      publish({ query, items: immediate, pending: true, fullFailed: false });
      const mine = ++sequence;
      timer = setTimeout(() => {
        timer = void 0;
        const controller = new AbortController();
        inflight = controller;
        void options.loadFull(trimmed, controller.signal).then((items) => {
          if (mine !== sequence) return;
          inflight = void 0;
          publish({
            query: state.query,
            items: searchCities(trimmed, items, limit),
            pending: false,
            fullFailed: false
          });
        }).catch(() => {
          if (mine !== sequence) return;
          inflight = void 0;
          publish({ query: state.query, items: state.items, pending: false, fullFailed: true });
        });
      }, delayMs);
    },
    dispose() {
      cancelPending();
      sequence += 1;
      listeners.clear();
    }
  };
}

// src/client/onboarding-steps.tsx
var import_react16 = require("react");
var import_jsx_runtime18 = require("react/jsx-runtime");
var STEP_TITLES = [
  "出生日期与钟表时间",
  "出生地（必填：缺经纬度不能出盘）",
  "时区（随出生地自动推导，含 DST）",
  "起盘口径",
  "确认你的出生信息",
  // #29：冷启动从「八字 → 就绪」变成「八字 → 接上 AI → 就绪」。
  // 放在最后一步而不是新开一块面板：不新增 main key / 侧栏行，注册面零变化。
  "接上 AI"
];
var STEP_SHORT = ["时间", "出生地", "时区", "口径", "确认", "接 AI"];
var STEP_COUNT = STEP_TITLES.length;
var AI_STEP = STEP_COUNT;
function XsStepBar({ step }) {
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("nav", { className: "xs-wizard__steps", "aria-label": "向导步骤", "data-xuanshu-stepbar": String(step), children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__progress", children: `第 ${String(step)} / ${String(STEP_COUNT)} 步` }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("ol", { className: "xs-wizard__step-list", children: STEP_TITLES.map((title, index) => {
      const number = index + 1;
      const state = number < step ? "done" : number === step ? "current" : "todo";
      return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
        "li",
        {
          className: `xs-wizard__step xs-wizard__step--${state}`,
          "data-xuanshu-step": String(number),
          "data-xs-current": number === step ? "true" : void 0,
          "data-xs-state": state,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__step-index", children: String(number) }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__step-name", children: STEP_SHORT[index] })
          ]
        },
        title
      );
    }) })
  ] });
}
function StepShell({ step, title, hint, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("section", { className: "xs-wizard__step-body", "data-xs-step": String(step), children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("header", { className: "xs-wizard__step-head", children: /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h2", { children: `第 ${String(step)} / ${String(STEP_COUNT)} 步 · ${title}` }) }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "xs-wizard__cols", children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: "xs-wizard__form", children }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("aside", { className: "xs-wizard__aside", children: hint })
    ] })
  ] });
}
function XsTimeStep({ draft, onChange, onNudge, onNow }) {
  const [grain, setGrain] = (0, import_react16.useState)("fourMinute");
  const empty = draft.date.trim() === "" || draft.time.trim() === "";
  const activeLabel = NUDGE_GRAINS.find((row) => row.id === grain)?.label ?? "四分钟";
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
    StepShell,
    {
      step: 1,
      title: STEP_TITLES[0],
      hint: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 公历即可；农历换算由底座做。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 「当地时间」是固定小字：你填的是钟表时间，不是真太阳时。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 微调粒度里的「四分钟」= 1° 经度时差，与真太阳时的换算粒度同源。" })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "xs-wizard__field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: "① 日期" }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
            "input",
            {
              type: "date",
              "data-xuanshu-field": "birth-date",
              value: draft.date,
              onChange: (event) => {
                onChange({ date: event.target.value });
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("small", { className: "xs-wizard__note", "data-xuanshu-note": "date-format", children: "格式如 1990-05-20" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "xs-wizard__field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: "② 时间" }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
            "input",
            {
              type: "time",
              "data-xuanshu-field": "birth-time",
              value: draft.time,
              onChange: (event) => {
                onChange({ time: event.target.value });
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("small", { className: "xs-wizard__note", "data-xuanshu-note": "local-clock", children: "当地时间" })
        ] }),
        empty ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__hint", "data-xuanshu-hint": "need-birth", children: "先填出生信息：日期与时刻都填上才能往下走（时刻填当地时间即可）。" }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "xs-wizard__nudge", "data-xuanshu-nudge": "grains", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: "③ 内联微调" }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "nudge-minus", onClick: () => {
            onNudge(grain, -1);
          }, children: "[-]" }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__nudge-grains", children: NUDGE_GRAINS.map((row) => /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
            "button",
            {
              type: "button",
              className: row.id === grain ? "xs-chip xs-chip--on" : "xs-chip",
              "data-xuanshu-grain": row.id,
              "data-xs-active": row.id === grain ? "true" : void 0,
              onClick: () => {
                setGrain(row.id);
              },
              children: row.label
            },
            row.id
          )) }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "nudge-plus", onClick: () => {
            onNudge(grain, 1);
          }, children: "[+]" }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "nudge-now", onClick: onNow, children: "此刻" }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "nudge-apply", onClick: () => {
            onNudge(grain, 0);
          }, children: "确定" }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("small", { className: "xs-wizard__note", children: `当前粒度：${activeLabel}` })
        ] })
      ]
    }
  );
}
function XsPlaceStep({ draft, query, results, manualHint, onQuery, onPick, onManual }) {
  const [lonText, setLonText] = (0, import_react16.useState)("");
  const [latText, setLatText] = (0, import_react16.useState)("");
  const missing = missingCoordinates(draft);
  const searching = query.trim() !== "";
  const noMatch = searching && results.items.length === 0;
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
    StepShell,
    {
      step: 2,
      title: STEP_TITLES[1],
      hint: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 断网可用：小库随程序自带，即时出结果。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 有输入后 180ms 才去问大库；大库不在（没装 / 被裁掉）就静默只用小库。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 选城市即带出经纬度；海外与小地名走手输坐标。" })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "① 通道 A — 离线城市库（推荐）" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "xs-wizard__field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: "搜索城市 / 区县" }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
            "input",
            {
              type: "text",
              "data-xuanshu-field": "city-search",
              placeholder: "搜索城市 / 区县 ...",
              value: query,
              onChange: (event) => {
                onQuery(event.target.value);
              }
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("ul", { className: "xs-wizard__cities", "data-xuanshu-cities": String(results.items.length), children: results.items.map((city) => /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("li", { "data-xuanshu-city": city.name, children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__city-name", children: city.name }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__city-region", children: city.region }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "pick-city", onClick: () => {
            onPick(city);
          }, children: "选中" })
        ] }, city.name)) }),
        searching && results.pending ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-note": "city-pending", children: "正在搜更大的城市库（小库结果已经在上面了）…" }) : null,
        noMatch ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__hint", "data-xuanshu-note": "city-no-match", children: "无匹配城市，可改用手输经纬度" }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "② 通道 B — 手输经纬度（GPS 十进制）" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "xs-wizard__manual", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "xs-wizard__field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: "经度（-180 ~ 180）" }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
              "input",
              {
                type: "text",
                inputMode: "decimal",
                "data-xuanshu-field": "manual-lon",
                placeholder: "118.78",
                value: lonText,
                onChange: (event) => {
                  setLonText(event.target.value);
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "xs-wizard__field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: "纬度（-90 ~ 90）" }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
              "input",
              {
                type: "text",
                inputMode: "decimal",
                "data-xuanshu-field": "manual-lat",
                placeholder: "32.06",
                value: latText,
                onChange: (event) => {
                  setLatText(event.target.value);
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "apply-manual", onClick: () => {
            onManual(lonText, latText);
          }, children: "应用" })
        ] }),
        manualHint === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__hint", "data-xuanshu-note": "manual-rejected", children: manualHint }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "③ 地名与坐标（同框可见）" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("p", { className: "xs-wizard__place", "data-xuanshu-place": placeLabel(draft), children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__place-name", children: placeLabel(draft) }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__place-coord", "data-xuanshu-coord": "frame", children: missing.length === 0 && draft.lon !== void 0 && draft.lat !== void 0 ? formatCoords(draft.lon, draft.lat) : `还没定（缺 ${missing.join(" / ")}）` }),
          draft.place.trim() === "" ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("small", { className: "xs-wizard__note", children: [
            "手输无地名时据实显示「",
            UNNAMED_PLACE,
            "」，不留旧地名"
          ] }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__status", "data-xuanshu-note": "has-coords", children: `当前：${missing.length === 0 ? "有经纬度" : `无经纬度（缺 ${missing.join(" / ")}）`}` }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "④ 地图选点" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-note": "no-map", children: "地图选点：玄枢 v1 不做（无联网依赖）" })
      ]
    }
  );
}
function XsZoneStep({ draft, zone, pending, onZone, onAuto }) {
  const unresolved = zone !== void 0 && zone.zone === null;
  const autoZone = zone?.zone ?? "";
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
    StepShell,
    {
      step: 3,
      title: STEP_TITLES[2],
      hint: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 依据：经纬度 + 出生日期（客户端不自己算时区，一律问底座）。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 自动结果只归并 IANA 名，不写死偏移；夏令时由底座判。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 中国大陆统一北京时间：只把 `Asia/Urumqi` 并入 `Asia/Shanghai`，偏移仍按 IANA 算。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 时区只负责「钟表时间 → UTC」的偏移归一；真太阳时换算在引擎里，录入层不换算。" })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "① 自动结果" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "xs-wizard__zone-auto", "data-xuanshu-zone": "auto", children: [
          pending === true ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-zone": "pending", children: "重算中…" }) : zone === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__note", children: "先在第 2 步定下出生地，这里会自动推导。" }) : autoZone === "" ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__hint", "data-xuanshu-zone": "unresolved", children: "自动推导失败（坐标越界或该点查不到时区）：请在下面手动指定一个 UTC 偏移，否则不能出盘。" }) : /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("p", { className: "xs-wizard__zone-value", "data-xuanshu-zone": "resolved", children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("strong", { children: autoZone }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: formatOffsetMinutes(zone.offsetMinutes) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__note", children: `夏令时：${zone.dst === true ? "有" : "无"}` })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__note", children: "依据：经纬度 + 出生日期" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "② 手动覆盖（仅当自动不对）" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "xs-wizard__zone-manual", "data-xuanshu-zone": "manual", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "xs-wizard__field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: "固定 UTC 偏移（28 档）" }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
              "select",
              {
                "data-xuanshu-field": "zone-override",
                value: draft.zoneManual ? draft.zone : "",
                onChange: (event) => {
                  onZone(event.target.value);
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("option", { value: "", children: "跟随自动结果" }),
                  ZONE_OFFSETS.map((row) => /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("option", { value: row.value, children: `${row.value} ${row.label}` }, row.value))
                ]
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
            "button",
            {
              type: "button",
              "data-xuanshu-action": "zone-auto",
              disabled: !draft.zoneManual,
              title: draft.zoneManual ? void 0 : "还没手改过，[自动] 没有可清除的东西",
              onClick: onAuto,
              children: "自动"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-note": "zone-current", children: draft.zoneManual ? `当前：手动指定 ${draft.zone}` : `当前：自动结果 ${draft.zone === "" ? "（未定）" : draft.zone}` })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "③ 时区只负责一步" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-note": "zone-boundary", children: "时区只负责「钟表时间 → UTC」的偏移归一；真太阳时换算在引擎里，录入层不换算。" })
      ]
    }
  );
}
function XsTimeAlgStep({ draft, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
    StepShell,
    {
      step: 4,
      title: STEP_TITLES[3],
      hint: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 默认档 = 0（真太阳时）：实现上省略该键，不写默认值。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 「春分定卯时（= 2）」上游自身未实现 —— 界面上不出现，也不置灰。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 换算发生在引擎内部：录入层不换算（界面上没有「真太阳时修正」开关，找不到是设计）。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 其余旋钮玄枢不给：长生 / 神煞 / 晚子时 / 命宫 / 月律分野 / 流派 / 显示区（索引 D4）。" })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "① 时间算法（timeAlg）" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: "xs-wizard__radio-group", "data-xuanshu-field": "time-alg", children: TIME_ALG_OPTIONS.map((option) => /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "xs-wizard__radio", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
            "input",
            {
              type: "radio",
              name: "time-alg",
              value: option.value,
              checked: draft.timeAlg === option.value,
              "data-xuanshu-radio": `time-alg-${String(option.value)}`,
              onChange: () => {
                onChange({ timeAlg: option.value });
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: option.label }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("small", { className: "xs-wizard__note", children: option.hint })
        ] }, option.value)) }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "② 性别（排大运用）" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: "xs-wizard__radio-group", "data-xuanshu-field": "gender", children: GENDER_OPTIONS.map((option) => /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "xs-wizard__radio", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
            "input",
            {
              type: "radio",
              name: "gender",
              value: option.value,
              checked: draft.gender === option.value,
              "data-xuanshu-radio": `gender-${option.value}`,
              onChange: () => {
                onChange({ gender: option.value });
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: option.label }),
          option.hint === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("small", { className: "xs-wizard__note", children: option.hint })
        ] }, option.value)) }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "③ 其余旋钮" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-note": "no-other-knobs", children: "一律由引擎缺省决定，界面不出现：长生 / 神煞查法 / 晚子时四态 / 命宫起法 / 月律分野 / 南半球月令 / 起运精度 / 藏干版本 / 生肖归属 / 断命流派 / 显示区。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "④ 换算发生在哪一层" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-note": "no-conversion-here", children: "引擎内部；录入层不换算。" })
      ]
    }
  );
}
function XsConfirmStep({
  draft,
  zone,
  gate,
  busy = false,
  gateAnswer = "",
  onEdit,
  onToggleNote,
  onToggleVerified,
  onGateAnswer,
  onCast,
  onAnswerGate,
  onGotoPlace,
  onGotoManual
}) {
  const blockers = castBlockers(draft);
  const coordinates = missingCoordinates(draft);
  const others = blockers.filter((blocker) => blocker !== "coordinates");
  const ready = blockers.length === 0;
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
    StepShell,
    {
      step: 5,
      title: STEP_TITLES[4],
      hint: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 五项逐行核对，每行 `[改]` 回跳对应步。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 「不确定项」把「只知道大概」显式化，写进 `clarification_notes`（不是拒绝出盘）。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ `[x] 以上信息我已核对` 是出盘的解锁条件；底座回问就地展开，回答后重出盘。" })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("fieldset", { className: "xs-wizard__confirm", "data-xuanshu-busy": busy ? "cast" : void 0, disabled: busy, children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("legend", { children: "① 确认你的出生信息" }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("ul", { className: "xs-wizard__confirm-list", children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("li", { "data-xuanshu-confirm": "time", children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__confirm-label", children: "出生时间" }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__confirm-value", children: `${draft.date === "" ? "（未填）" : draft.date} ${draft.time === "" ? "（未填）" : draft.time} 当地时间` }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "edit-step-1", onClick: () => {
                onEdit(1);
              }, children: "改" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("li", { "data-xuanshu-confirm": "place", children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__confirm-label", children: "出生地" }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__confirm-value", children: `${placeLabel(draft)} ${coordinates.length === 0 && draft.lon !== void 0 && draft.lat !== void 0 ? formatCoords(draft.lon, draft.lat) : `（缺 ${coordinates.join(" / ")}）`}` }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "edit-step-2", onClick: () => {
                onEdit(2);
              }, children: "改" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("li", { "data-xuanshu-confirm": "zone", children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__confirm-label", children: "时区" }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__confirm-value", children: `${draft.zone === "" ? "（未定）" : draft.zone}${draft.zoneManual ? "（手动指定）" : "（自动）"}${zone?.dst === true && !draft.zoneManual ? "，已判 DST" : ""}` }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "edit-step-3", onClick: () => {
                onEdit(3);
              }, children: "改" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("li", { "data-xuanshu-confirm": "timeAlg", children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__confirm-label", children: "时间算法" }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__confirm-value", children: `${timeAlgLabel(draft.timeAlg)}${draft.timeAlg === 0 ? "（缺省省略 = 0）" : ` = ${String(draft.timeAlg)}`}` }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "edit-step-4", onClick: () => {
                onEdit(4);
              }, children: "改" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("li", { "data-xuanshu-confirm": "gender", children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__confirm-label", children: "性别" }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__confirm-value", children: genderLabel(draft.gender) }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "edit-step-4", onClick: () => {
                onEdit(4);
              }, children: "改" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "② 不确定项 → clarification_notes" }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: "xs-wizard__notes", children: NOTE_OPTIONS.map((option) => /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "xs-wizard__check", children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
              "input",
              {
                type: "checkbox",
                "data-xuanshu-field": `note-${option.id}`,
                checked: draft.notes.includes(option.id),
                onChange: () => {
                  onToggleNote(option.id);
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: option.label })
          ] }, option.id)) }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "③ 澄清闸" }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "xs-wizard__check", children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
              "input",
              {
                type: "checkbox",
                "data-xuanshu-field": "verified",
                checked: draft.verified,
                onChange: onToggleVerified
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: "以上信息我已核对" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__note", children: "勾选后才解锁出盘；底座若回问，会在这里就地展开（拦截期间不落谱、不点亮命盘卡）。" }),
          gate === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "xs-wizard__gate", "data-xuanshu-gate": "prompt", role: "alert", children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: "底座需要你确认" }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__gate-prompt", "data-xuanshu-gate": "prompt-text", children: gate.promptToUser }),
            gate.questions.map((question) => /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__gate-question", "data-xuanshu-gate": "question", children: question }, question)),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "xs-wizard__field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: "你的回答（随 clarification_notes 一起给底座）" }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
                "textarea",
                {
                  "data-xuanshu-field": "gate-answer",
                  value: gateAnswer,
                  onChange: (event) => {
                    onGateAnswer?.(event.target.value);
                  }
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "xs-wizard__actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
                "button",
                {
                  type: "button",
                  "data-xuanshu-action": "answer-gate",
                  disabled: busy || gateAnswer.trim() === "",
                  onClick: onAnswerGate,
                  children: "回答并重新出盘"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "edit-birth", onClick: () => {
                onEdit(1);
              }, children: "改出生信息" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "xs-wizard__cast", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
            "button",
            {
              type: "button",
              className: "xs-btn xs-btn--primary",
              "data-xuanshu-action": "cast",
              disabled: busy || !ready,
              onClick: onCast,
              children: busy ? "出盘中…" : "确认并出盘"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { className: "xs-wizard__status", "data-xuanshu-status": ready ? "ready" : "blocked", children: ready ? "可出盘" : coordinates.length > 0 ? "缺经纬度（禁用）" : "信息未齐（禁用）" })
        ] }),
        ready ? null : /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "xs-wizard__reason", "data-xuanshu-reason": "cast-disabled", children: [
          coordinates.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__reason-main", children: CAST_MISSING_REASON }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "xs-wizard__actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "goto-place", onClick: onGotoPlace, children: "去填出生地" }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", "data-xuanshu-action": "goto-manual", onClick: onGotoManual, children: "改用手输经纬度" })
            ] })
          ] }),
          others.map((blocker) => /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-wizard__reason-row", "data-xuanshu-reason-row": blocker, children: CAST_BLOCK_REASON[blocker] }, blocker))
        ] })
      ]
    }
  );
}
function XsAiStep({
  readiness,
  checking,
  onRetry,
  onOpenSettings,
  onFinish,
  onSkip,
  onProbe
}) {
  const configured = readiness?.configured === true;
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
    StepShell,
    {
      step: AI_STEP,
      title: STEP_TITLES[5],
      hint: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 问事要一家已注册的 provider + 一个默认模型；玄枢只读检测，不替你写配置与密钥。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 去 DSH「设置 → 模型」配置；配完点「重试」即可，不用重启玄枢。" }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: "▸ 跳过不会让问事入口变可用：未接上时入口仍禁用，并指向「设置 → 模型」。" })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
          XsAiReadiness,
          {
            ...readiness === void 0 ? {} : { readiness },
            checking: checking === true,
            onRetry,
            ...onOpenSettings === void 0 ? {} : { onOpenSettings },
            onFinish,
            onSkip,
            ...onProbe === void 0 ? {} : { onProbe }
          }
        ),
        configured ? null : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "xs-ai__note", "data-xuanshu-ai-skip": "missing", children: "跳过后问事入口仍禁用，并指向「设置 → 模型」——随时可以在总览或向导里重新检测。" })
      ]
    }
  );
}

// src/client/onboarding.tsx
var import_jsx_runtime19 = require("react/jsx-runtime");
var MANUAL_REJECTED_HINT = "经纬度不合法，已忽略（经度在前，例如 118.78 / 32.06）";
var WIZARD_CANCEL_CONFIRM = "刚填的出生信息还没落盘，取消就没了。确定放弃？";
function useCityQuery(api, query) {
  const controller = (0, import_react17.useMemo)(
    () => createCityQuery({
      // 失败**不在这里吞**：让 `bazi.cities` 的拒绝走到调度器里，由它静默回落小库。
      loadFull: (keyword, signal) => api.cities({ query: keyword, limit: CITY_RESULT_LIMIT }, signal).then((result) => result.items)
    }),
    [api]
  );
  (0, import_react17.useEffect)(() => {
    controller.setQuery(query);
  }, [controller, query]);
  (0, import_react17.useEffect)(() => () => {
    controller.dispose();
  }, [controller]);
  return (0, import_react17.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
function OnboardingPanel({ api, controller, navigate, preloadedDraft, aiStatus, onOpenAiSettings }) {
  const [draft, setDraft] = (0, import_react17.useState)(() => preloadedDraft ?? defaultDraft());
  const [step, setStep] = (0, import_react17.useState)(1);
  const [query, setQuery] = (0, import_react17.useState)("");
  const [zone, setZone] = (0, import_react17.useState)(void 0);
  const [zonePending, setZonePending] = (0, import_react17.useState)(false);
  const [manualHint, setManualHint] = (0, import_react17.useState)(void 0);
  const [gateAnswer, setGateAnswer] = (0, import_react17.useState)("");
  const [result, setResult] = (0, import_react17.useState)(void 0);
  const [busy, setBusy] = (0, import_react17.useState)(false);
  const [confirmingCancel, setConfirmingCancel] = (0, import_react17.useState)(false);
  const castSequence = (0, import_react17.useRef)(0);
  const zoneSequence = (0, import_react17.useRef)(0);
  const aiSnapshot = useAiReadiness(aiStatus);
  const cityResults = useCityQuery(api, query);
  const patch = (next) => {
    setDraft((current) => ({ ...current, ...next }));
  };
  (0, import_react17.useEffect)(() => {
    const prefill = controller.consumePrefill();
    if (prefill === void 0) return;
    setDraft(prefill);
    setStep(1);
    setResult(void 0);
    setGateAnswer("");
  }, [controller]);
  const { lon, lat, date, time, zoneManual } = draft;
  (0, import_react17.useEffect)(() => {
    if (zoneManual) return;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || date.trim() === "") {
      setZone(void 0);
      setZonePending(false);
      return;
    }
    const mine = ++zoneSequence.current;
    setZonePending(true);
    void api.timezone({ lat, lon, date, time: time === "" ? void 0 : time }).then((answer) => {
      if (mine !== zoneSequence.current) return;
      setZone(answer);
      setZonePending(false);
      patch({ zone: answer.zone ?? "" });
    }).catch(() => {
      if (mine !== zoneSequence.current) return;
      setZone({ zone: null, offsetMinutes: null, dst: null });
      setZonePending(false);
      patch({ zone: "" });
    });
  }, [api, lon, lat, date, time, zoneManual]);
  const gotoStep = (target) => {
    setStep(Math.min(STEP_COUNT, Math.max(1, target)));
  };
  const pickCity = (city) => {
    setManualHint(void 0);
    patch({ place: city.name, lon: city.lon, lat: city.lat });
  };
  const applyManual = (lonText, latText) => {
    const point = manualLocation(lonText, latText);
    if (point === void 0) {
      setManualHint(MANUAL_REJECTED_HINT);
      return;
    }
    setManualHint(void 0);
    patch({ place: "", lon: point.lon, lat: point.lat });
  };
  const nudge = (grain, delta) => {
    if (delta === 0) return;
    const next = nudgeDateTime(draft.date, draft.time, grain, delta);
    patch({ date: next.date, time: next.time });
  };
  const useNow = () => {
    patch(nowStamp());
  };
  const cancel = () => {
    setDraft(defaultDraft());
    setStep(1);
    setResult(void 0);
    setGateAnswer("");
    navigate("overview");
  };
  const filled = (() => {
    if (step > 1) return true;
    const d = draft;
    return (d.date ?? "") !== "" || (d.time ?? "") !== "" || (d.birthplace ?? "") !== "";
  })();
  const leaveAiStep = () => {
    setDraft(defaultDraft());
    setStep(1);
    setResult(void 0);
    setGateAnswer("");
    navigate("overview");
  };
  const cast = (answer) => {
    const source = answer === void 0 ? draft : { ...draft, gateAnswer: answer };
    const request = buildCastRequest(source);
    if (request === void 0) return;
    const mine = ++castSequence.current;
    setBusy(true);
    setResult(void 0);
    void api.cast(request).then((answer2) => {
      if (mine !== castSequence.current) return;
      setResult(answer2);
      setBusy(false);
      if (answer2.phase !== "ok") return;
      controller.invalidate();
      setStep(AI_STEP);
    }).catch((error) => {
      if (mine !== castSequence.current) return;
      setResult({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      setBusy(false);
    });
  };
  const gate = result?.phase === "gate" ? result.gate : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("main", { className: "xs-wizard", "data-xuanshu-panel": ONBOARDING_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("header", { className: "xs-wizard__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("h1", { children: "八字冷启动向导" }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: "xs-wizard__note", children: "填一次出生信息 → 出盘 → 落底座谱 → 点亮命盘卡，之后不再重复录入。" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(XsStepBar, { step }),
    step === 1 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(XsTimeStep, { draft, onChange: patch, onNudge: nudge, onNow: useNow }) : null,
    step === 2 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
      XsPlaceStep,
      {
        draft,
        query,
        results: cityResults,
        manualHint,
        onQuery: setQuery,
        onPick: pickCity,
        onManual: applyManual
      }
    ) : null,
    step === 3 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
      XsZoneStep,
      {
        draft,
        zone,
        pending: zonePending,
        onZone: (value) => {
          patch({ zone: value, zoneManual: value !== "" });
        },
        onAuto: () => {
          patch({ zoneManual: false, zone: "" });
        }
      }
    ) : null,
    step === 4 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(XsTimeAlgStep, { draft, onChange: patch }) : null,
    step === 5 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
      XsConfirmStep,
      {
        draft,
        zone,
        gate,
        busy,
        gateAnswer,
        onEdit: gotoStep,
        onToggleNote: (id) => {
          patch({ notes: draft.notes.includes(id) ? draft.notes.filter((row) => row !== id) : [...draft.notes, id] });
        },
        onToggleVerified: () => {
          patch({ verified: !draft.verified });
        },
        onGateAnswer: setGateAnswer,
        onCast: () => {
          cast();
        },
        onAnswerGate: () => {
          cast(gateAnswer);
        },
        onGotoPlace: () => {
          gotoStep(2);
        },
        onGotoManual: () => {
          gotoStep(2);
        }
      }
    ) : null,
    step === AI_STEP ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
      XsAiStep,
      {
        ...aiSnapshot?.readiness === void 0 ? {} : { readiness: aiSnapshot.readiness },
        checking: aiSnapshot?.checking === true,
        ...aiStatus === void 0 ? {} : { onRetry: () => {
          void aiStatus.refresh();
        } },
        ...onOpenAiSettings === void 0 ? {} : { onOpenSettings: onOpenAiSettings },
        onProbe: async () => rpcCall({}, "ai.probe"),
        onFinish: leaveAiStep,
        onSkip: leaveAiStep
      }
    ) : null,
    result === void 0 || result.phase === "gate" ? null : /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)(
      "div",
      {
        className: "xs-wizard__cast-result",
        "data-xuanshu-cast": result.phase,
        role: result.phase === "ok" ? "status" : "alert",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { children: result.message }),
          result.phase === "ok" ? null : /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "xs-wizard__actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", "data-xuanshu-action": "cast-retry", onClick: () => {
              cast();
            }, children: "重试" }),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", "data-xuanshu-action": "cast-edit", onClick: () => {
              gotoStep(1);
            }, children: "改出生信息" })
          ] })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("footer", { className: "xs-wizard__footer", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", "data-xuanshu-action": "prev", disabled: step === 1, onClick: () => {
        gotoStep(step - 1);
      }, children: "<- 上一步" }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", "data-xuanshu-action": "next", disabled: step === STEP_COUNT, onClick: () => {
        gotoStep(step + 1);
      }, children: "下一步 ->" }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: "xs-wizard__spacer" }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
        "button",
        {
          type: "button",
          "data-xuanshu-action": "cancel",
          onClick: () => {
            if (filled) setConfirmingCancel(true);
            else cancel();
          },
          children: "取消向导"
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "xs-wizard__confirm", "data-xuanshu-confirm": "cancel", hidden: !confirmingCancel, children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { "data-xuanshu-confirm-text": "cancel", children: WIZARD_CANCEL_CONFIRM }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "xs-wizard__footer", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("button", { type: "button", "data-xuanshu-action": "cancel-dismiss", onClick: () => {
          setConfirmingCancel(false);
        }, children: "继续填" }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
          "button",
          {
            type: "button",
            "data-xuanshu-action": "cancel-confirm",
            onClick: () => {
              setConfirmingCancel(false);
              cancel();
            },
            children: "放弃并离开"
          }
        )
      ] })
    ] })
  ] });
}
function OnboardingIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("path", { d: "M4 20h16" }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("path", { d: "M6 20V9.5L12 4l6 5.5V20" }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("path", { d: "M9.5 20v-5h5v5" })
  ] });
}
function installOnboarding(ctx, deps) {
  installBaziStyle();
  ctx.slots.inject(
    "main",
    () => ctx.slots.register(
      { name: "main", key: ONBOARDING_ID, inject: () => ({ ...deps }) },
      OnboardingPanel
    )
  );
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      { name: "sidebar.panellist", id: ONBOARDING_ID, order: ONBOARDING_ORDER, label: ONBOARDING_LABEL },
      OnboardingIcon
    )
  );
}

// src/client/overview-hash.ts
var OVERVIEW_HASH = "xuanshu-overview";
function isOverviewHash(hash) {
  return hash === `#${OVERVIEW_HASH}`;
}
function createOverviewHashBridge({
  location,
  selectPanel,
  listenOn
}) {
  let started = false;
  const target = listenOn ?? location;
  const handle = () => {
    if (!isOverviewHash(location.hash)) return;
    selectPanel("overview");
    try {
      location.hash = "";
    } catch {
    }
  };
  return {
    /**
     * 安装：立即检查一次 + 订阅 hashchange。
     */
    start() {
      if (started) return;
      started = true;
      target.addEventListener("hashchange", handle);
      handle();
    },
    /** 卸载（幂等）。 */
    stop() {
      if (!started) return;
      started = false;
      target.removeEventListener("hashchange", handle);
    },
    /** 纯处理（测试可直接点它，不必经过事件）。 */
    handle
  };
}
function installOverviewHashBridge(ctx, options = {}) {
  const target = options.window ?? (typeof globalThis.window === "undefined" ? void 0 : globalThis.window);
  if (target === void 0 || target.location === void 0) return void 0;
  const listenOn = typeof target.addEventListener === "function" ? target : void 0;
  const bridge = createOverviewHashBridge({
    location: target.location,
    selectPanel: (id) => {
      ctx.layout.selectPanel(id);
    },
    ...listenOn === void 0 ? {} : { listenOn }
  });
  bridge.start();
  return () => {
    bridge.stop();
  };
}

// src/client/OverviewIcon.tsx
var import_jsx_runtime20 = require("react/jsx-runtime");
function OverviewIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "xs-overview-icon", "data-xuanshu-panel": PANEL_ID, children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(GlyphOverview, { className: "xs-overview-icon__glyph", size }) });
}

// src/client/OverviewPanel.tsx
var import_react18 = require("react");
var import_jsx_runtime21 = require("react/jsx-runtime");
function localDate(now = /* @__PURE__ */ new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
var NO_CONTROLLER = {
  subscribe: () => () => {
  },
  getRevision: () => 0
};
function destinyFromSnapshot(snapshot) {
  return {
    pillars: {
      year: snapshot?.pillars?.year ?? "—",
      month: snapshot?.pillars?.month ?? "—",
      day: snapshot?.pillars?.day ?? "—",
      hour: snapshot?.pillars?.hour ?? "—"
    },
    // `basis.trueSolar` / `clock` 拿不到时**省略该键**（契约 §1：绝不自己算一个假值），
    // 卡面按「—」显示：看得见「这一项没有」，而不是一个编出来的时间。
    basis: {
      trueSolar: snapshot?.basis?.trueSolar ?? "—",
      clock: snapshot?.basis?.clock ?? "—"
    }
  };
}
function destinyStateFromStatus(status) {
  if (status.state === "ready" && status.snapshot !== void 0) {
    return { state: "ready", snapshot: destinyFromSnapshot(status.snapshot) };
  }
  if (status.state === "ready") return { state: "error" };
  return { state: status.state === "error" ? "error" : "empty" };
}
function useBaziStatus(options) {
  const { api, controller, preloaded } = options;
  const active = controller ?? NO_CONTROLLER;
  const revision = (0, import_react18.useSyncExternalStore)(active.subscribe, active.getRevision, active.getRevision);
  const [status, setStatus] = (0, import_react18.useState)(
    preloaded ?? (api === void 0 ? { state: "empty" } : void 0)
  );
  (0, import_react18.useEffect)(() => {
    if (preloaded !== void 0) {
      setStatus(preloaded);
      return;
    }
    if (api === void 0) {
      setStatus({ state: "empty" });
      return;
    }
    let alive = true;
    void api.status().then((answer) => {
      if (alive) setStatus(answer);
    }).catch((error) => {
      if (alive) {
        setStatus({ state: "error", reason: error instanceof Error ? error.message : ERROR_COPY.mingpan });
      }
    });
    return () => {
      alive = false;
    };
  }, [api, preloaded, revision]);
  if (status === void 0) return { state: "loading" };
  return { ...destinyStateFromStatus(status), reason: status.reason };
}
function rikkeStateFromStatus(status, outcome) {
  const extras = {
    ...status.ai === void 0 ? {} : { ai: status.ai },
    ...status.unread === void 0 ? {} : { unread: status.unread },
    ...status.notify === void 0 ? {} : { notify: status.notify }
  };
  const base = { content: status.content, date: status.date, ...extras };
  if (outcome?.ok === false) {
    return { state: "error", ...base, reason: outcome.reason };
  }
  if (status.exists !== true) return { state: "empty", ...base, reason: void 0 };
  if (status.content === void 0) {
    return { state: "error", ...base, reason: "当日日课文件在，但内容没读回来（content 缺失）。" };
  }
  return { state: "ready", ...base, reason: void 0 };
}
function digaoStateFromStatus(status, outcome) {
  const summary = status.meta === null ? void 0 : {
    segments: status.meta.segments ?? 0,
    sources: status.meta.sources ?? 0,
    ...status.meta.generatedAt === void 0 ? {} : { updatedAt: status.meta.generatedAt }
  };
  if (outcome?.ok === false) return { state: "error", summary, reason: outcome.reason };
  if (status.exists !== true) return { state: "empty", summary, reason: void 0 };
  if (status.meta === null) {
    return { state: "error", summary, reason: "底稿文件在，但元数据没读回来（meta 缺失）。" };
  }
  return { state: "ready", summary, reason: void 0 };
}
function useRikkeStatus(options) {
  const { api, controller, preloaded, preloadedOutcome } = options;
  const active = controller ?? NO_RIKKE_CONTROLLER;
  const revision = (0, import_react18.useSyncExternalStore)(active.subscribe, active.getRevision, active.getRevision);
  const [status, setStatus] = (0, import_react18.useState)(
    preloaded ?? (api === void 0 ? { date: "", exists: false } : void 0)
  );
  (0, import_react18.useEffect)(() => {
    if (preloaded !== void 0) {
      setStatus(preloaded);
      return;
    }
    if (api === void 0) {
      setStatus({ date: "", exists: false });
      return;
    }
    let alive = true;
    void api.status().then((answer) => {
      if (alive) setStatus(answer);
    }).catch((error) => {
      if (alive) setStatus({ date: "", exists: false, reason: error instanceof Error ? error.message : ERROR_COPY.rike });
    });
    return () => {
      alive = false;
    };
  }, [api, preloaded, revision]);
  const outcome = preloadedOutcome ?? active.getOutcome();
  if (status === void 0) return { state: "loading" };
  const mapped = rikkeStateFromStatus(status, outcome);
  return status.reason === void 0 ? mapped : { ...mapped, state: "error", reason: status.reason };
}
function useDigaoStatus(options) {
  const { api, controller, preloaded, preloadedOutcome } = options;
  const active = controller ?? NO_DIGAO_CONTROLLER;
  const revision = (0, import_react18.useSyncExternalStore)(active.subscribe, active.getRevision, active.getRevision);
  const [status, setStatus] = (0, import_react18.useState)(
    preloaded ?? (api === void 0 ? { exists: false, meta: null } : void 0)
  );
  (0, import_react18.useEffect)(() => {
    if (preloaded !== void 0) {
      setStatus(preloaded);
      return;
    }
    if (api === void 0) {
      setStatus({ exists: false, meta: null });
      return;
    }
    let alive = true;
    void api.status().then((answer) => {
      if (alive) setStatus(answer);
    }).catch((error) => {
      if (alive) {
        setStatus({
          exists: false,
          meta: null,
          reason: error instanceof Error ? error.message : ERROR_COPY.digao
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [api, preloaded, revision]);
  const outcome = preloadedOutcome ?? active.getOutcome();
  if (status === void 0) return { state: "loading" };
  const mapped = digaoStateFromStatus(status, outcome);
  return status.reason === void 0 ? mapped : { ...mapped, state: "error", reason: status.reason };
}
var NO_RIKKE_CONTROLLER = {
  subscribe: () => () => {
  },
  getRevision: () => 0,
  getOutcome: () => void 0
};
var NO_WANSHENG_CONTROLLER = {
  subscribe: () => () => {
  },
  getRevision: () => 0,
  getOutcome: () => void 0
};
function wanshengStateFromStatus(status, outcome) {
  const extras = {
    ...status.facts === void 0 ? {} : { facts: status.facts },
    ...status.missed === void 0 ? {} : { missed: status.missed },
    ...status.unread === void 0 ? {} : { unread: status.unread },
    ...status.notify === void 0 ? {} : { notify: status.notify }
  };
  const base = { date: status.date, ...extras };
  if (outcome?.ok === false) return { state: "error", ...base, reason: outcome.reason };
  if (status.exists !== true) return { state: "empty", ...base, reason: void 0 };
  if (status.facts === void 0) {
    return { state: "error", ...base, reason: "晚省产物在，但当天事实没读回来（facts 缺失）。" };
  }
  return { state: "ready", ...base, reason: void 0 };
}
function useWanshengStatus(options) {
  const { api, controller, preloaded, preloadedOutcome } = options;
  const active = controller ?? NO_WANSHENG_CONTROLLER;
  const revision = (0, import_react18.useSyncExternalStore)(active.subscribe, active.getRevision, active.getRevision);
  const [status, setStatus] = (0, import_react18.useState)(
    preloaded ?? (api === void 0 ? { date: "", exists: false } : void 0)
  );
  (0, import_react18.useEffect)(() => {
    if (preloaded !== void 0) {
      setStatus(preloaded);
      return;
    }
    if (api === void 0) {
      setStatus({ date: "", exists: false });
      return;
    }
    let alive = true;
    void api.status().then((answer) => {
      if (alive) setStatus(answer);
    }).catch((error) => {
      if (alive) {
        setStatus({ date: "", exists: false, reason: error instanceof Error ? error.message : ERROR_COPY.wansheng });
      }
    });
    return () => {
      alive = false;
    };
  }, [api, preloaded, revision]);
  const outcome = preloadedOutcome ?? active.getOutcome();
  if (status === void 0) return { state: "loading" };
  const mapped = wanshengStateFromStatus(status, outcome);
  return status.reason === void 0 ? mapped : { ...mapped, state: "error", reason: status.reason };
}
var NO_DIGAO_CONTROLLER = {
  subscribe: () => () => {
  },
  getRevision: () => 0,
  getOutcome: () => void 0
};
function OverviewPanel({
  navigate,
  mainPanels,
  bazi,
  baziController,
  preloadedBaziStatus,
  rikke,
  rikkeController,
  digao,
  digaoController,
  wansheng,
  wanshengController,
  preloadedRikkeStatus,
  preloadedRikkeOutcome,
  preloadedDigaoStatus,
  preloadedDigaoOutcome,
  preloadedWanshengStatus,
  preloadedWanshengOutcome,
  today,
  dataDir,
  homePaths,
  baseplateReady,
  onStartOnboarding,
  onOpenDetail,
  onGenerate,
  onRefresh,
  onRetry,
  aiStatus,
  onOpenAiSettings
}) {
  const date = today ?? localDate();
  const injectedHomePaths = useHomePaths(homePaths);
  const localDataDir = dataDir ?? injectedHomePaths.dataDir;
  const destiny = useBaziStatus({ api: bazi, controller: baziController, preloaded: preloadedBaziStatus });
  const rikkeState = useRikkeStatus({
    api: rikke,
    controller: rikkeController,
    preloaded: preloadedRikkeStatus,
    preloadedOutcome: preloadedRikkeOutcome
  });
  const digaoState = useDigaoStatus({
    api: digao,
    controller: digaoController,
    preloaded: preloadedDigaoStatus,
    preloadedOutcome: preloadedDigaoOutcome
  });
  const wanshengState = useWanshengStatus({
    api: wansheng,
    controller: wanshengController,
    preloaded: preloadedWanshengStatus,
    preloadedOutcome: preloadedWanshengOutcome
  });
  const baseplate = baseplateReady ?? destiny.state === "ready";
  const aiSnapshot = useAiReadiness(aiStatus);
  const generateRikke = () => {
    navigate("rikke");
  };
  const refreshDigao = digaoController === void 0 ? onRefresh : () => {
    void digaoController.refresh();
  };
  const generateWansheng = () => {
    navigate("wansheng");
  };
  const retryRikke = rikkeController === void 0 ? onRetry : () => {
    rikkeController.clearOutcome();
  };
  const retryDigao = digaoController === void 0 ? onRetry : () => {
    digaoController.clearOutcome();
  };
  const retryWansheng = wanshengController === void 0 ? onRetry : () => {
    wanshengController.clearOutcome();
  };
  const injected = {
    navigate,
    mainPanels,
    onStartOnboarding,
    onOpenDetail,
    onGenerate: generateRikke,
    onRefresh: refreshDigao,
    onRetry
  };
  return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "xs-overview", "data-xuanshu-panel": PANEL_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("header", { className: "xs-overview__header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("h1", { className: "xs-overview__title", children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: "xs-overview__home", children: PANEL_HOME }),
        " · ",
        PANEL_TITLE
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("p", { className: "xs-overview__localnote", "data-xuanshu-note": "local-data", children: panelLocalNote(localDataDir) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "xs-overview__grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(XsDestinyCard, { state: destiny.state, snapshot: destiny.snapshot, ...injected }),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
        XsRikkeCard,
        {
          state: rikkeState.state,
          today: rikkeState.date === void 0 || rikkeState.date === "" ? date : rikkeState.date,
          content: rikkeState.content,
          reason: rikkeState.reason,
          ai: rikkeState.ai,
          unread: rikkeState.unread,
          notify: rikkeState.notify,
          ...injected,
          onRetry: retryRikke
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
        XsDigaoCard,
        {
          state: digaoState.state,
          summary: digaoState.summary,
          reason: digaoState.reason,
          baseplateEstablished: baseplate,
          ...injected,
          onRetry: retryDigao
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
        XsQuickLinks,
        {
          baseplateReady: baseplate,
          navigate,
          mainPanels,
          ...aiSnapshot?.readiness === void 0 ? {} : { aiReadiness: aiSnapshot.readiness },
          checking: aiSnapshot?.checking === true,
          ...aiStatus === void 0 ? {} : { onRetryAi: () => {
            void aiStatus.refresh();
          } },
          ...onOpenAiSettings === void 0 ? {} : { onOpenAiSettings }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
        XsWanshengCard,
        {
          state: wanshengState.state,
          today: wanshengState.date === void 0 || wanshengState.date === "" ? date : wanshengState.date,
          facts: wanshengState.facts,
          missed: wanshengState.missed,
          unread: wanshengState.unread,
          notify: wanshengState.notify,
          reason: wanshengState.reason,
          ...injected,
          onGenerate: generateWansheng,
          onRetry: retryWansheng
        }
      )
    ] })
  ] });
}

// src/client/rikke-api.ts
var RIKKE_ENDPOINTS = {
  status: "rikke.status",
  generate: "rikke.generate",
  setTime: "rikke.setTime",
  settingsGet: "rikke.settings.get",
  settingsSet: "rikke.settings.set"
};
function createRikkeApi(ctx) {
  return {
    status: (payload, signal) => rpcCall(ctx, RIKKE_ENDPOINTS.status, payload ?? {}, signal),
    generate: (payload, signal) => rpcCall(ctx, RIKKE_ENDPOINTS.generate, payload ?? {}, signal),
    setTime: (payload, signal) => rpcCall(ctx, RIKKE_ENDPOINTS.setTime, payload, signal),
    getSettings: (signal) => rpcCall(ctx, RIKKE_ENDPOINTS.settingsGet, {}, signal),
    setSettings: (payload, signal) => rpcCall(ctx, RIKKE_ENDPOINTS.settingsSet, payload, signal)
  };
}

// src/client/rikke-controller.ts
function errorText5(error) {
  return error instanceof Error ? error.message : String(error);
}
function createRikkeUiController(api) {
  let revision = 0;
  let outcome;
  let running;
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const settle = (answer) => {
    const next = { ok: answer?.ok === true };
    if (answer?.date !== void 0) next.date = answer.date;
    if (next.ok !== true) {
      next.reason = answer?.reason ?? "日课生成失败：宿主没有给出理由。";
    }
    outcome = next;
    return next;
  };
  return {
    getRevision: () => revision,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getOutcome: () => outcome,
    clearOutcome() {
      outcome = void 0;
      revision += 1;
      notify();
    },
    generate(date) {
      if (running !== void 0) return running;
      running = api.generate(date === void 0 ? {} : { date }).then(settle).catch((error) => {
        outcome = { ok: false, reason: errorText5(error) };
        return outcome;
      }).then((answer) => {
        running = void 0;
        revision += 1;
        notify();
        return answer;
      });
      return running;
    },
    async setTime(time) {
      const answer = await api.setTime({ time });
      revision += 1;
      notify();
      return answer;
    }
  };
}

// src/client/rikke.tsx
var import_react19 = require("react");

// src/client/rikke-style.ts
function installRikkeStyle() {
  registerStyleSheet("xs-rikke-style", `
.xs-rikke{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-rikke h1,.xs-rikke h2{font-weight:600}.xs-rikke h1{font-size:1.15rem}.xs-rikke h2{font-size:1rem;margin:18px 0 6px}
.xs-rikke__head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.xs-rikke__basis,.xs-rikke__note{line-height:1.8}
.xs-rikke__note{color:var(--xs-text-secondary);font-size:.85rem}
.xs-rikke__no-network{color:var(--xs-text-body)}
.xs-rikke__actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
.xs-rikke button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
/* 2026-11-02：晚省复用本表（installRikkeStyle），但原来这里一条 xs-wansheng 规则都没有，
   于是晚省动作行的按钮是浏览器默认样式，和日课长得不一样。照日课的写法补齐。 */
.xs-wansheng__actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
.xs-wansheng button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-wansheng button:disabled{opacity:.55;cursor:default}
.xs-rikke button:disabled{opacity:.5;cursor:not-allowed}
.xs-rikke input[type=time]{font:inherit;color:inherit;background:var(--xs-surface-card);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:6px}
.xs-rikke__time-edit{border:1px solid var(--xs-constraint-human-gate-fg,var(--xs-edge-card));border-radius:var(--xs-radius-card);padding:10px;margin:8px 0}
.xs-rikke__confirm{border:1px solid var(--xs-constraint-human-gate-fg,var(--xs-edge-card));border-radius:var(--xs-radius-card);padding:10px;margin:8px 0}
.xs-rikke__alert{padding:10px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);margin:8px 0}
@media(max-width: ${BREAKPOINT_WIDE_PX}px){.xs-rikke{padding:16px}}
`);
  installXuanshuStyles();
}

// src/client/rikke.tsx
var import_jsx_runtime22 = require("react/jsx-runtime");
var RIKKE_NO_NETWORK_NOTE = "不联网取外部资讯：本次内容只用底座 + 上面的时间基准。";
var RIKKE_REGENERATE_CONFIRM = "将覆盖今天的日课，继续？";
function RikkeAiSection({ ai }) {
  const view = rikkeAiView(ai);
  if (view.kind === "none") return null;
  return /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { className: "xs-rikke__ai", "data-xuanshu-ai": view.kind, children: [
    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h2", { className: "xs-rikke__ai-title", children: "今天注意什么" }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "xs-rikke__ai-body", children: view.text })
  ] });
}
function errorText6(error) {
  return error instanceof Error ? error.message : String(error);
}
function initialView2(preloaded) {
  if (preloaded === void 0) return { kind: "loading" };
  if ("error" in preloaded) return { kind: "error", message: preloaded.error };
  if (preloaded.exists !== true) return { kind: "empty", status: preloaded };
  if (preloaded.content === void 0) {
    return { kind: "error", message: "当日日课文件在，但内容没读回来（content 缺失）。", status: preloaded };
  }
  return { kind: "ready", status: preloaded };
}
function RikkePanel({ api, navigate, notify, preloaded, preloadedTimeEdit, preloadedHistory }) {
  const seeded = preloaded !== void 0;
  const [view, setView] = (0, import_react19.useState)(() => initialView2(preloaded));
  const [busy, setBusy] = (0, import_react19.useState)(false);
  const [confirming, setConfirming] = (0, import_react19.useState)(false);
  const [editing, setEditing] = (0, import_react19.useState)(preloadedTimeEdit === true);
  const [timeDraft, setTimeDraft] = (0, import_react19.useState)(
    () => clockOf(preloaded !== void 0 && !("error" in preloaded) ? preloaded.schedule?.time : void 0)
  );
  const [note, setNote] = (0, import_react19.useState)(void 0);
  const sequence = (0, import_react19.useRef)(0);
  const load = () => {
    const mine = ++sequence.current;
    void api.status().then((status2) => {
      if (mine !== sequence.current) return;
      setView(initialView2(status2));
      setTimeDraft(clockOf(status2.schedule?.time));
    }).catch((error) => {
      if (mine !== sequence.current) return;
      setView({ kind: "error", message: errorText6(error) });
    });
  };
  (0, import_react19.useEffect)(() => {
    if (seeded) return;
    load();
  }, [api, seeded]);
  (0, import_react19.useEffect)(() => {
    if (seeded || notify === void 0) return;
    void notify.markDeliveredRead({ kind: "rikke" }).catch(() => {
    });
  }, [notify, seeded]);
  const generate = () => {
    setConfirming(false);
    setBusy(true);
    setNote(void 0);
    const mine = ++sequence.current;
    void api.generate().then(async (answer) => {
      if (mine !== sequence.current) return;
      if (answer?.ok !== true) {
        setView({
          kind: "error",
          message: answer?.reason ?? "日课生成失败：宿主没有给出理由。",
          ...view.kind === "ready" ? { status: view.status } : {}
        });
        return;
      }
      const status2 = await api.status();
      if (mine !== sequence.current) return;
      setView(initialView2(status2));
      setTimeDraft(clockOf(status2.schedule?.time));
    }).catch((error) => {
      if (mine !== sequence.current) return;
      setView({ kind: "error", message: errorText6(error) });
    }).finally(() => {
      if (mine === sequence.current) setBusy(false);
    });
  };
  const saveTime = () => {
    if (timeDraft === "") return;
    setBusy(true);
    setNote(void 0);
    void api.setTime({ time: timeDraft }).then((answer) => {
      setNote(`已改时刻：每天 ${clockOf(answer.schedule.time)}（${answer.schedule.timeZone}）`);
      setEditing(false);
    }).catch((error) => {
      setNote(`改时刻失败：${errorText6(error)}`);
    }).finally(() => {
      setBusy(false);
    });
  };
  const status = view.kind === "empty" || view.kind === "ready" ? view.status : view.kind === "error" ? view.status : void 0;
  const date = status?.date ?? "—";
  const schedule = status?.schedule;
  const content = status?.content;
  const openGenerate = view.kind === "empty" ? "立即生成（今天）" : "重新生成（今天）";
  return /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("main", { className: "xs-rikke", "data-xuanshu-panel": RIKKE_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("header", { className: "xs-rikke__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h1", { children: `日课 · ${date}` }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "xs-rikke__note", "data-xuanshu-state": view.kind, children: view.kind === "ready" ? "今日日课已到" : view.kind === "empty" ? "今天还没有生成日课" : view.kind === "error" ? "生成失败" : "正在读日课…" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "xs-rikke__basis", "data-xuanshu-note": "time-basis", children: `时间基准：${date} ${status?.generatedAt === void 0 ? "（生成时刻读不到）" : momentOf(status.generatedAt)} · ${status?.zone ?? "（时区读不到）"} · 本机时钟` }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "xs-rikke__basis xs-rikke__no-network", "data-xuanshu-note": "no-network", children: RIKKE_NO_NETWORK_NOTE }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "xs-rikke__note", "data-xuanshu-note": "schedule", children: schedule === void 0 ? "计划时刻：暂时读不到（在「自动化任务」面板里看这条 daily 任务）" : `计划时刻：每天 ${clockOf(schedule.time)}（${schedule.timeZone}）· 可在「自动化任务」面板里改或停用` }),
    status?.huangli === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "xs-rikke__note", "data-xuanshu-note": "engine", children: `黄历引擎：${status.huangli.tool ?? "huangli"} ${status.huangli.version ?? "（版本读不到）"}（本地，不联网）` }),
    status?.generatedAt === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "xs-rikke__note", "data-xuanshu-note": "generated-at", children: `生成于 ${momentOf(status.generatedAt)}` }),
    view.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "xs-rikke__note", "data-xuanshu-view": "loading", children: "正在读今天的日课…" }) : null,
    view.kind === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { className: "xs-rikke__empty", "data-xuanshu-view": "empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { children: EMPTY_COPY.rike.why }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "xs-rikke__note", children: EMPTY_COPY.rike.sub })
    ] }) : null,
    view.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { className: "xs-rikke__alert", "data-xuanshu-view": "error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { "data-xuanshu-reason": "generate", children: view.message }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "xs-rikke__actions", children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
        "button",
        {
          type: "button",
          "data-xuanshu-action": "retry",
          onClick: () => {
            load();
          },
          children: "重试"
        }
      ) })
    ] }) : null,
    content === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "xs-lines", "data-xuanshu-content": "rikke", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("p", { className: "xs-line", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "xs-line__label", children: "宜" }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "xs-line__value", children: content.yi })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("p", { className: "xs-line", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "xs-line__label", children: "忌" }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "xs-line__value", children: content.ji })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("p", { className: "xs-line", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "xs-line__label", children: "流日" }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "xs-line__value", children: content.liuri })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(RikkeAiSection, { ai: status?.ai }),
    status?.unread !== void 0 && status.unread > 0 ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "xs-rikke__note", "data-xuanshu-note": "unread", children: `未读 ${status.unread} 条日课通知` }) : null,
    status?.notify?.status === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
      "p",
      {
        className: "xs-rikke__alert",
        role: "alert",
        "data-xuanshu-notify": "failed",
        "data-xuanshu-reason-code": notifyReasonCode(status.notify),
        children: `上一次通知没发出去：${notifyFailureText(status.notify)}`
      }
    ) : null,
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "xs-rikke__actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
        "button",
        {
          type: "button",
          className: "xs-btn xs-btn--primary",
          "data-xuanshu-action": "generate-rikke",
          disabled: busy,
          onClick: () => {
            setConfirming(true);
          },
          children: busy ? "生成中…" : openGenerate
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
        "button",
        {
          type: "button",
          "data-xuanshu-action": "edit-time",
          onClick: () => {
            setEditing(!editing);
          },
          children: "改时刻"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
        "button",
        {
          type: "button",
          "data-xuanshu-nav": "schedules",
          onClick: () => {
            navigate("schedules");
          },
          children: "打开自动化任务面板"
        }
      )
    ] }),
    note === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "xs-rikke__note", role: "status", "data-xuanshu-note": "time-result", children: note }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "xs-rikke__confirm", "data-xuanshu-confirm": "regenerate", hidden: !confirming, children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { "data-xuanshu-confirm-text": "regenerate", children: RIKKE_REGENERATE_CONFIRM }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "xs-rikke__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
          "button",
          {
            type: "button",
            "data-xuanshu-action": "regenerate-cancel",
            onClick: () => {
              setConfirming(false);
            },
            children: "取消"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("button", { type: "button", "data-xuanshu-action": "regenerate-go", onClick: generate, children: "继续生成 ->" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "xs-rikke__time-edit", "data-xuanshu-time-edit": "rikke", hidden: !editing, children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("label", { children: [
        "日课时刻",
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
          "input",
          {
            type: "time",
            value: timeDraft,
            onChange: (event) => {
              setTimeDraft(event.target.value);
            }
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "xs-rikke__note", children: `时区 ${schedule?.timeZone ?? "（读不到）"}（IANA，不手改）` }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "xs-rikke__actions", children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("button", { type: "button", "data-xuanshu-action": "save-time", disabled: busy, onClick: saveTime, children: "保存" }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("details", { className: "xs-rikke__history", "data-xuanshu-history": "rikke", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("summary", { children: "投递历史" }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(DeliveryHistoryHost, { notify, preloaded: preloadedHistory })
    ] })
  ] });
}
function RikkeIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("rect", { x: "3.5", y: "5", width: "17", height: "15", rx: "2" }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("path", { d: "M3.5 10h17M8 3.5v3M16 3.5v3" }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("path", { d: "M8 14h4" })
  ] });
}
function installRikke(ctx, deps) {
  installRikkeStyle();
  ctx.slots.inject(
    "main",
    () => ctx.slots.register(
      { name: "main", key: RIKKE_ID, inject: () => ({ ...deps }) },
      RikkePanel
    )
  );
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      { name: "sidebar.panellist", id: RIKKE_ID, order: RIKKE_ORDER, label: RIKKE_LABEL },
      RikkeIcon
    )
  );
}

// src/client/wansheng-api.ts
var WANSHENG_ENDPOINTS = {
  status: "wansheng.status",
  read: "wansheng.read",
  generate: "wansheng.generate",
  setTime: "wansheng.setTime"
};
function createWanshengApi(ctx) {
  return {
    status: (payload, signal) => rpcCall(ctx, WANSHENG_ENDPOINTS.status, payload ?? {}, signal),
    read: (payload, signal) => rpcCall(ctx, WANSHENG_ENDPOINTS.read, payload ?? {}, signal),
    generate: (payload, signal) => rpcCall(ctx, WANSHENG_ENDPOINTS.generate, payload ?? {}, signal),
    setTime: (payload, signal) => rpcCall(ctx, WANSHENG_ENDPOINTS.setTime, payload, signal)
  };
}

// src/client/wansheng-controller.ts
function errorText7(error) {
  return error instanceof Error ? error.message : String(error);
}
function createWanshengUiController(api) {
  let revision = 0;
  let outcome;
  let running;
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const settle = (answer) => {
    const next = { ok: answer?.ok === true };
    if (answer?.date !== void 0) next.date = answer.date;
    if (next.ok !== true) next.reason = answer?.reason ?? "晚省生成失败：宿主没有给出理由。";
    outcome = next;
    return next;
  };
  return {
    getRevision: () => revision,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getOutcome: () => outcome,
    clearOutcome() {
      outcome = void 0;
      revision += 1;
      notify();
    },
    generate(date) {
      if (running !== void 0) return running;
      running = api.generate(date === void 0 ? {} : { date }).then(settle).catch((error) => {
        outcome = { ok: false, reason: errorText7(error) };
        return outcome;
      }).then((answer) => {
        running = void 0;
        revision += 1;
        notify();
        return answer;
      });
      return running;
    }
  };
}

// src/client/wansheng.tsx
var import_react20 = require("react");
var import_jsx_runtime23 = require("react/jsx-runtime");
var WANSHENG_GENERATE_CONFIRM = "将覆盖今天的晚省，继续？";
var WANSHENG_NO_NETWORK_NOTE = "不联网取外部资讯：晚省只用本机的会话与工作流活动记录，不调模型。";
function errorText8(error) {
  return error instanceof Error ? error.message : String(error);
}
function initialView3(preloaded) {
  if (preloaded === void 0) return { kind: "loading" };
  if ("error" in preloaded) return { kind: "error", message: preloaded.error };
  if (preloaded.exists !== true) return { kind: "empty", status: preloaded };
  return { kind: "ready", status: preloaded };
}
function touchLines(status) {
  const notify = status?.notify;
  if ((status?.unread ?? 0) === 0 && notify?.status !== "failed") return null;
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(import_jsx_runtime23.Fragment, { children: [
    (status?.unread ?? 0) > 0 ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__note", "data-xuanshu-note": "unread", children: `未读 ${status?.unread} 条晚省通知` }) : null,
    notify?.status === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
      "p",
      {
        className: "xs-wansheng__alert",
        role: "alert",
        "data-xuanshu-notify": "failed",
        "data-xuanshu-reason-code": notifyReasonCode(notify),
        children: `上一次通知没发出去：${notifyFailureText(notify)}`
      }
    ) : null
  ] });
}
function ActivityList({ items, kind, label }) {
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(import_jsx_runtime23.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__fact", "data-xuanshu-fact": `${kind}s`, children: items === void 0 ? `哪些${label}有活动：未知（这边暂时读不到）` : items.length === 0 ? `今天没有${label}活动` : `今天 ${items.length} 个${label}有活动` }),
    items === void 0 || items.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("ul", { className: "xs-wansheng__workspace-list", children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("li", { ...kind === "workspace" ? { "data-xuanshu-workspace": item.id } : { "data-xuanshu-workflow": item.id }, children: [
      `${item.title} · ${item.sessionCount} 场会话`,
      item.lastActiveAt === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "xs-wansheng__note", children: ` · 最后活跃 ${momentOf(item.lastActiveAt)}` })
    ] }, item.id)) })
  ] });
}
function FactsSection({ facts }) {
  const sessions = facts?.consultSessions;
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("section", { className: "xs-wansheng__facts", "data-xuanshu-facts": "wansheng", children: [
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("h2", { children: "今天的事实" }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__fact", "data-xuanshu-fact": "consult", children: sessions === void 0 ? "今天几场问事：未知（这边暂时读不到）" : `今天 ${sessions.count} 场问事` }),
    sessions === void 0 || sessions.items.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("ul", { className: "xs-wansheng__consult-list", children: sessions.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("li", { "data-xuanshu-consult": item.sessionId, children: [
      item.title,
      item.lastTurnAt === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "xs-wansheng__note", children: ` · 最后一句 ${momentOf(item.lastTurnAt)}` })
    ] }, item.sessionId)) }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ActivityList, { items: facts?.activeWorkspaces, kind: "workspace", label: "项目" }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ActivityList, { items: facts?.activeWorkflows, kind: "workflow", label: "工作流" }),
    facts?.rikke?.generatedAt === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__fact", "data-xuanshu-fact": "rikke", children: `日课：${momentOf(facts.rikke.generatedAt)} 生成` }),
    facts?.digao?.generatedAt === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__fact", "data-xuanshu-fact": "digao", children: `底稿：${momentOf(facts.digao.generatedAt)} 刷新过` }),
    facts?.shiji?.updatedAt === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__fact", "data-xuanshu-fact": "shiji", children: `事记：${momentOf(facts.shiji.updatedAt)} 有更新` })
  ] });
}
function WanshengPanel({
  api,
  navigate,
  notify,
  preloaded,
  preloadedHistory,
  preloadedTimeEdit
}) {
  const seeded = preloaded !== void 0;
  const [view, setView] = (0, import_react20.useState)(() => initialView3(preloaded));
  const [busy, setBusy] = (0, import_react20.useState)(false);
  const [confirming, setConfirming] = (0, import_react20.useState)(false);
  const [editing, setEditing] = (0, import_react20.useState)(preloadedTimeEdit === true);
  const [timeDraft, setTimeDraft] = (0, import_react20.useState)(
    () => clockOf(preloaded !== void 0 && !("error" in preloaded) ? preloaded.schedule?.time : void 0)
  );
  const [note, setNote] = (0, import_react20.useState)(void 0);
  const sequence = (0, import_react20.useRef)(0);
  const load = () => {
    const mine = ++sequence.current;
    void api.status().then((status2) => {
      if (mine !== sequence.current) return;
      setView(initialView3(status2));
      setTimeDraft(clockOf(status2.schedule?.time));
    }).catch((error) => {
      if (mine !== sequence.current) return;
      setView({ kind: "error", message: errorText8(error) });
    });
  };
  (0, import_react20.useEffect)(() => {
    if (seeded) return;
    load();
  }, [api, seeded]);
  const generate = () => {
    setBusy(true);
    setNote(void 0);
    const mine = ++sequence.current;
    void api.generate().then(async (answer) => {
      if (mine !== sequence.current) return;
      if (answer?.ok !== true) {
        setView({ kind: "error", message: answer?.reason ?? "晚省生成失败：宿主没有给出理由。" });
        return;
      }
      const status2 = await api.status();
      if (mine !== sequence.current) return;
      setView(initialView3(status2));
    }).catch((error) => {
      if (mine !== sequence.current) return;
      setView({ kind: "error", message: errorText8(error) });
    }).finally(() => {
      if (mine === sequence.current) setBusy(false);
    });
  };
  const saveTime = () => {
    if (timeDraft === "") return;
    setBusy(true);
    setNote(void 0);
    void api.setTime({ time: timeDraft }).then((answer) => {
      setNote(`已改时刻：每天 ${clockOf(answer.schedule.time)}（${answer.schedule.timeZone}）`);
      setEditing(false);
    }).catch((error) => {
      setNote(`改时刻失败：${errorText8(error)}`);
    }).finally(() => {
      setBusy(false);
    });
  };
  const status = view.kind === "empty" || view.kind === "ready" ? view.status : view.kind === "error" ? view.status : void 0;
  const date = status?.date ?? "—";
  const schedule = status?.schedule;
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("main", { className: "xs-wansheng", "data-xuanshu-panel": WANSHENG_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("header", { className: "xs-wansheng__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("h1", { children: `晚省 · ${date}` }),
      status?.missed === true ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(XsMissedMark, {}) : null,
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "xs-wansheng__note", "data-xuanshu-state": view.kind, children: view.kind === "ready" ? "今天的晚省已到" : view.kind === "empty" ? "今天还没有晚省" : view.kind === "error" ? "读取失败" : "正在读晚省…" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__note", "data-xuanshu-note": "schedule", children: schedule === void 0 ? "计划时刻：暂时读不到（在「自动化任务」面板里看这条 daily 任务）" : `计划时刻：每天 ${clockOf(schedule.time)}（${schedule.timeZone}）· 可在「自动化任务」面板里改或停用` }),
    status?.generatedAt === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__note", "data-xuanshu-note": "generated-at", children: `生成于 ${momentOf(status.generatedAt)}` }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__note", "data-xuanshu-note": "no-network", children: WANSHENG_NO_NETWORK_NOTE }),
    status?.missed === true ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__note", "data-xuanshu-note": "missed", children: "这是补生成的一份（过去的日期），不是今天的。" }) : null,
    view.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__note", "data-xuanshu-view": "loading", children: "正在读今天的晚省…" }) : null,
    view.kind === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("section", { className: "xs-wansheng__empty", "data-xuanshu-view": "empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { children: EMPTY_COPY.wansheng.why }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__note", children: EMPTY_COPY.wansheng.sub })
    ] }) : null,
    view.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("section", { className: "xs-wansheng__alert", "data-xuanshu-view": "error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { "data-xuanshu-reason": "generate", children: view.message }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "xs-wansheng__actions", children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("button", { type: "button", "data-xuanshu-action": "retry", onClick: load, children: "重试" }) })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(FactsSection, { facts: status?.facts }),
    touchLines(status),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "xs-wansheng__actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
        "button",
        {
          type: "button",
          className: "xs-btn xs-btn--primary",
          "data-xuanshu-action": "generate-wansheng",
          disabled: busy,
          onClick: () => {
            setConfirming(true);
          },
          children: busy ? "生成中…" : "立即生成"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("button", { type: "button", "data-xuanshu-action": "edit-time", onClick: () => {
        setEditing(!editing);
      }, children: "改时刻" }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("button", { type: "button", "data-xuanshu-nav": "schedules", onClick: () => {
        navigate("schedules");
      }, children: "打开自动化任务面板" }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("button", { type: "button", "data-xuanshu-nav": "consult", onClick: () => {
        navigate("consult");
      }, children: "去问事" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "xs-wansheng__confirm", "data-xuanshu-confirm": "regenerate", hidden: !confirming, children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { "data-xuanshu-confirm-text": "regenerate", children: WANSHENG_GENERATE_CONFIRM }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "xs-wansheng__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
          "button",
          {
            type: "button",
            "data-xuanshu-action": "regenerate-cancel",
            onClick: () => {
              setConfirming(false);
            },
            children: "取消"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
          "button",
          {
            type: "button",
            "data-xuanshu-action": "regenerate-go",
            onClick: () => {
              setConfirming(false);
              generate();
            },
            children: "继续生成 ->"
          }
        )
      ] })
    ] }),
    note === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "xs-wansheng__note", role: "status", "data-xuanshu-note": "time-result", children: note }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "xs-wansheng__time-edit", "data-xuanshu-time-edit": "wansheng", hidden: !editing, children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("label", { children: [
        "晚省时刻",
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
          "input",
          {
            type: "time",
            value: timeDraft,
            onChange: (event) => {
              setTimeDraft(event.target.value);
            }
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "xs-wansheng__note", children: `时区 ${schedule?.timeZone ?? "（读不到）"}（IANA，不手改）` }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "xs-wansheng__actions", children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("button", { type: "button", "data-xuanshu-action": "save-time", disabled: busy, onClick: saveTime, children: "保存" }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("details", { className: "xs-wansheng__history", "data-xuanshu-history": "wansheng", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("summary", { children: "投递历史" }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(DeliveryHistoryHost, { notify, preloaded: preloadedHistory })
    ] })
  ] });
}
function XsMissedMark() {
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "xs-badge xs-badge--missed", "data-xuanshu-badge": "missed", children: "补" });
}
function WanshengIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("path", { d: "M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" }) });
}
function installWansheng(ctx, deps) {
  installRikkeStyle();
  ctx.slots.inject(
    "main",
    () => ctx.slots.register(
      { name: "main", key: WANSHENG_ID, inject: () => ({ ...deps }) },
      WanshengPanel
    )
  );
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      { name: "sidebar.panellist", id: WANSHENG_ID, order: WANSHENG_ORDER, label: WANSHENG_LABEL },
      WanshengIcon
    )
  );
}

// src/client/workflow/workflow-api.ts
var WORKFLOW_ENDPOINTS = {
  create: "workflow.create",
  list: "workflow.list",
  exportSkill: "workflow.exportSkill"
};
function createWorkflowApi(ctx) {
  return {
    create: (payload, signal) => rpcCall(ctx, WORKFLOW_ENDPOINTS.create, payload ?? {}, signal),
    list: (signal) => rpcCall(ctx, WORKFLOW_ENDPOINTS.list, {}, signal),
    exportSkill: (payload, signal) => rpcCall(ctx, WORKFLOW_ENDPOINTS.exportSkill, payload, signal)
  };
}

// src/client/workflow/WorkflowPanel.tsx
var import_react21 = require("react");

// src/client/workflow/workflow-model.ts
var WORKFLOW_ID = "workflow";
var WORKFLOW_LABEL = "工作流";
var WORKFLOW_ORDER = 70;
var WORKFLOW_BOUNDARY_NOTE = "工作流不是谱：它不会出现在谱列表里；它是可复用的 skill 与一次跑通过的会话。";
var WORKFLOW_EXPORT_HINT = "导出一个 skill，落点由宿主决定：<DSH home>/skills/<工作流名>/SKILL.md（无需你指定路径）。";
var WORKFLOW_HUMAN_JUDGE_NOTE = "跑没跑通由你判定 —— 玄枢不显示通过 / 失败，也不给评分。";
var WORKFLOW_OUT_OF_SCOPE_NOTE = "「测试 / 反向优化 / 复用」的细流程不在本次范围。";
var WORKFLOW_LOCAL_NOTE = "产物与会话都在本地：数据目录与 DSH 的 skills / sessions 目录，可整体拷走。";
function splitWorkflows(items) {
  const running = [];
  const exported = [];
  for (const item of items ?? []) {
    if (typeof item?.exportedAt === "string" && item.exportedAt !== "") exported.push(item);
    else running.push(item);
  }
  return { running, exported };
}
function exportBlockers(draft) {
  const blockers = [];
  const name = (draft?.name ?? "").trim();
  const description = (draft?.description ?? "").trim();
  const content = (draft?.content ?? "").trim();
  if (name === "") blockers.push("给这个工作流起一个名字（kebab-case，例如 weekly-industry-digest）。");
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) blockers.push("名字要 kebab-case：小写字母、数字、单连字符（中文名请另给一个英文名）。");
  if (description === "") blockers.push("写一句 description（DSH 把它当必填，缺了会忽略这个 skill）。");
  if (content === "") blockers.push("把会话里跑通的那套步骤写进正文。");
  return blockers;
}
function workflowSubtitle(item) {
  if (typeof item.exportedAt === "string" && item.exportedAt !== "") return `已导出 · ${momentOf(item.exportedAt)}`;
  if (typeof item.createdAt === "string" && item.createdAt !== "") return `进行中（等你判定）· ${momentOf(item.createdAt)} 建`;
  return "进行中（等你判定）";
}

// src/client/workflow/WorkflowPanel.tsx
var import_jsx_runtime24 = require("react/jsx-runtime");
function errorText9(error) {
  return error instanceof Error ? error.message : String(error);
}
function initialView4(preloaded) {
  if (preloaded === void 0) return { kind: "loading" };
  if (Array.isArray(preloaded)) return preloaded.length === 0 ? { kind: "empty" } : { kind: "ready", items: preloaded };
  return { kind: "error", message: preloaded.error };
}
function WorkflowPanel({ api, navigate, preloaded }) {
  const seeded = preloaded !== void 0;
  const [view, setView] = (0, import_react21.useState)(() => initialView4(preloaded));
  const [busy, setBusy] = (0, import_react21.useState)(false);
  const [createError, setCreateError] = (0, import_react21.useState)(void 0);
  const [draft, setDraft] = (0, import_react21.useState)({ sessionId: "", name: "", description: "", content: "" });
  const [exportError, setExportError] = (0, import_react21.useState)(void 0);
  const [exported, setExported] = (0, import_react21.useState)(void 0);
  const sequence = (0, import_react21.useRef)(0);
  const load = () => {
    const mine = ++sequence.current;
    void api.list().then((listed) => {
      if (mine !== sequence.current) return;
      setView(listed.items.length === 0 ? { kind: "empty" } : { kind: "ready", items: listed.items });
    }).catch((error) => {
      if (mine !== sequence.current) return;
      setView({ kind: "error", message: errorText9(error) });
    });
  };
  (0, import_react21.useEffect)(() => {
    if (seeded) return;
    load();
  }, [api, seeded]);
  const onCreate = () => {
    setBusy(true);
    setCreateError(void 0);
    void (async () => {
      try {
        const created = await api.create({ seed: draft.content.trim() === "" ? void 0 : draft.content.trim() });
        setDraft((current) => ({ ...current, sessionId: created.sessionId }));
        navigate("conversation");
      } catch (error) {
        setCreateError(errorText9(error));
      } finally {
        setBusy(false);
      }
    })();
  };
  const blockers = exportBlockers(draft);
  const onExport = () => {
    setBusy(true);
    setExportError(void 0);
    setExported(void 0);
    void (async () => {
      try {
        const result = await api.exportSkill({
          sessionId: draft.sessionId,
          name: draft.name.trim(),
          description: draft.description.trim(),
          content: draft.content.trim()
        });
        setExported(result);
      } catch (error) {
        setExportError(errorText9(error));
      } finally {
        setBusy(false);
      }
    })();
  };
  const { running, exported: exportedItems } = splitWorkflows(view.kind === "ready" ? view.items : []);
  return (
    /* 2026-11-02：补 `data-xuanshu-panel`。其余九个面都有这个属性，谱与工作流两个没有 ——
       于是任何按属性判定「当前在哪一屏」的东西（巡检脚本、无障碍检查、我的实测）都会看漏它们，
       我自己就为此误判过两次（以为「点了快捷入口没反应」）。 */
    /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("section", { className: "xs-workflow", "data-xuanshu-panel": "workflow", "aria-label": WORKFLOW_LABEL, children: [
      /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("header", { className: "xs-workflow__head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("h1", { className: "xs-workflow__title", children: WORKFLOW_LABEL }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("button", { type: "button", className: "xs-workflow__create", onClick: onCreate, disabled: busy, children: busy ? "创建中…" : "创建工作流" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { className: "xs-workflow__hint", "data-xuanshu-note": "create-hint", children: "点「创建工作流」会先新开一个会话：切到「选择工作区」→ 跑通那套步骤 → 回来在这里判定并导出 skill。" }),
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { className: "xs-workflow__note", children: WORKFLOW_BOUNDARY_NOTE }),
      createError !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("p", { className: "xs-workflow__error", role: "alert", children: [
        "创建工作流失败：",
        createError
      ] }) : null,
      view.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { className: "xs-workflow__hint", children: "正在读工作流列表…" }) : null,
      view.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: "xs-workflow__alert", role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("p", { className: "xs-workflow__error", children: [
          "工作流列表读不出来：",
          view.message
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("button", { type: "button", className: "xs-workflow__retry", "data-xuanshu-action": "retry-list", onClick: load, children: "重试" })
      ] }) : null,
      view.kind === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { className: "xs-workflow__hint", children: "还没有工作流：点上面的「创建工作流」说清要求，用会话里的 coding 工具真跑一遍，你觉得跑通了再来导出。" }) : null,
      running.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: "xs-workflow__group", children: [
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("h2", { className: "xs-workflow__groupTitle", children: "进行中" }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("ul", { className: "xs-workflow__list", children: running.map((item) => /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("li", { className: "xs-workflow__item", children: [
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { className: "xs-workflow__name", children: item.name }),
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { className: "xs-workflow__sub", children: workflowSubtitle(item) }),
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("button", { type: "button", className: "xs-workflow__open", onClick: () => {
            setDraft((current) => ({ ...current, sessionId: item.sessionId }));
            navigate("conversation");
          }, children: "打开会话" }),
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("button", { type: "button", className: "xs-workflow__pick", onClick: () => setDraft((current) => ({ ...current, sessionId: item.sessionId, name: current.name })), children: "选它导出" })
        ] }, item.id)) })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: "xs-workflow__group", children: [
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("h2", { className: "xs-workflow__groupTitle", children: "判定与导出" }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { className: "xs-workflow__rule", children: WORKFLOW_HUMAN_JUDGE_NOTE }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { className: "xs-workflow__hint", children: WORKFLOW_EXPORT_HINT }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("p", { className: "xs-workflow__field", "data-xuanshu-field": "session", children: [
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { children: "会话" }),
          draft.sessionId === "" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { className: "xs-workflow__hint", "data-xuanshu-note": "session-empty", children: "还没选会话：在上面的「进行中」列表里点「选它导出」。" }) : /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("code", { children: draft.sessionId })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("label", { className: "xs-workflow__field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { children: "名字" }),
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("input", { value: draft.name, onChange: (event) => setDraft((current) => ({ ...current, name: event.target.value })), placeholder: "weekly-industry-digest" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("label", { className: "xs-workflow__field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { children: "description" }),
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("input", { value: draft.description, onChange: (event) => setDraft((current) => ({ ...current, description: event.target.value })), placeholder: "一句话说清这个工作流做什么" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("label", { className: "xs-workflow__field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { children: "正文" }),
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("textarea", { value: draft.content, onChange: (event) => setDraft((current) => ({ ...current, content: event.target.value })), rows: 6, placeholder: "把会话里跑通的那套步骤写进来（SKILL.md 的正文）" })
        ] }),
        blockers.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("ul", { className: "xs-workflow__blockers", children: blockers.map((reason) => /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("li", { children: reason }, reason)) }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("button", { type: "button", className: "xs-workflow__export", onClick: onExport, disabled: busy || blockers.length > 0, children: "我认为跑通了 → 导出 skill" }),
        exportError !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("p", { className: "xs-workflow__error", role: "alert", children: [
          "导出失败：",
          exportError
        ] }) : null,
        exported !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("p", { className: "xs-workflow__done", children: [
          "已导出 ",
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("code", { children: exported.name }),
          " → ",
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("code", { children: exported.path }),
          "（在 DSH 技能中心里可见，来源 user-dsh）"
        ] }) : null
      ] }),
      exportedItems.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: "xs-workflow__group", children: [
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("h2", { className: "xs-workflow__groupTitle", children: "已导出" }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("ul", { className: "xs-workflow__list", children: exportedItems.map((item) => /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("li", { className: "xs-workflow__item", children: [
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { className: "xs-workflow__name", children: item.name }),
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { className: "xs-workflow__sub", children: workflowSubtitle(item) })
        ] }, item.id)) })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { className: "xs-workflow__note", children: WORKFLOW_OUT_OF_SCOPE_NOTE }),
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { className: "xs-workflow__note", children: WORKFLOW_LOCAL_NOTE })
    ] })
  );
}
function WorkflowIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("rect", { x: "3.5", y: "4", width: "7", height: "6", rx: "1.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("rect", { x: "13.5", y: "14", width: "7", height: "6", rx: "1.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("path", { d: "M7 10v4a3 3 0 0 0 3 3h3.5" })
  ] });
}
function installWorkflowStyle() {
  const id = "xuanshu-workflow-style";
  registerStyleSheet("xuanshu-workflow-style", [
    ".xs-workflow{padding:20px 24px;color:var(--dsh-text-primary,inherit);font:inherit}",
    ".xs-workflow__head{display:flex;align-items:center;justify-content:space-between;gap:12px}",
    ".xs-workflow__title{margin:0;font-size:18px}",
    ".xs-workflow__note,.xs-workflow__hint,.xs-workflow__rule{margin:8px 0;opacity:.8;font-size:13px}",
    ".xs-workflow__error{color:var(--xs-state-error-fg)}",
    ".xs-workflow__alert{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
    ".xs-workflow__alert .xs-workflow__error{margin:8px 0}",
    ".xs-workflow__retry{font:inherit;padding:6px 12px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}",
    ".xs-workflow__group{margin-top:18px;border-top:1px solid var(--xs-edge-divider);padding-top:12px}",
    ".xs-workflow__groupTitle{margin:0 0 8px;font-size:14px;opacity:.85}",
    ".xs-workflow__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}",
    ".xs-workflow__item{display:flex;align-items:center;gap:10px}",
    ".xs-workflow__sub{opacity:.7;font-size:12px}",
    ".xs-workflow__field{display:flex;gap:8px;align-items:center;margin:6px 0}",
    ".xs-workflow__field input,.xs-workflow__field textarea{flex:1}",
    ".xs-workflow__blockers{margin:6px 0;padding-left:18px;font-size:12px;opacity:.85}",
    ".xs-workflow__done{margin:8px 0;font-size:13px}"
  ].join("\n"));
  installXuanshuStyles();
}
function installWorkflowPanel(ctx, deps) {
  installWorkflowStyle();
  ctx.slots.inject(
    "main",
    () => ctx.slots.register(
      { name: "main", key: WORKFLOW_ID, inject: () => ({ ...deps }) },
      WorkflowPanel
    )
  );
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      { name: "sidebar.panellist", id: WORKFLOW_ID, order: WORKFLOW_ORDER, label: WORKFLOW_LABEL },
      WorkflowIcon
    )
  );
}

// src/client/sediment-api.ts
var SEDIMENT_ENDPOINTS = {
  draft: "sediment.draft",
  commit: "sediment.commit",
  discard: "sediment.discard"
};
function createSedimentApi(ctx) {
  return {
    draft: (payload, signal) => rpcCall(ctx, SEDIMENT_ENDPOINTS.draft, payload, signal),
    // `confirmed` 在这里写死成字面量 `true`：确认是人在弹窗里点的那一次，不是一个可传参的开关。
    commit: (payload, signal) => rpcCall(ctx, SEDIMENT_ENDPOINTS.commit, { ...payload, confirmed: true }, signal),
    discard: (payload, signal) => rpcCall(ctx, SEDIMENT_ENDPOINTS.discard, payload, signal),
    readTarget: (slug, signal) => rpcCall(ctx, "pu.read", { slug }, signal),
    // 读面仍是既有方法（`pu.list`）：本票不新开端点，只把「可选目标谱」这件事收在一处。
    listTargets: async (signal) => {
      const rows = await rpcCall(ctx, "pu.list", {}, signal);
      return rows.filter((row) => row !== null && typeof row === "object" && typeof row.slug === "string");
    }
  };
}

// src/client/sediment-model.ts
var CONSULT_SESSION_ID_RE = /^session-xs-consult-[A-Za-z0-9._-]+$/u;
function isConsultSessionId(value) {
  return typeof value === "string" && CONSULT_SESSION_ID_RE.test(value);
}
function countWords(text) {
  return String(text ?? "").replace(/\s+/gu, "").length;
}
function group(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}
function wordDeltaText(before, after) {
  const head = `${group(before)} → ${group(after)} 字`;
  const delta = after - before;
  if (delta === 0) return `${head}（未变）`;
  const sign = delta > 0 ? "+" : "-";
  const body = `${sign}${group(Math.abs(delta))} 字`;
  if (before === 0) return `${head}（${body} / 新增）`;
  if (after === 0) return `${head}（${body} / 清空）`;
  const ratio = Math.round(Math.abs(delta) / before * 100);
  return `${head}（${body} / ${sign}${ratio}%）`;
}
function paragraphs(text) {
  return String(text ?? "").split(/\n{2,}/u).map((part) => part.trim()).filter((part) => part !== "");
}
function diffParagraphs(currentBody, draftBody) {
  const current = paragraphs(currentBody);
  const draft = paragraphs(draftBody);
  const remaining = current.map((text, index) => ({ text, index, used: false }));
  const items = [];
  const counts = { unchanged: 0, replaced: 0, added: 0, removed: 0 };
  for (let index = 0; index < draft.length; index += 1) {
    const text = draft[index];
    if (text === void 0) continue;
    const sameSpot = remaining[index];
    if (sameSpot !== void 0 && sameSpot.used !== true && sameSpot.text === text) {
      sameSpot.used = true;
      items.push({ kind: "=", text });
      counts.unchanged += 1;
      continue;
    }
    const elsewhere = remaining.find((entry) => entry.used !== true && entry.text === text);
    if (elsewhere !== void 0) {
      elsewhere.used = true;
      items.push({ kind: "=", text });
      counts.unchanged += 1;
      continue;
    }
    if (sameSpot !== void 0 && sameSpot.used !== true) {
      sameSpot.used = true;
      items.push({ kind: "~", text });
      counts.replaced += 1;
      continue;
    }
    items.push({ kind: "+", text });
    counts.added += 1;
  }
  for (const entry of remaining) {
    if (entry.used === true) continue;
    items.push({ kind: "-", text: entry.text });
    counts.removed += 1;
  }
  return { items, counts };
}
function previewText(text, maxChars = 480) {
  const raw = String(text ?? "").trim();
  return raw.length <= maxChars ? raw : `${raw.slice(0, maxChars)}…`;
}
function puPaths(slug, dataDir) {
  return {
    content: dataDirPath(dataDir, "pus", slug, "content.md"),
    summary: dataDirPath(dataDir, "pus", slug, "summary.md"),
    manifest: dataDirPath(dataDir, "pus", slug, "manifest.md")
  };
}
function confirmGate(input) {
  if (input.busy) return { ok: false, reason: "正在写入（写入期间按钮不可再点）。" };
  if (input.hasDraft !== true) return { ok: false, reason: "还没有草稿：先点 [导出汇总]。" };
  if (input.targetSlug === "") return { ok: false, reason: "还没有目标谱：沉淀只能写进谱（工作区 / 工作流不是谱）。" };
  if (input.stale) return { ok: false, reason: "目标谱在预览后被改动，请先 [重新预览]（本页不会覆盖你没看过的内容）。" };
  return { ok: true };
}
var EMPTY = { kind: "empty" };
function errorText10(error) {
  return error instanceof Error ? error.message : String(error);
}
function createSedimentController(api) {
  const states = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  let notice;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const put = (sessionId, state) => {
    states.set(sessionId, state);
    notify();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: (sessionId) => states.get(sessionId) ?? EMPTY,
    async export(sessionId, targetSlug) {
      put(sessionId, { kind: "loading" });
      try {
        const answer = await api.draft(targetSlug === void 0 || targetSlug === "" ? { sessionId } : { sessionId, targetSlug });
        put(sessionId, { kind: "ready", answer });
        return { ok: true };
      } catch (error) {
        const reason = errorText10(error);
        put(sessionId, { kind: "error", reason });
        return { ok: false, reason };
      }
    },
    async commit(sessionId, draft) {
      const state = states.get(sessionId);
      if (state?.answer === void 0) return { ok: false, reason: "还没有草稿：先点 [导出汇总]。" };
      try {
        const answer = await api.commit(draft === void 0 ? { draftId: state.answer.draftId } : { draftId: state.answer.draftId, draft });
        notice = { kind: "committed", pu: answer.pu };
        put(sessionId, { kind: "done", pu: answer.pu });
        return { ok: true };
      } catch (error) {
        const reason = errorText10(error);
        put(sessionId, { kind: "ready", answer: state.answer, reason });
        return { ok: false, reason };
      }
    },
    async discard(sessionId) {
      const state = states.get(sessionId);
      if (state?.answer === void 0) {
        put(sessionId, { kind: "empty" });
        return { ok: true };
      }
      try {
        await api.discard({ draftId: state.answer.draftId });
        put(sessionId, { kind: "empty" });
        return { ok: true };
      } catch (error) {
        const reason = errorText10(error);
        put(sessionId, { kind: "ready", answer: state.answer, reason });
        return { ok: false, reason };
      }
    },
    getNotice: () => notice,
    dismissNotice() {
      if (notice === void 0) return;
      notice = void 0;
      notify();
    },
    reset(sessionId) {
      put(sessionId, { kind: "empty" });
    }
  };
}

// src/client/sediment-views.tsx
var import_react22 = require("react");
var import_jsx_runtime25 = require("react/jsx-runtime");
var SEDIMENT_ENTRY_ID = "xuanshu.sediment-entry";
var SEDIMENT_DRAFT_CARD_ID = "xuanshu.sediment-draft";
var SEDIMENT_NOTICE_ID = "xuanshu.sediment-notice";
var SEDIMENT_TURNTAIL_ORDER = 30;
var NO_SUBSCRIBE2 = () => () => {
};
var EMPTY_STATE = { kind: "empty" };
function useSedimentState(controller, sessionId) {
  const snapshot = () => controller === void 0 || sessionId === void 0 ? EMPTY_STATE : controller.getState(sessionId);
  return (0, import_react22.useSyncExternalStore)(controller === void 0 ? NO_SUBSCRIBE2 : controller.subscribe, snapshot, snapshot);
}
function errorText11(error) {
  return error instanceof Error ? error.message : String(error);
}
function XsSedimentEntry({ sessionId, api, controller, navigate, preloadedTargets }) {
  const consult = isConsultSessionId(sessionId);
  const [targets, setTargets] = (0, import_react22.useState)(preloadedTargets);
  const [slug, setSlug] = (0, import_react22.useState)(preloadedTargets?.[0]?.slug ?? "");
  const [error, setError] = (0, import_react22.useState)("");
  const state = useSedimentState(controller, sessionId);
  (0, import_react22.useEffect)(() => {
    if (!consult || api === void 0 || preloadedTargets !== void 0) return;
    const abort = new AbortController();
    api.listTargets(abort.signal).then((rows) => {
      if (abort.signal.aborted) return;
      setTargets(rows);
      setSlug((current) => current !== "" ? current : rows[0]?.slug ?? "");
    }).catch((reason) => {
      if (!abort.signal.aborted) setError(`谱列表读不出来：${errorText11(reason)}`);
    });
    return () => {
      abort.abort();
    };
  }, [api, consult, preloadedTargets]);
  if (!consult || api === void 0 || controller === void 0 || sessionId === void 0 || navigate === void 0) return null;
  const busy = state.kind === "loading";
  const none = targets !== void 0 && targets.length === 0;
  return /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "xs-sediment__entry", "data-xuanshu-block": "sediment-entry", children: [
    /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("label", { className: "xs-sediment__field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { children: "目标谱（必选）" }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(
        "select",
        {
          "data-xuanshu-field": "sediment-target",
          value: slug,
          disabled: busy || none,
          onChange: (event) => {
            setSlug(event.target.value);
          },
          children: [
            none ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("option", { value: "", children: "（还没有可选的目标谱）" }) : null,
            (targets ?? []).map((row) => /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("option", { value: row.slug, children: row.name }, row.slug))
          ]
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
      "button",
      {
        type: "button",
        "data-xuanshu-action": "sediment-export",
        disabled: busy || slug === "",
        onClick: () => {
          void controller.export(sessionId, slug);
        },
        children: busy ? "正在生成草稿…" : "导出汇总"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__note", children: "导出只产出草稿：写进谱要你在下一步亲手点「确认更新」，AI 不会自动写。" }),
    none ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__note", role: "status", children: "还没有可选的目标谱：沉淀只能写进谱（工作区 / 工作流不是谱），先去侧栏「谱」建一本。" }) : null,
    error === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__error", role: "alert", children: error })
  ] });
}
function stateLabel(kind) {
  if (kind === "loading") return "loading";
  if (kind === "ready") return "ready";
  if (kind === "error") return "error";
  if (kind === "done") return "done";
  return "empty";
}
function XsSedimentDraftCard({ sessionId, api, controller, navigate, dataDir, homePaths, initialConfirmOpen, preloadedTargetView }) {
  const consult = isConsultSessionId(sessionId);
  const injectedHomePaths = useHomePaths(homePaths);
  const localDataDir = dataDir ?? injectedHomePaths.dataDir;
  const state = useSedimentState(controller, sessionId);
  const [open, setOpen] = (0, import_react22.useState)(initialConfirmOpen === true);
  const [targetView, setTargetView] = (0, import_react22.useState)(preloadedTargetView);
  const [stale, setStale] = (0, import_react22.useState)(false);
  const [busy, setBusy] = (0, import_react22.useState)(false);
  const [actionError, setActionError] = (0, import_react22.useState)("");
  const draft = state.answer?.draft;
  const target = state.answer?.target;
  const slug = target?.slug;
  const committedPu = state.kind === "done" ? state.pu : void 0;
  (0, import_react22.useEffect)(() => {
    if (!open || api === void 0 || slug === void 0 || preloadedTargetView !== void 0) return void 0;
    const abort = new AbortController();
    api.readTarget(slug, abort.signal).then((view) => {
      if (!abort.signal.aborted) setTargetView(view);
    }).catch((reason) => {
      if (!abort.signal.aborted) setActionError(`目标谱现状读不出来：${errorText11(reason)}`);
    });
    return () => {
      abort.abort();
    };
  }, [api, open, preloadedTargetView, slug]);
  if (!consult || api === void 0 || controller === void 0 || sessionId === void 0 || navigate === void 0) return null;
  if (state.kind === "empty") return null;
  const confirm = async () => {
    if (slug === void 0) return;
    setBusy(true);
    setActionError("");
    try {
      const fresh = await api.readTarget(slug);
      if (targetView !== void 0 && fresh.updatedAt !== targetView.updatedAt) {
        setTargetView(fresh);
        setStale(true);
        return;
      }
      const outcome = await controller.commit(sessionId);
      if (outcome.ok) {
        setOpen(false);
        setStale(false);
      } else {
        setActionError(outcome.reason ?? "写入失败：宿主没有给出理由。");
      }
    } catch (reason) {
      setActionError(`写入失败：${errorText11(reason)}`);
    } finally {
      setBusy(false);
    }
  };
  const reopen = async () => {
    if (slug === void 0) return;
    setBusy(true);
    setActionError("");
    try {
      setTargetView(await api.readTarget(slug));
      setStale(false);
    } catch (reason) {
      setActionError(`目标谱现状读不出来：${errorText11(reason)}`);
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("section", { className: "xs-sediment__card", "data-xuanshu-card": "sediment-draft", "data-xs-state": state.kind, children: [
    /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("header", { className: "xs-sediment__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("h3", { children: "沉淀草稿" }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "xs-sediment__badge", "data-xuanshu-state": state.kind, children: stateLabel(state.kind) })
    ] }),
    state.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { "data-xuanshu-skeleton": "sediment", children: "正在让这场问事汇出草稿……（要等一轮回答，通常几十秒）" }) : null,
    state.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "xs-sediment__error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { children: state.reason ?? "导出汇总失败：宿主没有给出理由。" }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("button", { type: "button", "data-xuanshu-action": "sediment-retry", onClick: () => {
        void controller.export(sessionId, target?.slug);
      }, children: "重试" })
    ] }) : null,
    state.kind === "ready" && draft !== void 0 && target !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(import_jsx_runtime25.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__meta", children: `${countWords(draft.body)} 字 · 尚未写进任何谱` }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__target", children: `目标谱：${target.name}（${target.slug}）` }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("pre", { className: "xs-sediment__preview", "data-xuanshu-preview": "sediment", children: previewText(draft.body) }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__path", children: `草稿落点（只读）：${dataDirPath(localDataDir, "sediment", `${state.answer?.draftId ?? ""}.json`)}` }),
      state.reason === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__error", role: "alert", children: state.reason }),
      actionError === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__error", role: "alert", children: actionError }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "xs-sediment__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("button", { type: "button", className: "xs-btn--primary", "data-xuanshu-action": "sediment-open-confirm", onClick: () => {
          setOpen(true);
        }, children: "更新到谱…" }),
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("button", { type: "button", "data-xuanshu-action": "sediment-discard", onClick: () => {
          void controller.discard(sessionId);
        }, children: "丢弃这份草稿" })
      ] }),
      open ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
        XsSedimentConfirmDialog,
        {
          draft,
          target,
          base: targetView,
          dataDir: localDataDir,
          stale,
          busy,
          error: actionError === "" ? void 0 : actionError,
          onConfirm: () => {
            void confirm();
          },
          onCancel: () => {
            setOpen(false);
          },
          onReopen: () => {
            void reopen();
          }
        }
      ) : null
    ] }) : null,
    committedPu !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "xs-sediment__done", children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { "data-xuanshu-state": "committed", children: `已更新到谱「${committedPu.name}」。` }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__note", children: `写入路径：${puPaths(committedPu.slug, localDataDir).content}` }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("div", { className: "xs-sediment__actions", children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("button", { type: "button", "data-xuanshu-action": "sediment-open-pu", onClick: () => {
        requestPuOpenAndGo(committedPu, navigate);
      }, children: "看这张谱 ->" }) })
    ] }) : null
  ] });
}
function XsSedimentConfirmDialog({ draft, target, base, dataDir, stale, busy, error, onConfirm, onCancel, onReopen }) {
  const gate = confirmGate({ hasDraft: draft !== void 0, targetSlug: target?.slug ?? "", stale, busy });
  const paths = target === void 0 ? void 0 : puPaths(target.slug, dataDir);
  const diff = draft === void 0 || base === void 0 ? void 0 : diffParagraphs(base.body, draft.body);
  const words = draft === void 0 || base === void 0 ? void 0 : wordDeltaText(countWords(base.body), countWords(draft.body));
  return /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("div", { className: "xs-sediment__overlay", role: "dialog", "aria-modal": "true", "aria-labelledby": "xs-sediment-dialog-title", children: /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "xs-sediment__dialog", children: [
    /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("h2", { id: "xs-sediment-dialog-title", children: "更新到谱 · 人工确认" }),
    /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("section", { className: "xs-sediment__part", children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("h4", { children: "① 目标谱（必选）" }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { "data-xuanshu-field": "sediment-confirm-target", children: target === void 0 ? "（还没有选定目标谱）" : `${target.name}（${target.slug}）` }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__note", children: "写入目标只能是谱 —— 工作区 / 工作流不是谱，选项里不出现。" }),
      target === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__note", "data-xs-gate": "no-target", role: "status", children: "还没有目标谱：沉淀只能写进谱，先回入口选一本。" }) : null,
      stale ? /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "xs-sediment__stale", "data-xs-gate": "stale", role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { children: "目标谱在预览后被改动，请重新预览（本页不会覆盖你没看过的内容）。" }),
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("button", { type: "button", "data-xuanshu-action": "sediment-reopen", disabled: busy, onClick: onReopen, children: "重新预览" })
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("section", { className: "xs-sediment__part", children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("h4", { children: "② 变更 diff 预览（草稿 → 目标谱）" }),
      diff === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__note", children: "正在读目标谱现状…" }) : /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(import_jsx_runtime25.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("p", { className: "xs-sediment__counts", children: [
          `+ 新增 ${diff.counts.added} 段 · ~ 替换 ${diff.counts.replaced} 段 · = 未变 ${diff.counts.unchanged} 段`,
          diff.counts.removed === 0 ? "" : ` · - 删除 ${diff.counts.removed} 段`
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("ol", { className: "xs-sediment__diff", "data-xuanshu-diff": "sediment", children: diff.items.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("li", { "data-xs-diff-kind": item.kind, children: [
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "xs-sediment__mark", children: item.kind }),
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "xs-sediment__diff-text", children: previewText(item.text, 200) })
        ] }, `${item.kind}-${String(index)}`)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("section", { className: "xs-sediment__part", children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("h4", { children: "③ 字数变化" }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { "data-xuanshu-field": "sediment-words", children: words ?? "正在读目标谱现状…" }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__note", children: "summary 由 AI 重写（草稿里的那一份）；确认之后它就是新的汇总。" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("section", { className: "xs-sediment__part", children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("h4", { children: "④ 写入路径（只读展示，界面不可改）" }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("ul", { className: "xs-sediment__paths", children: paths === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("li", { children: "（还没有目标谱）" }) : /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(import_jsx_runtime25.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("li", { "data-xuanshu-readonly-path": "content", children: paths.content }),
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("li", { "data-xuanshu-readonly-path": "summary", children: paths.summary })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__note", children: "写入走谱的原子替换（同目录暂存后整体替换）；不额外留备份目录。" })
    ] }),
    error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__error", role: "alert", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "xs-sediment__actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
        "button",
        {
          type: "button",
          className: "xs-btn--primary",
          "data-xuanshu-action": "sediment-confirm",
          disabled: !gate.ok,
          onClick: onConfirm,
          children: busy ? "正在写入…" : "确认更新"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("button", { type: "button", "data-xuanshu-action": "sediment-cancel", disabled: busy, onClick: onCancel, children: "返回改草稿" })
    ] }),
    gate.ok || gate.reason === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__gate-reason", role: "status", children: gate.reason }),
    /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: "xs-sediment__note", children: "长期放行请在 DSH 权限设置里改，本屏不提供跳过确认。" })
  ] }) });
}
function XsSedimentNotice({ controller, navigate }) {
  const notice = (0, import_react22.useSyncExternalStore)(controller.subscribe, controller.getNotice, controller.getNotice);
  if (notice === void 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "xs-sediment__notice", "data-xuanshu-notice": "sediment", role: "status", children: [
    /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { children: `已更新到谱「${notice.pu.name}」（${countWords(notice.pu.body)} 字）。` }),
    /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "xs-sediment__actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("button", { type: "button", "data-xuanshu-action": "sediment-open-pu", onClick: () => {
        requestPuOpenAndGo(notice.pu, navigate);
        controller.dismissNotice();
      }, children: "看这张谱 ->" }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("button", { type: "button", "data-xuanshu-action": "sediment-dismiss", onClick: () => {
        controller.dismissNotice();
      }, children: "关闭" })
    ] })
  ] });
}
function installSediment(ctx, deps) {
  installSedimentStyle();
  ctx.slots.inject(
    "conversation.composer.dock",
    () => ctx.slots.register(
      { name: "conversation.composer.dock", id: SEDIMENT_ENTRY_ID, inject: () => ({ ...deps }) },
      XsSedimentEntry
    )
  );
  ctx.slots.inject(
    "conversation.chat.turnTail",
    () => ctx.slots.register(
      { name: "conversation.chat.turnTail", id: SEDIMENT_DRAFT_CARD_ID, order: SEDIMENT_TURNTAIL_ORDER, inject: () => ({ ...deps }) },
      XsSedimentDraftCard
    )
  );
  ctx.slots.inject(
    "shell.overlay",
    () => ctx.slots.register(
      { name: "shell.overlay", id: SEDIMENT_NOTICE_ID, inject: () => ({ ...deps }) },
      XsSedimentNotice
    )
  );
}
function installSedimentStyle() {
  registerStyleSheet("xuanshu-sediment-style", `
.xs-sediment__entry{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0}
.xs-sediment__field{display:flex;gap:6px;align-items:center;font-size:.85rem}
.xs-sediment__entry select,.xs-sediment__entry button{font:inherit}
.xs-sediment__card{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad);margin:10px 0}
.xs-sediment__head{display:flex;gap:8px;align-items:baseline;justify-content:space-between}
.xs-sediment__head h3{font-size:.98rem;font-weight:600;margin:0}
.xs-sediment__badge{font-size:.72rem;padding:2px 8px;border:1px solid var(--xs-edge-card);border-radius:999px;color:var(--xs-text-secondary)}
.xs-sediment__meta{font-weight:600;margin:8px 0 4px}
.xs-sediment__target{margin:0 0 6px;color:var(--xs-text-secondary)}
.xs-sediment__preview{max-height:8em;overflow:auto;margin:6px 0;padding:8px;background:var(--xs-surface-card);border-radius:var(--xs-radius-control);white-space:pre-wrap;font:inherit}
.xs-sediment__path,.xs-sediment__note{font-size:.8rem;color:var(--xs-text-secondary);line-height:1.6;margin:4px 0}
.xs-sediment__actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0 0}
.xs-sediment__actions button{font:inherit;padding:6px 12px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-sediment__actions button:disabled{opacity:.5;cursor:not-allowed}
.xs-btn--primary{background:var(--xs-constraint-human-gate-bg,var(--xs-accent));border-color:var(--xs-accent);color:var(--xs-constraint-human-gate-fg,var(--xs-accent-fg))}
.xs-sediment__overlay{position:fixed;inset:0;background:var(--xs-surface-overlay-mask);display:flex;align-items:center;justify-content:center;padding:16px;z-index:30}
.xs-sediment__dialog{background:var(--xs-surface-card);color:var(--xs-text-body);border-radius:var(--xs-radius-card);max-width:var(--xs-size-modal-width,720px);max-height:90vh;overflow:auto;padding:var(--xs-space-card-pad);box-sizing:border-box}
.xs-sediment__dialog h2{font-size:1.05rem;font-weight:600;margin:0 0 8px}
.xs-sediment__part{border-top:1px solid var(--xs-edge-card);padding-top:8px;margin-top:8px}
.xs-sediment__part h4{font-size:.85rem;margin:0 0 4px;color:var(--xs-text-secondary)}
.xs-sediment__counts{font-weight:600;margin:4px 0}
.xs-sediment__diff{list-style:none;margin:4px 0;padding:0;max-height:12em;overflow:auto}
.xs-sediment__diff li{display:grid;grid-template-columns:18px minmax(0,1fr);gap:6px;padding:2px 0;border-bottom:1px solid var(--xs-edge-card)}
.xs-sediment__mark{font-family:var(--font-mono,monospace);color:var(--xs-text-code)}
.xs-sediment__diff-text{white-space:pre-wrap}
.xs-sediment__paths{list-style:none;margin:4px 0;padding:0;font-family:var(--font-mono,monospace);color:var(--xs-text-code);font-size:.85rem;word-break:break-all}
.xs-sediment__stale{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:8px;margin:6px 0}
.xs-sediment__error{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:8px;margin:6px 0}
.xs-sediment__gate-reason{font-size:.8rem;color:var(--xs-text-secondary);margin:6px 0 0}
.xs-sediment__notice{position:fixed;right:16px;bottom:16px;z-index:40;background:var(--xs-surface-card);color:var(--xs-text-body);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:12px}
@media(max-width: ${BREAKPOINT_WIDE_PX}px){.xs-sediment__dialog{max-width:none;width:100%;height:100%}}
`);
  installXuanshuStyles();
}

// src/client/shiji-api.ts
var SHIJI_ENDPOINTS = {
  list: "shiji.list",
  remove: "shiji.remove",
  restore: "shiji.restore",
  fromSession: "shiji.fromSession",
  settingsGet: "shiji.settings.get",
  settingsSet: "shiji.settings.set"
};
function unwrapWrite(value) {
  if (value?.ok === false) {
    throw new Error(value.error?.message ?? "事记操作失败（宿主没有给理由）。");
  }
  return value;
}
function createShijiApi(ctx) {
  return {
    list: (payload, signal) => rpcCall(ctx, SHIJI_ENDPOINTS.list, payload ?? {}, signal),
    remove: async (payload, signal) => unwrapWrite(await rpcCall(ctx, SHIJI_ENDPOINTS.remove, { id: payload.id, confirmed: true }, signal)),
    restore: async (payload, signal) => unwrapWrite(await rpcCall(ctx, SHIJI_ENDPOINTS.restore, { id: payload.id, confirmed: true }, signal)),
    fromSession: async (payload, signal) => unwrapWrite(
      await rpcCall(ctx, SHIJI_ENDPOINTS.fromSession, { sessionId: payload.sessionId, confirmed: true }, signal)
    ),
    getSettings: (signal) => rpcCall(ctx, SHIJI_ENDPOINTS.settingsGet, {}, signal),
    async setSettings(payload, signal) {
      const answer = await rpcCall(ctx, SHIJI_ENDPOINTS.settingsSet, payload, signal);
      if (answer?.ok !== true) {
        throw new Error(answer?.error?.message ?? "事记设置没写成（宿主没有给理由）。");
      }
      return { excludedDirs: Array.isArray(answer.excludedDirs) ? answer.excludedDirs : [] };
    }
  };
}

// src/client/shiji-views.tsx
var import_react23 = require("react");
var import_jsx_runtime26 = require("react/jsx-runtime");
var SHIJI_ENTRY_ID = "xuanshu.shiji-entry";
var SHIJI_SAVE_NOTE = "这一场的要点可以在你点了并确认之后，存成今天的一条事记。";
var SHIJI_SAVE_CONFIRM = "存成今天的事记？会把这场的要点写成一条事记，存下后可以在底稿里看到，也可以删掉。";
function errorText12(error) {
  return error instanceof Error ? error.message : String(error);
}
function XsShijiSaveEntry({ sessionId, api, navigate }) {
  const consult = isConsultSessionId(sessionId);
  const [open, setOpen] = (0, import_react23.useState)(false);
  const [busy, setBusy] = (0, import_react23.useState)(false);
  const [result, setResult] = (0, import_react23.useState)(void 0);
  if (!consult || api === void 0 || sessionId === void 0) return null;
  const save = () => {
    setBusy(true);
    setResult(void 0);
    void api.fromSession({ sessionId }).then((answer) => {
      if (answer.ok !== true) {
        setResult({ kind: "error", message: answer.error?.message ?? "没有写入任何事记（宿主没有给理由）。" });
        return;
      }
      setOpen(false);
      setResult({ kind: "ok", entry: answer.entry });
    }).catch((error) => {
      setResult({ kind: "error", message: errorText12(error) });
    }).finally(() => {
      setBusy(false);
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", { className: "xs-shiji__entry", "data-xuanshu-block": "shiji-entry", children: [
    /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(
      "button",
      {
        type: "button",
        className: "xs-btn",
        "data-xuanshu-action": "shiji-save-session",
        disabled: busy,
        onClick: () => {
          setOpen(true);
          setResult(void 0);
        },
        children: "存成今天的事记"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("span", { className: "xs-shiji__note", children: SHIJI_SAVE_NOTE }),
    open ? /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", { className: "xs-shiji__confirm", "data-xuanshu-confirm": "save-shiji", children: [
      /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("p", { "data-xuanshu-confirm-text": "save-shiji", children: SHIJI_SAVE_CONFIRM }),
      /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", { className: "xs-shiji__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("button", { type: "button", className: "xs-btn xs-btn--primary", "data-xuanshu-action": "shiji-save-confirm", disabled: busy, onClick: save, children: busy ? "存下中…" : "确认存下" }),
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(
          "button",
          {
            type: "button",
            "data-xuanshu-action": "shiji-save-cancel",
            disabled: busy,
            onClick: () => {
              setOpen(false);
            },
            children: "取消"
          }
        )
      ] })
    ] }) : null,
    result === void 0 ? null : result.kind === "ok" ? /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("p", { className: "xs-shiji__notice", role: "status", "data-xuanshu-notice": "shiji", children: [
      `已存成今天的事记：「${result.entry.name}」（${result.entry.lastActiveAt.slice(0, 10)}）`,
      navigate === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(
        "button",
        {
          type: "button",
          className: "xs-btn",
          "data-xuanshu-nav": "digao",
          onClick: () => {
            navigate("digao");
          },
          children: "打开底稿 →"
        }
      )
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("p", { className: "xs-shiji__error", role: "alert", "data-xuanshu-alert": "shiji", children: [
      `没有存成：${result.message}`,
      /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("button", { type: "button", className: "xs-shiji__retry", "data-xuanshu-action": "shiji-save-retry", disabled: busy, onClick: save, children: "重试" })
    ] })
  ] });
}
function installShiji(ctx, deps) {
  installShijiStyle();
  ctx.slots.inject(
    "conversation.composer.dock",
    () => ctx.slots.register(
      { name: "conversation.composer.dock", id: SHIJI_ENTRY_ID, inject: () => ({ ...deps }) },
      XsShijiSaveEntry
    )
  );
}
var SHIJI_SETTINGS_ID = "xuanshu.shiji";
var SHIJI_SETTINGS_LABEL = "事记";
var SHIJI_SETTINGS_ORDER = 26;
function tombstonesOf(entries) {
  return entries.filter((entry) => entry.excludedAt !== null && entry.excludedAt !== void 0);
}
function dayOf(iso) {
  return typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : "日期未知";
}
function XsShijiSettingsSection({ state, actions }) {
  const tombstones = tombstonesOf(state.entries);
  if (state.loading === true) {
    return /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", { className: "xs-shiji__settings", "data-xuanshu-section": "shiji", children: [
      /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("h2", { children: "事记" }),
      /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("p", { className: "xs-shiji__note", "data-xs-state": "loading", children: "正在读事记与排除目录…" })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", { className: "xs-shiji__settings", "data-xuanshu-section": "shiji", children: [
    /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("h2", { children: "事记" }),
    /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("p", { className: "xs-shiji__note", children: "这里管理「曾经做过什么」里的事记：删掉的可以恢复；被排除的目录不参与自动扫描。" }),
    /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("section", { className: "xs-shiji__block", "data-xuanshu-block": "shiji-restore", children: [
      /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("h3", { children: "已删除的事记（可恢复）" }),
      tombstones.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("p", { className: "xs-shiji__note", "data-xuanshu-empty": "tombstones", children: "没有被删除的事记。" }) : /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("ul", { className: "xs-shiji__list", children: tombstones.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("li", { className: "xs-shiji__row", "data-xuanshu-shiji": entry.id, children: [
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("span", { children: entry.name }),
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("span", { className: "xs-shiji__note", children: `删除于 ${dayOf(entry.excludedAt)}` }),
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(
          "button",
          {
            type: "button",
            "data-xuanshu-action": "restore-shiji",
            "data-xuanshu-shiji-id": entry.id,
            disabled: state.busy,
            onClick: () => actions.onRestore(entry.id),
            children: state.busy ? "恢复中…" : "恢复"
          }
        )
      ] }, entry.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("section", { className: "xs-shiji__block", "data-xuanshu-block": "shiji-excluded", children: [
      /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("h3", { children: "不参与自动扫描的目录" }),
      /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("p", { className: "xs-shiji__note", children: "相对项目根的路径（如 node_modules、dist）；绝对路径会被拒绝。" }),
      state.excludedDirs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("p", { className: "xs-shiji__note", "data-xuanshu-empty": "excluded", children: "没有排除目录。" }) : /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("ul", { className: "xs-shiji__list", children: state.excludedDirs.map((dir) => /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("li", { className: "xs-shiji__row", "data-xuanshu-excluded-dir": dir, children: [
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("code", { children: dir }),
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(
          "button",
          {
            type: "button",
            "data-xuanshu-action": "remove-excluded-dir",
            "data-xuanshu-dir": dir,
            disabled: state.busy,
            onClick: () => actions.onRemoveExcludedDir(dir),
            children: "移除"
          }
        )
      ] }, dir)) }),
      /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", { className: "xs-shiji__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("label", { children: [
          "目录",
          /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(
            "input",
            {
              type: "text",
              "data-xuanshu-field": "excluded-dir",
              value: state.draftDir,
              placeholder: "node_modules",
              onChange: (event) => actions.onDraftDirChange(event.target.value)
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("button", { type: "button", "data-xuanshu-action": "add-excluded-dir", disabled: state.busy, onClick: actions.onAddExcludedDir, children: "添加" })
      ] })
    ] }),
    state.error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("p", { className: "xs-shiji__error", role: "alert", "data-xuanshu-setting-error": "shiji", children: [
      state.error,
      /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("button", { type: "button", className: "xs-shiji__retry", "data-xuanshu-action": "shiji-settings-reload", disabled: state.busy, onClick: actions.onReload, children: "重试" })
    ] }),
    state.note === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("p", { className: "xs-shiji__note", role: "status", "data-xuanshu-notice": "shiji", children: state.note })
  ] });
}
function ShijiSettingsHost({ api }) {
  const [state, setState] = (0, import_react23.useState)({
    entries: [],
    excludedDirs: [],
    draftDir: "",
    busy: false,
    loading: true
  });
  const load = () => {
    setState((previous) => ({ ...previous, loading: true, error: void 0 }));
    void Promise.all([api.list({ includeDeleted: true }), api.getSettings()]).then(([list, settings]) => {
      setState((previous) => ({
        ...previous,
        loading: false,
        // 原样收下（墓碑与冻结都在里面）；筛「真实墓碑」是视图的事（`tombstonesOf`）。
        entries: Array.isArray(list.entries) ? list.entries : [],
        excludedDirs: Array.isArray(settings.excludedDirs) ? settings.excludedDirs : []
      }));
    }).catch((reason) => {
      setState((previous) => ({ ...previous, loading: false, error: `读不到事记设置：${errorText12(reason)}（点下面的「重试」再读一次；一直读不到就先看宿主的 shiji 服务在不在。）` }));
    });
  };
  (0, import_react23.useEffect)(() => {
    load();
  }, [api]);
  const writeExcludedDirs = (next, note) => {
    setState((previous) => ({ ...previous, busy: true, error: void 0, note: void 0 }));
    void api.setSettings({ excludedDirs: next }).then((saved) => {
      setState((previous) => ({ ...previous, busy: false, excludedDirs: saved.excludedDirs, note }));
    }).catch((reason) => {
      setState((previous) => ({ ...previous, busy: false, error: errorText12(reason) }));
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(
    XsShijiSettingsSection,
    {
      state,
      actions: {
        onDraftDirChange: (value) => {
          setState((previous) => ({ ...previous, draftDir: value, error: void 0 }));
        },
        onAddExcludedDir: () => {
          const dir = state.draftDir.trim();
          if (dir === "") {
            setState((previous) => ({ ...previous, error: "排除目录不能为空。" }));
            return;
          }
          if (state.excludedDirs.includes(dir)) {
            setState((previous) => ({ ...previous, error: `「${dir}」已经在列表里了。` }));
            return;
          }
          writeExcludedDirs([...state.excludedDirs, dir], `已排除目录「${dir}」。`);
        },
        onRemoveExcludedDir: (dir) => {
          writeExcludedDirs(state.excludedDirs.filter((entry) => entry !== dir), `已取消排除「${dir}」。`);
        },
        onRestore: (id) => {
          setState((previous) => ({ ...previous, busy: true, error: void 0, note: void 0 }));
          void api.restore({ id }).then(() => {
            setState((previous) => ({ ...previous, busy: false }));
            load();
            setState((previous) => ({ ...previous, note: "已恢复这条事记；下一轮扫描时，仍在的源头会重新记进来。" }));
          }).catch((reason) => {
            setState((previous) => ({ ...previous, busy: false, error: errorText12(reason) }));
          });
        },
        // 错误行旁边的出路：重读一次（`load` 会先清掉 error，再按宿主的真实回包落状态）。
        onReload: load
      }
    }
  );
}
function installShijiSettings(ctx, deps) {
  installShijiStyle();
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: SHIJI_SETTINGS_ID,
        order: SHIJI_SETTINGS_ORDER,
        label: SHIJI_SETTINGS_LABEL,
        inject: () => ({ api: deps.api })
      },
      ShijiSettingsHost
    )
  );
}
function installShijiStyle() {
  registerStyleSheet("xuanshu-shiji-style", `
.xs-shiji__entry{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0}
.xs-shiji__entry button{font:inherit}
.xs-shiji__note{font-size:.8rem;color:var(--xs-text-secondary);line-height:1.6}
.xs-shiji__confirm{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:8px 10px;margin:6px 0;flex-basis:100%}
.xs-shiji__confirm p{margin:0 0 6px}
.xs-shiji__actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.xs-shiji__actions button{font:inherit;padding:6px 12px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-shiji__actions button:disabled{opacity:.5;cursor:not-allowed}
.xs-btn--primary{background:var(--xs-constraint-human-gate-bg,var(--xs-accent));border-color:var(--xs-accent);color:var(--xs-constraint-human-gate-fg,var(--xs-accent-fg))}
.xs-shiji__notice,.xs-shiji__error{flex-basis:100%;font-size:.85rem;margin:4px 0;padding:8px 10px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-shiji__settings h2{margin:0 0 6px}
.xs-shiji__settings h3{margin:14px 0 4px;font-size:.95rem}
.xs-shiji__block{border-top:1px solid var(--xs-edge-card);margin-top:12px;padding-top:8px}
.xs-shiji__list{list-style:none;margin:6px 0;padding:0;display:flex;flex-direction:column;gap:6px}
.xs-shiji__row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.xs-shiji__row button{font:inherit;padding:4px 10px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-shiji__row button:disabled{opacity:.5;cursor:not-allowed}
.xs-shiji__settings input[type="text"]{font:inherit;margin-left:6px;padding:4px 8px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);background:var(--xs-surface-card);color:inherit}
.xs-shiji__error{color:var(--xs-text-secondary)}
.xs-shiji__retry{font:inherit;margin-left:8px;padding:2px 10px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-shiji__retry:disabled{opacity:.5;cursor:not-allowed}
`);
  installXuanshuStyles();
}

// src/client/style.ts
var OVERVIEW_SHEET_ID = "xuanshu-client/overview.css";
var OVERVIEW_CSS = `
.xs-overview {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--xs-space-section);
  padding: var(--xs-space-page);
  width: 100%;
  height: 100%;
  overflow: auto;
  background: var(--xs-surface-panel);
  color: var(--xs-text-body);
  /* 正文下限钉在**面板根**上（判据 C-001）：宿主在容器上定义了
     --dsh-content-font-size（真浏览器实测 14px），所以 var(…, 16px) 的 fallback 永远不生效 ——
     只有 max() 能把下限压住。放根上而不是逐条写：标题 / 段落 / 卡片正文都是从这条继承的，
     元信息自己声明 12–14px，不受影响（层级不塌）。 */
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}
.xs-overview__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--xs-space-row);
  flex-wrap: wrap;
}
.xs-overview__title {
  margin: 0;
  /* 标题档 18px（type-scale §2 title），不是正文档：卡片标题也落在 16px，
     两档同号同字重就等于没有标题 —— L-001 要防的正是这个。下限仍按 max() 钉。 */
  font-size: max(18px, var(--dsh-content-font-size, 16px));
  font-weight: 600;
  color: var(--xs-text-title);
}
.xs-overview__home {
  color: var(--xs-text-brand);
  font-weight: 600;
}
.xs-overview__localnote {
  margin: 0;
  /* 这里是 13px 级的路径正文，落在白底上：走 tertiary（bluish-600）只有 3.71:1，不到 AA 的 4.5:1。
     改用 secondary（bluish-700）= 5.80:1。为什么不把 tertiary 整体调深：它被全站共用，
     动一次就把所有面的观感一起改了，超出这张票（#64 / UX-02）的范围。 */
  color: var(--xs-text-secondary);
  font-size: var(--dsh-content-font-size-secondary, 14px);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
}
.xs-overview__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--xs-space-card-gap);
  width: 100%;
  max-width: var(--xs-size-panel-content-max);
  margin: 0 auto;
}
/* 宽屏（>= --xs-size-breakpoint-wide = 1100px）：2×2；窄屏单列按 D3 读序堆叠。 */
@media (min-width: ${BREAKPOINT_WIDE_PX}px) {
  .xs-overview__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.xs-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--xs-space-stack-md);
  min-height: var(--xs-size-card-minheight);
  padding: var(--xs-space-card-pad);
  background: var(--xs-surface-card);
  border: 1px solid var(--xs-edge-card);
  border-radius: var(--xs-radius-card);
}
.xs-card__head {
  display: flex;
  align-items: center;
  gap: var(--xs-space-row);
}
.xs-card__icon {
  flex: 0 0 auto;
  color: var(--xs-text-heading);
}
.xs-card__title {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
  font-size: max(16px, var(--dsh-content-font-size, 16px));
  font-weight: 600;
  color: var(--xs-text-heading);
}
.xs-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--xs-space-stack-sm);
  min-width: 0;
}
.xs-card__empty,
.xs-card__error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--xs-space-stack-sm);
  padding: var(--xs-space-stack-md);
  border-radius: var(--xs-radius-nested);
  background: var(--xs-surface-empty);
  color: var(--xs-state-empty-fg);
}
.xs-card__actions {
  display: flex;
  align-items: center;
  gap: var(--xs-space-toolbar);
  flex-wrap: wrap;
  margin-top: var(--xs-space-stack-sm);
}

.xs-empty__illus {
  width: 45%;
  max-width: 160px;
  height: auto;
  color: var(--xs-state-empty-fg);
}
.xs-empty__why {
  margin: 0;
  color: var(--xs-text-secondary);
  /* 空态「为什么空」是正文（人要先读懂这句才能决定下一步），不是元信息。 */
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}
.xs-empty__sub {
  margin: 0;
  /* 空态副行是这一面原先的最低对比度：tertiary 在空态底（--xs-surface-empty）上只有 3.42:1。
     它 13px、整句都是要读的信息，属「正文级」，因此按 WCAG AA 提到 secondary = 5.36:1。
     与 .xs-empty__why 同档：空态块里两行都是说明句，弱化不再靠「再暗一档」而是靠括号 / 位置
     （token 字典目前没有 tertiary 与 secondary 之间的中间档，见台账 §17.7.2 的字阶重排）。 */
  color: var(--xs-text-secondary);
  font-size: var(--dsh-content-font-size-secondary, 14px);
}

.xs-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: var(--xs-size-chip-height);
  padding: 0 8px;
  border-radius: var(--xs-radius-chip);
  font-size: var(--dsh-content-font-size-secondary, 14px);
  white-space: nowrap;
}
.xs-badge--readonly {
  color: var(--xs-constraint-readonly-fg);
  background: var(--xs-constraint-readonly-bg);
}
.xs-badge--derived {
  color: var(--xs-constraint-derived-fg);
  background: var(--xs-constraint-derived-bg);
}

.xs-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: var(--xs-size-control-height);
  padding: 0 12px;
  border: 1px solid var(--xs-edge-card-strong);
  border-radius: var(--xs-radius-control);
  background: transparent;
  color: var(--xs-text-body);
  font: inherit;
  cursor: pointer;
  transition: background var(--xs-motion-duration-fast) var(--xs-motion-ease-standard);
}
.xs-btn--primary {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: var(--xs-text-on-accent);
}
.xs-btn:focus-visible,
.xs-link:focus-visible,
.xs-cell:focus-visible {
  outline: 2px solid var(--xs-edge-focus);
  outline-offset: 2px;
}
.xs-btn[disabled],
.xs-link[disabled],
.xs-cell[disabled] {
  color: var(--xs-text-disabled);
  cursor: not-allowed;
}
.xs-btn[disabled] {
  border-color: var(--xs-edge-readonly);
  background: var(--xs-surface-readonly);
}
.xs-btn--primary[disabled] {
  background: var(--xs-surface-locked);
  color: var(--xs-text-disabled);
}
.xs-link {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  background: none;
  color: var(--xs-text-link);
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.xs-link[disabled] {
  text-decoration: none;
}

.xs-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--xs-space-stack-sm);
}
.xs-skeleton__bar,
.xs-skeleton__block {
  border-radius: var(--xs-radius-nested);
  background: var(--xs-surface-skeleton);
}
.xs-skeleton__bar {
  height: 10px;
  width: 60%;
}
.xs-skeleton__bar--head {
  height: 14px;
  width: 40%;
}
.xs-skeleton__bar--badge {
  height: var(--xs-size-chip-height);
  width: 96px;
  border-radius: var(--xs-radius-chip);
}
.xs-skeleton__blocks {
  display: flex;
  gap: var(--xs-space-row);
}
.xs-skeleton__block {
  flex: 1 1 0;
  height: 28px;
}
.xs-skeleton__shimmer {
  background-image: linear-gradient(90deg, transparent, var(--xs-state-loading-fg), transparent);
  opacity: 0.08;
  animation: xs-skeleton-sweep var(--xs-motion-duration-fast) var(--xs-motion-ease-standard) infinite;
}
@keyframes xs-skeleton-sweep {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .xs-skeleton__shimmer { animation: none; }
}

.xs-pillars {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--xs-space-row);
}
.xs-pillar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border-radius: var(--xs-radius-nested);
  background: var(--xs-surface-card-nested);
}
.xs-pillar__name {
  color: var(--xs-text-tertiary);
  /* 柱名与柱值同一行相邻两档：字重分（值 600 / 名 400），字号都吃 16px 下限。
     原先走 -secondary（14px）：它既不是 tag/badge，也不是路径/计数，判据按正文量，
     量出来就是 14px 红（ux-reports 2026-10-31T11-42-28 的 C-001 证据）。 */
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}
.xs-pillar__value {
  color: var(--xs-text-heading);
  font-weight: 600;
}
.xs-basis {
  display: flex;
  gap: var(--xs-space-row);
  flex-wrap: wrap;
  color: var(--xs-text-secondary);
  /* 依据行是正文（读得懂才敢信数），不是元信息：同样吃 16px 下限。 */
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}
.xs-lines {
  display: flex;
  flex-direction: column;
  gap: var(--xs-space-stack-sm);
}
.xs-line {
  display: flex;
  gap: var(--xs-space-row);
  color: var(--xs-text-body);
}
.xs-line__label {
  flex: 0 0 auto;
  color: var(--xs-text-tertiary);
}
.xs-line__value {
  min-width: 0;
}
.xs-digao-summary {
  margin: 0;
  color: var(--xs-text-body);
}
.xs-source-links {
  display: flex;
  align-items: center;
  gap: var(--xs-space-toolbar);
  flex-wrap: wrap;
  color: var(--xs-text-secondary);
  /* 出处链接文字是正文：这是「凭什么是这个结论」的入口，不吃小字。 */
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}

.xs-quicklinks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--xs-space-toolbar);
}
.xs-cell {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--xs-space-stack-sm);
  padding: var(--xs-space-card-pad);
  border: 1px solid var(--xs-edge-card);
  border-radius: var(--xs-radius-nested);
  background: var(--xs-surface-card-nested);
  color: var(--xs-text-heading);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--xs-motion-duration-fast) var(--xs-motion-ease-standard);
}
.xs-cell:hover:not([disabled]) {
  background: var(--xs-surface-interactive-hover);
}
.xs-cell[disabled] {
  background: var(--xs-surface-readonly);
}
.xs-cell__icon {
  color: inherit;
}
.xs-cell__title {
  font-weight: 600;
}
.xs-cell__subtitle {
  color: var(--xs-text-secondary);
  /* 快捷入口的副标题与标题相邻两档：字重分（标题 600 / 副标题 400），字号都吃 16px 下限。
     __subtitle 不在元信息词表里（词表按 sub / note 这类整词匹配），判据按正文量。 */
  font-size: max(16px, var(--dsh-content-font-size, 16px));
}
.xs-cell[disabled] .xs-cell__subtitle {
  color: var(--xs-text-disabled);
}
.xs-quicklinks__note {
  margin: var(--xs-space-stack-md) 0 0;
  /* 同 .xs-overview__localnote：13px 小字落卡面白底，tertiary 只有 3.71:1 → secondary = 5.80:1。 */
  color: var(--xs-text-secondary);
  font-size: var(--dsh-content-font-size-secondary, 14px);
  text-align: right;
}
`;
function installOverviewStyle() {
  registerStyleSheet(OVERVIEW_SHEET_ID, OVERVIEW_CSS);
  return installXuanshuStyles();
}

// src/client/tokens.ts
var THEME_SOURCE = xs_tokens_default.source;
var THEME_TOKENS = xs_tokens_default.tokens;

// src/client/index.tsx
var inject = ["slots", "layout", "theme", "connection"];
function apply(ctx) {
  installOverviewStyle();
  ctx.effect(
    () => ctx.theme.overrideTokens(THEME_SOURCE, THEME_TOKENS),
    "xuanshu-client: theme token overrides"
  );
  let mainPanels = EMPTY_MAIN_PANELS;
  ctx.effect(() => {
    const handle = createMainPanelsWatch(ctx.slots);
    mainPanels = handle.watch;
    return () => {
      handle.dispose();
      mainPanels = EMPTY_MAIN_PANELS;
    };
  }, "xuanshu-client: main panel watch");
  const navigate = (target) => {
    if (target === "conversation") {
      ctx.layout.selectPanel(null);
      return;
    }
    if (!mainPanels.getSnapshot().includes(target)) return;
    ctx.layout.selectPanel(target);
  };
  const rpc = ctx;
  const bazi = createBaziApi(rpc);
  const baziController = createBaziUiController();
  const aiReadiness = createAiReadinessController({ api: createAiApi(rpc) });
  const baziDeps = { api: bazi, controller: baziController, navigate, aiStatus: aiReadiness };
  const consultApi = createConsultApi(rpc);
  const uiWorkspace = readService(rpc, "uiWorkspace");
  const sessionCatalog = readService(rpc, "sessions");
  const openSessionFn = uiWorkspace?.openSession;
  const openSession = typeof openSessionFn === "function" ? (sessionId) => {
    openSessionFn(sessionId);
  } : void 0;
  const refreshSessions = typeof sessionCatalog?.refresh === "function" ? async () => {
    await sessionCatalog.refresh?.();
  } : void 0;
  const mountsApi = createMountsApi(rpc);
  const workspaceCatalog = createWorkspaceCatalog(ctx);
  const mountsController = createMountsController2({
    api: mountsApi,
    workspaces: () => workspaceCatalog.list(),
    workspaceAvailable: workspaceCatalog.available
  });
  const rikke = createRikkeApi(rpc);
  const rikkeController = createRikkeUiController(rikke);
  const wansheng = createWanshengApi(rpc);
  const wanshengController = createWanshengUiController(wansheng);
  const notify = createNotifyApi(rpc);
  const digao = createDigaoApi(rpc);
  const digaoController = createDigaoUiController(digao);
  const shiji = createShijiApi(rpc);
  const workflow = createWorkflowApi(rpc);
  const sediment = createSedimentApi(rpc);
  const sedimentController = createSedimentController(sediment);
  const bestof = createBestofApi(rpc);
  const bestofController = createBestofController({ api: bestof });
  const data = createDataApi(rpc);
  const homePaths = createHomePathsWatch();
  void primeHomePaths(homePaths, data);
  const injected = () => ({
    navigate,
    mainPanels,
    // 票 08：冷启动向导与命盘详情都是**已装配**的面板（本文件下面就注册它们），
    // 所以这两个回调从此不再是「未接线」——命盘卡的两个出口因此可用。
    onStartOnboarding: () => {
      navigate("onboarding");
    },
    onOpenDetail: () => {
      navigate("mingpan");
    },
    // 卡级重试：让控制器代次 +1，概览的 `useBaziStatus` 据此重取快照（不重新出盘）。
    onRetry: () => {
      baziController.invalidate();
    },
    bazi,
    baziController,
    // 票 13：三份数据面与两个控制器都从注入面进概览；`onGenerate` / `onRefresh`
    // **不在这里给**——概览面板自己用控制器造（保证「人点才跑」只有一条路径）。
    rikke,
    rikkeController,
    digao,
    digaoController,
    // #25：晚省（第 5 张卡）。
    wansheng,
    wanshengController,
    // #29：问事入口的门禁读这一份只读状态（与向导第 6 步同一个控制器）。
    aiStatus: aiReadiness,
    // R3：宿主回传的 home / dataDir（概览页眉「数据都在本地 …」用它，不是占位）。
    homePaths
  });
  ctx.slots.inject("main", () => {
    const dispose = ctx.slots.register(
      { name: "main", key: PANEL_ID, inject: injected },
      OverviewPanel
    );
    ctx.layout.selectPanel(PANEL_ID);
    const disposeHash = installOverviewHashBridge(ctx);
    return () => {
      disposeHash?.();
      dispose();
    };
  });
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      { name: "sidebar.panellist", id: PANEL_ID, order: PANEL_ORDER, label: PANEL_LABEL },
      OverviewIcon
    )
  );
  installPuPanel(rpc);
  installCangClient(rpc);
  installOnboarding(rpc, baziDeps);
  installMingpan(rpc, { ...baziDeps, homePaths });
  installConsult(rpc, {
    api: consultApi,
    navigate,
    openSession,
    refreshSessions,
    // R3：历史页错误行那句「数据在本地 <home>/sessions/」读同一份注入面。
    homePaths,
    mountSlot: (session) => (0, import_react24.createElement)(MountsSectionFor, { controller: mountsController, session })
  });
  installMounts(rpc, { api: mountsApi, workspaces: () => workspaceCatalog.list(), workspaceAvailable: workspaceCatalog.available });
  installDigao(rpc, { api: digao, shiji, navigate });
  installRikke(rpc, { api: rikke, navigate, notify });
  installTouchSettings(rpc, { rikke, notify });
  installWorkflowPanel(rpc, { api: workflow, navigate });
  installSediment(rpc, { api: sediment, controller: sedimentController, navigate, homePaths });
  installBestOf(ctx, {
    api: bestof,
    controller: bestofController,
    resolveSessionId: async () => {
      try {
        const { items } = await consultApi.list();
        return items[0]?.sessionId;
      } catch {
        return void 0;
      }
    }
  });
  installDataSettings(rpc, { api: data });
  installShijiSettings(rpc, { api: shiji });
  installShiji(rpc, { api: shiji, navigate });
  installWansheng(rpc, { api: wansheng, navigate, notify });
}
		// 包体中途执行过 module.exports = __toCommonJS(...)，上面的 exports 已过期；
		// 必须重新读取 module.exports，逐个补拷会漏掉将来的新导出。
		return module.exports;
	}
});
