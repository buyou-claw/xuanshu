/**
 * 票 08 · 命盘数据面（`/xuanshu` 通道上 `bazi.*` 六个方法的客户端面；冻结契约 §2）。
 *
 * 为什么单独立一层：向导（S3）与详情（S2）都要读同一份数据，而方法名与请求/响应形状
 * 是**两个实现者共享的接口面**——写在一处，方法名就等于契约表格那一列，
 * 断言台可以逐字比对（`tests/assembly/onboarding-contract.test.mjs`）。
 *
 * 客户端**不自己算时区**（契约 §4）：坐标 → IANA 名一律问 `bazi.timezone`，
 * 历史 DST 由宿主侧的 `tz-lookup` + `Intl` 负责。
 */
import type { City } from './cities.js';
import type { CastRequest } from './onboarding-model.js';
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';

/** 契约 §1 的快照（只列本票读得到的字段；写入是宿主半的事）。 */
export interface BaziSnapshot {
  schema?: string;
  generatedAt?: string;
  birth?: {
    date?: string;
    time?: string;
    zone?: string;
    lat?: number;
    lon?: number;
    place?: string;
    timeAlg?: number;
  };
  pillars?: { year?: string; month?: string; day?: string; hour?: string };
  /** `trueSolar` / `clock` 拿不到时**省略该键**（契约 §1：绝不自己算一个假值）。 */
  basis?: { trueSolar?: string; clock?: string; offsetMinutes?: number; dst?: boolean };
  horosa?: { version?: string; tool?: string };
}

/** `bazi.status`：命盘卡的四态判据（`loading` 是客户端自己的过渡态，不在响应里）。 */
export interface BaziStatus {
  state: 'empty' | 'ready' | 'error';
  snapshot?: BaziSnapshot;
  reason?: string;
}

/** `bazi.cities`：大库（可选资源，缺失返回 `source:'none'` 且**不报错**）。 */
export interface CityQueryResult {
  items: City[];
  source: 'full' | 'none';
}

/** `bazi.timezone`：越界坐标 / lookup 失败 → 三个字段都是 `null`（界面落回手改）。 */
export interface ZoneResult {
  zone: string | null;
  offsetMinutes: number | null;
  dst: boolean | null;
}

/** 澄清闸（`phase:'gate'`）：`promptToUser` 是信封原文，界面只许原样展示。 */
export interface CastGate {
  questions: string[];
  promptToUser: string;
}

/** `bazi.cast` 的四态（票 06 的 `classifyBaziEnvelope` 同款）。 */
export interface CastResult {
  phase: 'ok' | 'gate' | 'error' | 'invalid';
  snapshot?: BaziSnapshot;
  gate?: CastGate;
  message: string;
}

/** `bazi.*` 的方法名（逐字对齐契约 §2；改这里等于改接口面）。 */
export const BAZI_ENDPOINTS = {
  status: 'bazi.status',
  snapshot: 'bazi.snapshot',
  basePu: 'bazi.basePu',
  cities: 'bazi.cities',
  timezone: 'bazi.timezone',
  cast: 'bazi.cast',
} as const;

/** 命盘数据面的形状（向导 / 概览 / 详情共用一份）。 */
export interface BaziApi {
  /** 底座是否已立：`empty` / `ready` / `error` + 快照。 */
  status(signal?: AbortSignal): Promise<BaziStatus>;
  /** 只读快照（S2 详情用；`null` = 还没有命盘）。 */
  snapshot(signal?: AbortSignal): Promise<{ snapshot: BaziSnapshot | null }>;
  /**
   * 底座谱读回（票 10 的「默认在场」靠它）。
   * 本票不消费它，但接口面按契约 §2 一次列全 —— 少一个方法就等于把契约表格抄漏一行。
   */
  basePu(signal?: AbortSignal): Promise<{ pu: unknown | null }>;
  /** 大库懒加载（客户端小库在 `cities.ts`，这里是第二条通道）。 */
  cities(payload: { query?: string; limit?: number }, signal?: AbortSignal): Promise<CityQueryResult>;
  /** 坐标 + 出生日期 → IANA 名 + 偏移 + DST（客户端**不许**自己算）。 */
  timezone(
    payload: { lat: number; lon: number; date: string; time?: string },
    signal?: AbortSignal,
  ): Promise<ZoneResult>;
  /** 出盘（副作用：落底座谱）。请求体由 `buildCastRequest` 构造，`confirmed` 恒 true。 */
  cast(request: CastRequest, signal?: AbortSignal): Promise<CastResult>;
}

/**
 * 用连接上下文造一个命盘数据面。
 *
 * @param ctx - 需要 `connection.rpc`（`dsh-client-connection` 提供）。
 * @returns 六个方法都指向 `bazi.*` 的客户端面。
 */
export function createBaziApi(ctx: RpcContext): BaziApi {
  return {
    status: (signal) => rpcCall<BaziStatus>(ctx, BAZI_ENDPOINTS.status, {}, signal),
    snapshot: (signal) => rpcCall<{ snapshot: BaziSnapshot | null }>(ctx, BAZI_ENDPOINTS.snapshot, {}, signal),
    basePu: (signal) => rpcCall<{ pu: unknown | null }>(ctx, BAZI_ENDPOINTS.basePu, {}, signal),
    cities: (payload, signal) => rpcCall<CityQueryResult>(ctx, BAZI_ENDPOINTS.cities, payload, signal),
    timezone: (payload, signal) => rpcCall<ZoneResult>(ctx, BAZI_ENDPOINTS.timezone, payload, signal),
    cast: (request, signal) => rpcCall<CastResult>(ctx, BAZI_ENDPOINTS.cast, request, signal),
  };
}
