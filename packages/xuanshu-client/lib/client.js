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
var import_react15 = require("react");

// src/client/rpc.ts
async function rpcCall(ctx, method, payload = {}, signal) {
  const result = await ctx.connection.rpc.call("/xuanshu", method, payload, signal);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
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

// src/client/CangPanel.tsx
var import_react = require("react");

// src/client/cang-model.ts
var CANG_AI_FREE = "藏永不进 AI：只登记指针、签与跳转 —— 玄枢不读、不索引、不分析、不进上下文";
var newCangDraft = () => ({ path: "", name: "", tags: [], actions: { open: true, reveal: true, copy: true } });

// src/client/CangPanel.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function filterCangEntries(entries, query, tag, sort) {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => (!tag || entry.tags.includes(tag)) && (!needle || [entry.name, ...entry.tags].some((value) => value.toLocaleLowerCase().includes(needle)))).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "zh-CN") : b.createdAt.localeCompare(a.createdAt));
}
function CangPanel({ api, controller, navigatePus, initialData }) {
  const state = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
  const [data, setData] = (0, import_react.useState)(initialData);
  const [loading, setLoading] = (0, import_react.useState)(!initialData);
  const [error, setError] = (0, import_react.useState)("");
  const [notice, setNotice] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [reload, setReload] = (0, import_react.useState)(0);
  const [query, setQuery] = (0, import_react.useState)("");
  const [tag, setTag] = (0, import_react.useState)("");
  const [sort, setSort] = (0, import_react.useState)("recent");
  const [desktop, setDesktop] = (0, import_react.useState)(true);
  const [remove, setRemove] = (0, import_react.useState)();
  (0, import_react.useEffect)(() => {
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
  const tags = [...new Set(entries.flatMap((entry) => entry.tags))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const filtered = filterCangEntries(entries, query, tag, sort);
  const groups = /* @__PURE__ */ new Map();
  for (const entry of filtered) for (const label of entry.tags.length ? entry.tags : ["未贴签"]) groups.set(label, [...groups.get(label) ?? [], entry]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "xs-cang", "data-xuanshu-panel": "cang", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "藏库" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xs-cang__boundary", "data-xuanshu-note": "no-ai", children: CANG_AI_FREE }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
      "谱会被 AI 读进上下文；藏只是你自己的本地文件入口。",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: !navigatePus, onClick: navigatePus, children: "查看谱" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "藏不是挂载对象；工作区与工作流走临时挂载。" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-cang__toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: loading || !!error, onClick: () => controller.edit(newCangDraft()), children: "登记藏" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
        "搜藏名 / 签 ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { value: query, onChange: (event) => setQuery(event.target.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
        "签 ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { value: tag, onChange: (event) => setTag(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "全部" }),
          tags.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: value }, value))
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
        "排序 ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { value: sort, onChange: (event) => setSort(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "recent", children: "最近登记" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "name", children: "名称" })
        ] })
      ] })
    ] }),
    loading && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: "正在读取藏库注册表…" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
        "注册表读取失败：",
        error
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => setReload((value) => value + 1), children: "重试" })
    ] }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: notice }),
    !loading && !error && !entries.length && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-cang__empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "你还没有登记任何藏。藏只登记指针，不复制文件。" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => controller.edit(newCangDraft()), children: "登记第一个藏" })
    ] }),
    !loading && !error && !!entries.length && !filtered.length && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "没有匹配的藏名或签。" }),
    !loading && !error && [...groups].map(([label, items]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { open: true, className: "xs-cang__group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { children: [
        "签「",
        label,
        "」（",
        items.length,
        "）"
      ] }),
      items.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: "xs-cang__card", "data-cang-id": entry.id, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", { children: [
          entry.name,
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xs-cang__status", children: "已登记" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
          "签：",
          entry.tags.join(" · ") || "未贴签"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
          "路径（只读）：",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: entry.path })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
          entry.pointer.valid ? "指针有效 · 玄枢未读取" : `指针失效 · ${entry.pointer.reason ?? ""}`,
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
            "最后校验：",
            entry.pointer.checkedAt
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-cang__actions", children: [
          entry.actions.open && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "data-action": "open", disabled: busy || !desktop || !entry.pointer.valid, title: !desktop ? "宿主没有可用桌面，请复制路径在本机打开" : entry.pointer.reason, onClick: () => void action(() => api.open(entry.id)), children: "以默认程序打开" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "xs-cang__more", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "更多操作" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
              entry.actions.reveal && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: busy || !desktop || !entry.pointer.valid, onClick: () => void action(() => api.reveal(entry.id)), children: "显示所在位置" }),
              entry.actions.copy && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: busy, onClick: () => void action(() => navigator.clipboard.writeText(entry.path)), children: "复制路径" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => controller.edit(entry), children: entry.pointer.valid ? "编辑登记" : "重新定位" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => setRemove(entry), children: "移除登记" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "本卡没有：摘要 / 问答 / 「让 AI 看看」/ 加入上下文 / 挂载到会话" })
      ] }, entry.id))
    ] }, label)),
    remove && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xs-cang__confirm", role: "alertdialog", "aria-label": "确认移除登记", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
        "只从藏库移除「",
        remove.name,
        "」的登记，不会删除你的文件。"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: busy, onClick: () => void action(async () => {
        await api.remove(remove.id);
        setRemove(void 0);
        controller.changed();
      }), children: "确认移除登记" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: busy, onClick: () => setRemove(void 0), children: "取消" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: data?.registryPath ?? "~/.dsh/xuanshu/cang/registry.jsonl" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "只存指针 + 签 + 跳转，不存内容。拷走注册表 ≠ 拷走这些文件；换机器后请重新定位。" })
    ] })
  ] });
}

// src/client/CangDrawer.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
function CangOverlay({ api, controller }) {
  const { draft } = (0, import_react2.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
  return draft ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(CangDrawer, { api, controller, initial: draft }) : null;
}
function CangDrawer({ api, controller, initial }) {
  const [draft, setDraft] = (0, import_react2.useState)(() => ({ ...initial, tags: [...initial.tags], actions: { ...initial.actions } }));
  const [tags, setTags] = (0, import_react2.useState)(initial.tags.join("，"));
  const [nameTouched, setNameTouched] = (0, import_react2.useState)(Boolean(initial.name));
  const [pointer, setPointer] = (0, import_react2.useState)();
  const [picker, setPicker] = (0, import_react2.useState)(false);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)("");
  const dialog = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    const abort = new AbortController();
    setPointer(void 0);
    if (draft.path.trim()) api.validate(draft.path, abort.signal).then((value) => {
      if (!abort.signal.aborted) setPointer(value);
    }).catch((reason) => {
      if (!abort.signal.aborted) setError(String(reason.message ?? reason));
    });
    return () => abort.abort();
  }, [api, draft.path]);
  (0, import_react2.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "xs-cang__overlay", onMouseDown: (event) => {
    if (event.target === event.currentTarget && !busy) controller.close();
  }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { ref: dialog, className: "xs-cang__drawer", role: "dialog", "aria-modal": "true", "aria-labelledby": "xs-cang-drawer-title", onKeyDown: (event) => {
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
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { id: "xs-cang-drawer-title", children: draft.id ? "编辑登记" : "登记藏" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "xs-cang__boundary", children: CANG_AI_FREE }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("form", { onSubmit: (event) => {
      event.preventDefault();
      if (pointer?.valid && draft.name.trim() && !busy) void submit();
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
        "本地文件 / 文件夹路径",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { value: draft.path, onChange: (event) => changePath(event.target.value), disabled: busy, required: true })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: () => void pick(), disabled: busy || !picker, title: !picker ? "宿主未提供系统目录选择器，可粘贴本地路径" : void 0, children: "选择文件夹…" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "系统选择器只取指针。文件藏请粘贴本地路径；玄枢不复制、不移动、不修改内容。" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
        "名称",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { value: draft.name, onChange: (event) => {
          setNameTouched(true);
          setDraft((value) => ({ ...value, name: event.target.value }));
        }, maxLength: 200, required: true, disabled: busy })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
        "签（用逗号分隔）",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { value: tags, onChange: (event) => setTags(event.target.value), disabled: busy })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("fieldset", { disabled: busy, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("legend", { children: "跳转入口" }),
        ["open", "reveal", "copy"].map((key, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "checkbox", checked: draft.actions[key], onChange: (event) => setDraft((value) => ({ ...value, actions: { ...value.actions, [key]: event.target.checked } })) }),
          ["以默认程序打开", "在文件管理器中显示", "复制路径"][index]
        ] }, key))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "校验只做路径可达性判断，不读取内容、不列目录、不算大小、不建索引。" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", children: !draft.path.trim() ? "请选择或粘贴本地路径。" : !pointer ? "正在校验指针…" : pointer.valid ? `指针有效 · 类型=${pointer.kind === "directory" ? "文件夹" : "文件"} · 玄枢未读取` : pointer.reason }),
      error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "xs-cang__toolbar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "submit", disabled: busy || !pointer?.valid || !draft.name.trim(), children: busy ? "正在处理…" : draft.id ? "保存登记" : "登记" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: controller.close, disabled: busy, children: "取消" })
      ] })
    ] })
  ] }) });
}

// src/client/cang-style.ts
function installCangStyle() {
  if (typeof document === "undefined" || document.getElementById("xuanshu-cang-style")) return;
  const style = document.createElement("style");
  style.id = "xuanshu-cang-style";
  style.textContent = `
.xs-cang{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-cang h1,.xs-cang h2{font-weight:600}.xs-cang h2{font-size:1.05rem}.xs-cang p{line-height:1.6}.xs-cang__boundary{position:sticky;top:0;z-index:1;background:var(--xs-constraint-noai-bg);color:var(--xs-constraint-noai-fg);padding:12px;border-radius:8px}
.xs-cang__toolbar,.xs-cang__actions{display:flex;align-items:center;flex-wrap:wrap;gap:var(--xs-space-toolbar);margin:16px 0}.xs-cang button,.xs-cang__drawer button{font:inherit;padding:7px 12px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}.xs-cang button:disabled,.xs-cang__drawer button:disabled{opacity:.5;cursor:not-allowed}
.xs-cang input,.xs-cang select,.xs-cang__drawer input{font:inherit;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:7px;min-width:0}.xs-cang__card{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:var(--xs-space-card-pad);margin:12px 0;background:var(--xs-surface-card)}.xs-cang code{overflow-wrap:anywhere;font-family:var(--font-mono,monospace);color:var(--xs-text-code)}.xs-cang__status{font-size:.8rem;font-weight:400}.xs-cang__more>summary{cursor:pointer}.xs-cang__more>div{display:flex;flex-wrap:wrap;gap:8px}.xs-cang__group>summary{padding:8px;cursor:pointer}.xs-cang footer{margin-top:24px;color:var(--xs-text-secondary)}.xs-cang__confirm{padding:16px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-nested)}
.xs-cang__overlay{position:fixed;inset:0;display:flex;justify-content:flex-end;background:var(--xs-surface-overlay-mask);pointer-events:auto;z-index:100}.xs-cang__drawer{width:min(560px,100%);overflow:auto;background:var(--xs-surface-overlay);color:var(--xs-text-body);padding:var(--xs-space-overlay-pad);box-sizing:border-box;box-shadow:0 0 30px rgb(0 0 0 / .15)}.xs-cang__drawer form>label{display:block;margin:16px 0}.xs-cang__drawer form>label input{display:block;box-sizing:border-box;width:100%;margin-top:8px}.xs-cang__drawer fieldset label{display:block;margin:8px 0}.xs-cang__drawer fieldset input{margin-right:8px}
@media(min-width:1100px){.xs-cang__more>summary{display:none}.xs-cang__more:not([open])>div{display:flex}}
@media(max-width:700px){.xs-cang{padding:14px}.xs-cang__toolbar{align-items:stretch;flex-direction:column}.xs-cang__drawer{padding:16px}}`;
  document.head.appendChild(style);
}

// src/client/cang.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
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
    edit: (draft) => {
      state = { ...state, draft };
      notify();
    },
    close: () => {
      state = { ...state, draft: void 0 };
      notify();
    },
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
  const navigatePus = () => {
    if (ctx.slots.entries("main").some((entry) => entry.options?.key === "pus")) ctx.layout.selectPanel("pus");
  };
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "cang", inject: () => ({ api, controller, navigatePus }) }, CangPanel));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: "cang", order: 50, label: "藏" }, CangIcon));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "xuanshu-cang-drawer", inject: () => ({ api, controller }) }, CangOverlay));
}
function CangIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M4.5 8 L12 4 L19.5 8" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("rect", { x: "5.5", y: "8", width: "13", height: "11.5", rx: "2" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M12 5.5 V9.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("circle", { cx: "12", cy: "14", r: "1.8" })
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
    read: (payload, signal) => rpcCall(ctx, CONSULT_ENDPOINTS.read, payload, signal),
    rename: (payload, signal) => rpcCall(ctx, CONSULT_ENDPOINTS.rename, payload, signal),
    defaults: (signal) => rpcCall(ctx, CONSULT_ENDPOINTS.defaults, {}, signal)
  };
}

