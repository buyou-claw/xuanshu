# 07: 首页替换 = 自我总览四卡

**What to build:** 打开玄枢第一屏就是「自我总览」而非工作区列表。用纯插件槽位实现（ADR-0002）：注册新 main key `overview` + `sidebar.panellist` 首行并设为默认面板，显式 priority 遮蔽不报错，DSH 原 `conversation` 面板保留（问事/工作区共用会话 UI）。四卡 = 命盘卡（只读）、日课卡、底稿卡、快捷入口（问事/工作区/工作流）。此票交付四卡结构与三个快捷入口（命盘卡此时可空态，点亮由 08 完成）。

**Blocked by:** 01, 02, 03

**Status:** done（2026-10-15；验收证据见对应 issue 的关闭评论，未验证项见 `docs/design/ui-v1/待实测登记处.md` §6）

- [ ] 首屏 = 自我总览：overview main key + sidebar.panellist 首行 + 默认面板，priority 遮蔽不报错，conversation 面板仍可用
- [ ] 四卡渲染：命盘卡（只读）、日课卡、底稿卡、快捷入口（问事/工作区/工作流）——结构照设计稿 02、素材用 03
- [ ] UI 槽位契约测试绿：面板注册进 main key、四卡渲染、槽位遮蔽不 fail-loud
- [ ] 工作区/项目保持 DSH 原样，软件开发能力不打折
