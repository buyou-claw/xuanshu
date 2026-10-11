# 真太阳时调查：horosa-skill 与星阙桌面端的责任边界

> 调查日期：2026-05（以 main 分支为准）。目标：回答「玄枢八字录入『含出生地、支持真太阳时』的责任落在哪一层」。
> 方法：GitHub MCP API 直读 raw 仓库（一手源码）；server.json 经 API 返回嵌入式资源不可直读时，改用 raw.githubusercontent.com 兜底（已注明）。

## 结论（TL;DR）

1. **horosa-skill 内部已做真太阳时修正**：八字工具（`bazi_birth`/`bazi_direct`）有 `timeAlg` 参数，缺省 `0` = 真太阳时（经度时差 + NOAA/Meeus 均时差），由 vendored 本地引擎 `baziLunarLocal.js` 在内部换算，Java `/bazi/birth|direct` 回退路径同口径。**不是桌面端专属、skill 不支持。**
2. **`time` 参数语义**：传入的是时区本地钟表时间（IANA 名会在进入 runtime 前按起盘日期归一为固定 offset）。真太阳时换算由引擎内部按 `timeAlg` 完成，**调用方不应预修正**，否则会双重修正。
3. **桌面端参考了什么**：录入层收集「出生地 → 经纬度 + 钟表时间 + timeAlg 开关（0 真太阳时/1 直接/3 平太阳）+ 23点换日/晚子时开关」，换算在服务端 `BaZi` 模型 / 本地引擎内完成，录入层不做换算。
4. **玄枢责任落点**：录入层 = 出生地 → `lon/lat`（建议同时给 `gpsLon/gpsLat`）+ 可选透传 `timeAlg`；换算 = horosa 引擎内部（已支持）。玄枢**不应**在录入层自行做真太阳时换算。当前产品文档「冷启动复用星阙桌面端八字输入方式（含出生地以支持真太阳时）」方向正确，但需补一句「换算由 horosa 引擎按 timeAlg=0（真太阳时）内部完成」；skill 侧 README/INPUT_CONTRACTS 未写 timeAlg 属文档缺口（payloads.md 与源码均有），可向上游提 PR。

---

## 1. horosa-skill 内部：真太阳时已实现

仓库：`Horace-Maxwell/horosa-skill`（main）

### 1.1 本地八字引擎（主路径）— 逐行证据

`horosa-skill/horosa-core-js/src/vendor/bazi/baziLunarLocal.js`
（GitHub: https://github.com/Horace-Maxwell/horosa-skill/blob/main/horosa-skill/horosa-core-js/src/vendor/bazi/baziLunarLocal.js）

- **L271-295 `equationOfTime(utcMs)`**：均时差按 NOAA/Meeus 高精度级数（太阳平黄经/平近点角/偏心率/黄赤交角），注释：「误差 <15s, 1800-2200」，返回分钟。
- **L297-326 `applyApparentSolarTime(parts, params)`**：
  - L298 注释：「timeAlg=0 真太阳时（经度差 + 均时差 EoT）；timeAlg=3 平太阳时（仅经度差，去 EoT）；其余不调整」。
  - L305-314：`lon` 缺失回退 `gpsLon`；两者都缺 → console 告警「真太阳时档缺经度：校正跳过，退化为钟表口径」。
  - L316-326：`wall`（钟表时刻，按 zone 解析）→ 求 UTC 供 EoT → `ltcSeconds = (lon − zoneHours×15)×4×60`（经度时差）→ `adjusted = wall + ltc + eot`。
- **L1135**：核心缓存键 `['date','time','zone','ad','lon','lat','gpsLon','gpsLat','timeAlg','after23NewDay','gender','southMonth']`。
- **L1154**：主路径 `const apparentParts = applyApparentSolarTime(rawParts, params)` — 真太阳时档必经。
- **L1259-1260**：结果同时暴露 `clockTime`（直接时间）与 `solarTime`（真太阳时），「Mirrors the Java backend (BaZi.java)」。

### 1.2 MCP 层（Python 服务）— 参数与缺省

`horosa-skill/src/horosa_skill/service.py`
（GitHub: https://github.com/Horace-Maxwell/horosa-skill/blob/main/horosa-skill/src/horosa_skill/service.py）

- **L10862-10882**：`_BAZI_OPTION_VOCAB` 含 `"timeAlg": (0, 1, 3)`；`_BAZI_OPTION_DEFAULTS` 含 `"timeAlg": 0`。
- **L10893-10899**：非法 timeAlg 报 `ToolValidationError`，提示「0=真太阳时 1=直接时间 3=平太阳时（2 春分定卯时上游尚未实现）」。
- **L10933**：`_bazi_params` 把 `timeAlg` 下发进 params（本地 JS 引擎与 Java 回退同源同参）。
- **L10957-10974**：`_run_bazi_tool` → 本地 `bazi_local`（JS）优先，失败回退 Java `/bazi/birth` 或 `/bazi/direct`；L11826-12047 等多处注释「🔴 timeAlg 必须转发：真太阳时会改时支（经度差 >7.5° 即可跨支）」。