// src/client/consult.tsx
var import_react4 = require("react");

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
  noneOptionalPu: "谱都非必填；你可以先空手问一句，或先去建一个谱（去 S5）。",
  /** 历史子页首次空态（S7 §2.3①）。 */
  noRecords: "还没有问事记录",
  noRecordsSub: "每次问事都会自动存成本地文件，随时能回来接着读。",
  /** 数据形态说明行（S7 §2.1③）。 */
  storageNote: "会话记录 = 本地文件（JSONL 事件日志），玄枢只读不改",
  searchBoundary: "列表按本地时间倒序；搜索只搜本次问事的标题与首句，不搜全文",
  /** 无源拦截引导的标题与两条去路（S6 §5 步骤 5a）。 */
  nudgeTitle: "需要先给这一问一点依据",
  nudgePathPu: "在勾选区勾一个谱",
  nudgePathMount: "临时挂载一个工作区 / 工作流（去 S8）",
  /** 末条：显式的泛问出口 —— 不是「没有谱就不能问」。 */
  nudgePlainExit: "只带底座 + 底稿问一次"
};
function nudgeNeeded(input) {
  return input.question.trim() !== "" && input.selected.length === 0 && input.mounts.length === 0;
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
var import_react3 = require("react");
var import_jsx_runtime4 = require("react/jsx-runtime");
function lockedExplain(source) {
  return source.kind === "digao" ? "底稿与八字同级、默认必加载的基础谱；它是纯派生的，要改就改源头（谱 / 工作区 / 工作流）。" : "底座始终在场、不可关：它是每一场问事的前提。";
}
function XsConsultPicker({ required, optional, selected, onToggle, onManagePu, onOpenDetail }) {
  const groups = groupOptional(optional);
  const [explaining, setExplaining] = (0, import_react3.useState)(void 0);
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "xs-consult__block", "data-xuanshu-block": "pu-picker", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { children: "① 本次要用的谱（勾选）" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { className: "xs-consult__group-head", "data-xuanshu-group-head": "locked", children: "── 默认在场 · 不可关 ──" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("ul", { className: "xs-consult__locked", "data-xuanshu-locked-list": String(required.length), children: required.map((source) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "xs-consult__row xs-consult__row--locked", "data-xuanshu-locked": source.kind, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
        "button",
        {
          type: "button",
          className: "xs-consult__locked-hit",
          "data-xuanshu-action": "locked-why",
          onClick: () => {
            setExplaining(explaining === source.kind ? void 0 : source.kind);
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__lock", "aria-hidden": "true", children: "🔒" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__row-name", children: source.name }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { "aria-hidden": "true", children: "·" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__badge", "data-xuanshu-badge": "locked", children: "默认在场 · 不可关" }),
            source.kind === "digao" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__badge", "data-xuanshu-badge": "derived", children: "纯派生 · 不可手改" }) : null
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
        "div",
        {
          className: "xs-consult__locked-card",
          "data-xuanshu-locked-card": source.kind,
          hidden: explaining !== source.kind,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: lockedExplain(source) }),
            source.present ? null : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": `locked-absent-${source.kind}`, children: source.reason ?? "这一项现在不在场" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "xs-consult__actions", children: source.kind === "digao" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "locked-goto-pu", onClick: onManagePu, children: "去谱管理 ▸" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__note", children: "三个源头：谱（在谱管理里改）/ 工作区 / 工作流；底稿本身在底稿面板看。" })
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "locked-goto-mingpan", onClick: onOpenDetail, children: "去命盘详情 ▸" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__note", children: "要改出生信息：走命盘详情里的「重新录制出生信息」。" })
            ] }) })
          ]
        }
      )
    ] }, source.kind)) }),
    groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__group", "data-xuanshu-group": group.level, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { className: "xs-consult__group-head", children: group.level === "base" ? "── 基础输入级 base · 默认勾选" : "── 可选输入级 optional" }),
      group.items.map((source) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "xs-consult__row", "data-xuanshu-pu": source.slug, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__row-name", children: source.name }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("small", { className: "xs-consult__note", children: source.summary })
      ] }, source.slug))
    ] }, group.level)),
    optional.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "no-optional-pu", children: historyEmptyCopy.noneOptionalPu }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "xs-consult__actions", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "manage-pu", onClick: onManagePu, children: "管理谱 ▸ S5" }) })
  ] });
}
function XsConsultMountPlaceholder({ mounts }) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "xs-consult__block", "data-xuanshu-block": "mounts", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { children: "③ 临时挂载（工作区 / 工作流）" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "mount-boundary", children: "工作区 / 工作流不是谱：它们是**挂载**，谱是**勾选**。" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "button",
        {
          type: "button",
          "data-xuanshu-action": "open-mounts",
          disabled: true,
          title: "临时挂载账本还没装配（属票 12 · 临时挂载账本）",
          children: "＋ 临时挂载"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "xs-consult__note", "data-xuanshu-note": "mount-placeholder", children: [
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
  onQuestion,
  onStart,
  onPlainAsk,
  onGotoHistory,
  onClearNudge
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "xs-consult__block", "data-xuanshu-block": "ask", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { children: "② 说事（可先空手开一个会话）" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__summary", "data-xuanshu-note": "context-summary", children: `本次上下文将含：${summary}` }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "ask-selection", children: `已勾 ${String(selected.length)} 个可选谱 · 已挂 ${String(mounts.length)} 项（底座与底稿恒在场，不在这里计）` }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "xs-consult__field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: "这一次想问什么" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "xs-consult__actions", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
    nudge ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__nudge", "data-xuanshu-nudge": "no-source", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__nudge-title", children: historyEmptyCopy.nudgeTitle }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("ol", { className: "xs-consult__paths", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("li", { children: historyEmptyCopy.nudgePathPu }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("li", { children: historyEmptyCopy.nudgePathMount })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "clear-nudge", onClick: onClearNudge, children: "回到勾选区" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "plain-ask", onClick: onPlainAsk, children: historyEmptyCopy.nudgePlainExit }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "goto-history", onClick: onGotoHistory, children: "改从历史里接着问 ▸" })
      ] })
    ] }) : null,
    error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__error", "data-xuanshu-error": "create", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "retry-create", onClick: onStart, children: "重试开会话" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "goto-history", onClick: onGotoHistory, children: "改从历史里接着问 ▸" })
      ] })
    ] })
  ] });
}
function XsConsultRecentCard({ session, onContinue, onHistory }) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "xs-consult__block", "data-xuanshu-block": "recent", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { children: "④ 最近一次会话" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "xs-consult__recent-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__shortid", "data-xuanshu-short-id": shortConsultId(session.sessionId), children: shortConsultId(session.sessionId) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: session.title }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("small", { className: "xs-consult__note", children: formatHistoryMeta(session) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "continue-consult", onClick: onContinue, children: "继续这次问事 ▸" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "toggle-history", onClick: onHistory, children: "历史回看 ▸" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "lobby-boundary", children: "ⓘ 本面板是「书房门厅」：进会话后切到 DSH 会话面板，工具轨迹与审批卡在那里。" })
  ] });
}
function XsConsultHistoryList({
  items,
  loading,
  error,
  query,
  range,
  now,
  onQuery,
  onRange,
  onOpen,
  onBack,
  onStart,
  onManagePu,
  onRetry
}) {
  const filtered = filterHistory(items, query, range, now);
  const groups = groupHistory(filtered, now);
  const neverAsked = items.length === 0;
  const noMatch = !neverAsked && filtered.length === 0;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "xs-consult__history", "data-xuanshu-view": "history-list", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "back-lobby", onClick: onBack, children: "← 回到当前会话" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
        "select",
        {
          "data-xuanshu-field": "history-range",
          value: range,
          onChange: (event) => {
            onRange(event.target.value);
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "all", children: "全部" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "today", children: "今天" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "earlier", children: "更早" })
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "button",
        {
          type: "button",
          "data-xuanshu-action": "export-selected",
          disabled: true,
          title: "契约未冻结导出 RPC（属后续票）",
          children: "导出选中"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "delete-selected", disabled: true, title: "契约未冻结删除 RPC（属后续票）", children: "删除" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "contract-scope", children: "契约未冻结导出与删除的 RPC（§2 只有六个方法）：这两个动作先置灰，不做假按钮。" }),
    loading ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", "data-xuanshu-state": "loading", children: "正在读本地会话清单…" }) : null,
    error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__error", "data-xuanshu-error": "list", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", children: "数据在本地：~/.dsh/sessions/（只读展示）" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "xs-consult__actions", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "retry-list", onClick: onRetry, children: "重试" }) })
    ] }),
    !loading && error === void 0 && neverAsked ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__empty", "data-xuanshu-state": "empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__empty-why", children: historyEmptyCopy.noRecords }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", children: historyEmptyCopy.noRecordsSub }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "xs-btn xs-btn--primary", "data-xuanshu-action": "start-consult", onClick: onStart, children: "＋ 开一次问事 ▸ S6" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "manage-pu", onClick: onManagePu, children: "管理谱 ▸ S5" })
      ] })
    ] }) : null,
    !loading && error === void 0 && noMatch ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__empty", "data-xuanshu-state": "no-match", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__empty-why", children: `没有匹配「${query}」的记录` }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "clear-filter", onClick: () => {
          onQuery("");
        }, children: "清空筛选" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "start-consult", onClick: onStart, children: "＋ 开一次问事 ▸ S6" })
      ] })
    ] }) : null,
    groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__group", "data-xuanshu-history-group": group.key, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { className: "xs-consult__group-head", children: group.label }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("ul", { className: "xs-consult__rows", children: group.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
        "button",
        {
          type: "button",
          className: "xs-consult__row-hit",
          "data-xuanshu-row": item.sessionId,
          onClick: () => {
            onOpen(item.sessionId);
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__shortid", children: shortConsultId(item.sessionId) }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__row-title", children: item.title }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("small", { className: "xs-consult__note", children: formatHistoryMeta(item) })
          ]
        }
      ) }, item.sessionId)) })
    ] }, group.key)),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "history-storage", children: historyEmptyCopy.storageNote }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "history-search-boundary", children: historyEmptyCopy.searchBoundary })
  ] });
}
function XsConsultHistoryReader({
  session,
  messages,
  loading = false,
  error,
  onBack,
  onContinue,
  onRetry
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "xs-consult__reader", "data-xuanshu-view": "reader", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "back-list", onClick: onBack, children: "← 列表" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__shortid", children: shortConsultId(session.sessionId) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__row-title", children: session.title }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("small", { className: "xs-consult__note", children: formatHistoryMeta(session) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__badge", "data-xuanshu-badge": "readonly", children: "【只读 · 不可编辑】" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "continue-consult", onClick: onContinue, children: "继续这次问事 ▸" })
    ] }),
    loading ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", "data-xuanshu-state": "loading", children: "正在读这条会话…" }) : null,
    error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__error", "data-xuanshu-error": "read", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-consult__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "retry-read", onClick: onRetry, children: "重试" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-xuanshu-action": "back-list", onClick: onBack, children: "返回列表" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "xs-consult__messages", children: messages.map((message, index) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "article",
      {
        className: `xs-consult__message xs-consult__message--${message.role}`,
        "data-xuanshu-message": message.role,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-consult__role", children: roleLabel(message.role) }),
          message.source === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("small", { className: "xs-consult__note", "data-xuanshu-source": message.source, children: `注入 · ${message.source}` }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__text", children: message.text })
        ]
      },
      `${String(index)}-${message.role}`
    )) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "reader-readonly", children: "回看是只读的：不改会话记录、不进会话、不追加任何事件。" })
  ] });
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
var PANEL_LOCAL_NOTE = "数据都在本地 ~/.dsh/xuanshu/";
var CARD_TITLE = {
  mingpan: "命盘 / 八字",
  rike: "日课",
  digao: "底稿",
  quicklinks: "快捷入口"
};
var BADGE_READONLY = "只读 · 由出生信息与底座生成";
var BADGE_DERIVED = "纯派生 · 不可手改";
var QUICKLINK = {
  consult: { title: "问事", subtitle: "书房" },
  conversation: { title: "工作区", subtitle: "车间" },
  workflow: { title: "工作流", subtitle: "流水线" }
};
var QUICKLINK_CONSULT_UNREADY = "底座未立 · 会先引导你填出生信息";
var QUICKLINKS_BOUNDARY = "谱 / 藏 / 定时任务是管理入口，在侧栏「库」与设置里，不在本卡。";
var EMPTY_COPY = {
  mingpan: {
    why: "底座还没立起来",
    sub: "填一次出生信息，命盘就点亮了。（预计 1 分钟；之后不再重复录入）"
  },
  rike: {
    why: "今天还没有生成日课。日课默认每天 07:30 生成。",
    sub: "（底座未立时生成会失败）"
  },
  digaoUnready: {
    why: "底座未立，还没有可提炼的来源。",
    sub: "这里不会先有内容：提炼源是 0。"
  },
  digaoNeverRefreshed: {
    why: "底稿还没生成过。",
    sub: "刷新一次就会按三路来源拼出骨架。"
  }
};
var ERROR_COPY = {
  mingpan: "命盘快照读不出来（文件缺失或格式不符）。",
  rike: "日课生成失败：底座未就绪 / 推运调用失败。",
  digao: "底稿读不出来。"
};
var ACTION_COPY = {
  startOnboarding: "开始填写出生信息 ->",
  openDetail: "看详情 ->",
  generate: "立即生成",
  watchFull: "看完整日课 ->",
  changeTime: "改时间 ->",
  openDigao: "打开底稿 ->",
  refresh: "刷新",
  retry: "重试",
  sourcePu: "谱",
  sourceWorkspace: "工作区",
  sourceWorkflow: "工作流",
  adjustSource: "要改就改源头："
};
var DISABLED_REASON = {
  consult: "问事面板还没装配（属票 10 · 问事闭环）",
  workflow: "工作流面板还没装配（属票 16 · 工作流创建向导）",
  pus: "谱面板还没装配（属票 09 · 谱管理）",
  digao: "底稿面板还没装配（属票 13 · 底稿与日课）",
  rikke: "日课面板还没装配（属票 13 · 底稿与日课）",
  onboarding: "八字冷启动向导还没装配（属票 08）",
  generate: "日课生成还没接上（属票 13 · 底稿与日课）",
  refreshDigao: "底稿刷新还没接上（属票 13 · 底稿与日课）",
  openDetail: "命盘详情还没装配（属票 08）",
  retry: "取数重试还没接上（属票 08 / 13）"
};
function clockOf(time) {
  if (time === void 0) return "";
  const parts = time.split(":");
  if (parts.length < 2) return time;
  return `${parts[0]}:${parts[1]}`;
}
var DIGAO_ID = "digao";
var RIKKE_ID = "rikke";
var DIGAO_LABEL = "底稿";
var RIKKE_LABEL = "日课";
var DIGAO_ORDER = 60;
var RIKKE_ORDER = 100;

