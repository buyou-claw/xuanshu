export interface CangPointer { valid: boolean; path: string; kind?: 'file' | 'directory'; reason?: string; checkedAt: string }
export interface CangDraft { id?: string; path: string; name: string; tags: string[]; actions: { open: boolean; reveal: boolean; copy: boolean } }
export interface CangEntry extends CangDraft { id: string; createdAt: string; updatedAt: string; pointer: CangPointer }
export interface CangList { registryPath: string; entries: CangEntry[] }
export interface CangCapabilities { directoryPicker: boolean; desktop: boolean; filePicker: false }
export interface CangApi {
  list(signal?: AbortSignal): Promise<CangList>;
  validate(path: string, signal?: AbortSignal): Promise<CangPointer>;
  register(draft: CangDraft): Promise<CangEntry>;
  update(draft: CangDraft): Promise<CangEntry>;
  remove(id: string): Promise<unknown>;
  open(id: string): Promise<unknown>;
  reveal(id: string): Promise<unknown>;
  capabilities(signal?: AbortSignal): Promise<CangCapabilities>;
  pickDirectory(): Promise<{ path: string | null }>;
}
export interface CangController {
  snapshot(): { revision: number; draft?: CangDraft };
  subscribe(listener: () => void): () => void;
  edit(draft: CangDraft): void;
  close(): void;
  changed(): void;
}
export const CANG_AI_FREE = '藏永不进 AI：只登记指针、签与跳转 —— 玄枢不读、不索引、不分析、不进上下文';
export const newCangDraft = (): CangDraft => ({ path: '', name: '', tags: [], actions: { open: true, reveal: true, copy: true } });
