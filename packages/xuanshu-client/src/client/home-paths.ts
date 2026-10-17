/**
 * 用户可见文案里的 **玄枢 home / 数据目录**（R3 · #35）。
 *
 * 依据：
 *   - ADR-0014（`docs/adr/0014-own-desktop-shell-and-home.md:13`）：玄枢不读写 DSH 桌面版的 home；
 *   - 冻结契约 §0 / 规格「我的数据」：产品档 home `~/.xuanshu`、开发档 `<repo>/.dsh-home`，
 *     数据目录固定为 `<home>/xuanshu`（唯一实现：`packages/xuanshu-host/lib/home.mjs`）；
 *   - 宿主 `data.overview` 已回传真实 `home` / `dataDir`（`lib/data/service.mjs`），
 *     `cang.list` 回传 `registryPath` —— 文案优先用宿主回传值。
 *
 * 三条规矩：
 *   1. **不写死任何一档的路径**：写死产品档，开发档就变成错话（反之亦然）。
 *   2. 拿不到宿主回传值 → 中性占位（`玄枢数据目录` / `玄枢 home`），句式保持可读，不猜路径。
 *   3. 本文件不得出现 DSH 桌面版的 home 字面量 —— 那正是这些文案要消灭的错误指路。
 *
 * 两份职责，别混：
 *   - **拼显示路径**（`dataDirPath` / `homePath` / `withTrailingSeparator`）：纯函数，props 直传也能用；
 *   - **把值送到生产装配点**（本文件下半部分）：`resolveHomePathsFromApi` 装配期读一次宿主值 →
 *     `HomePathsWatch` → `useHomePaths` 在面板里订阅。缺了这一层，文案层再正确也永远只显示占位
 *     （复核 F1 的教训：`tests/assembly/home-copy.test.mjs` 只直传 props，没证明接线）。
 */

import { useSyncExternalStore } from 'react';

/** 宿主没回传 `dataDir` 时的中性占位（不猜路径）。 */
export const DATA_DIR_PLACEHOLDER = '玄枢数据目录';

/** 宿主没回传 `home` 时的中性占位（不猜路径）。 */
export const HOME_PLACEHOLDER = '玄枢 home';

/** 有值且非空白才算宿主回传了路径（空串与纯空白一律按「没拿到」）。 */
function isUsablePathValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/* ───────────────────────── 装配期的注入面（R3 · AC1） ───────────────────────── */

/**
 * 宿主回传的两个路径（`data.overview` 的 `home` / `dataDir`）。
 * 字段缺席 = **没拿到**（不是空串），渲染层据此回中性占位。
 */
export interface HomePaths {
  home?: string;
  dataDir?: string;
}

/** 宿主 `data.overview` 在客户端的最小形状（只取本模块要的两项）。 */
export interface HomePathsApi {
  overview(signal?: AbortSignal): Promise<unknown>;
}

/** 空快照（稳定引用：`useSyncExternalStore` 的 `Object.is` 比较要求）。 */
const EMPTY_HOME_PATHS: HomePaths = Object.freeze({});

/** 订阅式注入面：装配期写入一次，此后所有面板读到同一份（SSR 用 `getSnapshot` 作 server snapshot）。 */
export interface HomePathsWatch {
  getSnapshot(): HomePaths;
  subscribe(listener: () => void): () => void;
  set(next: HomePaths): void;
}

/**
 * 造一个 home/dataDir 的注入面（初始为空 = 中性占位）。
 * @returns 订阅式快照；`set` 换引用并通知订阅者。
 */
export function createHomePathsWatch(): HomePathsWatch {
  let snapshot: HomePaths = EMPTY_HOME_PATHS;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next) {
      snapshot = { ...next };
      for (const listener of [...listeners]) listener();
    },
  };
}

/**
 * 把宿主 `data.overview` 的 home / dataDir 取出来（装配期**只调一次**）。
 *
 * 三条纪律：
 *   1. **不猜**：只认宿主回传的非空白字符串；缺一项就缺一项（渲染层各自回占位）。
 *   2. **不抛**：RPC 拒绝 / 没有连接 / 形状不对都折成空值 —— 文案降级成中性占位，
 *      而装配本身（`apply`）绝不能因为「拿不到一句路径」而失败。
 *   3. **不在渲染路径上**：调用方在装配期拿到 Promise，写进 `HomePathsWatch`。
 *
 * @param api - 数据面（`createDataApi` 的产物；只用到 `overview()`）。
 * @param signal - 可选取消信号。
 * @returns 宿主回传值；拿不到时为空对象。
 */
