# 主按钮皮肤（primary-button）

> 台账：asset.S4-6 ｜ 类型：texture（组件皮肤）｜ 屏：S4《自我总览首次空态》§3①；并供 S1 命盘卡空态、S3 `[确认并出盘]` ready 态、S2 `[重新出盘 ->]` 复用
> 用途：主按钮「开始填写出生信息」（冷启动期的主行动）；按钮皮肤。
> 取值纪律：本规格只引用 token 名；一切取值以 `tokens/xs-tokens.css` 与 DSH 主题为权威，本文件不含字面值、不含代码。

## 结构拆解（对应 S4 §3①）

1. **按钮容器** —— DSH 按钮原语承载形状；本皮肤定 token，不重画形状。
2. **文案** —— 主行动固定文案（如「开始填写出生信息 ->」）；冷启动期是唯一主行动，**不做「跳过」按钮**（S4 §3①：底座是唯一必填项）。
3. **（可选）后缀箭头位** —— `->` 语义后缀，随文案走，不单独设色。
4. **进行中指示位** —— `running` 时文案换进行中文案 + 行内指示（转圈 / 进度文本）。

## 逐部位 token 引用

| 部位 | token | 语义 |
|---|---|---|
| 按钮底 | `--dsw-alias-brand-primary` | DSH 品牌主色别名（accent 面；DSH 自带双模，不新造色） |
| 按钮文字 | `--xs-text-on-accent` | 主按钮上的文字 |
| 按钮圆角 | `--xs-radius-control` | 控件圆角（按钮 / 输入 / 分段） |
| hover / active 底 | DSH 按钮原语既有交互面（`--dsw-alias-*` 派生，不新造） | 沿用 DSH 主题的悬停 / 按下阶梯 |
| 焦点环 | `--xs-edge-focus` | 焦点环 |
| 进行中指示 | `--xs-state-running-fg` | 运行态前景（转圈 / 进行中文案前的小指示） |
| 禁用态 | 见 skins/cast-button-disabled.md | 禁用文字 `--xs-text-disabled`，底走 DSH 原语 disabled 形态 |
| 主按钮↔相邻控件间距 | `--xs-space-toolbar` | 一排控件之间的水平距离 |
| 按钮与上下文行距 | `--xs-space-stack-md` | 控件 / 段落之间的垂直距离 |

## 状态

| 状态 | 呈现 |
|---|---|
| `ready`（常态） | accent 底 + `--xs-text-on-accent` 文案；一屏同时只有一个主按钮（主行动唯一） |
| hover / 焦点 | DSH 原语交互面 + `--xs-edge-focus` 焦点环 |
| `running` | 文案换进行中文案（「生成中⋯」「出盘中⋯」）+ `--xs-state-running-fg` 指示；防重复点击（S3 §6：单飞） |
| `disabled` | 置灰 + 理由行（skins/cast-button-disabled.md）；**不给点了没反应的按钮** |

## 尺寸语义

- 高 = `--xs-size-control-height`（控件高度语义，全稿按钮 / 输入 / 分段同守）。
- 宽：卡内主按钮可全宽（S4 命盘卡冷启动主态）；表单内按内容宽；窄屏进吸底条（skins/sticky-bottom-bar.md）。
- 圆角 `--xs-radius-control`，不与卡片圆角（`--xs-radius-card`）混用。

## 备注

- 全稿唯一主按钮皮肤：S1 命盘卡空态 `[开始填写出生信息]`、S3 `[确认并出盘]`、S2 stale 提示条 `[重新出盘 ->]`、S14 `[重新生成（今天）]` 等均复用本皮肤，不另起「更醒目的第二主色」。
- 冷启动期主行动的文案与代价说明行排版见 skins/why-empty-caption.md（asset.S4-7）与 copy 分工（asset.S4-10）。
