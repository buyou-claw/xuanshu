import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPuRepository, puSlug, validatePuDraft } from './repository.mjs';
import { waitForTurnEnd } from '../consult/turn.mjs';
const skill = readFileSync(new URL('./create-pu.md', import.meta.url), 'utf8');
export function installPuSkill(ctx) {
  return ctx.inject(['skills'], scoped => scoped.skills.register({ name: 'xuanshu-create-pu', description: 'xuanshu:create-pu：将文字或附件转换为谱规范 v1，预览后人确认落盘', source: 'bundled', content: skill }));
}

/** Runtime APIs verified against installed sessionController create/prompt/resolveAgent and Agent.whenIdle. */
export function createPuMethods(ctx, { dataDir }) {
  const repository = createPuRepository(dataDir); const jobs = new Map();
  const service = name => ctx.get(name, false);
  const jobFor = id => { const job = jobs.get(id); if (!job) throw new Error('预览已失效，请重新生成'); return job; };
  const view = job => ({ id: job.id, sessionId: job.sessionId, status: job.status, draft: job.draft, error: job.error });
  async function generate(request, signal) {
    if (!request.name?.trim() || !['base', 'optional'].includes(request.level)) throw new Error('请定义谱名与级别');
    if (!request.summaryOnly && repository.list().some(p => p.slug === puSlug(request.name))) throw new Error('谱名已存在');
    if (!request.text?.trim() && !request.attachments?.length) throw new Error('请提供文字或附件');
    const controller = service('sessionController');
    if (!controller) throw new Error('DSH 会话服务尚未就绪，请重试');
    const id = randomUUID(); const cwd = join(dataDir, '.tmp', 'pu', id); mkdirSync(cwd, { recursive: true });
    const files = [];
    for (const [index, attachment] of (request.attachments ?? []).entries()) {
      if (typeof attachment.data !== 'string' || attachment.data.length > 100 * 1024 * 1024) throw new Error('附件无效或超过 75 MiB');
      const name = String(attachment.name ?? `attachment-${index}`).replace(/[\\/:*?"<>|\x00-\x1f]/g, '-');
      if (!name || name === '.' || name === '..') throw new Error('附件名称无效');
      const file = `${index}-${name}`;
      // Keep a single ordinary filename when possible so the model can recognize the format.
      const filename = files.includes(name) ? file : name;
      writeFileSync(join(cwd, filename), Buffer.from(attachment.data, 'base64')); files.push(filename);
    }
    const { sessionId } = await controller.create({ cwd }); signal.throwIfAborted();
    const job = { id, sessionId, status: 'running', canceled: false }; jobs.set(id, job);
    /**
     * 2026-11-02 改：原来不管有没有附件，都往 prompt 里塞一句
     *   `附件（当前目录，只读来源）：[]`
     * skill 开头又写着「用 DSH coding 文件工具读取附件」。两句话合起来，AI 在没有附件的
     * 情况下也会去调文件工具 —— 然后卡在审批上（实测：界面停在「AI 正在读取资料」，
     * 另一个面板里躺着一条没人批的审批，`whenIdle` 于是提前返回，最终一条 assistant 消息都没有）。
     *
     * 用户只是贴了一段文字，本来不需要任何工具。所以：
     *   - 没有附件 → 不提附件，并明确要求「本次不要调用任何工具」
     *   - 有附件 → 才写附件清单，让 AI 去读
     */
    const attachments = files.length === 0
      ? '本次没有附件：资料只有下面这段文字，**不要调用任何工具**（不用读文件、不用搜索），直接按格式输出 JSON。'
      : `附件（当前目录，只读来源，需要时用文件工具读取）：${JSON.stringify(files)}`;
    const prompt = `${skill}\n\n用户定义：${JSON.stringify({ name: request.name, level: request.level })}\n资料文字：\n${request.text ?? ''}\n${attachments}\n${request.summaryOnly ? '本次只重新提炼 summary；其他字段保持用户提供的事实。' : ''}`;
    void (async () => {
      try {
        await controller.prompt({ requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }], clientTimeZone: request.clientTimeZone ?? 'Asia/Shanghai' }, new AbortController().signal);
        const resolved = await controller.resolveAgent(sessionId); if (resolved.error) throw resolved.error;
        /**
         * 2026-11-02 换判据：等 `turn/end`，不是 `whenIdle()`。
         *
         * 仓里早就有一条写清楚的结论（`consult/turn.mjs` 文件头）：
         *   `whenIdle()` 只表示「整个 agent 活动静默」，**不标识某一条消息的结束**
         *   （`dsh-agent/lib/types/runtime-types.d.ts:164`：does not identify the settlement of
         *   any particular message）。拿它当「这一问答完了」，症状是记号错位，而且**不报错**。
         * 正确的判据是会话日志自己的边界事件 `turn/end`。
         *
         * 问事（`consult/service.mjs`）一直用的是 `waitForTurnEnd`，只有这里用了 `whenIdle()` ——
         * 实测症状就是：prompt 排进去了，`whenIdle()` 立刻返回，会话里一条 assistant 消息都没有，
         * 界面报「AI 一句话都没有回应」。所以改成复用同一个工具。
         */
        const settled = await waitForTurnEnd(ctx, sessionId, { signal });
        if (settled.kind === 'aborted' || job.canceled) return;
        const readAssistant = () => {
          const e = [...resolved.agent.session.snapshotEvents()].reverse().find((x) => x.type === 'assistant/message');
          return e?.data?.content?.filter((part) => part.type === 'text').map((part) => part.text).join('\n') ?? '';
        };
        let text = readAssistant();
        /** 兜底：`turn/end` 到了但消息还没进快照（极少数时序）时，最多再等 30 秒。 */
        const deadline = Date.now() + 30_000;
        while (text.trim() === '' && !job.canceled && Date.now() < deadline) {
          await new Promise((resolve) => { setTimeout(resolve, 2000); });
          text = readAssistant();
        }
        if (job.canceled) return;
        /**
         * 2026-11-02 加：AI **一句话都没回**时单说一句人话。
         *
         * 实测过一次：会话建出来了，但整个会话里只有元数据，一条 message 都没有
         * （provider 那侧静默失败）。这时 `text` 是空串，`JSON.parse('')` 报
         * `Unexpected end of JSON input` —— 把人引到「格式不对」上去，其实是「AI 没吭声」。
         * 两种情况的下一步不一样：没回应 → 查模型配没配好；格式不对 → 重试或拆小资料。
         *
         * 再把 `turn/end` 给的 reason 一起带上：那一轮为什么结束，答案就在这里
         * （可能是 provider 报错、可能是要审批、也可能是被中断）。
         */
        if (text.trim() === '') {
          const why = settled.kind === 'ended'
            ? (settled.reason === null ? '这一轮结束了，没有给出原因' : JSON.stringify(settled.reason).slice(0, 300))
            : '等待被取消';
          throw new Error(`AI 这一轮没有任何产出（结束原因：${why}）。先确认「设置 → 模型」里那家 provider 能用；能用的前提下点「重试」。`);
        }
        const json = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        let draft;
        try {
          draft = JSON.parse(json);
        } catch {
          throw new Error('AI 回了话，但不是约定的 JSON 格式（可能没写完，或者夹了别的解释）。点「重试」再来一次；反复这样就把资料拆小一段再试。');
        }
        // AI cannot override the person's chosen name or turn a draft into a required input.
        job.draft = { ...draft, name: request.name.trim(), level: request.level };
        validatePuDraft(job.draft);
        if (typeof job.draft.summary !== 'string') throw new Error('AI 未生成 summary，请重新转换');
        job.status = 'ready';
      } catch (error) { if (!job.canceled) { job.status = 'error'; job.error = String(error?.message ?? error); } }
    })();
    return view(job);
  }
  return {
    'pu.list': async request => repository.list(request),
    'pu.read': async request => repository.read(request.slug),
    'pu.baseSources': async () => repository.baseSources(),
    'pu.generate': generate,
    'pu.job': async request => view(jobFor(request.id)),
    'pu.cancel': async request => { const job = jobFor(request.id); job.canceled = true; job.status = 'canceled'; service('sessionController')?.cancel({ sessionId: job.sessionId }); return view(job); },
    'pu.confirm': async request => {
      const job = jobFor(request.id); if (job.status !== 'ready') throw new Error('只有生成预览才能确认');
      const saved = repository.confirm({ ...(request.draft ?? job.draft), level: request.level ?? request.draft?.level ?? job.draft.level }, request.confirmed);
      jobs.delete(job.id); return saved;
    },
    'pu.update': async request => repository.update(request.slug, request.draft, request.confirmed),
  };
}
