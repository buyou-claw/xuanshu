# xuanshu-client

玄枢（XuanShu）的 **DSH 客户端插件包**：一个包同时提供**宿主半边**（Node 侧）与
**浏览器半边**（预编译 bundle），装进 `xuanshu` profile 后即可被 DSH 的 Web GUI 加载
——**不需要** `dev:web` 热更新，产物随包走。

票 01 的范围是**空壳**：只注册两个槽位并渲染占位内容。
四张卡（命盘 / 日课 / 底稿 / 快捷入口）的内容属票 06。

---

## 1. 目录与文件职责

```
packages/xuanshu-client/
├── package.json          # dsh 清单：bundle.patch（宿主行）+ client{platform:web, inject}
├── cordis.patch.yml      # bundle 层补丁：insert 一行 id/name = xuanshu-client
├── tsconfig.json         # 仅用于 `pnpm typecheck`；构建本身由 esbuild 完成，不做类型检查
├── types/shims.d.ts      # 官方 @deepseek-ai/* 包的最小类型切片（仓库根不装 rc 包）
├── src/client/           # 源码（TS/TSX），**不随包发布**
│   ├── index.tsx         # 入口：导出 cordis 插件 apply / inject，做两次槽位注册
│   ├── OverviewPanel.tsx # `main` keyed 槽 key `overview` 的占位面板
│   ├── OverviewIcon.tsx  # `sidebar.panellist` list 槽行 `overview` 的图标
│   └── panel.ts          # PANEL_ID / PANEL_ORDER / 占位文案
└── lib/                  # 随包发布
    ├── index.js          # 宿主半边：最小 no-op cordis 插件（只为让补丁行 id 进树）
    └── client.js         # 浏览器半边：**预编译并提交**的单文件经典脚本
```

`src/` 与 `types/` 不出现在 `files` 里 —— 分发包只带产物。

## 2. 构建

```bash
# 仓库根
pnpm install          # 首次：装依赖（含本包的 esbuild）
pnpm build:client     # = pnpm --filter ./packages/xuanshu-client run build
# 等价直跑：
node scripts/build-client.mjs
```

`packages/xuanshu-client/package.json` 的 `build` 脚本就是
`node ../../scripts/build-client.mjs`；脚本内所有路径都从 `import.meta.url` 推导，
因此**与 cwd 无关**，直跑与 `pnpm --filter` 行为一致。

**离线、确定性**：只用本仓 `node_modules` 里的 `esbuild`（经 `createRequire` 从**本包目录**
解析，以适配 pnpm 的 isolated 布局 —— 这就是不能写 `import 'esbuild'` 的原因）；
不联网、不读全局包；产物不含时间戳与绝对路径。

**构建即自检**：脚本在写完 `lib/client.js` 后会

1. **静态断言**产物文本（首行 `window.__ModuleLoader__.load(`、含 `id: "xuanshu-client"`、
   含 `exports.apply` / `exports.inject`、无 `sourceMappingURL`、无仓库绝对路径、
   无 react/react-dom 实现标记）；
2. 用 `node:vm` + 假 `window.__ModuleLoader__` + 假 `require` **真的执行一遍产物**，
   物化 factory 并拿假 ctx 调一次 `apply`，断言两个槽位的注册形状
   （`main.key === sidebar.panellist.id === "overview"`）；
3. 断言产物里**每一个** `require(...)` 都落在基线外部依赖表（或 `dsh.client.external`
   的声明）内 —— 这是「外部依赖漂移」的构建期拦截点。

任何一条不过，脚本以非 0 退出。

## 3. 产物形态（为什么长这样）

`lib/client.js` 是**经典脚本**（不是 ESM/UMD/IIFE），整体就是一次
`window.__ModuleLoader__.load`：

```js
window.__ModuleLoader__.load({
	id: "xuanshu-client",
	factory: (require) => {
		"use strict";
		var module = { exports: {} };
		var exports = module.exports;
		/* … esbuild 打出来的 CJS 主体 … */
		// 包体中途执行过 module.exports = __toCommonJS(...)，上面的 exports 已过期；
		// 必须重新读取 module.exports，逐个补拷会漏掉将来的新导出。
		return module.exports;
	}
});
```

