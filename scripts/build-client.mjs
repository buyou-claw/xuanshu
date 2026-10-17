#!/usr/bin/env node
/**
 * 玄枢客户端预编译构建管线（票 01 · 工程点 S1）。
 *
 * 把 `packages/xuanshu-client/src/client/**`（TS/TSX）打成**一个**经典脚本，
 * 套上 DSH 浏览器模块装载器的信封后提交为 `packages/xuanshu-client/lib/client.js`：
 *
 *   window.__ModuleLoader__.load({
 *     id: "<包名>",
 *     factory: (require) => { var module = { exports: {} }; var exports = module.exports; ... return module.exports; }
 *   });
 *
 * 为什么必须有这条管线（而不是发 TS 源码）：
 *   `dsh-client-modules` 把 `exports["./client"]` 指向的文件**原样字节**当 JS 送去浏览器
 *   —— 不做转译、不打包、不认 TS/JSX（`.scratch/assembly-foundation/notes/client-plugin-contract.md` §(a)(b6)）。
 *
 * 契约依据（本机 DSH 0.2.0-rc.2 实装，均为只读核对）：
 *   - 入口约定 `exports["./client"]`，主机侧 `join(dirname(pkg/package.json), 该值)`
 *     —— `@deepseek-ai/dsh-client-modules/lib/index.js:170-181, 718-723`。
 *   - 产物形态（经典脚本 + 一次 load + factory 内是 CJS）
 *     —— `@linxin666/dsh-client-ui-skill-explorer/lib/client.js:1-6, 1490-1494`。
 *   - 基线外部依赖免声明；超出基线必须写进 `dsh.client.external`
 *     —— `@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts:76-89`；
 *     module table 基线见 `notes/client-plugin-contract.md` §(a)。
 *   - `require` 未命中 module table 会抛「missed the module table」
 *     —— `@deepseek-ai/dsh-client-modules/lib/client.js:705`（本脚本据此在构建期就拦下漂移）。
 *
 * 用法（两种等价）：
 *   node scripts/build-client.mjs
 *   pnpm build:client          # = pnpm --filter ./packages/xuanshu-client run build
 *   node scripts/build-client.mjs --check   # 只校验提交的产物与 src 同步，不写盘
 *
 * **写盘时序**：全部自检通过之后才 `writeFileSync`。反过来的话，一次失败的构建会在磁盘上
 * 留下未经校验的 `lib/client.js`，而 S3 的逐字节比对会把这个坏产物当成「仓库里那份」放过去。
 * 构建失败时既不写盘也不删旧产物（旧内容原样留着，由人决定怎么办）。
 *
 * 离线、确定性：只用本仓 `node_modules` 里的 esbuild（经 `createRequire` 从包目录解析，
 * 以适配 pnpm 的 isolated 布局），不联网、不读全局包、产物不含时间戳/绝对路径。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// ── 路径：一律从本脚本位置推导，因此与 cwd 无关（直跑 / pnpm filter 都一样） ──
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const PKG_DIR = join(REPO_ROOT, 'packages', 'xuanshu-client');
const PKG_JSON = join(PKG_DIR, 'package.json');
const ENTRY = join(PKG_DIR, 'src', 'client', 'index.tsx');
const OUT_FILE = join(PKG_DIR, 'lib', 'client.js');

/**
 * 基线外部依赖（免 `dsh.client.external` 声明即可 `require`）。
 * 证据：`notes/client-plugin-contract.md` §(a)（读自 `@deepseek-ai/dsh-web-frontend`
 * 的 module table 种子）与票 01 契约 §4。
 * 我们真正用到的只有 `react/jsx-runtime`（JSX 自动运行时）；整表列出以便**构建期
 * 校验**：产物里任何超出本表（且未在 `dsh.client.external` 声明）的 require 都直接失败。
 */
const BASELINE_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
];

/** 失败即退出：所有校验都抛这个，主函数统一打印。 */
class BuildError extends Error {}

