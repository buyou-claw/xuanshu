# packages/xuanshu-host/data — 城市大库（票 08 契约 §5）

本目录只有两样东西：**大库数据** `cities-full.json`（宿主侧懒加载）与**它的生成脚本** `build-cities-full.mjs`。
这两样都必须入库：数据是运行时产物，脚本是「它怎么来的」的唯一证据（换机器、换上游版本时能重放）。

## 来源与许可

| 项 | 值 |
|---|---|
| 文件 | `cities-full.json` |
| 上游源 | 星阙桌面端 `astrostudyui/src/data/citiesFull.json`（本机克隆：`.upstream/horosa-web-app-windows/local/workspace/Horosa-Web-<hash>/astrostudyui/src/data/citiesFull.json`） |
| 源体积 | 3 894 011 字节 / 49 981 条（字段 `{n,e,r,p,y,x}`） |
| 上游许可 | 星阙桌面端（`Horosa-Web-App-*`）为 **AGPL-3.0-only**，与玄枢同许可 → 本派生库随玄枢以 AGPL-3.0-only 分发，无需额外条件 |
| 本产物 | **6 792 条 / 664 577 字节**（上限 1.5 MB = 1 572 864 字节的 42.3%） |

字段映射（契约 §2 的 `City`）：

| 上游 | `City` | 说明 |
|---|---|---|
| `n` | `name` | 城市/行政区名（中文行政区划为中文名；世界城市多为英文名） |
| `e` | `en` | 英文名；**空串省略该键**（`City.en` 可选） |
| `r` | `region` | 国家码（ISO 3166-1 alpha-2）或中文行政区名 |
| `p` | `pinyin` | 空格分隔拼音（中文条目才有；英文条目为空串，**不编造**） |
| `y` | `lat` | 纬度 |
| `x` | `lon` | 经度 |

`City` **不含 tz**（契约 §2）：时区一律走 `bazi.timezone`（`tz-lookup` + `Intl`），避免两份时区数据各自漂移。

## 裁剪规则（确定性）

上游源其实是**两套库拼在一起**，这一点决定了规则只能这么定：

1. **中文行政区划库** —— `region` 是中文行政区名（中华人民共和国/广东省/东莞市…），`n` 是中文名、`p` 是拼音、`e` 恒空；
2. **世界城市库** —— `region` 是 ISO 国家码（CN/US/JP…），`n` 多为英文名，只有**全局前 ~400 条**带中文名与拼音。

规则：

- **A. 全收 ①**（3 606 条）—— 中文用户出生地搜索的主力，一条不裁；
- **B. 全收 ②里有中文名的条目**（396 条）—— 世界主要城市（纽约/洛杉矶/东京/巴黎…），中文名 + 拼音可搜；
- **C. ②里其余（英文名、`p` 空）每个 ISO 国家码保留源序前 16 条**（2 790 条）。

C 的依据是**源的排序**：同国内按城市规模降序，逐国核对过 ——
US 前八 = 纽约/洛杉矶/布鲁克林/芝加哥/皇后区/休斯敦/菲尼克斯/费城；
JP 前八 = 东京/横滨/大阪/名古屋/札幌/福冈/川崎/神户；
CN 前八 = 上海/北京/深圳/广州/成都/天津/武汉/东莞。
所以「前 16 条」= 该国最主要的 16 个城市。

`PER_REGION = 16` 是**拍死的常量**，不是「算到塞满为止」：规则可复现、产物可 diff；
体积由脚本里的断言兜底（超 1.5 MB 直接构建失败，而不是悄悄多塞几座城）。

## 复现

```powershell
node packages/xuanshu-host/data/build-cities-full.mjs           # 重新生成（覆盖写入）
node packages/xuanshu-host/data/build-cities-full.mjs --check   # 只比对：产物与重建是否逐字节一致
```

源库定位顺序：`$XUANSHU_UPSTREAM_CITIES` → 从脚本所在目录**逐级向上**找第一个带 `.upstream/` 的祖先
（主检出与 git worktree 两种布局都对）。`.upstream/` 不入库，换机器时用 `--source <path>` 指一份源。

## 消费方与失败语义

`lib/bazi/cities.mjs` 懒加载本文件（**首次 `bazi.cities` 才读盘**，不拖慢装配），并按契约 §2/§5：

- 查找顺序 `<dataDir>/geo/cities-full.json`（用户自带覆盖）→ 本目录的 `cities-full.json`（随包分发）；
- 两份都缺 / 读不动 / JSON 坏 → `bazi.cities` 返回 `{ items: [], source: 'none' }`，**不报错**
  （客户端静默回落自带小库，向导不会因为缺一个大库就停摆）。