// src/client/consult.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
function ConsultPanel({ api, navigate, openSession, refreshSessions, mountSlot, preloaded }) {
  const [view, setView] = (0, import_react4.useState)(preloaded?.view ?? "lobby");
  const [defaults, setDefaults] = (0, import_react4.useState)(
    preloaded?.defaults === void 0 ? { kind: "loading" } : { kind: "ready", value: preloaded.defaults }
  );
  const [items, setItems] = (0, import_react4.useState)(
    preloaded?.items === void 0 ? { kind: "loading" } : { kind: "ready", value: preloaded.items }
  );
  const [selected, setSelected] = (0, import_react4.useState)(
    preloaded?.defaults === void 0 ? [] : initialSelection(preloaded.defaults.optional)
  );
  const [question, setQuestion] = (0, import_react4.useState)("");
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [createError, setCreateError] = (0, import_react4.useState)(void 0);
  const [nudge, setNudge] = (0, import_react4.useState)(false);
  const [openError, setOpenError] = (0, import_react4.useState)(void 0);
  const [reader, setReader] = (0, import_react4.useState)({ kind: "idle" });
  const [query, setQuery] = (0, import_react4.useState)("");
  const [range, setRange] = (0, import_react4.useState)("all");
  const touched = (0, import_react4.useRef)(preloaded?.defaults !== void 0);
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
      setDefaults({ kind: "error", message: errorText(error) });
    });
  };
  const reloadItems = () => {
    setItems({ kind: "loading" });
    void api.list().then((answer) => {
      setItems({ kind: "ready", value: answer.items });
    }).catch((error) => {
      setItems({ kind: "error", message: errorText(error) });
    });
  };
  (0, import_react4.useEffect)(() => {
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
    if (!plain && nudgeNeeded({ question: text, selected, mounts: mountsNow })) {
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
        setCreateError(`开问事失败：${errorText(error)}`);
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
            `会话已建好（${shortConsultId(session.sessionId)}），但这一问没发出去：${errorText(error)}（可点「继续这次问事」进会话重发）`
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
      setReader({ kind: "ready", session: answer.session, messages: answer.messages });
    }).catch((error) => {
      setReader({ kind: "error", session: known, message: errorText(error) });
    });
  };
  const required = defaults.kind === "ready" ? defaults.value.required : [];
  const optional = defaults.kind === "ready" ? defaults.value.optional : [];
  const historyItems = items.kind === "ready" ? items.value : [];
  const latest = historyItems[0];
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("main", { className: "xs-consult", "data-xuanshu-panel": CONSULT_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("header", { className: "xs-consult__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h1", { children: "问事" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
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
    openError === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "xs-consult__error", "data-xuanshu-error": "open-session", role: "alert", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: openError }) }),
    view === "lobby" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "xs-consult__block", "data-xuanshu-block": "landing", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { "data-xuanshu-note": "lobby-what", children: "一次问事 = 勾选谱 → 说事 →（可选）多 AI 合参 → 结束沉淀" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { "data-xuanshu-note": "lobby-parallel", children: "与工作区并列、不属于任何工作区；带 DSH 全套工具能力" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "xs-consult__note", "data-xuanshu-note": "lobby-f1", children: "ⓘ 本面板是「书房门厅」：进会话后切到 DSH 会话面板，工具轨迹与审批卡在那里。" })
      ] }),
      defaults.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "xs-consult__note", "data-xuanshu-state": "pu-loading", children: "正在读谱清单…" }) : null,
      defaults.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "xs-consult__error", "data-xuanshu-error": "defaults", role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: `谱清单读不到：${defaults.message}` }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "xs-consult__actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", "data-xuanshu-action": "retry-defaults", onClick: reloadDefaults, children: "重试" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", "data-xuanshu-action": "goto-manage-pu", onClick: () => {
            navigate("pus");
          }, children: "去谱管理 ▸ S5" })
        ] })
      ] }) : null,
      defaults.kind === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        XsConsultPicker,
        {
          required,
          optional,
          selected,
          onToggle: (slug) => {
            touched.current = true;
            setSelected((current) => toggleSelection(current, slug));
          },
          onManagePu: () => {
            navigate("pus");
          },
          onOpenDetail: () => {
            navigate("mingpan");
          }
        }
      ) : null,
      mountSlot === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(XsConsultMountPlaceholder, { mounts: mountsNow }) : mountSlot(latest),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
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
      latest === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        XsConsultRecentCard,
        {
          session: latest,
          onContinue: () => {
            enterConversation(latest.sessionId);
          },
          onHistory: () => {
            setView("history");
          }
        }
      )
    ] }) : null,
    view === "history" && reader.kind === "idle" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      XsConsultHistoryList,
      {
        items: historyItems,
        loading: items.kind === "loading",
        error: items.kind === "error" ? items.message : void 0,
        query,
        range,
        now: /* @__PURE__ */ new Date(),
        onQuery: setQuery,
        onRange: setRange,
        onOpen: openRow,
        onBack: () => {
          setView("lobby");
        },
        onStart: () => {
          setView("lobby");
        },
        onManagePu: () => {
          navigate("pus");
        },
        onRetry: reloadItems
      }
    ) : null,
    view === "history" && reader.kind !== "idle" ? reader.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
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
    ) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      XsConsultHistoryReader,
      {
        session: reader.session,
        messages: reader.kind === "ready" ? reader.messages : [],
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
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "M4 6.5c0-1.1 1.3-2 3-2s3 .9 3 2v11c0-.9-1.3-1.6-3-1.6s-3 .7-3 1.6z" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "M10 6.5c0-1.1 1.3-2 3-2s3 .9 3 2v11c0-.9-1.3-1.6-3-1.6s-3 .7-3 1.6z" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "M16 7h3.5M16 11h3.5M16 15h3.5" })
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
  if (typeof document === "undefined" || document.getElementById("xs-consult-style") !== null) return;
  const style = document.createElement("style");
  style.id = "xs-consult-style";
  style.textContent = `
.xs-consult{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-consult h1,.xs-consult h3,.xs-consult h4{font-weight:600}.xs-consult h1{font-size:1.15rem}.xs-consult h3{font-size:.98rem;margin:16px 0 6px}.xs-consult h4{font-size:.85rem;margin:12px 0 4px;color:var(--xs-text-secondary)}
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
.xs-consult__field>span{display:block;margin-bottom:4px;font-size:.85rem}
.xs-consult__locked{list-style:none;margin:0;padding:0}
.xs-consult__rows{list-style:none;margin:0;padding:0}
.xs-consult__row-hit{display:flex;gap:10px;align-items:baseline;width:100%;text-align:left}
.xs-consult__shortid{font-family:var(--font-mono,monospace);color:var(--xs-text-code);font-size:.85rem}
.xs-consult__summary{line-height:1.7}
.xs-consult__nudge,.xs-consult__error{border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:12px;margin:10px 0}
.xs-consult__nudge-title{font-weight:600;margin:0 0 6px}
.xs-consult__paths{margin:0 0 8px;padding-left:20px;line-height:1.7}
.xs-consult__empty{text-align:left;padding:16px 0}
.xs-consult__empty-why{font-weight:600;margin:0 0 6px}
.xs-consult__messages{margin-top:12px}
.xs-consult__message{display:grid;grid-template-columns:44px minmax(0,1fr);gap:8px;padding:10px 0;border-bottom:1px solid var(--xs-edge-card)}
.xs-consult__role{color:var(--xs-text-secondary);font-size:.85rem}
.xs-consult__text{margin:0;line-height:1.7;white-space:pre-wrap}
@media(max-width:1100px){.xs-consult{padding:16px}.xs-consult__row-hit{flex-direction:column;gap:2px}}
`;
  document.head.appendChild(style);
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
function errorText2(error) {
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
    refresh() {
      if (running !== void 0) return running;
      running = api.refresh().then(() => {
        outcome = { ok: true };
        return outcome;
      }).catch((error) => {
        outcome = { ok: false, reason: `刷新失败：${errorText2(error)}` };
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
var import_react6 = require("react");

// src/client/glyphs.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
function GlyphOverview({ className = "xs-glyph", size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M4 10.5 L12 4.5 L20 10.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M6 9 V19.5 H18 V9" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M10 19.5 V14 H14 V19.5" })
      ]
    }
  );
}
function GlyphCardMingpan({ className = "xs-glyph", size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("circle", { cx: "10", cy: "10", r: "6.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M10 3.5 V16.5 M3.5 10 H16.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("circle", { cx: "10", cy: "10", r: "0.6", fill: "currentColor", stroke: "none" })
      ]
    }
  );
}
function GlyphCardRike({ className = "xs-glyph", size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("circle", { cx: "10", cy: "10", r: "6.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M10 6.5 V10 L13 12.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M3.5 13.5 H16.5" })
      ]
    }
  );
}
function GlyphCardDigao({ className = "xs-glyph", size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("rect", { x: "4.5", y: "3.5", width: "11", height: "13", rx: "1.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M8 3.5 V2 H12 A1.5 1.5 0 0 1 13.5 3.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M7.5 8 H12.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M7.5 11 H12.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M7.5 14 H10.5" })
      ]
    }
  );
}
function GlyphQuickConsult({ className = "xs-glyph", size = 24 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M4.5 6 H19.5 V15 H12 L8.5 18.5 V15 H4.5 Z" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M12 9.3 c0 .2 0 .3-.06.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M9.8 9.2 A2.2 2.2 0 1 1 13 11.3 c-.6.5-.8.9-.8 1.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M12 14.3 v.01" })
      ]
    }
  );
}
function GlyphQuickWorkspace({ className = "xs-glyph", size = 24 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
      children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M4 7.5 A1.5 1.5 0 0 1 5.5 6 H10 L12 8 H18.5 A1.5 1.5 0 0 1 20 9.5 V16.5 A1.5 1.5 0 0 1 18.5 18 H5.5 A1.5 1.5 0 0 1 4 16.5 Z" })
    }
  );
}
function GlyphQuickWorkflow({ className = "xs-glyph", size = 24 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("circle", { cx: "5", cy: "8", r: "1.8" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("circle", { cx: "19", cy: "8", r: "1.8" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("circle", { cx: "12", cy: "17", r: "1.8" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M6.7 9 L10.6 15.6 M15.4 15.6 L17.3 9" })
      ]
    }
  );
}
function IllusMingpanEmpty({ className = "xs-empty__illus" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("svg", { className, viewBox: "0 0 120 80", fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("circle", { cx: "60", cy: "29", r: "21", stroke: "currentColor", strokeWidth: 1.5 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("circle", { cx: "60", cy: "29", r: "12", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M60 17v24M48 29h24", stroke: "currentColor", strokeWidth: 1, opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M60 50v15", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M60 50l7 5-7 5z", stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M52 65h16", stroke: "currentColor", strokeWidth: 1, strokeLinecap: "round", strokeDasharray: "4 3", opacity: 0.4 })
  ] });
}
function IllusRikeEmpty({ className = "xs-empty__illus" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("svg", { className, viewBox: "0 0 120 80", fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("circle", { cx: "86", cy: "22", r: "8", stroke: "currentColor", strokeWidth: 1.2, opacity: 0.4 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M86 8v-3M86 36v3M72 22h-3M100 22h3", stroke: "currentColor", strokeWidth: 1, opacity: 0.25 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("rect", { x: "22", y: "28", width: "58", height: "36", rx: "4", stroke: "currentColor", strokeWidth: 1.5 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M30 40h42M30 47h42M30 54h28", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M22 34h58", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" })
  ] });
}
function IllusDigaoEmpty({ className = "xs-empty__illus" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("svg", { className, viewBox: "0 0 120 80", fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("rect", { x: "30", y: "16", width: "60", height: "48", rx: "4", stroke: "currentColor", strokeWidth: 1.5 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M30 24h60", stroke: "currentColor", strokeWidth: 1, strokeLinecap: "round", opacity: 0.4 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M38 34h30M38 42h42M38 50h24", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M44 58h8M60 58h8M76 58h8", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", opacity: 0.4 })
  ] });
}
function IllusCardsError({ className = "xs-empty__illus" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("svg", { className, viewBox: "0 0 120 80", fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("rect", { x: "28", y: "20", width: "56", height: "40", rx: "5", stroke: "currentColor", strokeWidth: 1.5 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M28 32h56", stroke: "currentColor", strokeWidth: 1, opacity: 0.4 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M36 44h16M36 51h24", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M88 44l6 6M94 44l-6 6", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M16 24l8 8M24 24l-8 8", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", opacity: 0.35 })
  ] });
}

// src/client/watch.ts
var import_react5 = require("react");
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
  return (0, import_react5.useSyncExternalStore)(watch.subscribe, watch.getSnapshot, watch.getSnapshot);
}
var EMPTY_MAIN_PANELS = {
  subscribe: () => () => {
  },
  getSnapshot: () => EMPTY_KEYS
};
var EMPTY_KEYS = [];

// src/client/cards.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
function useAvailable(mainPanels) {
  return useMainPanels(mainPanels);
}
function isAvailable(available, target) {
  return available.includes(target);
}
function ActionButton({ action, children, primary, disabled, reason, onClick }) {
  const className = primary ? "xs-btn xs-btn--primary" : "xs-btn";
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "xs-card", "data-xuanshu-card": card, "data-xs-state": state, children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("header", { className: "xs-card__head", children: [
      icon,
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h2", { className: "xs-card__title", children: title }),
      badge
    ] }),
    children
  ] });
}
function XsReadonlyBadge() {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "xs-badge xs-badge--readonly", "data-xuanshu-badge": "readonly", children: BADGE_READONLY });
}
function XsPureDerivedBadge() {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "xs-badge xs-badge--derived", "data-xuanshu-badge": "derived", children: BADGE_DERIVED });
}
function XsEmptyBlock({
  illus,
  why,
  sub,
  actions,
  variant = "empty"
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: variant === "error" ? "xs-card__error" : "xs-card__empty", children: [
    illus,
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "xs-empty__why", children: why }),
    sub === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "xs-empty__sub", children: sub }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "xs-card__actions", children: actions })
  ] });
}
function XsSkeleton({ lines, blocks = 0, badgePlaceholder = false }) {
  const bars = Array.from({ length: lines }, (_, index) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "xs-skeleton__bar xs-skeleton__shimmer" }, `line-${String(index)}`));
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "xs-skeleton", "data-xuanshu-skeleton": "card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "xs-skeleton__bar xs-skeleton__bar--head xs-skeleton__shimmer" }),
    badgePlaceholder ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "xs-skeleton__bar xs-skeleton__bar--badge xs-skeleton__shimmer" }) : null,
    blocks > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "xs-skeleton__blocks", children: Array.from({ length: blocks }, (_, index) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "xs-skeleton__block xs-skeleton__shimmer" }, `block-${String(index)}`)) }) : null,
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
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    XsCardShell,
    {
      card: "mingpan",
      title: CARD_TITLE.mingpan,
      state,
      icon: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(GlyphCardMingpan, { className: "xs-card__icon" }),
      badge: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(XsReadonlyBadge, {}),
      children: [
        state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(XsSkeleton, { lines: 1, blocks: 4, badgePlaceholder: true }) : null,
        state === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          XsEmptyBlock,
          {
            illus: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(IllusMingpanEmpty, {}),
            why: EMPTY_COPY.mingpan.why,
            sub: EMPTY_COPY.mingpan.sub,
            actions: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
        state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          XsEmptyBlock,
          {
            variant: "error",
            illus: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(IllusCardsError, {}),
            why: ERROR_COPY.mingpan,
            actions: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
        state === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "xs-card__body", "data-xuanshu-ready": "mingpan", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "xs-pillars", children: PILLAR_ORDER.map(({ key, label }) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "xs-pillar", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "xs-pillar__name", children: label }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "xs-pillar__value", children: snapshot?.pillars[key] ?? "—" })
          ] }, key)) }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "xs-basis", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { "data-xuanshu-basis": "true-solar", children: [
              "真太阳时 ",
              snapshot?.basis.trueSolar ?? "—"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { "data-xuanshu-basis": "clock", children: [
              "钟表时 ",
              snapshot?.basis.clock ?? "—"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "xs-card__actions", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
function RikkeLines({ content }) {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "xs-lines", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "xs-line", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "xs-line__label", children: "宜" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "xs-line__value", children: content?.yi ?? "—" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "xs-line", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "xs-line__label", children: "忌" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "xs-line__value", children: content?.ji ?? "—" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "xs-line", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "xs-line__label", children: "流日" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "xs-line__value", children: content?.liuri ?? "—" })
    ] })
  ] });
}
function XsRikkeCard({
  state = "empty",
  today,
  content,
  reason,
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
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    XsCardShell,
    {
      card: "rike",
      title: `${CARD_TITLE.rike} · 今天 ${today}`,
      state,
      icon: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(GlyphCardRike, { className: "xs-card__icon" }),
      children: [
        state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(XsSkeleton, { lines: 3 }) : null,
        state === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          XsEmptyBlock,
          {
            illus: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(IllusRikeEmpty, {}),
            why: EMPTY_COPY.rike.why,
            sub: EMPTY_COPY.rike.sub,
            actions: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                ActionButton,
                {
                  action: "generate-rikke",
                  disabled: generateDisabled,
                  reason: DISABLED_REASON.generate,
                  onClick: onGenerate,
                  children: ACTION_COPY.generate
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
        state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
            XsEmptyBlock,
            {
              variant: "error",
              illus: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(IllusCardsError, {}),
              why: ERROR_COPY.rike,
              sub: reason,
              actions: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
          content === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "xs-card__body", "data-xuanshu-ready": "rike", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(RikkeLines, { content }) })
        ] }) : null,
        state === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "xs-card__body", "data-xuanshu-ready": "rike", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(RikkeLines, { content }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "xs-card__actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              NavLink,
              {
                target: "rikke",
                disabled: !rikkeReady,
                reason: DISABLED_REASON.rikke,
                onClick: () => navigate("rikke"),
                children: ACTION_COPY.watchFull
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    XsCardShell,
    {
      card: "digao",
      title: CARD_TITLE.digao,
      state,
      icon: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(GlyphCardDigao, { className: "xs-card__icon" }),
      badge: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(XsPureDerivedBadge, {}),
      children: [
        state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(XsSkeleton, { lines: 2, badgePlaceholder: true }) : null,
        state === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          XsEmptyBlock,
          {
            illus: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(IllusDigaoEmpty, {}),
            why: copy.why,
            sub: copy.sub,
            actions: baseplateEstablished ? (
              // 空因 (b)：底座已立、从未刷新 —— 冷启动期的 (a) 不提供 [刷新]（S4 文案表逐条说明）。
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                ActionButton,
                {
                  action: "refresh-digao",
                  disabled: refreshDisabled,
                  reason: DISABLED_REASON.refreshDigao,
                  onClick: onRefresh,
                  children: "立即刷新"
                }
              )
            ) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
        state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          XsEmptyBlock,
          {
            variant: "error",
            illus: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(IllusCardsError, {}),
            why: ERROR_COPY.digao,
            sub: reason,
            actions: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                ActionButton,
                {
                  action: "retry",
                  disabled: retryDisabled,
                  reason: DISABLED_REASON.retry,
                  onClick: onRetry,
                  children: ACTION_COPY.retry
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
        state === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "xs-card__body", "data-xuanshu-ready": "digao", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "xs-digao-summary", children: [
            "关于我：",
            summary?.segments ?? 0,
            " 段 · 来源 ",
            summary?.sources ?? 0,
            " 路"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "xs-source-links", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: ACTION_COPY.adjustSource }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              NavLink,
              {
                target: "pus",
                disabled: !isAvailable(available, "pus"),
                reason: DISABLED_REASON.pus,
                onClick: () => navigate("pus"),
                children: ACTION_COPY.sourcePu
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              NavLink,
              {
                target: "conversation",
                disabled: !isAvailable(available, "conversation"),
                reason: "DSH 工作区面板不可用",
                onClick: () => navigate("conversation"),
                children: ACTION_COPY.sourceWorkspace
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "xs-card__actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              NavLink,
              {
                target: "digao",
                disabled: !isAvailable(available, "digao"),
                reason: DISABLED_REASON.digao,
                onClick: () => navigate("digao"),
                children: ACTION_COPY.openDigao
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
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
  mainPanels
}) {
  const available = useAvailable(mainPanels);
  const cells = [
    {
      target: "consult",
      icon: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(GlyphQuickConsult, { className: "xs-cell__icon" }),
      title: QUICKLINK.consult.title,
      // 底座未立时问事格副标题换提示句，但格**仍可用**（S4 §3④）。
      subtitle: baseplateReady ? QUICKLINK.consult.subtitle : QUICKLINK_CONSULT_UNREADY,
      disabled: !isAvailable(available, "consult"),
      reason: DISABLED_REASON.consult
    },
    {
      target: "conversation",
      icon: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(GlyphQuickWorkspace, { className: "xs-cell__icon" }),
      title: QUICKLINK.conversation.title,
      subtitle: QUICKLINK.conversation.subtitle,
      disabled: !isAvailable(available, "conversation"),
      reason: "DSH 工作区面板不可用"
    },
    {
      target: "workflow",
      icon: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(GlyphQuickWorkflow, { className: "xs-cell__icon" }),
      title: QUICKLINK.workflow.title,
      subtitle: QUICKLINK.workflow.subtitle,
      disabled: !isAvailable(available, "workflow"),
      reason: DISABLED_REASON.workflow
    }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(XsCardShell, { card: "quicklinks", title: CARD_TITLE.quicklinks, state: "ready", icon: null, children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "xs-quicklinks", "data-xuanshu-quicklinks": "3", children: cells.map((cell) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
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
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "xs-cell__title", children: cell.title }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "xs-cell__subtitle", children: cell.subtitle })
        ]
      },
      cell.target
    )) }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "xs-quicklinks__note", "data-xuanshu-note": "boundary", children: QUICKLINKS_BOUNDARY })
  ] });
}

