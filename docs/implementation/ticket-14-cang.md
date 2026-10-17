# 票 14 · 藏库实现

藏库只保存用户登记的路径、名称、签和跳转开关。`packages/xuanshu-host/lib/cang/registry.mjs` 在 `cang/registry.jsonl` 追加登记、编辑和移除事件，重新读取即可恢复当前列表；移除只改登记，不操作原文件。损坏的注册表会阻止继续写入。

登记和每次打开之前只调用 `realpath/stat` 验证指针，不读取文件内容、不枚举目录、不计算大小。谱目录及链接指向谱目录的路径拒绝登记。唯一的 `readFile` 目标为藏库注册表；数据字段白名单避免内容字段混进注册表。方法没有会话、工具、上下文或 LLM 接口。

客户端以 `main:cang`、`sidebar.panellist:cang`（order 50）和 `shell.overlay:xuanshu-cang-drawer` 加性注册。界面提供登记、按签分组、名称/签搜索、签筛选、排序、打开、显示位置、复制路径、编辑和确认移除。AI 隔离声明常驻；登记抽屉保留焦点、Escape 和遮罩关闭行为。

## 已核对的实际 DSH 能力

钉死的 `0.2.0-rc.2` 安装包中，`dsh-host-open-in-app` 的 POST `/open-in-app/open` 仅接受目录；屏稿引用的 `file-applications.d.ts` 不存在。因此此实现复用同版 DSH `@deepseek-ai/dsh-native-command` 的 `openNativeAssociatedPath(path, signal)` 与 `revealNativePath(path, signal)`，经 profile 安装点解析。文件类型关联和目录打开由 DSH 的系统适配器完成，玄枢不自建 shell 启动逻辑。无桌面的宿主置灰打开动作，并保留复制路径。

文件夹选择复用 `ctx.directoryPicker.capability()` 的 `native` 能力。该版没有系统文件选择器能力；文件藏可粘贴完整本地路径。`browse` 后端不用于藏库，避免为登记指针调用目录枚举接口；此时提供路径输入并说明系统选择器不可用。

## 验证与范围

`tests/cang/` 覆盖登记重启恢复、编辑/移除不改原文件、绝对路径校验、JSONL 无末尾换行、损坏注册表拒绝写入、失效指针、谱目录及链接隔离、名称/签搜索范围、界面边界和实际 DSH 系统打开适配器。系统适配器测试只替换 OS 命令执行边界，实际安装包负责 Explorer 参数编码与关联打开；测试不会启动用户桌面程序。

集成入口由总装配连接 `createCangMethods` 与 `installCangClient`。真实浏览器抽屉焦点/窄屏布局及默认应用实际启动仍须在隔离 profile 冒烟中确认；自动测试不冒充真机验收。问事上下文里不出现藏的端到端断言由问事实现票补充，本票没有向会话提供藏的入口。
