# 玄枢 XuanShu 上游复用事实核查报告

核查日期：本次会话。方法：GitHub REST API + raw.githubusercontent 一手源码 + WebSearch 定位（本会话 CDP 未连接，未使用浏览器层）。约 14 次联网操作。

---

## 1. horosa-skill（`Horace-Maxwell/horosa-skill`）

| 声明项 | 结论 | 证据 URL |
|---|---|---|
| 仓库存在 | ✅ 存在，公开，未归档；453★ / 82 fork / 0 open issues | https://github.com/Horace-Maxwell/horosa-skill · https://api.github.com/repos/Horace-Maxwell/horosa-skill |
| 许可证 AGPL-3.0-only | ✅ 证实（GitHub API `license.spdx_id = AGPL-3.0`；README 写 AGPL-3.0-only） | https://raw.githubusercontent.com/Horace-Maxwell/horosa-skill/main/README.md |
| MCP server + CLI | ✅ 证实 | 同上 |
| local-first / 本机离线算 | ✅ 证实（"算法在本机运行，不联网、不上传"；"本地进程 · 110 工具"） | 同上 |
| 统一 envelope 输出 | ✅ 证实（README「输出契约」节） | 同上 |
| 技法依据卡 | ✅ 证实（每响应附 `data.technique_card`：技法/流派口径/算源声明 vs 运行实测/段落完整性/版本链） | 同上 |
| 多技法合参 5–8 路 + 分歧必披露 | ✅ 证实（`horosa_hecan` 默认 5 路、上限 8 路；"分歧必须披露、不许平均"） | 同上 |
| 知识库域数 = 24 | ❌ **不符**，上游为 **31 域 / 409 条** | 同上 |
| 调用自动落库 | ✅ 证实（"每次调用自动落成可检索的本地记录"） | 同上 |
| 报告导出 | ✅ 证实（`horosa_report_render` → JSON/DOCX/PDF） | 同上 |
| 安装方式 | ✅ 前置只需 uv；`uv run horosa-skill install` → `serve`（http://127.0.0.1:8765/mcp）；零安装走 release 内纯 Python wheel（`uvx --from "<wheel>"`）；PyPI 通道"已就绪但暂未开通" | 同上 |
| 版本 / 发布状态 | ✅ 最新 release **v0.40.1**（2026-10-06）；资产含 darwin-arm64 / win32-x64 runtime、`.mcpb`、wheel、SBOM、SHA256SUMS；仓库无 git tags | https://api.github.com/repos/Horace-Maxwell/horosa-skill/releases/latest |
| 技法数量 = 93 | ❌ **三处互相矛盾**：description「92」、README「110 技法 / 110 工具」、`server.json`「106 technique tools」、客户端表「全量 120 工具」 | https://raw.githubusercontent.com/Horace-Maxwell/horosa-skill/main/server.json |
| 任何 MCP-capable host 可用 | ✅ 基本上证实，但有限制：Claude Code / Claude Desktop(.mcpb) / VS Code Copilot(精简 11，因跨 server 128 工具上限) / Windsurf-Devin / OpenClaw-mcporter / Open WebUI / Codex，均为 stdio；ChatGPT 与 claude.ai 远程连接器需自建终结 OAuth 的 HTTPS 网关，明确"**没有托管端点**" | README「Works with」表 |

---

## 2. 星阙 / Horosa 桌面端

**结论：存在，同作者（Horace-Maxwell）交付，开源，AGPL-3.0-only。**

- 产品名：**星阙 Horosa**
- 仓库：https://github.com/Horace-Maxwell/Horosa-Web-App-comprehensively-improved-MacOS （395★）
  https://github.com/Horace-Maxwell/Horosa-Web-App-comprehensively-improved-Windows （393★）
- 开源/闭源：**开源**，AGPL-3.0-only，含应用源码（`Horosa-Web/`）
- 发行渠道：GitHub Releases。macOS 12+/Apple Silicon「离线 .pkg」，Developer ID 签名 + Apple 公证；**当前 v3.11.3（运行时 3.11.3-runtime1）**，正式版。Windows 侧为离线 NSIS 安装包。
  https://github.com/Horace-Maxwell/Horosa-Web-App-comprehensively-improved-MacOS/releases
- 技术栈：Tauri 2 (Rust) + React 17/UMI3 + Java 17 Spring Boot `:9999` + Python 3.9 Swiss Ephemeris `:8899`

### (a) 八字/出生信息输入 → 出盘

✅ **证实**。README 截图页："八字工作区 —— 简 / 细 / 古法三盘，五行力量、格局用神、月令司令，大运 / 流年 / 流月 / 流日联动"；"四柱排盘走前端本地引擎"。
后端源码存在：`BaZiBirthController.java`、`PaiBaZiController.java`、`model/BaZi.java`、`BaZiNongliTimeAlgTest.java` 等。