### 1.3 MCP 输入 schema — 已声明（但无长描述）

`horosa-skill/src/horosa_skill/schemas/tools.py`
（GitHub: https://github.com/Horace-Maxwell/horosa-skill/blob/main/horosa-skill/src/horosa_skill/schemas/tools.py）

- **L427-448**：`class BaZiBirthInput`：`date/time/zone/lat/lon/gpsLat/gpsLon/…`，**L448 `timeAlg: int | None = 0`**。
- **L485-493**：`BaZiDirectInput(BaZiBirthInput)` 继承同 schema。
- 其他技法 schema 亦有 `timeAlg`（L377 带描述「0=真太阳时（默认）1=直接时间」；L910-913、L971-1001、L1913-1914 等）。

### 1.4 文档情况（矛盾点的来源）

- `docs/INPUT_CONTRACTS.md`：**确实无**「真太阳时/timeAlg」——该文档只覆盖西洋星盘/推运/卜筮类输入契约，未列八字工具字段（文档缺口，parent 核查属实）。
- 根 `README.md` L319 列了 `bazi_birth/bazi_direct/bazi_inverse` 工具名，但未提 timeAlg。
- 但 **`skills/horosa-agent/references/payloads.md` L48-51** 明确：「For 八字 / 紫微 / 奇门 / 太乙 / 农历 the `timeAlg` default is `0` = 真太阳时 (longitude + equation-of-time correction, 星阙 default); `1` = 直接时间 (clock face). Per-tool defaults are listed in `horosa_agent_guidance(tool_name=…)` → `safe_defaults`」。
- `src/horosa_skill/time_basis.py` L3-4、L14-19：`TIME_ALG_LABEL = {"0": "真太阳时(经度+均时差校正)", "1": "钟表时…", "3": "平太阳时(仅经度校正,无均时差)"}`，注释「八字默认真太阳时（经度+均时差校正）」；该文件自述「逐字移植上游 `astrostudyui/src/utils/timeBasisLine.js`」。

### 1.5 Q2：`time` 语义

- 输入是**时区本地钟表时间**：`docs/INPUT_CONTRACTS.md` 基础星盘类表 + `payloads.md`「Timezone」条目：`zone` 接受 `+08:00` 或 IANA 名（按起盘日期做 DST 校正归一为固定 offset）。
- 真太阳时由引擎内部完成（1.1 的 wall→UTC→EoT 流程），调用方**只传钟表时间，不预修正**；显式 `timeAlg=1` 才走钟表口径。

---

## 2. 星阙桌面端（AGPL）：参考对象实际行为

仓库：`Horace-Maxwell/Horosa-Web-App-comprehensively-improved-MacOS`（main）

### 2.1 录入层（UI）

`Horosa-Web/astrostudyui/src/components/cntradition/BaZi.js`
（GitHub: https://github.com/Horace-Maxwell/Horosa-Web-App-comprehensively-improved-MacOS/blob/main/Horosa-Web/astrostudyui/src/components/cntradition/BaZi.js）

- **L1010-1037 `genParams(fields)`**：`date/time/ad/zone/lon/lat/gpsLat/gpsLon/gender/timeAlg/phaseType/godKeyPos/after23NewDay/lateZiHourUseNextDay/adjustJieqi/minggongMethod/…`。
  - 出生地 → `lon/lat`（经纬度）+ 可选的十进制 `gpsLat/gpsLon`；无「真太阳时时间」字段——录入的是钟表时间。
- L288-289、L371-387：页面把「时间算法」与「直接时间 / 真太阳时」作为**展示**（`buildTimeBasisLine`），换算不在 UI。
- L716-755（service.py L10855 引注）：页面主路径也是本地 `buildLocalBaziResult`（同一 `baziLunarLocal` 引擎），Java 仅兜底。

### 2.2 服务端（Java astrostudysrv）

- `BaZiBirthController.java`（/bazi/birth）与 `PaiBaZiController.java`（/bazi/direct）：
  - L95-96 / L85-86：`int timealg = TransData.getValueAsInt("timeAlg", 0)` → `TimeZiAlg.fromCode(timealg).calcBasis()`。**缺省 0 = 真太阳时**。
  - L46/49：`new BaZi(ad, dtstr, zone, lon, lat, timealg, …)` —— 控制器只透传钟表时间+经纬度+timeAlg，不做换算。
  - 路径：`Horosa-Web/astrostudysrv/astrostudycn/src/main/java/spacex/astrostudycn/controller/BaZiBirthController.java`、`…/PaiBaZiController.java`
