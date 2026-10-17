/**
 * 票 13 · 底稿正文的分组解析（契约 §1 的**确定性规则**的客户端镜像）；
 * 票 27（#27）扩成两段（契约 §3）：最近在做什么 / 曾经做过什么。
 *
 * 为什么解析放在客户端：`digao.md` 是**人可读、AI 可读**的纯文本，来源标记活在文本里
 * （契约 §3：两段固定章序；每段首行 `【来源：<路> <name>】`；事记那一条还在标记行上带
 * 日期区间与依据计数）。界面只是**同一份数据的视图**：来源标记、段序、事记条目都从这份文本推出来，
 * 所以「界面看到的来源」= 「AI 读到的来源」，界面不另存一套来源归属、也不另编一份事记。
 *
 * 解析只做分组与切分，**不做任何改写**：拿不准的形态宁可交回空数组（界面据此给「按原文展示」的兜底），
 * 也不凭空造出「看起来像来源」的结构。
 *
 * 兼容面（升级不弄丢老底稿）：旧文件是「三章 `## 来源：谱`」形态，没有段归属 —— 它仍然解析成
 * 三组（`section === undefined`），界面按旧形态渲染；新文件才有 `section: 'recent' | 'past'`。
 */
import type { ShijiEntry } from './shiji-api.js';

/** 四路来源（契约 §3：谱 / 工作区 / 工作流 / 事记）。 */
export type DigaoSourceKind = 'pu' | 'workspace' | 'workflow' | 'shiji';

/** 两段（章序即契约）。旧文件（三章形态）的组没有段归属。 */
export type DigaoSection = 'recent' | 'past';

/** 章节名 → 来源路；匹配不上就是 `other`（文件里出现过的东西不吞掉）。 */
const KIND_BY_NAME: Record<string, DigaoSourceKind> = {
  谱: 'pu',
  工作区: 'workspace',
  工作流: 'workflow',
  事记: 'shiji',
};

/** 两段的章名（宿主 `DIGAO_SECTIONS` 的同一份词表）。 */
const SECTION_BY_HEADING: Record<string, DigaoSection> = {
  最近在做什么: 'recent',
  曾经做过什么: 'past',
};

/** 两段标题：`## 最近在做什么` / `## 曾经做过什么`（两侧空白容忍）。 */
const SECTION_RE = /^##\s*(最近在做什么|曾经做过什么)\s*$/;

/** 旧形态的章节标题：`## 来源：谱`（行首两个井号 + 全角冒号；两侧空白容忍）。 */
const HEADING_RE = /^##\s*来源：\s*(.+?)\s*$/;

/** 段首标记：`【来源：谱 事业与行业】`（方括号后允许跟一行说明，事记还会跟日期与依据）。 */
const MARKER_RE = /^【来源：\s*(.+?)\s*】\s*(.*)$/;

/** 「源自：…」行（段末的来源指针；界面上单列一行，不属于正文）。 */
const ORIGIN_RE = /^源自：\s*(.*)$/;

/** 空路的空态行：`（尚无来源：工作流）`（宿主渲染；半角冒号也认）。 */
const EMPTY_ROUTE_RE = /^（尚无来源[：:]\s*(.+?)）$/;

/** 事记为空时空态行（宿主 §3 定值）的开头；界面上原样展示。 */
const NO_SHIJI_PREFIX = '（还没有事记';

/** 事记标记行后半截：`<日期>～<日期> · 依据：会话 N 场 · 文档 M 份`。 */
const SHIJI_META_RE = /^(\d{4}-\d{2}-\d{2})\s*～\s*(\d{4}-\d{2}-\d{2})\s*·\s*依据：会话\s*(\d+)\s*场\s*·\s*文档\s*(\d+)\s*份$/;

/** 依据计数（`会话 N 场 · 文档 M 份`）。 */
export interface DigaoShijiBasis {
  sessions: number;
  docs: number;
}

/** 一段：行内来源标记 + 名称 + 正文 + 「源自：」（事记段另有日期与依据）。 */
export interface DigaoSegment {
  /** 行内来源标记（逐字取自标记：谱 / 工作区 / 工作流 / 事记，或文件里写的其它名）。 */
  label: string;
  kind: DigaoSourceKind | 'other';
  /** 标记里的名称（`【来源：谱 事业与行业】` → `事业与行业`；可能为空串）。 */
  name: string;
  /** 正文（已剔除「源自：」行；段首标记缝隙里的说明文字留在首行）。 */
  body: string;
  /** 「源自：…」的内容（没有这一行时为 undefined）。 */
  origin?: string;
  /** 事记条目的起始日期（`firstSeenAt` 的日期段；只有事记段有）。 */
  since?: string;
  /** 事记条目的最后活跃日期（`lastActiveAt` 的日期段；只有事记段有）。 */
  until?: string;
  /** 事记条目的依据计数（只有事记段有）。 */
  basis?: DigaoShijiBasis;
}

