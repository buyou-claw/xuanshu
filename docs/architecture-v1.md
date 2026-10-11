# 玄枢 · 技术架构文档 v1

> 状态：v1（定义稿）｜日期：2026-10-11
> 依据：`product-definition.md`（v10）、`xuanshu-portrait.md`、`CONTEXT.md`、`docs/adr/0001-0005`、`docs/research/`（dsh-recon / horosa-recon / horosa-skill-source / horosa-web-windows / true-solar-time）
> 钉死版本见 ADR-0004：DSH dsh-v0.2.0-rc.2 · horosa-skill v0.40.1 · 星阙桌面端 v3.11.3（规格参考）
> 本文只定义架构与机制映射；谱的格式细节见 `docs/pu-spec-v1.md`；UI 细节留 UI 阶段。

---

## 1. 总体形态

**玄枢 = 一个 DSH profile（`xuanshu`）＋ 玄枢自有插件包 ＋ 内置 skill ＋ 安装脚本**，不 fork、不改 DSH 源码（ADR-0001）。分发 = 开源仓库（AGPL-3.0-only），每人本地部署，单用户，无账号体系。

```
玄枢仓库（开源，AGPL）
├── profile/xuanshu/            # DSH profile 定义（分发包主体）
│   ├── package.json            #   dsh.profile.bundles + 依赖（钉 rc.2 系）
│   ├── cordis.patch.yml        #   补丁行：horosa MCP 行、玄枢 host 插件行、调度行
│   └── pnpm-*.yaml
├── packages/
│   ├── xuanshu-host/           # 主机插件（cordis 插件包：装配、调度、数据、skills 注册）
│   └── xuanshu-client/         # 客户端插件（dsh.client：自我总览/问事/谱管理/藏库/Best-of-N UI）
├── skills/                     # 内置 skill（底稿刷新、日课生成、创建谱、沉淀导出）
├── scripts/setup/              # 安装脚本（horosa 下载安装、profile 装配、冷启动向导）
└── docs/                       # 本文档体系
```

运行 = `dsh --profile xuanshu web`（本地 Web GUI，即 DSH 的 `dsh web`，`127.0.0.1`）。

---

## 2. 分层（自下而上）

| 层 | 内容 | 责任 |
|---|---|---|
| L0 底座层 | horosa-skill v0.40.1：回环 streamable-http `127.0.0.1:8765/mcp` 常驻进程（runtime 内嵌 Java/Node/Python 星历） | 玄学计算：命（先天图）+ 运（大运/流年/推运）；永远在场、不可关 |
| L1 平台层 | DSH dsh-v0.2.0-rc.2 装配（cordis 补丁栈 + UI 槽位系统 + 会话/工作区/schedule/MCP/LLM 全套） | 形态骨架：插件机制、coding 工具、审批机制、多 provider |
| L2 玄枢插件层 | `xuanshu-host` + `xuanshu-client` + 内置 skills | 玄枢独有逻辑：自我总览、问事、谱、底稿、藏库、日课、多 AI 合参、工作流向导 |
| L3 数据层 | `~/.dsh/xuanshu/`（谱/底稿/藏库注册表）+ DSH sessions（问事会话）+ horosa 自管记忆 | 一切归你、随时带走（数据目录可整体拷走） |
| L4 体验层 | 自我总览（替换 DSH 首页）、问事、工作区、工作流、藏库、设置 | 三入口并列 + 四卡首屏 |

---

## 3. 装配清单（profile 层要点）

| 项 | 内容 | 出处 |
|---|---|---|
| 基础 bundles | 官方 `@deepseek-ai/dsh-base`（coding 工具 / 工作区 / 会话 / schedule / LLM） + web 侧基础 roster | dsh-recon.md §2.1、§7 |
| horosa MCP 行 | `cordis.patch.yml` 直接插入 `@deepseek-ai/dsh-mcp-client` 行（serverName `horosa`，streamable-http `http://127.0.0.1:8765/mcp`）——**市场删除 UI 管不到，即「默认自带、不可删除」** | dsh-recon.md §6.3 |
| 玄枢 host 插件行 | `@xuanshu/host`（bundle 补丁行，含 `ctx.schedule` 注册、数据目录初始化、horosa 进程生命周期托管） | dsh-recon.md §2.1 |
| 客户端插件 | `@xuanshu/client` 声明 `dsh.client{platform:web, inject}`，自带预编译 bundle | dsh-recon.md §7 |
| 首页替换 | 新 main key `overview` + `sidebar.panellist` 首行 + 设为默认面板；DSH 原 `conversation` 面板保留（问事/工作区共用会话 UI） | dsh-recon.md §2.4、§3.2 |

**horosa 进程生命周期**（xuanshu-host 托管）：启动时 `ensure runtime（未装则提示跑 setup）→ spawn serve → health check`；非回环不暴露（上游特性：非回环无 token 拒启，正好省去安全配置）。

---

