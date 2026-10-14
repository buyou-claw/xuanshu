/**
 * 票 13 · 底稿正文的来源分组解析（契约 §1 的**确定性规则**的客户端镜像）。
 *
 * 为什么解析放在客户端：`digao.md` 是**人可读、AI 可读**的纯文本，来源标记活在文本里
 * （契约 §1：每段首行 `【来源：谱 <name>】`，章序固定 `## 来源：谱` → `## 来源：工作区` → `## 来源：工作流`）。
 * 界面只是**同一份数据的视图**：三层来源标记（分组 / 边条 / 行内标签）都从这份文本推出来，
 * 所以「界面看到的来源」= 「AI 读到的来源」，界面不另存一套来源归属。
 *
 * 解析只做分组与切分，**不做任何改写**：拿不准的形态宁可交回空数组（界面据此给「按原文展示」的兜底），
 * 也不凭空造出「看起来像来源」的结构。
 */

/** 三路来源（契约 §1 的固定章序）。 */
export type DigaoSourceKind = 'pu' | 'workspace' | 'workflow';

/** 章节名 → 来源路；匹配不上就是 `other`（文件里出现过的东西不吞掉）。 */
const KIND_BY_NAME: Record<string, DigaoSourceKind> = {
  谱: 'pu',
  工作区: 'workspace',
  工作流: 'workflow',
};

/** 章节标题：`## 来源：谱`（行首两个井号 + 全角冒号；两侧空白容忍）。 */
const HEADING_RE = /^##\s*来源：\s*(.+?)\s*$/;

/** 段首标记：`【来源：谱 事业与行业】`（方括号后允许跟一行标题说明）。 */
const MARKER_RE = /^【来源：\s*(.+?)\s*】\s*(.*)$/;

/** 「源自：…」行（段末的来源指针；界面上单列一行，不属于正文）。 */
const ORIGIN_RE = /^源自：\s*(.*)$/;

/** 一段：行内来源标签 + 名称 + 正文 + 「源自：」。 */
export interface DigaoSegment {
  /** 行内来源标签（逐字取自标记：谱 / 工作区 / 工作流，或文件里写的其它名）。 */
  label: string;
  kind: DigaoSourceKind | 'other';
  /** 标记里的名称（`【来源：谱 事业与行业】` → `事业与行业`；可能为空串）。 */
  name: string;
  /** 正文（已剔除「源自：」行；段首标记缝隙里的说明文字留在首行）。 */
  body: string;
  /** 「源自：…」的内容（没有这一行时为 undefined）。 */
  origin?: string;
}

/** 一组＝一路来源（某一路没内容时 `segments` 为空、`note` 里留着「尚无来源」）。 */
export interface DigaoGroup {
  kind: DigaoSourceKind | 'other';
  /** 章节名（`## 来源：谱` → `谱`）。 */
  name: string;
  /** 段首标记之前、章节标题之后的正文（空路时就是「尚无来源」）。 */
  note: string;
  segments: DigaoSegment[];
}

/** 解析中途的草稿（`noteLines` 是逐行收集的，收尾时才拼接）。 */
interface DraftGroup {
  kind: DigaoSourceKind | 'other';
  name: string;
  noteLines: string[];
  segments: DigaoSegment[];
}

/** 解析中途的一段（`bodyLines` 逐行收集，收尾时切出「源自：」）。 */
interface DraftSegment {
  label: string;
  kind: DigaoSourceKind | 'other';
  name: string;
  bodyLines: string[];
}

/** 由标记里的名字判来源路：先精确匹配三路，再退到前缀匹配（容忍 `工作区 xxx` 这类写法）。 */
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
  const parts = inner.split(/\s+/).filter((part) => part !== '');
  if (parts.length === 0) return { label: '', name: '' };
  return { label: parts[0], name: parts.slice(1).join(' ') };
}

/**
 * 把 `digao.md` 解析成三路来源分组。
 *
 * @param markdown - 契约 §1 形态的正文（容错 CRLF 与空行）。
 * @returns 按章序排列的分组；**形态不符（没有来源章节）时返回空数组**。
 */
export function parseDigaoMarkdown(markdown: string): DigaoGroup[] {
  const drafts: DraftGroup[] = [];
  let group: DraftGroup | undefined;
  let segment: DraftSegment | undefined;

  /** 收段：正文剔除「源自：」行，最后一条「源自：」成为该段的来源指针。 */
  const closeSegment = (): void => {
    if (group === undefined || segment === undefined) return;
    const origins = segment.bodyLines
      .map((line) => ORIGIN_RE.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1].trim());
    const body = segment.bodyLines
      .filter((line) => ORIGIN_RE.exec(line.trim()) === null)
      .join('\n')
      .trim();
    group.segments.push({
      label: segment.label,
      kind: segment.kind,
      name: segment.name,
      body,
      ...(origins.length === 0 ? {} : { origin: origins[origins.length - 1] }),
    });
    segment = undefined;
  };

  for (const rawLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = HEADING_RE.exec(rawLine.trim());
    if (heading !== null) {
      closeSegment();
      const name = heading[1];
      group = { kind: kindOf(name), name, noteLines: [], segments: [] };
      drafts.push(group);
      continue;
    }
    if (group === undefined) continue; // 章节之前的抬头（`# 底稿` 之类）不是来源内容
    const marker = MARKER_RE.exec(rawLine.trim());
    if (marker !== null) {
      closeSegment();
      const { label, name } = splitMarker(marker[1]);
      segment = { label, kind: kindOf(label), name, bodyLines: [] };
      // 标记行末尾的说明文字（`…】事业与行业 ▸ 近一年判断`）落在正文首行，界面照原样展示。
      if (marker[2] !== '') segment.bodyLines.push(marker[2]);
      continue;
    }
    if (segment === undefined) group.noteLines.push(rawLine);
    else segment.bodyLines.push(rawLine);
  }
  closeSegment();

  return drafts.map((draft) => ({
    kind: draft.kind,
    name: draft.name,
    note: draft.noteLines.join('\n').trim(),
    segments: draft.segments,
  }));
}