/** 一组＝一路来源（某一路没内容时 `segments` 为空、`note` 里留着「（尚无来源：…）」）。 */
export interface DigaoGroup {
  /** 段归属（新形态必有；旧文件的三章形态没有）。 */
  section?: DigaoSection;
  kind: DigaoSourceKind | 'other';
  /** 组名：新形态＝路名（谱 / 工作区 / 工作流 / 事记）；旧形态＝章节名。 */
  name: string;
  /** 段首标记之前、章节标题之后的正文（空路时就是那行空态说明）。 */
  note: string;
  segments: DigaoSegment[];
}

/** 解析中途的草稿（`noteLines` 是逐行收集的，收尾时才拼接）。 */
interface DraftGroup {
  section?: DigaoSection;
  kind: DigaoSourceKind | 'other';
  name: string;
  noteLines: string[];
  segments: DigaoSegment[];
}

/** 解析中途的一段（`bodyLines` 逐行收集，收尾时切出「源自：」）。 */
interface DraftSegment {
  group: DraftGroup;
  label: string;
  kind: DigaoSourceKind | 'other';
  name: string;
  bodyLines: string[];
  since?: string;
  until?: string;
  basis?: DigaoShijiBasis;
}

/** 由标记里的名字判来源路：先精确匹配四路，再退到前缀匹配（容忍 `工作区 xxx` 这类写法）。 */
function kindOf(name: string): DigaoSourceKind | 'other' {
  const exact = KIND_BY_NAME[name];
  if (exact !== undefined) return exact;
  for (const [label, kind] of Object.entries(KIND_BY_NAME)) {
    if (name.startsWith(label)) return kind;
  }
  return 'other';
}

/** 段首标记 `【来源：谱 事业与行业】` → `{ label:'谱', name:'事业与行业' }`。 */
function splitMarker(inner: string): { label: string; name: string } {
  const [label = '', ...rest] = inner.split(/\s+/).filter((part) => part !== '');
  return { label, name: rest.join(' ') };
}

/** 事记标记后半截 → 日期区间与依据（对不上就不认，宁可把它留在正文里可见）。 */
function parseShijiMeta(trailing: string): Pick<DraftSegment, 'since' | 'until' | 'basis'> | undefined {
  const matched = SHIJI_META_RE.exec(trailing);
  if (matched === null) return undefined;
  return {
    since: matched[1],
    until: matched[2],
    basis: { sessions: Number(matched[3]), docs: Number(matched[4]) },
  };
}

/**
 * 把 `digao.md` 解析成「两段 + 各路来源」分组。
 *
 * @param markdown - 契约 §3（或旧的 §1 三章）形态的正文（容错 CRLF 与空行）。
 * @returns 按段序/章序排列的分组；**形态不符（既没有两段也没有来源章节）时返回空数组**。
 */
