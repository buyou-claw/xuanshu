import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPuRepository, puSlug, validatePuDraft } from './repository.mjs';
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
    const prompt = `${skill}\n\n用户定义：${JSON.stringify({ name: request.name, level: request.level })}\n资料文字：\n${request.text ?? ''}\n附件（当前目录，只读来源）：${JSON.stringify(files)}\n${request.summaryOnly ? '本次只重新提炼 summary；其他字段保持用户提供的事实。' : ''}`;
    void (async () => {
      try {
        await controller.prompt({ requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }], clientTimeZone: request.clientTimeZone ?? 'Asia/Shanghai' }, new AbortController().signal);
        const resolved = await controller.resolveAgent(sessionId); if (resolved.error) throw resolved.error;
        await resolved.agent.whenIdle();
        if (job.canceled) return;
        const event = [...resolved.agent.session.snapshotEvents()].reverse().find(e => e.type === 'assistant/message');
        const text = event?.data?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? '';
        const json = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        const draft = JSON.parse(json);
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
