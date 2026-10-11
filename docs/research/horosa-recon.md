# Horosa Skill 上游集成面核查报告

- **核查对象**：https://github.com/Horace-Maxwell/horosa-skill
- **核查日期**：2026-10（以本机当日 GitHub API 返回为准）
- **核查方法**：加载 `web-access` skill 后按其工具选择表，对 GitHub 公开 API / raw 静态内容直接 WebFetch 一手来源（无需登录态，未启用 CDP 浏览器）。所有结论附 URL 与原文引用。
- **一手来源清单**：
  - releases/latest：https://api.github.com/repos/Horace-Maxwell/horosa-skill/releases/latest
  - releases 列表：https://api.github.com/repos/Horace-Maxwell/horosa-skill/releases
  - README（main）：https://raw.githubusercontent.com/Horace-Maxwell/horosa-skill/main/README.md
  - server.json（MCP Registry 元数据，main）：https://raw.githubusercontent.com/Horace-Maxwell/horosa-skill/main/server.json
  - LICENSE（main）：https://raw.githubusercontent.com/Horace-Maxwell/horosa-skill/main/LICENSE
  - 输入契约：https://raw.githubusercontent.com/Horace-Maxwell/horosa-skill/main/docs/INPUT_CONTRACTS.md
  - 经验台账（逐版本教训）：https://raw.githubusercontent.com/Horace-Maxwell/horosa-skill/main/docs/LESSONS.md

---

## 1. 版本与安装

### 最新 release

- **tag：`v0.40.1`**，`published_at: 2026-10-06T18:14:41Z`，非 prerelease，target_commitish: main。
  证据（releases/latest API）：
  > `"tag_name":"v0.40.1" … "published_at":"2026-10-06T18:14:41Z"`（URL：https://api.github.com/repos/Horace-Maxwell/horosa-skill/releases/latest）
- 资产（每 release 同构）：
  - `horosa_skill-0.40.1-py3-none-any.whl`（1,403,270 B）— 纯 Python wheel，零安装入口；
  - `horosa-skill-0.40.1.mcpb`（1,541,294 B）— Claude Desktop 一键包；
  - `horosa-runtime-darwin-arm64-v0.40.1.tar.gz`（约 732 MB）、`horosa-runtime-win32-x64-v0.40.1.zip`（约 719 MB）— 离线 runtime 载荷；
  - `horosa-skill-sbom.json`、`runtime-manifest.json`、`SHA256SUMS.txt`。
- release 正文仍为占位：`"body":"Draft：seed / .mcpb / wheel / SBOM 已上传；Windows 半、双平台清单、SHA256SUMS 由 release-runtime.yml 补齐后转公开。发布说明请随后编辑补全。"`

### 发布历史（releases API 共 8 个公开 release）

| tag | published_at | 备注 |
| --- | --- | --- |
| v0.40.1 | 2026-10-06 | 最新；preflight/pin 修复（LESSONS） |
| v0.40.0 | 2026-10-01 | Windows SE_EPHE_PATH 冷线程星历修复、上游 v3.11.x 重同步 |
| v0.39.0 | 2026-09-22 | 引入可选云端决策层 Jev（默认关闭） |
| v0.38.1 | 2026-09-14 | Windows 编码/升级/矩阵修复 |
| v0.38.0 | 2026-09-11 | 首次托管双平台一次公开；`setup --client` 一条命令接入 |
| v0.36.0 | 2026-09-05 | — |
| v0.35.0 | 2026-09-03 | — |
| v0.34.0 | 2026-09-01 | 上游 v3.10.0 择日十技法同步 |

> 注：LESSONS.md 台账中出现 v0.37.0 条目（"v0.37.0 (2026-09) | 任意 AI 客户端可调用"），但 releases API 列表中没有 v0.37.0 —— 该版本疑似未公开或未发 release（仅存在于经验台账）。

### 安装方式

README「快速开始」原文（URL：https://raw.githubusercontent.com/Horace-Maxwell/horosa-skill/main/README.md）：

```bash
git clone https://github.com/Horace-Maxwell/horosa-skill.git
cd horosa-skill/horosa-skill
uv sync
uv run horosa-skill install      # 装离线 runtime（断点续传）
uv run horosa-skill doctor
uv run horosa-skill selfcheck
uv run horosa-skill serve        # 启动本地 MCP（默认 http://127.0.0.1:8765/mcp）
```