export function parseDigaoMarkdown(markdown: string): DigaoGroup[] {
  const drafts: DraftGroup[] = [];
  const byKey = new Map<string, DraftGroup>();
  /** 当前段（新形态才有；旧形态的三章没有段归属）。 */
  let section: DigaoSection | undefined;
  let group: DraftGroup | undefined;
  let segment: DraftSegment | undefined;

  /** 取/建一个组（同一段里同一路的多个段合并成一组，组序按首次出现）。 */
  const ensureGroup = (kind: DigaoSourceKind | 'other', name: string): DraftGroup => {
    const key = `${section ?? ''}\u0000${kind}\u0000${name}`;
    const existing = byKey.get(key);
    if (existing !== undefined) return existing;
    const draft: DraftGroup = {
      ...(section === undefined ? {} : { section }),
      kind,
      name,
      noteLines: [],
      segments: [],
    };
    drafts.push(draft);
    byKey.set(key, draft);
    return draft;
  };

  /** 收段：正文剔除「源自：」行，最后一条「源自：」成为该段的来源指针。 */
  const closeSegment = (): void => {
    if (segment === undefined) return;
    const current = segment;
    segment = undefined;
    const origins = current.bodyLines
      .map((line) => ORIGIN_RE.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1] ?? '');
    const body = current.bodyLines
      .filter((line) => ORIGIN_RE.exec(line.trim()) === null)
      .join('\n')
      .trim();
    current.group.segments.push({
      label: current.label,
      kind: current.kind,
      name: current.name,
      body,
      ...(origins.length === 0 ? {} : { origin: origins[origins.length - 1] ?? '' }),
      ...(current.since === undefined ? {} : { since: current.since }),
      ...(current.until === undefined ? {} : { until: current.until }),
      ...(current.basis === undefined ? {} : { basis: current.basis }),
    });
  };

  /** 开一段（标记行）。 */
  const openSegment = (target: DraftGroup, label: string, name: string, trailing: string): void => {
    const draft: DraftSegment = {
      group: target,
      label,
      kind: kindOf(label),
      name,
      bodyLines: [],
    };
    // 事记那一条：标记行末尾是日期区间 + 依据（界面上单列一行，不混进摘要正文）。
    const meta = draft.kind === 'shiji' && trailing !== '' ? parseShijiMeta(trailing) : undefined;
    if (meta !== undefined) {
      draft.since = meta.since;
      draft.until = meta.until;
      draft.basis = meta.basis;
    } else if (trailing !== '') {
      // 标记行末尾的说明文字（`…】事业与行业 ▸ 近一年判断`）落在正文首行，界面照原样展示。
      draft.bodyLines.push(trailing);
    }
    segment = draft;
  };

  for (const rawLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = rawLine.trim();

    const sectionHeading = SECTION_RE.exec(trimmed);
    if (sectionHeading !== null) {
      closeSegment();
      section = SECTION_BY_HEADING[sectionHeading[1] ?? ''];
      group = undefined;
      continue;
    }

    const heading = HEADING_RE.exec(trimmed);
    if (heading !== null) {
      closeSegment();
      // 旧形态：章节自己就是来源，没有段归属。
      section = undefined;
      const name = heading[1] ?? '';
      group = ensureGroup(kindOf(name), name);
      continue;
    }

    if (section !== undefined) {
      // ── 新形态（两段） ──
      // 标记行先认：段与段之间隔的是空行，不是标记 —— 先把「上一段还在开着」当成理由吞掉下一段，
      // 就是把两条来源粘成一条（章序断言会红，而界面看起来只是「少了一段」）。
      const marker = MARKER_RE.exec(trimmed);
      if (marker !== null) {
        closeSegment();
        const { label, name } = splitMarker(marker[1] ?? '');
        group = ensureGroup(kindOf(label), label);
        openSegment(group, label, name, marker[2] ?? '');
        continue;
      }
      const emptyRoute = EMPTY_ROUTE_RE.exec(trimmed);
      if (emptyRoute !== null) {
        closeSegment();
        const title = emptyRoute[1] ?? '';
        const draft = ensureGroup(kindOf(title), title);
        draft.noteLines.push(trimmed);
        group = draft;
        continue;
      }
      if (segment !== undefined) {
        segment.bodyLines.push(rawLine);
        continue;
      }
      if (trimmed === '') continue;
      if (trimmed.startsWith(NO_SHIJI_PREFIX)) {
        const draft = ensureGroup('shiji', '事记');
        draft.noteLines.push(trimmed);
        group = draft;
        continue;
      }
      if (group !== undefined) {
        group.noteLines.push(rawLine);
        continue;
      }
      // 段标题之后、第一个标记之前的游离说明：保留（不丢文件里出现过的字）。
      const orphan = ensureGroup('other', section === 'past' ? '曾经' : '最近');
      orphan.noteLines.push(rawLine);
      continue;
    }

    // ── 旧形态（三章 / 未知章节） ──
    if (group === undefined) continue; // 章节之前的抬头（`# 底稿` 之类）不是来源内容
    const marker = MARKER_RE.exec(trimmed);
    if (marker !== null) {
      closeSegment();
      const { label, name } = splitMarker(marker[1] ?? '');
      openSegment(group, label, name, marker[2] ?? '');
      continue;
    }
    if (segment === undefined) group.noteLines.push(rawLine);
    else segment.bodyLines.push(rawLine);
  }
  closeSegment();

  return drafts.map((draft) => ({
    ...(draft.section === undefined ? {} : { section: draft.section }),
    kind: draft.kind,
    name: draft.name,
    note: draft.noteLines.join('\n').trim(),
    segments: draft.segments,
  }));
}

/**
 * 事记记录 ↔ 读面条目的配对（删除动作的判据）。
 *
 * 正文里**不写 id**（`digao.md` 是人读的派生文件，契约 §3 的条目行没有 id 位），而删除要 id。
 * 两边能对上的只有「名字 + 最后活跃日期」：`digao.read.shiji.entries` 与「曾经」那一段是
 * **同一个 `listShiji()` 的两种投影**（同序、同数据），所以逐条消费的队列一定对得上；
 * 同名同日的多条也按出现顺序一一对应。对不上 = 读面里没有这一条（已删）→ `undefined`，
 * 界面据此不渲染它，并说明「可以在设置里恢复」。
 *
 * @param records - 「曾经」那一段的段（来自 `parseDigaoMarkdown`）
 * @param entries - `digao.read.shiji.entries`（没有账本时是 undefined）
 */
export function matchShijiEntries(
  records: DigaoSegment[],
  entries: ShijiEntry[] | undefined,
): (ShijiEntry | undefined)[] {
  const buckets = new Map<string, ShijiEntry[]>();
  for (const entry of entries ?? []) {
    const key = `${entry.name ?? ''}\u0000${String(entry.lastActiveAt ?? '').slice(0, 10)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }  return records.map((record) => {
    const key = `${record.name}\u0000${record.until ?? ''}`;
    const bucket = buckets.get(key);
    return bucket === undefined || bucket.length === 0 ? undefined : bucket.shift();
  });
}
