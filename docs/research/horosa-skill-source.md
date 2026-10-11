# horosa-skill 上游源码侦察报告（只读）

- 侦察对象：`E:\ai_project\XuanShu\.upstream\horosa-skill`（main，HEAD=7ba3ab6a，2026-10-06；server.json/pyproject/CITATION.cff 均钉 0.40.1）
- 侦察方式：read / glob / grep / pwsh(Select-String)，忽略 `.git`。路径以下均相对于克隆根；`h` = `horosa-skill/`。

## 1. 仓库结构：薄封装门面 + 仓内 vendored JS 引擎 + Releases 分发的重型 runtime

- **main 相对 v0.40.1 的领先数：本地无法计算。** 该克隆是 depth=1 浅克隆（`git rev-list --count HEAD`=1），本地无 v0.40.1 tag（`git log v0.40.1..HEAD` 报 unknown revision），`git ls-remote` 联网被挂起后取消。可确认的事实：HEAD 提交 `fix(preflight): 上游 pin 只记公开远端取得到的提交——write-state 不再写入本地未推送的上游 HEAD`（2026-10-06 15:49 -0400），而仓内 3 处版本真值均为 0.40.1（`server.json:6,16`、`h/pyproject.toml:3`、`h/src/horosa_skill/__init__.py:3`），即 HEAD 至少是一个 v0.40.1 之后的 main 提交；提交数与改动清单需重新非浅克隆后才能给出。
- **不是完整引擎实现，而是「编排层 + 部分本地引擎 + 重型 runtime 按需下载」的混合体**：仓库保持轻量，重型 runtime（Java 聚合层 `:9999` + Python chart 服务 `:8899`，含 ken/kentang 引擎）走 GitHub Releases 分发（`docs/REPO_LAYOUT.md:5-8`）。
- **八字核心在仓库内**（本地优先引擎）：`h/horosa-core-js/src/vendor/bazi/baziLunarLocal.js`（1317 行，含排盘、真太阳时、分野）+ `h/horosa-core-js/src/tools/baziLocal.js`（工具编排）+ `baziSnapshot.js`（快照排版，逐字抽自上游 BaZi.js）。运行时入口 `service.py::_run_bazi_tool`（`h/src/horosa_skill/service.py:10957`）：先 `js_client.run("bazi_local", …)`（:10966），域外日期（公元前/万年）或 byLon/adjustJieqi=true 才回退 Java `/bazi/birth|direct`（:10959,10962,10979）；`compute_sources.bazi = lunar-local | java`（:11002）。
- **重型引擎在 runtime 载荷**：ken 引擎（kinqimen/kintaiyi/kinjinkou 等）只在构建机 `vendor/runtime-source/`（`vendor/README.md:7-25`），奇门/太乙/金口由本地 runtime 的 `/qimen/pan` 等端点算、JS 只排版（`docs/REPO_LAYOUT.md:25-31`；AGENTS.md §4）。Python 侧编排在 `h/src/horosa_skill/service.py`（`_call_remote` 打 chart 服务）；注册表 `h/src/horosa_skill/engine/registry.py`（`bazi_birth` 定义 :220、`bazi_direct` :221；`ToolDefinition.mcp_name = f"horosa_{domain}_{action}"` → MCP 名 `horosa_cn_bazi_birth`）。技法工具总数 110（registry.py 正则计数）。

## 2. 真太阳时：是，八字排盘在本地引擎内部做真太阳时修正

**核心实现（仓内 JS，vendored 自上游）**：`h/horosa-core-js/src/vendor/bazi/baziLunarLocal.js`

