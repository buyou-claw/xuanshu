/**
 * 离线城市小库 + 两条通道的搜索调度（S3 §2.2 通道 A / §3.2①；冻结契约 §5）。
 *
 * 为什么小库要**随 bundle 自带**（而不是只靠宿主大库）：
 *   冷启动向导是本项目唯一的必填入口，而大库（`bazi.cities`）是可选的懒加载资源
 *   （契约 §1「缺失不算失败」）。小库随 JS 一起到，断网、宿主半没装、大库被裁坏，
 *   三种情况下向导都还能搜到城市 —— 这是 S3 §3.2④「任一通道失败不阻断选点」的落点。
 *
 * 数据来源与许可：
 *   源文件 `.upstream/horosa-web-app-windows/local/workspace/Horosa-Web-<commit>` /
 *   `astrostudyui/src/data/cities.json`（96 条，字段 `{name,en,region,lat,lng,p}`），
 *   `p` = 空格分隔拼音。上游许可 **AGPL-3.0**（`horosa-web-app-windows/LICENSE`），与本仓一致。
 *   本文件是**逐条等值转写**（不改坐标、不改地名），只把字段名 `lng` 换成契约 §2 的 `lon`、
 *   `p` 换成 `pinyin`；顺序照抄上游（前三行即「北上广深」级的常用城市）。
 *
 * 隔着这一层的好处：搜索语义（含首字母）与调度语义（180ms 防抖、快照稳定）都能在
 * Node 里直接断言（`tests/assembly/onboarding-cities.test.mjs`），不需要 DOM。
 *
 * 上游依据（本机只读核对）：
 *   - `…/components/amap/GeoCoordSelector.js:41-47`：`cityKeyword`（输入即时值）/
 *     `cityQuery`（防抖后过滤值）/ `fullCities`（懒加载，未加载或失败为 null）三个状态分得清清楚楚。
 *   - `…/components/amap/GeoCoordSelector.js:304-325`：小库即时、大库懒加载 + 180ms 防抖。
 */

/** 契约 §2 的 `City`：**不含 tz**（时区一律走 `bazi.timezone`，避免两份 tz 数据漂移）。 */
export interface City {
  name: string;
  region: string;
  /** 英文名（上游 `en`）：允许中文名与英文名同一个查询命中。 */
  en?: string;
  /** 空格分隔全拼（上游 `p`）：既支持全拼匹配，也由它派生首字母匹配。 */
  pinyin: string;
  lat: number;
  /** 经度。契约字段名是 `lon`（上游源数据里叫 `lng`，转写时改名）。 */
  lon: number;
}

/** 输入 → 大库查询之间的防抖时长（契约 §5 冻结 180ms，改它等于改契约）。 */
export const CITY_DEBOUNCE_MS = 180;

/** 一次渲染最多列几条候选（小库 96 条全列没有必要；查得到就够点）。 */
export const CITY_RESULT_LIMIT = 20;

/**
 * 常用城市小库（96 条，来源见文件头）。
 *
 * 转写口径：`{ name, region, en, pinyin, lat, lon }`，简体名，坐标原名不动。
 */
