/**
 * 票 08 · 冷启动向导的纯模型与逐字文案（S3 §2 / §3；冻结契约 §2 / §3）。
 *
 * 为什么向导的口径要单独成一层（而不是散在组件里）：
 *   票面验收的两条硬判据都是**数据面**的——「payload 里 `timeAlg` 缺省不出现」与
 *   「缺 lat/lon → 不允许出盘」。把请求构造、度分串、偏移表、微调粒度放在纯函数里，
 *   就能在 Node 里直接断言（`tests/assembly/onboarding-model.test.mjs`），
 *   而组件只负责把同一份模型渲染出来。票 06 的教训（四柱验 `timeAlg` 恒真）也是这个道理：
 *   口径要有**单源**，判据要落在数据上。
 *
 * 上游依据（本机只读核对）：
 *   - 三档 `timeAlg`（0/1/3）与性别三档：`components/cntradition/CnTraditionInput.js:523-531`、`:515-521`。
 *   - 固定 UTC 偏移表 28 档：`components/amap/GeoCoordSelector.js:17-27`（含半区 +04:30/+05:30/-05:30/-07:30）。
 *   - 微调粒度含「四分钟」档：`components/comp/SpaceTimePanel.js:76-86`、
 *     `components/comp/DateTimeSelector.js:731-757`；「四分钟 = 1° 经度时差」见 S3 §3.1③。
 *   - 度分串的取整口径：上游快照字段 `lat: { value:'19N04' }`（19.076 → 04′，即 **floor** + 两位）。
 */

/** 手输经纬（或城市库都没给出可读地名）时的占位名（S3 §3.2③）。 */
export const UNNAMED_PLACE = '未命名地点';

/** 时间算法档位（契约 §3：只透传 0 / 1 / 3；`2 春分定卯时`上游未实现，界面不出现）。 */
export type TimeAlgValue = 0 | 1 | 3;

/** 档位标签（单源：S3 §2.4 线框与 S2 §3.6 口径行共用同一份措辞）。 */
export const TIME_ALG_LABELS: Record<TimeAlgValue, string> = {
  0: '真太阳时（经度 + 均时差）',
  1: '直接时间（钟表时）',
  3: '平太阳时（仅经度差）',
};

/**
 * 界面上的三档（顺序即界面顺序）。
 *
 * `hint` 是右栏说明：默认档必须写明**缺省省略**，不能写成「已设为 0」
 * （S3 §9「真太阳时口径」第 3 条点名了这一点）。
 */
export const TIME_ALG_OPTIONS: readonly { value: TimeAlgValue; label: string; hint: string }[] = [
  {
    value: 0,
    label: `${TIME_ALG_LABELS[0]} = 0`,
    hint: 'v1 默认档：**缺省省略**，玄枢不写这个键，由引擎缺省决定',
  },
  { value: 1, label: `${TIME_ALG_LABELS[1]} = 1`, hint: '透传 timeAlg=1' },
  { value: 3, label: `${TIME_ALG_LABELS[3]} = 3`, hint: '透传 timeAlg=3' },
];

/** 档位标签；未知档位（含上游的 2）不假装认识。 */
export function timeAlgLabel(value: number): string {
  return (TIME_ALG_LABELS as Record<number, string>)[value] ?? '未知档位';
}

/** 单选按钮上的档位文案（0 档带「= 0」）。 */
export function timeAlgOptionLabel(value: TimeAlgValue): string {
  return TIME_ALG_OPTIONS.find((option) => option.value === value)?.label ?? '未知档位';
}

/** 性别三档（契约与上游同款：未知按男排，因为大运顺逆需要性别）。 */
export type GenderValue = 'unknown' | 'female' | 'male';

export const GENDER_OPTIONS: readonly { value: GenderValue; label: string; hint: string }[] = [
  { value: 'unknown', label: '未知（按男排）', hint: '大运顺逆与小运需要性别择一，故「未知」按男排' },
  { value: 'female', label: '女', hint: '' },
  { value: 'male', label: '男', hint: '' },
];