三个不显眼但必要的点：

- **必须是经典脚本**：`dsh-client-modules` 把 `exports["./client"]` 指向的文件**原样字节**
  当 JS 送进浏览器，不转译、不打包、不认 `type="module"`。
- **`id` 必须等于包名**，且一个文件只能 `load()` 一次（重复注册会被 loader 判为
  「bundle executed twice」）。脚本里 `id` 直接取自 `package.json` 的 `name`，不可能漂移。
- **尾部只能 `return module.exports;`**，不要改回「逐个补拷」的写法。
  esbuild 的 ESM→CJS 产物在中途执行 `module.exports = __toCommonJS(...)`，
  把 `module.exports` **换成了另一个新对象**；第 6 行的
  `var exports = module.exports` 从那一刻起就是**过期引用**。
  往它上面补拷 `apply`/`inject` 再 `return exports` 只是在当前恰好只有两个导出时
  碰巧正确 —— **多一个导出就会静默丢失**（本仓已用 vm 实测复现）。
  构建脚本里的「导出转发回归探针」会往产物注入第三个导出，一旦有人改回旧写法，
  构建期即失败。

**缩进**：包体整体加两格 tab，与信封一致。但有**护栏** —— 只有确认「逐行加前缀不会
改到字符串内容」时才重排，出现下列任一情况就跳过重排（观感让位于正确性），
并在自检输出里注明：

- body 含反引号 → 可能有跨行模板字面量；
- body 含行尾反斜杠 → 普通字符串里的续行。

当前产物无反引号，走重排路径，自检会打印 `缩进护栏 : 已整体重排为两格 tab`。

## 4. external 清单怎么定

产物里 `require("...")` 的解析发生在浏览器半边，命中不了 module table 就会抛
`require("...") missed the module table`（`dsh-client-modules/lib/client.js:705`）。
所以分两类：

**基线（免声明）** —— 平台预置的 module table 种子，直接 `require` 即可：

```
react
react/jsx-runtime
react-dom
react-dom/client
@deepseek-ai/cordis
@deepseek-ai/dsh-client-store
@deepseek-ai/dsh-client-ui-slots
@deepseek-ai/dsh-client-ui-primitives
@deepseek-ai/dsh-client-ui-dockkit
```

本包实际只用到 **`react/jsx-runtime`**（JSX 自动运行时，`jsx: 'automatic'`）。
`scripts/build-client.mjs` 的 `BASELINE_EXTERNALS` 列的是**整表**，用途是构建期校验，
不是「我们都用了」。

**超出基线的**：写进 `package.json` 的 `dsh.client.external`（**精确请求串**，可含子路径，
例如 `"@deepseek-ai/dsh-api-gateway/client"`）。本包当前为空，故该字段省略。

改源码引入新依赖时：把它加进 esbuild 的 `external` 并同步上述两处之一，
否则构建期自检会直接 fail 并指名是哪个请求串。

> **类型专用 import 不产生模块请求。** 本包 `import type { ... } from
> '@deepseek-ai/dsh-client-ui-slots'` 这类语句在打包时被完全擦除 —— 所以它们
> 既不需要 `external`，也不需要 `dsh.client.inject`。

## 5. `dsh.client.inject` 是什么（容易搞错）

**它是按包名的模块图依赖边**（那些包的 factory 必须先到），
**不是** cordis 服务注入。后者是 **bundle 导出对象上的 `inject` 数组**：

| 位置 | 含义 | 本包取值 |
|---|---|---|
| `package.json` → `dsh.client.inject` | 模块图边（包名） | `dsh-client-ui-layout`（拥有 `main` 槽）、`dsh-client-ui-renderer`（提供 `slots` 服务）、`dsh-client-ui-sidebar`（拥有 `sidebar.panellist` 槽） |
| `lib/client.js` → `exports.inject` | cordis **服务**名 | `["slots"]` |

往 `dsh.client.inject` 里塞一个**没有 `dsh.client` 声明**的包（例如
`@deepseek-ai/dsh-client-ui-slots`，它是基线外部依赖、不是图里的行）会触发
`dsh-client-modules` 的 composition error。

## 6. 注册了什么