// src/client/digao-model.ts
var KIND_BY_NAME = {
  谱: "pu",
  工作区: "workspace",
  工作流: "workflow"
};
var HEADING_RE = /^##\s*来源：\s*(.+?)\s*$/;
var MARKER_RE = /^【来源：\s*(.+?)\s*】\s*(.*)$/;
var ORIGIN_RE = /^源自：\s*(.*)$/;
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
function parseDigaoMarkdown(markdown) {
  const drafts = [];
  let group;
  let segment;
  const closeSegment = () => {
    if (group === void 0 || segment === void 0) return;
    const current = segment;
    const origins = current.bodyLines.map((line) => ORIGIN_RE.exec(line.trim())).filter((match) => match !== null).map((match) => match[1] ?? "");
    const body = current.bodyLines.filter((line) => ORIGIN_RE.exec(line.trim()) === null).join("\n").trim();
    group.segments.push({
      label: current.label,
      kind: current.kind,
      name: current.name,
      body,
      ...origins.length === 0 ? {} : { origin: origins[origins.length - 1] ?? "" }
    });
    segment = void 0;
  };
  for (const rawLine of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = HEADING_RE.exec(rawLine.trim());
    if (heading !== null) {
      closeSegment();
      const name = heading[1] ?? "";
      const draft = { kind: kindOf(name), name, noteLines: [], segments: [] };
      group = draft;
      drafts.push(draft);
      continue;
    }
    if (group === void 0) continue;
    const marker = MARKER_RE.exec(rawLine.trim());
    if (marker !== null) {
      closeSegment();
      const { label, name } = splitMarker(marker[1] ?? "");
      const draft = { label, kind: kindOf(label), name, bodyLines: [] };
      segment = draft;
      const trailing = marker[2] ?? "";
      if (trailing !== "") draft.bodyLines.push(trailing);
      continue;
    }
    if (segment === void 0) group.noteLines.push(rawLine);
    else segment.bodyLines.push(rawLine);
  }
  closeSegment();
  return drafts.map((draft) => ({
    kind: draft.kind,
    name: draft.name,
    note: draft.noteLines.join("\n").trim(),
    segments: draft.segments
  }));
}

// src/client/digao-style.ts
function installDigaoStyle() {
  if (typeof document === "undefined" || document.getElementById("xs-digao-style") !== null) return;
  const style = document.createElement("style");
  style.id = "xs-digao-style";
  style.textContent = `
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
.xs-digao__segment{margin:10px 0;border-left:2px solid var(--xs-edge-card);padding-left:10px}
.xs-digao__tag{display:inline-block;padding:1px 6px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);font-size:.8rem;color:var(--xs-text-secondary);margin-right:6px}
.xs-digao__segment-body{white-space:pre-wrap;line-height:1.8;margin:4px 0}
.xs-digao__raw{white-space:pre-wrap;font-family:var(--font-mono,monospace);font-size:.85rem;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);padding:10px;overflow:auto;max-height:var(--xs-size-scrollregion-max,420px)}
.xs-digao__alert{padding:10px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);margin:8px 0}
@media(max-width:1100px){.xs-digao{padding:16px}}
`;
  document.head.appendChild(style);
}