/**
 * 命令行参数：目前只有 `--check`（见文件头的用法）。
 * @returns `{ check }`；`check === true` 表示「只校验、不写盘」。
 */
function parseArgs(argv) {
  const opts = { check: false };
  for (const arg of argv) {
    if (arg === '--check') opts.check = true;
    else {
      throw new BuildError(
        `未知参数 ${arg}。用法：node scripts/build-client.mjs [--check]` +
          '（`--check` 只把本次构建结果与磁盘上的 lib/client.js 逐字节比较，不写盘）',
      );
    }
  }
  return opts;
}

/**
 * 从**包目录**解析 esbuild。
 *
 * 不能 `import 'esbuild'`：本仓 pnpm 用 isolated node_modules，esbuild 只装在
 * `packages/xuanshu-client/node_modules`，不在 `<root>/scripts/` 的解析路径上。
 * 逐级回退是为了让「依赖没装」给出可操作的报错，而不是 ERR_MODULE_NOT_FOUND。
 */
function loadEsbuild() {
  const anchors = [join(PKG_DIR, 'package.json'), join(REPO_ROOT, 'package.json')];
  const tried = [];
  for (const anchor of anchors) {
    try {
      return createRequire(anchor)('esbuild');
    } catch (error) {
      tried.push(`  - ${relative(REPO_ROOT, anchor)}: ${error.message}`);
    }
  }
  throw new BuildError(
    [
      'esbuild 不可用 —— 先跑仓库根的 `pnpm install`（会按本包 devDependencies 装 esbuild）。',
      '已尝试的解析锚点：',
      ...tried,
    ].join('\n'),
  );
}

/** 读并校验本包 package.json，返回后续要用的字段。 */
function readManifest() {
  const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'));
  const name = pkg.name;
  if (typeof name !== 'string' || name === '') {
    throw new BuildError('package.json 缺少 name：信封 id 必须等于包名，无法继续');
  }
  if (pkg.dsh?.client?.platform !== 'web') {
    throw new BuildError("package.json 需要 dsh.client.platform === 'web'");
  }
  const clientField = pkg.exports?.['./client'];
  const clientRel =
    typeof clientField === 'string' ? clientField : clientField?.default;
  if (typeof clientRel !== 'string' || clientRel === '') {
    throw new BuildError('package.json 需要 exports["./client"]（字符串或带 default 的对象）');
  }
  if (join(PKG_DIR, clientRel) !== OUT_FILE) {
    throw new BuildError(
      `exports["./client"] = ${clientRel}，但本管线写 ${relative(PKG_DIR, OUT_FILE)}：` +
        '主机侧按 exports["./client"] 定位文件，两者必须一致',
    );
  }
  // 超出基线的外部依赖必须声明，否则浏览器运行时 require 会 miss module table。
  const declaredExternal = pkg.dsh.client.external ?? [];
  if (!Array.isArray(declaredExternal)) {
    throw new BuildError('dsh.client.external 必须是字符串数组');
  }
  return { name, declaredExternal };
}

