# 判据目录（`docs/design/ui-v1/criteria/`）

> 这是什么：`docs/design/ui-v1` 的**机读投影**。设计权威仍是 `docs/design/ui-v1` 的稿子本身；
> 这里只把稿子里的纪律编译成能被检查器执行的五列判据（ADR-0015 第 1 条）。

## 1. 目录布局

| 路径 | 谁写 | 作用 |
|---|---|---|
| `rules/<族>.json` | 人（判据提案批准后） | 判据的**作者面**：每条一句话、可判真假，带出处锚 |
| `criteria.json` | 投影器（`scripts/ux/project.mjs`） | 判据集**投影产物**：同一输入必须产出同一字节，`version` 是它的 sha256 |
| `freeze.json` | 人（签字那一次） | 冻结值：`version` + `criteria.json` 全文的 sha256 + 冻结时刻。巡检启动先校验它 |
| `proposals/` | AI / 任何人 | 提案区。**新判据只能先落这里**，由人批准后搬进 `rules/`（用法见 `proposals/README.md`） |

`rules/` 与 `criteria.json` 的差别只有一个方向：**`rules/` 是人写的原文，`criteria.json` 是它的确定性投影**。
不要手改 `criteria.json` —— 它自己算出的 `version` 会立刻对不上，巡检会拒绝运行（`scripts/ux/freeze.mjs`）。

## 2. 五列（缺一列即投影失败）

| 列 | 取值 | 判据 |
|---|---|---|
| `id` | `<族>-<三位数字>` | 族前缀必须与所在文件一致；**稳定且永不复用**。下架用 `tombstone: true` 标记，不删条目 |
| `statement` | 一句话 | 必须能判真假；写「要好看」这种不可判的句子等于没写 |
| `check` | `static` · `browser` · `human-only` | 机器判不了就必须显式写 `human-only`，并在 `humanReason` 写清**为什么机器判不了** |
| `evidence` | `file-line` · `computed-style` · `screenshot` · `transcript` | 报告里每条红要指得回这个位置 |
| `severity` | `blocker` · `major` · `minor` | 决定报告排序，不决定是否通过 |

附加字段：`appliesTo`（`{kind:"all"|"panel"|"parasitic"}` 或 `{kind:"ids",ids:[…]}`）、
`source`（`{file, anchor}`，锚必须真的出现在文件里，否则投影失败）。

## 3. 三条硬门槛

1. **没有检查器就不许是机器判据**：`check` 为 `static` / `browser` 的判据，必须有同 id 的检查器
   （静态采集器的 `probes`，或浏览器采集器的剧本锚）。缺了采集器直接报错，不静默跳过。
2. **`human-only` 必须写理由**：没写 `humanReason` 的投影直接失败——不允许把「没人验」伪装成「人来验」。
3. **判据不许自造规则**：每条判据的 `source.anchor` 必须能在 `docs/design/ui-v1` 里找到。
   要加新规矩，先回改设计稿（本仓纪律：**回改本稿，不就地偏离**）。

## 4. 变更权与修复通道

### 4.1 变更权

- 判据冻结后被改 → 巡检**拒绝运行**并非零退出（退出码 3，且不产出报告）：冻结值对不上 / 缺失 /
  冻结值坏了都在这一档，提示会说清**是哪一侧变了**（考卷侧 / 冻结值侧 / 缺冻结值）。
- 冻结值由 `node scripts/ux/freeze.mjs --write` 写入（`--check` 校验）；它覆盖 `criteria.json` **全文**
  （`version` + 整份文件的 sha256），所以连 `ruleFiles` 里的字节都动不了。
- AI 的写入面只有 `proposals/`。把提案搬进 `rules/` 并重新冻结，是**人的动作**（一次签字，见 ADR-0015 第 7 条）。
- 历史兑现率只在「同一版判据 + 同一批界面面」之间可比；跨版本时报告写「不可比」，不硬算。

### 4.2 修复说明：每处修复都要能被机器读

动了 `packages/xuanshu-client/**` 的提交，正文里必须带一条或几条**固定形状**的修复说明：

```text
UX-FIX: <判据 id> | <改了什么> | <证据 file:line>
```

例：

```text
UX-FIX: T-001 | 面板标题改用 token 字号档 | packages/xuanshu-client/src/client/mounts.tsx:88
```

- 一行一条、可多条（一次修多条判据就写多行）；判据 id 必须真的在 `criteria.json` 里——
  指向不存在的 id 等于「修好了空气」，同样被拦。新判据只能先落 `proposals/`，生效之后才引用得了。
