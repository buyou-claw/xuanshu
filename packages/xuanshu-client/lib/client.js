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

		// src/client/OverviewIcon.tsx
		var import_jsx_runtime = require("react/jsx-runtime");
		function OverviewIcon({ size = 16, active }) {
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
		    "svg",
		    {
		      className: "xs-overview-icon",
		      "data-xuanshu-panel": "overview",
		      width: size,
		      height: size,
		      viewBox: "0 0 16 16",
		      role: "img",
		      "aria-hidden": "true",
		      focusable: "false",
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8", cy: "8", r: "5.5", fill: "none", stroke: "currentColor", strokeWidth: 1.4 }),
		        active ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8", cy: "8", r: "2", fill: "currentColor" }) : null
		      ]
		    }
		  );
		}

		// src/client/panel.ts
		var PANEL_ID = "overview";
		var PANEL_ORDER = 20;
		var PANEL_TITLE = "玄枢";
		var PANEL_SUBTITLE = "自我总览";
		var PANEL_PLACEHOLDER = "玄枢首屏空壳：四张卡（命盘 / 日课 / 底稿 / 快捷入口）将在票 07 · 首页替换填入。";
		var PANEL_LABEL = "总览";

		// src/client/OverviewPanel.tsx
		var import_jsx_runtime2 = require("react/jsx-runtime");
		function OverviewPanel(_props) {
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "xs-overview", "data-xuanshu-panel": "overview", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "xs-overview__header", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h1", { className: "xs-overview__title", children: PANEL_TITLE }),
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "xs-overview__subtitle", children: PANEL_SUBTITLE })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "xs-overview__placeholder", children: PANEL_PLACEHOLDER })
		  ] });
		}

		// src/client/index.tsx
		var inject = ["slots"];
		function apply(ctx) {
		  ctx.slots.inject(
		    "main",
		    () => ctx.slots.register({ name: "main", key: PANEL_ID }, OverviewPanel)
		  );
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