/** 跑 esbuild：单文件 CJS、基线与已声明外部依赖全部 external、无 sourcemap、不压缩。 */
async function bundle(esbuild, { declaredExternal }) {
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    outfile: OUT_FILE,
    absWorkingDir: PKG_DIR,
    bundle: true,
    format: 'cjs', // factory 体内的模块格式就是 CJS
    platform: 'browser',
    // 与 `notes/client-plugin-contract.md` §(c) 的推荐构建目标一致：只保证不产出
    // 比 chrome100 更新的语法，不做无谓降级。
    target: 'chrome100',
    jsx: 'automatic', // 自动运行时：产物里是 require("react/jsx-runtime")
    jsxDev: false, // 强制生产版 JSX 变换（react/jsx-runtime），不要 jsxDEV
    external: [...BASELINE_EXTERNALS, ...declaredExternal],
    // utf8：官方产物同样带裸中文、无 BOM、零 \uXXXX 转义
    //（实测 `@deepseek-ai/dsh-client-ui-schedule/lib/client.js`：1126 个裸 CJK 字符）。
    charset: 'utf8',
    legalComments: 'none',
    minify: false, // 便于在 /plugins 组合视图里读源码，也让 DoD 的文本断言可读
    sourcemap: false, // 不产出 sourceMappingURL，避免指向不存在的文件
    treeShaking: true,
    logLevel: 'silent',
    write: false, // 取回文本自己套信封
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  if (result.outputFiles.length !== 1) {
    throw new BuildError(
      `期望恰好 1 个产物文件，实际 ${result.outputFiles.length} 个` +
        '（多余 chunk 需要 require.async 协议，本票明确不支持）',
    );
  }
  const [output] = result.outputFiles;
  if (output.path !== OUT_FILE) {
    throw new BuildError(`esbuild 输出到 ${output.path}，期望 ${OUT_FILE}`);
  }
  return output.text;
}

/**
 * 套信封。
 *
 * 关于**尾部**（这里踩过一次坑，别再改回去）：
 * esbuild 的 ESM→CJS 产物在中途会执行 `module.exports = __toCommonJS(...)`，
 * 也就是把 `module.exports` **换成另一个新对象**。因此
 * `var exports = module.exports`（本函数第 6 行）从那一刻起就是**过期引用**：
 * 往它上面逐个补拷 `apply`/`inject` 再 `return exports` 只能碰巧对 ——
 * 一旦将来多出第三个导出，它就会**静默丢失**（无需报错，插件少个成员而已）。
 * 本仓已用 vm 实测复现过这一点。
 * 正确写法就是样板那一句：**重新读取 `module.exports` 返回**，不逐个补拷。
 * `var exports` 保留是为了与样板同形，也兜住「万一某段包体是按 CJS 写的、
 * 真的引用 `exports`」的情况。
 *
 * 关于**缩进**：包体整体加两格 tab，但有护栏 —— 只有确认「逐行加前缀不会改到
 * 字符串内容」时才重排：
 *   - body 含反引号 → 可能有跨行模板字面量；
 *   - body 含行尾反斜杠 → 普通字符串里的续行。
 * 命中任一条就保持 0 缩进（观感让位于正确性），并在自检输出里注明实际走了哪条。
 *
 * @param bundleText - esbuild 产出的单文件 CJS 文本。
 * @param pkgName - 包名，用作信封 id。
 * @returns `{ code, reindentBlockedBy }`；后者为 null 表示已重排缩进。
 */
function wrapEnvelope(bundleText, pkgName) {
  let body = bundleText.replace(/\r\n/g, '\n').replace(/\n*$/, '\n');
  let strict = '';
  // esbuild 会在产物首行放 "use strict"；函数体的指令序言必须在最前面才生效，
  // 所以提到 var 声明之前。
  const strictLine = '"use strict";';
  if (body.startsWith(strictLine)) {
    strict = `\t\t${strictLine}\n`;
    body = body.slice(strictLine.length).replace(/^\n/, '');
  }

  // 缩进护栏（见上方文档）。宁可 0 缩进，也不改字符串内容。
  const reindentBlockedBy = body.includes('`')
    ? 'body 含反引号（可能有跨行模板字面量）'
    : /\\\n/.test(body)
      ? 'body 含行尾反斜杠（可能是字符串续行）'
      : null;
  if (reindentBlockedBy === null) {
    body = body
      .split('\n')
      .map((line) => (line === '' ? line : `\t\t${line}`))
      .join('\n');
  }

  const code =
    'window.__ModuleLoader__.load({\n' +
    `\tid: ${JSON.stringify(pkgName)},\n` +
    '\tfactory: (require) => {\n' +
    strict +
    '\t\tvar module = { exports: {} };\n' +
    '\t\tvar exports = module.exports;\n' +
    body +
    '\t\t// 包体中途执行过 module.exports = __toCommonJS(...)，上面的 exports 已过期；\n' +
    '\t\t// 必须重新读取 module.exports，逐个补拷会漏掉将来的新导出。\n' +
    '\t\treturn module.exports;\n' +
    '\t}\n' +
    '});\n';

  return { code, reindentBlockedBy };
}