/** 性别标签（确认表与详情口径行共用）。 */
export function genderLabel(value: GenderValue): string {
  return GENDER_OPTIONS.find((option) => option.value === value)?.label ?? '未知（按男排）';
}

/** 不确定项：勾选即写进 `clarification_notes`（S3 §3.5②，不是拒绝出盘）。 */
export const NOTE_OPTIONS: readonly { id: string; label: string }[] = [
  { id: 'minute', label: '出生时间只精确到分钟' },
  { id: 'place', label: '出生地是大概位置' },
];

/**
 * 勾选的不确定项 → `clarification_notes` 文本。
 *
 * 顺序恒按 `NOTE_OPTIONS`，与勾选先后无关（同一组勾选必须产生同一份 notes，
 * 否则「同一份出生信息两次出盘」的载荷会漂）。
 *
 * @param ids - 勾选的项 id。
 * @returns 以「；」分隔的文本；一项都没勾返回空串。
 */
export function composeNotes(ids: readonly string[]): string {
  return NOTE_OPTIONS.filter((option) => ids.includes(option.id))
    .map((option) => option.label)
    .join('；');
}

/**
 * 固定 UTC 偏移表（28 档，照抄上游 `GeoCoordSelector.js:17-27`）。
 *
 * 为什么这里存**偏移串**而不是 IANA 名：手动覆盖的语义正是「不要 DST、就要这个固定偏移」。
 * 上游引擎吃的就是 `+HH:MM` 这种串（上游快照/测试夹具里 `zone:'+05:30'`），
 * 而 IANA 名一律由 `bazi.timezone` 给（客户端不许自己算时区，契约 §4）。
 */
export const ZONE_OFFSETS: readonly { value: string; label: string }[] = [
  { value: '+00:00', label: '东0区' },
  { value: '+01:00', label: '东1区' },
  { value: '+02:00', label: '东2区' },
  { value: '+03:00', label: '东3区' },
  { value: '+04:00', label: '东4区' },
  { value: '+04:30', label: '东4.5' },
  { value: '+05:00', label: '东5区' },
  { value: '+05:30', label: '东5.5' },
  { value: '+06:00', label: '东6区' },
  { value: '+07:00', label: '东7区' },
  { value: '+08:00', label: '东8区' },
  { value: '+09:00', label: '东9区' },
  { value: '+10:00', label: '东10' },
  { value: '+11:00', label: '东11' },
  { value: '+12:00', label: '东12' },
  { value: '-01:00', label: '西1区' },
  { value: '-02:00', label: '西2区' },
  { value: '-03:00', label: '西3区' },
  { value: '-04:00', label: '西4区' },
  { value: '-05:00', label: '西5区' },
  { value: '-05:30', label: '西5.5' },
  { value: '-06:00', label: '西6区' },
  { value: '-07:00', label: '西7区' },
  { value: '-07:30', label: '西7.5' },
  { value: '-08:00', label: '西8区' },
  { value: '-09:00', label: '西9区' },
  { value: '-10:00', label: '西10' },
  { value: '-11:00', label: '西11' },
];

/** 固定偏移串的判据（`+HH:MM` / `-HH:MM`）——`draft.zone` 是自动 IANA 名还是手改偏移。 */
export function isFixedOffsetZone(zone: string): boolean {
  return /^[+-]\d{2}:\d{2}$/.test(zone);
}

/** 微调粒度（档名照屏稿：年 / 月 / 天 / 小时 / **四分钟**）。 */
export type NudgeGrain = 'year' | 'month' | 'day' | 'hour' | 'fourMinute';

export const NUDGE_GRAINS: readonly { id: NudgeGrain; label: string; minutes?: number }[] = [
  { id: 'year', label: '年' },
  { id: 'month', label: '月' },
  { id: 'day', label: '天' },
  { id: 'hour', label: '小时', minutes: 60 },
  // 「四分钟」= 1° 经度时差（S3 §3.1③：**不要改写成「加减分秒」**）。
  { id: 'fourMinute', label: '四分钟', minutes: 4 },
];

