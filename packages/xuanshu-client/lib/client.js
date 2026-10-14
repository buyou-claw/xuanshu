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

// src/client/glyphs.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function GlyphOverview({ className = "xs-glyph", size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 10.5 L12 4.5 L20 10.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6 9 V19.5 H18 V9" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M10 19.5 V14 H14 V19.5" })
      ]
    }
  );
}
function GlyphCardMingpan({ className = "xs-glyph", size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "10", cy: "10", r: "6.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M10 3.5 V16.5 M3.5 10 H16.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "10", cy: "10", r: "0.6", fill: "currentColor", stroke: "none" })
      ]
    }
  );
}
function GlyphCardRike({ className = "xs-glyph", size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "10", cy: "10", r: "6.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M10 6.5 V10 L13 12.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.5 13.5 H16.5" })
      ]
    }
  );
}
function GlyphCardDigao({ className = "xs-glyph", size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "4.5", y: "3.5", width: "11", height: "13", rx: "1.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 3.5 V2 H12 A1.5 1.5 0 0 1 13.5 3.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M7.5 8 H12.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M7.5 11 H12.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M7.5 14 H10.5" })
      ]
    }
  );
}
function GlyphQuickConsult({ className = "xs-glyph", size = 24 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4.5 6 H19.5 V15 H12 L8.5 18.5 V15 H4.5 Z" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 9.3 c0 .2 0 .3-.06.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M9.8 9.2 A2.2 2.2 0 1 1 13 11.3 c-.6.5-.8.9-.8 1.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 14.3 v.01" })
      ]
    }
  );
}
function GlyphQuickWorkspace({ className = "xs-glyph", size = 24 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 7.5 A1.5 1.5 0 0 1 5.5 6 H10 L12 8 H18.5 A1.5 1.5 0 0 1 20 9.5 V16.5 A1.5 1.5 0 0 1 18.5 18 H5.5 A1.5 1.5 0 0 1 4 16.5 Z" })
    }
  );
}
function GlyphQuickWorkflow({ className = "xs-glyph", size = 24 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "5", cy: "8", r: "1.8" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "19", cy: "8", r: "1.8" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "17", r: "1.8" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.7 9 L10.6 15.6 M15.4 15.6 L17.3 9" })
      ]
    }
  );
}
function IllusMingpanEmpty({ className = "xs-empty__illus" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { className, viewBox: "0 0 120 80", fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "60", cy: "29", r: "21", stroke: "currentColor", strokeWidth: 1.5 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "60", cy: "29", r: "12", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M60 17v24M48 29h24", stroke: "currentColor", strokeWidth: 1, opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M60 50v15", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M60 50l7 5-7 5z", stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M52 65h16", stroke: "currentColor", strokeWidth: 1, strokeLinecap: "round", strokeDasharray: "4 3", opacity: 0.4 })
  ] });
}
function IllusRikeEmpty({ className = "xs-empty__illus" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { className, viewBox: "0 0 120 80", fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "86", cy: "22", r: "8", stroke: "currentColor", strokeWidth: 1.2, opacity: 0.4 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M86 8v-3M86 36v3M72 22h-3M100 22h3", stroke: "currentColor", strokeWidth: 1, opacity: 0.25 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "22", y: "28", width: "58", height: "36", rx: "4", stroke: "currentColor", strokeWidth: 1.5 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M30 40h42M30 47h42M30 54h28", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M22 34h58", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" })
  ] });
}
function IllusDigaoEmpty({ className = "xs-empty__illus" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { className, viewBox: "0 0 120 80", fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "30", y: "16", width: "60", height: "48", rx: "4", stroke: "currentColor", strokeWidth: 1.5 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M30 24h60", stroke: "currentColor", strokeWidth: 1, strokeLinecap: "round", opacity: 0.4 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M38 34h30M38 42h42M38 50h24", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M44 58h8M60 58h8M76 58h8", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", opacity: 0.4 })
  ] });
}
function IllusCardsError({ className = "xs-empty__illus" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { className, viewBox: "0 0 120 80", fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "28", y: "20", width: "56", height: "40", rx: "5", stroke: "currentColor", strokeWidth: 1.5 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M28 32h56", stroke: "currentColor", strokeWidth: 1, opacity: 0.4 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M36 44h16M36 51h24", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.3 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M88 44l6 6M94 44l-6 6", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M16 24l8 8M24 24l-8 8", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", opacity: 0.35 })
  ] });
}