- `equationOfTime(utcMs)`（:271-295）：NOAA/Meeus 高精度均时差（儒略世纪级数，误差<15s，1800–2200；输入 UTC 毫秒，返回分钟）。注释明确：旧教科书简式与后端 swiss EoT 在时辰界骑线差 89s，权威=swiss。
- `applyApparentSolarTime(parts, params)`（:297-335）：`timeAlg=0` 真太阳时 = 经度差 `(lon − zoneHours×15)×4min` + 均时差 EoT；`timeAlg=3` 平太阳时（仅经度差，去 EoT）；其余（1=钟表时）不调整（:298-302）。`lon` 缺失回退 `gpsLon`（:305-308）；两者皆无 → 告警并退化为钟表口径（:309-314）。修正后重算年月日时分（:326-334），时柱随之变。
- **参数使用链**（Python 侧）：`service.py::_bazi_params`（`h/src/horosa_skill/service.py:10908-10955`）把 `date/time/zone/lon/lat/gpsLat/gpsLon/gender/timeAlg/phaseType/godKeyPos/after23NewDay/lateZiHourUseNextDay/adjustJieqi/minggongMethod/fenyeVersion/cangVersion/dayunPrecision/southMonth` 灌入本地引擎 params；`timeAlg` 词表 `(0,1,3)`（:10867，2=春分定卯时上游未实现会报错 :10893-10899），缺省 0 真太阳时（:10880）。快照打印「直接时间…　真太阳时…」（`baziSnapshot.js:331`）。
- **口径标注单源**：`h/src/horosa_skill/time_basis.py:15-18` —— `0=真太阳时(经度+均时差校正) / 1=钟表时 / 3=平太阳时(仅经度校正,无均时差)`；:3-6 注明八字默认真太阳时、星盘族（astroAiSnapshot）timeAlg=1 按钟面时刻换算。
- **其他技法口径**（`h/src/horosa_skill/agent_guidance.py`）：六壬 timeAlg 0/1（:714、`service.py:853-873`）；三式合一顶层共享 timeAlg 0/1（`service.py:12190-12202`）；奇门 timeAlg 0/1（:1712-1718）；紫微页只两档 0/1（`service.py:11039`）；太乙 `timeBasis direct|trueSolar`（:10626-10654）；果老 `guolaoTrueSolarTime`（`schemas/tools.py:954`）；演禽恒钟表时 timeAlg=1（`service.py:14201-14203`）。
- **time/zone/lat/lon 归一化**：IANA 时区按盘面日期/时间折算为固定 offset（`h/src/horosa_skill/input_normalization.py:198-217`，zoneinfo；新疆 `Asia/Urumqi` ≥1949-10-01 按北京时间归并 :182-184）；lat/lon 接受 `31n13`/`121e28` 或小数 `gpsLat/gpsLon`。
- 文档命中稀疏：`docs/LESSONS.md:459`（度分换算 bug）、:3261（均时差随上游同步）；README 无「真太阳时」字面命中。

## 3. docs/INPUT_CONTRACTS.md 要点（全文 148 行）

- **通用硬规则**（:9-13）：改变结果的技法必须先确认参数，未确认返回 `agent_guidance.required`；确认后 payload 必带 `agent_confirmed_settings: true` + `clarification_notes`；用户明说「按星阙默认」可带 `defaults_accepted: true`；任何 AI 客户端应先调 `horosa_agent_guidance`（或 CLI `agent guidance`）再调技法；结果只认 `export_snapshot.export_text` / `sections` / `summary`，禁手算。
- **基础星盘字段表**（:32-42）：`date`(YYYY-MM-DD, 公历 ad=1) / `time`(HH:mm) / `zone`(±08:00 或 IANA 名，按起盘日期归一) / `lat` `31n13` / `lon` `121e28`（或 gpsLat/gpsLon）/ `hsys` 0 整宫 / `zodiacal` 0 回归 / `agent_confirmed_settings` / `clarification_notes`。
- **推运/返照/时运工具表**（:50-61）：solarreturn/lunarreturn/givenyear/solararc/profection 必带 `datetime`+`dirZone/dirLat/dirLon`；pd/pdchart 带 `pdtype/pdMethod/pdTimeKey/pdaspects`；zr 可选 `startSign/stopLevelIdx`；每行给「正确输出必须包含」的段清单。
- **起卦类**（:101-111）：geomancy/tarot 以起卦时刻派生确定性种子（tarot 可 `seed` 覆盖，牌阵默认 three、牌系 rws）；mundane 只给 `year`+`ingressTerm`（默认春分），date/time 由节气推得。同样受确认门管。
- **追问模板**（:115-125）与**输出验收标准**（:129-139）：`ok=true` 不够，要查 `export_snapshot.export_text` 非空、sections 齐全、pd 表格有真实行、`memory_show` 可读回、`report_render` 可出 JSON/DOCX/PDF。

