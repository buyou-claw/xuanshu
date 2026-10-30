# 判据提案区（`proposals/`）

> 这是什么：**判据的待审区**。AI（和任何人）想加、改、下架一条判据，只能先落这里。
> 这个目录**不在投影器的读取面内**：`rules/` 才是生效区，`proposals/` 里的东西不参与判定，
> 也不会进 `criteria.json`。

## 1. 为什么分成两个目录

「AI 不能改考卷」如果只写在文档里，它就是一条纪律；写成两个物理目录，它才是一个事实：

| 目录 | 谁写 | 进不进投影 | 改它会发生什么 |
|---|---|---|---|
| `rules/<族>.json` | 人（批准提案后） | 进 | 重投影 → 判据集 `version` 变 → 冻结值对不上 → 巡检**拒绝运行** |
| `proposals/*.json` | AI / 任何人 | **不进** | 什么都不发生：`version` 不变，冻结值照样对得上，巡检照跑 |

所以：AI 的判据写入面只有这里。越过这里直接动 `rules/`，下一次巡检就是退出码 3，
提示会写「判据已变更，需人确认」并指出是哪一侧变了（见 `../README.md` §4）。

## 2. 一条提案长什么样

文件名：`proposals/<族>-<三位数字>-<短题>.json`（例：`T-004-title-uses-token-scale.json`）。
内容：五列判据包在 `criterion` 里，外面写清是谁提的、为什么提。

```json
{
  "status": "proposed",
  "proposedBy": "ai",
  "proposedAt": "2026-10-31",
  "reason": "面板标题用了字面字号，token 字典里已有对应档位 —— 这条能机器判，但现有判据没盖住。",
  "criterion": {
    "id": "T-004",
    "statement": "面板标题的字号必须来自 token 字典的 6 档之一，不出现字面 px",
    "check": "static",
    "evidence": "file-line",
    "severity": "major",
    "appliesTo": { "kind": "panel" },
    "source": {
      "file": "docs/design/ui-v1/shared/设计token字典.md",
      "anchor": "### 0.4 禁则"
    }
  }
}
```

`criterion` 的字段口径与 `rules/` 完全一致（五列 + `appliesTo` + `source`，见 `../README.md` §2）。
`source.anchor` 必须能在 `docs/design/ui-v1` 里找到——**提案也不许自造规则**；
要立新规矩，先把设计稿改了（本仓纪律：回改本稿，不就地偏离）。

`status` 取 `proposed` / `rejected` 两值：`rejected` 的提案留在原地（连同原判据），
不删——「这条被否过」本身是信息，删了下次还会有人重提。

## 3. 批准链路（人是唯一能走完的人）

1. AI 写一条 `proposals/<…>.json` 并说明理由（提交信息里带上判据 id → 改动 → 证据）。
2. **人**判断要不要这条 → 要，就把 `criterion` 里的五列搬进 `rules/<族>.json`：
   - 新增用新 id（id 稳定且永不复用）；下架不删条目，改 `tombstone: true`；
   - 机器判的要有同 id 的检查器（`scripts/ux/probes/<族>.mjs` 或浏览器剧本锚），否则投影直接报错。
3. **人**跑 `node scripts/ux/project.mjs --write` 重投影 → `criteria.json` 变、`version` 变。
4. **人**跑 `node scripts/ux/freeze.mjs --write` 重新签字 → `freeze.json` 记下新的 `version`。
5. 提案文件改成 `status: "rejected"` 或留在原地；**不要搬走**——提案区是审计线索，不是临时目录。

第 3、4 步两跑之间，巡检会拒绝运行。这是设计：**「改判据」和「为新判据背书」必须分开发生**，
而背书那一击只有人能按（ADR-0015 第 6、7 条）。

## 4. 自动化通道能做什么、不能做什么

- 能：读判据（`criteria.json`）、写报告目录（`ux-reports/`）、修判据范围内的源码、往 `proposals/` 写提案。
- 不能：写 `rules/`、写 `criteria.json`、写 `freeze.json`、改 `docs/design/ui-v1` 的设计稿。
- `pnpm verify:ux` 与巡检都**只读**判据：跑一轮不会改动判据目录里的任何字节。
