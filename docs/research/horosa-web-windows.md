# 星阙桌面端（Horosa Windows）上游源码侦察报告

- 侦察对象：`E:\ai_project\XuanShu\.upstream\horosa-web-app-windows`
- Git HEAD：`f21b451b752ec5926ffe869216045963c12f4322`，工作树干净；README 声明最新 tag **v3.11.3**
- 侦察方式：只读 read/grep/glob（忽略 .git、node_modules）
- 路径缩写约定：
  - `REPO` = `.upstream/horosa-web-app-windows`
  - `SRC` = `REPO/local/workspace/Horosa-Web-55c75c5b088252fbd718afeffa6d5bcb59254a0c/astrostudyui`
  - `JAVA` = `REPO/local/workspace/Horosa-Web-55c75c5b088252fbd718afeffa6d5bcb59254a0c/astrostudysrv`
  - `PY` = `REPO/local/workspace/Horosa-Web-55c75c5b088252fbd718afeffa6d5bcb59254a0c/astropy`

---

## 1. 仓库结构与技术栈确认

### 1.1 交付仓结构（REPO 根）

- `README.md` / `README_ZH.md` / `README_EN.md`、`LICENSE`、`docs/legal/*`（多语言法律文档）
- `local/workspace/Horosa-Web-55c75c5b088252fbd718afeffa6d5bcb59254a0c/`：完整产品源码
  - `astrostudyui`（前端 UI）
  - `astrostudysrv`（Java 后端，多模块）
  - `astropy`（Python 星历/计算服务）
  - `flatlib-ctrad2`（改写版 flatlib 星历库）
  - `vendor`（vendored 传统术数计算引擎）、`scripts`
- 桌面打包工程（Electron + NSIS）**私有维护、不在本仓库**（`README.md:276`）

### 1.2 UI 技术栈

- **React 17.x + UMI 3**（`umi ^3.5.41`）+ Ant Design（`@ant-design/pro-layout`）；license 字段 **AGPL-3.0-only**（`SRC/package.json:5,63,68`）
- 关键依赖：`lunar-javascript`（农历）、`astronomy-engine`、`d3`（星盘 SVG）、`echarts`、`three`、`babylonjs`（三维/天文馆）、`tz-lookup`（时区反查）（`SRC/package.json:32-70`）
- UMI 配置：dva(immer:false) + antd + dynamicImport + hash，标题「星阙 - 玄学与星座云平台」，构建脚本含 preload 注入 / chunk 去重哨兵（`SRC/.umirc.js:3-12`、`SRC/package.json:14-17`）
- 语言：TS/JS 混用（`.umirc.js` 为 JS；大量业务组件为 JS class 组件）

### 1.3 Java 后端（astrostudysrv）

- Spring Boot **2.7.6**、Java 17、多模块 Maven，groupId `spacex`（`JAVA/astrostudyboot/pom.xml:15-19`）
- 模块：`astrostudyboot`（启动器）、`astrostudy`（西占/swiss 核心，含 `model/RealSunTimeOffset.java`）、`astrostudycn`（中国术数：八字/六壬/节气，含 `model/BaZi.java`、`controller/ChartController.java`）、`astrodeeplearn`（AI 相关）、`astroreader`、`astroesp`、`astroswisseph`、`basecomm`、`boundless`、`image/iot/media/medialib`（媒体/设备类）
- 端口 `:9999`；前端请求体 RSA 加密（`README.md:97-100`）

### 1.4 Python 星历服务（astropy）

- Python 3.11，封装 `pyswisseph`（Swiss Ephemeris）+ 改写版 flatlib + vendored 术数引擎；**CherryPy REST，端口 `:8899`**（`README.md:98`、`PY/websrv/helper.py:2`）
- 包结构：`astrostudy`（计算核心）+ `websrv`（REST 层，webchartsrv/webindiasrv/webgeomancysrv 等 30+ 服务文件）+ `tests`（`PY/README.md`）
- 架构（`PY/README.md`，GBK 原文）：前端(client) → Java 服务端 → Python web 服务端；**Java 不做具体星盘计算，负责缓存 Python 计算结果与用户/账户业务逻辑**，重计算转发 Python