// src/client/digao.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
var DIGAO_NO_EDIT_NOTE = "本面板没有编辑框、没有保存按钮：内容由「规则骨架 + AI 摘要」生成；改了源头，刷新即变。";
var DIGAO_JUMP_NOTE = "要改就改源头：";
var DIGAO_JUMPS = [
  { target: "pus", label: "改谱 → S5" },
  { target: "conversation", label: "改工作区 → 工作区" },
  { target: "workflow", label: "改工作流 → S12" }
];
var DIGAO_NEXT_REFRESH_NOTE = "下次刷新：由「自动化任务」面板里的底稿 daily 任务决定（播种默认 03:30，可在那里改或停用）。";
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
  return {
    kind: "ready",
    meta: preloaded.read.meta ?? preloaded.status.meta,
    markdown: preloaded.read.markdown,
    ...schedule === void 0 ? {} : { schedule }
  };
}
function errorText3(error) {
  return error instanceof Error ? error.message : String(error);
}
function DigaoPanel({ api, navigate, preloaded, preloadedRawView }) {
  const seeded = preloaded !== void 0;
  const [view, setView] = (0, import_react6.useState)(() => initialView(preloaded));
  const [busy, setBusy] = (0, import_react6.useState)(false);
  const [raw, setRaw] = (0, import_react6.useState)(preloadedRawView === true);
  const [note, setNote] = (0, import_react6.useState)(void 0);
  const sequence = (0, import_react6.useRef)(0);
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
      setView({
        kind: "ready",
        meta: read.meta ?? status.meta,
        markdown: read.markdown,
        ...schedule2 === void 0 ? {} : { schedule: schedule2 }
      });
    }).catch((error) => {
      if (mine !== sequence.current) return;
      setView({ kind: "error", message: errorText3(error) });
    });
  };
  (0, import_react6.useEffect)(() => {
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
      setView({ kind: "ready", meta: read.meta, markdown: read.markdown });
    }).catch((error) => {
      if (mine !== sequence.current) return;
      setNote(`刷新失败：${errorText3(error)}`);
    }).finally(() => {
      if (mine === sequence.current) setBusy(false);
    });
  };
  const meta = view.kind === "empty" || view.kind === "ready" ? view.meta : null;
  const schedule = view.kind === "empty" || view.kind === "ready" ? view.schedule : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("main", { className: "xs-digao", "data-xuanshu-panel": DIGAO_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("header", { className: "xs-digao__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h1", { children: "底稿" }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(XsPureDerivedBadge, {})
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "xs-digao__jumps", "data-xuanshu-note": "source-jumps", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: DIGAO_JUMP_NOTE }),
      DIGAO_JUMPS.map((jump) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-digao__note xs-digao__no-edit", "data-xuanshu-note": "no-edit", children: DIGAO_NO_EDIT_NOTE }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-digao__note", "data-xuanshu-note": "last-refresh", children: meta?.generatedAt === void 0 ? "上次刷新：（还没有生成过）" : `上次刷新 ${meta.generatedAt}` }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-digao__note", "data-xuanshu-note": "next-refresh", children: schedule === void 0 ? DIGAO_NEXT_REFRESH_NOTE : `下次刷新 ${clockOf(schedule.time)}（${schedule.timeZone}）· 由「自动化任务」面板里的 daily 任务决定（可在那里改或停用）` }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "xs-digao__actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
    note === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-digao__alert", role: "alert", "data-xuanshu-alert": "refresh", children: note }),
    view.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-digao__note", "data-xuanshu-view": "loading", children: "正在读底稿…" }) : null,
    view.kind === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "xs-digao__empty", "data-xuanshu-view": "empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: EMPTY_COPY.digaoNeverRefreshed.why }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-digao__note", children: "底稿由谱 / 工作区 / 工作流三路来源提炼而成；点一次 [刷新] 就会按三路来源拼出骨架。" })
    ] }) : null,
    view.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "xs-digao__alert", "data-xuanshu-view": "error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: view.message }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "xs-digao__actions", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", "data-xuanshu-action": "retry", onClick: load, children: "重试" }) })
    ] }) : null,
    view.kind === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(DigaoBody, { markdown: view.markdown, meta: view.meta, raw }) : null
  ] });
}
function digestLine(meta) {
  const digest = meta?.digest;
  if (digest === "skeleton") {
    return "生成方式：骨架＝确定性规则 · 摘要＝规则骨架（LLM 不可用或提炼失败，未提炼）";
  }
  if (digest === "llm") return "生成方式：骨架＝确定性规则 · 摘要＝AI 提炼";
  return "生成方式：骨架＝确定性规则 · 摘要＝未标注（meta 里没有 digest 这一位，按未提炼对待）";
}
function DigaoBody({ markdown, meta, raw }) {
  const groups = parseDigaoMarkdown(markdown);
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-digao__note", "data-xuanshu-note": "digest", children: digestLine(meta) }),
    raw ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("pre", { className: "xs-digao__raw", "data-xuanshu-raw": "digao", children: markdown }) : null,
    groups.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-digao__note", "data-xuanshu-note": "shape-mismatch", children: "正文形态不符（没有「## 来源：…」章节）：按原文只读展示，界面不假装解析出来源分组。" }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("pre", { className: "xs-digao__raw", "data-xuanshu-raw": "digao-fallback", children: markdown })
    ] }) : groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "xs-digao__group", "data-xuanshu-group": group.kind, children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h2", { className: "xs-digao__group-head", children: `来源：${group.name}（${group.segments.length} 段）` }),
      group.note === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-digao__note", "data-xuanshu-group-note": group.kind, children: group.note }),
      group.segments.map((segment, index) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("article", { className: "xs-digao__segment", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "xs-digao__segment-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "xs-digao__tag", "data-xuanshu-source-tag": segment.label, children: `[${segment.label}]` }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "xs-digao__segment-name", children: segment.name })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-digao__segment-body", children: segment.body }),
        segment.origin === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "xs-digao__origin", "data-xuanshu-origin": segment.kind, children: `源自：${segment.origin}` })
      ] }, `${group.kind}-${String(index)}`))
    ] }, `${group.kind}-${group.name}`))
  ] });
}
function DigaoIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("path", { d: "M6 3.5h8l4 4V20.5H6z" }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("path", { d: "M14 3.5v4h4" }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("path", { d: "M8.5 12h7M8.5 15.5h7" })
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
var import_react7 = require("react");

// src/client/bazi-style.ts
function installBaziStyle() {
  if (typeof document === "undefined" || document.getElementById("xs-bazi-style") !== null) return;
  const style = document.createElement("style");
  style.id = "xs-bazi-style";
  style.textContent = `
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
@media(max-width:1100px){.xs-wizard__cols{grid-template-columns:1fr}.xs-wizard{padding:16px}.xs-mingpan{padding:16px}}
`;
  document.head.appendChild(style);
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
var import_jsx_runtime9 = require("react/jsx-runtime");
var RERECORD_CONFIRM = "将重新录制出生信息并重新出盘。当前底座谱（~/.dsh/xuanshu/pus/_base/bazi.md）会被新结果原子替换；底稿会在下次刷新时随之更新，需要你手动点刷新。";
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
  preloadedError
}) {
  const revision = (0, import_react7.useSyncExternalStore)(controller.subscribe, controller.getRevision, controller.getRevision);
  const seeded = preloadedError !== void 0 || preloadedSnapshot !== void 0;
  const [view, setView] = (0, import_react7.useState)(() => {
    if (preloadedError !== void 0) return { kind: "error", message: preloadedError };
    if (preloadedSnapshot !== void 0) {
      return preloadedSnapshot === null ? { kind: "empty" } : { kind: "ready", snapshot: preloadedSnapshot };
    }
    return { kind: "loading" };
  });
  const [confirming, setConfirming] = (0, import_react7.useState)(false);
  const sequence = (0, import_react7.useRef)(0);
  (0, import_react7.useEffect)(() => {
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
  const backToOverview = /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", "data-xuanshu-action": "back-overview", onClick: () => {
    navigate("overview");
  }, children: "<- 回总览" });
  const startOnboarding = /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", "data-xuanshu-action": "start-onboarding", onClick: () => {
    navigate("onboarding");
  }, children: "开始填写出生信息 ->" });
  const goRerecord = (snapshot) => {
    controller.requestRerecord(draftFromSnapshot(snapshot));
    navigate("onboarding");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("main", { className: "xs-mingpan", "data-xuanshu-panel": MINGPAN_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("header", { className: "xs-mingpan__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h1", { children: "命盘卡详情" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(XsReadonlyBadge, {}),
      backToOverview
    ] }),
    view.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "xs-mingpan__loading", "data-xuanshu-view": "loading", children: "正在读命盘快照…" }) : null,
    view.kind === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "xs-mingpan__empty", "data-xuanshu-view": "empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: "还没有命盘：出生信息还没录" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "xs-mingpan__hint", children: "命盘是只读快照：填一次出生信息就点亮了。" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "xs-mingpan__actions", children: startOnboarding })
    ] }) : null,
    view.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "xs-mingpan__error", "data-xuanshu-view": "error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: view.message }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "xs-mingpan__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", "data-xuanshu-action": "retry", onClick: () => {
          controller.invalidate();
        }, children: "重试" }),
        startOnboarding,
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", "data-xuanshu-action": "rerecord", onClick: () => {
          setConfirming(true);
        }, children: "去重新录制出生信息" })
      ] })
    ] }) : null,
    view.kind === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
      MingpanBody,
      {
        snapshot: view.snapshot,
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
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h2", { children: "① 出生信息" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "xs-mingpan__summary", "data-xuanshu-summary": "birth", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { "data-xuanshu-summary": "clock", children: `${birth.date ?? "—"} ${birth.time ?? "—"} 当地时间` }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { "data-xuanshu-summary": "place", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: placeLabel({ place: birth.place ?? "" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "xs-mingpan__coord", children: ` ${coords}` }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: `　时区 ${birth.zone === void 0 || birth.zone === "" ? "—" : birth.zone}` }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: ` ${formatOffsetMinutes(basis.offsetMinutes)}` })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h2", { children: "② 四柱" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "xs-mingpan__pillars", "data-xuanshu-pillars": "4", children: PILLAR_COLUMNS.map((column) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "xs-mingpan__pillar", "data-xuanshu-pillar": column.key, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "xs-mingpan__pillar-name", children: column.label }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "xs-mingpan__pillar-value", children: snapshot.pillars?.[column.key] ?? "—" })
    ] }, column.key)) }),
    missingSections.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "xs-mingpan__hint", "data-xuanshu-note": "partial", children: `部分要点读不出来（${missingSections.join(" / ")}）` }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "xs-mingpan__hint", "data-xuanshu-note": "schema-scope", children: "本快照（xuanshu/bazi-snapshot@1）只存四柱与口径；藏干 / 十神 / 大运 / 其它要点不在其中（扩 schema 属后续票）。" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h2", { children: "③ 起盘口径（只读）" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "xs-mingpan__basis", "data-xuanshu-basis": "readonly", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { "data-xuanshu-basis": "time-alg", children: `时间算法 = ${timeAlgLabel(timeAlg)}` }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { "data-xuanshu-basis": "gender", children: [
        "性别 = ",
        genderLabel("unknown")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { "data-xuanshu-basis": "other-knobs", children: "其余旋钮 = 引擎缺省（本盘未改）" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { "data-xuanshu-basis": "two-clocks", children: `真太阳时 ${basis.trueSolar ?? "—"}　钟表时 ${basis.clock ?? "—"}　夏令时 ${basis.dst === true ? "有" : "无"}` })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h2", { children: "④ 快照来源" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "xs-mingpan__origin", "data-xuanshu-origin": "snapshot", children: `horosa ${snapshot.horosa?.version ?? "—"} / 出盘于 ${snapshot.generatedAt ?? "—"}` }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h2", { children: "⑤ 重新录制（唯一写操作）" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "xs-mingpan__hint", children: "改命盘只能重新录制出生信息；本屏不出盘、不写任何文件。" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "xs-mingpan__actions", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", "data-xuanshu-action": "rerecord", onClick: onAskRerecord, children: "重新录制出生信息 ->" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "xs-mingpan__confirm", "data-xuanshu-confirm": "rerecord", hidden: !confirming, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { "data-xuanshu-confirm-text": "rerecord", children: RERECORD_CONFIRM }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "xs-mingpan__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", "data-xuanshu-action": "rerecord-cancel", onClick: onCancelRerecord, children: "取消" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", "data-xuanshu-action": "rerecord-go", onClick: onConfirmRerecord, children: "去重新录制 ->" })
      ] })
    ] })
  ] });
}
function MingpanIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("circle", { cx: "12", cy: "12", r: "8" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("circle", { cx: "12", cy: "12", r: "3" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("path", { d: "M12 4v2M12 18v2M4 12h2M18 12h2" })
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
function unwrap(answer) {
  if (answer && typeof answer === "object" && "ok" in answer) {
    const envelope = answer;
    if (envelope.ok === false) throw new Error(envelope.error?.message ?? "调用失败（宿主没有给出原因）。");
    return envelope.value;
  }
  return answer;
}
function createMountsApi(ctx) {
  return {
    async setMounts(payload) {
      const answer = await ctx.connection.rpc.call(MOUNTS_ENDPOINTS.setMounts, payload);
      return unwrap(answer);
    }
  };
}
function createWorkspaceCatalog(ctx) {
  const face = ctx.workspaces;
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
var import_react9 = require("react");

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
var WORKSPACE_UNAVAILABLE_NOTE = "这个 profile 没有客户端工作区面（ctx.workspaces）：工作区清单读不出来，挂载功能暂时不可用。";
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
var import_react8 = require("react");
var import_jsx_runtime10 = require("react/jsx-runtime");
function XsMountStatusBar({ status, budgetSource, hint, onOpen }) {
  const text = status === void 0 ? hint ?? "挂载 … 字 / 预算 …" : statusLine(status);
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
    "button",
    {
      type: "button",
      className: "xs-mounts__status",
      "data-xuanshu-mount-status": "1",
      "data-xuanshu-budget-unknown": status?.budget === null ? "1" : "0",
      onClick: onOpen,
      disabled: onOpen === void 0,
      title: status?.budget === null ? BUDGET_UNKNOWN_NOTE : `本次挂载的裁剪结果（来源：${budgetSource ?? "unknown"}）`,
      children: text
    }
  );
}
function XsMountSection({ mounts, status, canMount, reason, revision, onOpen }) {
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "xs-mounts__section", "data-xuanshu-section": "mounts", "data-xuanshu-mounts-revision": revision === void 0 ? void 0 : String(revision), children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("header", { className: "xs-mounts__section-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: "临时挂载" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-mounts__open", "data-xuanshu-action": "open-mounts", onClick: onOpen, disabled: !canMount || onOpen === void 0, children: "临时挂载…" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-mounts__summary", "data-xuanshu-mount-summary": "1", children: mountsSummary(mounts) }),
    canMount ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "mounts-need-session", children: reason ?? "先生成一次问事，再临时挂载：挂载落在那次问事的清单上。" }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(XsMountStatusBar, { status, onOpen: canMount ? onOpen : void 0, hint: canMount ? void 0 : "挂载 0 字 / 预算 …" })
  ] });
}
function WorkspaceRow({ candidate, selected, onToggle }) {
  const when = candidate.updatedAt === "" ? "" : candidate.updatedAt.slice(0, 10);
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("li", { className: "xs-mounts__row", "data-xuanshu-mount-row": `workspace:${candidate.id}`, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("input", { type: "checkbox", checked: selected, onChange: onToggle, "data-xuanshu-mount-check": candidate.id }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "xs-mounts__row-title", children: candidate.title }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "xs-mounts__row-path", children: candidate.path }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "xs-mounts__row-meta", children: `${String(candidate.sessionCount)} 个会话${when === "" ? "" : ` · 最近 ${when}`}` })
  ] }) });
}
function LayerRowView({ row, open, onToggle }) {
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("li", { className: "xs-mounts__layer", "data-xuanshu-layer": row.layer.label, "data-xuanshu-layer-tone": row.tag.tone, children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "xs-mounts__layer-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-mounts__layer-toggle", "aria-expanded": open, onClick: onToggle, "data-xuanshu-action": "fold-layer", children: open ? "▾" : "▸" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "xs-mounts__layer-name", children: row.layer.head ?? row.layer.label }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "xs-mounts__tag", "data-xuanshu-tag": row.tag.tone, children: row.tag.text })
    ] }),
    row.note === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-mounts__layer-note", "data-xuanshu-layer-note": "1", children: row.note }),
    open && row.keptLabels.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-mounts__layer-kept", "data-xuanshu-layer-kept": "1", children: `保留了：${row.keptLabels.join(" · ")}（${formatChars(row.layer.keptChars)} 字）` }) : null,
    open && row.droppedLabels.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("p", { className: "xs-mounts__layer-dropped", "data-xuanshu-layer-dropped": "1", children: [
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
  const [showAllNotes, setShowAllNotes] = (0, import_react8.useState)(false);
  const status = preview === void 0 ? void 0 : {
    keptChars: preview.keptChars,
    budget: preview.budget,
    keptLayers: preview.keptLayers,
    totalLayers: preview.totalLayers,
    overBudget: preview.truncatedChars > 0
  };
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "xs-mounts__overlay", "data-xuanshu-overlay": "mounts", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "xs-mounts__drawer", role: "dialog", "aria-modal": "true", "aria-labelledby": "xs-mounts-title", "data-xuanshu-drawer": "mounts", children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("header", { className: "xs-mounts__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h2", { id: "xs-mounts-title", children: MOUNT_DRAWER_TITLE }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-mounts__close", onClick: onCancel, disabled: busy, "data-xuanshu-action": "close-mounts", children: "关闭" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-mounts__boundary", "data-xuanshu-boundary": "1", children: MOUNT_BOUNDARY_LINE }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "xs-mounts__group", "data-xuanshu-group": "workspace", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "xs-mounts__group-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: "工作区（DSH 原有，只读引用）" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-mounts__ghost", onClick: gotoWorkspaces, "data-xuanshu-action": "goto-workspaces", children: "去 DSH 工作区界面" })
      ] }),
      !workspaceAvailable ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "workspace-unavailable", children: WORKSPACE_UNAVAILABLE_NOTE }) : workspaces.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "workspace-empty", children: WORKSPACE_EMPTY_NOTE }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("ul", { className: "xs-mounts__rows", children: workspaces.map((candidate) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
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
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "xs-mounts__group", "data-xuanshu-group": "workflow", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: "工作流" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "workflow-empty", children: WORKFLOW_EMPTY_NOTE })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "xs-mounts__group", "data-xuanshu-group": "preview", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: "本轮挂载上下文（预览）" }),
      error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("p", { className: "xs-mounts__error", "data-xuanshu-error": "mounts", role: "alert", children: [
        error,
        onRetry === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-mounts__ghost", onClick: onRetry, children: "重试" })
      ] }),
      busy && preview === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "mounts-loading", children: "正在读挂载内容…" }) : null,
      rows.length === 0 && !busy ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "preview-empty", children: "还没有挂载任何对象：选上面的工作区（选入即挂载），这里会逐层列出将被注入的内容。" }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("ul", { className: "xs-mounts__layers", children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(LayerRowView, { row, open: foldOpen(row.layer.id), onToggle: () => {
        onFold(row.layer.id);
      } }, row.layer.id)) }),
      preview === void 0 || preview.notes.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "xs-mounts__notes", children: [
        (showAllNotes ? preview.notes : preview.notes.slice(0, 1)).map((note) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "clip-reason", children: note }, note)),
        preview.notes.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-mounts__ghost", onClick: () => {
          setShowAllNotes((value) => !value);
        }, "data-xuanshu-action": "more-notes", children: showAllNotes ? "收起解释" : `为什么砍（${String(preview.notes.length)} 条）` }) : null,
        preview.truncatedChars > 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "xs-mounts__note", "data-xuanshu-note": "shrink-hint", children: "超预算的处理：整层丢弃；不会静默截断，注入时也会在提示词里注明。想都带上就缩小挂载范围。" }) : null,
        onRefresh === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-mounts__ghost", onClick: onRefresh, "data-xuanshu-action": "refresh-preview", children: "重新读一遍" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("footer", { className: "xs-mounts__foot", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(XsMountStatusBar, { status, budgetSource }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "xs-mounts__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", onClick: onCancel, disabled: busy, "data-xuanshu-action": "cancel-mounts", children: MOUNT_CANCEL_LABEL }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "xs-mounts__primary", onClick: onConfirm, disabled: busy || !canConfirm, "data-xuanshu-action": "confirm-mounts", children: MOUNT_CONFIRM_LABEL })
      ] })
    ] })
  ] }) });
}