## 4. bazi_birth / bazi_direct 输入 schema（`h/src/horosa_skill/schemas/tools.py`）

- **BaZiBirthInput**（FlexibleModel, extra=allow，:427-482）：必填 `date/time/zone/lat/lon`；可选 `gpsLat/gpsLon`(:429-431)、`godKeyPos`(:436)、`cangVersion` 'fenye'|'common'(:440)、`fenyeVersion`(:442)、`southMonth` none|chong(:444-447)、`timeAlg` 缺省 0(:448)、`byLon` 缺省 False（真值→整盘走 Java :449-450）、`after23NewDay`/`lateZiHourUseNextDay` 缺省 None=引擎默认 1(:451-454)、`phaseType` 0(:455)、`ad` 1(:456)、未广告旋钮 `minggongMethod/dayunPrecision/school/ageStyle/cnUnifiedZone`(:460-464)、`gender` 1/0/'男'/'女'/true/false，缺省=未指定（:467-470）、`response_view` 完整|'sections'|'titles'(:471-474)、`period` {liunian,liuyue,liuri,liushi}（:477）、`zodiacBoundary` lichun|lunar(:479-482)。
- **BaZiDirectInput**(BaZiBirthInput 子类，:485-493)：gender 缺省 True、`gpsLat/gpsLon`、**`adjustJieqi`** 缺省 False（true→Java）、`period`。
- **闸位三件套在基类 FlexibleModel**（:10-14）：`agent_confirmed_settings` / `defaults_accepted` / `clarification_notes`。
- MCP 扁平面核心键 `CN_CORE = (date,time,zone,lat,lon,ad,gender,timeAlg,response_view)`（`h/src/horosa_skill/surfaces/mcp_schema.py:33`，:55-65 含 GATE_KEYS :28）；注册 `ToolDefinition("bazi_birth","cn","bazi_birth","/bazi/birth",BaZiBirthInput,…)`（`registry.py:220`）→ MCP 名 `horosa_cn_bazi_birth`。
- 口令词表真值：`service.py:10862-10882`（_BAZI_OPTION_VOCAB/_BAZI_OPTION_DEFAULTS，缺省 timeAlg=0 真太阳时）。

## 5. 澄清闸实现：策略数据 + 两处强制执行点

- **策略即数据**：`h/src/horosa_skill/data/sensitive_settings.json` —— `confirmation_fields`(:4-8)、`pass_when_any_true`(:9-12)、**`failure_code: "agent_guidance.required"`**(:13)、豁免表 `exempt_tools`(:14-25：astrodata/export_*/gua_desc/gua_meiyi/knowledge_*/xuanshi/ziwei_rules/bazi_inverse)、逃生舱 `HOROSA_CLARIFY` never|granular(:26-33)、自带 self_tests(:34-120)。
- **判定函数** `validate_agent_preflight(tool_name, payload)`（`h/src/horosa_skill/agent_guidance.py:2305-2363`）：豁免/逃生舱直接放行；`agent_confirmed_settings is True` 或 `defaults_accepted is True` 放行（:2317-2325，字符串 "true"/false 都不算确认）；否则返回 ok=false + code=`agent_guidance.required` + `ask_if_missing/safe_defaults/do_not_assume/confirmation_fields/agent_recovery.prompt_to_user`。未分类工具默认也拦（policy 缺失即无 guidance 可问，但覆盖不变量要求每个工具都有策略或豁免，:71-73）。
- **强制执行点（两处）**：
  - MCP：`h/src/horosa_skill/surfaces/mcp_server.py:713-719` `_agent_preflight_error`（dispatch :1020、tool_run :1411、技法工具注册 :1467）；拦截后走 **elicitation 双轨**（:722-869：客户端声明能力→原生三选一表单「按星阙默认继续/补充设置/取消」；默认→写 `defaults_accepted=true` 重跑 :849-857，逐题作答→写 `agent_confirmed_settings=true` :858-865，绝不代答术数参数；无能力/异常→逐字节回落 `agent_guidance.required` 错误往返；`HOROSA_MCP_ELICIT=0` 关闭 :745-746）。
  - CLI：`h/src/horosa_skill/surfaces/cli.py:197`（`tool run` 前同一 `validate_agent_preflight`；shell-only 契约退出码 0/2，闸门信息在 stderr）。