### 1.5 LICENSE

- 确认为 **AGPL-3.0-only**：`REPO/LICENSE:1`（GNU AFFERO GENERAL PUBLIC LICENSE Version 3）；README 亦声明「许可：AGPL-3.0-only」（`REPO/README.md:51`）

---

## 2. 真太阳时

### 2.1 计算口径（三层都实现，公式同源）

**时间算法 timeAlg 四档**（全仓统一枚举）：`0=真太阳时（经度差+均时差）`、`1=直接时间（钟表时）`、`2=春分定卯时（未实现，等同直接时间）`、`3=平太阳时（仅经度差，去均时差）`
- 标签单源：`SRC/utils/timeBasisLine.js:5`；八字下拉：`SRC/components/cntradition/CnTraditionInput.js:524-530`
- 均时差（EoT）采用 **NOAA/Meeus 高精度级数**（太阳平黄经/平近点角/偏心率/黄赤交角），误差 <15s（1800–2200）：

**前端 JS（八字页主路径）**：
- `SRC/utils/baziLunarLocal.js:271-295` `equationOfTime(utcMs)`（NOAA/Meeus 级数，度→分钟）
- `SRC/utils/baziLunarLocal.js:297-334` `applyApparentSolarTime`：timeAlg=0 时 `经度时差(秒) = (lon − zoneHours×15) × 4×60`，再加 EoT；timeAlg=3 只加经度时差；**缺经度（lon/gpsLon 均无）→ 校正跳过，静默退化为钟表口径**（`:309-315`）

**Java 后端**：
- `JAVA/astrostudy/src/main/java/spacex/astrostudy/model/RealSunTimeOffset.java:19` `equationOfTimeMinutes(jd)`——NOAA/Meeus 同式，注释明确「与前端本地引擎 baziLunarLocal.equationOfTime **同式同值**」（`:11-12`）；`:37` 时区→基准经度（含 +05:30 分钟区）；`:61-64` 真太阳时偏移=经度时差+均时差
- `JAVA/astrostudycn/src/main/java/spacex/astrostudycn/model/BaZi.java:199-212` 按 timeAlg 换算出生时刻，`nongli.birth/solarTime` 恒写真太阳时
- `ChartController.java:96-97` `/chart` 新键 `nongliTimeAlg`（0 真太阳时/1 直接/3 平太阳），**缺省 0 = 真太阳时零回归**
- `LiuRengController.java:93-94` 六壬缺省 RealSun（真太阳时）

**权威口径**：`baziLunarLocal.js:275-276` 注释明言——后端六壬/紫微时柱的 timeOffset 来自 **Python jieqiinfo（swiss 星历）**，「权威=swiss」；前端与 Java 的同式实现为对齐 swiss 而引入（旧 366 行查表法因跨年漂移被弃，`RealSunTimeOffset.java:9-17`）。

### 2.2 八字出生信息录入如何处理真太阳时

- **用户填什么**：填**出生地当地时间（钟表时刻）**+ 出生地（见 §3 地点录入）+ 时区（自动推断或手改）；另选「时间算法」档（默认真太阳时，`CnTraditionInput.js:526` 首位为真太阳时；出厂默认 0 见 `BaziZeriMain.js:78`）
- **换算发生在哪层**：
  - **八字页：前端本地引擎为主**。`BaZi.js:775-814 fetchBaziCached`：先 `buildLocalBaziResult(params)`（本地，含真太阳时校正），抛错才回退 Java `/bazi/birth`（`BAZI_CORE_ENDPOINT`，`:795`）；`fetchBaziDirectCached:817-856` 同构（`/bazi/direct`）。注释「本地引擎优先；公元前/域外年份回退 Java」（`:816`）
  - **六壬/金口诀/占卦等**：走 Java `/chart`、`/liureng/gods` 等，由 Java（`RealSunTimeOffset`）+ Python（swiss）计算，前端只显示 `nongli.birth`（真太阳时字串）
  - **Python**：不参与八字页四柱，负责西占/星历与 swiss 级 EoT（供 Java 某些路径的权威值）