// src/client/panel.ts
var PANEL_ID = "overview";
var PANEL_ORDER = 20;
var PANEL_LABEL = "总览";
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
  onboarding: "八字冷启动向导还没装配（属票 08）",
  generate: "日课生成还没接上（属票 13 · 底稿与日课）",
  refreshDigao: "底稿刷新还没接上（属票 13 · 底稿与日课）",
  openDetail: "命盘详情还没装配（属票 08）",
  retry: "取数重试还没接上（属票 08 / 13）"
};

// src/client/OverviewIcon.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function OverviewIcon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "xs-overview-icon", "data-xuanshu-panel": PANEL_ID, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(GlyphOverview, { className: "xs-overview-icon__glyph", size }) });
}

// src/client/watch.ts
var import_react = require("react");
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
  return (0, import_react.useSyncExternalStore)(watch.subscribe, watch.getSnapshot, watch.getSnapshot);
}
var EMPTY_MAIN_PANELS = {
  subscribe: () => () => {
  },
  getSnapshot: () => EMPTY_KEYS
};
var EMPTY_KEYS = [];

// src/client/cards.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function useAvailable(mainPanels) {
  return useMainPanels(mainPanels);
}
function isAvailable(available, target) {
  return available.includes(target);
}
function ActionButton({ action, children, primary, disabled, reason, onClick }) {
  const className = primary ? "xs-btn xs-btn--primary" : "xs-btn";
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "xs-card", "data-xuanshu-card": card, "data-xs-state": state, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "xs-card__head", children: [
      icon,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { className: "xs-card__title", children: title }),
      badge
    ] }),
    children
  ] });
}
function XsReadonlyBadge() {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-badge xs-badge--readonly", "data-xuanshu-badge": "readonly", children: BADGE_READONLY });
}
function XsPureDerivedBadge() {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-badge xs-badge--derived", "data-xuanshu-badge": "derived", children: BADGE_DERIVED });
}
function XsEmptyBlock({
  illus,
  why,
  sub,
  actions,
  variant = "empty"
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: variant === "error" ? "xs-card__error" : "xs-card__empty", children: [
    illus,
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "xs-empty__why", children: why }),
    sub === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "xs-empty__sub", children: sub }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "xs-card__actions", children: actions })
  ] });
}
function XsSkeleton({ lines, blocks = 0, badgePlaceholder = false }) {
  const bars = Array.from({ length: lines }, (_, index) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "xs-skeleton__bar xs-skeleton__shimmer" }, `line-${String(index)}`));
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-skeleton", "data-xuanshu-skeleton": "card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "xs-skeleton__bar xs-skeleton__bar--head xs-skeleton__shimmer" }),
    badgePlaceholder ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "xs-skeleton__bar xs-skeleton__bar--badge xs-skeleton__shimmer" }) : null,
    blocks > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "xs-skeleton__blocks", children: Array.from({ length: blocks }, (_, index) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "xs-skeleton__block xs-skeleton__shimmer" }, `block-${String(index)}`)) }) : null,
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
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    XsCardShell,
    {
      card: "mingpan",
      title: CARD_TITLE.mingpan,
      state,
      icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GlyphCardMingpan, { className: "xs-card__icon" }),
      badge: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(XsReadonlyBadge, {}),
      children: [
        state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(XsSkeleton, { lines: 1, blocks: 4, badgePlaceholder: true }) : null,
        state === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          XsEmptyBlock,
          {
            illus: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IllusMingpanEmpty, {}),
            why: EMPTY_COPY.mingpan.why,
            sub: EMPTY_COPY.mingpan.sub,
            actions: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
        state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          XsEmptyBlock,
          {
            variant: "error",
            illus: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IllusCardsError, {}),
            why: ERROR_COPY.mingpan,
            actions: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
        state === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-card__body", "data-xuanshu-ready": "mingpan", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "xs-pillars", children: PILLAR_ORDER.map(({ key, label }) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-pillar", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-pillar__name", children: label }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-pillar__value", children: snapshot?.pillars[key] ?? "—" })
          ] }, key)) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "xs-basis", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { "data-xuanshu-basis": "true-solar", children: [
              "真太阳时 ",
              snapshot?.basis.trueSolar ?? "—"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { "data-xuanshu-basis": "clock", children: [
              "钟表时 ",
              snapshot?.basis.clock ?? "—"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "xs-card__actions", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
function XsRikkeCard({ state = "empty", today, content, navigate, mainPanels, onGenerate, onRetry }) {
  const available = useAvailable(mainPanels);
  const schedulesReady = isAvailable(available, "schedules");
  const generateDisabled = onGenerate === void 0;
  const retryDisabled = onRetry === void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    XsCardShell,
    {
      card: "rike",
      title: `${CARD_TITLE.rike} · 今天 ${today}`,
      state,
      icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GlyphCardRike, { className: "xs-card__icon" }),
      children: [
        state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(XsSkeleton, { lines: 3 }) : null,
        state === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          XsEmptyBlock,
          {
            illus: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IllusRikeEmpty, {}),
            why: EMPTY_COPY.rike.why,
            sub: EMPTY_COPY.rike.sub,
            actions: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                ActionButton,
                {
                  action: "generate-rikke",
                  disabled: generateDisabled,
                  reason: DISABLED_REASON.generate,
                  onClick: onGenerate,
                  children: ACTION_COPY.generate
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
        state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          XsEmptyBlock,
          {
            variant: "error",
            illus: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IllusCardsError, {}),
            why: ERROR_COPY.rike,
            actions: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
        state === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-card__body", "data-xuanshu-ready": "rike", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-lines", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "xs-line", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-line__label", children: "宜" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-line__value", children: content?.yi ?? "—" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "xs-line", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-line__label", children: "忌" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-line__value", children: content?.ji ?? "—" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "xs-line", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-line__label", children: "流日" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-line__value", children: content?.liuri ?? "—" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-card__actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              NavLink,
              {
                target: "schedules",
                disabled: !schedulesReady,
                reason: DISABLED_REASON.retry,
                onClick: () => navigate("schedules"),
                children: ACTION_COPY.watchFull
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    XsCardShell,
    {
      card: "digao",
      title: CARD_TITLE.digao,
      state,
      icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GlyphCardDigao, { className: "xs-card__icon" }),
      badge: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(XsPureDerivedBadge, {}),
      children: [
        state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(XsSkeleton, { lines: 2, badgePlaceholder: true }) : null,
        state === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          XsEmptyBlock,
          {
            illus: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IllusDigaoEmpty, {}),
            why: copy.why,
            sub: copy.sub,
            actions: baseplateEstablished ? (
              // 空因 (b)：底座已立、从未刷新 —— 冷启动期的 (a) 不提供 [刷新]（S4 文案表逐条说明）。
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                ActionButton,
                {
                  action: "refresh-digao",
                  disabled: refreshDisabled,
                  reason: DISABLED_REASON.refreshDigao,
                  onClick: onRefresh,
                  children: "立即刷新"
                }
              )
            ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
        state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          XsEmptyBlock,
          {
            variant: "error",
            illus: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IllusCardsError, {}),
            why: ERROR_COPY.digao,
            actions: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                ActionButton,
                {
                  action: "retry",
                  disabled: retryDisabled,
                  reason: DISABLED_REASON.retry,
                  onClick: onRetry,
                  children: ACTION_COPY.retry
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
        state === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-card__body", "data-xuanshu-ready": "digao", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "xs-digao-summary", children: [
            "关于我：",
            summary?.segments ?? 0,
            " 段 · 来源 ",
            summary?.sources ?? 0,
            " 路"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-source-links", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: ACTION_COPY.adjustSource }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              NavLink,
              {
                target: "pus",
                disabled: !isAvailable(available, "pus"),
                reason: DISABLED_REASON.pus,
                onClick: () => navigate("pus"),
                children: ACTION_COPY.sourcePu
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              NavLink,
              {
                target: "conversation",
                disabled: !isAvailable(available, "conversation"),
                reason: "DSH 工作区面板不可用",
                onClick: () => navigate("conversation"),
                children: ACTION_COPY.sourceWorkspace
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "xs-card__actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              NavLink,
              {
                target: "digao",
                disabled: !isAvailable(available, "digao"),
                reason: DISABLED_REASON.digao,
                onClick: () => navigate("digao"),
                children: ACTION_COPY.openDigao
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
      icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GlyphQuickConsult, { className: "xs-cell__icon" }),
      title: QUICKLINK.consult.title,
      // 底座未立时问事格副标题换提示句，但格**仍可用**（S4 §3④）。
      subtitle: baseplateReady ? QUICKLINK.consult.subtitle : QUICKLINK_CONSULT_UNREADY,
      disabled: !isAvailable(available, "consult"),
      reason: DISABLED_REASON.consult
    },
    {
      target: "conversation",
      icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GlyphQuickWorkspace, { className: "xs-cell__icon" }),
      title: QUICKLINK.conversation.title,
      subtitle: QUICKLINK.conversation.subtitle,
      disabled: !isAvailable(available, "conversation"),
      reason: "DSH 工作区面板不可用"
    },
    {
      target: "workflow",
      icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GlyphQuickWorkflow, { className: "xs-cell__icon" }),
      title: QUICKLINK.workflow.title,
      subtitle: QUICKLINK.workflow.subtitle,
      disabled: !isAvailable(available, "workflow"),
      reason: DISABLED_REASON.workflow
    }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(XsCardShell, { card: "quicklinks", title: CARD_TITLE.quicklinks, state: "ready", icon: null, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "xs-quicklinks", "data-xuanshu-quicklinks": "3", children: cells.map((cell) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
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
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-cell__title", children: cell.title }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "xs-cell__subtitle", children: cell.subtitle })
        ]
      },
      cell.target
    )) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "xs-quicklinks__note", "data-xuanshu-note": "boundary", children: QUICKLINKS_BOUNDARY })
  ] });
}

// src/client/OverviewPanel.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function localDate(now = /* @__PURE__ */ new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function OverviewPanel({
  navigate,
  mainPanels,
  today,
  baseplateReady = false,
  onStartOnboarding,
  onOpenDetail,
  onGenerate,
  onRefresh,
  onRetry
}) {
  const date = today ?? localDate();
  const injected = { navigate, mainPanels, onStartOnboarding, onOpenDetail, onGenerate, onRefresh, onRetry };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-overview", "data-xuanshu-panel": PANEL_ID, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("header", { className: "xs-overview__header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("h1", { className: "xs-overview__title", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "xs-overview__home", children: PANEL_HOME }),
        " · ",
        PANEL_TITLE
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "xs-overview__localnote", "data-xuanshu-note": "local-data", children: PANEL_LOCAL_NOTE })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "xs-overview__grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(XsDestinyCard, { state: "empty", ...injected }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(XsRikkeCard, { state: "empty", today: date, ...injected }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(XsDigaoCard, { state: "empty", ...injected }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(XsQuickLinks, { baseplateReady, navigate, mainPanels })
    ] })
  ] });
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
var inject = ["slots", "layout", "theme"];
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
  const injected = () => ({ navigate, mainPanels });
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
}
		// 包体中途执行过 module.exports = __toCommonJS(...)，上面的 exports 已过期；
		// 必须重新读取 module.exports，逐个补拷会漏掉将来的新导出。
		return module.exports;
	}
});