- 失败码注册：`h/src/horosa_skill/errors.py:400`（`next_action: ask_user_then_confirm`）。

## 6. horosa_agent_guidance 语义与返回结构

- 输入（`schemas/tools.py:2004-2007` AgentGuidanceInput）：`tool_name`（技术名或 MCP 名，别名自动映射）、`intent`（用户意图，回显）、`include_all`（默认 false，true=全部工具策略）。MCP 工具名 `horosa_agent_guidance`（`mcp_server.py:1060-1084`）。
- 返回结构 `build_agent_guidance`（`agent_guidance.py:2409-2452`）：`{ok, schema:"horosa.skill.agent_guidance.v1", intent, global_rules[8条], default_workflow[5步], tools:{name:{tool_name, mcp_name, technical_required_fields, accepted_fields, description, input_contract, options_keys, hard_gate{enabled,pass_condition,confirmation_fields,failure_code}, agent_should[], required_context/must_have_context, ask_if_missing[], safe_defaults[], do_not_assume[], output_contract[], example_payload(预测类)}}, report_and_memory(仅 include_all), usage_help{install,workflow,boundaries}}`。
- 每个工具策略来自 `TOOL_GUIDANCE`（`agent_guidance.py:1893-1937` bazi_birth/bazi_direct：bazi_birth 追问出生数据、timeAlg/日界/晚子时、godKeyPos/minggongMethod/school、南半球 southMonth；safe_defaults timeAlg=0 真太阳时、after23NewDay=1、godKeyPos=年、minggongMethod=tongxing、byLon=False）。未知工具返回 `error.code=agent_guidance.unknown_tool` + known_tools（:2421-2428）。

## 7. COMPACT 模式：HOROSA_MCP_COMPACT=1 暴露 11 个工具

- `FACADE_TOOL_COUNT=10`、`COMPACT_SURFACE_TOOL_COUNT=11`（`h/src/horosa_skill/surfaces/mcp_server.py:213-216`）。
- **10 个恒注册门面**（`mcp.tool` name= 注册点 :1054-1274）：`horosa_dispatch`、`horosa_agent_guidance`、`horosa_memory_record_answer`、`horosa_memory_query`、`horosa_memory_show`、`horosa_report_template`、`horosa_report_render`、`horosa_hecan`、`horosa_technique_report`、`horosa_report_from_tool`。
- **第 11 个**：`horosa_tool_run`（:1448-1453）——仅当 `settings.mcp_compact` 或 HOROSA_TOOLSETS 过滤时注册（:1382-1383），是 compact 面抵达全部 110 技法的唯一通道；技法工具在该模式根本不注册。`HOROSA_TOOLSETS=none` 等价 compact（:139）。
- 配置读取：`config.py:321,358,410`（`mcp_compact=_env_bool("HOROSA_MCP_COMPACT", False)`）。默认全量面 = 10 + 110 = 120 工具（instructions :228,248）。

## 8. Windows 部署

