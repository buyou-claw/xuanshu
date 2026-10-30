#!/usr/bin/env node
/**
 * `scripts/ux/state-vocabulary.mjs` —— 判据族 `S`（状态齐全）/ `X`（文案一致性）共用的**口径常量**。
 *
 * 为什么单独一层：这三态与那一套说法必须**只有一份定义**。采集器照它找证据，
 * 判定谓词照它判对错；两处各写一份正则 = 「口径」变成两个东西，报告里的数字就不再可比。
 *
 * 本文件**不读文件、不判对错**，只有常量与一个把「一行源码」切成「代码部分」的小工具
 * （注释剥离）。判对错只在 `scripts/ux/assertions/`。
 *
 * ── 采集口径（先写在这里，免得下次有人以为这是漏采）──────────────────────────
 *
 * 界面是 React + 内联 CSS 字符串，没有可断言的渲染树（无 jsdom）。所以「这个面有没有该态」
 * 只能落成**源码事实**，不能落成「渲染出来长什么样」：
 *
 *   有该态  ⇔  该面源文件的**代码行**（注释已剥掉）里同时出现
 *              ① 该状态的**分支证据**：状态标识符出现在条件/守卫里（`{loading && …}`、
 *                 `view.kind === 'error' ?`、`if (error)`），或显式状态标记属性
 *                 （`data-xs-state="loading"`、`data-xuanshu-view="empty"`、`...-note="mounts-loading"`）；
 *              ② 该状态的**人话说明**：一句中文提示（「还没有…」「正在读…」「…失败」）。
 *              并且 ① 与 ② **落在同一个源文件里**（分支在 A 文件、话在 B 文件不算 —— 那说明
 *              这个面的状态是拼出来的，谁也不敢说渲染到人眼前时它还在）。
 *
 * 判严的方向（宁可误报红，不可漏报绿）：
 *   - **注释不算**：只在 JSDoc 里写「三态齐全」的，按缺席判；
 *   - **只有常量不算**：`const EMPTY_TEXT = '还没有'` 没有分支 → 缺席；
 *   - **只有状态名不算**：`type State = 'error'` 没有人话 → 缺席；
 *   - **未采到 ≠ 通过**：源文件读不到时采集器给 `collection-failed`，判定器不把它算通过。
 *
 * ── 文案口径（族 `X`）─────────────────────────────────────────────────────
 *
 * 出处：`docs/design/ui-v1/README.md` §3.3「状态名一律用同一套稳定名 …… 在同一屏内复用，
 * 不新造同义词」+ §3.4「只写「暂无数据」视为不合格」。
 *
 *   - 空态：允许「还没有…」（从未有过）与「没有匹配…」（筛掉了）两种；**不许**「暂无」「空的」
 *     「无记录」这类同义替换 —— 同一个意思在 25 个面上有两种叫法，人就得学两遍。
 *   - 加载态：允许「正在…」（正在读 / 正在统计 / 正在生成）；**不许**「加载中」「读取中」
 *     「请稍候」——它们与「正在…」并存就是两种说法。
 *   - 错误态：允许「失败」「读不到」「打不开」「不可用」；**不许**「出错」「错误」「异常」
 *     「出问题了」这类泛化说法（说了等于没说）。
 *   - 错误行必须有**可执行的下一步**（重试 / 再来一次 / 去某处配好 / 换个谱 …）：
 *     光说「失败了」而不给下一步，等于把闸门藏起来。
 *
 * 仅使用 Node 内置模块。ESM。
 */

/** 本族覆盖的三个状态。顺序 = 报告里的顺序（空 → 载 → 错），不要改。 */
export const STATES = ['empty', 'loading', 'error']

/** 判据 id → 状态。报告要按它把红归到「缺的是哪一态」。 */
export const CRITERION_STATE = {
  'S-001': 'empty',
  'S-002': 'loading',
  'S-003': 'error',
}

/** 状态的中文名（报告与证据里说人话）。 */
export const STATE_LABEL = {
  empty: '空态',
  loading: '加载态',
  error: '错误态',
}

/**
 * 状态在源码里的**标识符别名**（大小写敏感）。
 *
 * 为什么是白名单而不是「任何含 error 的词」：`setError` / `errorText` / `catch (error)` 满天飞，
 * 宽口径会把「写错误日志」判成「有错误态」。扫描器还会再套一层词边界（`(?<![\w$])…(?![\w$])`），
 * 所以 `setError` 不会被当成 `error` 的状态引用。
 */