零安装（uvx wheel，无需 git / PyPI）：

```bash
WHL="https://github.com/Horace-Maxwell/horosa-skill/releases/download/v0.40.1/horosa_skill-0.40.1-py3-none-any.whl"
uvx --from "$WHL" horosa-skill install
uvx --from "$WHL" horosa-skill setup --client cursor
uvx --from "$WHL" horosa-skill serve --transport stdio
```

### 前置依赖

- **唯一硬前置：uv**。README 原文：
  > "前置只需 [uv](https://docs.astral.sh/uv/)：…Python ≥ 3.12 由 uv 自动准备；磁盘预留约 5 GB（runtime 下载约 730 MB、解压后约 2 GB）。"
- 离线 runtime 内嵌 Java 17（Temurin/Adoptium）、Python、Node、Swiss Ephemeris（astropy/flatlib）；用户无需自装。
- **PyPI 通道未开通**：`"PyPI 通道（uvx horosa-skill …）已就绪但暂未开通（等维护者完成一次性 Trusted Publisher 配置）"`；server.json 同述：`"publish_blocked_until": "pypi trusted publisher (deferred by the maintainer)"`。
- 平台：macOS arm64 ✅、Windows x64 ✅、Windows ARM 走 x64 仿真 ✅（自 0.38.0）、Intel Mac ❌、Linux ⚠️ 无载荷（走网关模式，指向 `HOROSA_SERVER_ROOT` / `HOROSA_CHART_SERVER_ROOT`）。
- Windows 关键坑（README 排障表）：runtime 根目录必须**纯 ASCII**（中文用户名默认路径会挂），设 `HOROSA_RUNTIME_ROOT=C:\horosa`；Java loopback 可能被安全软件 WFP 拦截（issue #14）。

---

## 2. MCP 传输

- **支持两种传输**：`stdio` 与 `streamable-http`。server.json 证据：
  - 包级默认 `"transport": {"type": "stdio"}`（packageArguments：`serve --transport stdio`）；
  - `"_meta.…transports": ["stdio", "streamable-http"]`。
- **默认监听**：`uv run horosa-skill serve` 默认起 **HTTP `http://127.0.0.1:8765/mcp`**（streamable-http，README 快速开始注释）。MCP Registry 元数据里 stdio 是包默认，但裸 `serve` 缺省落点是 8765/mcp HTTP 端点。
- **宿主连接方式**（README「Works with」表）：
  - 本地桌面/CLI 客户端（Claude Code / Desktop / Cursor / VS Code / Codex / Gemini / Windsurf / Cline / Zed / OpenClaw）→ **stdio**，`setup --client <名>` 一条命令写入对应客户端配置；或 `client config --format <客户端>` 只生成不落盘。
  - Claude Desktop 另可装每 release 附带的 **`.mcpb` 一键包**。
  - Open WebUI / n8n / Dify 及远程连接器 → **streamable-http**：`horosa-skill serve --host 0.0.0.0 --token <随机串>`。
  - ChatGPT / claude.ai 远程连接器只接 OAuth，本 server 只提供静态 Bearer，需再套"终结 OAuth 的 HTTPS 网关"（Cloudflare Access / oauth2-proxy 把 OAuth 换成 `Authorization: Bearer <HOROSA_MCP_TOKEN>`）。
- **鉴权**：
  - 回环/本机默认**无鉴权**；
  - 跨机 streamable-http **必须带 token** 且**没有 TLS**：README 原文 —— "跨机必须带令牌，且**没有 TLS**，请放反代后面"；
  - Docker 网关绑 0.0.0.0 必须设 `HOROSA_MCP_TOKEN`："> 绑 0.0.0.0 必须给 `HOROSA_MCP_TOKEN`"；
  - 环境变量（server.json）：`HOROSA_RUNTIME_ROOT`、`HOROSA_SKILL_DATA_DIR`、`HOROSA_JEV`（off/shadow/enforce）、`HOROSA_JEV_API_KEY`(secret)。

---

## 3. 工具面（README 技法总览，全量 120 = 110 技法 + 11 门面；精简面 11）

