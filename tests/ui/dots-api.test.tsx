import { afterEach, describe, expect, it, vi } from 'vitest';
import { dotsRequest, mergeMessages } from '../../src/features/dots/api';
const backend = { id: 'one', name: 'Mac', baseUrl: 'http://device.test', token: 'secret', enabled: true, order: 0 };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Dots 客户端边界', () => {
  it('GET 20 秒超时，POST 留出 45 秒宿主处理窗口', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal; signals.push(signal);
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const get = dotsRequest(backend, 'status', new AbortController().signal).catch(error => error);
    const post = dotsRequest(backend, 'send', new AbortController().signal, { text: 'hello' }).catch(error => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(signals[1].aborted).toBe(true);
    expect(await get).toMatchObject({ code: '' });
    expect(await post).toMatchObject({ status: 0 });
  });
  it('消息按 ID 更新并保留删除标记，避免旧消息再次展示', () => {
    const original = { id: 'm1', role: 'assistant' as const, text: 'old', createdAt: '2026-10-09T00:00:00Z' };
    expect(mergeMessages([original], [{ ...original, deleted: true, text: '' }])).toEqual([{ ...original, deleted: true, text: '' }]);
  });
});