- https://github.com/Horace-Maxwell/Horosa-Web-App-comprehensively-improved-MacOS/blob/main/README_ZH.md
- https://github.com/Horace-Maxwell/Horosa-Web-App-comprehensively-improved-MacOS/blob/main/Horosa-Web/astrostudysrv/astrostudycn/src/main/java/spacex/astrostudycn/controller/BaZiBirthController.java

### (b) 多 AI 差异分析

✅ **功能证实存在**，⚠️ 但**官方命名不是"多AI 差异分析"**。上游名为 **「多模型对比」Best-of-N**：

源码注释原文："一问同时发给 **2-4 个候选**（不同模型，或同一模型四个视角）**并排流式出字**，判官打分选优，可采用/合并；候选流**不带工具**（对比模式只回答不执行动作）；采用的成为正文，**其余折叠保留在 `message.candidates`**"。

- 入口命令：`/多模型`
- 两种模式：`不同模型`（选 2-4 个候选）、`同一模型多视角`（经典派 / 现代派 / 审慎派 / 精炼派，默认经典+审慎）
- 判官：路由 `judge` 槽，`json_schema strict`，失败回落第一份
- 接入：OpenAI / DeepSeek / Anthropic / Gemini / OpenRouter / Ollama(本地) / Moonshot(Kimi) / 智谱 / 硅基流动 / Groq / xAI / 自定义 OpenAI 兼容端点

证据：
- https://github.com/Horace-Maxwell/Horosa-Web-App-comprehensively-improved-MacOS/blob/main/Horosa-Web/astrostudyui/src/utils/aiBestOfN.js
- https://github.com/Horace-Maxwell/Horosa-Web-App-comprehensively-improved-MacOS/blob/main/Horosa-Web/astrostudyui/src/components/aianalysis/chat/BestOfPanel.js
- https://github.com/Horace-Maxwell/Horosa-Web-App-comprehensively-improved-MacOS/blob/main/Horosa-Web/astrostudyui/src/components/aianalysis/chat/useChatBestOf.js
- https://github.com/Horace-Maxwell/Horosa-Web-App-comprehensively-improved-MacOS/blob/main/Horosa-Web/astrostudyui/src/utils/__tests__/aiChatBestOf.test.js

注意：`AgentDiffPreview.js` + `aiAgentDiffPreview.test.js` 是 **agent 写操作前的 before→after 行级 diff 预览**（设置项/建档预览），**与本条无关**，勿混淆。

### 上游源流（不属于本作者）

旧星阙 Horosa 由「**郑大哥**」一手创建，**荀爽-Herakleios** 参与辅助设计，二人公开了源码；Horace-Maxwell 的 macOS/Windows 版是"于旧星阙 Horosa 基础上改良制作"。

- https://github.com/Herakleios/Horosa-Web
- https://github.com/Herakleios/Horosa-APP

家族其他仓库：`Horosa-PhoneAPP-Mac`（MPL-2.0）、`Horosa-Web-Server`（部署方案，无许可证）、`horosa-watch-site`（Apple Watch 隐私/支持页）。

---

## 3. 未证实 / 未找到

1. **「93 术数/占星技法」对不上任何上游口径** —— 上游自述 92 / 106 / 110 / 120 四种数字，无 93。
2. **「24 域知识库」对不上** —— 上游为 31 域 / 409 条。
3. **上游文档中不存在「多AI 差异分析」这一命名** —— README 用「多模型 AI 分析」「多 LLM 接入」，源码用「多模型对比 / Best-of-N / 多模型判官」。功能实质成立，命名不同。
4. **Winget 包 `HoraceMaxwell.Horosa`**：第三方索引页存在（https://winget.ragerworks.com/package/HoraceMaxwell.Horosa），但未在 microsoft/winget-pkgs 取到清单 → 未证实。
5. **未找到 `horosa.app` 官方网站**；未找到官方应用商店（App Store / Microsoft Store）桌面端上架页。
6. **桌面端「多模型对比」缺少用户可见证据**：已核实源码、单测、性能注释，但**未找到截图、release notes 条目、官方文档章节**；未在真实浏览器中实跑。
7. **早期「星阙」App（荀爽 2024 安卓版 / 小米应用商店 `com.horosa.www`）** 与本次核实的桌面端非同一交付物，其当前维护状态未核实。

---

## 总体置信度

**约 85%（高）** —— 两个被复用的上游对象都真实存在，许可证与绝大多数功能声明有一手源码 / GitHub API 佐证；主要风险集中在**数量型声明（93、24）与上游官方口径不符**，以及**「多AI 差异分析」这个名称并非上游用法**（功能本身存在）。

> 附注：本报告为早期（v10 定稿前）的事实核查底稿；此后又完成了五份更细的源码级侦察（`docs/research/dsh-recon.md`、`horosa-recon.md`、`horosa-skill-source.md`、`horosa-web-windows.md`、`true-solar-time.md`），其中「93/24 数字不符」与「真太阳时是否由上游处理」等疑问已全部澄清，以新报告为准。