- **显示**：无论选哪档，盘面同时显示「直接时间」与「真太阳时」两行，随基准变的只是定四柱的时刻（`PaiBaZi.js:149-154`、`BaZiLegacyView.js:455-469`、`BaziHelpDoc.js:375-376`）
- 帮助文档要点：经度用于真太阳时/平太阳时换算，**纬度不参与四柱**（`BaziHelpDoc.js:55`）；真太阳时=出生经度+当日均时差，「最贴近日影」（`:63`）；均时差成因与幅度说明（`:379-382`）；农历表按北京时间编算（`:431`）

---

## 3. 八字出生信息录入 UI（交互规格）

主组件：`SRC/components/cntradition/CnTraditionInput.js`（左栏「八字设置」，标题「时间、地点与排盘选项」`:497-502`）。结构分四区：

### 3.1 时间与地点（`CnTraditionInput.js:503-512` → `SRC/components/comp/SpaceTimePanel.js`）

- **时间**：一个触发式字段（`TimeFieldTrigger`），显示「YYYY-MM-DD HH:mm:ss 当地时间」；点开 popover 为 `PlusMinusTime` 编辑器（可加减时分、带时区选择）；下方内联 +/− 微调条（`SpaceTimePanel.js:72-87`）；支持双击键入 14 位数字回车确认重算（`:45-50`）
- **地点**：一个按钮式字段，显示 **地名（`pos`）+ 经度·纬度**（如「南京 118e47 · 32n03」），点击打开 `GeoCoordModal`（`SpaceTimePanel.js:88-102`）
- 地点弹窗：`SRC/components/amap/GeoCoordModal.js` —— 800×500 弹窗「经纬度查找」，GCJ-02↔GPS 坐标互转（`:66-87`）
- 地点选择器：`SRC/components/amap/GeoCoordSelector.js` —— 三通道（`:29-30` 头注）：
  1. **离线城市快搜**：内置小库 `data/cities.json` + 懒加载大库 `data/citiesFull.json`（约 3 万条），180ms 防抖过滤（`:60-88`）
  2. **手输经纬度**（`:45-46, 110-120`）
  3. **高德地图 AMap 选点/地名搜索**（右侧地图，联网可用；离线城市库兜底）
  - **时区**：按经纬+日期自动推算（含夏令时，`dstAwareZoneAt`），顶部实时显示；可手动覆盖（固定 UTC 偏移选项表 `:18-27`）
- 选地点后联动：自动校正时区（未手改时）→ 写 `lon/lat`（度分串）+ `gpsLon/gpsLat`（十进制）+ 地名 → 重锚时间（保留钟面时刻，`CnTraditionInput.js:428-473`）

### 3.2 起盘选项（`CnTraditionInput.js:513-628`）

- 性别：未知(按男排)/女/男（`:515-521`）
- 时间算法：真太阳时/平太阳时/直接时间/春分定卯时（未实现，disabled）（`:524-530`）
- 长生：火土同(阴阳同序)/水土同(阴阳同序)/阳顺阴逆（`:536-542`）
- 神煞查法：按年柱/按日柱/年日都查（`:546-550`）
- 晚子时四态（语义单选、写两个开关）：子初换日(23点换日)/子初换日·时干今日/夜子时(日守今·时干次日)/子正换日(24点换日·时干今日)（`:553-574`，映射见 `:376-402`）
- 命宫起法：通行版/子平数法（`:587-591`）；月律分野：通行版/法诀版（`:593-597`）
- 南半球月令：不对冲/对冲（`:600-605`）；起运精度：精确/整数（`:607-611`）
- 藏干版本：通行版/分野加权（`:613-618`）；生肖归属：立春/正月初一（`:620-626`）
- （节气微调「按纬度调整」已隐藏——本地引擎未实现，Java 有实现，`注释 :575-584`）

### 3.3 断命流派（`:629-644`）

