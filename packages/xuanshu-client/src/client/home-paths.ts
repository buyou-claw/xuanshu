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
 */

/** 宿主没回传 `dataDir` 时的中性占位（不猜路径）。 */
export const DATA_DIR_PLACEHOLDER = '玄枢数据目录';

/** 宿主没回传 `home` 时的中性占位（不猜路径）。 */
export const HOME_PLACEHOLDER = '玄枢 home';

/** 有值且非空白才算宿主回传了路径（空串与纯空白一律按「没拿到」）。 */
function isUsablePathValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
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
