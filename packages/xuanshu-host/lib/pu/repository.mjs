import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function puSlug(name) {
  const slug = String(name ?? '').trim().normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '');
  if (!slug || slug === '_base' || slug.length > 80) throw new Error('谱名无效');
  return slug;
}
export function validatePuDraft(draft) {
  if (!draft || typeof draft.name !== 'string' || !draft.name.trim()) throw new Error('请填写谱名');
  if (/[\x00-\x1f\x7f]/.test(draft.name)) throw new Error('谱名不能包含换行或控制字符');
  puSlug(draft.name);
  if (!['base', 'optional'].includes(draft.level)) throw new Error('级别必须为 base 或 optional');
  if (typeof draft.description !== 'string' || !draft.description.trim()) throw new Error('谱必须包含概览');
  if (typeof draft.body !== 'string' || !/^#\s+.*概览.*$/m.test(draft.body)) throw new Error('正文必须包含一级概览节');
  if (draft.summary !== undefined && typeof draft.summary !== 'string') throw new Error('summary 必须为文本');
}
const quoted = value => JSON.stringify(value);
function manifest(draft, source) {
  return `---\nspec: pu/1\nname: ${quoted(draft.name.trim())}\nlevel: ${draft.level}\ntags: []\nsource: ${source}\nupdated_at: ${quoted(new Date().toISOString())}\n---\n# ${draft.name.trim()}（概览）\n${draft.description}\n`;
}
function scalar(value) {
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value.replace(/\s+#.*$/, '').trim();
}
export function createPuRepository(dataDir) {
  const root = join(dataDir, 'pus');
  const target = slug => {
    if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw new Error('谱目录不允许符号链接');
    if (typeof slug !== 'string' || puSlug(slug) !== slug || slug === 'base') throw new Error('谱路径无效或属于底座');
    return join(root, slug);
  };
  function read(slug) {
    const dir = target(slug);
    const singleFile = !existsSync(dir) && existsSync(`${dir}.md`);
    if (lstatSync(singleFile ? `${dir}.md` : dir).isSymbolicLink()) throw new Error('谱不允许使用符号链接');
    if (!singleFile) for (const file of ['manifest.md', 'summary.md']) if (existsSync(join(dir, file)) && lstatSync(join(dir, file)).isSymbolicLink()) throw new Error('谱元信息不允许符号链接');
    const raw = readFileSync(singleFile ? `${dir}.md` : join(dir, 'manifest.md'), 'utf8');
    const front = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!front) throw new Error('manifest 缺少 frontmatter');
    const meta = {};
    for (const line of front[1].split(/\r?\n/)) {
      const match = line.match(/^([a-z_]+):\s*(.*)$/); if (match) meta[match[1]] = scalar(match[2]);
    }
    if (meta.spec !== 'pu/1' || !meta.name || !['base', 'optional'].includes(meta.level) || !['manual', 'ai-assisted', 'sediment', 'workflow'].includes(meta.source) || !meta.updated_at || meta.tags === undefined) throw new Error('manifest 不符合谱规范 v1');
    if (!/^#\s+.*概览/m.test(front[2])) throw new Error('manifest 缺少概览节');
    const files = singleFile ? [] : readdirSync(dir).filter(f => f.endsWith('.md') && !['manifest.md', 'summary.md'].includes(f));
    const contents = singleFile ? { 'content.md': front[2].trim() } : Object.fromEntries(files.map(f => {
      if (lstatSync(join(dir, f)).isSymbolicLink()) throw new Error('谱内容不允许符号链接');
      return [f, readFileSync(join(dir, f), 'utf8')];
    }));
    const summary = !singleFile && existsSync(join(dir, 'summary.md')) ? readFileSync(join(dir, 'summary.md'), 'utf8') : '';
    return { slug, ...meta, singleFile, description: front[2].replace(/^#.*\r?\n/, '').split(/(?:^|\n)#\s+/)[0].trim(), body: Object.values(contents).join('\n\n'), contents, summary, updatedAt: meta.updated_at,
      stale: !singleFile && [...files, ...(existsSync(join(dir, 'summary.md')) ? ['summary.md'] : [])].some(f => statSync(join(dir, f)).mtimeMs > statSync(join(dir, 'manifest.md')).mtimeMs) };
  }
  function list(filters = {}) {
    if (!existsSync(root)) return [];
    if (lstatSync(root).isSymbolicLink()) throw new Error('谱目录不允许符号链接');
    return readdirSync(root, { withFileTypes: true }).filter(e => (e.isDirectory() || (e.isFile() && e.name.endsWith('.md'))) && !e.name.startsWith('.') && !e.name.startsWith('_')).map(e => {
      const slug = e.isFile() ? e.name.slice(0, -3) : e.name;
      try { return read(slug); } catch (error) { return { slug, name: slug, error: error.message }; }
    }).filter(p => p.error || ((!filters.level || p.level === filters.level) && (!filters.source || p.source === filters.source) && (!filters.query || `${p.name}\n${p.description}\n${p.body}`.toLowerCase().includes(filters.query.toLowerCase()))));
  }
  function confirm(draft, confirmed) {
    if (confirmed !== true) throw new Error('需要人工确认后才落盘');
    validatePuDraft(draft);
    const slug = puSlug(draft.name); const dest = target(slug);
    if (existsSync(dest) || existsSync(`${dest}.md`)) throw new Error('谱名已存在');
    mkdirSync(root, { recursive: true });
    const staging = join(root, `.draft-${randomUUID()}`); mkdirSync(staging);
    try {
      writeFileSync(join(staging, 'content.md'), draft.body);
      if (draft.summary !== undefined) writeFileSync(join(staging, 'summary.md'), draft.summary);
      writeFileSync(join(staging, 'manifest.md'), manifest(draft, 'ai-assisted'));
      renameSync(staging, dest);
    } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
    return read(slug);
  }
  function update(slug, draft, confirmed) {
    if (confirmed !== true) throw new Error('需要人工确认保存');
    validatePuDraft(draft);
    const current = read(slug); const dir = current.singleFile ? `${target(slug)}.md` : target(slug); const nextSlug = puSlug(draft.name); const dest = target(nextSlug);
    if (nextSlug !== slug && (existsSync(dest) || existsSync(`${dest}.md`))) throw new Error('谱名已存在');
    const staging = join(root, `.revision-${randomUUID()}`); const backup = join(root, `.old-${randomUUID()}`); mkdirSync(staging);
    try {
      // Preserve original multi-file sections unless the person replaces the combined body.
      const contents = draft.body === current.body ? current.contents : { 'content.md': draft.body };
      for (const [file, body] of Object.entries(contents)) writeFileSync(join(staging, file), body);
      writeFileSync(join(staging, 'summary.md'), draft.summary ?? '');
      writeFileSync(join(staging, 'manifest.md'), manifest(draft, current.source));
      renameSync(dir, backup);
      try { renameSync(staging, dest); } catch (error) { renameSync(backup, dir); throw error; }
      rmSync(backup, { recursive: true, force: true });
    } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
    return read(nextSlug);
  }
  return { list, read, confirm, update, baseSources: () => list({ level: 'base' }).filter(p => !p.error) };
}