- 检查：`pnpm verify:ux:fix`（等价 `node scripts/check-ux-fix-notes.mjs --since <ref>`）。
  缺省范围是 `feat/spec-003-integration..HEAD`（spec 003 的集成分支），换分支用 `--since`。
- 退出码：`0` = 都有说明；`1` = 有提交缺说明 / 说明不完整（会点名**哪个提交、哪几条判据**）；
  `2` = 工具没跑成（不是 git 仓库 / 判据集读不出来）。`2` 与 `1` 分开，是为了让值班的人知道
  「去补说明」还是「先修环境」。
- **例外**：不含 `packages/xuanshu-client/**` 改动的提交（文档票、测试票、装配票）不需要说明。
- 合并提交跳过：内容提交各自带说明；对合并提交再要一份，只会训练人写「merge」这种假说明。

### 4.3 转绿断言：修完必须由红变绿

`scripts/ux/regreen.mjs` 导出 `assertRegreened({ repoRoot, before, after })`，`before` / `after`
各是一份巡检报告（对象，或相对仓库根的报告路径）。

- 修复前被点名（`fail`）的每一条**判据 × 界面面**，在修复后都必须是 `pass`；
- 看起来「不红了」的三条路**都不算转绿**：`fail → not-collected`（没采到）、
  `fail → collection-failed`（采集炸了）、`fail → human-only`（降级给人看）；
  整条 verdict 消失同样不算——那是债从量尺下面挪走了，不是修好；
- 两份报告的判据集版本不同 → 直接拒绝：考卷换了，分母口径跟着变，谈不上「同一条判据修好了」；
- 命令面：`pnpm verify:ux:regreen -- --before <修复前>/report.json --after ux-reports/latest.json`；
  退出码 `0` = 全部转绿，`1` = 仍有判据没转绿（逐条点名），`2` = 报告读不出来 / 不是同一版判据集。

### 4.4 写入面（可机检）

| 写入面 | 谁能写 | 机检 |
|---|---|---|
| `packages/**` 源码 | AI（判据范围内的修复）+ 人 | `verify:ux:fix`（说明）+ 既有 `verify:all` |
| `criteria/proposals/**` | AI / 任何人 | 不在任何一条护栏里——提案不是生效判据 |
| `ux-reports/**`（报告 + 基线 `ux-reports/baselines/`） | 巡检 / 人手 | 被 `.gitignore` 覆盖，**不进历史**；基线进了历史 → `verify:ux:authority` 红 |
| `criteria.json`、`rules/**`、`freeze.json` | 只由人签字那一次 | `verify:ux:authority`：改动必须与 `freeze.json` 同现，且签字算得通 |

`pnpm verify:ux:authority`（等价 `node scripts/check-ux-authority.mjs --since <ref>`）的判据：

1. 改了判据生效区（`criteria.json` / `rules/**` / `freeze.json`）却没有**同一个提交**里的
   `freeze.json` → 红，并给出两条路：「要么改回去，要么重新签字」；
2. 同现了签字也要**算得通**：在该提交的快照上跑 `scripts/ux/freeze.mjs` 的 `guardCriteria`
   （重算 `version` + 整份 `criteria.json` 的 sha256），对不上 → 红并抄出守卫的诊断；
3. `rules/**` 改了却没重投影 `criteria.json` → 红：判据变更是一整套（rules → criteria.json → freeze.json）；
4. 基线目录（`ux-reports/<…>/baseline(s)/`）出现在提交里、或已被 git 跟踪 → 红；
5. `.gitignore` 不再覆盖 `ux-reports/` → 红——忽略规则一撤，基线第二天就会出现在某个提交里，
   「刷基线自证及格」就成立了（ADR-0015 第 5 条）；
6. 工作区的 `criteria.json` 与 `freeze.json` 对不上（改了还没签字）→ 红：提交前就该看见自己越界了。

它不判断「是谁改的」：提交作者字段可以随便写，按作者名拦人只会误伤与绕过。这里拦的是**不变量**
（改生效区 ⇒ 带签字；基线 ⇒ 不进历史），不是身份。

### 4.5 为什么不进 `verify:all`

spec 003 的 Out of Scope 写着「巡检不进 `verify:all` 的门：升级成门需另立 ADR」（ADR-0015 第 8 条）。
这三条检查因此挂在 `verify:ux:fix` / `verify:ux:authority` / `verify:ux:regreen` 上，由修复流程**显式调用**；
`verify:all` 保持原样，只保证它不被这一票弄坏。
