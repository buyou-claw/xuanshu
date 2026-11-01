/**
 * packages/xuanshu-host/lib/cang/registry.mjs — **藏**的登记表（票 14；`<dataDir>/cang/registry.jsonl`）。
 *
 * 「藏」是**只给人看**的东西（`CONTEXT.md`：藏永不进 AI 上下文），所以这个模块第一位的职责不是
 * 「存下来」，而是**保证它永远不会被 AI 那条路读到**：
 *   1. **与谱物理隔离**：`<dataDir>/pus/**` 里的路径一律拒收（谱是要被 AI 读的），而且这一判据
 *      在 `realpath()` **之后**再查一遍 —— 否则 `C:\somewhere\link → pus` 这种链接就绕过去了；
 *   2. **只读面不碰内容**：`list()` 探指针只用 `stat`/`realpath`，**不读文件内容、不枚举目录、
 *      不建索引、不调工具 / 会话 / LLM**。文件内容只有人点「打开」时由客户端交给操作系统去开。
 *      （这条口径出自票 14 的隔离要求；我在 `.scratch/notes/` 里**没有**找到 t14 契约文件，
 *      所以**具体出处未确认** —— 只按本文件实际行为记述，不编行号。）
 *   3. **追加式事件流**：每个操作 append 一行 JSON（`register`/`update`/`remove`），读时按 id 折叠成
 *      当前视图。这样一次崩在半路最多丢最后一行，而**不会**留下半个 JSON 文档。
 *      读到坏行 → **抛错并报行号**，绝不静默跳过（跳过会让用户以为藏没了）。
 */

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

