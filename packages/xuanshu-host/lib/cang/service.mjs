/**
 * packages/xuanshu-host/lib/cang/service.mjs — 藏的 `cang.*` RPC 方法组（票 14）。
 *
 * 把这一组方法并进 `/xuanshu` 通道（`lib/index.js` 的 `installRpc`）。三条边界，都是「藏永不进 AI」的落地：
 *   1. **不注册工具、不订阅会话、不注入上下文、不碰 LLM**：这个文件里没有 `ctx.tools` / `ctx.llm` 的任何调用，
 *      方法只做「读登记表 / 改登记表 / 让操作系统打开一个路径」三件事；
 *   2. **打开路径走官方原生适配器**（不是自己 `spawn('explorer'|'open')`）：
 *      `canOpenNativePath(internals?)` 判桌面可用（`dsh-native-command/lib/types/path-opener.d.ts:37`），
 *      `openNativeAssociatedPath(path, signal, internals?)` 用关联程序打开（同文件 `:53`）、
 *      `revealNativePath(path, signal, internals?)` 在文件管理器里定位（同文件 `:77`）。
 *      `internals` 是官方留给测试的平台/环境缝（同文件 `:18` `PathOpenerInternals`），我们原样透传 `config.nativeInternals`；
 *   3. **能力如实**：没有桌面就说「复制路径后在本机打开」，不假装打开过；没有系统目录选择器就让人粘贴路径。
 */

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCangRegistry } from './registry.mjs';

function softGet(ctx, name) { try { return ctx.get(name, false); } catch { return undefined; } }

export function createCangMethods(ctx, config = {}) {
  const profile = softGet(ctx, 'profileContext');
  const dataDir = config.dataDir ?? join(profile?.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'xuanshu');
  const registry = createCangRegistry({ dataDir });
  let nativePromise;
  async function native() {
    nativePromise ??= (async () => {
      const require = createRequire(join(profile?.dir ?? process.cwd(), 'package.json'));
      return import(pathToFileURL(require.resolve('@deepseek-ai/dsh-native-command')).href);
    })();
    return nativePromise;
  }
  async function action(input, kind, signal = new AbortController().signal) {
    const entry = (await registry.list()).entries.find(value => value.id === input?.id);
    if (!entry) throw new Error('藏登记不存在，请刷新列表。');
    if (!entry.actions[kind]) throw new Error('此登记未启用该跳转入口。');
    if (!entry.pointer.valid) throw new Error(entry.pointer.reason);
    signal.throwIfAborted();
    const adapter = await native();
    if (!adapter.canOpenNativePath(config.nativeInternals)) throw new Error('宿主没有可用桌面，请复制路径后在本机打开。');
    if (kind === 'open') await adapter.openNativeAssociatedPath(entry.path, signal, config.nativeInternals);
    else await adapter.revealNativePath(entry.path, signal, config.nativeInternals);
    return { opened: true };
  }
  return {
    'cang.list': () => registry.list(),
    'cang.validate': input => registry.validate(input?.path),
    'cang.register': input => registry.register(input),
    'cang.update': input => registry.update(input),
    'cang.remove': input => registry.remove(input?.id),
    'cang.open': (input, signal) => action(input, 'open', signal),
    'cang.reveal': (input, signal) => action(input, 'reveal', signal),
    async 'cang.capabilities'() {
      // 系统目录选择器来自宿主服务（`directoryPicker`，可能不在场）；桌面能力来自原生适配器。
      // **包解析不到时 `desktop` 留 false**：能力面宁可说「不行」也不能说「行」——说行了就等于
      // 承诺一个点下去会报错的按钮。
      const picker = softGet(ctx, 'directoryPicker')?.capability();
      let desktop = false;
      try { desktop = (await native()).canOpenNativePath(config.nativeInternals); } catch { /* Capabilities stay truthful when adapter package is absent. */ }
      return { directoryPicker: picker?.kind === 'native', desktop, filePicker: false };
    },
    async 'cang.pickDirectory'(_input, signal = new AbortController().signal) {
      const picker = softGet(ctx, 'directoryPicker')?.capability();
      if (picker?.kind !== 'native') throw new Error('宿主未提供系统目录选择器，请粘贴本地路径。');
      const path = await picker.pick(signal);
      return { path };
    },
  };
}