主用流派 8 档：传统综合/扶抑/格局/调候/病药/通关/盲派/纳音古法。

### 3.4 显示（`:645-719`）

刑冲破害显隐、神煞显隐、流派标记、小运、年龄（虚岁/周岁）、界面样式（新星阙UI/旧星阙UI）、只显示地支藏干十神、神煞分组四组开关（吉神/凶煞/月令系/日柱系）。

### 3.5 录入流程

改任一字段 → `onFieldsChange`（携带 date/time/ad/zone 全量重锚）→ `BaZi.genParams` → `fetchBaziCached`（本地引擎优先，失败回退 Java）→ 中栏排盘 + 右栏信息刷新。旧 UI 不画的开关会置灰并注明（`:477-484`）。

---

## 4. 多模型对比 Best-of-N（可照抄的交互规格）

核心四文件：纯函数 `SRC/utils/aiBestOfN.js`、页面钩子 `SRC/components/aianalysis/chat/useChatBestOf.js`、设置卡 `.../chat/BestOfPanel.js`、气泡卡片 `.../chat/BestOfCards.js`；命令注册 `SRC/utils/aiChat/commands.js`；槽位路由 `SRC/utils/aiModelRouting.js`；严格 schema `SRC/utils/aiStructuredOutput.js`。

### 4.1 触发方式

- 斜杠命令 **`/多模型`**（别名 `bestof`），分组「模型与协作」，requires=none（`commands.js:28`）；解析规则：首字符 `/` 且第二字符非 `/`，命令名到第一个空白，其余为参数原文（`commands.js:60-69`）
- 用法示例：`/多模型 今年事业如何`（`useChatBestOf.js:158`）
- 发送前弹「预估费用」确认框（无计价表时文案改「费用未知」仍要确认，`useChatAssist.js:266-268`）

### 4.2 两种模式（设置卡 BestOfPanel，存 `uiPrefs.chatAssist.bestOf`）

- **不同模型（models）**：多选 2–4 个候选（选项=所有已启用接口配置的聊天模型，`buildRouteOptions`）；候选按 `profileId::model` 去重、上限 4、不足 2 返回空（`aiBestOfN.js:18-37`）
- **同一模型多视角（angles）**：同当前模型 × 视角，**四个人格**（`ROLE_ANGLES`，`aiBestOfN.js:10-15`）：
  1. `classic` 经典派——以经典古法为准绳，先定格局再论细节，引用明确到星/宫/干支
  2. `modern` 现代派——现代心理/生活化视角，术数结论翻译成可操作建议，少用术语
  3. `cautious` 审慎派——只说有充分依据的结论，不确定标「存疑」，给置信度
  4. `concise` 精炼派——只给最重要三点，每点一句结论一句依据，≤200 字
- **缺省空 = 当前模型 × 经典/审慎两视角**（`BestOfPanel.js:28`、`useChatBestOf.js:165`）；视角注入方式：system 首条追加 `【本候选视角】directive`（`useChatBestOf.js:49`）

### 4.3 候选流式并排显示

- 一条 assistant 占位消息，`message.candidates` 数组并排渲染；`BestOfCards.js:26-41`：`grid-template-columns: repeat(min(N,2), 1fr)` 两列网格，每卡含：候选 id Tag、label（模型名/视角）、判官得分 Tag（排名第一金色）、状态（生成中/失败/N 字 · 耗时 · 估价）、「采用」按钮、正文区（pre-wrap，maxHeight 260 内滚，`:38`）
- **N 路并行流式**：各自 `requestAIAnalysisChatStream`，**不带 tools/toolChoice、不挂 response_format**（withJsonMode:false），共享一个 AbortController，每路独立合帧器写回 `candidates[i].text`（`useChatBestOf.js:1,26-70`）
- 历史消息带图片（同主线）；历史经窗口策略按候选自身模型裁剪（`:39-48`）

### 4.4 判官（judge）

