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
| `#0f1115` | light（底版；dark 由 token 切换） | 「人工确认闸门」徽标实心底（高对比，与 `--xs-constraint-human-gate-bg` 对齐） | `brand/badge-human-gate.svg` |
| `#ffffff` | light（底版） | 闸门徽标字形（对应 `--xs-constraint-human-gate-fg`） | `brand/badge-human-gate.svg` |
| `#47557a` | light（底版） | 「纯派生 · 不可手改」徽标底（深靛，与 `--xs-static-constraint-derived-fg` 同族） | `brand/badge-derived.svg` |
| `#525a66` | light（底版） | 「永不进 AI」标徽底（石板灰，负面事实、不喧宾） | `brand/badge-noai.svg`、`brand/badge-noai-sm.svg` |
| `#f4f5f7` | light（底版） | 徽标字形/浅底（中性浅灰，同族通用） | `brand/badge-derived.svg`、`brand/badge-noai*.svg` |
| `#2f3a5c` | light/dark 通用底稿 | 玄枢品牌主色（幽深靛蓝：玄=底座/深稳） | `brand/brand-mark-color.svg` |
| `#a3b0e0` | dark（底版占位） | 玄枢品牌主色暗色变体（浅靛，深色模式下用） | `brand/brand-mark-color.svg` |

## 6. 总对账表（台账 124 条 + 5 别名 ↔ 产出文件，双向 100%）

> 数据源：`manifests/*.json`（各分工产出，本表由 `node scripts/build-asset-inventory.mjs` 机械生成，请勿手改）。
> 校验：`node scripts/check-ui-assets.mjs` 必须全绿（覆盖率 / SVG 契约 / token 93 条双模 / 命名 / 术语 / 注释溯源 / brand 色值登记）。

