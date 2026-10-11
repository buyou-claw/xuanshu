# 玄枢 UI 素材资产库（票 03 · 交付物）

> **这是什么**：玄枢自有界面（S1–S15）可直接引用/导入的**素材资源文件**——线性图标集、空态/插画、品牌标识、设计 token 取值（light/dark 双模）、组件皮肤规格、冷启动文案表——以及本清单（命名 / 目录 / 技术契约 / 总对账表）。
> **这不是什么**：**不含实现代码**（无 tsx / 组件 / 样式表工程化接线；`tokens/` 是 token 资源不是组件代码）、**不含视觉精修**（光影/图层/动效曲线精调留 UI 阶段）。
> 输入：[`../shared/素材需求台账.json`](../shared/素材需求台账.json)（124 条 + 5 复用别名 + 95 token 交接）；token 命名与语义权威 = [`../shared/设计token字典.md`](../shared/设计token字典.md)；各屏视觉元素要求 = [`../screens/`](../screens/) 各屏 §10。
> 出处：票 03（`.scratch/assembly-foundation/issues/03-ui-asset-production.md`）｜ 日期：2026-10-11 ｜ 状态：draft
> 术语一律用 `CONTEXT.md` 定名；禁用旧名（模块 / 资产<指「藏」的旧名> / 资料库 / 每日运势 / 聚合模块 / 写回 / 同步 / 归档）。

---

## 1. 目录组织（统一命名与资源组织 = 验收项 2）

```
docs/design/ui-v1/assets/
├── README.md                # 本文件：契约 + 总对账表（资产清单说明 = 验收项 4）
├── icons/                   # 线性图标族（currentColor，全族无字面颜色）
│   ├── nav/                 # 侧栏行 / 面板导航（viewBox 24）
│   ├── card/                # 卡头 / 区块标题（viewBox 20）
│   ├── inline/              # 行内前置 / Tag 前（viewBox 16）
│   ├── action/              # 按钮 / 动作（viewBox 16 或 20）
│   └── status/              # 状态点 / 审批 / 级别标识（viewBox 16）
├── illus/
│   ├── empty/               # 空态族（轻量线稿；同族风格一致）
│   ├── guide/               # 引导 / 流程示意
│   └── result/              # 成功 / 失败 / 错误 / 告警
├── brand/                   # 品牌标识与约束徽标（唯一允许字面颜色的目录，色值在 §5 登记）
├── tokens/
│   ├── xs-tokens.json       # 机读取值：{ "--xs-*": { light, dark } }，对 ctx.theme.overrideTokens 直接可用
│   ├── xs-tokens.css        # 人读镜像：:root 与 dark 两块 + 逐条注释（语义/用在哪/推导来源）
│   └── V29-primitives-token-consumption.md  # 票 03 研究报告：primitives 消费的 --dsw-* 名单（待实测登记处 V29）
├── skins/                   # 组件皮肤规格（Markdown：结构 + token 引用 + 状态；无代码）
├── copy/                    # 文案表（台账 placeholder 类条目）
└── manifests/               # 分工清单片段（JSON，本 README §6 的数据源；check 脚本的对账输入）
```

**消费方式**（实现票 07–16）：以仓库相对路径 `docs/design/ui-v1/assets/...` 引用；实现票若需打包进 `packages/xuanshu-client/`，在实现票内复制/接线，本票不预做。

## 2. 命名法（所有目录通用）

- 文件名：kebab-case 小写 `^[a-z0-9]+(-[a-z0-9]+)*\.(svg|json|css|md)$`，**只用产品定名**的罗马化/英文短名：
  `overview`(总览/家) `consult`(问事) `pu`(谱) `cang`(藏) `digao`(底稿) `workflow`(工作流) `workspace`(工作区)
  `baseplate`(底座/命盘) `rike`(日课) `mount`(临时挂载) `sediment`(沉淀) `bestof`(多 AI 合参)
  `level-base` `level-optional` `nonpu`(不是谱的实体) —— 与 [`../shared/设计token字典.md`](../shared/设计token字典.md) §0.2 同源。
- 一条台账产多枚时：`<名>-<态名或序号>`，态名从稳定状态名取（`current`/`done`/`todo`/`open`/`close`/`add`/`replace`/`same`/`valid`/`invalid`…），**不得**用 `empty/loading/ready/error/running/done/stale` 之外的自造状态词描述 UI 状态。
- 图标落地到哪个子目录，按**用途**归族（nav/card/inline/action/status），不按屏号；屏号只进 manifest 与注释。

## 3. SVG 技术契约（质量门，check 脚本强制执行）

### 3.1 图标（`icons/**`）

- 根元素：`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 N N" fill="none">`，N ∈ {16, 20, 24}，与台账 `size_hint` / `suggested_format` 一致。
- **禁止** `width=` / `height=` 固定属性（尺寸由消费方经 `--xs-size-icon-*` 给）。
- 描边系统：`stroke="currentColor"`，`stroke-width` 阶梯 = 24→`1.5`、20→`1.5`、16→`1.25`；`stroke-linecap="round"`、`stroke-linejoin="round"`；实心点缀用 `fill="currentColor"`。
- **禁止**：字面颜色（`#hex` / `rgb()` / 颜色名）、`<style>`、`<script>`、`<image>`、栅格数据。（上游规则：样式只走 token，字面颜色仅限插画——图标一律 currentColor 单色可继承。）
- 同族图标**视觉重量一致**：同 viewBox 下描边宽度统一、主笔画占框比例 ≈ 60–70%、留白边距 ≥ 2 单位。

### 3.2 插画 / 空态（`illus/**`）