export async function resolveHomePathsFromApi(api: HomePathsApi, signal?: AbortSignal): Promise<HomePaths> {
  try {
    const overview = (await api.overview(signal)) as { home?: unknown; dataDir?: unknown } | null | undefined;
    const home = typeof overview?.home === 'string' && isUsablePathValue(overview.home) ? overview.home : undefined;
    const dataDir = typeof overview?.dataDir === 'string' && isUsablePathValue(overview.dataDir) ? overview.dataDir : undefined;
    return {
      ...(home === undefined ? {} : { home }),
      ...(dataDir === undefined ? {} : { dataDir }),
    };
  } catch {
    return {};
  }
}

/**
 * 装配期接线：读一次宿主值并写进注入面（失败时保持空快照）。
 * @param watch - `createHomePathsWatch()` 的产物。
 * @param api - 数据面。
 */
export async function primeHomePaths(watch: HomePathsWatch, api: HomePathsApi): Promise<void> {
  watch.set(await resolveHomePathsFromApi(api));
}

/** 没有注入面时的空订阅（hook 无条件调用的前提）。 */
const NO_SUBSCRIBE = (): (() => void) => () => {};

/** 没有注入面时的空快照读取器（稳定引用：`useSyncExternalStore` 会比对它）。 */
const EMPTY_SNAPSHOT = (): HomePaths => EMPTY_HOME_PATHS;

/**
 * 读注入面（面板内使用）：`watch` 缺席 → 空快照（渲染层回中性占位）。
 * 用 `useSyncExternalStore` 而不是普通读取，是为了让「宿主值晚到」也能驱动同一棵树重渲染。
 * @param watch - 装配期注入的注入面；缺席时返回空快照。
 */
export function useHomePaths(watch?: HomePathsWatch): HomePaths {
  const subscribe = watch === undefined ? NO_SUBSCRIBE : watch.subscribe;
  const getSnapshot = watch === undefined ? EMPTY_SNAPSHOT : watch.getSnapshot;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * 把若干路径段接在一段显示路径后面。
 *
 * 分隔符跟随基准路径：Windows 绝对路径（只含 `\`）用 `\`，`~` / POSIX 路径用 `/`；
 * 中性占位里没有分隔符，补 `/`，这样占位读起来仍是一条路径而不是一串词。
 */
function joinXsDisplayPath(base: string, segments: readonly string[]): string {
  const trimmed = base.trim().replace(/[\\/]+$/, '');
  const separator = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/';
  return [trimmed, ...segments.filter((segment) => segment !== '')].join(separator);
}

/**
 * 给显示路径补一个**目录**分隔符（分隔符跟随路径写法：Windows 路径 `\`，其余 `/`）。
 * @param path - 已经拼好的显示路径（已知真实路径或中性占位）。
 */
export function withTrailingSeparator(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '');
  const separator = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/';
  return `${trimmed}${separator}`;
}

/**
 * `<dataDir>/<segments…>` 的显示形态。
 * @param dataDir - 宿主回传的数据目录（`data.overview.dataDir`）；缺席时返回「玄枢数据目录/…」。
 * @param segments - 相对数据目录的路径段（如 `'pus'`、`slug`、`'content.md'`）。
 */
export function dataDirPath(dataDir: string | undefined, ...segments: string[]): string {
  return joinXsDisplayPath(isUsablePathValue(dataDir) ? dataDir : DATA_DIR_PLACEHOLDER, segments);
}

/**
 * `<home>/<segments…>` 的显示形态。
 * @param home - 宿主回传的 home（`data.overview.home`）；缺席时返回「玄枢 home/…」。
 * @param segments - 相对 home 的路径段（如 `'sessions'`）。
 */
export function homePath(home: string | undefined, ...segments: string[]): string {
  return joinXsDisplayPath(isUsablePathValue(home) ? home : HOME_PLACEHOLDER, segments);
}