/**
 * 在 Node 里真的执行一遍产物：用假 loader + 假 require 物化 factory，
 * 再拿假 ctx 调一次 apply，断言两个槽位注册的形状。
 *
 * 这是比文本断言强得多的自检 —— 它同时证伪：信封语法错误、factory 物化后
 * 拿不到 apply/inject、以及产物里残留了超出基线的 require。
 */
function executeArtifact(code, pkgName) {
  const registrations = [];
  const requested = [];
  const fakeWindow = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration);
      },
    },
  };
  const fakeRequire = (spec) => {
    requested.push(spec);
    if (spec === 'react/jsx-runtime') {
      const noop = () => null;
      return { Fragment: Symbol.for('react.fragment'), jsx: noop, jsxs: noop };
    }
    if (spec === 'react') {
      // 票 07 起组件用 `useSyncExternalStore`（main 面板键快照）等钩子：
      // apply 期不调 hook，只要求成员在（真浏览器走基线 module table 的真 react）。
      return {
        Fragment: Symbol.for('react.fragment'),
        createElement: () => null,
        useState: (initial) => [initial, () => {}],
        useEffect: () => {},
        useMemo: (factory) => factory(),
        useRef: () => ({ current: undefined }),
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      };
    }
    throw new Error(`Unexpected require("${spec}") during in-process self-check`);
  };
  vm.runInNewContext(code, { window: fakeWindow }, { filename: 'lib/client.js' });

  if (registrations.length !== 1) {
    throw new BuildError(
      `产物必须恰好调用一次 __ModuleLoader__.load()，实际 ${registrations.length} 次`,
    );
  }
  const registration = registrations[0];
  if (registration.id !== pkgName) {
    throw new BuildError(`信封 id 应为 ${pkgName}，实际 ${String(registration.id)}`);
  }
  if (typeof registration.factory !== 'function') {
    throw new BuildError('信封缺少 factory 函数');
  }

  const plugin = registration.factory(fakeRequire);
  if (typeof plugin?.apply !== 'function') {
    throw new BuildError('factory 返回的插件对象缺少 apply 函数');
  }
  if (!Array.isArray(plugin.inject)) {
    throw new BuildError('factory 返回的插件对象缺少 cordis 服务 inject 数组');
  }

  // 调用 apply，捕获它向槽位注册了什么、以及默认面板/token 覆盖层的副作用。
  const slotCalls = [];
  const sideEffects = [];
  const fakeCtx = {
    effect(callback) {
      // 真实现会立刻跑回调并把返回的 disposer 挂到 fiber 上；这里照做。
      const disposer = callback();
      return typeof disposer === 'function' ? disposer : () => {};
    },
    theme: {
      overrideTokens(source, tokens) {
        sideEffects.push({
          kind: 'overrideTokens',
          source,
          tokenCount: tokens === null || typeof tokens !== 'object' ? 0 : Object.keys(tokens).length,
        });
        return () => {};
      },
    },
    layout: {
      selectPanel(panelId) {
        sideEffects.push({ kind: 'selectPanel', panelId });
      },
    },
    slots: {
      inject(key, callback) {
        slotCalls.push({ kind: 'inject', key });
        callback();
        return () => {};
      },
      register(options, component) {
        slotCalls.push({ kind: 'register', options, component });
        // 副作用序列里也记一笔：默认面板必须晚于 main 注册（见 checkSlotCalls 的顺序断言）。
        sideEffects.push({ kind: 'register', name: options?.name });
        return () => {};
      },
      entries() {
        return [];
      },
      subscribe() {
        return () => {};
      },
    },
  };
  plugin.apply(fakeCtx);

  return { requested, slotCalls, sideEffects, plugin };
}

