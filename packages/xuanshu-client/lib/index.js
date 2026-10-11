/**
 * xuanshu-client — 宿主半边（Node 侧），最小 no-op cordis 插件。
 *
 * 职责边界（票 01 契约 §4）：本票**只**需要这一行在装配后的插件树里出现
 * （seam S1 断言 id 列表含 `xuanshu-client`）。业务全部在后继票：
 * 玄枢数据目录 / 装配报告 / horosa 进程托管属 xuanshu-host，四卡属票 07 · 首页替换。
 * 因此这里刻意不注册任何 service / tool / command / route，
 * 也不 inject 任何宿主 service —— 一个多余依赖都会让装配失败或引入无关行为。
 *
 * 形态依据（本机 0.2.0-rc.2 实装，均为只读核对）：
 *   - 官方 `@deepseek-ai/dsh-client-ui-layout/lib/index.js` 末尾仅
 *     `export { apply };`，其 `apply` 文档注释为「Provides no host-side
 *     behavior.」——**空宿主半边就是官方形态**，本文件与之一致。
 *   - `@deepseek-ai/dsh-client-ui-layout/lib/types/client/index.d.ts:127-135`
 *     注明 loader「passes all module exports as an object plugin」，
 *     即模块导出面就是插件定义；`name` 是本插件族通用成员
 *     （见 `@linxin666/dsh-client-ui-skill-explorer/lib/index.js:999`
 *     的 `export { ROUTES, apply, inject, name }`）。
 *
 * 导出面（`lib/index.js` 是 ESM，package.json 已 `type: module`）：
 *   - `name`：cordis 插件名。取包名，与本行补丁 id 一致，便于
 *     `dsh --profile xuanshu --dump-config` 与运行时报错里可定位。
 *   - `apply()`：不做任何事，签名与官方半边同形（无参）。
 */

/** cordis 插件名（= 包名，见 package.json 的 dsh.bundle.patch 行 id）。 */
export const name = 'xuanshu-client';

/** 插件主体：空实现，不接触宿主上下文，也不产生任何副作用。 */
export function apply() {}