- `TimeZiAlg.java`（`…/constants/TimeZiAlg.java`）：`RealSun(0) / DirectTime(1) / SpringMao(2) / LocalMao(3)`；`calcBasis()` 把 2 归一为 DirectTime；`fromCode` 未知值回 RealSun。
- `model/BaZi.java`（`…/model/BaZi.java`）L199-226：
  - L200 `realSunOffsetSeconds = RealSunTimeOffset.getOffsetByDate(oldBirth, zone, lon)`（timeAlg=RealSun）；
  - L213 `getMeanSolarOffset(zone, lon)`（平太阳时=仅经度时差）；
  - L174 注释：值 3 统一为「平太阳时」（仅经度时差），「与前端本地引擎 baziLunarLocal timeAlg=3 同口径」。
- `RealSunTimeOffset.java`（`Horosa-Web/astrostudysrv/astrostudy/src/main/java/spacex/astrostudy/model/RealSunTimeOffset.java`）L16-74：
  - `equationOfTimeMinutes(jd)`：与 JS 同式的 NOAA/Meeus 级数；
  - L54-59 `getMeanSolarOffset`：(gpsLon − 时区基准经度)×240 秒/度；
  - L61-66 `getOffset` = 经度时差 + 均时差；
  - 头注释 [Q-195/T-121]：「与前端本地引擎 baziLunarLocal.equationOfTime **同式同值**」，旧查表法已废止。
- 参考模块 `modules/reference/xuan-utils-pro-master/…/TrueSolarDateUtil.java` 与 `Horosa-Web/astropy/astrostudy/jieqi/realsuntime.py` 亦含真太阳时实现（六壬/紫微时柱权威为 swiss，见 baziLunarLocal.js L275-276 注释），但八字主路径用上述 Java `RealSunTimeOffset` + 本地 JS 引擎。

### 2.3 「参考星阙输入方式」的准确含义

星阙桌面端的八字录入 = **出生地（→经纬度）+ 钟表时间 + 时区 + 时间算法开关**（timeAlg 0/1/3，缺省真太阳时）+ 23点换日/晚子时开关；真太阳时换算由后端模型/本地引擎完成。即：玄枢要复用的是「录入字段形态与口径开关」，而不是「在录入层换算真太阳时」。

---

## 3. 玄枢责任落点（最终）

| 层 | 责任 | 依据 |
|---|---|---|
| 玄枢录入层 | 收集出生地并转 `lon/lat`（建议附 `gpsLon/gpsLat`）；钟表时间 + `zone`；可选透传 `timeAlg`（缺省省略 = 真太阳时）；**不自行做真太阳时换算** | payloads.md L48-51；tools.py L448；service.py L10880 |
| horosa-skill | 引擎内部按 `timeAlg`（八字缺省 0）做经度+均时差修正；本地 JS 主路径 + Java 回退同口径 | baziLunarLocal.js L278-326；BaZi.java L199-226；RealSunTimeOffset.java |
| 桌面端专属 | 无——skill 已复刻桌面端同源引擎与口径（baziLunarLocal 为页面同文件抽取） | baziLocal.js 头注、service.py L10855-10861 |

**注意点**：若玄枢调用时不传 `lon/lat`（或 `gpsLon/gpsLat`），引擎在 timeAlg=0 下会静默退化为钟表口径（baziLunarLocal.js L309-314）——因此「含出生地」字段在录入层是**必需**的（这正是产品文档保留出生地输入的正确理由），但换算不是录入层的职责。

**文档修正建议**：产品文档「冷启动复用星阙桌面端的八字输入方式，含出生地输入以支持真太阳时」改为：「复用星阙八字录入形态（出生地→经纬度 + 钟表时间 + 时间算法开关）；真太阳时（经度+均时差）由 horosa 引擎按 timeAlg=0 缺省内部换算，录入层不做换算」。同时可向上游 horosa-skill 提 PR，把 timeAlg/真太阳时补进 `docs/INPUT_CONTRACTS.md` 与 README 工具说明。

## 证据索引

- horosa-skill 仓库：https://github.com/Horace-Maxwell/horosa-skill
  - `horosa-skill/horosa-core-js/src/vendor/bazi/baziLunarLocal.js`（L271-326、L1135、L1154、L1259-1260）
  - `horosa-skill/src/horosa_skill/service.py`（L10862-10974）
  - `horosa-skill/src/horosa_skill/schemas/tools.py`（L427-493）
  - `horosa-skill/src/horosa_skill/time_basis.py`（全文 69 行）
  - `skills/horosa-agent/references/payloads.md`（L48-51）
  - `docs/INPUT_CONTRACTS.md`（无 timeAlg——文档缺口）
- 桌面端仓库：https://github.com/Horace-Maxwell/Horosa-Web-App-comprehensively-improved-MacOS
  - `Horosa-Web/astrostudyui/src/components/cntradition/BaZi.js`（L1010-1037）
  - `…/astrostudycn/src/main/java/spacex/astrostudycn/controller/BaZiBirthController.java`（L95-96）
  - `…/PaiBaZiController.java`（L85-86）
  - `…/constants/TimeZiAlg.java`（全文）
  - `…/model/BaZi.java`（L174、L199-226）
  - `…/astrostudy/src/main/java/spacex/astrostudy/model/RealSunTimeOffset.java`（L16-74）