export const SMALL_CITIES: readonly City[] = [
  { name: '北京', region: '中国', en: 'Beijing', pinyin: 'bei jing', lat: 39.9042, lon: 116.4074 },
  { name: '上海', region: '中国', en: 'Shanghai', pinyin: 'shang hai', lat: 31.2304, lon: 121.4737 },
  { name: '天津', region: '中国', en: 'Tianjin', pinyin: 'tian jin', lat: 39.3434, lon: 117.3616 },
  { name: '重庆', region: '中国', en: 'Chongqing', pinyin: 'chong qing', lat: 29.563, lon: 106.5516 },
  { name: '广州', region: '中国·广东', en: 'Guangzhou', pinyin: 'guang zhou', lat: 23.1291, lon: 113.2644 },
  { name: '深圳', region: '中国·广东', en: 'Shenzhen', pinyin: 'shen zhen', lat: 22.5431, lon: 114.0579 },
  { name: '成都', region: '中国·四川', en: 'Chengdu', pinyin: 'cheng du', lat: 30.5728, lon: 104.0668 },
  { name: '杭州', region: '中国·浙江', en: 'Hangzhou', pinyin: 'hang zhou', lat: 30.2741, lon: 120.1551 },
  { name: '武汉', region: '中国·湖北', en: 'Wuhan', pinyin: 'wu han', lat: 30.5928, lon: 114.3055 },
  { name: '西安', region: '中国·陕西', en: "Xi'an", pinyin: 'xi an', lat: 34.3416, lon: 108.9398 },
  { name: '南京', region: '中国·江苏', en: 'Nanjing', pinyin: 'nan jing', lat: 32.0603, lon: 118.7969 },
  { name: '苏州', region: '中国·江苏', en: 'Suzhou', pinyin: 'su zhou', lat: 31.2989, lon: 120.5853 },
  { name: '郑州', region: '中国·河南', en: 'Zhengzhou', pinyin: 'zheng zhou', lat: 34.7466, lon: 113.6254 },
  { name: '长沙', region: '中国·湖南', en: 'Changsha', pinyin: 'chang sha', lat: 28.2282, lon: 112.9388 },
  { name: '沈阳', region: '中国·辽宁', en: 'Shenyang', pinyin: 'shen yang', lat: 41.8057, lon: 123.4315 },
  { name: '大连', region: '中国·辽宁', en: 'Dalian', pinyin: 'da lian', lat: 38.914, lon: 121.6147 },
  { name: '哈尔滨', region: '中国·黑龙江', en: 'Harbin', pinyin: 'ha er bin', lat: 45.8038, lon: 126.5349 },
  { name: '长春', region: '中国·吉林', en: 'Changchun', pinyin: 'chang chun', lat: 43.8171, lon: 125.3235 },
  { name: '济南', region: '中国·山东', en: 'Jinan', pinyin: 'ji nan', lat: 36.6512, lon: 117.1201 },
  { name: '青岛', region: '中国·山东', en: 'Qingdao', pinyin: 'qing dao', lat: 36.0671, lon: 120.3826 },
  { name: '石家庄', region: '中国·河北', en: 'Shijiazhuang', pinyin: 'shi jia zhuang', lat: 38.0428, lon: 114.5149 },
  { name: '太原', region: '中国·山西', en: 'Taiyuan', pinyin: 'tai yuan', lat: 37.8706, lon: 112.5489 },
  { name: '合肥', region: '中国·安徽', en: 'Hefei', pinyin: 'he fei', lat: 31.8206, lon: 117.229 },
  { name: '福州', region: '中国·福建', en: 'Fuzhou', pinyin: 'fu zhou', lat: 26.0745, lon: 119.2965 },
  { name: '厦门', region: '中国·福建', en: 'Xiamen', pinyin: 'xia men', lat: 24.4798, lon: 118.0894 },
  { name: '南昌', region: '中国·江西', en: 'Nanchang', pinyin: 'nan chang', lat: 28.682, lon: 115.8579 },
  { name: '昆明', region: '中国·云南', en: 'Kunming', pinyin: 'kun ming', lat: 25.0389, lon: 102.7183 },
  { name: '贵阳', region: '中国·贵州', en: 'Guiyang', pinyin: 'gui yang', lat: 26.647, lon: 106.6302 },
  { name: '南宁', region: '中国·广西', en: 'Nanning', pinyin: 'nan ning', lat: 22.817, lon: 108.3665 },
  { name: '海口', region: '中国·海南', en: 'Haikou', pinyin: 'hai kou', lat: 20.0444, lon: 110.1989 },
  { name: '兰州', region: '中国·甘肃', en: 'Lanzhou', pinyin: 'lan zhou', lat: 36.0611, lon: 103.8343 },
  { name: '西宁', region: '中国·青海', en: 'Xining', pinyin: 'xi ning', lat: 36.6171, lon: 101.7782 },
  { name: '银川', region: '中国·宁夏', en: 'Yinchuan', pinyin: 'yin chuan', lat: 38.4872, lon: 106.2309 },
  { name: '乌鲁木齐', region: '中国·新疆', en: 'Urumqi', pinyin: 'wu lu mu qi', lat: 43.8256, lon: 87.6168 },
  { name: '呼和浩特', region: '中国·内蒙古', en: 'Hohhot', pinyin: 'hu he hao te', lat: 40.8426, lon: 111.7492 },
  { name: '拉萨', region: '中国·西藏', en: 'Lhasa', pinyin: 'la sa', lat: 29.652, lon: 91.1721 },
  { name: '香港', region: '中国', en: 'Hong Kong', pinyin: 'xiang gang', lat: 22.3193, lon: 114.1694 },
  { name: '澳门', region: '中国', en: 'Macau', pinyin: 'ao men', lat: 22.1987, lon: 113.5439 },
  { name: '台北', region: '中国·台湾', en: 'Taipei', pinyin: 'tai bei', lat: 25.033, lon: 121.5654 },
  { name: '高雄', region: '中国·台湾', en: 'Kaohsiung', pinyin: 'gao xiong', lat: 22.6273, lon: 120.3014 },
  { name: '温州', region: '中国·浙江', en: 'Wenzhou', pinyin: 'wen zhou', lat: 27.9939, lon: 120.6994 },
  { name: '宁波', region: '中国·浙江', en: 'Ningbo', pinyin: 'ning bo', lat: 29.8683, lon: 121.544 },
  { name: '无锡', region: '中国·江苏', en: 'Wuxi', pinyin: 'wu xi', lat: 31.4912, lon: 120.3119 },
  { name: '东莞', region: '中国·广东', en: 'Dongguan', pinyin: 'dong guan', lat: 23.0207, lon: 113.7518 },
  { name: '佛山', region: '中国·广东', en: 'Foshan', pinyin: 'fo shan', lat: 23.0218, lon: 113.1219 },
  { name: '泉州', region: '中国·福建', en: 'Quanzhou', pinyin: 'quan zhou', lat: 24.8741, lon: 118.6757 },
  { name: '东京', region: '日本', en: 'Tokyo', pinyin: 'dong jing', lat: 35.6762, lon: 139.6503 },
  { name: '大阪', region: '日本', en: 'Osaka', pinyin: 'da ban', lat: 34.6937, lon: 135.5023 },
  { name: '京都', region: '日本', en: 'Kyoto', pinyin: 'jing dou', lat: 35.0116, lon: 135.7681 },
  { name: '首尔', region: '韩国', en: 'Seoul', pinyin: 'shou er', lat: 37.5665, lon: 126.978 },
  { name: '釜山', region: '韩国', en: 'Busan', pinyin: 'fu shan', lat: 35.1796, lon: 129.0756 },
  { name: '新加坡', region: '新加坡', en: 'Singapore', pinyin: 'xin jia po', lat: 1.3521, lon: 103.8198 },
  { name: '吉隆坡', region: '马来西亚', en: 'Kuala Lumpur', pinyin: 'ji long po', lat: 3.139, lon: 101.6869 },
  { name: '曼谷', region: '泰国', en: 'Bangkok', pinyin: 'man gu', lat: 13.7563, lon: 100.5018 },
  { name: '雅加达', region: '印尼', en: 'Jakarta', pinyin: 'ya jia da', lat: -6.2088, lon: 106.8456 },
  { name: '马尼拉', region: '菲律宾', en: 'Manila', pinyin: 'ma ni la', lat: 14.5995, lon: 120.9842 },
  { name: '河内', region: '越南', en: 'Hanoi', pinyin: 'he nei', lat: 21.0278, lon: 105.8342 },
  { name: '胡志明市', region: '越南', en: 'Ho Chi Minh City', pinyin: 'hu zhi ming shi', lat: 10.8231, lon: 106.6297 },
  { name: '新德里', region: '印度', en: 'New Delhi', pinyin: 'xin de li', lat: 28.6139, lon: 77.209 },
  { name: '孟买', region: '印度', en: 'Mumbai', pinyin: 'meng mai', lat: 19.076, lon: 72.8777 },
  { name: '迪拜', region: '阿联酋', en: 'Dubai', pinyin: 'di bai', lat: 25.2048, lon: 55.2708 },
  { name: '伊斯坦布尔', region: '土耳其', en: 'Istanbul', pinyin: 'yi si tan bu er', lat: 41.0082, lon: 28.9784 },
  { name: '莫斯科', region: '俄罗斯', en: 'Moscow', pinyin: 'mo si ke', lat: 55.7558, lon: 37.6173 },
  { name: '伦敦', region: '英国', en: 'London', pinyin: 'lun dun', lat: 51.5074, lon: -0.1278 },
  { name: '巴黎', region: '法国', en: 'Paris', pinyin: 'ba li', lat: 48.8566, lon: 2.3522 },
  { name: '柏林', region: '德国', en: 'Berlin', pinyin: 'bo lin', lat: 52.52, lon: 13.405 },
  { name: '汉堡', region: '德国', en: 'Hamburg', pinyin: 'han bao', lat: 53.5511, lon: 9.9937 },
  { name: '慕尼黑', region: '德国', en: 'Munich', pinyin: 'mu ni hei', lat: 48.1351, lon: 11.582 },
  { name: '罗马', region: '意大利', en: 'Rome', pinyin: 'luo ma', lat: 41.9028, lon: 12.4964 },
  { name: '马德里', region: '西班牙', en: 'Madrid', pinyin: 'ma de li', lat: 40.4168, lon: -3.7038 },
  { name: '巴塞罗那', region: '西班牙', en: 'Barcelona', pinyin: 'ba sai luo na', lat: 41.3851, lon: 2.1734 },
  { name: '阿姆斯特丹', region: '荷兰', en: 'Amsterdam', pinyin: 'a mu si te dan', lat: 52.3676, lon: 4.9041 },
  { name: '苏黎世', region: '瑞士', en: 'Zurich', pinyin: 'su li shi', lat: 47.3769, lon: 8.5417 },
  { name: '维也纳', region: '奥地利', en: 'Vienna', pinyin: 'wei ye na', lat: 48.2082, lon: 16.3738 },
  { name: '雅典', region: '希腊', en: 'Athens', pinyin: 'ya dian', lat: 37.9838, lon: 23.7275 },
  { name: '斯德哥尔摩', region: '瑞典', en: 'Stockholm', pinyin: 'si de ge er mo', lat: 59.3293, lon: 18.0686 },
  { name: '纽约', region: '美国', en: 'New York', pinyin: 'niu yue', lat: 40.7128, lon: -74.006 },
  { name: '洛杉矶', region: '美国', en: 'Los Angeles', pinyin: 'luo shan ji', lat: 34.0522, lon: -118.2437 },
  { name: '旧金山', region: '美国', en: 'San Francisco', pinyin: 'jiu jin shan', lat: 37.7749, lon: -122.4194 },
  { name: '芝加哥', region: '美国', en: 'Chicago', pinyin: 'zhi jia ge', lat: 41.8781, lon: -87.6298 },
  { name: '华盛顿', region: '美国', en: 'Washington D.C.', pinyin: 'hua sheng dun', lat: 38.9072, lon: -77.0369 },
  { name: '西雅图', region: '美国', en: 'Seattle', pinyin: 'xi ya tu', lat: 47.6062, lon: -122.3321 },
  { name: '波士顿', region: '美国', en: 'Boston', pinyin: 'bo shi dun', lat: 42.3601, lon: -71.0589 },
  { name: '拉斯维加斯', region: '美国', en: 'Las Vegas', pinyin: 'la si wei jia si', lat: 36.1699, lon: -115.1398 },
  { name: '多伦多', region: '加拿大', en: 'Toronto', pinyin: 'duo lun duo', lat: 43.6532, lon: -79.3832 },
  { name: '温哥华', region: '加拿大', en: 'Vancouver', pinyin: 'wen ge hua', lat: 49.2827, lon: -123.1207 },
  { name: '墨西哥城', region: '墨西哥', en: 'Mexico City', pinyin: 'mo xi ge cheng', lat: 19.4326, lon: -99.1332 },
  { name: '圣保罗', region: '巴西', en: 'Sao Paulo', pinyin: 'sheng bao luo', lat: -23.5505, lon: -46.6333 },
  { name: '里约热内卢', region: '巴西', en: 'Rio de Janeiro', pinyin: 'li yue re nei lu', lat: -22.9068, lon: -43.1729 },
  { name: '布宜诺斯艾利斯', region: '阿根廷', en: 'Buenos Aires', pinyin: 'bu yi nuo si ai li si', lat: -34.6037, lon: -58.3816 },
  { name: '悉尼', region: '澳大利亚', en: 'Sydney', pinyin: 'xi ni', lat: -33.8688, lon: 151.2093 },
  { name: '墨尔本', region: '澳大利亚', en: 'Melbourne', pinyin: 'mo er ben', lat: -37.8136, lon: 144.9631 },
  { name: '奥克兰', region: '新西兰', en: 'Auckland', pinyin: 'ao ke lan', lat: -36.8485, lon: 174.7633 },
  { name: '开罗', region: '埃及', en: 'Cairo', pinyin: 'kai luo', lat: 30.0444, lon: 31.2357 },
  { name: '约翰内斯堡', region: '南非', en: 'Johannesburg', pinyin: 'yue han nei si bao', lat: -26.2041, lon: 28.0473 },
  { name: '内罗毕', region: '肯尼亚', en: 'Nairobi', pinyin: 'nei luo bi', lat: -1.2921, lon: 36.8219 },
]