// src/client/mounts.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
function installMountsStyle() {
  if (typeof document === "undefined") return;
  const id = "xuanshu-mounts-style";
  if (document.getElementById(id) !== null) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = [
    ".xs-mounts__section{margin:12px 0;padding:10px;border:1px solid var(--dsw-alias-border,#333);border-radius:8px}",
    ".xs-mounts__section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
    ".xs-mounts__summary,.xs-mounts__note{margin:6px 0;opacity:.8;font-size:12px}",
    ".xs-mounts__status{background:none;border:0;padding:0;color:inherit;opacity:.85;cursor:pointer;font-size:12px}",
    ".xs-mounts__overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;justify-content:flex-end;z-index:60}",
    ".xs-mounts__drawer{width:min(720px,92vw);height:100%;overflow:auto;background:var(--dsw-alias-bg,#111);padding:16px;display:flex;flex-direction:column;gap:12px}",
    ".xs-mounts__head{display:flex;align-items:center;justify-content:space-between}",
    ".xs-mounts__boundary{margin:0;padding:8px;border-left:3px solid var(--dsw-alias-accent,#888);opacity:.9;font-size:12px}",
    ".xs-mounts__rows,.xs-mounts__layers{list-style:none;margin:6px 0;padding:0}",
    ".xs-mounts__row label{display:flex;align-items:center;gap:8px;padding:4px 0}",
    ".xs-mounts__row-path{opacity:.7;font-size:12px}",
    ".xs-mounts__row-meta{opacity:.6;font-size:12px;margin-left:auto}",
    ".xs-mounts__layer{padding:6px 0;border-bottom:1px solid var(--dsw-alias-border,#2a2a2a)}",
    ".xs-mounts__layer-head{display:flex;align-items:center;gap:8px}",
    ".xs-mounts__layer-name{flex:1}",
    ".xs-mounts__tag{font-size:12px;padding:1px 6px;border-radius:10px;border:1px solid currentColor}",
    '.xs-mounts__tag[data-xuanshu-tag="clipped"]{color:#e0a030}',
    '.xs-mounts__tag[data-xuanshu-tag="dropped"]{color:#e05a5a}',
    '.xs-mounts__tag[data-xuanshu-tag="error"]{color:#e05a5a}',
    ".xs-mounts__foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border,#333)}",
    ".xs-mounts__primary{font-weight:600}",
    ".xs-mounts__ghost{background:none;border:0;padding:0;color:inherit;opacity:.75;cursor:pointer;font-size:12px;text-decoration:underline}",
    ".xs-mounts__error{color:#e05a5a;font-size:12px}"
  ].join("\n");
  document.head.appendChild(style);
}
function MountsOverlay({ controller, workspaces, gotoWorkspaces }) {
  const state = (0, import_react9.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
  if (!state.open) return null;
  const rows = layerRows(state.preview);
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
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
  const state = (0, import_react9.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
  const mounts = session?.mounts ?? [];
  const status = session === void 0 ? void 0 : statusFromPreview(controller.cachedPreview(session.sessionId));
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
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
var import_react11 = require("react");

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
var import_react10 = require("react");
var import_jsx_runtime12 = require("react/jsx-runtime");
var STEP_TITLES = [
  "出生日期与钟表时间",
  "出生地（必填：缺经纬度不能出盘）",
  "时区（随出生地自动推导，含 DST）",
  "起盘口径",
  "确认你的出生信息"
];
var STEP_SHORT = ["时间", "出生地", "时区", "口径", "确认"];
function XsStepBar({ step }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("nav", { className: "xs-wizard__steps", "aria-label": "向导步骤", "data-xuanshu-stepbar": String(step), children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__progress", children: `第 ${String(step)} / 5 步` }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("ol", { className: "xs-wizard__step-list", children: STEP_TITLES.map((title, index) => {
      const number = index + 1;
      const state = number < step ? "done" : number === step ? "current" : "todo";
      return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
        "li",
        {
          className: `xs-wizard__step xs-wizard__step--${state}`,
          "data-xuanshu-step": String(number),
          "data-xs-current": number === step ? "true" : void 0,
          "data-xs-state": state,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__step-index", children: String(number) }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__step-name", children: STEP_SHORT[index] })
          ]
        },
        title
      );
    }) })
  ] });
}
function StepShell({ step, title, hint, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("section", { className: "xs-wizard__step-body", "data-xs-step": String(step), children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("header", { className: "xs-wizard__step-head", children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h2", { children: `第 ${String(step)} / 5 步 · ${title}` }) }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "xs-wizard__cols", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "xs-wizard__form", children }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("aside", { className: "xs-wizard__aside", children: hint })
    ] })
  ] });
}
function XsTimeStep({ draft, onChange, onNudge, onNow }) {
  const [grain, setGrain] = (0, import_react10.useState)("fourMinute");
  const empty = draft.date.trim() === "" || draft.time.trim() === "";
  const activeLabel = NUDGE_GRAINS.find((row) => row.id === grain)?.label ?? "四分钟";
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    StepShell,
    {
      step: 1,
      title: STEP_TITLES[0],
      hint: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 公历即可；农历换算由底座做。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 「当地时间」是固定小字：你填的是**钟表时间**，不是真太阳时。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 微调粒度里的「四分钟」= 1° 经度时差，与真太阳时的换算粒度同源。" })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "xs-wizard__field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: "① 日期" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
            "input",
            {
              type: "date",
              "data-xuanshu-field": "birth-date",
              value: draft.date,
              onChange: (event) => {
                onChange({ date: event.target.value });
              }
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "xs-wizard__field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: "② 时间" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("small", { className: "xs-wizard__note", "data-xuanshu-note": "local-clock", children: "当地时间" })
        ] }),
        empty ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__hint", "data-xuanshu-hint": "need-birth", children: "先填出生信息：日期与时刻都填上才能往下走（时刻填当地时间即可）。" }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "xs-wizard__nudge", "data-xuanshu-nudge": "grains", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: "③ 内联微调" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "nudge-minus", onClick: () => {
            onNudge(grain, -1);
          }, children: "[-]" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__nudge-grains", children: NUDGE_GRAINS.map((row) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "nudge-plus", onClick: () => {
            onNudge(grain, 1);
          }, children: "[+]" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "nudge-now", onClick: onNow, children: "此刻" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "nudge-apply", onClick: () => {
            onNudge(grain, 0);
          }, children: "确定" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("small", { className: "xs-wizard__note", children: `当前粒度：${activeLabel}` })
        ] })
      ]
    }
  );
}
function XsPlaceStep({ draft, query, results, manualHint, onQuery, onPick, onManual }) {
  const [lonText, setLonText] = (0, import_react10.useState)("");
  const [latText, setLatText] = (0, import_react10.useState)("");
  const missing = missingCoordinates(draft);
  const searching = query.trim() !== "";
  const noMatch = searching && results.items.length === 0;
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    StepShell,
    {
      step: 2,
      title: STEP_TITLES[1],
      hint: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 断网可用：小库随程序自带，即时出结果。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 有输入后 180ms 才去问大库；大库不在（没装 / 被裁掉）就静默只用小库。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 选城市即带出经纬度；海外与小地名走手输坐标。" })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "① 通道 A — 离线城市库（推荐）" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "xs-wizard__field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: "搜索城市 / 区县" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("ul", { className: "xs-wizard__cities", "data-xuanshu-cities": String(results.items.length), children: results.items.map((city) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("li", { "data-xuanshu-city": city.name, children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__city-name", children: city.name }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__city-region", children: city.region }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "pick-city", onClick: () => {
            onPick(city);
          }, children: "选中" })
        ] }, city.name)) }),
        searching && results.pending ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-note": "city-pending", children: "正在搜更大的城市库（小库结果已经在上面了）…" }) : null,
        noMatch ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__hint", "data-xuanshu-note": "city-no-match", children: "无匹配城市，可改用手输经纬度" }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "② 通道 B — 手输经纬度（GPS 十进制）" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "xs-wizard__manual", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "xs-wizard__field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: "经度（-180 ~ 180）" }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "xs-wizard__field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: "纬度（-90 ~ 90）" }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "apply-manual", onClick: () => {
            onManual(lonText, latText);
          }, children: "应用" })
        ] }),
        manualHint === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__hint", "data-xuanshu-note": "manual-rejected", children: manualHint }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "③ 地名与坐标（同框可见）" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("p", { className: "xs-wizard__place", "data-xuanshu-place": placeLabel(draft), children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__place-name", children: placeLabel(draft) }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__place-coord", "data-xuanshu-coord": "frame", children: missing.length === 0 && draft.lon !== void 0 && draft.lat !== void 0 ? formatCoords(draft.lon, draft.lat) : `还没定（缺 ${missing.join(" / ")}）` }),
          draft.place.trim() === "" ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("small", { className: "xs-wizard__note", children: [
            "手输无地名时据实显示「",
            UNNAMED_PLACE,
            "」，不留旧地名"
          ] }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__status", "data-xuanshu-note": "has-coords", children: `当前：${missing.length === 0 ? "有经纬度" : `无经纬度（缺 ${missing.join(" / ")}）`}` }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "④ 地图选点" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-note": "no-map", children: "地图选点：玄枢 v1 不做（无联网依赖）" })
      ]
    }
  );
}
function XsZoneStep({ draft, zone, pending, onZone, onAuto }) {
  const unresolved = zone !== void 0 && zone.zone === null;
  const autoZone = zone?.zone ?? "";
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    StepShell,
    {
      step: 3,
      title: STEP_TITLES[2],
      hint: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 依据：经纬度 + 出生日期（客户端不自己算时区，一律问底座）。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 自动结果只归并 IANA 名，不写死偏移；夏令时由底座判。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 中国大陆统一北京时间：只把 `Asia/Urumqi` 并入 `Asia/Shanghai`，偏移仍按 IANA 算。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 时区只负责「钟表时间 → UTC」的偏移归一；真太阳时换算在引擎里，录入层不换算。" })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "① 自动结果" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "xs-wizard__zone-auto", "data-xuanshu-zone": "auto", children: [
          pending === true ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-zone": "pending", children: "重算中…" }) : zone === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__note", children: "先在第 2 步定下出生地，这里会自动推导。" }) : autoZone === "" ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__hint", "data-xuanshu-zone": "unresolved", children: "自动推导失败（坐标越界或该点查不到时区）：请在下面手动指定一个 UTC 偏移，否则不能出盘。" }) : /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("p", { className: "xs-wizard__zone-value", "data-xuanshu-zone": "resolved", children: [
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("strong", { children: autoZone }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: formatOffsetMinutes(zone.offsetMinutes) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__note", children: `夏令时：${zone.dst === true ? "有" : "无"}` })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__note", children: "依据：经纬度 + 出生日期" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "② 手动覆盖（仅当自动不对）" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "xs-wizard__zone-manual", "data-xuanshu-zone": "manual", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "xs-wizard__field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: "固定 UTC 偏移（28 档）" }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
              "select",
              {
                "data-xuanshu-field": "zone-override",
                value: draft.zoneManual ? draft.zone : "",
                onChange: (event) => {
                  onZone(event.target.value);
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "", children: "跟随自动结果" }),
                  ZONE_OFFSETS.map((row) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: row.value, children: `${row.value} ${row.label}` }, row.value))
                ]
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-note": "zone-current", children: draft.zoneManual ? `当前：手动指定 ${draft.zone}` : `当前：自动结果 ${draft.zone === "" ? "（未定）" : draft.zone}` })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "③ 时区只负责一步" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-note": "zone-boundary", children: "时区只负责「钟表时间 → UTC」的偏移归一；真太阳时换算在引擎里，录入层不换算。" })
      ]
    }
  );
}
function XsTimeAlgStep({ draft, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    StepShell,
    {
      step: 4,
      title: STEP_TITLES[3],
      hint: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 默认档 = 0（真太阳时）：实现上**省略该键**，不写默认值。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 「春分定卯时（= 2）」上游自身未实现 —— 界面上不出现，也不置灰。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 换算发生在**引擎内部**：录入层不换算（界面上没有「真太阳时修正」开关，找不到是设计）。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 其余旋钮玄枢不给：长生 / 神煞 / 晚子时 / 命宫 / 月律分野 / 流派 / 显示区（索引 D4）。" })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "① 时间算法（timeAlg）" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "xs-wizard__radio-group", "data-xuanshu-field": "time-alg", children: TIME_ALG_OPTIONS.map((option) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "xs-wizard__radio", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: option.label }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("small", { className: "xs-wizard__note", children: option.hint })
        ] }, option.value)) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "② 性别（排大运用）" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "xs-wizard__radio-group", "data-xuanshu-field": "gender", children: GENDER_OPTIONS.map((option) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "xs-wizard__radio", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: option.label }),
          option.hint === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("small", { className: "xs-wizard__note", children: option.hint })
        ] }, option.value)) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "③ 其余旋钮" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-note": "no-other-knobs", children: "一律由引擎缺省决定，界面不出现：长生 / 神煞查法 / 晚子时四态 / 命宫起法 / 月律分野 / 南半球月令 / 起运精度 / 藏干版本 / 生肖归属 / 断命流派 / 显示区。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "④ 换算发生在哪一层" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__note", "data-xuanshu-note": "no-conversion-here", children: "引擎内部；录入层不换算。" })
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
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    StepShell,
    {
      step: 5,
      title: STEP_TITLES[4],
      hint: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 五项逐行核对，每行 `[改]` 回跳对应步。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ 「不确定项」把「只知道大概」显式化，写进 `clarification_notes`（不是拒绝出盘）。" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: "▸ `[x] 以上信息我已核对` 是出盘的解锁条件；底座回问就地展开，回答后重出盘。" })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("fieldset", { className: "xs-wizard__confirm", "data-xuanshu-busy": busy ? "cast" : void 0, disabled: busy, children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("legend", { children: "① 确认你的出生信息" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("ul", { className: "xs-wizard__confirm-list", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("li", { "data-xuanshu-confirm": "time", children: [
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__confirm-label", children: "出生时间" }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__confirm-value", children: `${draft.date === "" ? "（未填）" : draft.date} ${draft.time === "" ? "（未填）" : draft.time} 当地时间` }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "edit-step-1", onClick: () => {
                onEdit(1);
              }, children: "改" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("li", { "data-xuanshu-confirm": "place", children: [
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__confirm-label", children: "出生地" }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__confirm-value", children: `${placeLabel(draft)} ${coordinates.length === 0 && draft.lon !== void 0 && draft.lat !== void 0 ? formatCoords(draft.lon, draft.lat) : `（缺 ${coordinates.join(" / ")}）`}` }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "edit-step-2", onClick: () => {
                onEdit(2);
              }, children: "改" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("li", { "data-xuanshu-confirm": "zone", children: [
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__confirm-label", children: "时区" }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__confirm-value", children: `${draft.zone === "" ? "（未定）" : draft.zone}${draft.zoneManual ? "（手动指定）" : "（自动）"}${zone?.dst === true && !draft.zoneManual ? "，已判 DST" : ""}` }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "edit-step-3", onClick: () => {
                onEdit(3);
              }, children: "改" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("li", { "data-xuanshu-confirm": "timeAlg", children: [
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__confirm-label", children: "时间算法" }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__confirm-value", children: `${timeAlgLabel(draft.timeAlg)}${draft.timeAlg === 0 ? "（缺省省略 = 0）" : ` = ${String(draft.timeAlg)}`}` }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "edit-step-4", onClick: () => {
                onEdit(4);
              }, children: "改" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("li", { "data-xuanshu-confirm": "gender", children: [
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__confirm-label", children: "性别" }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__confirm-value", children: genderLabel(draft.gender) }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "edit-step-4", onClick: () => {
                onEdit(4);
              }, children: "改" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "② 不确定项 → clarification_notes" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "xs-wizard__notes", children: NOTE_OPTIONS.map((option) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "xs-wizard__check", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
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
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: option.label })
          ] }, option.id)) }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "③ 澄清闸" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "xs-wizard__check", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
              "input",
              {
                type: "checkbox",
                "data-xuanshu-field": "verified",
                checked: draft.verified,
                onChange: onToggleVerified
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: "以上信息我已核对" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__note", children: "勾选后才解锁出盘；底座若回问，会在这里就地展开（拦截期间不落谱、不点亮命盘卡）。" }),
          gate === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "xs-wizard__gate", "data-xuanshu-gate": "prompt", role: "alert", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "底座需要你确认" }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__gate-prompt", "data-xuanshu-gate": "prompt-text", children: gate.promptToUser }),
            gate.questions.map((question) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__gate-question", "data-xuanshu-gate": "question", children: question }, question)),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "xs-wizard__field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: "你的回答（随 clarification_notes 一起给底座）" }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
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
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "xs-wizard__actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
                "button",
                {
                  type: "button",
                  "data-xuanshu-action": "answer-gate",
                  disabled: busy || gateAnswer.trim() === "",
                  onClick: onAnswerGate,
                  children: "回答并重新出盘"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "edit-birth", onClick: () => {
                onEdit(1);
              }, children: "改出生信息" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "xs-wizard__cast", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "xs-wizard__status", "data-xuanshu-status": ready ? "ready" : "blocked", children: ready ? "可出盘" : coordinates.length > 0 ? "缺经纬度（禁用）" : "信息未齐（禁用）" })
        ] }),
        ready ? null : /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "xs-wizard__reason", "data-xuanshu-reason": "cast-disabled", children: [
          coordinates.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__reason-main", children: CAST_MISSING_REASON }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "xs-wizard__actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "goto-place", onClick: onGotoPlace, children: "去填出生地" }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", "data-xuanshu-action": "goto-manual", onClick: onGotoManual, children: "改用手输经纬度" })
            ] })
          ] }),
          others.map((blocker) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "xs-wizard__reason-row", "data-xuanshu-reason-row": blocker, children: CAST_BLOCK_REASON[blocker] }, blocker))
        ] })
      ]
    }
  );
}

