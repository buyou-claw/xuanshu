# 10: 问事闭环（consult 面板 + 勾选谱 + 全套工具 + 历史回看）

**What to build:** 问事与工作区并列、不属于任何工作区，开会话即用。新 main key `consult` 面板 + `ctx.sessions.create` 带 `meta.xuanshu={kind:'consult', pus:[…], mounts:[…]}`。开会话手动勾选本次要用的谱（底座与底稿默认在场、不可关）；会话带 DSH 全套工具能力（读文件、调工具），AI 自己完成「加载谱资料」；会话落本地 JSONL 可回看、有子页面点开即读。

**Blocked by:** 07, 08, 09

**Status:** done（2026-10-15；验收证据见对应 issue 的关闭评论，未验证项见 `docs/design/ui-v1/待实测登记处.md` §6）

- [ ] consult 面板可开会话：`ctx.sessions.create` 带 xuanshu meta，会话与工作区并列、不属于任何工作区
- [ ] 勾选谱：底座与底稿默认在场不可关，其余谱按需勾选；上下文注入时 manifest 概览 + summary 优先、按需深入
- [ ] 会话带 DSH 全套工具能力，能跑一轮「读谱文件」；写操作由 DSH 审批机制兜底
- [ ] 会话本地 JSONL 存留、有子页面可查看历史会话并点开即读