/** 一条候选的匹配得分：数字小者排前（中文名精确 → 名前缀 → 名包含 → 拼音/英文/区域）。 */
function matchScore(city: City, query: string, compact: string): number | null {
  const name = city.name.toLowerCase()
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (name.includes(query)) return 2
  const pinyin = city.pinyin.replace(/\s+/g, '')
  // 首字母：'nan jing' → 'nj'。首字母匹配是上游 `p` 字段的主要用途之一（索引 §1.1 通道 1）。
  const initials = city.pinyin
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
  // 拼音一律**前缀**匹配，不做子串：'nj' 若按子串会命中 'tianjin'（ti-a-njin）这种假阳性。
  // 英文同理取**词首**匹配：'york' 命中 New York，而 'nj' 不会命中 Tianjin。
  if (
    pinyin.startsWith(compact) ||
    initials.startsWith(compact) ||
    (city.en ?? '')
      .toLowerCase()
      .split(/[\s.]+/)
      .filter((word) => word !== '')
      .some((word) => word.startsWith(query)) ||
    city.region.toLowerCase().includes(query)
  ) {
    return 3
  }
  return null
}

/**
 * 搜城市：小库**即时**参与，大库结果（`extra`）**只在前者有输入时**才合并进来。
 *
 * @param query - 输入框即时值（不做防抖；防抖在 `createCityQuery`）。
 * @param extra - 已到货的大库条目（可为空；失败时调用方传空数组即可）。
 * @param limit - 最多返回几条（缺省 `CITY_RESULT_LIMIT`）。
 * @returns 候选列表。**无关键词时只列小库**（契约 §5），大库再全也不列。
 */
