# 谱管理

从侧栏「谱」进入。文字与 MD / PDF / 任意文件可一并交给 AI，定义名称和 `base | optional` 后开始转换。转换会创建一个 DSH 原生会话，临时工作目录在 `$DSH_HOME/xuanshu/.tmp/pu/<id>/`；有审批时点击「在会话里看审批」，返回「谱」继续查看进度。中断会调用 DSH Session Controller 的取消接口，中间资料可留在临时目录，不写正式谱。

生成预览可修改名称、级别、描述、Markdown 正文与 summary。只有「确认落盘」才写 `$DSH_HOME/xuanshu/pus/<slug>/manifest.md + content.md + summary.md`。目录名由显示名称小写化、用 `-` 连接，允许中文。谱名重复或正文缺少一级「概览」节会拒绝保存。

列表支持名称、描述、正文搜索以及级别/来源组合筛选。点开后直接修改 MD 与汇总，保存后更新 `updated_at`。修改名称会一同迁移目录；修改级别在下次底稿刷新生效。基础输入级进底稿提炼源，可选输入级按问事需要追加；所有谱均非必填。AI 汇总候选不会自动保存，人仍需点击保存。

逻辑 skill 名称是 **xuanshu:create-pu**。DSH 0.2.0-rc.2 的 Skill Registry 只接受 kebab-case 名称，因此宿主将随包的 `lib/pu/create-pu.md` 注册为 **xuanshu-create-pu**；转换会话直接携带同一份指令，保留规范中的逻辑名称。没有改动 DSH 源码或其他 profile。

实现采用 DSH Connection 的认证 RPC 通道 `/xuanshu`，并通过实际 `sessionController.create/prompt/resolveAgent` 与 `Agent.whenIdle` 转换资料。无模型或无会话服务时显示可重试错误，不以固定文本冒充转换结果。未确认预览在宿主内存中，重启后需重新生成；已确认谱为普通 Markdown 文件，可整体拷走。
