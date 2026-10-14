import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCangRegistry } from './registry.mjs';

function softGet(ctx, name) { try { return ctx.get(name, false); } catch { return undefined; } }

/** Add these methods to the shared /xuanshu RPC map. No tool registration,
 * session subscription, context injection or LLM service is used here. */
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
