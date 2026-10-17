/**
 * xuanshu-host — 玄枢主机插件（Node 侧）。
 *
 * 装配位置（契约 §2/§3）：profile `xuanshu` 的 `dsh.profile.bundles` 列到本包 →
 * 本包的 `dsh.bundle.patch`（cordis.patch.yml）把自己的插件行
 * `{ id: xuanshu-host, name: xuanshu-host }` 插进 profile 补丁栈 → 运行时树里多一行，
 * 本文件就是那一行的实现。
 *
 * 本票（票 01）职责只有两件，全是纯本地文件操作：
 *   1. 建好数据目录 `$DSH_HOME/xuanshu/`（契约 §0/§3.1）；
 *   2. 写出装配报告 `$DSH_HOME/xuanshu/assembly-report.json`（schema
 *      `xuanshu/assembly-report@1`）——本票唯一的运行时可观察证据（seam S2）。
 * 另注册一个不依赖 LLM 的宿主侧可观察物（契约 §3 第 3 条）：斜杠命令
 * `/xuanshu-report`，就地重探并重写报告后把摘要回给人类界面。
 *
 * 硬约束（契约 §3）：不发起 LLM 调用、不联网、不监听端口。本文件只 import node 内置模块
 * （`node:fs`/`node:module`/`node:os`/`node:path`/`node:url`）与本包自己的 `./horosa/service.mjs`；
 * apply 的副作用仅限 mkdir/writeFile、一次可选命令注册，以及票 06 的 horosa 装配
 * （`installHorosa` 自己**立即返回**：起 serve 是延后 + unref 的后台任务，见 `lib/horosa/service.mjs`）。
 *
 * 票 06 追加（本包的另一半能力，全在 `lib/horosa/**`）：horosa 底座 ——
 * `installHorosa(ctx, config)` 解析 plan → 检查 runtime 同版本 → 四态裁决 → 起/复用本地
 * serve → 注册 `xuanshuHorosa` 服务（`status/ensure/start/stop/waitReady/baziBirth/snapshot`）
 * 与 `/xuanshu-horosa` 命令，并把状态写进 `$DSH_HOME/xuanshu/horosa/horosa-status.json`。
 * 它同样**永不抛**：宿主起不来的失败只落状态文件 + 日志，绝不拖垮整个 profile 装配。
 *
 * 票 08 追加（`lib/bazi/**`）：八字冷启动的宿主半边 —— 六个 `bazi.*` 方法并进同一条 `/xuanshu`
 * 通道（`createBaziMethods`）：`status`/`snapshot`/`basePu`/`cities`/`timezone`/`cast`。
 * 出盘只走上面那个 `xuanshuHorosa` 服务的 `baziBirth()`，落 `<dataDir>/bazi/snapshot.json`
 * 与 `<dataDir>/pus/_base/{manifest.md,bazi.md,summary.md}`（契约 §1 的文件契约）。
 *
 * 票 13 追加（`lib/digao/**` + `lib/rikke/**`）：底稿（纯派生、**无** write/update：`digao.refresh`
 * 整文件原子重写，LLM 只压一段、失败标 `digest:'skeleton'`）与日课（`rikke.generate` 只走本地
 * horosa 的 `horosa_cn_huangli`，落 `<dataDir>/rikke/<YYYY-MM-DD>.json`），外加**两条 daily
 * 定时任务**（日课 07:30 / 底稿刷新 03:30，`ctx.schedule.create` + 玄枢自铸会话 id）。
 * `ctx.schedule` 的提供者不在 shipped 组合里，由本包的 `cordis.patch.yml` 插 schedule 三行带上。
 *
 * 票 15 追加（`lib/sediment/**`）：沉淀闭环的三条 RPC（`sediment.draft/commit/discard`）
 * 与内置 skill `xuanshu:sediment`。分工是这一票的全部要点：`draft` 只让那场问事会话产出草稿并
 * 暂存 `<dataDir>/sediment/<draftId>.json`；`commit` 的第一行检查 `confirmed === true`，
 * 之后才走票 09 的 `pu.update`（同一套 staging + rename）——**AI 不静默、不自动写谱**。
 * 面版的客户端半边在 `packages/xuanshu-client/src/client/sediment*.tsx`。
 *
 * 每个 DSH API 调用的出处（本机实装 0.2.0-rc.2，均为只读核对）：
 *   - `ctx.get(name, strict?)`：`@deepseek-ai/cordis/lib/types/reflect.d.ts:16`；
 *     非严格第二参数 `false` 的官方用法见
 *     `@linxin666/dsh-client-ui-skill-explorer/lib/index.js:60`。
 *   - `ctx.get('profileContext')` → `ProfileContext{name,dir,home,installAnchor,cwd,…}`：
 *     `@deepseek-ai/dsh-app-boot/lib/types/profile-context.d.ts:10-25`。
 *   - `ctx.get('loader').entries()` = 本进程可见的补丁行（运行时插件树）：
 *     `Loader extends EntryTree`（`@deepseek-ai/cordis-plugin-loader/lib/types/index.d.ts:66`）、
 *     `EntryTree.entries()`（`.../config/tree.d.ts:14-15`）、`Entry.id`（`.../config/entry.d.ts:33`）；
 *     官方同款遍历见 `@deepseek-ai/dsh-plugin-manager/lib/index.js:1434,1875` 的
 *     `[...this.ctx.loader.entries()]`。
 *   - `ctx.effect(cb, label?)`：`@deepseek-ai/cordis/lib/types/fiber.d.ts:157`；
 *     `ctx.commands.register(def) → disposer`：`@deepseek-ai/dsh-commands/lib/types/index.d.ts:94`；
 *     返回体 `CommandResult`：`.../dsh-commands/lib/types/types.d.ts:33-41`。
 *   - `ctx.logger(name)`：`@deepseek-ai/cordis/lib/types/context.d.ts:26-27`、`logger.d.ts:84`。
 *
 * 报告里的两个插件键（`xuanshu-host` / `xuanshu-client`）一律**运行时探测**得出：
 * 读两个包各自的 package.json（本包用模块位置，对端包用 profile 安装点解析），
 * 拿不到就留空并记 note，绝不硬编码版本或路径（契约 §3.1）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBaziMethods } from './bazi/service.mjs';
import { createBestOfMethods } from './consult/bestof.mjs';
import { createRouteMethods } from './consult/routes.mjs';
import { installConsultBoundary } from './consult/boundary.mjs';
import { createCangMethods } from './cang/service.mjs';
import { createConsultMethods } from './consult/service.mjs';
import { createDigaoMethods } from './digao/service.mjs';
import { installHorosa } from './horosa/service.mjs';
import { createTrafficMethods } from './notify/service.mjs';
import { createPuMethods, installPuSkill } from './pu/service.mjs';
import { DEFAULT_TIME_ZONE, installDailyTasks } from './rikke/daily-tasks.mjs';
import { baseZone, createRikkeMethods } from './rikke/service.mjs';
import { installRpc } from './rpc.mjs';
import { createSedimentMethods } from './sediment/service.mjs';
import { installSedimentSkill } from './sediment/skill.mjs';
import { createWorkflowMethods } from './workflow/service.mjs';

/** cordis 插件名（= 包名 = 补丁行 id，契约 §0）。 */
export const name = 'xuanshu-host';