// src/client/onboarding.tsx
var import_jsx_runtime13 = require("react/jsx-runtime");
var MANUAL_REJECTED_HINT = "经纬度不合法，已忽略（经度在前，例如 118.78 / 32.06）";
function useCityQuery(api, query) {
  const controller = (0, import_react11.useMemo)(
    () => createCityQuery({
      // 失败**不在这里吞**：让 `bazi.cities` 的拒绝走到调度器里，由它静默回落小库。
      loadFull: (keyword, signal) => api.cities({ query: keyword, limit: CITY_RESULT_LIMIT }, signal).then((result) => result.items)
    }),
    [api]
  );
  (0, import_react11.useEffect)(() => {
    controller.setQuery(query);
  }, [controller, query]);
  (0, import_react11.useEffect)(() => () => {
    controller.dispose();
  }, [controller]);
  return (0, import_react11.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
function OnboardingPanel({ api, controller, navigate, preloadedDraft }) {
  const [draft, setDraft] = (0, import_react11.useState)(() => preloadedDraft ?? defaultDraft());
  const [step, setStep] = (0, import_react11.useState)(1);
  const [query, setQuery] = (0, import_react11.useState)("");
  const [zone, setZone] = (0, import_react11.useState)(void 0);
  const [zonePending, setZonePending] = (0, import_react11.useState)(false);
  const [manualHint, setManualHint] = (0, import_react11.useState)(void 0);
  const [gateAnswer, setGateAnswer] = (0, import_react11.useState)("");
  const [result, setResult] = (0, import_react11.useState)(void 0);
  const [busy, setBusy] = (0, import_react11.useState)(false);
  const castSequence = (0, import_react11.useRef)(0);
  const zoneSequence = (0, import_react11.useRef)(0);
  const cityResults = useCityQuery(api, query);
  const patch = (next) => {
    setDraft((current) => ({ ...current, ...next }));
  };
  (0, import_react11.useEffect)(() => {
    const prefill = controller.consumePrefill();
    if (prefill === void 0) return;
    setDraft(prefill);
    setStep(1);
    setResult(void 0);
    setGateAnswer("");
  }, [controller]);
  const { lon, lat, date, time, zoneManual } = draft;
  (0, import_react11.useEffect)(() => {
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
    setStep(Math.min(5, Math.max(1, target)));
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
      setDraft(defaultDraft());
      setStep(1);
      navigate("overview");
    }).catch((error) => {
      if (mine !== castSequence.current) return;
      setResult({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      setBusy(false);
    });
  };
  const gate = result?.phase === "gate" ? result.gate : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("main", { className: "xs-wizard", "data-xuanshu-panel": ONBOARDING_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("header", { className: "xs-wizard__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("h1", { children: "八字冷启动向导" }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "xs-wizard__note", children: "填一次出生信息 → 出盘 → 落底座谱 → 点亮命盘卡，之后不再重复录入。" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(XsStepBar, { step }),
    step === 1 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(XsTimeStep, { draft, onChange: patch, onNudge: nudge, onNow: useNow }) : null,
    step === 2 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
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
    step === 3 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
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
    step === 4 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(XsTimeAlgStep, { draft, onChange: patch }) : null,
    step === 5 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
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
    result === void 0 || result.phase === "gate" ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
      "div",
      {
        className: "xs-wizard__cast-result",
        "data-xuanshu-cast": result.phase,
        role: result.phase === "ok" ? "status" : "alert",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { children: result.message }),
          result.phase === "ok" ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "xs-wizard__actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("button", { type: "button", "data-xuanshu-action": "cast-retry", onClick: () => {
              cast();
            }, children: "重试" }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("button", { type: "button", "data-xuanshu-action": "cast-edit", onClick: () => {
              gotoStep(1);
            }, children: "改出生信息" })
          ] })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("footer", { className: "xs-wizard__footer", children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("button", { type: "button", "data-xuanshu-action": "prev", disabled: step === 1, onClick: () => {
        gotoStep(step - 1);
      }, children: "<- 上一步" }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("button", { type: "button", "data-xuanshu-action": "next", disabled: step === 5, onClick: () => {
        gotoStep(step + 1);
      }, children: "下一步 ->" }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "xs-wizard__spacer" }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("button", { type: "button", "data-xuanshu-action": "cancel", onClick: cancel, children: "取消向导" })
    ] })
  ] });
}
function OnboardingIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("path", { d: "M4 20h16" }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("path", { d: "M6 20V9.5L12 4l6 5.5V20" }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("path", { d: "M9.5 20v-5h5v5" })
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

// src/client/OverviewIcon.tsx
var import_jsx_runtime14 = require("react/jsx-runtime");
function OverviewIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { className: "xs-overview-icon", "data-xuanshu-panel": PANEL_ID, children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(GlyphOverview, { className: "xs-overview-icon__glyph", size }) });
}

// src/client/OverviewPanel.tsx
var import_react12 = require("react");
var import_jsx_runtime15 = require("react/jsx-runtime");
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
  const revision = (0, import_react12.useSyncExternalStore)(active.subscribe, active.getRevision, active.getRevision);
  const [status, setStatus] = (0, import_react12.useState)(
    preloaded ?? (api === void 0 ? { state: "empty" } : void 0)
  );
  (0, import_react12.useEffect)(() => {
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
  const base = { content: status.content, date: status.date };
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
  const revision = (0, import_react12.useSyncExternalStore)(active.subscribe, active.getRevision, active.getRevision);
  const [status, setStatus] = (0, import_react12.useState)(
    preloaded ?? (api === void 0 ? { date: "", exists: false } : void 0)
  );
  (0, import_react12.useEffect)(() => {
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
  const revision = (0, import_react12.useSyncExternalStore)(active.subscribe, active.getRevision, active.getRevision);
  const [status, setStatus] = (0, import_react12.useState)(
    preloaded ?? (api === void 0 ? { exists: false, meta: null } : void 0)
  );
  (0, import_react12.useEffect)(() => {
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
  preloadedRikkeStatus,
  preloadedRikkeOutcome,
  preloadedDigaoStatus,
  preloadedDigaoOutcome,
  today,
  baseplateReady,
  onStartOnboarding,
  onOpenDetail,
  onGenerate,
  onRefresh,
  onRetry
}) {
  const date = today ?? localDate();
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
  const baseplate = baseplateReady ?? destiny.state === "ready";
  const generateRikke = rikkeController === void 0 ? onGenerate : () => {
    void rikkeController.generate();
  };
  const refreshDigao = digaoController === void 0 ? onRefresh : () => {
    void digaoController.refresh();
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
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "xs-overview", "data-xuanshu-panel": PANEL_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("header", { className: "xs-overview__header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("h1", { className: "xs-overview__title", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "xs-overview__home", children: PANEL_HOME }),
        " · ",
        PANEL_TITLE
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "xs-overview__localnote", "data-xuanshu-note": "local-data", children: PANEL_LOCAL_NOTE })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "xs-overview__grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(XsDestinyCard, { state: destiny.state, snapshot: destiny.snapshot, ...injected }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
        XsRikkeCard,
        {
          state: rikkeState.state,
          today: rikkeState.date === void 0 || rikkeState.date === "" ? date : rikkeState.date,
          content: rikkeState.content,
          reason: rikkeState.reason,
          ...injected
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
        XsDigaoCard,
        {
          state: digaoState.state,
          summary: digaoState.summary,
          reason: digaoState.reason,
          baseplateEstablished: baseplate,
          ...injected
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(XsQuickLinks, { baseplateReady: baseplate, navigate, mainPanels })
    ] })
  ] });
}

// src/client/PuPanel.tsx
var import_react13 = require("react");
var import_jsx_runtime16 = require("react/jsx-runtime");
var pendingJob;
var pendingView = "create";
var pendingSelected;
var blank = { name: "", level: "optional", description: "", body: "# 概览\n", summary: "" };
var errorText4 = (error) => error instanceof Error ? error.message : String(error);
async function fileData(file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
  return { name: file.name, data };
}
function PuPanel({ ctx }) {
  const [rows, setRows] = (0, import_react13.useState)([]);
  const [loading, setLoading] = (0, import_react13.useState)(true);
  const [query, setQuery] = (0, import_react13.useState)("");
  const [level, setLevel] = (0, import_react13.useState)("");
  const [source, setSource] = (0, import_react13.useState)("");
  const [view, setView] = (0, import_react13.useState)(pendingJob ? pendingView : "list");
  const [step, setStep] = (0, import_react13.useState)(pendingJob ? 3 : 1);
  const [job, setJob] = (0, import_react13.useState)(pendingJob);
  const [text, setText] = (0, import_react13.useState)("");
  const [files, setFiles] = (0, import_react13.useState)([]);
  const [draft, setDraft] = (0, import_react13.useState)(pendingJob && pendingView === "detail" && pendingSelected ? pendingSelected : blank);
  const [selected, setSelected] = (0, import_react13.useState)(pendingSelected);
  const [original, setOriginal] = (0, import_react13.useState)(pendingSelected ? JSON.stringify(pendingSelected) : "");
  const [error, setError] = (0, import_react13.useState)("");
  const [busy, setBusy] = (0, import_react13.useState)(false);
  const call = (method, payload) => rpcCall(ctx, method, payload);
  const reload = async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await call("pu.list"));
    } catch (e) {
      setError(errorText4(e));
    } finally {
      setLoading(false);
    }
  };
  (0, import_react13.useEffect)(() => {
    void reload();
  }, []);
  (0, import_react13.useEffect)(() => {
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
        if (!disposed) setError(errorText4(e));
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status]);
  (0, import_react13.useEffect)(() => {
    if (job?.status === "ready" && job.draft && step === 3 && view === "create") {
      setDraft(job.draft);
      setStep(4);
    }
  }, [job, step]);
  const run = async (operation) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (e) {
      setError(errorText4(e));
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
  const levels = /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
    "级别 ",
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("select", { value: draft.level, onChange: (e) => field("level", e.target.value), children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("option", { value: "base", children: "基础输入级 base" }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("option", { value: "optional", children: "可选输入级 optional" })
    ] })
  ] });
  const preview = /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "xs-pu-detail", children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
      "名称",
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("input", { value: draft.name, onChange: (e) => field("name", e.target.value) })
    ] }),
    levels,
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
      "描述（manifest 概览，AI 优先读）",
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("textarea", { value: draft.description, onChange: (e) => field("description", e.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
      "细节（Markdown 一级标题分节，须含概览）",
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("textarea", { className: "xs-pu-body", value: draft.body, onChange: (e) => field("body", e.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
      "汇总 summary.md（AI 快速定位，人可改）",
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("textarea", { value: draft.summary, onChange: (e) => field("summary", e.target.value) })
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
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("main", { className: "xs-pu", "aria-label": "谱管理", children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h1", { children: view === "create" ? "创建新谱" : view === "detail" ? `谱管理 / ${selected?.name}` : "谱管理" }),
      view !== "list" && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: back, children: "← 返回列表" })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { role: "alert", children: [
      error,
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => void reload(), children: "重试" }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "数据目录：$DSH_HOME/xuanshu/pus/" })
    ] }),
    view === "list" && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "xs-pu-toolbar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("input", { "aria-label": "搜索谱", placeholder: "搜索 名称 / 描述 / 正文", value: query, onChange: (e) => setQuery(e.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("select", { "aria-label": "级别筛选", value: level, onChange: (e) => setLevel(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("option", { value: "", children: "全部级别" }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("option", { value: "base", children: "基础输入级" }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("option", { value: "optional", children: "可选输入级" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("select", { "aria-label": "来源筛选", value: source, onChange: (e) => setSource(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("option", { value: "", children: "全部来源" }),
          ["manual", "ai-assisted", "sediment", "workflow"].map((s) => /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("option", { children: s }, s))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => {
          setView("create");
          setStep(pendingJob ? 3 : 1);
          setJob(pendingJob);
          if (!pendingJob) setDraft(blank);
        }, children: "＋ 创建新谱" })
      ] }),
      loading ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { role: "status", children: "正在读取谱…" }) : /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("h2", { children: [
            "基础输入级 base · ",
            filtered.filter((p) => p.level === "base").length,
            " 个"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "进底稿提炼源 · 级别≠必填：所有谱都非必填，唯一必填项是底座八字。" }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { children: [
            "🔒 底座（八字） · 只读 · 由出生信息与底座生成 · 默认在场 · 不可关 ",
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => window.alert("底座默认在场、不可关；要修改，请重新录制出生信息并确认。"), children: "打开" })
          ] })
        ] }),
        ["base", "optional"].map((group) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { children: [
          group === "optional" && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("h2", { children: [
              "可选输入级 optional · ",
              filtered.filter((p) => p.level === group).length,
              " 个"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "底稿不采 · 问事时按需追加" })
          ] }),
          filtered.filter((p) => p.level === group || group === "optional" && p.error).map((p) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("article", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("strong", { children: p.name }),
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: p.description }),
              /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("small", { children: [
                p.source,
                " · ",
                p.updatedAt,
                p.stale && " · 汇总可能过期"
              ] }),
              p.error && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { role: "alert", children: p.error })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { disabled: !!p.error || busy, onClick: () => open(p.slug), children: "打开 / 编辑" })
          ] }, p.slug))
        ] }, group)),
        !filtered.length && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: rows.length ? "没有匹配的谱" : "还没有可选谱：谱由你积累，非必填、不阻塞使用。" }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => {
            setQuery("");
            setLevel("");
            setSource("");
          }, children: "清空筛选" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "本列表只收谱。工作区 / 工作流与谱并列独立、不是谱。你自己的本地文件在藏库里，永不进 AI。" })
    ] }),
    view === "detail" && selected && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
      preview,
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { children: [
        draft.level === "base" ? "本谱是底稿提炼源（进底稿）" : "底稿不采；问事时按需追加",
        " · 级别变更下次底稿刷新生效。"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { children: [
        "元信息：spec pu/1 · source ",
        selected.source,
        " · updated_at ",
        selected.updatedAt,
        " · 签：预留字段，暂不启用"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { children: [
        "数据目录：$DSH_HOME/xuanshu/pus/",
        selected.slug,
        "/"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { disabled: busy, onClick: () => void run(async () => {
        if (draft.body !== selected.body && draft.summary !== selected.summary && !window.confirm(`正文与汇总均改变。${draft.level === "base" ? "会影响底稿提炼源。" : "只在问事按需追加。"}确认保存这些事实？`)) return;
        const saved = await call("pu.update", { slug: selected.slug, draft, confirmed: true });
        setSelected(saved);
        setDraft(saved);
        setOriginal(JSON.stringify(saved));
        await reload();
      }), children: "保存" }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { disabled: busy || job?.status === "running", onClick: () => void run(async () => {
        const created = await call("pu.generate", { name: draft.name, level: draft.level, text: `# 当前谱
${draft.description}
${draft.body}`, summaryOnly: true });
        pendingJob = created;
        pendingView = "detail";
        pendingSelected = { ...selected, ...draft };
        setJob(created);
      }), children: "重建 summary（AI 提炼）" }),
      job?.status === "ready" && job.draft && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => {
        field("summary", job.draft.summary);
        pendingJob = void 0;
        setJob(void 0);
      }, children: "采用候选汇总（保存后落盘）" })
    ] }),
    view === "create" && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { "aria-label": "创建步骤", children: "① 给资料 → ② 定义谱名 → ③ AI 转换中 → ④ 生成预览 → ⑤ 确认落盘" }),
      step === 1 && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
          "资料文字",
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("textarea", { value: text, onChange: (e) => setText(e.target.value), placeholder: "把你知道的先写进来" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
          "附件（MD / PDF / 任意文件）",
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("input", { type: "file", multiple: true, onChange: (e) => setFiles(Array.from(e.target.files ?? [])) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("ul", { children: files.map((f, i) => /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("li", { children: f.name }, i)) }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "语音输入 v2 再做。" }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { disabled: !text.trim() && !files.length, onClick: () => setStep(2), children: "下一步" })
      ] }),
      step === 2 && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
          "谱名",
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("input", { value: draft.name, onChange: (e) => field("name", e.target.value) })
        ] }),
        levels,
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "谱名唯一 · 目录名小写、- 连接、可含中文。所有谱均非必填。" }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { children: [
          "预览：pus/",
          draft.name.trim().normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-+|-+$/g, ""),
          "/"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => setStep(1), children: "返回改资料" }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { disabled: busy || !draft.name.trim(), onClick: generate, children: "开始转换" })
      ] }),
      step === 3 && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { role: "status", children: [
        job?.status === "running" ? "AI 正在读取资料、分节并提炼汇总。" : job?.error ?? "转换已中断，可重新开始。",
        " 借用 DSH coding 工具；中断不落盘。",
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { disabled: job?.status !== "running", onClick: () => void run(async () => {
          const canceled = await call("pu.cancel", { id: job?.id });
          setJob(canceled);
          pendingJob = void 0;
        }), children: "中断" }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => setStep(2), children: "返回改" })
      ] }),
      step === 4 && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
        preview,
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "这一步只是预览，pus/ 下还没有任何文件。落盘后会出现在谱列表。" }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => setStep(2), children: "返回改" }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { disabled: busy || job?.status !== "ready", onClick: () => void run(async () => {
          await call("pu.confirm", { id: job?.id, draft, level: draft.level, confirmed: true });
          pendingJob = void 0;
          setJob(void 0);
          setStep(5);
          await reload();
        }), children: "确认落盘" })
      ] }),
      step === 5 && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "已落盘：manifest.md + content.md + summary.md" }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: back, children: "回谱列表" })
      ] })
    ] }),
    job?.status === "running" && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { children: [
      "审批由 DSH 决定，玄枢不自建审批。",
      ctx.uiWorkspace && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => ctx.uiWorkspace?.openSession(job.sessionId), children: "在会话里看审批" }),
      view === "detail" && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { onClick: () => void run(async () => {
        const canceled = await call("pu.cancel", { id: job.id });
        setJob(canceled);
        pendingJob = void 0;
      }), children: "中断汇总提炼（不落盘）" }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: "返回「谱」可继续查看生成预览。" })
    ] })
  ] });
}
function installPuPanel(ctx) {
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "pus", inject: () => ({ ctx }) }, PuPanel));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: "pus", order: 40, label: "谱" }, () => /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { "aria-hidden": "true", children: "谱" })));
  if (typeof document === "undefined" || document.getElementById("xs-pu-style")) return;
  const style = document.createElement("style");
  style.id = "xs-pu-style";
  style.textContent = `.xs-pu{padding:24px;overflow:auto;height:100%;color:var(--dsw-alias-text-primary);background:var(--dsw-alias-bg-canvas)}.xs-pu header,.xs-pu-toolbar,.xs-pu article{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.xs-pu article{justify-content:space-between;padding:12px;border-bottom:1px solid var(--dsw-alias-border-default)}.xs-pu label{display:block;margin:12px 0}.xs-pu input,.xs-pu select,.xs-pu textarea,.xs-pu button{color:inherit;background:var(--dsw-alias-bg-surface);border:1px solid var(--dsw-alias-border-default);border-radius:8px;padding:8px;font:inherit}.xs-pu button{cursor:pointer;margin:4px}.xs-pu button:disabled{opacity:.5;cursor:default}.xs-pu textarea{display:block;width:100%;min-height:100px;box-sizing:border-box}.xs-pu .xs-pu-body{min-height:220px;font-family:monospace}.xs-pu-detail{display:grid;grid-template-columns:1fr 1fr;gap:12px}.xs-pu section{margin:24px 0}.xs-pu [role=alert]{padding:12px;border:1px solid var(--dsw-alias-border-danger)}@media(max-width:1100px){.xs-pu-detail{grid-template-columns:1fr}.xs-pu{padding:16px}}`;
  document.head.appendChild(style);
}

