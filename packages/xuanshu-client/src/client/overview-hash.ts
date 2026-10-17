/**
 * P2（复核 #24）· `#xuanshu-overview` → 切到 overview 的最小桥。
 *
 * 背景：前端**没有路由**（`contract-shell-notify.md` §7「不做深链 / 路由」），但票面验收要求
 * 「点通知窗口出现并停在 overview」。壳在点击时把页面的 hash 改成 `#xuanshu-overview`，
 * 这里在**页面加载时**与**hashchange 时**各看一次：
 *
 *   - 命中 → `ctx.layout.selectPanel('overview')` → **清掉 hash**（刷新不会重复触发）；
 *   - 不命中 → 什么都不做（绝不把用户从别的面板拽走）。
 *
 * 环境纪律：本模块不碰 DOM globals。`installOverviewHashBridge` 才去取 `window`，
 * 且在 Node（客户端断言台 / SSR）里安全返回 `undefined` —— 判断与注册全在
 * `createOverviewHashBridge()` 这个纯函数里，测试用假 `location` 就能跑。
 */

/** 与壳侧 `main-flow.mjs::OVERVIEW_HASH` 同一个值（不带 `#`）。两侧对拍见 `tests/shell/contract-parity.test.mjs`（R8 / #39）：改任一侧的值都会红。 */
export const OVERVIEW_HASH = 'xuanshu-overview'

/**
 * 这个 hash 是不是「点通知 → 回 overview」。
 * @param {unknown} hash `location.hash`（带 `#`）
 */
export function isOverviewHash(hash: string): boolean {
  return hash === `#${OVERVIEW_HASH}`
}

/** `location` 的最小形状（Node 里没有真的，测试传假件）。 */
export interface HashLocationLike {
  hash: string
  addEventListener(type: 'hashchange', listener: () => void): void
  removeEventListener(type: 'hashchange', listener: () => void): void
}

/**
 * 建桥（**不做注册**：返回 `start` / `stop`，由调用方决定生命周期）。
 *
 * `start()` 会立即检查一次（带 hash 加载的那条路径），再挂 `hashchange` 监听；
 * `stop()` 幂等。
 *
 * @param {{location: HashLocationLike, selectPanel: (id: string) => void}} options
 */
export function createOverviewHashBridge({
  location,
  selectPanel,
}: {
  location: HashLocationLike
  selectPanel: (id: string) => void
}): { start(): void; stop(): void; handle(): void } {
  let started = false

  const handle = (): void => {
    if (!isOverviewHash(location.hash)) return;
    selectPanel('overview');
    // 清 hash：下一次刷新不再触发（`location.hash = ''` 在浏览器里会留下一个 `#`，无害）。
    try {
      location.hash = '';
    } catch {
      /* 只读 location（某些沙箱）不该阻断切面板 */
    }
  };

  return {
    /**
     * 安装：立即检查一次 + 订阅 hashchange。
     */
    start(): void {
      if (started) return;
      started = true;
      location.addEventListener('hashchange', handle);
      handle();
    },
    /** 卸载（幂等）。 */
    stop(): void {
      if (!started) return;
      started = false;
      location.removeEventListener('hashchange', handle);
    },
    /** 纯处理（测试可直接点它，不必经过事件）。 */
    handle,
  };
}

/** 最小 `window` 形状（只为注入假件）。 */
export interface OverviewHashWindowLike {
  location: HashLocationLike
}

/**
 * 安装到客户端上下文（**纯加性**：不新增面板 / 侧栏行 / 设置行）。
 *
 * 没有 `window`（Node / SSR）→ 返回 `undefined`，不抛。有 → 返回释放函数。
 *
 * @param {{layout: {selectPanel(id: string): void}}} ctx 客户端上下文
 * @param {{window?: OverviewHashWindowLike}} [options] 测试注入用的假 window
 */
export function installOverviewHashBridge(
  ctx: { layout: { selectPanel(id: string): void } },
  options: { window?: OverviewHashWindowLike } = {},
): (() => void) | undefined {
  const target = options.window ?? (typeof globalThis.window === 'undefined' ? undefined : (globalThis.window as unknown as OverviewHashWindowLike));
  if (target === undefined || target.location === undefined) return undefined;
  const bridge = createOverviewHashBridge({
    location: target.location,
    selectPanel: (id) => {
      ctx.layout.selectPanel(id);
    },
  });
  bridge.start();
  return () => {
    bridge.stop();
  };
}