/** 钟表时刻串（`HH:mm`，与契约 §1 快照的 `birth.time` 同形）。 */
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** UTC 毫秒 → `{date,time}`（微调一律在 UTC 上算，避免本机时区/DST 掺进来）。 */
function stamp(date: string, time: string): { date: string; time: string } {
  return { date, time };
}

/**
 * 微调钟表时刻。
 *
 * @param date - `YYYY-MM-DD`。
 * @param time - `HH:mm`。
 * @param grain - 粒度档（含「四分钟」）。
 * @param delta - 正负整数（步数）。
 * @returns 新的 `{date,time}`；输入不合法时原样返回（界面给空值的处理在调用处）。
 */
export function nudgeDateTime(date: string, time: string, grain: NudgeGrain, delta: number): { date: string; time: string } {
  const dateMatch = DATE_PATTERN.exec(date);
  const timeMatch = TIME_PATTERN.exec(time);
  if (dateMatch === null || timeMatch === null) return stamp(date, time);
  const base = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  const spec = NUDGE_GRAINS.find((row) => row.id === grain);
  let shifted = base;
  switch (grain) {
    case 'year':
      shifted = Date.UTC(
        Number(dateMatch[1]) + delta,
        Number(dateMatch[2]) - 1,
        Number(dateMatch[3]),
        Number(timeMatch[1]),
        Number(timeMatch[2]),
      );
      break;
    case 'month':
      shifted = Date.UTC(
        Number(dateMatch[1]),
        Number(dateMatch[2]) - 1 + delta,
        Number(dateMatch[3]),
        Number(timeMatch[1]),
        Number(timeMatch[2]),
      );
      break;
    case 'day':
      shifted = base + delta * 86_400_000;
      break;
    default:
      shifted = base + delta * (spec?.minutes ?? 0) * 60_000;
      break;
  }
  const next = new Date(shifted);
  return stamp(
    `${String(next.getUTCFullYear())}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`,
    `${pad2(next.getUTCHours())}:${pad2(next.getUTCMinutes())}`,
  );
}

/**
 * 度分串：`118.7969 → 118e47`（floor + 两位 + 小写方向后缀）。
 *
 * 为什么 floor 而不是四舍五入：屏稿（S3 §2.2③ / S2 §2.1②）与上游快照字段
 * （`lat:{value:'19N04'}`，19.076 → 04′）都是截断。抄成 round 会让同一个坐标
 * 在两处显示成两个值，那正是本票要防的「两套值不一致」。
 *
 * @param value - 十进制度数（可负）。
 * @param positive - 正方向后缀（经度 `e` / 纬度 `n`）。
 * @param negative - 负方向后缀（经度 `w` / 纬度 `s`）。
 * @returns 度 + 方向字母 + 两位分，如 `118e47`。
 */
export function formatDegreeMinute(value: number, positive: string, negative: string): string {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = Math.floor((absolute - degrees) * 60);
  return `${String(degrees)}${value >= 0 ? positive : negative}${pad2(minutes)}`;
}

/** 经纬度度分串：`118e47 / 32n03`（经度在前，纬度在后 —— 与手输次序同源）。 */
export function formatCoords(lon: number, lat: number): string {
  return `${formatDegreeMinute(lon, 'e', 'w')} / ${formatDegreeMinute(lat, 'n', 's')}`;
}

/**
 * 手输经纬：**经度在前、纬度在后**；非法值返回 `undefined`（S3 §3.2②「非法值忽略不回填」）。
 *
 * @param lonText - 经度输入框原文。
 * @param latText - 纬度输入框原文。
 * @returns `{lon,lat}` 或 `undefined`（调用方据此**保留旧值 / 不给新值**，绝不用 0 兜底）。
 */
export function manualLocation(lonText: string, latText: string): { lon: number; lat: number } | undefined {
  const lon = Number(lonText.trim());
  const lat = Number(latText.trim());
  if (lonText.trim() === '' || latText.trim() === '') return undefined;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return undefined;
  return { lon, lat };
}