// src/client/rikke-api.ts
var RIKKE_ENDPOINTS = {
  status: "rikke.status",
  generate: "rikke.generate",
  setTime: "rikke.setTime"
};
function createRikkeApi(ctx) {
  return {
    status: (payload, signal) => rpcCall(ctx, RIKKE_ENDPOINTS.status, payload ?? {}, signal),
    generate: (payload, signal) => rpcCall(ctx, RIKKE_ENDPOINTS.generate, payload ?? {}, signal),
    setTime: (payload, signal) => rpcCall(ctx, RIKKE_ENDPOINTS.setTime, payload, signal)
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
var import_react14 = require("react");

// src/client/rikke-style.ts
function installRikkeStyle() {
  if (typeof document === "undefined" || document.getElementById("xs-rikke-style") !== null) return;
  const style = document.createElement("style");
  style.id = "xs-rikke-style";
  style.textContent = `
.xs-rikke{padding:var(--xs-space-page);max-width:var(--xs-size-panel-content-max);margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--xs-text-body)}
.xs-rikke h1,.xs-rikke h2{font-weight:600}.xs-rikke h1{font-size:1.15rem}.xs-rikke h2{font-size:1rem;margin:18px 0 6px}
.xs-rikke__head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.xs-rikke__basis,.xs-rikke__note{line-height:1.8}
.xs-rikke__note{color:var(--xs-text-secondary);font-size:.85rem}
.xs-rikke__no-network{color:var(--xs-text-body)}
.xs-rikke__actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
.xs-rikke button{font:inherit;padding:6px 12px;margin:2px;cursor:pointer;background:var(--xs-surface-card);color:inherit;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control)}
.xs-rikke button:disabled{opacity:.5;cursor:not-allowed}
.xs-rikke input[type=time]{font:inherit;color:inherit;background:var(--xs-surface-card);border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-control);padding:6px}
.xs-rikke__time-edit{border:1px solid var(--xs-constraint-human-gate-fg,var(--xs-edge-card));border-radius:var(--xs-radius-card);padding:10px;margin:8px 0}
.xs-rikke__confirm{border:1px solid var(--xs-constraint-human-gate-fg,var(--xs-edge-card));border-radius:var(--xs-radius-card);padding:10px;margin:8px 0}
.xs-rikke__alert{padding:10px;border:1px solid var(--xs-edge-card);border-radius:var(--xs-radius-card);margin:8px 0}
@media(max-width:1100px){.xs-rikke{padding:16px}}
`;
  document.head.appendChild(style);
}

// src/client/rikke.tsx
var import_jsx_runtime17 = require("react/jsx-runtime");
var RIKKE_NO_NETWORK_NOTE = "不联网取外部资讯：本次内容只用底座 + 上面的时间基准。";
var RIKKE_REGENERATE_CONFIRM = "将覆盖今天的日课，继续？";
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
function RikkePanel({ api, navigate, preloaded, preloadedTimeEdit }) {
  const seeded = preloaded !== void 0;
  const [view, setView] = (0, import_react14.useState)(() => initialView2(preloaded));
  const [busy, setBusy] = (0, import_react14.useState)(false);
  const [confirming, setConfirming] = (0, import_react14.useState)(false);
  const [editing, setEditing] = (0, import_react14.useState)(preloadedTimeEdit === true);
  const [timeDraft, setTimeDraft] = (0, import_react14.useState)(
    () => clockOf(preloaded !== void 0 && !("error" in preloaded) ? preloaded.schedule?.time : void 0)
  );
  const [note, setNote] = (0, import_react14.useState)(void 0);
  const sequence = (0, import_react14.useRef)(0);
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
  (0, import_react14.useEffect)(() => {
    if (seeded) return;
    load();
  }, [api, seeded]);
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
  return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("main", { className: "xs-rikke", "data-xuanshu-panel": RIKKE_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("header", { className: "xs-rikke__head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h1", { children: `日课 · ${date}` }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "xs-rikke__note", "data-xuanshu-state": view.kind, children: view.kind === "ready" ? "今日日课已到" : view.kind === "empty" ? "今天还没有生成日课" : view.kind === "error" ? "生成失败" : "读取中…" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "xs-rikke__basis", "data-xuanshu-note": "time-basis", children: `时间基准：${date} ${status?.generatedAt ?? "（生成时刻未回传）"} · ${status?.zone ?? "（时区未回传）"} · 本机时钟` }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "xs-rikke__basis xs-rikke__no-network", "data-xuanshu-note": "no-network", children: RIKKE_NO_NETWORK_NOTE }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "xs-rikke__note", "data-xuanshu-note": "schedule", children: schedule === void 0 ? "计划时刻：宿主未回传（在「自动化任务」面板里看这条 daily 任务）" : `计划时刻：每天 ${clockOf(schedule.time)}（${schedule.timeZone}）· 可在「自动化任务」面板里改或停用` }),
    status?.huangli === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "xs-rikke__note", "data-xuanshu-note": "engine", children: `黄历引擎：${status.huangli.tool ?? "huangli"} ${status.huangli.version ?? "（版本未回传）"}（本地，不联网）` }),
    status?.generatedAt === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "xs-rikke__note", "data-xuanshu-note": "generated-at", children: `生成于 ${status.generatedAt}` }),
    view.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "xs-rikke__note", "data-xuanshu-view": "loading", children: "正在读今天的日课…" }) : null,
    view.kind === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("section", { className: "xs-rikke__empty", "data-xuanshu-view": "empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { children: EMPTY_COPY.rike.why }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "xs-rikke__note", children: EMPTY_COPY.rike.sub })
    ] }) : null,
    view.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("section", { className: "xs-rikke__alert", "data-xuanshu-view": "error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { "data-xuanshu-reason": "generate", children: view.message }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: "xs-rikke__actions", children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
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
    content === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "xs-lines", "data-xuanshu-content": "rikke", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("p", { className: "xs-line", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "xs-line__label", children: "宜" }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "xs-line__value", children: content.yi })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("p", { className: "xs-line", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "xs-line__label", children: "忌" }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "xs-line__value", children: content.ji })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("p", { className: "xs-line", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "xs-line__label", children: "流日" }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "xs-line__value", children: content.liuri })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "xs-rikke__actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
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
    note === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "xs-rikke__note", role: "status", "data-xuanshu-note": "time-result", children: note }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "xs-rikke__confirm", "data-xuanshu-confirm": "regenerate", hidden: !confirming, children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { "data-xuanshu-confirm-text": "regenerate", children: RIKKE_REGENERATE_CONFIRM }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "xs-rikke__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("button", { type: "button", "data-xuanshu-action": "regenerate-go", onClick: generate, children: "继续生成 ->" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "xs-rikke__time-edit", "data-xuanshu-time-edit": "rikke", hidden: !editing, children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("label", { children: [
        "日课时刻",
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "xs-rikke__note", children: `时区 ${schedule?.timeZone ?? "（未回传）"}（IANA，不手改）` }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: "xs-rikke__actions", children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("button", { type: "button", "data-xuanshu-action": "save-time", disabled: busy, onClick: saveTime, children: "保存" }) })
    ] })
  ] });
}
function RikkeIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("rect", { x: "3.5", y: "5", width: "17", height: "15", rx: "2" }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("path", { d: "M3.5 10h17M8 3.5v3M16 3.5v3" }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("path", { d: "M8 14h4" })
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

// src/client/style.ts
var STYLE_TAG_ID = "xuanshu-client/overview.css";
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
  font-size: var(--dsh-content-font-size, 15px);
  font-weight: 600;
  color: var(--xs-text-title);
}
.xs-overview__home {
  color: var(--xs-text-brand);
  font-weight: 600;
}
.xs-overview__localnote {
  margin: 0;
  color: var(--xs-text-tertiary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
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
@media (min-width: 1100px) {
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
  font-size: var(--dsh-content-font-size, 15px);
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
  font-size: var(--dsh-content-font-size-secondary, 13px);
}
.xs-empty__sub {
  margin: 0;
  color: var(--xs-text-tertiary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
}

.xs-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: var(--xs-size-chip-height);
  padding: 0 8px;
  border-radius: var(--xs-radius-chip);
  font-size: var(--dsh-content-font-size-secondary, 13px);
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
  font-size: var(--dsh-content-font-size-secondary, 13px);
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
  font-size: var(--dsh-content-font-size-secondary, 13px);
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
  font-size: var(--dsh-content-font-size-secondary, 13px);
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
  font-size: var(--dsh-content-font-size-secondary, 13px);
}
.xs-cell[disabled] .xs-cell__subtitle {
  color: var(--xs-text-disabled);
}
.xs-quicklinks__note {
  margin: var(--xs-space-stack-md) 0 0;
  color: var(--xs-text-tertiary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  text-align: right;
}
`;
function installOverviewStyle() {
  if (typeof document === "undefined") return false;
  const selector = `style[data-plugin-css="${STYLE_TAG_ID}"]`;
  if (document.querySelector(selector) !== null) return false;
  const tag = document.createElement("style");
  tag.dataset.plugin = "xuanshu-client";
  tag.dataset.pluginCss = STYLE_TAG_ID;
  tag.textContent = OVERVIEW_CSS;
  (document.head ?? document.documentElement).appendChild(tag);
  return true;
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
  const baziDeps = { api: bazi, controller: baziController, navigate };
  const consultApi = createConsultApi(rpc);
  const uiWorkspace = ctx.uiWorkspace;
  const sessionCatalog = ctx.sessions;
  const openSession = typeof uiWorkspace?.openSession === "function" ? (sessionId) => {
    uiWorkspace.openSession(sessionId);
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
  const digao = createDigaoApi(rpc);
  const digaoController = createDigaoUiController(digao);
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
    digaoController
  });
  ctx.slots.inject("main", () => {
    const dispose = ctx.slots.register(
      { name: "main", key: PANEL_ID, inject: injected },
      OverviewPanel
    );
    ctx.layout.selectPanel(PANEL_ID);
    return dispose;
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
  installMingpan(rpc, baziDeps);
  installConsult(rpc, {
    api: consultApi,
    navigate,
    openSession,
    refreshSessions,
    mountSlot: (session) => (0, import_react15.createElement)(MountsSectionFor, { controller: mountsController, session })
  });
  installMounts(rpc, { api: mountsApi, workspaces: () => workspaceCatalog.list(), workspaceAvailable: workspaceCatalog.available });
  installDigao(rpc, { api: digao, navigate });
  installRikke(rpc, { api: rikke, navigate });
}
		// 包体中途执行过 module.exports = __toCommonJS(...)，上面的 exports 已过期；
		// 必须重新读取 module.exports，逐个补拷会漏掉将来的新导出。
		return module.exports;
	}
});