export function searchCities(
  query: string,
  extra: readonly City[] = [],
  limit: number = CITY_RESULT_LIMIT,
): City[] {
  const trimmed = query.trim()
  if (trimmed === '') return SMALL_CITIES.slice(0, limit)

  const lowered = trimmed.toLowerCase()
  const compact = lowered.replace(/\s+/g, '')

  // 小库在前：同名重复时小库那份赢（大库是可选增强，不该覆盖自带事实）。
  const seen = new Set<string>()
  const candidates: City[] = []
  for (const city of [...SMALL_CITIES, ...extra]) {
    if (seen.has(city.name)) continue
    seen.add(city.name)
    candidates.push(city)
  }

  return candidates
    .map((city) => ({ city, score: matchScore(city, lowered, compact) }))
    .filter((row) => row.score !== null)
    // 稳定排序：同分保持「小库原序 → 大库原序」，与上游「常用城市在前」的观感一致。
    .sort((a, b) => (a.score as number) - (b.score as number))
    .slice(0, limit)
    .map((row) => row.city)
}

/** 控制器对外暴露的状态（`useSyncExternalStore` 要求引用稳定）。 */
export interface CityQueryState {
  /** 输入框即时值。 */
  readonly query: string;
  /** 当前该列的候选：小库即时结果 ∪ 已到货的大库结果。 */
  readonly items: readonly City[];
  /** 大库查询在飞（界面可给「搜得更全…」之类的弱提示，不改主列表）。 */
  readonly pending: boolean;
  /**
   * 大库失败过（**只给守卫与测试看**）。
   * 契约 §5 要求「大库加载失败**静默**只用小库」：界面不显示它，所以它不是渲染输入。
   */
  readonly fullFailed: boolean;
}