- 路由：`resolveRoute('judge')`——「按任务用模型」六槽之一，槽空=跟随当前模型（`aiModelRouting.js:14,68-79`）
- Prompt：系统词带标记 `【多模型判官】`，排序判据「依据充分、自洽 > 覆盖充分 > 表达清楚」，1-10 打分（`aiBestOfN.js:86-91`）；**判官请求不带挂载数据**（`:87` 裁决注释）
- Schema：`JUDGE_SCHEMA = {best: 候选id, ranking: [id…], reasons: [{id, score(1-10 int), reason}]}`（`aiBestOfN.js:52-59`）
- **json_schema strict**：`applyResponseSchema(opts, {name:'bestof_judge', schema})` 产出 OpenAI 形 `response_format{type:'json_schema', json_schema:{name, schema, strict:true}}`；strict 归一化=每个 object 节点 `additionalProperties:false` + required 全列、剥掉不支持的校验关键字、嵌套 ≤5 层；四家协议翻译在 **Java 代理层**（`aiStructuredOutput.js:1-5,41-56`）
- 解析：`parseJudge` 容错（剥代码围栏、截 `{…}` 二次解析、非法 id 过滤、best 恒排 ranking 首位、缺席补齐），失败回 null（`aiBestOfN.js:102-116`）
- **失败回落：按完成顺序第一份**（`useChatBestOf.js:88` `{best: ok[0].id, error:'unparseable'}`；判官请求异常同回落 `:90`）；≥2 份有效才判，1 份直接采用（`:74-75`）；「停止全部」后不跑判官，取首个有文字候选（`:187-190`）

### 4.5 三个动作 + 折叠保存

- **采用**（adopt）：`content = 候选 text`，`bestOf.adoptedId = id`，streamStatus→done，落库（`useChatBestOf.js:93-102`）
- **合并**（merge）：≥2 份有效候选 → `resolveRoute('final')`（终稿槽）发合并请求，系统词标记 `【多模型合并】`（总编语义：以排名靠前为主干、去重、消矛盾并注明、不新增事实，`aiBestOfN.js:93-99`）；合并稿作为 `id:'merged'` 追加进 candidates、`adoptedId='merged'`、记 `mergedBy`（`useChatBestOf.js:104-134`）
- **停止/否决**：`stop()` 直接 abort 共享控制器，不落判官（`useChatBestOf.js:152`）；另有 **rejudge**（重跑判官，`136-150`）
- **其余候选折叠保存**：采用后卡片折叠成一行 `Tag「多模型 N 份」+ 采用:X + 判官模型 + 「展开候选」`（`BestOfCards.js:15-24`）；候选全文仍保留在 `message.candidates`
- **message 结构**：`candidates: [{id:'c1'…, label, model, angle, text, status, error?, usage?, elapsedMs?, costUsd?}]`；`bestOf: {mode, question, adoptedId, ranking, judge:{model, reasons, error, skipped}, costUsd, mergedBy?, startedAt, finishedAt}`（`useChatBestOf.js:176,194-197`）
- **历史只带采用稿**：`historyContentOf` 取 content，空则取 adoptedId→ranking[0]→首个非空候选（`aiBestOfN.js:119-125`）
- 候选截断护栏：判官/合并投喂按槽模型挂载预算动态分配单份上限（1500–24000 字，缺省 6000），截断处注明原文长度（`aiBestOfN.js:61-84`、`useChatBestOf.js:77-78,115-119`）

**结论：候选流不带工具；判官与合并稿是短的非流式 chat 调用（判官带 strict json_schema）。**

---

## 5. LLM 接入配置

### 5.1 支持的 provider（12 个预设，`SRC/utils/aiAnalysisProviders.js:2-15,17-135`）

