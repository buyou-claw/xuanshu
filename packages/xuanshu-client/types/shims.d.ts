/**
 * 本地类型桩：票据 01 的构建环境里**没有**安装 `@deepseek-ai/*` 官方包
 * （profile 的 node_modules 只在 `profile/` 下，仓库根不依赖 rc 包），
 * 但客户端源码要用到它们的类型契约。因此这里按本机 0.2.0-rc.2 的实装
 * `.d.ts` 逐条抄录**恰好被我们用到的那部分**，并标注证据行号。
 *
 * 若将来把官方包加进 devDependencies，本文件可以直接删掉（同名模块的
 * ambient 声明会与真实包冲突，届时就是该删的信号）。
 *
 * 「照抄最小切片」是刻意的：宁可桩窄，也不许桩宽到掩盖真实 API 不符。
 */

/**
 * 证据：`@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:82-85`
 *   `export type SlotKind = 'single' | 'list' | 'keyed' | 'chain';`
 *   `export type SlotScope = 'root' | 'session-maybe' | 'session';`
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** 证据：同上 :83 —— 槽位基数。 */
  export type SlotKind = 'single' | 'list' | 'keyed' | 'chain';

  /** 证据：同上 :85 —— 槽位数据上下文。 */
  export type SlotScope = 'root' | 'session-maybe' | 'session';

  /**
   * 证据：同上 :224-230 `RenderOpts`。
   * `renderSlot(slot, owner, opts)` 的 opts：keyed 用 `entryKey`，
   * list 用 `only` 过滤单个 id，`fallback` 是空态。
   */
  export interface RenderOpts<EntryKey extends string = string> {
    entryKey?: EntryKey;
    only?: string;
    fallback?: unknown;
  }

  /**
   * 证据：`dsh-client-ui-layout/lib/types/client/index.d.ts:53-56`
   *   `'main': { kind: 'keyed'; scope: 'root'; }`
   *   —— `main` 是 keyed 槽（按 key 分派，一个 key 一个格子）。
   *
   * 槽位契约表在官方是 declaration merging 的空接口，
   * 这里只声明我们注册的键；未声明的键（如 `sidebar.panellist`）
   * 由对应 owner 包的桩补充 —— 与官方的合并方式同构。
   */
  export interface SlotMap {
    main: {
      kind: 'keyed';
      scope: 'root';
    };
  }

  /**
   * 证据：同上 :108-114 `SidebarOwnerProps` 同族的 owner 分享机制；
   * `main` 槽未声明 `owner`，故 owner 分享为 `{}`。
   * 证据：同上 :222 `PropsRuntime`：owner + keyProps + inject + scope 标准件。
   */
  export type PropsRuntime<
    K extends keyof SlotMap & string,
    EntryKey extends string = string,
  > = SlotMap[K] extends { owner: infer O extends object } ? O : object;

  /**
   * 证据：同上 :313-323 `PropsRenderSlots<S>`，仅取 `renderSlot` 成员。
   * 证据：`dsh-client-ui-conversation/.../skeleton/ConversationPanel.d.ts:8`
   *   `function ConversationPanel({ renderSlot }: PropsRuntime<'main'> &
   *    PropsRenderSlots<'main.conversation'>)` —— 官方核心面板正是这样
   *   把 main 槽的 owner 分享与子槽渲染权拼在自己身上。
   */
  export type PropsRenderSlots<S extends keyof SlotMap & string> = {
    renderSlot: (
      key: S,
      owner: object,
      opts?: RenderOpts,
    ) => unknown;
  } & ([S] extends [never] ? object : { readonly __renders?: (key: S) => void });
}

/**
 * 证据：`@deepseek-ai/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:46-50`
 *   `'sidebar.panellist': { kind: 'list'; scope: 'root';
 *     owner: SidebarPanelIconOwnerProps; }`
 * 证据：同上 :93-99 `SidebarPanelIconOwnerProps { size: number; active: boolean }`
 *   —— owner 分享就是「请求的方形边长 + 本面板是否当前选中」。
 * 证据：同上 :100-108 `SidebarPanelMetadata`：侧栏行 = list id + order +
 *   label，且 `id: MainPanelId`「List id and matching main panel key」。
 */
