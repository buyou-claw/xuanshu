#!/usr/bin/env node
// 票 03 质量门：玄枢 UI 素材资产库校验
// 用法：node scripts/check-ui-assets.mjs
// 校验：台账 124 条 + 5 别名 ↔ manifests 双向覆盖；SVG 技术契约；token 93 条双模；
//       命名 kebab-case；禁用旧名；注释溯源；brand 色值登记；无实现代码混入。
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'docs/design/ui-v1/assets');
const LEDGER = join(ROOT, 'docs/design/ui-v1/shared/素材需求台账.json');
const DICT = join(ROOT, 'docs/design/ui-v1/shared/设计token字典.md');

// 过滤（并行分工各自自检用）：
//   --only=S1,S2     限定屏（也接受精确 id：--only=asset.S15-2）
//   --only=tokens    只验 token 部分
//   --type=icon,brand 叠加类型过滤；不带 --only 时 = 全部屏的该类型
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const typeArg = process.argv.find((a) => a.startsWith('--type='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : null;
const typeFilter = typeArg ? new Set(typeArg.slice('--type='.length).split(',').map((s) => s.trim())) : null;
const onlyTokens = only?.includes('tokens') ?? false;
const idInScope = (id, type) => {
  if (onlyTokens) return false;
  if (typeFilter && !typeFilter.has(type)) return false;
  if (!only) return true;
  if (only.includes(id)) return true;
  const m = id.match(/^asset\.S(\d+)-/);
  return m ? only.includes(`S${m[1]}`) : false;
};

const errors = [];
const warns = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warns.push(msg);

// ---------- 0. 载入台账 ----------
const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
const assets = ledger.assets; // 124
const aliases = ledger.aliases ?? [];
const handoff = ledger.token_handoff?.tokens ?? ledger.token_handoff ?? [];
if (handoff.length !== 93) err(`token_handoff 期望 93 条，实际 ${handoff.length} 条（台账/字典口径漂移）`);

// ---------- 1. 载入 manifests ----------
const manDir = join(ASSETS, 'manifests');
let manifestEntries = [];
if (!existsSync(manDir)) {
  err('缺少 manifests/ 目录');
} else {
  for (const f of readdirSync(manDir).filter((f) => f.endsWith('.json'))) {
    let j;
    try {
      j = JSON.parse(readFileSync(join(manDir, f), 'utf8'));
    } catch (e) {
      err(`manifests/${f}：JSON 解析失败 ${e.message}`);
      continue;
    }
    if (!Array.isArray(j.entries)) {
      err(`manifests/${f}：缺少 entries 数组`);
      continue;
    }
    for (const e of j.entries) manifestEntries.push({ ...e, _from: f });
  }
}
const byLedgerId = new Map();
for (const e of manifestEntries) {
  if (!e.ledger_id) err(`${e._from}：条目缺 ledger_id`);
  if (!byLedgerId.has(e.ledger_id)) byLedgerId.set(e.ledger_id, []);
  byLedgerId.get(e.ledger_id).push(e);
}

// ---------- 2. 覆盖率：124 资产 + 5 别名 ----------
const assetIds = new Set(assets.map((a) => a.id));
let coveredFiles = 0;
const allListedFiles = [];
for (const a of assets) {
  if (!idInScope(a.id, a.type)) continue;
  const entries = byLedgerId.get(a.id);
  if (!entries || entries.length === 0) {
    err(`覆盖缺失：${a.id}（${a.type} · ${a.usage}）在 manifests 中无条目`);
    continue;
  }
  for (const e of entries) {
    if (!Array.isArray(e.files) || e.files.length === 0) {
      err(`${a.id}（${e._from}）：files 为空`);
      continue;
    }
    for (const rel of e.files) {
      allListedFiles.push({ rel, id: a.id, from: e._from });
      const abs = join(ASSETS, rel);
      if (!existsSync(abs)) {
        err(`${a.id}：文件不存在 assets/${rel}（${e._from}）`);
        continue;
      }
      coveredFiles++;
      // 注释溯源（SVG）：契约 §3.4 要求「id 全列」，故所有服务 id 都必须出现
      if (rel.endsWith('.svg')) {
        const txt = readFileSync(abs, 'utf8');
        const idsOfFile = manifestEntries.filter((x) => (x.files ?? []).includes(rel)).map((x) => x.ledger_id);
        const missing = idsOfFile.filter((id) => !txt.includes(id));
        if (missing.length > 0) {
          err(`${rel}：溯源注释缺 id（${missing.join(' / ')}；应全列 ${idsOfFile.join(' / ')}）`);
        }
      }
    }
  }
}
for (const al of aliases) {
  if ((only || typeFilter) && !idInScope(al.reused_from, assets.find((a) => a.id === al.reused_from)?.type)) continue;
  if (!assetIds.has(al.reused_from)) err(`别名 ${al.id}：reused_from ${al.reused_from} 不是台账资产 id`);
  else if (!byLedgerId.has(al.reused_from)) err(`别名 ${al.id}：reused_from ${al.reused_from} 未被 manifest 覆盖`);
}
// 未知 id / 重复文件归属
for (const e of manifestEntries) {
  if (e.ledger_id && !assetIds.has(e.ledger_id)) warn(`${e._from}：${e.ledger_id} 不是台账资产 id（别名/额外产出请确认）`);
  if (only && e.ledger_id && !idInScope(e.ledger_id) && !onlyTokens) continue;
}

// ---------- 3. 命名与禁用旧名 ----------
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*\.(svg|json|css|md)$/;
// 禁用旧名（CONTEXT.md 术语表 + ui-v1 README §7 术语对照；「复用」「勾选」是正确术语，不入表）
const BANNED = ['模块', '资料库', '每日运势', '聚合', '写回', '同步', '归档', '画像', '档案', '知识库', '多模型对比', '投票', '共识稿', '提醒', '资产'];
for (const { rel } of allListedFiles) {
  const base = rel.split('/').pop();
  if (!NAME_RE.test(base)) err(`命名违规（需 kebab-case）：${rel}`);
  for (const b of BANNED) if (rel.includes(b)) err(`文件名含禁用旧名「${b}」：${rel}`);
}
// manifest notes 的术语纪律（正文也扫，不只看文件名）
for (const e of manifestEntries) {
  for (const b of BANNED) {
    if (String(e.notes ?? '').includes(b)) err(`${e.ledger_id}（${e._from}）备注含禁用旧名「${b}」`);
  }
}

// ---------- 4. SVG 技术契约 ----------
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGBF = /\brgba?\s*\(/;
const COLORNAME = /\b(?:fill|stroke)="(?!none"|currentColor")([a-zA-Z]+)"/;
function checkSvg(rel, { allowColor }) {
  const abs = join(ASSETS, rel);
  if (!existsSync(abs)) return;
  const txt = readFileSync(abs, 'utf8');
  if (!/<svg[^>]*viewBox="/.test(txt)) err(`${rel}：缺 viewBox`);
  if (/<svg[^>]*\s(width|height)="/.test(txt)) err(`${rel}：根元素禁写固定 width/height`);
  if (/<(script|style|image)\b/.test(txt)) err(`${rel}：禁含 <script>/<style>/<image>`);
  if (!txt.includes('currentColor') && !allowColor) err(`${rel}：应使用 currentColor（单色可继承）`);
  if (!allowColor) {
    if (HEX.test(txt)) err(`${rel}：含字面 hex 色值（仅 brand/ 允许）`);
    if (RGBF.test(txt)) err(`${rel}：含 rgb()/rgba()（仅 brand/ 允许）`);
    const m = txt.match(COLORNAME);
    if (m) err(`${rel}：疑似颜色名 fill/stroke="${m[1]}"`);
  }
  if (/xlink:href|href="https?:/.test(txt)) err(`${rel}：禁外部引用`);
}
for (const { rel } of allListedFiles) {
  if (!rel.endsWith('.svg')) continue;
  if (rel.startsWith('icons/')) checkSvg(rel, { allowColor: false });
  else if (rel.startsWith('illus/')) checkSvg(rel, { allowColor: false });
  else if (rel.startsWith('brand/')) checkSvg(rel, { allowColor: true });
  else err(`${rel}：SVG 落在了未知目录（应 icons/ | illus/ | brand/）`);
}

// ---------- 5. brand 色值登记 ----------
const brandDir = join(ASSETS, 'brand');
if (existsSync(brandDir)) {
  const readme = readFileSync(join(ASSETS, 'README.md'), 'utf8');
  const sec5 = readme.split('## 5.')[1]?.split('## 6.')[0] ?? '';
  for (const f of readdirSync(brandDir).filter((f) => f.endsWith('.svg'))) {
    const txt = readFileSync(join(brandDir, f), 'utf8');
    const hexes = new Set([...txt.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()));
    for (const h of hexes) {
      if (!sec5.toLowerCase().includes(h)) err(`brand/${f}：色值 ${h} 未登记到 README §5`);
    }
  }
}

// ---------- 6. token 取值 ----------
const tokensJsonPath = join(ASSETS, 'tokens/xs-tokens.json');
const tokensCssPath = join(ASSETS, 'tokens/xs-tokens.css');
const checkTokens = !only || onlyTokens;
if (checkTokens && !existsSync(tokensJsonPath)) err('缺 tokens/xs-tokens.json');
if (checkTokens && !existsSync(tokensCssPath)) err('缺 tokens/xs-tokens.css');
if (existsSync(tokensJsonPath)) {
  let tj;
  try {
    tj = JSON.parse(readFileSync(tokensJsonPath, 'utf8'));
  } catch (e) {
    err(`xs-tokens.json 解析失败：${e.message}`);
    tj = { tokens: {} };
  }
  const tokens = tj.tokens ?? {};
  for (const t of handoff) {
    const v = tokens[t.token];
    if (!v) {
      err(`token 缺失：${t.token} 不在 xs-tokens.json`);
      continue;
    }
    for (const mode of ['light', 'dark']) {
      if (typeof v[mode] !== 'string' || v[mode].trim() === '') err(`token ${t.token}：${mode} 值为空（双模必填）`);
    }
  }
  // --xs-static-* 尺度层必须写字面值；--xs-* 引用必须解析得到
  for (const [k, v] of Object.entries(tokens)) {
    for (const mode of ['light', 'dark']) {
      const val = String(v?.[mode] ?? '');
      for (const m of val.matchAll(/var\((--xs-[a-z0-9-]+)\)/g)) {
        if (!tokens[m[1]]) err(`token ${k}.${mode}：引用了不存在的 ${m[1]}`);
      }
    }
    if (k.startsWith('--xs-static-')) {
      for (const mode of ['light', 'dark']) {
        const val = String(v?.[mode] ?? '');
        if (/^var\(/.test(val)) err(`尺度层 ${k}.${mode} 必须是字面值，不得再引用`);
      }
    }
  }
  if (existsSync(tokensCssPath)) {
    const css = readFileSync(tokensCssPath, 'utf8');
    for (const t of handoff) if (!css.includes(t.token + ':')) err(`xs-tokens.css 缺 ${t.token} 的人读条目`);
  }
}

// ---------- 7. 字典回填（「票 03 填」清零） ----------
if (checkTokens && existsSync(DICT)) {
  const dict = readFileSync(DICT, 'utf8');
  const left = dict.split('\n').filter((l) => /\|\s*\*{0,2}票 03 (填|新给|按)\*{0,2}[^|]*\|\s*$/.test(l));
  if (left.length > 0) err(`设计token字典.md 仍有 ${left.length} 个「取值」格未回填（首条：${left[0].trim().slice(0, 60)}…）`);
}

// ---------- 8. 禁实现代码混入 ----------
function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
for (const p of walk(ASSETS)) {
  if (/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/.test(p)) err(`实现代码混入资产库：${relative(ASSETS, p)}`);
}

// ---------- 汇总 ----------
console.log(`台账资产 ${assets.length} 条 / 别名 ${aliases.length} 条 / token ${handoff.length} 条`);
console.log(`manifest 条目 ${manifestEntries.length} 条 / 覆盖文件 ${coveredFiles} 个`);
for (const w of warns) console.log(`WARN  ${w}`);
if (errors.length) {
  console.log(`\n✗ ${errors.length} 个问题：`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log('\n✓ 票 03 资产库校验全绿');