/** 向导草稿（只在**本次向导会话**内存在；不落盘、不出向导，见 S3 §6 防脏状态 H1）。 */
export interface OnboardingDraft {
  /** 出生日期 `YYYY-MM-DD`（空串 = 还没填）。 */
  date: string;
  /** 钟表时刻 `HH:mm`（空串 = 还没填）。 */
  time: string;
  /** 地名；空串表示手输经纬（界面上据实显示「未命名地点」，不留旧地名）。 */
  place: string;
  lon?: number;
  lat?: number;
  /** 时区：IANA 名（`bazi.timezone` 给的）或固定偏移串（手改的）。空串 = 还没定。 */
  zone: string;
  /** 时区是否被手改过（决定 `[自动]` 是否可用，S3 §3.3②）。 */
  zoneManual: boolean;
  /** 时间算法档（0 = 真太阳时默认档，实现上省略该键）。 */
  timeAlg: TimeAlgValue;
  gender: GenderValue;
  /** 勾选的不确定项 id（写进 clarification_notes）。 */
  notes: string[];
  /** `[x] 以上信息我已核对` —— 出盘按钮的解锁条件（S3 §3.5③）。 */
  verified: boolean;
}

/** 空草稿（S3 §6「未开始态」：第 1 步空表单，日期/时刻都没值）。 */
export function defaultDraft(): OnboardingDraft {
  return {
    date: '',
    time: '',
    place: '',
    lon: undefined,
    lat: undefined,
    zone: '',
    zoneManual: false,
    timeAlg: 0,
    gender: 'unknown',
    notes: [],
    verified: false,
  };
}

/** 契约 §1 快照里本模型用得到的那几项（避免为此 import 整份宿主类型）。 */
export interface SnapshotBirthLike {
  birth?: {
    date?: string;
    time?: string;
    zone?: string;
    lat?: number;
    lon?: number;
    place?: string;
    timeAlg?: number;
  };
}

/**
 * 快照 → 草稿（S2 §5.4「重新录制：五步全部预填现值」）。
 *
 * 两条刻意的语义：
 *   1. 缺项**就是缺**（不拿旧值或 0 兜底）：缺经纬度会照常触发「缺经纬度禁止出盘」；
 *   2. `verified` 恒为 `false`：上一次的确认不能顺延到下一条盘 —— 重录是写操作，
 *      必须由人重新勾一次（C10 的人工确认闸门）。
 *
 * @param snapshot - `bazi.snapshot` / `bazi.status` 里的快照（可为空对象）。
 * @returns 五步预填好的草稿。
 */
export function draftFromSnapshot(snapshot: SnapshotBirthLike): OnboardingDraft {
  const birth = snapshot?.birth ?? {};
  const timeAlg = birth.timeAlg === 1 || birth.timeAlg === 3 ? birth.timeAlg : 0;
  const zone = typeof birth.zone === 'string' ? birth.zone : '';
  return {
    date: typeof birth.date === 'string' ? birth.date : '',
    time: typeof birth.time === 'string' ? birth.time : '',
    place: typeof birth.place === 'string' ? birth.place : '',
    lon: Number.isFinite(birth.lon) ? birth.lon : undefined,
    lat: Number.isFinite(birth.lat) ? birth.lat : undefined,
    zone,
    zoneManual: isFixedOffsetZone(zone),
    timeAlg,
    gender: 'unknown',
    notes: [],
    verified: false,
  };
}

/** 界面上显示的地名（手输无名 → 「未命名地点」，不留旧地名）。 */
export function placeLabel(draft: Pick<OnboardingDraft, 'place'>): string {
  return draft.place.trim() === '' ? UNNAMED_PLACE : draft.place;
}

/**
 * 缺哪些坐标（顺序固定：经度、纬度）。
 * @param draft - 草稿。
 * @returns 缺项标签数组；空数组 = 坐标齐了。
 */
export function missingCoordinates(draft: Pick<OnboardingDraft, 'lon' | 'lat'>): string[] {
  const missing: string[] = [];
  if (!Number.isFinite(draft.lon)) missing.push('经度');
  if (!Number.isFinite(draft.lat)) missing.push('纬度');
  return missing;
}

