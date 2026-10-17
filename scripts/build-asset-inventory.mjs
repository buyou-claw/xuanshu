#!/usr/bin/env node
// 票 03 清单装配：把 manifests/*.json + 台账汇总成 assets/README.md 的 §6 总对账表（原地更新，幂等）
// 用法：node scripts/build-asset-inventory.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'docs/design/ui-v1/assets');
const LEDGER = join(ROOT, 'docs/design/ui-v1/shared/素材需求台账.json');
const README = join(ASSETS, 'README.md');

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
const manDir = join(ASSETS, 'manifests');
const entries = [];
for (const f of readdirSync(manDir).filter((f) => f.endsWith('.json')).sort()) {
  const j = JSON.parse(readFileSync(join(manDir, f), 'utf8'));
  for (const e of j.entries ?? []) entries.push({ ...e, _scope: j.scope ?? f });
}
const byId = new Map();
for (const e of entries) {
  if (!byId.has(e.ledger_id)) byId.set(e.ledger_id, []);
  byId.get(e.ledger_id).push(e);
}

const TYPE_LABEL = {
  icon: '图标',
  'empty-state': '空态',
  illustration: '插画',
  brand: '品牌/徽标',
  texture: '皮肤/token',
  placeholder: '占位/文案',
};

const lines = [];
lines.push('## 6. 总对账表（台账 124 条 + 5 别名 ↔ 产出文件，双向 100%）');
lines.push('');
lines.push('> 数据源：`manifests/*.json`（各分工产出，本表由 `node scripts/build-asset-inventory.mjs` 机械生成，请勿手改）。');
lines.push('> 校验：`node scripts/check-ui-assets.mjs` 必须全绿（覆盖率 / SVG 契约 / token 93 条双模 / 命名 / 术语 / 注释溯源 / brand 色值登记）。');
lines.push('');
lines.push('| 台账 id | 屏 | 类型 | 用途（台账原文摘要） | 产出文件（相对 assets/） | 备注 |');
lines.push('|---|---|---|---|---|---|');
let fileCount = 0;
const seen = new Set();
for (const a of ledger.assets) {
  const es = byId.get(a.id) ?? [];
  const files = [...new Set(es.flatMap((e) => e.files ?? []))];
  for (const f of files) {
    if (!seen.has(f)) {
      seen.add(f);
      fileCount++;
    }
  }
  const notes = [...new Set(es.map((e) => (e.notes ?? '').trim()).filter(Boolean))].join('；');
  const usage = String(a.usage).replaceAll('|', '｜');
  lines.push(
    `| ${a.id} | ${a.screen} | ${TYPE_LABEL[a.type] ?? a.type} | ${usage} | ${files.map((f) => '`' + f + '`').join('<br>') || '**缺失**'} | ${notes.replaceAll('|', '｜')} |`,
  );
}
lines.push('');
lines.push('### 6.1 复用别名（不另产文件，指向同枚素材）');
lines.push('');
lines.push('| 别名 id | 屏 | 复用自 | 用途 | 实际文件 |');
lines.push('|---|---|---|---|---|');
for (const al of ledger.aliases ?? []) {
  const es = byId.get(al.reused_from) ?? [];
  const files = [...new Set(es.flatMap((e) => e.files ?? []))];
  lines.push(`| ${al.id} | ${al.screen} | ${al.reused_from} | ${String(al.usage).replaceAll('|', '｜')} | ${files.map((f) => '`' + f + '`').join('<br>') || '**缺失**'} |`);
}
lines.push('');
lines.push(`**统计**：台账 ${ledger.assets.length} 条 · 别名 ${(ledger.aliases ?? []).length} 条 · 产出文件 ${fileCount} 个（去重） · manifest 条目 ${entries.length} 条。`);

const readme = readFileSync(README, 'utf8');
const start = readme.indexOf('## 6.');
const end = readme.indexOf('## 7.');
if (start < 0 || end < 0 || end <= start) {
  console.error('README 缺 ## 6./## 7. 锚点');
  process.exit(1);
}
const next = readme.slice(0, start) + lines.join('\n') + '\n\n' + readme.slice(end);
writeFileSync(README, next, 'utf8');
console.log(`§6 已更新：${ledger.assets.length} 台账条 + ${(ledger.aliases ?? []).length} 别名，文件 ${fileCount} 个`);