| providerType | 名称 | 协议族 | baseUrl | 默认聊天模型（节选） |
|---|---|---|---|---|
| openai | OpenAI | openai-compatible | https://api.openai.com/v1 | gpt-5.6 家族/gpt-5.5/gpt-4.1-mini |
| deepseek | DeepSeek | openai-compatible | https://api.deepseek.com | deepseek-flash/v4-flash/v4-pro/chat/reasoner |
| anthropic | Anthropic | anthropic | https://api.anthropic.com | claude-fable-5/opus-4-8/sonnet-5/haiku-4-5 |
| gemini | Gemini | gemini | …googleapis.com/v1beta | gemini-3.1-pro/3.5-flash/… |
| openrouter | OpenRouter | openai-compatible | https://openrouter.ai/api/v1 | （空，自填） |
| ollama | Ollama | ollama | http://127.0.0.1:11434/v1 | （空；默认嵌入 bge-m3/nomic-embed-text） |
| moonshot | Moonshot/Kimi | openai-compatible | https://api.moonshot.cn/v1 | kimi-k2.6/k2.5 |
| zhipu | 智谱 AI | openai-compatible | https://open.bigmodel.cn/api/paas/v4 | （空） |
| siliconflow | 硅基流动 | openai-compatible | https://api.siliconflow.cn/v1 | （空） |
| groq | Groq | openai-compatible | https://api.groq.com/openai/v1 | （空） |
| xai | xAI | openai-compatible | https://api.x.ai/v1 | （空） |
| custom | 自定义兼容接口 | openai-compatible | 空 | （空，可加额外请求头做自建网关鉴权） |

协议族翻译（anthropic/gemini/ollama 特有键：`max_tokens/maxOutputTokens/num_predict`、`stop_sequences`、思考档键等）在 `aiAnalysisProviders.js` 内统一施加（`:399-401,210-217`），**json_schema 等四家翻译在 Java 代理层**（`aiStructuredOutput.js:2`）。

### 5.2 API Key 配置在哪

- **设置页（UI）→「接口配置」面板**：`AIAnalysisMain.js:5813` `renderSettingsPane`，按钮「新增接口配置」（`:5831`）；编辑弹窗「新增/编辑接口配置」（`:6405`），字段含接口类型（12 档）、Base URL、API Key（`:6442`）、模型列表、额外请求头 JSON（`:6499`）、连通性诊断
- **存储**：IndexedDB `horosa.ai.analysis.v1`（DB_VERSION 7），store `provider_profiles`（`SRC/utils/aiAnalysisStore.js:16-17,41,48`）
- **安全**：apiKey 静态加密（`aesgcm.v1:…` 密文落库，主密钥由系统钥匙串保管；dev 无桥时明文零回归）；解密失败 → 置空 + `apiKeyDecryptFailed` 标记提示重填，密文不覆盖；额外请求头令牌同钩；**不进备份**（`aiAnalysisStore.js:508-520,563-586`、`AIAnalysisMain.js:6442` 表单 extra 文案）
- **请求通路**：前端 → Java 代理 `/aianalysis/chat`、`/aianalysis/chat/stream`（`SRC/services/aianalysis.js:256,278`），由后端转发各 provider（前端不直连第三方）
- 无配置文件（如 .env）方式；密钥只存本机浏览器 IndexedDB + 桌面桥加密

---

## 6. 挂载系统（AI 对话上下文挂载）

位置：`SRC/components/aianalysis/AIAnalysisMain.js`（主工作区）+ `.../chat/*` 状态组件。

### 6.1 什么可以被挂载

挂载目标是 **AI 聊天上下文（system prompt）**，可挂对象四类（挂载抽屉四个分区，`AIAnalysisMain.js:4683-4728`）：

1. **命盘 / 事盘案例**（顶栏「选择案例」，`:5178` 挂载按钮 / 状态条「未挂载案例·选择案例」`:4812`）
   - 案例来源：各技法页（八字/紫微等）起盘后「保存为命盘」；或抽屉内**即时起草**（时间 + 地点 + 时区 + 姓名/事由 + 性别 → 「保存为命盘/事盘」，`:4622-4677`）
2. **技法快照**（按案例类型过滤的技法多选，`:4684-4702`；「一键挂载全部式法」——排除奇门遁甲，`:4673-4675`）
   - 每技法快照 = 按当前盘面参数生成的文本快照（起盘信息/宫位/神煞…），逐技法可调「纳入内容段勾选 + 排盘起卦设置」（`openTechniqueSettings` `:4759`；`TechniqueSettingsFields.js`、`techniqueMountSettings.js`）