/** 校验 apply 注册的槽位形状与默认面板/token 覆盖层副作用（票 07 契约）。 */
function checkSlotCalls(slotCalls, sideEffects) {
  const registers = slotCalls.filter((call) => call.kind === 'register').map((call) => call.options);
  const injected = slotCalls.filter((call) => call.kind === 'inject').map((call) => call.key);
  const problems = [];

  if (!injected.includes('main')) problems.push('未对 `main` 槽调用 ctx.slots.inject');
  if (!injected.includes('sidebar.panellist')) {
    problems.push('未对 `sidebar.panellist` 槽调用 ctx.slots.inject');
  }

  const main = registers.find((options) => options.name === 'main');
  const row = registers.find((options) => options.name === 'sidebar.panellist');

  if (main === undefined) problems.push('未注册 `main` 槽');
  else if (main.key !== 'overview') {
    problems.push(`main 槽 key 应为 "overview"，实际 ${JSON.stringify(main.key)}`);
  }

  if (row === undefined) problems.push('未注册 `sidebar.panellist` 槽');
  else if (row.id !== 'overview') {
    problems.push(`sidebar.panellist 行 id 应为 "overview"，实际 ${JSON.stringify(row.id)}`);
  }

  if (main !== undefined && row !== undefined && main.key !== row.id) {
    problems.push(
      `main.key (${JSON.stringify(main.key)}) 与 sidebar.panellist.id (${JSON.stringify(row.id)}) 必须相同`,
    );
  }

  // ── 票 07（首页替换）：默认面板 + token 覆盖层 + 注入面（契约注记 §1） ──
  if (main !== undefined && typeof main.inject !== 'function') {
    problems.push('main 注册选项缺少 `inject` 注入函数（四卡拿不到 navigate / mainPanels）');
  } else if (main !== undefined) {
    const provided = main.inject();
    if (typeof provided?.navigate !== 'function') problems.push('main 的 inject 没有提供 navigate 函数');
    if (provided?.mainPanels === undefined) problems.push('main 的 inject 没有提供 mainPanels watch');
    else if (typeof provided.mainPanels.getSnapshot !== 'function' || typeof provided.mainPanels.subscribe !== 'function') {
      problems.push('inject 提供的 mainPanels 不是 { subscribe, getSnapshot } 形状');
    }
  }

  const overrides = sideEffects.filter((effect) => effect.kind === 'overrideTokens');
  if (overrides.length !== 1) {
    problems.push(`ctx.theme.overrideTokens 应恰好调用一次，实际 ${overrides.length} 次`);
  } else {
    if (overrides[0].source !== 'xuanshu-ui-v1') {
      problems.push(`token 覆盖层 source 应为 "xuanshu-ui-v1"，实际 ${JSON.stringify(overrides[0].source)}`);
    }
    if (!(overrides[0].tokenCount > 0)) problems.push('token 覆盖层是空的（xs-tokens.json 没接上）');
  }

  const selections = sideEffects.filter((effect) => effect.kind === 'selectPanel');
  if (selections.length !== 1) {
    problems.push(`ctx.layout.selectPanel 应恰好调用一次（默认面板），实际 ${selections.length} 次`);
  } else if (selections[0].panelId !== 'overview') {
    problems.push(`默认面板应为 "overview"，实际 ${JSON.stringify(selections[0].panelId)}`);
  }
  // 顺序：默认面板必须在 main 注册**成功之后**切（selectPanel 对未注册 key 会 throw）。
  const mainIndex = sideEffects.findIndex((effect) => effect.kind === 'register' && effect.name === 'main');
  const selectIndex = sideEffects.findIndex((effect) => effect.kind === 'selectPanel');
  if (mainIndex >= 0 && selectIndex >= 0 && selectIndex < mainIndex) {
    problems.push('ctx.layout.selectPanel 发生在 main 注册之前（会 throw：selectPanel 对未注册 key 不容错）');
  }

  return problems;
}