/**
 * 必需 service 列表：**刻意为空**。本插件只做本地文件初始化，不依赖任何宿主
 * service；一旦 inject 了拿不到的 service，本行会永远 pending，装配报告就写不出来，
 * 反而让 seam S2 失去证据。所有 service 一律用非严格 `ctx.get(name, false)` 软取。
 */
export const inject = [];

/** 报告 schema 标识（契约 §0/§3.1 定值）。 */
const REPORT_SCHEMA = 'xuanshu/assembly-report@1';
/** 数据目录名：`$DSH_HOME/xuanshu/`（契约 §0）。 */
const DATA_DIR_NAME = 'xuanshu';
/** 装配报告文件名（契约 §0）。 */
const REPORT_FILENAME = 'assembly-report.json';
/** profile 名兜底值：契约 §0 定值，仅在 profileContext 不可得时使用。 */
const FALLBACK_PROFILE_NAME = 'xuanshu';
/** 与本包同装的对端包名（契约 §0；键名固定，版本/路径必须运行时探测）。 */
const PEER_PACKAGE = 'xuanshu-client';
/** DSH 版本探测顺序：先 CLI 包，再退回同版发布的其他官方包。 */
const DSH_PACKAGE_CANDIDATES = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-headless', '@deepseek-ai/dsh-base'];
/** 命令名（契约 §3 第 3 条的可观察物；小写、不带斜杠）。 */
const COMMAND_NAME = 'xuanshu-report';