/** 出盘阻塞项（界面据此置灰 + 给理由；**不移除节点**，S1 §6④）。 */
export type CastBlocker = 'date' | 'time' | 'coordinates' | 'zone' | 'verified';

/** 除「缺经纬度」之外的阻塞理由（缺经纬度那条要展示 §2.6 的完整因果说明）。 */
export const CAST_BLOCK_REASON: Record<Exclude<CastBlocker, 'coordinates'>, string> = {
  date: '出生日期还没填（公历即可，农历换算由底座做）。',
  time: '出生时刻还没填（填**当地时间**即可，真太阳时由底座换算）。',
  zone: '时区还没定：自动推导失败时，请在第 3 步手动指定一个 UTC 偏移。',
  verified: '请先勾选「以上信息我已核对」—— 这是出盘前的澄清闸。',
};

/**
 * 缺经纬度的完整理由（S3 §2.6 逐字：**写明缺什么 + 为什么 + 两个修复入口**）。
 *
 * 「没有经纬度，真太阳时就算不出来；引擎会悄悄退回钟表口径，玄枢不让这种盘生成。」
 * 这句因果是索引 D6 的界面本体：宁可不出盘，也不产出一个静默退化的盘。
 */
export const CAST_MISSING_REASON =
  '缺：经度 / 纬度。没有经纬度，真太阳时就算不出来；引擎会悄悄退回钟表口径，玄枢不让这种盘生成。';

/**
 * 列出当前草稿的出盘阻塞项（空 = 可出盘）。
 * @param draft - 草稿。
 * @returns 阻塞项（固定顺序：日期 → 时刻 → 经纬度 → 时区 → 核对）。
 */
export function castBlockers(draft: OnboardingDraft): CastBlocker[] {
  const blockers: CastBlocker[] = [];
  if (draft.date.trim() === '') blockers.push('date');
  if (draft.time.trim() === '') blockers.push('time');
  if (missingCoordinates(draft).length > 0) blockers.push('coordinates');
  if (draft.zone.trim() === '') blockers.push('zone');
  if (!draft.verified) blockers.push('verified');
  return blockers;
}

/** `bazi.cast` 的请求体（契约 §2 的形状，逐字对齐）。 */
export interface CastRequest {
  birth: {
    date: string;
    time: string;
    zone: string;
    lat: number;
    lon: number;
    /** 无名时**不带**（界面占位词「未命名地点」不是事实）。 */
    place?: string;
    /** 默认档（0）**不带**这个键（契约 §3：缺省省略）。 */
    timeAlg?: TimeAlgValue;
  };
  /** 恒 `true`：这一次出盘由人点确认触发（AI 不许静默出盘）。 */
  confirmed: true;
  /** `clarification_notes`（勾了不确定项才有）。 */
  notes?: string;
}

/**
 * 构造出盘请求。
 *
 * @param draft - 草稿。
 * @returns 请求体；**有任一阻塞项时返回 `undefined`**（宁可没有请求，也不产出一个
 *   缺经纬度、静默退化成钟表口径的盘 —— 契约 §2「一个字节都不落盘、不调 horosa」）。
 */
export function buildCastRequest(draft: OnboardingDraft): CastRequest | undefined {
  if (castBlockers(draft).length > 0) return undefined;
  const notes = composeNotes(draft.notes);
  const birth: CastRequest['birth'] = {
    date: draft.date,
    time: draft.time,
    zone: draft.zone,
    lat: draft.lat as number,
    lon: draft.lon as number,
  };
  if (draft.place.trim() !== '') birth.place = draft.place;
  if (draft.timeAlg !== 0) birth.timeAlg = draft.timeAlg;
  const request: CastRequest = { birth, confirmed: true };
  if (notes !== '') request.notes = notes;
  return request;
}

/** 本机「此刻」的 `{date,time}`（`[此刻]` 按钮用；一律取**本机时区**的钟面值）。 */
export function nowStamp(now: Date = new Date()): { date: string; time: string } {
  return stamp(
    `${String(now.getFullYear())}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
  );
}