export function createCangRegistry({ dataDir }) {
  const file = join(dataDir, 'cang', 'registry.jsonl');
  const pus = resolve(dataDir, 'pus');
  let pending = Promise.resolve();
  let needsSeparator = false;
  // Windows 上 DSH 给的是 `C:\…` 或 `\\server\share\…`（UNC）；`isAbsolute()` 本身在 win32 上
  // 认这两种，这条正则只是把「盘符 + 斜杠」与 UNC 的形状再钉一遍，免得 `C:relative` 混进来。
  const absolute = path => isAbsolute(path) && (process.platform !== 'win32' || /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(path));
  const contains = (root, path) => { const part = relative(root, path); return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)); };
  async function validate(input) {
    const path = typeof input === 'string' ? input.trim() : '';
    if (!absolute(path)) return { valid: false, path, reason: '请选择本地绝对路径。', checkedAt: new Date().toISOString() };
    const normalized = resolve(path);
    if (contains(pus, normalized)) return { valid: false, path: normalized, reason: '谱会被 AI 读取，藏必须与谱安全隔离。请选择谱目录之外的路径。', checkedAt: new Date().toISOString() };
    try {
      const canonical = await realpath(normalized);
      let canonicalPus = pus;
      try { canonicalPus = await realpath(pus); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (contains(canonicalPus, canonical)) return { valid: false, path: normalized, reason: '谱会被 AI 读取，藏必须与谱安全隔离（包括链接指向的路径）。', checkedAt: new Date().toISOString() };
      const metadata = await stat(normalized);
      if (!metadata.isDirectory() && !metadata.isFile()) throw new Error('只能登记本地文件或文件夹。');
      return { valid: true, path: normalized, kind: metadata.isDirectory() ? 'directory' : 'file', checkedAt: new Date().toISOString() };
    } catch (error) {
      /**
       * 2026-11-02 改：原来这里直接写 `指针失效：${error.code ?? error.message}` —— 路径写错时
       * 界面上显示的是「指针失效：ENOENT」。ENOENT 是系统错误码，用户读不懂，
       * 也不知道下一步该干什么（是路径写错了？还是文件被挪走了？还是没权限？）。
       * 把几个常见的翻成人话；不认识的码仍带原码，免得把真问题藏掉。
       */
      const readable = {
        ENOENT: '这个路径不存在 —— 可能写错了，或者文件/文件夹被挪走了',
        EACCES: '没有权限读这个路径',
        EPERM: '没有权限读这个路径',
        ENOTDIR: '路径中间那一段不是文件夹',
        ELOOP: '路径里有循环链接（快捷方式指向自己）',
        ENAMETOOLONG: '路径太长，系统不接受',
      }[error.code]
      const why = readable ?? error.message ?? String(error.code ?? error)
      return { valid: false, path: normalized, reason: `指针失效：${why}`, checkedAt: new Date().toISOString() };
    }
  }
  function fields(input) {
    if (!input || typeof input !== 'object') throw new Error('登记信息无效。');
    const path = typeof input.path === 'string' ? input.path.trim() : '';
    const name = typeof input.name === 'string' ? input.name.trim() : basename(path);
    if (!name || name.length > 200 || !absolute(path)) throw new Error('名称不能为空且不超过 200 字；路径必须是本地绝对路径。');
    if (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== 'string' || tag.length > 50) || input.tags.length > 30) throw new Error('签必须为不超过 30 个简短文本。');
    const tags = [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))];
    const actions = { open: input.actions?.open !== false, reveal: input.actions?.reveal !== false, copy: input.actions?.copy !== false };
    return { path: resolve(path), name, tags, actions };
  }
  async function entries() {
    let raw;
    try { raw = await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') { needsSeparator = false; return []; } throw error; }
    needsSeparator = raw.length > 0 && !raw.endsWith('\n');
    const current = new Map();
    for (const [line, text] of raw.split(/\r?\n/).entries()) {
      if (!text.trim()) continue;
      try {
        const event = JSON.parse(text);
        if (typeof event.id !== 'string' || !event.id || !['register', 'update', 'remove'].includes(event.op)) throw new Error('invalid event');
        if (event.op === 'remove') current.delete(event.id);
        else {
          const entry = { ...fields(event), id: event.id, createdAt: event.createdAt, updatedAt: event.updatedAt };
          if (typeof entry.createdAt !== 'string' || typeof entry.updatedAt !== 'string') throw new Error('invalid timestamp');
          current.set(event.id, entry);
        }
      } catch { throw new Error(`${file} 第 ${line + 1} 行损坏；请修复注册表后重试。`); }
    }
    return [...current.values()];
  }
  async function append(event) {
    await mkdir(join(dataDir, 'cang'), { recursive: true });
    await appendFile(file, `${needsSeparator ? '\n' : ''}${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    needsSeparator = false;
  }
  // 写操作**串行化**：JSONL 的每一行都是「读旧状态 → 追加」这一步的产物，两个写并发交错会
  // 追加出重复或错序的行（读侧按 id 折叠，一旦错序就会把旧状态折叠回来）。失败不污染队尾。
  function serialized(operation) {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  }
  return {
    file,
    validate,
    async list() {
      await pending;
      const registered = await entries();
      return { registryPath: file, entries: await Promise.all(registered.map(async entry => ({ ...entry, pointer: await validate(entry.path) }))) };
    },
    register(input) {
      return serialized(async () => {
        await entries(); // Corruption is never silently overwritten.
        const value = fields(input);
        const pointer = await validate(value.path);
        if (!pointer.valid) throw new Error(pointer.reason);
        const now = new Date().toISOString();
        const entry = { ...value, id: randomUUID(), createdAt: now, updatedAt: now };
        await append({ op: 'register', ...entry });
        return { ...entry, pointer };
      });
    },
    update(input) {
      return serialized(async () => {
        const prior = (await entries()).find(entry => entry.id === input?.id);
        if (!prior) throw new Error('藏登记已不存在，请刷新列表。');
        const value = fields(input);
        const pointer = await validate(value.path);
        if (!pointer.valid) throw new Error(pointer.reason);
        const entry = { ...value, id: prior.id, createdAt: prior.createdAt, updatedAt: new Date().toISOString() };
        await append({ op: 'update', ...entry });
        return { ...entry, pointer };
      });
    },
    remove(id) {
      return serialized(async () => {
        if (!(await entries()).some(entry => entry.id === id)) throw new Error('藏登记已不存在，请刷新列表。');
        await append({ op: 'remove', id, updatedAt: new Date().toISOString() });
        return { removed: true };
      });
    },
  };
}