export const STATE_ALIASES = {
  empty: ['empty', 'isEmpty', 'EMPTY', 'Empty'],
  // `busy` / `running` / `pending`：仓库里这三个词就是「进行中」（`{busy ? '正在处理…'}`、
  // `{running ? '生成中'}`、`data-xuanshu-note="city-pending"`）。它们是加载态的同义实现，
  // 单列出来是为了让「加载态在场」不依赖某个特定变量名。
  loading: ['loading', 'isLoading', 'skeleton', 'Skeleton', 'Loading', 'busy', 'running', 'pending'],
  error: ['error', 'isError', 'hasError', 'Error', 'failed', 'Failed', 'failure', 'Failure'],
}

/**
 * 「判空」这种分支：不叫 `empty` 也一样是空态分支（`!entries.length && …`、`list.length === 0 ?`）。
 *
 * 只认**真的在判空**的写法：`=== 0` / `== 0` / `!x.length`。`x.length > 0 ?` 是在判**非空**
 * （「有内容才渲染这一块」），把它算成空态分支会给一个根本没有空态的面上绿 —— 实测踩过：
 * `bestof-views.tsx` 的 `selected.length > 0 ? …` 曾把多 AI 合参的「空态」判成在场。
 * `=== undefined` 同样不算：它既可能表示「还没取到」（加载）也可能表示「本来就没有」（空），
 * 静态分不出来，硬算就是给判据开后门。
 */
export const EMPTINESS_TEST = /(?:\.length\s*(?:===|==)\s*0)|(?:(?:!!|!)\s*[A-Za-z_$][\w$.]*\.length\b)|(?:===\s*''|!==\s*'')/

/**
 * 「这一行把状态用在条件/守卫里」的语法线索。
 *
 * `?` 排除 `?.`（可选链）与 `?:`（TS 可选字段），否则 `stale?: boolean` 会被当成三元。
 * `!x` 单独算：`{!filtered.length && …}`、`if (!error)` 这种取反守卫是空态最常见的形式。
 */