declare module '@deepseek-ai/dsh-client-ui-sidebar/client' {
  export interface SidebarPanelIconOwnerProps {
    /** Requested square edge in pixels. */
    size: number;
    /** Whether this panel is selected in the main column. */
    active: boolean;
  }
}

/**
 * 证据：`@deepseek-ai/dsh-client-ui-renderer/lib/types/client/index.d.ts:15-31`
 *   `declare module '@deepseek-ai/cordis' { interface Context {
 *      slots: SlotRegistry; ... } }`
 * 证据：同包 `lib/types/client/registry.d.ts:85` `readonly register: SlotCore['register']`，
 *   :111 `inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void`
 * 证据：`@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:560-583` `KindOptions`：
 *   keyed 要 `key`，list 要 `id`/`order`/`label`，非链式都可带 `priority`。
 */
declare module '@deepseek-ai/dsh-client-ui-renderer' {
  import type { SlotLabel } from '@deepseek-ai/dsh-client-ui-slots';

  /** keyed 槽注册选项。证据：slots/index.d.ts:560-563。 */
  export interface KeyedRegisterOptions<K extends string> {
    name: K;
    /** 本 keyed 单元格的 key；与 `main` 槽的 list id 同名。 */
    key: string;
    /** 同 key 同 priority 二次注册会抛（slots/index.d.ts:562）。 */
    priority?: number;
  }

  /** list 槽注册选项。证据：slots/index.d.ts:564-569。 */
  export interface ListRegisterOptions<K extends string> {
    name: K;
    id: string;
    order?: number;
    label?: SlotLabel;
    priority?: number;
  }

  /**
   * 证据：`dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:143-151`
   *   `SidebarRootInjected.startSession/toggleSidebar/selectPanel`；
   * 证据：`dsh-client-ui-sidebar/lib/client.js:478-481` 实现
   *   `selectPanel: (id) => { ...; ctx.layout.selectPanel(id); }`
   *   —— 点侧栏行的副作用就是选 main 面板。
   */
  export interface LayoutService {
    selectPanel(panelId: string | null): void;
  }

  /**
   * 证据：`dsh-client-ui-renderer/lib/types/client/registry.d.ts:46`
   *   `export declare class SlotRegistry extends Service`（cordis Service）。
   * 本桩只收窄到我们调用到的两个方法。
   */
  export interface SlotRegistry {
    /** 证据：registry.d.ts:111。返回幂等 disposer。 */
    inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void;
    /** 证据：registry.d.ts:85（= SlotCore['register']，slots/index.d.ts:789-804）。 */
    register(options: KeyedRegisterOptions<string>, component: (props: never) => unknown): () => void;
    register(options: ListRegisterOptions<string>, component: (props: never) => unknown): () => void;
  }
}

/**
 * 证据：`dsh-client-ui-renderer/lib/types/client/index.d.ts:15-31`
 *   `declare module '@deepseek-ai/cordis' { interface Context {
 *      slots: SlotRegistry; uiRenderer: UiRendererService } }`
 * 证据：`dsh-client-ui-layout/lib/types/client/index.d.ts:18-23` 同法补 `layout`。
 * 我们只用到 `ctx.slots` 与（四卡票才需要）`ctx.layout`，故只声明这两个。
 */
declare module '@deepseek-ai/cordis' {
  import type { SlotRegistry, LayoutService } from '@deepseek-ai/dsh-client-ui-renderer';

  export interface Context {
    /** Renderer-owned UI composition registry. */
    slots: SlotRegistry;
    /** Panel navigation face（本票不调用，留给票 06 的默认面板切换）。 */
    layout: LayoutService;
  }
}

/**
 * 注意：这里**不**声明 `react/jsx-runtime`。
 *
 * 产物运行在浏览器半边，`react/jsx-runtime` 由 `window.__ModuleLoader__` 提供
 * （构建期的 external 清单保证它不会被打进 bundle）；类型层面则由仓库根已装的
 * `@types/react` 提供（`@types/react/jsx-runtime.d.ts`，含 JSX 表达式解析所需的
 * `JSX` 命名空间）。若在这里再声明一份同名模块，会和真实 `@types/react` 的
 * 导出（`Fragment` 等）撞成重复标识符 —— 这是刻意留白，不是遗漏。
 */
