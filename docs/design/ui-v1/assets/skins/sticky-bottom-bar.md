# 窄屏吸底操作条皮肤（sticky-bottom-bar）

> 台账：asset.S3-12 ｜ 类型：texture（组件皮肤）｜ 屏：S3《八字冷启动向导》§2.5 窄屏说明③、§6 窄屏态行
> 用途：窄屏吸底操作条（主按钮 + 返回）；容器皮肤。
> 取值纪律：本规格只引用 token 名；一切取值以 `tokens/xs-tokens.css` 为权威，本文件不含字面值、不含代码。

## 结构拆解（对应 S3 §2.5 窄屏线框与 §6 窄屏态）

1. **吸底容器** —— 固定在面板底部的操作条；仅窄屏（宽 < `--xs-size-breakpoint-wide`）出现，宽屏操作在表单流内、不设吸底条。
2. **主按钮位** —— `[确认并出盘]`（或当前步主行动），吸底、按主按钮皮肤渲染（skins/primary-button.md）；禁用时形态见 skins/cast-button-disabled.md。
3. **返回位** —— `[<- 上一步]` 靠右（S3 §2.5 窄屏说明③）。
4. **顶部分隔** —— 吸底条与正文之间一条发丝分隔，正文滚到条后不遮字（条高计入正文底部留白）。

## 逐部位 token 引用

| 部位 | token | 语义 |
|---|---|---|
| 吸底容器底 | `--xs-surface-panel` | 面板容器底（与面板底一致，吸底条不浮起、不做成卡片） |
| 顶部分隔 | `--xs-edge-divider` | 区块分隔线（发丝） |
| 主按钮 | 见 skins/primary-button.md | 全稿唯一主按钮皮肤 |
| 返回按钮 | `--xs-text-link` | 可跳转文字（回上一步） |
| 容器上下内距 | `--xs-space-card-pad` | 卡内边距（借语义：容器内边距档） |
| 主按钮↔返回间距 | `--xs-space-toolbar` | 一排控件之间的水平距离 |
| 按钮焦点环 | `--xs-edge-focus` | 焦点环 |

## 状态

| 状态 | 呈现 |
|---|---|
| `ready`（常态） | 主按钮可点 + 返回可点 |
| `disabled`（缺经纬度 / 未勾选核对） | 主按钮置灰（skins/cast-button-disabled.md）；理由行在正文区（不进吸底条，吸底条只放动作） |
| 出盘 `loading` | 主按钮转进行中文案（`--xs-state-running-fg` 指示位），返回仍可点（中断语义由 S3 §6 中断态承载） |
| 宽屏 | **不出现**（宽 ≥ `--xs-size-breakpoint-wide` 时操作在表单流内） |

## 尺寸语义

- 出现条件：宽 < `--xs-size-breakpoint-wide`（宽 / 窄屏分界，语义由屏稿 README §3.1 定，本规格只引用 token 名）。
- 条高 = `--xs-size-control-height` + 上下 `--xs-space-card-pad`；正文底部留白 ≥ 条高（不遮最后一行）。
- 主按钮在条内全宽或主宽，返回按钮按内容宽靠右。

## 备注

- 吸底条只承载动作，不塞说明文字；禁用理由、状态位都留在正文（skins/birth-confirm-table.md / cast-button-disabled.md）。
- S2 抽屉窄屏的 `[重新录制出生信息]` 吸底（S2 §6 窄屏态）复用本皮肤结构，容器换抽屉语境（`--xs-surface-overlay` 底）。