export interface CityQueryController {
  getSnapshot(): CityQueryState;
  subscribe(listener: () => void): () => void;
  setQuery(query: string): void;
  dispose(): void;
}

/** `createCityQuery` 的依赖：只要一个「按查询取大库」的函数（便于测试与换实现）。 */
export interface CityQueryOptions {
  /** 大库查询（通常是 `bazi.cities`）；抛错表示大库不可用，调用方静默回落小库。 */
  loadFull: (query: string, signal: AbortSignal) => Promise<readonly City[]>;
  limit?: number;
  delayMs?: number;
}

/**
 * 输入 → 结果的调度器：**小库即时、大库防抖、失败静默、过期回包丢弃**。
 *
 * 为什么自写而不用现成 debounce 工具：这里要同时管四件事——即时小库结果、
 * 防抖后的大库请求、失败降级、以及「请求序号」（同一次向导会话里换查询很快，
 * 慢回包必须丢）。四件事写在一处才不会各自漂移；上游
 * `GeoCoordSelector.js:41-47` 也是把这三个状态放在同一个组件里。
 *
 * @param options - `loadFull` + 可选时长/条数覆盖。
 * @returns 控制器：`setQuery` 驱动，`getSnapshot/subscribe` 给 React。
 */
export function createCityQuery(options: CityQueryOptions): CityQueryController {
  const limit = options.limit ?? CITY_RESULT_LIMIT;
  const delayMs = options.delayMs ?? CITY_DEBOUNCE_MS;
  const listeners = new Set<() => void>();

  let state: CityQueryState = {
    query: '',
    items: searchCities('', [], limit),
    pending: false,
    fullFailed: false,
  };
  /** 请求序号：每次换查询自增，回包只认自己那一代（过期回包直接丢）。 */
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: AbortController | undefined;

  const publish = (next: CityQueryState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const cancelPending = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    inflight?.abort();
    inflight = undefined;
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setQuery(query) {
      if (query === state.query) return;
      cancelPending();
      const trimmed = query.trim();

      // ① 即时：小库结果立刻上屏（大库参与时也先给小库，界面不空等）。
      const immediate = searchCities(trimmed, [], limit);
      if (trimmed === '') {
        // ② 无关键词：**只**列小库，一个请求都不发（契约 §5）。
        publish({ query, items: immediate, pending: false, fullFailed: false });
        return;
      }
      publish({ query, items: immediate, pending: true, fullFailed: false });

      const mine = ++sequence;
      timer = setTimeout(() => {
        timer = undefined;
        const controller = new AbortController();
        inflight = controller;
        void options
          .loadFull(trimmed, controller.signal)
          .then((items) => {
            if (mine !== sequence) return; // 过期回包：丢
            inflight = undefined;
            publish({
              query: state.query,
              items: searchCities(trimmed, items, limit),
              pending: false,
              fullFailed: false,
            });
          })
          .catch(() => {
            if (mine !== sequence) return;
            inflight = undefined;
            // ③ 失败静默：小库结果原样留着，只把事实记在 `fullFailed`（不渲染）。
            publish({ query: state.query, items: state.items, pending: false, fullFailed: true });
          });
      }, delayMs);
    },
    dispose() {
      cancelPending();
      sequence += 1;
      listeners.clear();
    },
  };
}
