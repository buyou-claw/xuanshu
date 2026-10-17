/**
 * 票 30（#30）· 「我的数据」设置页（设置 → 我的数据）。
 *
 * 装配位置：`settings.section`（list / root 槽，**纯加性**：不新增 main key、不新增侧栏行）。
 * 槽位证据（本机 0.2.0-rc.2 实装，只读核对）：
 *   - 声明：`@deepseek-ai/dsh-cordis-client-runner/lib/client.js:4710`（`key: "settings.section"`）；
 *     类型契约 `@deepseek-ai/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts`；
 *   - 既有居留者：`settings-general`（id `general`，order 0）、`settings-models`（`models`，10）、
 *     `settings-plugins`（`plugins`，15）、`agent-preset`（`agent-presets`，20）、
 *     `settings-account`（`account`，-10）。本页取 **25**：排在既有分区之后，不撞任何号。
 *   - 该槽由 `sidebar.settings` 里的 general 条目在挂载期声明；`ctx.slots.inject` 会等声明就绪，
 *     所以注册时机不需要我们自己轮询。
 *
 * 三条边界：
 *   1. **只读 + 一次显式动作**：apply 期不发请求（体积在组件挂载后的 effect 里读一次）；
 *      备份只在人点 `[一键备份]` 之后发生，且带 `confirmed:true`（按钮就是人工点头）。
 *   2. **失败可读**：读体积失败 / 选目录失败 / 备份失败都落在 `role="alert"` 的一行里。
 *   3. **文案是契约的一部分**：包含会话记录、不含 `.credentials.yaml` 与密钥引用、原因与迁移方法、
 *      恢复逐项说明且明确「不提供自动覆盖式恢复」—— 这些句子直接对应票面验收，别改短。
 */

import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'

import type { DataApi, DataBackupSuccess, DataOverview } from './data-api.js'
import { installDataStyle } from './data-style.js'

/** 设置分区 id（自己的号；复用既有 id 会把那个分区替换掉）。 */
export const DATA_SECTION_ID = 'xuanshu.data'
/** 设置分区标签（设置左侧导航里的一行）。 */
export const DATA_SECTION_LABEL = '我的数据'
/** 导航位置：既有分区 account -10 / general 0 / models 10 / plugins 15 / agent-presets 20。 */
export const DATA_SECTION_ORDER = 25

/**
 * 字节 → 人话（0 B / 512 B / 1.5 KB / 4.6 MB …）。
 * 负数与非有限值一律按 0 处理：这是展示口径，不是审计账。
 * @param bytes - 字节数。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  if (unit === 0) return `${Math.round(value)} B`
  return `${value.toFixed(1)} ${units[unit]}`
}

/** 页面状态（纯渲染组件的唯一输入）。 */
export interface DataSectionState {
  overview?: DataOverview
  busy: boolean
  stage?: string
  result?: DataBackupSuccess
  error?: string
}

/** 页面动作（只有「一键备份」一个写路径）。 */
export interface DataSectionActions {
  onBackup(): void
}