- **serve 默认监听**：`cli.py:2502-2543` —— transport 默认 `streamable-http`；host 默认 `HOROSA_SKILL_HOST` 或 **127.0.0.1**，port 默认 `HOROSA_SKILL_PORT` 或 **8765**（`config.py:360-361,412-413`）。非回环绑定无 token 直接拒启（`cli.py:2546-2556`，`--token`/`HOROSA_MCP_TOKEN`）。
- **stdio 模式**：`uv run horosa-skill serve --transport stdio`（server.json:95-97；`_normalized_transport` 认 streamable-http|stdio|sse，`http` 是常见手误会明确报错，`cli.py`）。MCP 注册表 stdio 包参数见 `server.json:21-34`。
- **环境变量**：注册表全量在 `h/src/horosa_skill/config.py:24-102`（stable/experimental/internal 三档）。关键项：`HOROSA_RUNTIME_ROOT`（Windows 默认 `%LOCALAPPDATA%\Horosa\runtime`，`config.py:163-168`）、`HOROSA_SKILL_DATA_DIR`（Windows 默认 `%APPDATA%\HorosaSkill`，:133-138）、`HOROSA_SKILL_DB_PATH`/`HOROSA_SKILL_OUTPUT_DIR`、`HOROSA_RUNTIME_MIRROR`、`HOROSA_RUNTIME_MANIFEST_URL`、`HOROSA_SERVER_ROOT`/`HOROSA_CHART_SERVER_ROOT`、`HOROSA_LOCAL_BACKEND_PORT`(默认 9999)/`HOROSA_LOCAL_CHART_PORT`(默认 8899)（`config.py:346-347`）、`HOROSA_PORTS=auto`（备用区间 19999/18899，:265-267）、`HOROSA_MCP_COMPACT/HOROSA_MCP_ELICIT/HOROSA_MCP_TOKEN/HOROSA_TOOLSETS`、`HOROSA_JEV`(off|shadow|enforce, 缺省 off=零字节变化)。未知 `HOROSA_*` 告警忽略，`HOROSA_STRICT_CONFIG=1` 升级为报错（:109-124）。
- **安装脚本（仓库内）**：`h/scripts/scaffold_windows_runtime.py`、`h/scripts/build_runtime_release_windows.py`（darwin 种子派生 win32-x64，AGENTS.md §6/§7）、`h/scripts/runtime_templates/windows/start_horosa_local.ps1` + `stop_horosa_local.ps1`（UTF-8 BOM、CREATE_NEW_PROCESS_GROUP|CREATE_NO_WINDOW、Java 绑 127.0.0.1、PYTHONPATH 含 Horosa-Web/vendor）、`h/scripts/sync_windows_release.py`。用户侧命令：`uv run horosa-skill install`（约 730MB，断点续传，README.md:102）、`upgrade/uninstall/doctor/selfcheck`（README.md:90,149）；受限网络见 `docs/INSTALL_RESTRICTED_NETWORK.md`（镜像/离线搬运）。Windows 注意：runtime 路径必须纯 ASCII（README.md:142）、用户名带空格/中文已修（:147）、防火墙弹窗由 Java 绑 0.0.0.0 引起、升级后 `runtime restart`（:144）。

## 9. LICENSE：是 AGPL-3.0-only

- 根 `LICENSE` = GNU AFFERO GPL v3 全文（LICENSE:1-2）；`h/pyproject.toml` `license = "AGPL-3.0-only"`；`CITATION.cff` `license: "AGPL-3.0-only"`、version 0.40.1；`docs/REPO_LAYOUT.md:46` 同述。是 **AGPL-3.0-only（仅第 3 版，无 "or later"）**。例外：vendor 的 ken/神数引擎为 MIT（`vendor/README.md:21`），义务记录在 AGENTS.md §11。

## 附：关键结论速览

1. 本仓 = 编排门面（Python）+ 部分完整本地引擎（八字/紫微部分/六爻/择日等在 `horosa-core-js`），重引擎（ken 三式、Java 聚合、chart 服务）在 GitHub Releases runtime 载荷，不在仓库。
2. 八字**确实在本地引擎内做真太阳时**（经度差 + NOAA/Meeus 均时差），timeAlg 0/1/3，缺 lon 会告警退化为钟表时；星盘族反而是钟表口径（timeAlg=1）。
3. 澄清闸 = 数据表（sensitive_settings.json）+ `validate_agent_preflight` + MCP/CLI 两处强制调用；`agent_confirmed_settings/defaults_accepted` 必须为布尔 true 才过闸。
4. COMPACT=11 工具 = 10 门面 + `horosa_tool_run`。
5. serve 默认 127.0.0.1:8765（streamable-http）；stdio 用 `--transport stdio`；runtime 端口 9999/8899。
6. LICENSE = AGPL-3.0-only。
7. 局限：本克隆为浅克隆（depth=1），「main 领先 v0.40.1 多少提交」无法本地计算，需 `git fetch --unshallow` 后重算。