## 4. 玄枢自有代码清单（不重复造轮子的剩余部分）

| 模块 | 内容 | 复用 / 自研 |
|---|---|---|
| xuanshu-host | profile 装配钩子、数据目录 `~/.dsh/xuanshu/`、horosa 进程托管、`ctx.schedule` 注册（日课/底稿刷新）、内置 skill 注册、问事会话创建 API（`ctx.sessions.create` + `meta.xuanshu`） | 复用 DSH 全套；仅写装配与调度胶水 |
| xuanshu-client | 自我总览面板（四卡）、问事面板（会话列表+勾选谱+临时挂载）、谱管理 UI、藏库 UI、Best-of-N UI（并列流式+判官+采用/合并/否决） | UI 自研（Vite6/React18）；交互规格照星阙（规格级复用） |
| 内置 skills | `xuanshu:create-pu`（创建谱）、`xuanshu:refresh-digao`（底稿刷新）、`xuanshu:rikke`（日课生成）、`xuanshu:sediment`（问事沉淀导出草稿） | 格式沿用 SKILL.md 规范（上游 /writing-skills 同规范） |
| scripts/setup | 钉死 wheel URL 下载 horosa（SHA256 校验）→ `uvx horosa-skill install`（runtime 同版本；Windows 设 `HOROSA_RUNTIME_ROOT=C:\horosa`）→ 建 xuanshu profile → `pnpm install` → 冷启动向导（八字录入）→ 自检 | 安装命令照上游 README（horosa-recon.md §1） |

---

## 5. 关键机制映射（产品概念 → 实现）

| 产品概念 | 实现机制 | 出处 |
|---|---|---|
| 自我总览（替换首页） | 新 main key `overview` + `sidebar.panellist` 首行；四卡 = 命盘卡（八字盘快照只读）/ 日课卡（当日产物）/ 底稿卡（digao.md 渲染）/ 快捷入口（三入口按钮） | dsh-recon.md §2.4、§3 |
| 问事/咨询 | 新 main key `consult` 面板；会话 = `ctx.sessions.create(id?,{meta:{xuanshu:{kind:'consult', pus:[勾选谱], mounts:[挂载]}}})`；落 `~/.dsh/sessions/`（JSONL 事件溯源，带 DSH 全套工具能力） | dsh-recon.md §4 |
| 勾选谱（会话级预选） | 会话 meta 的 `pus` 清单 → 注入上下文时读谱 summary（优先）→ 按需深入内容文件 | 本文 §6 数据流 |
| 临时挂载（工作区/工作流） | 会话 meta 的 `mounts` 清单（路径或实体 id）→ 注入前按「挂载预算」分层裁剪并披露（照星阙挂载账本模式：预览 + 裁减说明 + 状态栏字数） | horosa-web-windows.md §挂载 |
| 多 AI 合参 | xuanshu-client BestOfPanel：`/多模型` 命令 + 面板按钮；2–4 个 provider profile 或同模型四视角（classic/modern/cautious/concise，缺省经典+审慎）；N 路并行流式**不带工具**；judge 槽 `json_schema strict`、失败回落完成顺序第一份；采用/合并/停止；其余折叠进 `message.candidates`（`bestOf{adoptedId,ranking,judge,costUsd}`）；历史只带采用稿 | horosa-web-windows.md §Best-of-N；LLM 复用 DSH `ctx.llm` 多 adapter（dsh-recon.md §8） |
| 工作区/项目 | DSH 原样（`conversation` main key + workspace registry） | dsh-recon.md §4.1 |
| 工作流 | 「创建工作流」= `ctx.sessions.create` + seed 自动调 `/writing-skills`；跑通后「导出 skill」落 DSH skill 扫描路径；可含 MCP | product-definition §七-2 |
| 谱 | 数据 = `~/.dsh/xuanshu/pus/<谱名>/`（frontmatter+MD，见谱规范 v1）；AI 辅助创建（内置 skill）；日常不参与执行（ADR-0005） | pu-spec-v1 |
| 底稿 | 纯派生 = `~/.dsh/xuanshu/digao.md`；骨架+来源标记规则生成、摘要 LLM 提炼；`ctx.schedule` daily + 手动刷新；用户不改只改源头 | 本文 §6 数据流 |
| 藏库 | `~/.dsh/xuanshu/cang/registry.jsonl`（指针+签+跳转）；UI 卡片 `file://` 打开（系统默认程序）；**AI 永不读内容**（ADR-0003） | — |
| 日课/定时任务 | `ctx.schedule` daily（默认 07:30 可配，绑定玄枢内部专用「系统会话」投递）；日课生成 skill 读底座→调 horosa 推运→写当日卡 | dsh-recon.md §5 |
| 八字冷启动 | 录入表单（离线城市库+手输经纬双通道、钟表时间、时区自动含 DST）→ 存 `~/.dsh/xuanshu/pus/_base/bazi.md`（底座谱，与八字同级）→ 调 `horosa_cn_bazi_birth`（`agent_confirmed_settings:true` + `clarification_notes`；**透传 timeAlg，缺省省略=0 真太阳时，录入层不换算**）→ 快照存档 + `memory_ref` | true-solar-time.md、horosa-skill-source.md §4-5 |
| 沉淀闭环（问事） | 「导出汇总」→ `xuanshu:sediment` skill 生成草稿 → 人工点「更新到谱」→ 写入目标谱文件；AI 不静默写 | product-definition §三-其上四 |
| 安全兜底 | 问事带全套工具能力；「AI 动你的东西」由 DSH 审批机制兜底（复用，不自建） | product-definition 附录 |
| 多技法合参（底座内部） | horosa `horosa_hecan`（默认 5 路/上限 8），与多 AI 合参分层：技法合参在底座、AI 合参在输出层 | horosa-recon.md §3 |