/** 本模块文件路径与其所在包根（`<pkg>/lib/index.js` → `<pkg>`）。 */
const MODULE_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = dirname(dirname(MODULE_FILE));
const requireFromHere = createRequire(import.meta.url);

/** 去重去空串的小工具。 */
function unique(values) {
  const out = [];
  for (const value of values) {
    if (typeof value === 'string' && value !== '' && !out.includes(value)) out.push(value);
  }
  return out;
}

/** 读一个 JSON 文件；任何异常（不存在/非 JSON）都返回 undefined。 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** 非严格读取一个 cordis service：没有该 service（或 ctx 形状不对）都返回 undefined。 */
function softGet(ctx, serviceName) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(serviceName, false) : undefined;
  } catch {
    return undefined;
  }
}

/** 取一个带作用域名的 logger；宿主没装 logger 时返回静默替身。 */
function namedLogger(ctx) {
  try {
    const logger = ctx?.logger;
    if (typeof logger === 'function') {
      const scoped = logger(name);
      if (scoped !== null && scoped !== undefined) return scoped;
    }
    if (logger !== null && logger !== undefined) return logger;
  } catch {
    /* 落到静默替身 */
  }
  return { info() {}, warn() {} };
}

/**
 * 探测一个已安装包的清单：本包直接读模块旁边的 package.json，
 * 对端包从 profile 安装点解析 `<specifier>/package.json`。
 * @returns `{ version, dir }`；解析不到返回 undefined（调用方留空 + 记 note，不伪造）。
 */
function probePackage(specifier, searchDirs, selfName) {
  let manifestFile;
  if (selfName !== undefined && specifier === selfName) {
    manifestFile = join(PACKAGE_ROOT, 'package.json');
  } else {
    manifestFile = resolveInstalledManifest(specifier, searchDirs);
  }
  if (manifestFile === undefined || !existsSync(manifestFile)) return undefined;
  const manifest = readJson(manifestFile);
  if (manifest === undefined || typeof manifest.version !== 'string' || manifest.version === '') return undefined;
  return { version: manifest.version, dir: dirname(manifestFile) };
}

/**
 * 解析 `<specifier>/package.json`：先按 Node 的 `require.resolve` 从候选安装点
 * （profile 目录 / 安装锚点 / cwd / 本包目录）解析，再退回直查
 * `<候选点>/node_modules/<specifier>/package.json`（pnpm hoisted 布局）。
 */
