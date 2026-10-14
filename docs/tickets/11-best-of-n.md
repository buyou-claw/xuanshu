# 11: 多 AI 合参（Best-of-N，首版 2 路）

**What to build:** 一个问题多路 AI 并列给答案、分歧可见、拍板在人。规格级复用星阙 Best-of-N：`/多模型` 命令 + 面板，首版 2 路（缺省经典+审慎）；N 路并行流式不带工具；judge 槽 `json_schema strict`、失败回落完成顺序第一份；采用/合并/否决；其余折叠进 `message.candidates`（`bestOf{adoptedId,ranking,judge,costUsd}`）；历史只带采用稿。可在设置里开关、斜杠或按钮触发；模型/API 复用 DSH `ctx.llm` 多 adapter 与既有凭据。

**Blocked by:** 02, 03, 10

**Status:** ready-for-agent

- [ ] `/多模型` 命令 + 面板可用；设置里可开关、斜杠/按钮触发
- [ ] 首版 2 路并列流式（不带工具），judge 结构化判定、失败回落首份；采用/合并/否决可选
- [ ] 其余候选折叠进 `message.candidates`（bestOf 记录 adoptedId/ranking/judge/costUsd），历史只带采用稿
- [ ] 模型/API 复用 DSH provider 配置与凭据，不另配密钥；Best-of-N 状态机单测绿