/**
 * 读出 esbuild 的 ESM→CJS 产物**声明**了哪些导出名
 * （`__export(<obj>, { name: () => name, ... })`）。
 *
 * 用途：把「返回对象上真的有这些导出」变成行为断言。
 * 这正对着上面尾部那条坑 —— 逐个补拷的实现会让这里多出来的键静默消失。
 * @param bundleText - esbuild 产出的单文件 CJS 文本（未套信封）。
 * @returns 声明的导出名（去重）。
 */
function readDeclaredExports(bundleText) {
  const names = new Set();
  for (const block of bundleText.matchAll(/__export\(\s*[\w$]+\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
    for (const key of block[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:/g)) names.add(key[1]);
  }
  return [...names];
}

/** 静态产物断言（DoD / seam S3 的文本面）。 */
function checkArtifactText(code, pkgName, expectedRequires, declaredExternal) {
  const problems = [];
  const allowed = new Set([...BASELINE_EXTERNALS, ...declaredExternal]);
  if (!code.startsWith('window.__ModuleLoader__.load(')) {
    problems.push('产物首行不是 `window.__ModuleLoader__.load(`');
  }
  if (!code.includes(`id: ${JSON.stringify(pkgName)}`)) {
    problems.push(`产物缺少信封印 id 字面量 id: ${JSON.stringify(pkgName)}`);
  }
  // 注意：这里**不**断言字面量 `exports.apply` —— 产物走的是
  // `return module.exports`（bundle 的 CJS 互操作对象），不存在该字面量。
  // 导出面一律用行为断言（见 checkDeclaredExports），比文本 grep 更强。
  if ((code.match(/__ModuleLoader__\.load\(/g) ?? []).length !== 1) {
    problems.push('产物必须恰好调用一次 __ModuleLoader__.load(');
  }
  if (/sourceMappingURL/.test(code)) problems.push('产物含 sourceMappingURL（本票不产出 map）');
  for (const abs of [REPO_ROOT, REPO_ROOT.replaceAll('\\', '/')]) {
    if (code.includes(abs)) problems.push(`产物含仓库绝对路径（非确定性）：${abs}`);
  }

  // 外部依赖必须全部落在基线 ∪ 已声明集合内（否则浏览器 require 会 miss module table）。
  for (const spec of expectedRequires) {
    if (!allowed.has(spec)) {
      problems.push(`产物 require("${spec}") 不在基线外部依赖表内，必须写进 dsh.client.external`);
    }
  }
  // react / react-dom 的实现不得被打进产物。
  for (const marker of ['react.development', 'ReactCurrentOwner', 'react-dom.development']) {
    if (code.includes(marker)) problems.push(`产物疑似内联了 react 实现（命中标记 ${marker}）`);
  }
  return problems;
}

/**
 * 行为断言：**factory 返回对象**上的插件导出面。
 *
 * 这是替代「产物含 exports.apply」字面 grep 的那一层 —— 它断言的是运行期事实，
 * 而不是产物里恰好出现过某个字符串。
 * @param plugin - factory 的返回值。
 * @param declaredExports - 从包体读出的导出名；逐个断言在返回对象上真的存在。
 * @returns 问题清单（空 = 通过）。
 */
function checkDeclaredExports(plugin, declaredExports) {
  const problems = [];
  if (typeof plugin?.apply !== 'function') {
    problems.push('factory 返回对象上 typeof apply !== "function"');
  }
  if (!Array.isArray(plugin?.inject)) {
    problems.push('factory 返回对象上 inject 不是数组');
  }
  if (declaredExports.length === 0) {
    // 护栏本身不能是空转：读不出导出名就说明 esbuild 产物形态变了，得有人看一眼。
    problems.push('未能从包体读出任何导出名（esbuild 产物形态可能已变，护栏失效）');
  }
  for (const name of declaredExports) {
    if (!Object.prototype.hasOwnProperty.call(plugin, name)) {
      problems.push(`包体声明了导出 \`${name}\`，但 factory 返回对象上没有它（导出被静默丢弃）`);
    }
  }
  return problems;
}

/**
 * 回归探针：证明「将来多一个导出」不会丢。
 *
 * 往产物里**注入第三个导出**（`__probe = 42`）再物化一次，断言它出现在
 * factory 的返回对象上。这正是旧尾部（`var exports = module.exports` 逐个补拷
 * `apply`/`inject` 后 `return exports`）会失败的场景 —— 旧写法在本仓实测会让
 * 注入的导出静默消失。有这条探针，谁把尾部改回去都会在构建期被拦下。
 *
 * @param code - 已套信封的产物文本。
 * @param pkgName - 包名（透传给执行器校验信封 id）。
 * @returns 问题清单（空 = 通过）。
 */
function probeExportForwarding(code, pkgName) {
  const probed = code.replace(
    /__export\(\s*([\w$]+)\s*,\s*\{/,
    'var __probe = 42;\n__export($1, {\n  __probe: () => __probe,',
  );
  if (probed === code) {
    return ['导出转发回归探针未能改写产物（esbuild 产物形态已变），探针已失效，请更新本函数'];
  }
  let plugin;
  try {
    plugin = executeArtifact(probed, pkgName).plugin;
  } catch (error) {
    return [`导出转发回归探针执行失败：${error instanceof Error ? error.message : String(error)}`];
  }
  if (plugin.__probe !== 42) {
    return [
      '导出转发回归探针失败：注入的第三个导出没有出现在返回对象上' +
        '（信封尾部又变回过期引用逐个补拷了？应保持 `return module.exports;`）',
    ];
  }
  return [];
}

/**
 * 逐字节比较「本次构建的产物」与「磁盘上那份」，找出**首个不同行**（1 基）。
 *
 * 为什么要行号：锚点漂移只差一两个字符时，光看体积根本不知道差在哪。
 * 行数不同时，多出来的第一行就是首个不同行。
 *
 * @param left - 本次构建的文本（期望值）。
 * @param right - 磁盘上的文本（实际提交的那份）。
 * @returns `{ line, left, right }`：首个不同行号与两侧该行内容；一致返回 null。
 */
function firstDifference(left, right) {
  if (left === right) return null;
  const leftLines = left.split('\n');
  const rightLines = right.split('\n');
  const count = Math.max(leftLines.length, rightLines.length);
  for (let index = 0; index < count; index += 1) {
    const a = leftLines[index];
    const b = rightLines[index];
    if (a !== b) {
      return { line: index + 1, left: a ?? '(文件在此结束)', right: b ?? '(文件在此结束)' };
    }
  }
  return { line: count, left: '(尾部有不可见差异)', right: '(尾部有不可见差异)' };
}

/**
 * `--check`：不写盘，把本次构建结果与磁盘上的 `lib/client.js` 逐字节比较。
 *
 * 这是「提交的产物与 `src/**` 同步」的唯一机器判据（`pnpm test` 不跑构建，
 * `tests/assembly/build-pipeline.test.mjs` 就是拿它当断言）。
 *
 * @param code - 本次构建 + 自检通过的产物文本。
 * @returns 一行比对结论（in sync / 不同步的说明）。
 */
function compareWithDisk(code) {
  if (!existsSync(OUT_FILE)) {
    throw new BuildError(
      `${relative(REPO_ROOT, OUT_FILE)} 不存在：产物与源码不同步，请跑 pnpm build:client`,
    );
  }
  const onDisk = readFileSync(OUT_FILE, 'utf8');
  const diff = firstDifference(code, onDisk);
  if (diff === null) {
    return `in sync  ${relative(REPO_ROOT, OUT_FILE)}（${Buffer.byteLength(onDisk, 'utf8')} bytes）`;
  }
  throw new BuildError(
    [
      '产物与源码不同步，请跑 pnpm build:client',
      `  首个不同行：第 ${diff.line} 行`,
      `    本次构建：${diff.left}`,
      `    磁盘上  ：${diff.right}`,
    ].join('\n'),
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // 先校验清单（纯读文件，不依赖依赖树），再解析 esbuild：路径/包名自相矛盾时
  // 应该先报那个，而不是先抱怨「esbuild 没装」。
  const { name, declaredExternal } = readManifest();
  const esbuild = loadEsbuild();
  const bundleText = await bundle(esbuild, { declaredExternal });
  const declaredExports = readDeclaredExports(bundleText);
  const { code, reindentBlockedBy } = wrapEnvelope(bundleText, name);

  const executed = executeArtifact(code, name);

  const problems = [
    ...checkArtifactText(code, name, executed.requested, declaredExternal),
    ...checkDeclaredExports(executed.plugin, declaredExports),
    ...probeExportForwarding(code, name),
    ...checkSlotCalls(executed.slotCalls, executed.sideEffects),
  ];
  if (problems.length > 0) {
    throw new BuildError(
      `产物自检未通过：\n${problems.map((line) => `  - ${line}`).join('\n')}`,
    );
  }

  // ── 自检全过之后才落盘（理由见文件头「写盘时序」） ──
  let checkNote;
  if (opts.check) {
    checkNote = compareWithDisk(code);
  } else {
    mkdirSync(dirname(OUT_FILE), { recursive: true });
    writeFileSync(OUT_FILE, code, 'utf8');
  }

  const bytes = Buffer.byteLength(code, 'utf8');
  const cjk = (code.match(/[\u4e00-\u9fff]/g) ?? []).length;
  // esbuild 会为每个用到 JSX 运行时的源模块各发一次 require（同一 spec 会重复出现）；
  // 展示时去重，校验时仍逐条过 allowed 集合。
  const externalList = [...new Set(executed.requested)];
  const requireCount = executed.requested.length;
  const indentNote =
    reindentBlockedBy === null ? '已整体重排为两格 tab' : `跳过重排：${reindentBlockedBy}`;

  console.log(`[build-client] ${opts.check ? 'check' : 'ok'}  ${relative(REPO_ROOT, OUT_FILE)}`);
  console.log(`[build-client]     包名 / 信封 id : ${name}`);
  console.log(`[build-client]     产物体积      : ${bytes} bytes (${code.split('\n').length - 1} 行, 裸 CJK ${cjk} 字符)`);
  console.log(`[build-client]     external      : ${externalList.join(', ') || '(无)'}${requireCount > externalList.length ? `（${requireCount} 次 require，loader 侧按模块表缓存）` : ''}`);
  console.log(`[build-client]     cordis inject : ${JSON.stringify(executed.plugin.inject)}`);
  console.log(`[build-client]     导出行为断言  : ${declaredExports.join(', ')} 全部存在于返回对象`);
  console.log('[build-client]     导出转发探针  : 注入第三个导出后仍在返回对象上（旧尾部写法会被此探针拦下）');
  console.log(`[build-client]     槽位/面板副作用: ${executed.sideEffects.map((effect) => (effect.kind === 'register' ? `register(${String(effect.name)})` : effect.kind === 'selectPanel' ? `selectPanel(${String(effect.panelId)})` : `overrideTokens(${String(effect.source)}×${String(effect.tokenCount)})`)).join(' → ') || '(无)'}`);
  console.log(`[build-client]     缩进护栏      : ${indentNote}`);
  console.log('[build-client]     自检          : 信封 / 物化 / 导出面 / 槽位注册形状 / 外部依赖 全部通过');
  if (checkNote !== undefined) {
    console.log('[build-client]     写盘          : 跳过（--check）');
    console.log(`[build-client]     ${checkNote}`);
  }
}

main().catch((error) => {
  console.error(`[build-client] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