/** 8 个分类的固定展示顺序（宿主按契约 §1 给，这里不重排、不过滤）。 */
function GroupTable({ overview }: { overview: DataOverview }) {
  return (
    <>
      <table className="xs-data__groups">
        <thead>
          <tr>
            <th scope="col">分类</th>
            <th scope="col">位置</th>
            <th scope="col">体积</th>
            <th scope="col">文件</th>
          </tr>
        </thead>
        <tbody>
          {overview.groups.map((group) => (
            <tr key={group.id} data-xuanshu-data-group={group.id}>
              <th scope="row">{group.label}</th>
              <td>
                <code>{group.path}</code>
              </td>
              <td>{formatBytes(group.bytes)}</td>
              <td>{group.files} 个文件</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="xs-data__total" data-xuanshu-data-total>
        总计：{formatBytes(overview.total.bytes)} · {overview.total.files} 个文件
      </p>
    </>
  )
}

/** 排除项（为什么这份数据既不计体积也不进备份）。 */
function ExcludedList({ overview }: { overview: DataOverview }) {
  return (
    <section className="xs-data__block" data-xuanshu-data-excluded>
      <h3>不备份 / 不计体积</h3>
      <ul>
        {overview.excluded.map((entry) => (
          <li key={entry.path}>
            <code>{entry.path}</code>：{entry.reason}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * 纯渲染组件（无取数逻辑；SSR 与静态断言可直接渲染）。
 * @param props - 当前状态与唯一动作。
 */
export function XsDataSection({ state, actions }: { state: DataSectionState; actions: DataSectionActions }) {
  return (
    <div className="xs-data" data-xuanshu-section="data">
      <h2>我的数据</h2>
      <p className="xs-data__lead">玄枢的数据都在本机。这里按分类列出体积，并可一键备份到你选的目录。</p>

      {state.overview === undefined ? (
        <p className="xs-data__note" data-xs-state="loading">
          正在统计各分类体积…
        </p>
      ) : (
        <>
          <section className="xs-data__block" data-xuanshu-data-paths>
            <h3>位置</h3>
            <p data-xuanshu-data-path="home">
              home：<code>{state.overview.home}</code>
            </p>
            <p data-xuanshu-data-path="data">
              数据目录：<code>{state.overview.dataDir}</code>
            </p>
          </section>
          <section className="xs-data__block">
            <h3>分类体积</h3>
            <GroupTable overview={state.overview} />
            {state.overview.notes.length === 0 ? null : (
              <ul className="xs-data__note" data-xuanshu-data-notes>
                {state.overview.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </section>
          <ExcludedList overview={state.overview} />
        </>
      )}

      <section className="xs-data__block xs-data__backup">
        <h3>一键备份</h3>
        <p>备份会包含谱 / 藏 / 底稿 / 事记 / 会话记录 / 存储 / skills / 其它；写到一个你选的目录。</p>
        <button type="button" data-xuanshu-action="backup" disabled={state.busy} onClick={actions.onBackup}>
          {state.busy ? '正在备份…' : '一键备份'}
        </button>
        {state.busy && state.stage !== undefined ? (
          <p className="xs-data__note" data-xuanshu-data-stage>
            {state.stage}
          </p>
        ) : null}
        {state.error === undefined ? null : (
          <p className="xs-data__error" role="alert" data-xuanshu-data-error>
            {state.error}
          </p>
        )}
        {state.result === undefined ? null : (
          <div className="xs-data__result" data-xuanshu-data-result>
            <p>
              备份完成：<code>{state.result.backupDir}</code>
            </p>
            {state.result.manifestPath === undefined ? null : (
              <p>
                清单：<code>{state.result.manifestPath}</code>
              </p>
            )}
            <p>清单里每个文件都有 sha256 与大小，可逐项对账（manifest.json）。</p>
          </div>
        )}
      </section>

      <section className="xs-data__block" data-xuanshu-data-boundary>
        <h3>备份里有什么、没有什么</h3>
        <ul>
          <li>备份包含：谱 / 藏 / 底稿 / 事记 / 会话记录 / 存储 / skills / 其它。</li>
          <li>备份不包含：.credentials.yaml 与任何密钥引用。</li>
          <li>为什么：密钥不该离开本机凭据库；玄枢不另建密钥库。</li>
          <li>怎么迁：换机器后在玄枢自己的「设置 → 模型」里重新填 API key。</li>
        </ul>
      </section>

      <section className="xs-data__block" data-xuanshu-data-restore>
        <h3>恢复（不提供自动恢复）</h3>
        <ol>
          <li>先关掉玄枢，确认没有实例还在运行，再动文件。</li>
          <li>把备份目录里的 xuanshu/、sessions/、storages/、skills/ 分别放回 home 的对应位置；同名文件覆盖前先自己留一份。</li>
          <li>密钥不在备份里：在「设置 → 模型」重新填一次 API key。</li>
          <li>回到本页看一次体积，确认分类都回来了。</li>
        </ol>
        <p>不提供自动恢复：玄枢不会自己覆盖现有数据，放回哪一份由你决定。</p>
      </section>
    </div>
  )
}

/**
 * 宿主组件：挂载后读一次体积；「一键备份」= 选目录 → busy/阶段 → 结果或原因。
 *
 * 备份请求本身**不阻塞渲染**：按钮先进入 busy 态（并禁用），Promise 在后台推进；
 * 失败只落在 `role="alert"` 的一行里，不抛到 React 树外。
 */
export function DataSectionHost({ api }: { api: DataApi }) {
  const [overview, setOverview] = useState<DataOverview | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<string | undefined>(undefined)
  const [result, setResult] = useState<DataBackupSuccess | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void api
      .overview()
      .then((value) => {
        if (alive) setOverview(value)
      })
      .catch((reason: unknown) => {
        if (alive) setError(`读不到数据分类：${reason instanceof Error ? reason.message : String(reason)}`)
      })
    return () => {
      alive = false
    }
  }, [api])

  const onBackup = (): void => {
    if (busy) return
    setError(undefined)
    setResult(undefined)
    setBusy(true)
    setStage('正在打开目录选择器…')
    void (async () => {
      try {
        const picked = await api.pickDirectory()
        if (typeof picked?.path !== 'string' || picked.path === '') {
          setStage(undefined)
          setError('没有选择备份目录（已取消）。')
          return
        }
        setStage(`正在备份到 ${picked.path} …（复制并逐个校验 sha256，文件多时会久一点）`)
        const answer = await api.backup({ targetDir: picked.path, confirmed: true })
        if (answer.ok !== true) {
          setError(`备份没有完成：${answer.error?.message ?? '未知原因'}`)
          return
        }
        setResult(answer)
      } catch (reason: unknown) {
        setError(`备份没有完成：${reason instanceof Error ? reason.message : String(reason)}`)
      } finally {
        setBusy(false)
        setStage(undefined)
      }
    })()
  }

  return <XsDataSection state={{ overview, busy, stage, result, error }} actions={{ onBackup }} />
}

/** 安装依赖：数据面由根入口造好（apply 期不发请求）。 */
export interface DataSettingsInstallDeps {
  api: DataApi
}

/**
 * 注册设置里的「我的数据」分区（**纯加性**：不新增 main key / 侧栏行，不动 apply 期请求）。
 * @param ctx - 客户端上下文（需 `slots`）。
 * @param deps - 数据面。
 */
export function installDataSettings(ctx: Context, deps: DataSettingsInstallDeps): void {
  installDataStyle()
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: DATA_SECTION_ID,
        order: DATA_SECTION_ORDER,
        label: DATA_SECTION_LABEL,
        inject: () => ({ api: deps.api }),
      },
      DataSectionHost as never,
    ),
  )
}
