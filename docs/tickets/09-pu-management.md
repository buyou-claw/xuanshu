# 09: 谱管理（创建/查看/编辑/级别，谱规范 v1）

**What to build:** 谱是用户维护得动的东西。创建谱只需打字或丢附件（MD/PDF/任意文件），AI 借 `xuanshu:create-pu` 转成谱规范 v1 固定结构（frontmatter `spec: pu/1`、`name`、`level`、`tags`、`source`、`updated_at`）；级别 `base|optional`（级别≠必填）。谱列表按级别分组、可搜索筛选、点开可见（名称+描述+细节）、可直接编辑保存。AI 优先读 summary、按需深入。

**Blocked by:** 02, 03, 07

**Status:** done（2026-10-15；验收证据见对应 issue 的关闭评论，未验证项见 `docs/design/ui-v1/待实测登记处.md` §6）

- [ ] 创建谱：打字/丢附件 → AI 转成 manifest + 分节正文 + summary，生成后展示供确认，确认后落盘
- [ ] 级别 `base|optional`：base 进底稿提炼源，optional 问事时按需追加；级别≠必填
- [ ] 谱列表按级别分组、可搜索筛选、点开可见、可直接编辑保存（人可改 summary）
- [ ] 文件契约测试绿：谱 = frontmatter+MD 目录结构，符合谱规范 v1