3. **参考组合 / 资料（多选）**：固定资料（文件上传资料库，RAG 切块/向量）与组合包（`:4704-4718`）
4. **本轮系统提示**（TextArea，可由组合带入，`:4720-4728`）

另：`@引用` 语法可在输入中直接切换/挂载源、技法、技法段过滤（`useChatAssist.js:475`）。

### 6.2 挂载到哪、UI 流程

- 挂载内容进 **AI system prompt 的稳定层**（`buildResolvedPrompt`，`:2517` 注释：挂载快照/资料/会话规则为「稳定层」，前缀缓存断点）
- **字数预算与裁剪**：按当前模型上下文窗口实算预算（大窗口模型解除 2 万字硬颈；Ollama 按 num_ctx；策略可固定预算，`:2501-2508`）；超预算 → 按层整层丢弃或段边界公平裁剪，**并在提示词中注明**（`:2548`）；最近一次裁剪账本在挂载预览逐层打 Tag（「超预算未纳入」红 /「已裁剪 raw→kept 字」橙，`:4746-4785`）
- 流程：顶栏选案例 → 技法按源类型自动过滤 → 点「挂载」开抽屉微调（技法/资料/系统提示）→ 抽屉底部「本轮挂载上下文（预览）」Collapse 逐层可见（含快照时空签名核对、旧盘残留告警，`:4729-4799`）→ 发送 → 状态栏显示 `挂载 N 字 / 预算 M 字`（点击重开抽屉，`ChatStatusBar.js:37-38`）
- 无挂载源时问具体命/事问题会被拦截并引导先挂载（`:2655-2666`）；每条用户消息落库带检查点（挂载/引用/技法/系统提示/模型），支持回退（`:2692`）

---

## 7. 版本与发布形态

- **当前版本 3.11.3**：README 徽章与「当前版本：3.11.3（运行时 `3.11.3-runtime1`）」（`REPO/README.md:14,49`）
- **Release 资产**：**NSIS 离线安装包 `Horosa-Setup-3.11.3.exe`**（`README.md:17,20,47`），未做 Authenticode 签名（SmartScreen 提示，`:53`），配 `SHA256SUMS.txt` 校验；打包工程（Electron+NSIS）私有、不在仓库（`:276`）
- UI `package.json` **无 version 字段**（private 应用，`SRC/package.json:1-4`）；Java 各模块 pom 版本 1.0.0（`astrostudyboot/pom.xml:7`）；版本号由 release tag/运行时承载
- 本地部署：`local/Horosa_Local_Windows.bat|.ps1` + 源码目录内 `start_horosa_local.sh`（Java 17/Maven/Node 18+/Python 3.11，`README.md:276`）

---

## 附：对玄枢（XuanShu）的规格复用要点速记

1. **真太阳时**：输入=出生地钟表时+经纬+时区；算法=经度时差(4min/°) + NOAA/Meeus EoT；timeAlg 0/1/3 三档可用（2 档上游自身未实现）；缺经度必须显式降级提示而非静默。三端（JS/Java/swiss）同式对齐是上游多轮修 bug 的最终形态。
2. **出生地录入**：城市快搜（离线库+防抖）+ 手输经纬 + 地图选点三通道，选点后自动推时区（含 DST）+ 手动时区覆盖，地名与坐标同步回填。可直接照抄 `GeoCoordSelector.js` 交互。
3. **Best-of-N**：可照抄的完整管线见 §4（命令 → 候选计划 → 并行无工具流 → judge 槽 strict json_schema → 回落第一完成 → adopt/merge/stop → candidates+bestOf 落库折叠）。
4. **挂载**：命盘/事盘案例 + 技法快照 + 资料/组合 + 系统提示 → system prompt 稳定层 → 按模型窗口预算分层裁剪并声明；上游「挂载」≈玄枢的「上下文组装层」，值得复用其预览+裁剪账本交互。