| 台账 id | 屏 | 类型 | 用途（台账原文摘要） | 产出文件（相对 assets/） | 备注 |
|---|---|---|---|---|---|
| asset.S1-1 | S1 | 图标 | 侧栏「家」行图标 | `icons/nav/nav-overview.svg` | 侧栏「家/总览」行；与 S15-1 同枚；别名 S4-5 复用 |
| asset.S1-2 | S1 | 图标 | 命盘卡卡头图标 | `icons/card/card-mingpan.svg` | 命盘卡卡头 |
| asset.S1-3 | S1 | 图标 | 日课卡卡头图标 | `icons/card/card-rike.svg` | 日课卡卡头；S14-1 复用同枚 |
| asset.S1-4 | S1 | 图标 | 底稿卡卡头图标 | `icons/card/card-digao.svg` | 底稿卡卡头 |
| asset.S1-5 | S1 | 图标 | 快捷入口三格图标（问事 / 工作区 / 工作流） | `icons/nav/nav-quick-consult.svg`<br>`icons/nav/nav-quick-workspace.svg`<br>`icons/nav/nav-quick-workflow.svg` | 快捷入口三格（问事/工作区/工作流）；别名 S4-4 复用 |
| asset.S1-6 | S1 | 空态 | 命盘卡 empty：「底座还没立起来」 | `illus/empty/mingpan-empty.svg` | 命盘卡 empty：「底座还没立起来」。空盘 + 地桩；尺寸语义「卡内 1/3 高」；与 S2-8/S4-1 同族（S4-1 卡内 2/3 高，viewBox 比例区分） |
| asset.S1-7 | S1 | 空态 | 日课卡 empty：「今天还没有生成日课」 | `illus/empty/rike-empty.svg` | 日课卡 empty：「今天还没有生成日课」。空卷轴 + 未升起的太阳；同族风格 |
| asset.S1-8 | S1 | 空态 | 底稿卡 empty（两种空因共用一张） | `illus/empty/digao-empty.svg` | 底稿卡 empty（两种空因共用一张）。空文稿 + 三路来源空槽；同族风格 |
| asset.S1-9 | S1 | 插画 | 四卡共用 error 态 | `illus/result/cards-error.svg` | 四卡共用 error 态，语义「断线 / 读不到」。卡面 + 断裂连接 |
| asset.S1-10 | S1 | 皮肤/token | 卡级骨架屏（四卡共用，简化为 2–4 条占位） | `skins/skeleton-card.md` | 卡级骨架屏（四卡共用，简化为 2–4 条占位）；token 化骨架样式，扫光尊重「减少动态效果」偏好 |
| asset.S1-11 | S1 | 皮肤/token | 只读 / 纯派生 两类标记（XsReadonlyBadge、XsPureDerivedBadge） | `skins/badge-readonly.md` | 只读 / 纯派生 两类标记（XsReadonlyBadge、XsPureDerivedBadge）徽标皮肤；与 asset.S2-5 同款同文件，别名 asset.S4-9 同款复用 |
| asset.S1-12 | S1 | 皮肤/token | 快捷入口三格（含主标题 + 副标题 + 边界说明行） | `skins/quicklinks-cell.md` | 快捷入口三格单元格皮肤（主标题 + 副标题 + 边界说明行）；窄屏不折行；fail-soft 置灰态 |
| asset.S10-1 | S10 | 图标 | 收尾条 [导出汇总] | `icons/action/export.svg` | 收尾条 [导出汇总]：箭头出盒。 |
| asset.S10-2 | S10 | 图标 | 草稿卡标题「沉淀草稿」 | `icons/card/card-sediment.svg` | 草稿卡标题「沉淀草稿」：器中层积 + 一粒沉降。 |
| asset.S10-3 | S10 | 图标 | diff 记号 + 新增 / ~ 替换 / = 未变 三枚 | `icons/inline/diff-add.svg`<br>`icons/inline/diff-replace.svg`<br>`icons/inline/diff-same.svg` | diff 记号三枚一组：+ 新增 / ~ 替换 / = 未变（态名后缀 add/replace/same）。 |
| asset.S10-4 | S10 | 图标 | [确认更新] 按钮（人工确认语义） | `icons/action/confirm.svg` | [确认更新]（人工确认语义）：签署式对勾落基线。 |
| asset.S10-5 | S10 | 图标 | 通知里的成功 / 失败两态 | `icons/status/done.svg`<br>`icons/status/error.svg` | 通知成功 / 失败两态（态名取稳定状态词 done/error）。 |
| asset.S10-6 | S10 | 品牌/徽标 | 弹窗标题旁「人工确认」标记 | `brand/badge-human-gate.svg` | 弹窗标题旁「人工确认」标记；章形 + 人形底版；实现以 --xs-constraint-human-gate-fg/-bg 为准（C4/C8/C9/C10），SVG 内色值为底版占位（README §5 已登记） |
| asset.S10-7 | S10 | 空态 | 草稿卡 empty 态（会话刚收尾、尚无草稿） | `illus/empty/sediment-draft-empty.svg` | 沉淀草稿卡 empty（会话刚收尾、尚无草稿）。空白草稿纸 + 搁置的笔 |
| asset.S10-8 | S10 | 皮肤/token | --xs-constraint-human-gate-fg/-bg（C4/C10 的确认容器）、diff 三记号、text-code（只读路径）、--xs-size-modal-width、--xs-motion-duration-overlay、state-warning（字数超阈）/ state-done | `tokens/xs-tokens.css` | --xs-constraint-human-gate-fg/-bg（C4/C10 的确认容器）、diff 三记号、text-code（只读路径）、--xs-size-modal-width、--xs-motion-duration-overlay、state-warning（字数超阈）/ state-done |
| asset.S11-1 | S11 | 图标 | 侧栏「藏」行 | `icons/nav/nav-cang.svg` | 侧栏「藏」行；与 S15-1 同枚 |
| asset.S11-2 | S11 | 图标 | [登记藏] | `icons/action/cang-add.svg` | [登记藏]：函套封签 + 登记符（藏=函套+封签语义）。 |
| asset.S11-3 | S11 | 图标 | 卡片动作：打开 / 显示所在位置 / 复制路径 / 编辑 / 移除（五枚一组） | `icons/action/open.svg`<br>`icons/action/open-folder.svg`<br>`icons/action/copy-path.svg`<br>`icons/action/edit.svg`<br>`icons/action/remove.svg` | 卡片动作五枚：打开=箭头离框 / 显示所在位置=夹内指出（与 S13-5、S15-4 同枚）/ 复制路径=双层叠纸（与 S13-5、S15-4 同枚）/ 编辑=斜笔 / 移除=卡面一横（只移除登记，不删文件）。 |
| asset.S11-4 | S11 | 图标 | 指针状态：指针有效 / 指针失效（两枚） | `icons/status/pointer-valid.svg`<br>`icons/status/pointer-invalid.svg` | 指针状态两枚：有效=链环相扣 / 失效=链环断口带叉（指针=链环语义，态名 valid/invalid）。 |
| asset.S11-5 | S11 | 品牌/徽标 | 常驻声明栏的「永不进 AI」标徽 | `brand/badge-noai.svg` | 常驻声明栏的「永不进 AI」标徽；封缄 + 斜杠眼底版（负面事实，不得做成按钮感）；实现以 --xs-constraint-noai-fg/-bg 为准（C3），仅用于那句常驻声明 |
| asset.S11-6 | S11 | 空态 | 藏库 empty 态（还没有登记任何藏） | `illus/empty/cang-empty.svg` | 藏库 empty（还没有登记任何藏）。空函套 + 飘带 |
| asset.S11-7 | S11 | 空态 | 登记抽屉的「只取指针」说明配图（指针 ≠ 复制） | `illus/empty/cang-pointer-note.svg` | 登记抽屉「只取指针」说明配图（指针 ≠ 复制）。链环指针指向文件 + 交叉复制记号 |
| asset.S11-8 | S11 | 皮肤/token | --xs-constraint-noai-fg/-bg（仅那句常驻声明）、指针失效 state-warn 系、text-code（路径只读）、level-nonpu（藏不是谱）、--xs-size-panel-content-max | `tokens/xs-tokens.css` | --xs-constraint-noai-fg/-bg（仅那句常驻声明）、指针失效 state-warn 系、text-code（路径只读）、level-nonpu（藏不是谱）、--xs-size-panel-content-max |
| asset.S12-1 | S12 | 图标 | 侧栏「工作流」行 + [创建工作流] | `icons/nav/nav-workflow.svg`<br>`icons/action/plus.svg` | 侧栏「工作流」行 + [创建工作流] |
| asset.S12-2 | S12 | 图标 | 向导条三步（说要求 / 试跑 / 判定并导出） | `icons/inline/wizard-step-1.svg`<br>`icons/inline/wizard-step-2.svg`<br>`icons/inline/wizard-step-3.svg` | 向导条三步：1 说要求=会话泡、2 试跑=圆中播、3 你判定并导出=箭头升出盒（描述步骤，不含通过/失败语义）。 |
| asset.S12-3 | S12 | 图标 | 试跑区 running / [停止] | `icons/status/running.svg`<br>`icons/action/stop.svg` | 试跑区 running（缺口弧，与 S13-4/S14-3 同枚）/ [停止]（实心方，与 S9-4 停止全部同枚）。 |
| asset.S12-4 | S12 | 图标 | 判定条按钮（我判定跑通 / 继续改 / 先放着） | `icons/action/judge-pass.svg`<br>`icons/action/revise.svg`<br>`icons/action/shelve.svg` | 判定条三枚：我判定跑通→导出=圆勾右出 / 继续改要求=回环返修 / 先放着=盒搁架上。全为人点动作，无系统判定语义。 |
| asset.S12-5 | S12 | 图标 | 已导出条目（skill 产物） | `icons/inline/skill.svg` | 已导出条目（skill 产物）：配方卷轴角缀一星。 |
| asset.S12-6 | S12 | 空态 | 门厅 empty 态（还没有工作流） | `illus/empty/workflow-hall-empty.svg` | 工作流门厅 empty（还没有工作流）。空门框 + 未起的流程线 |
| asset.S12-7 | S12 | 空态 | 会话内 empty（种子刚起、还没说要求） | `illus/empty/workflow-seed-empty.svg` | 工作流会话内 empty（种子刚起、还没说要求）。刚冒芽的种子 + 空会话泡 |
| asset.S12-8 | S12 | 皮肤/token | --xs-constraint-human-gate-fg/-bg（C8 的判定条容器）、state-running / done / error、level-nonpu（工作流不是谱）、--xs-size-panel-content-max | `tokens/xs-tokens.css` | --xs-constraint-human-gate-fg/-bg（C8 的判定条容器）、state-running / done / error、level-nonpu（工作流不是谱）、--xs-size-panel-content-max |
| asset.S13-1 | S13 | 图标 | 侧栏「底稿」行 + 面板标题 | `icons/nav/nav-digao.svg` | 侧栏「底稿」行 + 面板标题；与 S15-1 同枚 |
| asset.S13-2 | S13 | 品牌/徽标 | ① 「纯派生 · 不可手改」标记（与 S1 / S4 同一枚） | `brand/badge-derived.svg` | 「纯派生 · 不可手改」标记（与 S1 / S4 同一枚）；盾形 + 斜杠底版；实现以 --xs-constraint-derived-fg/-bg 为准（C2）；皮肤规格见 skins/badge-readonly.md |
| asset.S13-3 | S13 | 图标 | ② 三跳转（谱 / 工作区 / 工作流） | `icons/inline/pu.svg`<br>`icons/inline/workspace.svg`<br>`icons/inline/workflow.svg` | ② 三跳转（谱 / 工作区 / 工作流）：跳转语义由按钮文案承担，图标为目的实体字形，与 S13-6 来源标签同枚。 |
| asset.S13-4 | S13 | 图标 | ④ [刷新] 与 running 转圈态 | `icons/action/refresh.svg`<br>`icons/status/running.svg` | ④ [刷新]（与 S8-5 重新预览同枚）与 running 转圈态（缺口弧，与 S12-3/S14-3 同枚）。 |
| asset.S13-5 | S13 | 图标 | ⑤ 只读动作（复制路径 / 打开目录 / MD 形态） | `icons/action/copy-path.svg`<br>`icons/action/open-folder.svg`<br>`icons/inline/file-md.svg` | ⑤ 只读动作三枚：复制路径、打开目录（均与 S11-3/S15-4 同枚）、MD 形态=折角文档。 |
| asset.S13-6 | S13 | 图标 | ⑦ 三路来源标签底版（谱 / 工作区 / 工作流） | `icons/inline/pu.svg`<br>`icons/inline/workspace.svg`<br>`icons/inline/workflow.svg` | ⑦ 三路来源标签底版（谱 / 工作区 / 工作流）：与 S13-3/S8-2 同枚；台账「可带底」的底色由消费方走 token，SVG 保持 currentColor 单色。 |
| asset.S13-7 | S13 | 空态 | 底稿 empty 态（三路皆空） | `illus/empty/digao-empty-all.svg` | 底稿 empty（三路皆空）。三路来源空槽 → 空底稿 |
| asset.S13-8 | S13 | 皮肤/token | --xs-constraint-derived-fg/-bg（C2 徽标）、三路来源的边条 / 标签 / 组头、stale 横幅、surface-readonly / surface-panel、--xs-size-scrollregion-max、level-digao | `tokens/xs-tokens.css` | --xs-constraint-derived-fg/-bg（C2 徽标）、三路来源的边条 / 标签 / 组头、stale 横幅、surface-readonly / surface-panel、--xs-size-scrollregion-max、level-digao |
| asset.S14-1 | S14 | 图标 | 日课卡标题 + 卡片图标（S1 复用） | `icons/card/card-rike.svg` | 日课卡标题 + 卡片图标。与 S1-3 同枚（icons-a 产），本清单只登记指向、不重复产。 |
| asset.S14-2 | S14 | 图标 | ① 时间基准行（时钟 / 时区两枚） | `icons/inline/clock.svg`<br>`icons/inline/timezone.svg` | ① 时间基准行两枚：时刻=钟面双针、时区=球面经线赤道。 |
| asset.S14-3 | S14 | 图标 | [重新生成（今天）] 与 running 态 | `icons/action/regenerate.svg`<br>`icons/status/running.svg` | [重新生成（今天）]（环箭绕当日一点，与通用刷新区分）与 running 态（与 S12-3/S13-4 同枚）。 |
| asset.S14-4 | S14 | 图标 | [查看投递会话]（投递语义） | `icons/action/deliver.svg` | [查看投递会话]（投递语义）：箭矢投入托盘。 |
| asset.S14-5 | S14 | 图标 | [打开自动化任务面板]（跳 DSH 面板的指路语义） | `icons/action/open-panel.svg` | [打开自动化任务面板]（跳 DSH 面板的指路语义）：带楣面板 + 指路箭头。 |
| asset.S14-6 | S14 | 空态 | 日课 empty 态（今天未到点且无上一份） | `illus/empty/rike-empty-notime.svg` | 日课 empty（今天未到点且无上一份）。钟未到点 + 空白宜/忌/流日卡 |
| asset.S14-7 | S14 | 空态 | 底座未就绪态（指向 S3） | `illus/empty/baseplate-unready.svg` | 日课底座未就绪态（指向 S3）。空盘 + 未立地桩 + 指引箭头；与 S3-10 底座未就绪同义、独立落 S14 |
| asset.S14-8 | S14 | 皮肤/token | --xs-constraint-human-gate-fg/-bg（C10 的确认处）、state-running / done / error、level-baseplate（底座 + 时间基准）、--xs-size-card-minheight | `tokens/xs-tokens.css` | --xs-constraint-human-gate-fg/-bg（C10 的确认处）、state-running / done / error、level-baseplate（底座 + 时间基准）、--xs-size-card-minheight |
| asset.S15-1 | S15 | 图标 | 侧栏六行（总览 / 问事 / 谱 / 藏 / 底稿 / 工作流） | `icons/nav/nav-overview.svg`<br>`icons/nav/nav-consult.svg`<br>`icons/nav/nav-pu.svg`<br>`icons/nav/nav-cang.svg`<br>`icons/nav/nav-digao.svg`<br>`icons/nav/nav-workflow.svg` | 侧栏六行一套 |
| asset.S15-2 | S15 | 图标 | 玄枢品牌标（sidebar.brand.mark）+ 品牌名排版位（sidebar.brand.name） | `brand/brand-mark.svg`<br>`brand/brand-mark-color.svg`<br>`brand/brand-mark-notes.md` | 玄枢品牌标（sidebar.brand.mark）+ 品牌名排版位说明：圆环绕一偏心枢点（枢轴 / 璇玑意象），单色 currentColor 版 + 品牌色版（玄青）各一；多档边长简化规则与 --xs-size-glyph-brand / sidebar.brand.name（--xs-text-brand）关系见 brand/brand-mark-notes.md |
| asset.S15-3 | S15 | 图标 | 设置内页条目的行图标（数据与拷走） | `icons/action/data-takeaway.svg` | 设置内页条目「数据与拷走」行图标：本地数据罐 + 带走箭头。归 action 族（nav/ 归 icons-a；设置条目属导航性质，viewBox 20）。 |
| asset.S15-4 | S15 | 图标 | [复制路径] / [在文件管理器中打开] | `icons/action/copy-path.svg`<br>`icons/action/open-folder.svg` | [复制路径] / [在文件管理器中打开] 两枚（均与 S11-3/S13-5 同枚）。 |
| asset.S15-5 | S15 | 插画 | 「整体拷走」说明配图（两个目录 → 一处落地） | `illus/guide/takeaway-copy.svg` | 「整体拷走」说明配图（两个目录 → 一处落地）。两目录 → 行囊箭头 |
| asset.S15-6 | S15 | 空态 | 数据与拷走 的 empty 态（数据目录未初始化） | `illus/empty/data-uninit.svg` | 数据与拷走 empty（数据目录未初始化）。空目录夹 + 未初始化火花 |
| asset.S15-7 | S15 | 品牌/徽标 | 侧栏「藏」行的「永不上 AI」小标 | `brand/badge-noai-sm.svg` | 侧栏「藏」行的「永不上 AI」小标（asset.S11-5 同族缩小版：去瞳仁简化）；实现以 --xs-constraint-noai-* 为准（C3） |
| asset.S15-8 | S15 | 皮肤/token | 侧栏行（默认 / hover / active）与面板头：--xs-size-icon-sidebar、--xs-size-breakpoint-wide、surface-sidebar 等 | `tokens/xs-tokens.css` | 侧栏行（默认 / hover / active）与面板头：--xs-size-icon-sidebar、--xs-size-breakpoint-wide、surface-sidebar 等 |
| asset.S2-1 | S2 | 图标 | 抽屉头部命盘图标 | `icons/card/card-mingpan.svg` | 抽屉头部命盘图标，与 S1-2 同枚 |
| asset.S2-2 | S2 | 图标 | 四柱表每列列头（年/月/日/时）装饰位 | `icons/inline/pillar-year.svg`<br>`icons/inline/pillar-month.svg`<br>`icons/inline/pillar-day.svg`<br>`icons/inline/pillar-hour.svg` | 四柱表列头（年/月/日/时）四枚 |
| asset.S2-3 | S2 | 图标 | 大运展开 / 收起指示 | `icons/inline/unfold-more.svg`<br>`icons/inline/unfold-less.svg` | 大运展开/收起两态 |
| asset.S2-4 | S2 | 图标 | 其它要点各分块（纳音/神煞/空亡/命宫） | `icons/inline/facet-nayin.svg`<br>`icons/inline/facet-shensha.svg`<br>`icons/inline/facet-kongwang.svg`<br>`icons/inline/facet-minggong.svg` | 其它要点分块四枚同族 |
| asset.S2-5 | S2 | 皮肤/token | 只读标记徽标（与 S1 XsReadonlyBadge **同款**） | `skins/badge-readonly.md` | 只读标记徽标（与 S1 XsReadonlyBadge 同款）：与 asset.S1-11 同文件 skins/badge-readonly.md，文中说明 |
| asset.S2-6 | S2 | 皮肤/token | 起盘口径只读行（三行，右侧值列） | `skins/basis-desc-list.md` | 起盘口径只读行（三行，右侧值列）描述列表皮肤；只读面 + 值列不得用 --xs-text-link（防误读成可切换） |
| asset.S2-7 | S2 | 皮肤/token | 四柱表（4×4，含缺项占位「—」） | `skins/bazi-pillars-table.md` | 四柱表（4×4，含缺项占位「—」与缺项说明行）表格皮肤；只读、无显隐开关 |
| asset.S2-8 | S2 | 空态 | 快照缺失时（与 S1 命盘卡空态图**同族**） | `illus/empty/mingpan-snapshot-missing.svg` | 命盘卡快照缺失（与 S1 命盘卡空态同族，独立文件、画面同源）。空盘内缺快照框 + 地桩 |
| asset.S2-9 | S2 | 插画 | 快照读不出来 / 结构不符 | `illus/result/snapshot-error.svg` | 快照读不出来 / 结构不符。破损快照框 + 错位栏 |
| asset.S2-10 | S2 | 皮肤/token | stale 提示条（旧版本出盘） | `skins/stale-banner.md` | stale 提示条（旧版本出盘）皮肤 + 图标位；边条式，--xs-state-stale-fg；常驻不静默当作最新 |
| asset.S3-1 | S3 | 图标 | 步骤条五格（当前 / 已完成 / 未到） | `icons/status/step-current.svg`<br>`icons/status/step-done.svg`<br>`icons/status/step-todo.svg` | 步骤条五格三态 |
| asset.S3-2 | S3 | 图标 | 时间编辑三方式提示位（popover / 键入 / 微调） | `icons/inline/time-popover.svg`<br>`icons/inline/time-type.svg`<br>`icons/inline/time-adjust.svg` | 时间编辑三方式提示位 |
| asset.S3-3 | S3 | 图标 | 城市库入口（离线 / 无匹配引导） | `icons/inline/city-offline.svg`<br>`icons/inline/city-nomatch.svg` | 城市库入口（离线/无匹配）两枚 20 框 |
| asset.S3-4 | S3 | 图标 | 经纬度手输字段前置图标 | `icons/inline/coords.svg` | 经纬度手输前置图标 |
| asset.S3-5 | S3 | 图标 | 时区自动 / 手动覆盖标记（含夏令时标记） | `icons/inline/tz-auto.svg`<br>`icons/inline/tz-manual.svg`<br>`icons/inline/tz-dst.svg` | 时区自动/手动覆盖/夏令时标记三枚 |
| asset.S3-6 | S3 | 皮肤/token | 确认表（5 行 + 每行 [改]） | `skins/birth-confirm-table.md` | 确认表（5 行 + 每行 [改]）表格皮肤；澄清闸容器走 --xs-constraint-human-gate-*（C10），状态位 ready/error 双档 |
| asset.S3-7 | S3 | 皮肤/token | 禁用态出盘按钮 + 禁用理由行 | `skins/cast-button-disabled.md` | 禁用态出盘按钮 + 禁用理由行（缺经纬度禁止出盘的界面本体）；按钮皮肤 + 提示条皮肤，含两个修复入口 |
| asset.S3-8 | S3 | 插画 | conversation.hero 上的引导插图 | `illus/guide/hero-guide.svg` | conversation.hero 引导插图。出生信息 → 底座出盘 → 命盘点亮；比例语义「hero 内 1/3 高」，viewBox 16:9 |
| asset.S3-9 | S3 | 插画 | 出盘进行中 | `illus/guide/cast-in-progress.svg` | 出盘进行中。盘 + 旋转弧（SMIL 为增强，首帧静态可读；降级 = 静止首帧） |
| asset.S3-10 | S3 | 空态 | 底座未就绪、出盘失败、落谱失败三种错误图 | `illus/empty/baseplate-fail.svg`<br>`illus/empty/cast-fail.svg`<br>`illus/empty/plate-fail.svg` | 底座未就绪 / 出盘失败 / 落谱失败三种错误图，同族 ×3：baseplate-fail=空盘+告警、cast-fail=盘+断裂出盘箭头、plate-fail=盘+谱+断裂写入箭头 |
| asset.S3-11 | S3 | 插画 | 出盘成功 → 命盘卡点亮 | `illus/guide/cast-success-mingpan.svg` | 出盘成功 → 命盘卡点亮。与 S1-6 命盘卡同族（点亮版：勾 + 放射） |
| asset.S3-12 | S3 | 皮肤/token | 窄屏吸底操作条（主按钮 + 返回） | `skins/sticky-bottom-bar.md` | 窄屏吸底操作条（主按钮 + 返回）容器皮肤；仅窄屏（< --xs-size-breakpoint-wide）出现；S2 抽屉窄屏吸底复用 |
| asset.S4-1 | S4 | 插画 | 命盘卡冷启动主态（「底座还没立起来」） | `illus/guide/mingpan-coldstart.svg` | 命盘卡冷启动主态（「底座还没立起来」）。与 S1-6 同族，viewBox 比例区分：语义尺寸「卡内 2/3 高」 |
| asset.S4-6 | S4 | 皮肤/token | 主按钮「开始填写出生信息」（冷启动期的主行动） | `skins/primary-button.md` | 主按钮皮肤（冷启动主行动「开始填写出生信息」）；全稿唯一主按钮皮肤，S1/S3/S2 stale 动作复用 |
| asset.S4-7 | S4 | 皮肤/token | 卡内「为什么空」说明行的排版（小字 + 弱化） | `skins/why-empty-caption.md` | 卡内「为什么空」说明行排版（小字 + 弱化）；弱化靠 text 族分档（secondary/tertiary），不降透明度；文案归 copy 分工 asset.S4-10 |
| asset.S4-8 | S4 | 皮肤/token | horosa 未就绪提示条（含 [重新检测]） | `skins/horosa-banner.md` | horosa 未就绪提示条（含 [重新检测] + [去排查 -> S15]）皮肤 + 图标位；边条式，--xs-state-error-fg；不整屏失败 |
| asset.S4-10 | S4 | 占位/文案 | 四条冷启动空态文案（命盘 / 日课 / 底稿 / 问事副标题）最终定稿 | `copy/s4-cold-start-empty-copy.md` | 四条冷启动空态文案（命盘 / 日课 / 底稿 / 问事副标题）最终定稿；权威来源 S4 §2/§3 + S1 §6 |
| asset.S5-1 | S5 | 图标 | 侧栏「库」（分区语义名）· 谱入口行（label 谱） | `icons/nav/nav-pu.svg` | 侧栏「谱」行；与 S15-1 同枚 |
| asset.S5-2 | S5 | 图标 | 「＋ 创建新谱」主按钮 | `icons/action/plus.svg` | 「＋创建新谱」主按钮；与 S6-3/S12-1 同枚 |
| asset.S5-3 | S5 | 占位/文案 | 无任何可选谱的空态（§6 empty） | `illus/empty/pu-empty.svg` | 无任何可选谱的空态（S5 §6 empty）。空谱架 + 一本待写的谱；raw_type=empty-state、suggested_format=SVG，故产出 SVG 空态归 empty/ |
| asset.S5-4 | S5 | 图标 | 级别标识：基础输入级 base / 可选输入级 optional（成对） | `icons/status/level-base.svg`<br>`icons/status/level-optional.svg` | 谱级别标识 base/optional 成对 |
| asset.S5-5 | S5 | 插画 | 创建谱向导「AI 转换中」的过程示意（打字 / 附件 → 结构 + 分节） | `illus/guide/pu-ai-converting.svg` | 创建谱向导「AI 转换中」过程示意（打字 / 附件 → 结构 + 分节）。静态占位，动画后置 |
| asset.S5-6 | S5 | 图标 | 谱来源标识：manual / ai-assisted / sediment / workflow（四枚） | `icons/status/src-manual.svg`<br>`icons/status/src-ai.svg`<br>`icons/status/src-sediment.svg`<br>`icons/status/src-workflow.svg` | 谱来源标识四枚同族 |
| asset.S5-7 | S5 | 图标 | 锁定行标记（与 S6 共用同一枚语义图标） | `icons/inline/lock.svg` | 锁定行标记；与 S6-2 同枚 |
| asset.S5-8 | S5 | 图标 | ⋯ 行菜单与「打开 / 编辑 / 删除」动作 | `icons/action/more.svg`<br>`icons/action/open.svg`<br>`icons/action/edit.svg`<br>`icons/action/remove.svg` | 行菜单 + 打开/编辑/删除（后三枚复用 icons-b） |
| asset.S6-1 | S6 | 图标 | 侧栏「**问事**」入口行（label 问事；D1 的分区语义名为「书房」，见 S15） | `icons/nav/nav-consult.svg` | 侧栏「问事」行；与 S15-1 同枚 |
| asset.S6-2 | S6 | 图标 | 锁定标记（底座 / 底稿锁定行，与 S5 共用） | `icons/inline/lock.svg` | 锁定行标记；与 S5-7 同枚 |
| asset.S6-3 | S6 | 图标 | 「＋ 开一次问事」/「＋ 新问事」主按钮 | `icons/action/plus.svg` | 「＋开一次问事」主按钮；与 S5-2/S12-1 同枚 |
| asset.S6-4 | S6 | 图标 | 「历史回看」入口 | `icons/action/history.svg` | 「历史回看」入口；与 S7-1 同枚 |
| asset.S6-5 | S6 | 图标 | 「临时挂载」入口（挂载语义，区别于谱的勾选语义） | `icons/action/mount.svg` | 「临时挂载」入口；S8-1 复用同枚 |
| asset.S6-6 | S6 | 占位/文案 | 未开过问事的面板落地态（§2.2） | `illus/empty/consult-empty.svg` | 未开过问事的面板落地态（S6 §2.2）。空会话泡 + 问号；raw_type=empty-state、suggested_format=SVG |
| asset.S6-7 | S6 | 图标 | 审批卡状态标记（待审批 / 已允许 / 已拒绝，三态同族） | `icons/status/approval-pending.svg`<br>`icons/status/approval-allowed.svg`<br>`icons/status/approval-rejected.svg` | 审批卡三态同族 |
| asset.S6-8 | S6 | 图标 | 「ⓘ 说明卡」类提示（锁定行、边界说明通用） | `icons/inline/info.svg` | 「ⓘ 说明卡」类提示 |
| asset.S6-9 | S6 | 图标 | 「继续这次问事 ▸ conversation」渲染面切换入口（D5） | `icons/action/open-conversation.svg` | 「继续问事 ▸ conversation」切换入口（D5） |
| asset.S7-1 | S7 | 图标 | 「历史回看」子页切换入口（与 S6 共用） | `icons/action/history.svg` | 历史回看子页切换入口；与 S6-4 同枚 |
| asset.S7-2 | S7 | 占位/文案 | 「还没有问事记录」首次空态（§2.3 ①） | `illus/empty/consult-history-empty.svg` | 「还没有问事记录」首次空态（S7 §2.3 ①）。空历史列表 + 时钟；raw_type=empty-state、suggested_format=SVG |
| asset.S7-3 | S7 | 图标 | 合参轮次标记（合参√、只带采用稿的折叠行） | `icons/inline/bestof-check.svg` | 合参轮次标记（合参√） |
| asset.S7-4 | S7 | 图标 | 工具调用折叠行（⚙ 读了 N 个文件） | `icons/inline/tool-read.svg` | 工具调用折叠行（读 N 个文件） |
| asset.S7-5 | S7 | 图标 | 破坏性动作（删除记录）与确认弹窗 | `icons/action/delete.svg` | 破坏性删除动作 |
| asset.S7-6 | S7 | 图标 | 导出动作与落盘成功提示 | `icons/action/export.svg`<br>`icons/status/saved.svg` | 导出动作（复用 icons-b export）+ 落盘成功 |
| asset.S7-7 | S7 | 图标 | 「继续这次问事 ▸」跨面板切换（D6） | `icons/action/open-conversation.svg` | 「继续问事 ▸」跨面板切换（D6）；与 S6-9 同枚 |
| asset.S8-1 | S8 | 图标 | 「临时挂载」入口与抽屉标题（与 S6 共用同一枚） | `icons/action/mount.svg` | 「临时挂载」入口与抽屉标题。与 S6-5 同枚（icons-a 产），本清单只登记指向、不重复产。 |
| asset.S8-2 | S8 | 图标 | 分区标识：工作区 / 工作流（成对） | `icons/inline/workspace.svg`<br>`icons/inline/workflow.svg` | 分区标识：工作区 / 工作流（成对，语义尺寸一致）。与 S13-3/S13-6 共用实体字形，同枚复用保持全稿一致。 |
| asset.S8-3 | S8 | 图标 | 状态栏预算 / 字数指示（含「已纳入 N / M 层」） | `icons/status/budget.svg` | 状态栏预算 / 字数指示（含「已纳入 N / M 层」）：量杯刻度 + 水位线。 |
| asset.S8-4 | S8 | 占位/文案 | 没有可挂对象时的空态（§2.4） | `illus/empty/mount-empty.svg` | 没有可挂对象时的空态（S8 §2.4）。两个空挂载槽（工作区 / 工作流）+ 悬空挂钩；raw_type=empty-state、suggested_format=SVG |
| asset.S8-5 | S8 | 图标 | stale 陈旧告警与「重新预览」 | `icons/status/stale.svg`<br>`icons/action/refresh.svg` | stale 陈旧告警（时钟带叹号）与「重新预览」（refresh 与 S13-4 [刷新] 同枚）。 |
| asset.S8-6 | S8 | 插画 | 「按段裁剪」的示意（段边界切分，供预览区展开处使用） | `illus/guide/mount-segment-cut.svg` | 「按段裁剪」示意（段边界切分）。长条分段 + 剪刀，供预览区展开处使用 |
| asset.S9-1 | S9 | 图标 | 「多 AI 合参」触发按钮与区块标题 | `icons/action/bestof.svg` | 「多 AI 合参」触发按钮与区块标题：并列双柱 + 顶弧相合。 |
| asset.S9-2 | S9 | 图标 | 候选视角标识：经典派 / 审慎派 / 现代派 / 精炼派（首版用前两枚，共四枚同族） | `icons/inline/angle-classic.svg`<br>`icons/inline/angle-prudent.svg`<br>`icons/inline/angle-modern.svg`<br>`icons/inline/angle-refined.svg` | 候选视角标识四枚同族同重量：经典派=方圆章、审慎派=盾、现代派=棱形闪电、精炼派=漏斗。首版只用前两枚，四枚一次产出。 |
| asset.S9-3 | S9 | 图标 | 判官区标记（只排序，不替你做决定） | `icons/inline/judge.svg` | 判官区标记：天平（只排序，不替你做决定）。 |
| asset.S9-4 | S9 | 图标 | 三动作图标：采用 / 合并 / 否决（+ 中断语义的「停止全部」） | `icons/action/adopt.svg`<br>`icons/action/merge.svg`<br>`icons/action/reject.svg`<br>`icons/action/stop.svg` | 三动作 + 停止全部四枚同族：采用=对勾入囊、合并=双流汇合、否决=叉封囊口（与采用以勾/叉明确区分）、停止=实心方（与 S12-3 [停止] 同枚）。 |
| asset.S9-5 | S9 | 插画 | 「2 路并排 → 判官排序 → 采用 / 合并 / 否决」流程示意（费用确认框与拦截引导处使用） | `illus/guide/bestof-flow.svg` | 「2 路并排 → 判官排序 → 采用 / 合并 / 否决」流程示意（费用确认框与拦截引导处使用） |
| asset.S9-6 | S9 | 图标 | 回落告警（判官不可用） | `icons/status/alert.svg` | 回落告警（判官不可用）：三角叹号。 |
| asset.S9-7 | S9 | 图标 | 设置里的合参开关（开 / 关两态，与全稿开关同族） | `icons/inline/switch-open.svg`<br>`icons/inline/switch-close.svg` | 设置里的合参开关两态（开=滑珠居右带点芯 / 关=滑珠居左空心），与全稿开关同族。 |