`src/client/index.tsx` 只做两次注册，两处字符串同源于 `panel.ts` 的 `PANEL_ID`：

| 槽位 | kind | 注册选项 | 组件 |
|---|---|---|---|
| `main` | `keyed` | `{ name: 'main', key: 'overview' }` | `OverviewPanel` |
| `sidebar.panellist` | `list` | `{ name: 'sidebar.panellist', id: 'overview', order: 20, label: '总览' }` | `OverviewIcon` |

`main.key` 与 `sidebar.panellist.id` **必须是同一个字符串** —— 这是「侧栏行 ↔ 主面板」
配对的唯一依据（侧栏读 `options.id` 收集面板元数据，点击时 `ctx.layout.selectPanel(id)`）。

刻意**没做**的事（及原因）：

- **不注册进 `root` 槽**：那是 single 槽，动态注册的条目会成为赢家并**单独占满整页**，
  ui-layout 声明的所有座位随之消失。
- **不声明 `children`**：槽位声明是排他的，`main.conversation` 已由官方 ui-conversation
  声明，抢声明会抛。「问事」将来是另开 `consult` key（票 09），不是复用 `conversation`。
- **不接 locale 服务**：本票是无 i18n 的单中文占位壳，`label` 用纯字符串
  （`SlotLabel = string | (() => string)`，侧栏按 `resolveSlotLabel(...) ?? id` 取值）。
  注意 `ctx.locale` 只有 `register(ns, locale, dict)` / `register(ns, dicts)` / `bind(ns)`，
  **没有 `t(ns, key)`** —— `t` 是写了 `locale:` 声明后框架合成到组件 props 上的座位。
- **不设默认面板**：让 `overview` 成为打开玄枢时的首屏属票 06（需要时用
  `ctx.layout.selectPanel('overview')`）。

## 7. 验证

```bash
# 构建 + 内置自检（推荐，一条就够）
pnpm build:client

# 单独跑类型检查（构建本身不做类型检查）
pnpm --filter ./packages/xuanshu-client run typecheck

# 行为核对产物：在假 loader 里物化，断言**返回对象**上的插件面
# （不再 grep 字面量 exports.apply —— 产物走 return module.exports，没有该字面量）
node -e "const vm=require('vm'),s=require('fs').readFileSync('packages/xuanshu-client/lib/client.js','utf8');const r=[];vm.runInNewContext(s,{window:{__ModuleLoader__:{load:x=>r.push(x)}}});const m=r[0].factory(()=>({jsx:()=>null,jsxs:()=>null,Fragment:Symbol('f')}));console.log(s.startsWith('window.__ModuleLoader__.load('), s.includes('id: \"xuanshu-client\"'), typeof m.apply==='function', Array.isArray(m.inject), s.length)"

# 确认没把 react 实现打进来（只应看到 require("react/jsx-runtime")）
node -e "const s=require('fs').readFileSync('packages/xuanshu-client/lib/client.js','utf8');console.log([...s.matchAll(/require\((\"[^\"]+\")\)/g)].map(m=>m[1]))"
```

> PowerShell 里跑上面这些 `node -e` 内联脚本时，双引号可能被外壳吃掉
> （表现为断言莫名其妙为 false）。写成临时 `.mjs` 文件再 `node <file>` 更可靠。

## 8. 类型桩（`types/shims.d.ts`）为什么存在

仓库根**不安装** `@deepseek-ai/*` rc 包（那些只在 `profile/node_modules` 下），
所以源码里 `import type ... from '@deepseek-ai/dsh-client-ui-slots'` 这类语句
在本仓是解析不到的。`types/shims.d.ts` 按本机 0.2.0-rc.2 实装的 `.d.ts`
逐条抄录**恰好被用到的那部分**，每条都标了 `file:line` 证据。

若将来把官方包加进 devDependencies，这个文件应当直接删除（同名模块的 ambient 声明
会与真实包冲突 —— 冲突本身就是该删的信号）。
文件里**故意不声明** `react/jsx-runtime`：真实 `@types/react` 已提供它（含 JSX 表达式
解析需要的 `JSX` 命名空间），再声明一份会撞成重复标识符。

## 9. 许可

AGPL-3.0-only（与 horosa 及玄枢整体一致）。