---

## 6. 核心数据流

**冷启动**：setup 脚本（horosa 就绪）→ 首启自我总览 → 八字向导（城市库→经纬度；钟表时间；时区）→ `bazi_birth`（澄清闸确认）→ 底座谱落盘 + 命盘卡点亮。

**问事**：开会话（meta 勾选谱+挂载）→ 上下文装配 = 底座（默认在场）＋ 底稿（默认必加载）＋ 勾选谱（summary 优先、按需深入）＋ 挂载内容（预算裁剪披露）→ 说事 → `/多模型` 或面板触发 Best-of-N（候选流不带工具；主会话带全套工具）→ 人拍板（采用/合并/否决）→ 沉淀导出（人工确认写谱）。

**底稿刷新**：schedule daily 或手动 → skill 读三源（base 级谱、工作区扫描、工作流产物）→ 规则拼骨架与来源标记 → LLM 提炼各源摘要 → 写 `digao.md`（原子替换）。

**日课**：schedule daily → skill 读底座谱 + 当前时刻 → horosa 推运（流年/流日）→ 写当日卡 + 投递系统会话 → 自我总览日课卡展示。

**工作流创建**：入口按钮 → 新会话（seed 调 /writing-skills）→ coding 工具试跑 → 人判定跑通 → 「导出 skill」落扫描路径。

---

## 7. 数据与存储布局

```
~/.dsh/
├── profiles/xuanshu/          # DSH profile（装配，来自玄枢仓库 profile/xuanshu）
├── xuanshu/                   # 玄枢业务数据（可整体拷走 =「一切归你」）
│   ├── pus/<谱名>/            #   谱（manifest.md + 内容 + summary.md）；_base/bazi.md 为底座谱
│   ├── digao.md               #   底稿（纯派生）
│   └── cang/registry.jsonl    #   藏库注册表（指针+签+跳转；不含文件内容）
└── sessions/                  # 问事会话（DSH JSONL，事件溯源；meta 带 xuanshu 标记）
```
horosa 记忆/落库由其自管（`HOROSA_SKILL_DATA_DIR` 默认），玄枢不干预、不搬家。

---

## 8. Spike 清单（最小验证，四个风险点）

| # | 验证点 | 验收标准 |
|---|---|---|
| S1 | **客户端插件构建管线**：xuanshu-client 产出预编译 bundle 并随包发布，`dsh web` 加载后出现 overview 面板 | 不跑 `dev:web` 热更新、全新 profile 装包后 UI 正常 |
| S2 | **首页替换实跑**：main 新 key + sidebar.panellist 双注册、默认面板切换、priority 遮蔽不报错 | 首屏 = 自我总览；conversation 面板仍可用 |
| S3 | **horosa 集成**：补丁行静态挂 mcp-client → 工具 `mcp__horosa__*` 可用 → `bazi_birth` 出盘（timeAlg 缺省）→ 澄清闸拦截路径走通 | 出盘含 `technique_card`；envelope 结构符合契约 |
| S4 | **问事闭环**：`ctx.sessions.create` + meta 勾选谱 → 会话带工具跑一轮（读谱文件）→ 沉淀草稿 + 确认写谱 | 会话历史可查；谱文件被正确更新 |

---

## 9. 风险与未决（登记）

1. DSH rc 版无 API 稳定性承诺；补丁行 id / 槽位名属内部接口——升级时按 ADR-0004 清单重验。
2. judge 的 `json_schema strict` 结构化输出在 DSH `ctx.llm` 层的对应能力未侦察——S4 顺带验证；不支持则回落「文本判定 + 解析」。
3. 问事面板的会话渲染：优先复用 DSH conversation 组件，若内部 API 不可达则最小自研（S4 验证）。
4. 客户端深度定制（四卡/谱编辑）需要自建构建管线（S1 验证），这是装配路线的最大工程点。
5. 待定项（不阻塞）：签（schema 预留）、管理入口位置、上下文冲突优先级、工作流细流程、日课默认时刻、四卡刷新策略。
