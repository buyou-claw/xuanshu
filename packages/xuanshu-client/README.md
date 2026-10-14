# xuanshu-client

玄枢（XuanShu）的 **DSH 客户端插件包**：一个包同时提供**宿主半边**（Node 侧）与
**浏览器半边**（预编译 bundle），装进 `xuanshu` profile 后即可被 DSH 的 Web GUI 加载
——**不需要** `dev:web` 热更新，产物随包走。

票 01 立起了空壳（两个槽位 + 构建管线 + 自检）；**票 07 · 首页替换**把它填成了
「自我总览四卡」（命盘 / 日课 / 底稿 / 快捷入口），并设为打开玄枢的**默认面板**。

---

## 1. 目录与文件职责

```
packages/xuanshu-client/
├── package.json          # dsh 清单：bundle.patch（宿主行）+ client{platform:web, inject}
├── cordis.patch.yml      # bundle 层补丁：insert 一行 id/name = xuanshu-client
├── tsconfig.json         # 仅用于 `pnpm typecheck`；构建本身由 esbuild 完成，不做类型检查
├── types/shims.d.ts      # 官方 @deepseek-ai/* 包的最小类型切片（仓库根不装 rc 包）
├── src/client/           # 源码（TS/TSX），**不随包发布**
│   ├── index.tsx         # 入口：cordis 插件 apply / inject（槽位注册 + 默认面板 + token + 样式）
│   ├── panel.ts          # PANEL_ID / PANEL_ORDER / PANEL_LABEL + 四卡逐字文案与 fail-soft 理由
│   ├── tokens.ts         # 票 03 的 token 取值（直接引用 docs 下的 xs-tokens.json）
│   ├── style.ts          # 本包 CSS（`--xs-*` token）+ 幂等 <style> 注入
│   ├── glyphs.tsx        # 票 03 素材的形状照抄（图标 ×7、空态/错误插画 ×4）
│   ├── watch.ts          # main 面板键快照（四卡 fail-soft 置灰的唯一判据）
│   ├── cards.tsx         # 卡壳 + 三态 + 四卡（命盘 / 日课 / 底稿 / 快捷入口）
│   ├── OverviewPanel.tsx # `main` keyed 槽 key `overview` 的面板（页头 + 2×2 栅格）
│   └── OverviewIcon.tsx  # `sidebar.panellist` list 槽行 `overview` 的图标
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

**构建即自检**（全部通过之后才落盘：构建失败不会在磁盘上留下未经校验的产物）：

1. **静态断言**产物文本（首行 `window.__ModuleLoader__.load(`、含 `id: "xuanshu-client"`、
   恰好一次 `load()`、无 `sourceMappingURL`、无仓库绝对路径、无 react/react-dom 实现标记）；
2. 用 `node:vm` + 假 `window.__ModuleLoader__` + 假 `require` **真的执行一遍产物**，
   物化 factory 并拿假 ctx 调一次 `apply`，断言两个槽位的注册形状
   （`main.key === sidebar.panellist.id === "overview"`）；
3. 断言产物里**每一个** `require(...)` 都落在基线外部依赖表（或 `dsh.client.external`
   的声明）内 —— 这是「外部依赖漂移」的构建期拦截点；
4. **导出面用行为断言，不用文本 grep**：从包体读出 esbuild 声明的导出名
   （`__export(<obj>, {...})`），逐个断言它们真的在 factory 的返回对象上。
   产物走的是 `return module.exports`，字面量 `exports.apply` **不存在**，所以断言的是
   运行期事实；另外还会注入一个探针导出，验证「将来多一个导出也不会丢」。

任何一条不过，脚本以非 0 退出（且不写盘）。

`--check`：**不写盘**，走完全部构建与自检，把结果与磁盘上的 `lib/client.js` 逐字节比较
（`node scripts/build-client.mjs --check`）。一致 → exit 0 打印 `in sync`；不一致 → exit 1
打印「产物与源码不同步，请跑 `pnpm build:client`」+ 首个不同的行号。
`tests/assembly/build-pipeline.test.mjs` 拿它当断言，因此「改了 `src/**` 忘记重建」
会在 `pnpm test` 里红，而不是一路绿到 review。

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
| `package.json` → `dsh.client.inject` | 模块图边（包名） | `dsh-client-ui-layout`（拥有 `main` 槽）、`dsh-client-ui-renderer`（提供 `slots` 服务）、`dsh-client-ui-sidebar`（拥有 `sidebar.panellist` 槽）、`dsh-client-ui-theme`（提供 `theme` 服务，票 07 加） |
| `lib/client.js` → `exports.inject` | cordis **服务**名 | `["slots", "layout", "theme"]`（`layout`：默认面板切换；`theme`：token 覆盖层） |

往 `dsh.client.inject` 里塞一个**没有 `dsh.client` 声明**的包（例如
`@deepseek-ai/dsh-client-ui-slots`，它是基线外部依赖、不是图里的行）会触发
`dsh-client-modules` 的 composition error。

## 6. 注册了什么

`src/client/index.tsx` 做**两处槽位注册 + 三件装配副作用**，字符串同源于 `panel.ts` 的 `PANEL_ID`：

| 槽位 | kind | 注册选项 | 组件 |
|---|---|---|---|
| `main` | `keyed` | `{ name: 'main', key: 'overview', inject }` | `OverviewPanel` |
| `sidebar.panellist` | `list` | `{ name: 'sidebar.panellist', id: 'overview', order: 20, label: '总览' }` | `OverviewIcon` |

`main.key` 与 `sidebar.panellist.id` **必须是同一个字符串** —— 这是「侧栏行 ↔ 主面板」
配对的唯一依据（侧栏读 `options.id` 收集面板元数据，点击时 `ctx.layout.selectPanel(id)`）。

装配副作用（票 07 · 首页替换）：

| # | 做什么 | 依据 |
|---|---|---|
| ① | **默认面板**：main 注册**成功之后** `ctx.layout.selectPanel('overview')`（`main` 槽的渲染键缺省回落 `conversation`） | `dsh-client-ui-layout/lib/client.js:118`（`activePanelId ?? "conversation"`）、`:462-466`（对未注册 key 会 throw） |
| ② | **token 覆盖层**：`ctx.theme.overrideTokens('xuanshu-ui-v1', 票03取值)`（`--xs-*`，双模） | `dsh-client-ui-theme/lib/types/client/index.d.ts:153-178` |
| ③ | **样式随 JS 走**：幂等注入 `<style data-plugin-css="xuanshu-client/overview.css">` | 官方 ui-layout 同法：`dsh-client-ui-layout/lib/client.js:72-81` |

另有第 ④ 件（不算注册）：`ctx.slots.subscribe('main', …)` 维护「已注册 main 面板键」快照，
四卡的 fail-soft 置灰以它为唯一判据（`dsh-client-ui-layout/lib/client.js:592-599` 同法）。

**票 15（沉淀闭环）另加三处会话内 cell**（`src/client/sediment-views.tsx` 的 `installSediment`；
**不新增 main key、不新增侧栏行**）——三处都在 `conversation` 子树里/框架浮层上，
只在 DSH 原生 `conversation` 面板在屏时渲染（S10 §1 D5 + `DSH槽位映射.md` F1）：

| 槽位 | kind / scope | 注册选项 | 组件 |
|---|---|---|---|
| `conversation.composer.dock` | `list` / session | `{ name, id: 'xuanshu.sediment-entry', inject }` | `XsSedimentEntry`（`[导出汇总]` + 目标谱选择） |
| `conversation.chat.turnTail` | `list` / session | `{ name, id: 'xuanshu.sediment-draft', order: 30, inject }` | `XsSedimentDraftCard`（草稿卡 + 确认弹窗） |
| `shell.overlay` | `list` / root | `{ name, id: 'xuanshu.sediment-notice', inject }` | `XsSedimentNotice`（写入结果通知；无内容 `return null` → click-through） |

「人点才跑」的结构保证在 `sediment-model.ts` 的控制器上：造它不发请求，写谱只在 `commit()` 里发生，
而 `commit()` 只由确认弹窗的 `[确认更新]` 调用；`confirmed` 在 `sediment-api.ts` 里写死为字面量 `true`。

刻意**没做**的事（及原因）：

- **不注册进 `root` 槽**：那是 single 槽，动态注册的条目会成为赢家并**单独占满整页**，
  ui-layout 声明的所有座位随之消失。
- **不声明 `children`**：槽位声明是排他的，`main.conversation` 已由官方 ui-conversation
  声明，抢声明会抛。「问事」将来是另开 `consult` key（票 10 · 问事闭环），不是复用 `conversation`。
- **不加 `priority`**：`overview` 是新 cell（keyed 新 key / list 新 id），纯加性、不遮蔽任何
  既有占用者 —— 「遮蔽不报错」正是这样实现的。同 cell 同 priority 二次注册才 fail-loud
  （`dsh-client-ui-slots/lib/types/index.d.ts:577-583`），测试里对这个区分有正反两向断言。
- **不接 locale 服务**：本包是无 i18n 的单中文界面，`label` 用纯字符串
  （`SlotLabel = string | (() => string)`，侧栏按 `resolveSlotLabel(...) ?? id` 取值）。
  注意 `ctx.locale` 只有 `register(ns, locale, dict)` / `register(ns, dicts)` / `bind(ns)`，
  **没有 `t(ns, key)`** —— `t` 是写了 `locale:` 声明后框架合成到组件 props 上的座位。
- **不引 `@deepseek-ai/dsh-client-store`**：四卡只需要「取快照 + 订阅」，`src/client/watch.ts`
  自写了十几行的极简 watch，少一条运行期 `require` 就少一条 module table 耦合边。
- **不 require primitives / 任何 Harness Client 包**（F4）：卡片、徽标、骨架、单元格都是
  自研 markup + 自有类名，几何照抄票 03 素材（`src/client/glyphs.tsx`）。

## 7. 验证

```bash
# 构建 + 内置自检（推荐，一条就够）
pnpm build:client

# 只校验「提交的 lib/client.js 与 src/** 同步」（不写盘；CI/提交前用）
node scripts/build-client.mjs --check

# 单独跑类型检查（构建本身不做类型检查）
pnpm --filter ./packages/xuanshu-client run typecheck

# UI 槽位契约测试（票 07 的验收面：默认面板 / 四卡渲染 / 遮蔽语义 / 工作区原样）
npx vitest run tests/assembly/overview-contract.test.mjs
```

构建自检在票 07 起还断言：`theme.overrideTokens` 恰一次、source 是 `xuanshu-ui-v1`
且取值非空；`layout.selectPanel('overview')` 恰一次且**晚于 main 注册**；
`main` 注册选项里的 `inject` 真的提供 `navigate` 与 `mainPanels` watch。

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