| 类别 | 数量 | 关键工具 ID |
| --- | --- | --- |
| 西洋占星·本命派生 | 11 | `chart`、`chart12`、`chart13`、`draconic`、`relocation`、`hellen_chart`、`india_chart`、`guolao_chart`、`relative`、`germany`、`babylon` |
| 西洋·推运/返照/地图 | 33 | `solarreturn`、`lunarreturn`、`solararc`、`givenyear`、`profection`、`pd`（主限至 3000 年）、`pdchart`、`zr`、`firdaria`、`decennials`、`ephemeris`、`acg`、`astrodata`、`xuanshi` |
| 西洋卜卦/择日 | 13 | `horary`、`election`、`tianxing`、`qizhengelection`、`qimenzeri`、`huanglizeri`、`bazizeri`、`taiyizeri`、`ziweizeri`、`liurengzeri`、`sanshizeri`、`qizhengzeri`、`indiazeri` |
| 中文术数主干 | 11 | `bazi_birth`/`bazi_direct`/`bazi_inverse`、`ziwei_birth`、`liureng_gods`、`liureng_runyear`、`qimen`、`taiyi`、`jinkou`、`sanshiunited` |
| 本地术数/占卜 | 16 | `sixyao`、`xiaoliuren`、`tarot`、`geomancy`、`lingqi`、`xiaochengtu`、`guice`、`zhengchuan`、`heluo`、`canping`、`yizhangjing`、`feigong`、`tongshefa`、`harmonic`、`suzhan`、`otherbu` |
| 神数（14 路） | 14 | `tieban`、`shaozi`、`cetian`、`jingjue`、`shenyishu`、`wangji`、`wuzhao`、`taixuan`、`beiji`、`nanji`、`chunzi`、`xianqin`、`qizhengkin`、`fendjing` |
| 节气/农历/黄历 | 6 | `jieqi_year`、`jieqi_birth`、`nongli_time`、`calendar_month`、`huangli`、`tongshu` |
| 协议/知识（免闸直读） | 6+ | `gua_desc`、`gua_meiyi`、`export_registry`、`export_parse`、`knowledge_registry`、`knowledge_read`、`ziwei_rules`（紫微规则库） |
| **MCP 门面（非技法）** | 11 | 见下 |

门面工具（`HOROSA_MCP_COMPACT=1` 时只暴露这一层）：

| 门面 | 作用 |
| --- | --- |
| `horosa_dispatch` | 自然语言总调度 → 分派技法 |
| `horosa_hecan` | 合参：一问并行多技法（默认 5、上限 8） |
| `horosa_tool_run` | 按名直调 110 技法任意工具 |
| `horosa_agent_guidance` | 参数指引（先问哪些字段、可默认值） |
| `horosa_technique_report` | 技法依据报告 |
| `horosa_report_template` / `horosa_report_render` / `horosa_report_from_tool` | 报告渲染（JSON/DOCX/PDF，自动写回记忆） |
| `horosa_memory_query` / `horosa_memory_show` / `horosa_memory_record_answer` | 本地记忆：检索/回看/写回 |

> 不一致点（上游自述）：server.json 描述写 "106 technique tools"，README 为 110 技法 / 全量 120 / 精简 11（server.json 滞后于 README）。以 README（v0.40.1）为准。

---

## 4. 出生信息输入

- **上游没有引导式/交互式 CLI 录入流程**。CLI 是 JSON-first：`echo '<payload.json>' | uv run horosa-skill tool run solarreturn --stdin`（INPUT_CONTRACTS.md）；MCP 侧就是裸工具 + JSON 参数。没有"向导/交互补问"程序。
- **唯一的"引导"机制是澄清闸（硬拦截）**：README ——
  > "🛡️ **调用前的硬性澄清闸。** 只要技法受时间 / 地点 / 时区 / 性别 / 事项 / 宫制 / 历法 / 起局方式影响，agent 在用户确认前会被结构化拦截，并收到可直接转发给用户的追问文本。"
  INPUT_CONTRACTS.md："所有会改变结果的技法在调用前都必须确认参数；未确认时会返回 `agent_guidance.required`"；"任何 AI 客户端都应该先调用 `horosa_agent_guidance` 或 CLI `agent guidance`，再调用真实技法。"
