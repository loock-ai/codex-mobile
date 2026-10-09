import { t } from '../../i18n';
import type { BackendConfig } from '../../backends/types';

export interface Dot { id: string; name: string; roomId?: string | null; paused?: boolean }
export interface DotAttachment { id: string; name: string; type: string; size: number }
export interface DotMessage { attachments?: DotAttachment[]; id: string; role: 'user' | 'assistant' | 'system'; text: string; createdAt: string; requestId?: string; deleted?: boolean }
export interface DotsStatus { available: boolean; identityKey?: string; error?: string; capabilities?: { messages: boolean; history: boolean; attachments: boolean; approvals: boolean } }
export interface DotsList { dots: Dot[]; nextCursor: string | null }
export interface DotsMessages { dotName?: string; messages: DotMessage[]; before: string | null }

export class DotsError extends Error {
  constructor(message: string, public code = '', public status = 0) { super(message); }
}

/** Uses exactly the existing gateway token. Every request is bounded and cancellable. */
export async function dotsRequest<T>(backend: BackendConfig, path: string, signal: AbortSignal, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, body === undefined ? 20_000 : 45_000);
  const url = new URL(`/api/dots/${path}`, `${backend.baseUrl}/`);
  if (backend.token) url.searchParams.set('token', backend.token);
  try {
    const response = await fetch(url.toString(), {
      method: body === undefined ? 'GET' : 'POST', mode: 'cors', signal: controller.signal,
      ...(body === undefined ? {} : { headers: headers || { 'Content-Type': 'application/json' }, body: body instanceof File ? body : JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null) as (T & { error?: string; code?: string }) | null;
    if (!response.ok) throw new DotsError(data?.error || t("设备接口返回 HTTP {status}", { status: response.status }), data?.code || '', response.status);
    if (!data) throw new DotsError(t('设备返回了无法读取的响应'));
    return data;
  } catch (error) {
    if (error instanceof DotsError) throw error;
    throw new DotsError(controller.signal.aborted ? t('请求已取消或超时') : t('设备连接中断，请检查网络后重试'));
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

export function mergeMessages(current: DotMessage[], incoming: DotMessage[]): DotMessage[] {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => {
    const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return (Number.isFinite(byTime) && byTime !== 0) ? byTime : a.id.localeCompare(b.id);
  });
}

export function createRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // LAN HTTP pages may expose getRandomValues but not the secure-context randomUUID API.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uploadDotAttachment(backend: BackendConfig, dotId: string, file: File, signal: AbortSignal): Promise<{ attachment: DotAttachment }> {
  return dotsRequest(backend, `upload?dotId=${encodeURIComponent(dotId)}`, signal, file, {
    'Content-Type': file.type || 'application/octet-stream',
    'x-codex-file-name': encodeURIComponent(file.name),
  });
}