### 6.1 复用别名（不另产文件，指向同枚素材）

| 别名 id | 屏 | 复用自 | 用途 | 实际文件 |
|---|---|---|---|---|
| asset.S4-2 | S4 | asset.S1-7 | 日课卡冷启动空态（与 S1 asset.S1-7 **同款复用**，不另画） | `illus/empty/rike-empty.svg` |
| asset.S4-3 | S4 | asset.S1-8 | 底稿卡冷启动空态（与 S1 asset.S1-8 **同款复用**） | `illus/empty/digao-empty.svg` |
| asset.S4-4 | S4 | asset.S1-5 | 快捷入口三格（**复用** asset.S1-5） | `icons/nav/nav-quick-consult.svg`<br>`icons/nav/nav-quick-workspace.svg`<br>`icons/nav/nav-quick-workflow.svg` |
| asset.S4-5 | S4 | asset.S1-1 | 侧栏「家」行（**复用** asset.S1-1） | `icons/nav/nav-overview.svg` |
| asset.S4-9 | S4 | asset.S1-11 | 只读 / 纯派生徽标（**复用** asset.S1-11） | `skins/badge-readonly.md` |

**统计**：台账 124 条 · 别名 5 条 · 产出文件 155 个（去重） · manifest 条目 124 条。

## 7. 验收自检（票 03 四条验收项）

| 验收项 | 落在哪 | 状态 |
|---|---|---|
| 产出 UI 素材资产，覆盖全部自有界面清单 | `icons/` `illus/` `brand/` `tokens/` `skins/` `copy/` + §6 对账表 | ☐ |
| 统一命名与目录/资源组织，可直接被 UI 实现票引用/导入 | §1–§3 + 仓库相对路径消费方式 | ☐ |
| 素材与 02 设计稿一致（结构/交互/状态要求的视觉元素齐备） | §6 双向对账 + `scripts/check-ui-assets.mjs` 全绿 | ☐ |
| 交付物为资源文件 + 资产清单说明；不含实现代码、不含视觉精修 | 本目录全部文件（lint：无 tsx/ts/组件 css） | ☐ |