- **参数形态**（INPUT_CONTRACTS.md 基础星盘类输入表）：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `date` / `time` | `1995-06-03` / `05:30` | 出生日期/时间；"不知道精确时间必须先问用户" |
| `zone` | `+08:00` / `America/Los_Angeles` | IANA 名会在进 runtime 前归一化为固定 offset（按起盘日期，含冬夏令时） |
| `lat` / `lon` | `31n13` / `121e28` | 度分格式，也可 `gpsLat`/`gpsLon` 小数 |
| `hsys` / `zodiacal` | `0` / `0` | 宫制（默认整宫）/ 黄道（默认回归） |
| `agent_confirmed_settings` / `clarification_notes` | `true` / 文本 | 用户确认标记 + 说明（memory 与审计用） |

- **真太阳时**：在 README 与 INPUT_CONTRACTS.md 全文核查中**未发现**任何"真太阳时"参数、换算工具或说明。出生时间按**当地钟表时间 + zone（时区）**传入，经纬度单独传；真太阳时换算需宿主自行处理（上游未提供该能力，报告撰写时以 INPUT_CONTRACTS.md 全文字面为准）。
- **GUI 录入挂接点**：宿主若做 GUI 录入，应挂接 **`horosa_agent_guidance`**（按 `tool_name` 查该技法必问字段清单与可默认值）→ 用户在 GUI 填完 → 调用真实技法工具时带 `agent_confirmed_settings: true` + `clarification_notes` + date/time/zone/lat/lon 等字段。若宿主想绕开逐技法面，可用 `horosa_dispatch`（自然语言直入）或 `horosa_tool_run`（按名直调）。

---

## 5. envelope 形态

README「输出契约」原文示例（URL：https://raw.githubusercontent.com/Horace-Maxwell/horosa-skill/main/README.md）：

```json
{
  "ok": true, "tool": "qimen", "version": "0.40.1",
  "input_normalized": {}, "data": {}, "summary": [],
  "warnings": [], "memory_ref": {}, "error": null
}
```

补充（同节）：接入导出协议的技法额外带 `data.export_snapshot`（`export_text` 段结构化正文 / `sections` 逐段 / `selected_sections` / `provenance`）与 `data.technique_card`（技法依据卡）。"同一技法连续调用得到同一套契约"；`memory_ref.run_id` 落库后可 `memory_show(run_id)` 取回完整快照；`response_view=titles|sections` 可瘦身。

---

## 6. 知识库

- **31 域、409 条**。README：
  > "📚 **31 域方法论知识库，引必带出处。** 星阙 app 内 hover 知识三域 + 27 份技法操作手册 + 八字断语库（21 类口诀）共 409 条，逐条带上游文件与版本出处"
  > "`knowledge_registry` / `knowledge_read` 覆盖 31 域 = 星阙 app 内 hover 知识三域 + 27 份技法操作手册 + 八字断语库 21 类（共 409 条…）"
  质量表另述："技法操作手册 236 条逐条带出处"（为 409 条中的子集口径）。
- **检索工具**：`knowledge_registry`（列出/目录）、`knowledge_read`（读取 + `query` 跨域全文检索，逐条带出处）。README 工具表："31 域（hover 知识 + 技法操作手册 + 八字断语库）列出 / 读取 / `query` 跨域全文检索，逐条带出处"。
- **其它只读检索面**：`xuanshi`（玄史知识库：7900+ 玄学事件、27000+ 史书天象、人物图谱，只读检索）、`astrodata`（数万条 A/AA 级名人星盘，FTS/分类/Rodden 评级）、`ziwei_rules`（紫微格局规则全库）。

---

## 7. 许可

- **AGPL-3.0-only，确认**。
  - raw LICENSE（main）为 GNU Affero General Public License v3 全文（URL：https://raw.githubusercontent.com/Horace-Maxwell/horosa-skill/main/LICENSE）。
  - README 声明：徽章 `License-AGPL-3.0`；致谢段原文："本仓库其余术数实现……均为星阙自有算法，按根目录 `GNU AGPL-3.0-only` 授权。"
  - 例外：奇门/太乙/金口诀三个 `ken` 引擎（kentang2017 的 kinqimen/kintaiyi/kinjinkou）为**第三方 MIT 组件**，随 runtime 分发。