export const CONTROL_OPERATOR = /&&|\?(?![\d.:])|===|!==|==|!=|\bif\s*\(|\belse\b|\bcase\b|\bswitch\s*\(|\?\?|!\s*[A-Za-z_$(]/

/**
 * 显式状态标记属性：仓库里的既有约定（`data-xs-state="loading"`、
 * `data-xuanshu-view="empty"`、`data-xuanshu-note="mounts-loading"`、`data-xuanshu-zone="unresolved"`）。
 *
 * 判据看的是**属性值**，不是属性名：这个仓库的属性名有 `state` / `view` / `note` / `phase` / `zone`
 * 好几种写法，按属性名认会漏采，按值认才是「源码里确实写了这个状态」。
 */
export const STATE_MARKER_ATTRIBUTE = /data-([a-z-]+)="([a-z0-9_-]+)"/g

/**
 * 标记值里**不叫状态名、但也确实在说状态**的那几个（实测清单，不是猜的）：
 * `data-xuanshu-zone="unresolved"`（自动推导失败）、`data-xuanshu-history-empty="unknown"`（读不出来）、
 * `data-xuanshu-note="no-map"` / `="no-target"`（这两处是「本来就没有」，不是失败）。
 *
 * 白名单一句话就能读完 —— 加新值必须回改这里，而不是让正则去猜。
 */
export const MARKER_STATE = {
  empty: ['preview-empty', 'workflow-empty', 'no-target', 'no-map', 'history-empty'],
  loading: ['city-pending', 'zone-pending', 'mounts-loading'],
  error: ['unresolved', 'unavailable', 'failed'],
}

/**
 * 各状态的**人话说明**族（中文提示）。命中即「这个面的源码里说了一句人话」。
 *
 * 口径刻意窄：只认「状态说明句」，不认任意中文（导航文案、按钮标签不算）。
 * `{pending ? '正在生成草稿…' : '导出汇总'}` 里的前半句算，后半句不算 —— 但静态扫描分不出
 * 前后半句，所以它只作为**联合条件**的一半：另一半（分支证据）由状态标识符/标记属性提供。
 */
export const STATE_HINT = {
  empty: /还没有|没有匹配|无匹配|没有任何|暂无|没有记录|一条都没有|没有被|没有排除|空空的/,
  loading: /正在(?:读|读取|加载|统计|生成|处理|计算|整理|扫描|准备|校验|搜|问|拉|取)|(?:读取|加载|估算|生成|重算|出盘|校验|预览|试算|搜索|处理|恢复)中|请稍候|排队中/,
  error: /失败|出错|读不到|打不开|不可用|没有完成|没成功|异常|没有给出理由/,
}

/** 加载态的**视觉**证据（D2：骨架屏也算加载态，不需要一个字）。 */
export const LOADING_VISUAL = /xs-skeleton|XsSkeleton|data-xuanshu-skeleton/

/** `X-001`：每个状态允许的**唯一一套**说法（口径见文件头）。 */
export const CANONICAL_WORDING = {
  // 空态：一律「还没有…」（从未有过）或「没有…」（这一类没有 / 筛掉了）。同义替换见 BANNED_WORDING。
  empty: [/还没有/, /没有匹配/, /无匹配/, /没有被/, /没有排除/, /没有任何/],
  // 加载态接受两种进行时写法：动词前「正在…」，或状态标签「…中」（估算中 / 生成中 / 校验中）。
  loading: [
    /正在(?:读|读取|加载|统计|生成|处理|计算|整理|扫描|准备|校验|搜|问|拉|取)/,
    /(?:估算|生成|重算|出盘|校验|预览|试算|搜索|处理|恢复)中/,
  ],
  error: [/失败/, /读不到/, /打不开/, /不可用/],
}

/**
 * `X-001`：**不许并存**的同义替换。理由都是同一条 —— 它们与上面那套说法表达同一个意思，
 * 两种叫法并存，人就得学两遍（README §3.3「不新造同义词」）。
 */
export const BANNED_WORDING = {
  empty: ['暂无', '空的', '空空的', '无记录', '空空如也'],
  loading: ['加载中', '载入中', '读取中', '请稍候', '等待中'],
  error: ['出错了', '错误', '异常', '出问题了'],
}

/**
 * `X-001`：错误行旁边的**可执行下一步**（人话动词）。
 * 没有这一步的错误行 = 让人对着失败干瞪眼（README §3.4「空态必须可执行」的同一口气）。
 */
export const ACTIONABLE_STEP = /重试|再试|重新|刷新|去 ?DSH|去 S\d+|换个|先回|打开|检查|稍后再|取消|返回|请在|请先|请到|请检查|\bonRetry\b|\bonRefresh\b|ACTION_COPY\.(?:retry|refresh|changeTime)|action="(?:retry|refresh)"/

/** 「可执行下一步」必须离错误行多近（行）。远了就说明那是别处的按钮，不是这条错误的出路。 */
export const ACTIONABLE_WINDOW = 6

/**
 * 把一行源码切成「代码部分」。
 *
 * 为什么要切：注释里写「三态齐全」「重试」的源码遍地都是（`OverviewPanel.tsx` 有 20 多行 JSDoc
 * 在描述空态/错误态），不剥注释就会把「文档里承诺过」判成「界面里有」。
 *
 * 只做两件事：去掉 `/* … *​/` 块注释（跨行，含 JSX 的 `{/* … *​/}`）与 `//` 行注释。
 * 字符串里的 `https://` 不算注释（前一个字符是 `:`）。这不是一个 JS 词法器，够用就好。
 *
 * @param {string} line 原始一行
 * @param {{inBlock: boolean}} state 跨行状态（**就地修改**，调用方按行序复用同一个对象）
 * @returns {string} 去掉注释后的代码部分（行号不变，因为不删行）
 */
export function stripCommentPart(line, state) {
  let out = ''
  let index = 0
  while (index < line.length) {
    if (state.inBlock) {
      const end = line.indexOf('*/', index)
      if (end === -1) return out
      index = end + 2
      state.inBlock = false
      continue
    }
    const block = line.indexOf('/*', index)
    const lineCommentRaw = line.indexOf('//', index)
    // URL 里的 `//`（`http://`、`https://`）不是注释：前一个字符是冒号。
    const lineComment = lineCommentRaw !== -1 && line[lineCommentRaw - 1] === ':' ? -1 : lineCommentRaw
    if (block !== -1 && (lineComment === -1 || block < lineComment)) {
      out += line.slice(index, block)
      const end = line.indexOf('*/', block + 2)
      if (end === -1) {
        state.inBlock = true
        return out
      }
      index = end + 2
      continue
    }
    if (lineComment !== -1) return out + line.slice(index, lineComment)
    return out + line.slice(index)
  }
  return out
}

/**
 * 一串文本 → 保留行号的**代码行**数组。
 * @param {{text: string}} file `source-cache` 的读取结果
 * @returns {{line: number, code: string}[]} 空行（代码部分为空）已剔除
 */
export function codeLinesOf(file) {
  const state = { inBlock: false }
  const out = []
  const lines = file.text.replace(/\r\n/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const code = stripCommentPart(lines[index], state).trim()
    if (code !== '') out.push({ line: index + 1, code })
  }
  return out
}

/**
 * 造一个「状态标识符」的词边界正则。
 * @param {string} alias 标识符别名（大小写敏感）
 * @returns {RegExp}
 */
export function aliasPattern(alias) {
  return new RegExp(`(?<![\\w$])${alias}(?![\\w$])`)
}