function resolveInstalledManifest(specifier, searchDirs) {
  const request = `${specifier}/package.json`;
  try {
    return requireFromHere.resolve(request, { paths: searchDirs });
  } catch {
    /* 退回直查安装布局 */
  }
  for (const base of searchDirs) {
    const parts = specifier.split('/');
    const candidate = join(base, 'node_modules', ...parts, 'package.json');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** 解析 DSH home：profileContext.home → `$DSH_HOME` → `~/.dsh`（官方默认口径）。 */
function resolveDshHome(profileCtx, notes) {
  if (typeof profileCtx?.home === 'string' && profileCtx.home !== '') return profileCtx.home;
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv;
  notes.push('DSH_HOME 未设置且 profileContext 不可得：数据目录按官方默认回退到 <home>/.dsh。');
  return join(homedir(), '.dsh');
}

/**
 * 解析数据目录：`config.dataDir` 覆盖优先（测试用），否则 `<dshHome>/xuanshu`。
 * 装配报告与「谱 / 藏」能力**共用这一份**——两处各算一遍就会出现
 * 「报告写在 A、谱落在 B」这种最难查的错位。
 */
function resolveDataDir(dshHome, config) {
  return typeof config?.dataDir === 'string' && config.dataDir !== ''
    ? config.dataDir
    : join(dshHome, DATA_DIR_NAME);
}

/**
 * 采集本进程可见的补丁行 id：`ctx.get('loader').entries()` 全树遍历，取每行的
 * `Entry.options.id`（= 补丁文件里写的行 id），去重后字典序排序（契约 §3.1 的 `patchRowIds`）。
 *
 * 为什么取 `options.id` 而不是 `Entry.id`：`Entry.id` 是**路径形态**——只要这棵树挂在某个
 * entry 下（dsh-app-boot 的根 include 行 id 就是 `include`），`get id()` 会返回
 * `include:xuanshu-host`（`@deepseek-ai/cordis-plugin-loader/lib/index.js:328-332`）。
 * 契约 §0 的 id 定值、`dsh --profile xuanshu --dump-config` 打印的 id（seam S1）用的都是
 * 补丁行自身 id，所以报告里也取这一形态，两侧可直接比对。
 * 注意：本数组是**忠实枚举**，会包含 app-boot 合成的根 include 行（id `include`）与
 * 任何 group 行；需要「只含补丁层行」的消费方自行按 id 过滤。
 * @returns 排序数组；loader service 不可得时返回 undefined（调用方留空数组，不伪造）。
 */
function collectPatchRowIds(ctx) {
  const loader = softGet(ctx, 'loader');
  if (loader === undefined || typeof loader.entries !== 'function') return undefined;
  const ids = new Set();
  try {
    for (const entry of loader.entries()) {
      const id = typeof entry?.options?.id === 'string' ? entry.options.id : entry?.id;
      if (typeof id === 'string' && id !== '') ids.add(id);
    }
  } catch {
    return undefined;
  }
  return [...ids].sort();
}

/** 组装报告对象（纯采集，不写盘）。 */
function buildReport(ctx, config) {
  const notes = [];

  const profileCtx = softGet(ctx, 'profileContext');
  if (profileCtx === undefined) {
    notes.push('profileContext 服务不可得：profile 名/目录按 DSH_HOME 与契约 §0 定值推导。');
  }
  const profileName =
    typeof profileCtx?.name === 'string' && profileCtx.name !== '' ? profileCtx.name : FALLBACK_PROFILE_NAME;
  const dshHome = resolveDshHome(profileCtx, notes);
  const profileDir =
    typeof profileCtx?.dir === 'string' && profileCtx.dir !== '' ? profileCtx.dir : join(dshHome, 'profiles', profileName);

  const selfManifest = readJson(join(PACKAGE_ROOT, 'package.json'));
  const selfName = typeof selfManifest?.name === 'string' && selfManifest.name !== '' ? selfManifest.name : undefined;
  if (selfName === undefined) notes.push('本包 package.json 的 name 读不出：跳过本包自身的清单探测。');

  const searchDirs = unique([
    profileCtx?.dir,
    profileCtx?.installAnchor,
    profileCtx?.cwd,
    process.cwd(),
    PACKAGE_ROOT,
    profileDir,
  ]);

  const specifiers = unique([selfName, PEER_PACKAGE]);
  const plugins = {};
  for (const specifier of specifiers) {
    const probed = probePackage(specifier, searchDirs, selfName);
    if (probed === undefined) {
      notes.push(`插件包 ${specifier} 未在 profile 安装点解析到 package.json：该键留空（未伪造版本/路径）。`);
      continue;
    }
    plugins[specifier] = { version: probed.version, dir: probed.dir };
  }

  const patchRowIds = collectPatchRowIds(ctx);
  if (patchRowIds === undefined) {
    notes.push("loader 服务不可得或不可遍历：patchRowIds 留空数组（未伪造补丁行）。");
  }

  let dshVersion = '';
  for (const candidate of DSH_PACKAGE_CANDIDATES) {
    const probed = probePackage(candidate, searchDirs, selfName);
    if (probed !== undefined) {
      dshVersion = probed.version;
      break;
    }
  }
  if (dshVersion === '') notes.push('DSH 版本探测失败（@deepseek-ai/dsh 等包均未解析到）：dsh.version 留空串。');

  const dataDir = resolveDataDir(dshHome, config);

  const report = {
    schema: REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    ok: false,
    profile: { name: profileName, dir: profileDir, dshHome },
    dsh: { version: dshVersion },
    runtime: { node: process.version, platform: process.platform },
    plugins,
    patchRowIds: patchRowIds ?? [],
    notes,
  };

  // ok = 本票装配的三项必查都过：profileContext 可得、两个插件包都解析到、两行 id 都在树里。
  // （`specifiers` 天然是「本包名 + PEER_PACKAGE」两个键，不必再数长度。）
  const missingRows = specifiers.filter((specifier) => report.patchRowIds.includes(specifier) !== true);
  if (missingRows.length > 0) notes.push(`补丁行未出现在本进程树中：${missingRows.join(', ')}。`);
  const allProbed = specifiers.every((specifier) => plugins[specifier] !== undefined);
  report.ok = profileCtx !== undefined && allProbed && missingRows.length === 0;

  return { report, dataDir };
}

/** 临时文件名序号：同一进程内多次写报告也不会撞名。 */
let writeSeq = 0;

/** 原子写报告（同目录临时文件 + rename 覆盖），返回落盘绝对路径。 */
function writeReportFile(dataDir, report) {
  mkdirSync(dataDir, { recursive: true });
  const target = join(dataDir, REPORT_FILENAME);
  writeSeq += 1;
  const tmp = join(dataDir, `.${REPORT_FILENAME}.${process.pid}.${Date.now().toString(36)}.${writeSeq.toString(36)}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    renameSync(tmp, target);
  } catch (error) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* 临时文件清不掉不掩盖原错误 */
    }
    throw error;
  }
  return target;
}

/** 采集 + 落盘一次（命令处理器复用同一路径，保证「探到的」和「写下的」同源）。 */
function probeAndWrite(ctx, config) {
  const { report, dataDir } = buildReport(ctx, config);
  const file = writeReportFile(dataDir, report);
  return { report, file };
}

/** 人类可读的一行摘要（命令返回值用）。 */
function summarize(report, file) {
  const versions = Object.entries(report.plugins)
    .map(([specifier, probe]) => `${specifier}@${probe.version}`)
    .join('、');
  return [
    `ok=${report.ok}`,
    `报告：${file}`,
    `profile：${report.profile.name}（${report.profile.dir}）`,
    `数据目录：${report.profile.dshHome}`,
    `插件：${versions === '' ? '（未探测到）' : versions}`,
    `补丁行：${report.patchRowIds.length} 条`,
  ].join(' | ');
}

/**
 * 注册 `/xuanshu-report` 命令（契约 §3 第 3 条：不依赖 LLM 的宿主侧可观察物）。
 * commands service 不在场时静默跳过——报告本身才是本票的主证据，命令只是给人看的入口。
 * @returns 是否注册成功。
 */
function registerReportCommand(ctx, config) {
  const commands = softGet(ctx, 'commands');
  if (commands === undefined || typeof commands.register !== 'function' || typeof ctx?.effect !== 'function') {
    return false;
  }
  try {
    ctx.effect(() => {
      const dispose = commands.register({
        name: COMMAND_NAME,
        description: '玄枢装配报告：重建并写出 $DSH_HOME/xuanshu/assembly-report.json 后回报摘要',
        handler: () => {
          try {
            const { report, file } = probeAndWrite(ctx, config);
            return { kind: 'success', text: summarize(report, file) };
          } catch (error) {
            return { kind: 'error', text: `装配报告写入失败：${String(error?.message ?? error)}` };
          }
        },
      });
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    }, 'xuanshu-host: 装配报告命令');
    return true;
  } catch {
    return false;
  }
}

/**
 * 插件主体：建数据目录 + 写装配报告 + 注册报告命令。
 * 任何失败都只记日志，绝不抛出——装配失败会让整个 profile 起不来，
 * 而本插件的失败不该有那种权重（契约 §6 隔离与卫生）。
 *
 * 自票 13 起本函数仍是**同步立刻返回**（票 01 的纪律）：两条 daily 定时任务走
 * `ctx.inject(['schedule'], …)` 注册 —— 依赖就绪才回调，注册失败最多记一条 warn，绝不拖垮装配。
 * @param ctx - cordis 宿主上下文。
 * @param config - 补丁行的 config；可选 `dataDir` 覆盖数据目录（测试用）。
 */
export function apply(ctx, config) {
  const log = namedLogger(ctx);
  let written;
  try {
    written = probeAndWrite(ctx, config);
    log.info(
      '装配报告已写出 %C（ok=%s，补丁行 %d 条）',
      written.file,
      String(written.report.ok),
      written.report.patchRowIds.length,
    );
  } catch (error) {
    log.warn('装配报告写入失败：%C', String(error?.message ?? error));
  }
  if (registerReportCommand(ctx, config)) {
    log.info('已注册命令 /%s', COMMAND_NAME);
  }

  // 票 06：horosa 底座（宿主托管的 serve 生命周期 + 八字出盘）。**永不抛**，
  // 起 serve 由 installHorosa 内部安排成延后 + unref 的后台任务，这里立即返回。
  try {
    installHorosa(ctx, config);
  } catch (error) {
    // installHorosa 自己已经兜了一层；这里再兜一层，保证「装配报告」那条路永远不因 horosa 失败。
    log.warn('horosa 底座装配失败（已兜住）：%C', String(error?.message ?? error));
  }

  // 总装配：把宿主侧能力挂到同一条 `/xuanshu` RPC 通道上（票 09 谱 / 票 14 藏 / 票 08 八字 / 票 13 底稿·日课）。
  // 这四组方法各自的**实现**与断言台早就落地了，缺的只是「有人把它们接上」这一步——
  // 面板注册（客户端 `installPuPanel` / `installCangClient` / 票 13 的两张卡）与本处是同一次装配的两半。
  // 数据目录与装配报告同源（`resolveDataDir`），避免报告与数据各写一处。
  let dataDir;
  let dshHome;
  try {
    dshHome = resolveDshHome(softGet(ctx, 'profileContext'), []);
    dataDir = resolveDataDir(dshHome, config);
    installPuSkill(ctx);
    // 票 15：内置 skill `xuanshu:sediment`（把一场问事汇成「更新到谱」的草稿）。
    // 与票 09 的 create-pu 并列注册；拿不到 skills 服务时它自己静默跳过（主路径不依赖它）。
    installSedimentSkill(ctx);
    installRpc(ctx, {
      ...createPuMethods(ctx, { dataDir }),
      ...createCangMethods(ctx, { dataDir }),
      // 票 08：八字出盘 / 快照 / 底座谱 / 城市库 / 时区（契约 §2 的六个 bazi.* 方法）。
      // 出盘只走票 06 装出来的 `xuanshuHorosa` 服务（上面 installHorosa 已 provide 它），
      // 所以这一组必须排在 installHorosa 之后装配 —— 顺序是接线的一部分。
      ...createBaziMethods(ctx, { dataDir }),
      // 票 10：问事容器（`consult.create/send/list/read/rename/defaults`）。
      // 会话走 `ctx.agents.create` + 自铸 id 前缀 + 专用 cwd（`<dataDir>/consult`），
      // 清单落旁挂文件；底座谱/可选谱的读面分别只走票 08 的 `bazi.basePu` 与票 09 的 `pu.*`。
      ...createConsultMethods(ctx, { dataDir }),
      // 票 13：底稿（纯派生，没有 write/update）与日课（本地黄历 + 底座）。
      ...createDigaoMethods(ctx, { dataDir }),
      ...createRikkeMethods(ctx, { dataDir, env: process.env }),
      // #24：触达账 / 共享设置（`traffic.status` / `traffic.markRead` / `traffic.settings.*` /
      // `shell.settings.*`）。账本与设置都在 `<dataDir>/` 下，与日课产物同源。
      ...createTrafficMethods(ctx, { dataDir }),
      // 票 16：工作流创建向导（新会话 + seed 自动调 `/writing-skills`；导出 skill 落
      // `<dshHome>/skills/<kebab>/SKILL.md`）。`dshHome` 与数据目录同源，skill 才落对地方。
      ...createWorkflowMethods(ctx, { dataDir, dshHome }),
      // 票 15：沉淀闭环（`sediment.draft/commit/discard`）。草稿暂存 `<dataDir>/sediment/`，
      // 写回只走票 09 的 `pu.update`（同一条 staging + rename），`confirmed !== true` 一律拒收。
      // 放在最后：它对其它组是纯加性的，且必须排在 pu/consult 之后（复用它们的方法组当读/写面）。
      ...createSedimentMethods(ctx, { dataDir }),
      // 票 11：多 AI 合参（`bestof.run/state/adopt`）。
      // 候选并发多路 `ctx.llm.stream()`、judge 走单字段工具（ADR-0010），
      // 记录落 `<dataDir>/consult/<sessionId>.bestof.json`；`consult.*` 的六个方法一字不动。
      ...createBestOfMethods(ctx, { dataDir }),
      // 票 28：只读路由清单（`routes.list`）—— providers → models → keyConfigured、默认路由、
      // 可配置但未注册的家。**只读**：玄枢不写 provider 配置与密钥（那是 DSH「设置 → 模型」的职责）。
      ...createRouteMethods(ctx),
    });
    // 票 10/12 的**统一发问边界**（评审 R2/R3/R4）：底座谱 / 底稿 / 勾选谱 / 临时挂载在
    // `agent/pre-step` 处按当前状态现算并并进每一步的模型输入 —— 谁发起的那一轮都一样
    // （门厅 composer / 原生 composer / 沉淀的 followup / 重启后恢复），且**不靠 inbox 排队**
    // （`dispose()` 会把待消费的消息撤掉）。细节与三条门写在 `lib/consult/boundary.mjs`。
    installConsultBoundary(ctx, { dataDir });
  } catch (error) {
    log.warn('谱 / 藏 / 八字 / 底稿 / 日课 / 工作流 RPC 装配失败（已兜住）：%C', String(error?.message ?? error));
  }

  // 票 13：两条 daily 定时任务（日课 07:30 / 底稿刷新 03:30）。
  //
  // **为什么用 `ctx.inject(['schedule'], …)` 而不是在这里直接 await**：
  // `schedule` 行由本包的 `cordis.patch.yml` 插进树里，它在运行时树中的**挂载时刻晚于本行** ——
  // apply 里直接 `ctx.get('schedule')` 会拿到 `undefined`（本票最恶劣的失败形态：boot 不报错、
  // 任务永远没建，而界面只是「未回传」）。`ctx.inject` 是 cordis 的「依赖就绪再回调」，
  // 它**不会**让本行 pending（票 01 那条 `inject = []` 的纪律仍然成立：拿不到 schedule 也只是少两条任务）。
  //
  // 注册本身是异步的（建会话 + 建任务都是 Promise 面），所以这里不阻塞 apply 返回；
  // 装配完成的判据是「树挂完」，而注入回调就在这一波里触发。
  if (dataDir !== undefined) {
    try {
      if (typeof ctx.inject === 'function') {
        ctx.inject(['schedule'], (scoped) => {
          const timeZone = safeBaseZone(dataDir);
          installDailyTasks({ ctx: scoped, dataDir, timeZone, env: process.env })
            .then((daily) => {
              log.info('票13 定时任务：日课=%s（%s）、底稿刷新=%s（%s）',
                daily.rikke.ok ? daily.rikke.task.id : '未建', daily.rikke.reused ? '复用' : '新建',
                daily.digao.ok ? daily.digao.task.id : '未建', daily.digao.reused ? '复用' : '新建');
              for (const note of daily.notes) log.warn('票13 %s', note);
            })
            .catch((error) => log.warn('票13 定时任务注册失败（已兜住）：%C', String(error?.message ?? error)));
          return () => {};
        });
      } else {
        log.warn('票13 ctx.inject 不可得：跳过两条 daily 定时任务的注册（其余装配不受影响）。');
      }
    } catch (error) {
      log.warn('票13 定时任务注册失败（已兜住）：%C', String(error?.message ?? error));
    }
  }
}

/** 底座里登记的时区（读快照；任何异常都退回缺省，只是「今天是哪一天」的兜底，不影响主流程）。 */
function safeBaseZone(dataDir) {
  try {
    return baseZone(dataDir);
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
