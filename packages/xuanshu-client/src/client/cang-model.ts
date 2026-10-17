/**
 * 票 14 · 藏（客户端）的**纯类型与共享常量**（无 DOM；类型面见 `cang-api.ts`，视图见 `CangPanel.tsx` / `CangDrawer.tsx`）。
 *
 * 三条「为什么」：
 *   1. 这里的接口**逐字对应宿主那几个方法**（`packages/xuanshu-host/lib/cang/service.mjs` 的
 *      `cang.list / validate / register / update / remove / open / reveal / capabilities / pickDirectory`）。
 *      客户端不另立一套命名，否则改一边不会报错、只会静默不匹配；
 *   2. `CangPointer` 是**登记内容的唯一「状态」**：藏不存正文、只存指针（`path`）与一次探测结果
 *      （`valid` / `kind` / `reason` / `checkedAt`）。界面据此显示「指针失效」，而不是替用户猜文件去哪了；
 *   3. `actions` 三个开关是**每条登记自己的**能力位（不是全局设置）：关掉的入口在界面上直接不出现，
 *      免得点了才被宿主用「此登记未启用该跳转入口」拒掉（宿主那条判据在 `service.mjs` 的 `action()` 里）。
 *
 * 与「AI」的边界（产品硬线）：下面那条 `CANG_AI_FREE` 就是这条线的文案本体 ——
 * 藏只登记指针、签与跳转，玄枢**不读、不索引、不分析、不进上下文**。
 * 出处：`CONTEXT.md` 的「藏」条目（票 14 的隔离要求在 `.scratch/notes/` 里没有对应契约文件，
 * 所以**具体行号未确认**，不编）。
 */

/** 指针探测结果（宿主 `registry.validate()` 的返回形状）。 */
export interface CangPointer { valid: boolean; path: string; kind?: 'file' | 'directory'; reason?: string; checkedAt: string }
/** 一条登记的草稿（`id` 只有已登记的条目才有）。 */
export interface CangDraft { id?: string; path: string; name: string; tags: string[]; actions: { open: boolean; reveal: boolean; copy: boolean } }
/** 已登记的条目 = 草稿 + 元数据 + 当前指针状态。 */
export interface CangEntry extends CangDraft { id: string; createdAt: string; updatedAt: string; pointer: CangPointer }
/** `cang.list` 的返回：清单文件路径 + 条目（清单路径也给界面看，便于用户自己找到那份 JSONL）。 */
export interface CangList { registryPath: string; entries: CangEntry[] }
/** 宿主能力面：`filePicker` 恒 `false`（藏只收路径，不做文件内容选择器）。 */
export interface CangCapabilities { directoryPicker: boolean; desktop: boolean; filePicker: false }
/** 藏的九个 RPC（与 `lib/cang/service.mjs` 的方法名一一对应）。 */
export interface CangApi {
  list(signal?: AbortSignal): Promise<CangList>;
  validate(path: string, signal?: AbortSignal): Promise<CangPointer>;
  register(draft: CangDraft): Promise<CangEntry>;
  update(draft: CangDraft): Promise<CangEntry>;
  remove(id: string): Promise<unknown>;
  open(id: string): Promise<unknown>;
  reveal(id: string): Promise<unknown>;
  capabilities(signal?: AbortSignal): Promise<CangCapabilities>;
  pickDirectory(): Promise<{ path: string | null }>;
}
/**
 * 面板与抽屉共享的**最小状态源**：两块 UI 是两棵独立的 React 树，靠订阅同一个 controller 对齐
 * （`revision` 自增即「该重取了」）。「人点才跑」也落在这里：只有 `changed()` 会推 revision，
 * 没有任何 effect 会自己改它。
 */
export interface CangController {
  snapshot(): { revision: number; draft?: CangDraft };
  subscribe(listener: () => void): () => void;
  edit(draft: CangDraft): void;
  close(): void;
  changed(): void;
}
/** 产品硬线的文案本体（界面上逐字显示，不许改写成「大概不进 AI」这种含糊话）。 */
export const CANG_AI_FREE = '藏永不进 AI：只登记指针、签与跳转 —— 玄枢不读、不索引、不分析、不进上下文';
/** 新登记的缺省草稿：三个跳转入口默认全开（用户可逐条关掉）。 */
export const newCangDraft = (): CangDraft => ({ path: '', name: '', tags: [], actions: { open: true, reveal: true, copy: true } });
