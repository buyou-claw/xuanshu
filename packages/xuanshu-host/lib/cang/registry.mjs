import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The only readFile target is this registry. Pointer checks use stat/realpath,
 * never file reads, directory enumeration, indexing, tools, sessions or LLM. */
export function createCangRegistry({ dataDir }) {
  const file = join(dataDir, 'cang', 'registry.jsonl');
  const pus = resolve(dataDir, 'pus');
  let pending = Promise.resolve();
  let needsSeparator = false;
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
      return { valid: false, path: normalized, reason: `指针失效：${error.code ?? error.message}`, checkedAt: new Date().toISOString() };
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