- 对 XuanShu 的含义：若把 horosa-skill 作为库/服务集成并对外提供服务，AGPL 第 13 条（网络交互需提供源码获取途径）适用；仅本地调用、不改动分发的场景风险低，但仍需法务确认。

---

## 8. 版本锁定建议

### 已观察到的跨版本兼容性事实

- **无正式兼容性承诺/CHANGELOG 面向消费者**：release 正文多为占位（"发布说明请随后编辑补全"）；版本历史散见 `docs/LESSONS.md`（维护者经验台账）与 README 内联标注。
- **已知破坏性/风险性变化**：
  - v0.21.0：契约单份化（"自 v0.21.0 起契约单份化，同一份快照不再重复存放"）；
  - v0.39.0→v0.40.0：修复 v0.39.0 已出货的 P1 —— `contracts/` 不在 wheel/MCPB 里（Jev enforce 永不生效），v0.40.0 起经 `contracts_locator` 进包（LESSONS）；
  - v0.40.0：上游桌面端 v3.11.x 重同步（契约 v15 / aiExport v58），新增 4 个工具（工具数 116→120）；Windows 侧 SE_EPHE_PATH 冷线程星历修复；
  - **runtime 与 skill 版本强耦合**：新树 × 旧 runtime 会因 `export_registry_version` 偏斜 skip/红（LESSONS v0.40.0-dev："requires_current_runtime_contract：已装 payload 的 `export_registry_version` < 本树 `AI_EXPORT_SETTINGS_VERSION` 即 skip"）；
  - Windows 发布历史有缺口模式（darwin-only、pin-forward 钉旧 zip，见 LESSONS「主线：latest 的 Windows 半边完整性」），锁版本时应同时校验 `runtime-manifest.json` 双平台齐全（README："Windows 半…清单只在两半齐了才上线"）。
- **发布节奏快**（约每周 1-2 个版本），上游桌面端（星阙 v3.11.3）在持续演进。

### 给 XuanShu 的锁定建议

1. **锁 `v0.40.1`**（2026-10-06，当前 latest）：最新 patch，包含 v0.40.0 的 Windows 星历修复与 preflight/pin 修复；不追 main。
2. **用钉死的 wheel URL 或 git tag 安装**，不要走 PyPI（未开通）：
   - wheel：`https://github.com/Horace-Maxwell/horosa-skill/releases/download/v0.40.1/horosa_skill-0.40.1-py3-none-any.whl`（SHA256 见 release 资产 `digest: fe377d64…f98819f83`）；
   - 或 git tag：`uvx --from "git+https://github.com/Horace-Maxwell/horosa-skill@v0.40.1#subdirectory=horosa-skill"`。
3. **runtime 与 skill 同版本安装**：`install` 会按该版本 release 的 `runtime-manifest.json` 拉同版本 payload；升级 skill 必须同步重装 runtime，禁止 skill 新树 + 旧 runtime 混跑。
4. **把 `server.json` / `runtime-manifest.json` 的 version、mcpb `fileSha256`（v0.40.1 = `0ac1fc20…7c03d7`）作为集成面校验锚**；Windows 部署校验 SHA256SUMS 且 runtime 根用纯 ASCII 路径（`HOROSA_RUNTIME_ROOT=C:\horosa`）。
5. 升级策略：小版本不盲升，先读新 release 的 LESSONS 台账新增条目（vX.Y.Z / 日期 小节）再决定；跨 0.38/0.39/0.40 大版本必有集成面变化（接入命令、契约、环境变量）。

---

## 附：核查过程说明（按要求注明）

- 已加载 `web-access` skill。任务目标是 GitHub 公开静态内容（API/raw），按其「URL 已知 → WebFetch」路径执行，未使用 CDP 浏览器；未发生需要 web_search 兜底的失败。
- releases 列表 API 返回体量超出单次工具回显，截断内容落盘于临时 spill 文件，用正则抽取了全部 8 个 release 的 tag/published_at 对（证据见第 1 节表）。
- 除注明处外，所有引用均为原文直接摘录；报告撰写时未发现上游文档对「真太阳时」的任何字段或说明。
