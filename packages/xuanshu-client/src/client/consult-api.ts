/**
 * 票 10 · 问事数据面（`/xuanshu` 通道上 `consult.*` 六个方法；冻结契约 §2）。
 *
 * 与票 08 的 `bazi-api.ts` 同款理由：方法名与请求形状是**两个实现者共享的接口面**，
 * 写在一处才能逐字比对契约表格（`tests/assembly/consult-api.test.mjs`）。
 *
 * 客户端**不造 sessionId**（ADR-0009 §1：id 由玄枢自铸、但铸造在宿主半）——
 * 本模块只搬运 `consult.create` 返回的那个 id。
 */
import { rpcCall } from './rpc.js';
import type { RpcContext } from './rpc.js';

/** 临时挂载引用（S8 / 票 12 填内容；本票只搬运与展示）。 */
export interface MountRef {
  kind: 'workspace' | 'workflow';
  id: string;
  label: string;
}

/** 旁挂清单里的一条会话（列表权威 = 旁挂目录，不是会话日志；ADR-0009 §4）。 */
export interface ConsultSummary {
  sessionId: string;
  title: string;
  createdAt: string;
  /** **只记用户勾选的可选谱**；底座与底稿是恒定在场项，不进这个数组（契约 §1）。 */
  pus: string[];
  mounts: MountRef[];
  turns: number;
  lastTurnAt?: string;
}

/** 回看视图里的一条消息（正文权威 = 会话日志，经宿主 `sessionQuery.readSession` 归一）。 */
export interface ConsultMessage {
  role: 'user' | 'assistant';
  text: string;
  at?: string;
  /** 注入消息的来源标记（自定义 `MessageSourceMap` kind，如 `xuanshu-consult`）。 */
  source?: string;
  /**
   * 采用稿自己的**消息 id**（只有 `source === 'xuanshu-bestof-adopted'` 才给）。
   *
   * 票 31：回看要按轮分组，客户端拿账本里的 `messageId` 对日志里的消息 —— 只给正文与 kind 对不上。
   * 其余消息不给 id：那会改动票 10 冻结的投影形状，而它们没有第二个消费方。
   */
  messageId?: string;
}

/**
 * 一轮合参的回看信息（票 31；`consult.read` 的**加性**字段 `drafts`）。
 *
 * 为什么由宿主给：`currentAdoptedMessageIds()` 的按轮语义已经在服务端落地（复核 R2/R3），
 * 客户端再实现一遍必然漂移 —— 这里只做查表与渲染。
 */
export interface ConsultDraftRound {
  /** 稳定标识（宿主账本里的 `runId`；老记录是 `legacy`）。 */
  runId: string;
  /** 给人看的轮次序号（1 起，按账本顺序）。 */
  round: number;
  /** 这一轮投递过的采用稿消息 id（含后来被改选 / 否决掉的那几份）。 */
  messageIds: string[];
  /** 这一轮**当前**算数的那一份（末条决定是 adopted 时才有；被否决的轮没有）。 */
  currentId?: string;
  /** 这一轮最后那个决定是不是否决（否决轮不能显示成当前）。 */
  rejected: boolean;
}

/** `consult.read` 的加性字段：轮次表 + 当前集合。 */
export interface ConsultDrafts {
  rounds: ConsultDraftRound[];
  /** 判得出「当前采用稿」吗；`false` = 判不出来（不声称某一份被取代 / 被否决）。 */
  resolved: boolean;
  /** 当前采用稿消息 id（`resolved=false` 时为空数组）。 */
  currentIds: string[];
}

/** 恒定在场项（底座谱 / 底稿）：`present=false` 时 `reason` 说明为什么现在没有。 */
export interface RequiredSource {
  kind: 'base-pu' | 'digao';
  name: string;
  present: boolean;
  reason?: string;
}

/** 可选谱（来自谱列表，排除底座）。 */
export interface OptionalSource {
  slug: string;
  name: string;
  level: 'base' | 'optional';
  summary: string;
}

export interface ConsultDefaults {
  required: RequiredSource[];
  optional: OptionalSource[];
}

/** `consult.*` 的方法名（逐字对齐契约 §2；改这里等于改接口面）。 */
export const CONSULT_ENDPOINTS = {
  create: 'consult.create',
  send: 'consult.send',
  list: 'consult.list',
  read: 'consult.read',
  rename: 'consult.rename',
  defaults: 'consult.defaults',
} as const;

/** 问事数据面的形状（门厅与历史子页共用一份）。 */
export interface ConsultApi {
  /** 建会话 + 写旁挂；**不发问**（发问走 `send`）。 */
  create(payload?: { pus?: string[] }, signal?: AbortSignal): Promise<{ session: ConsultSummary }>;
  /** 发一条（首轮由宿主注入上下文）。 */
  send(
    payload: { sessionId: string; text: string; requestId?: string },
    signal?: AbortSignal,
  ): Promise<{ accepted: true }>;
  /** 历史列表（按 `createdAt` 倒序；**读旁挂目录**，不扫会话日志）。 */
  list(signal?: AbortSignal): Promise<{ items: ConsultSummary[] }>;
  /** 点开即读（只读；不进会话、不追加任何事件）。`drafts` 是票 31 的加性字段（没有合参记录时缺席）。 */
  read(
    payload: { sessionId: string },
    signal?: AbortSignal,
  ): Promise<{ session: ConsultSummary; messages: ConsultMessage[]; drafts?: ConsultDrafts }>;
  /**
   * 改标题（改的是旁挂清单，不是会话记录）。
   * 契约冻结了这个方法；设计稿 S7 §6 的只读态没有改名入口，因此**本票的界面不动它**。
   */
  rename(payload: { sessionId: string; title: string }, signal?: AbortSignal): Promise<{ session: ConsultSummary }>;
  /** 勾选区的两组数据：恒定在场项 + 可选谱。 */
  defaults(signal?: AbortSignal): Promise<ConsultDefaults>;
}

/**
 * 用连接上下文造一个问事数据面。
 * @param ctx - 需要 `connection.rpc`（`dsh-client-connection` 提供）。
 * @returns 六个方法都指向 `consult.*` 的客户端面。
 */
export function createConsultApi(ctx: RpcContext): ConsultApi {
  return {
    create: (payload, signal) => rpcCall<{ session: ConsultSummary }>(ctx, CONSULT_ENDPOINTS.create, payload, signal),
    send: (payload, signal) => rpcCall<{ accepted: true }>(ctx, CONSULT_ENDPOINTS.send, payload, signal),
    list: (signal) => rpcCall<{ items: ConsultSummary[] }>(ctx, CONSULT_ENDPOINTS.list, {}, signal),
    read: (payload, signal) =>
      rpcCall<{ session: ConsultSummary; messages: ConsultMessage[]; drafts?: ConsultDrafts }>(
        ctx,
        CONSULT_ENDPOINTS.read,
        payload,
        signal,
      ),
    rename: (payload, signal) => rpcCall<{ session: ConsultSummary }>(ctx, CONSULT_ENDPOINTS.rename, payload, signal),
    defaults: (signal) => rpcCall<ConsultDefaults>(ctx, CONSULT_ENDPOINTS.defaults, {}, signal),
  };
}