- 轻量线稿：主描边 `currentColor`（随 `--xs-state-empty-fg` / 正文色继承）；**唯一**第二层次 = `currentColor` + `opacity="0.2–0.4"` 的底/影——以此实现台账的「单色/双色」，**不引入字面颜色**。
- viewBox 自定比例（空态 ≈ 3:2，hero 引导 ≈ 16:9，流程示意按内容），不写固定宽高；尺寸语义（「卡内 1/3 高」等）在 manifest `notes` 里保留原文。
- `asset.S3-9`（出盘进行中）允许内嵌 `<animate>`/SMIL 动效，但**必须**同时满足「减少动态效果」偏好：默认首帧静态可读（动效为增强，降级 = 静止首帧）。
- 禁止：`<script>`、`<image>`、外部引用、字面颜色、`<style>` 内的类色值。

### 3.3 品牌与约束徽标（`brand/**`）

- 本目录是**唯一**允许字面颜色的素材（品牌识别色 / 徽标底色），每出现一个色值必须在 §5 登记表中登记：色值、light/dark 归属、语义。
- 徽标底版必须与 `--xs-constraint-*` token **成对出现**说明（SVG 注释里点名 token 名），实现时颜色以 token 为准、SVG 内字面色只是底版占位。

### 3.4 可溯源注释（全部 SVG）

每个 SVG 在根元素后**第一行**写注释 `<!-- asset.<台账id>[, asset.<id2>…] · <用途一句话> · <屏> -->`；一枚文件服务多条台账时 id 全列。check 脚本按 manifest 反查注释。

## 4. 设计 token 取值契约（验收项 3 的物理承载）

- **填值范围** = 台账 `token_handoff` 全表（95 条）= [`../shared/设计token字典.md`](../shared/设计token字典.md) 各表「取值」列的全部「票 03 填」。
- **双模必填**：每条都给 `light` 与 `dark`（DSH 契约：`requiresLightAndDark`，证据见字典 §13.1-1）。
- **三类取值形态**：
  1. **别名引用**：`var(--dsw-alias-…)` / `var(--dsw-specific-…)` / `var(--dsw-radius-…)` 等——light/dark 都写同一引用（DSH 自带双模）；**不得**重定义被引用 alias 的语义（字典 §13.1-4）。
  2. **新增色值**（`constraint` / `level` 族与少量 `surface`/`text`/`edge`/`state`）：先落 `--xs-static-*` 尺度层（字面色，从 DSH `--dsw-static-*` 调色板取色或按 8% 透明度阶梯派生，注释写明推导来源），`--xs-*` 再 `var(--xs-static-…)` 引用；light/dark 各一值。
  3. **尺寸/动效字面值**（`space` / `size` / `radius` 无别名者 / `motion`）：直接写 `px` / `ms` / `cubic-bezier(...)`；light/dark 同值（尺寸不分模式）。`space` 族取值对齐 DSH 既有间距阶梯，`size`/`space` 中管理列表相关者照 Plugin Manager 页节奏（字典 §13.1-6）。
- **机器可读形态**：`tokens/xs-tokens.json` = `{ "source": "xuanshu-ui-v1", "tokens": { "--xs-…": { "light": "…", "dark": "…" } } }`，与 `ctx.theme.overrideTokens(source, tokens)` 的契约同构（字典 §13.1-2）；**票 03 对 §13.3 第二问的裁决：采用叠加覆盖层（overrideTokens），不注册独立具名主题**——玄枢界面寄生在 DSH 主题之上、只做别名叠加，部署形态不需要「可选主题」；理由与证据写进 `tokens/xs-tokens.css` 头注。
- **回填字典**：`shared/设计token字典.md` 的「取值」列逐条改为实际取值摘要（别名引用写 `var(…)`；新值写 `var(--xs-static-…)`（light/dark 见 tokens.css）），**只动「取值」列**，语义/用在哪/建议别名不动。
- **V29 闭环**：`tokens/V29-primitives-token-consumption.md` 给出 primitives 消费 `--dsw-*` 的名单与取证方法，作为本票填值的完备性自查（哪些 `--xs-*` 的别名目标确实被 primitives 消费）。

## 5. 品牌色值登记表（brand/ 唯一字面色来源）

| 色值 | light/dark | 语义 | 用在哪 |
|---|---|---|---|
| （brand-skins 分工填写，check 脚本按 brand/*.svg 实际色值反查本表） | | | |

## 6. 总对账表（台账 124 条 + 5 别名 ↔ 产出文件，双向 100%）

> 数据源：`manifests/*.json`（各分工产出）。校验：`node scripts/check-ui-assets.mjs` 必须全绿（覆盖率 / SVG 契约 / token 95 条双模 / 命名 / 术语 / 注释溯源）。

（**待 Lead 汇总**：各分工完成后，本节展开为逐条对账表：台账 id → 类型 → 文件 → 备注；别名 id → reused_from → 实际文件。）

## 7. 验收自检（票 03 四条验收项）

| 验收项 | 落在哪 | 状态 |
|---|---|---|
| 产出 UI 素材资产，覆盖全部自有界面清单 | `icons/` `illus/` `brand/` `tokens/` `skins/` `copy/` + §6 对账表 | ☐ |
| 统一命名与目录/资源组织，可直接被 UI 实现票引用/导入 | §1–§3 + 仓库相对路径消费方式 | ☐ |
| 素材与 02 设计稿一致（结构/交互/状态要求的视觉元素齐备） | §6 双向对账 + `scripts/check-ui-assets.mjs` 全绿 | ☐ |
| 交付物为资源文件 + 资产清单说明；不含实现代码、不含视觉精修 | 本目录全部文件（lint：无 tsx/ts/组件 css） | ☐ |
