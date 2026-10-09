import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DotsPage } from '../../src/features/dots/DotsPage';
import type { BackendConfig } from '../../src/backends/types';

const backends: BackendConfig[] = [{ id: 'one', name: 'Mac', baseUrl: 'http://device.test', token: 'secret', enabled: true, order: 0 }];
const message = (id: string, text: string, createdAt = '2026-10-09T01:00:00Z') => ({ id, text, createdAt, role: 'assistant' });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function setup(handler?: (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined, devices: BackendConfig[] = backends) {
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = new URL(input);
    const custom = handler?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url.pathname.endsWith('/status')) return Promise.resolve(reply({ available: true, identityKey: 'identity-one', capabilities: { messages: true, history: true } }));
    if (url.pathname.endsWith('/list')) return Promise.resolve(reply({ dots: [{ id: 'a', name: '助理' }, { id: 'b', name: '研究' }], nextCursor: null }));
    return Promise.resolve(reply({ roomId: 'room', messages: [message('m1', '最新消息')], before: null }));
  }));
  return render(<DotsPage backends={devices} onBack={() => {}} />);
}
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Dots 手机页面', () => {
  it('读取列表、历史分页并使用设备口令发送文字', async () => {
    setup((url, init) => {
      expect(url.searchParams.get('token')).toBe('secret');
      if (url.pathname.endsWith('/messages')) return reply({ messages: url.searchParams.has('before') ? [message('m0', '更早消息', '2026-10-08T00:00:00Z')] : [message('m1', '最新消息')], before: url.searchParams.has('before') ? null : 'cursor' });
      if (url.pathname.endsWith('/send')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ dotId: 'a', text: '你好' });
        expect(body.requestId).toMatch(/^[\da-f-]{36}$/);
        return reply({ message: { ...message('sent', body.text), role: 'user' } });
      }
    });
    await screen.findByRole('textbox', { name: '消息' });
    await screen.findByText('最新消息');
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
    await screen.findByText('更早消息');
    fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('你好');
    expect(screen.getByRole('textbox', { name: '消息' })).toHaveValue('');
  });

  it('切换 Dot 后忽略迟到响应', async () => {
    let resolveOld!: (response: Response) => void;
    setup(url => {
      if (url.pathname.endsWith('/messages') && url.searchParams.get('dotId') === 'a') return new Promise(resolve => { resolveOld = resolve; });
    });
    await screen.findByRole('textbox', { name: '消息' });
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: '切换 Dot 或设备' }));
    fireEvent.click(screen.getByRole('button', { name: '研究' }));
    await screen.findByText('最新消息');
    await act(async () => resolveOld(reply({ messages: [message('old', '迟到旧消息')], before: null })));
    expect(screen.queryByText('迟到旧消息')).not.toBeInTheDocument();
  });

  it('未知投递保留请求编号且不恢复输入或重复发送', async () => {
    setup(url => url.pathname.endsWith('/send') ? reply({ code: 'DOTS_WRITE_UNKNOWN', error: '响应丢失' }, 502) : undefined);
    await screen.findByRole('textbox', { name: '消息' });
    await screen.findByText('最新消息');
    fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '可能已发送' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText(/投递结果未知/);
    expect(screen.getByRole('textbox', { name: '消息' })).toHaveValue('');
    expect(screen.getByText(/请求 ID：/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });

  it('明确拒绝发送保留草稿供修改', async () => {
    setup(url => url.pathname.endsWith('/send') ? reply({ code: 'INVALID_TEXT', error: '消息无效' }, 400) : undefined);
    await screen.findByRole('textbox', { name: '消息' });
    await screen.findByText('最新消息');
    fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText(/消息无效/);
    expect(screen.getByRole('textbox', { name: '消息' })).toHaveValue('草稿');
  });

  it('轮询合并更新和去重，保留已加载的更早历史', async () => {
    let latest = 0;
    setup(url => {
      if (!url.pathname.endsWith('/messages')) return;
      if (url.searchParams.has('before')) return reply({ messages: [message('m0', '老历史', '2026-10-08T00:00:00Z')], before: null });
      latest++;
      return reply({ messages: [message('m1', latest > 1 ? '更新后消息' : '最新消息')], before: 'older' });
    });
    await screen.findByRole('textbox', { name: '消息' });
    await screen.findByText('最新消息');
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
    await screen.findByText('老历史');
    await screen.findByText('更新后消息', {}, { timeout: 4500 });
    expect(screen.getAllByText('更新后消息')).toHaveLength(1);
    expect(screen.getByText('老历史')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更早消息' })).not.toBeInTheDocument();
  });
});

it('空列表、不支持的设备和断连提供明确状态与恢复入口', async () => {
  let state = 'offline';
  setup(url => {
    if (url.pathname.endsWith('/status')) {
      if (state === 'offline') return Promise.reject(new TypeError('offline'));
      return reply({ available: state !== 'unsupported', error: state === 'unsupported' ? '桌面构建不支持' : undefined });
    }
    if (url.pathname.endsWith('/list')) return reply({ dots: [], nextCursor: null });
  });
  await screen.findByText(/设备连接中断/);
  state = 'unsupported';
  fireEvent.click(screen.getByRole('button', { name: '重试连接' }));
  await screen.findByText('桌面构建不支持');
  state = 'ready';
  fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
  await screen.findByText('未找到可用 Dot');
});

it('设备切换中止旧请求，迟到的列表不覆盖新设备', async () => {
  let resolveOld!: (response: Response) => void;
  let oldSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/status')) return Promise.resolve(reply({ available: true }));
    if (url.pathname.endsWith('/messages')) return Promise.resolve(reply({ messages: [], before: null }));
    if (url.host === 'device.test') { oldSignal = init?.signal as AbortSignal; return new Promise<Response>(resolve => { resolveOld = resolve; }); }
    return Promise.resolve(reply({ dots: [{ id: 'new', name: '新设备的 Dot' }], nextCursor: null }));
  }));
  render(<DotsPage backends={[...backends, { ...backends[0], id: 'two', name: 'Mac 2', baseUrl: 'http://second.test' }]} onBack={() => {}} />);
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: '切换 Dot 或设备' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mac 2' }));
  await screen.findByRole('region', { name: '新设备的 Dot 消息' });
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => resolveOld(reply({ dots: [{ id: 'old', name: '旧设备的 Dot' }], nextCursor: null })));
  expect(screen.queryByRole('button', { name: '旧设备的 Dot' })).not.toBeInTheDocument();
});

it('隐藏时停止读取，恢复可见后立即刷新，长请求不会重叠', async () => {
  vi.useFakeTimers();
  let reads = 0;
  let finish!: (response: Response) => void;
  await act(async () => {
    setup(url => {
      if (url.pathname.endsWith('/messages')) {
        reads++;
        return new Promise<Response>(resolve => { finish = resolve; });
      }
    });
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(reads).toBe(1);
  await act(async () => finish(reply({ messages: [message('one', '已恢复')], before: null })));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(reads).toBe(1);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(reads).toBe(2);
  await act(async () => finish(reply({ messages: [], before: null })));
  vi.restoreAllMocks();
});

it('发送进行中禁止重复发送，断连被视为投递未知', async () => {
  let rejectSend!: (error: Error) => void;
  let sends = 0;
  setup(url => {
    if (url.pathname.endsWith('/send')) { sends++; return new Promise<Response>((_resolve, reject) => { rejectSend = reject; }); }
  });
  await screen.findByRole('textbox', { name: '消息' });
  await screen.findByText('最新消息');
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '你好' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  const pending = screen.getByRole('button', { name: '发送中…' });
  expect(pending).toBeDisabled();
  fireEvent.click(pending);
  expect(sends).toBe(1);
  await act(async () => rejectSend(new TypeError('network lost')));
  expect(screen.getByText(/投递结果未知/)).toBeInTheDocument();
});


it('明确未发送的服务错误保留草稿', async () => {
  setup(url => url.pathname.endsWith('/send') ? reply({ code: 'DOTS_UNAVAILABLE', error: '桌面不可用' }, 503) : undefined);
  await screen.findByRole('textbox', { name: '消息' });
  await screen.findByText('最新消息');
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '保留我的草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText(/桌面不可用/);
  expect(screen.getByRole('textbox', { name: '消息' })).toHaveValue('保留我的草稿');
  expect(screen.queryByText(/投递结果未知/)).toBeNull();
});

it('发送前持久化请求，重新进入后能核对并手动清除', async () => {
  setup(url => url.pathname.endsWith('/send') ? new Promise<Response>(() => {}) : undefined);
  await screen.findByRole('textbox', { name: '消息' });
  await screen.findByText('最新消息');
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '待核对的消息' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  cleanup();
  render(<DotsPage backends={backends} onBack={() => {}} />);
  await screen.findByText(/投递结果未知/);
  expect(await screen.findByText(/待核对的消息/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '已核对' }));
  expect(screen.queryByText(/请求 ID：/)).toBeNull();
  cleanup();
  render(<DotsPage backends={backends} onBack={() => {}} />);
  expect(screen.queryByText(/请求 ID：/)).toBeNull();
});

it('浏览器无法持久化待核对请求时不发出消息，保留草稿', async () => {
  let sends = 0;
  setup(url => { if (url.pathname.endsWith('/send')) { sends++; return reply({ message: message('sent', 'test') }); } });
  await screen.findByRole('textbox', { name: '消息' });
  await screen.findByText('最新消息');
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '持久化前不发送' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText(/无法保存待核对记录/);
  expect(sends).toBe(0);
  expect(screen.getByRole('textbox', { name: '消息' })).toHaveValue('持久化前不发送');
  spy.mockRestore();
});

it('局域网 HTTP 缺少 randomUUID 时仍能生成合法请求编号', async () => {
  const cryptoProvider = globalThis.crypto;
  vi.stubGlobal('crypto', { getRandomValues: cryptoProvider.getRandomValues.bind(cryptoProvider) });
  setup((url, init) => {
    if (url.pathname.endsWith('/send')) {
      const body = JSON.parse(String(init?.body));
      expect(body.requestId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
      return reply({ message: message('sent', '局域网发送成功') });
    }
  });
  await screen.findByRole('textbox', { name: '消息' });
  await screen.findByText('最新消息');
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '你好' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText('局域网发送成功');
});

it('轮询头页与缓存不相交时重置窗口，新的历史游标可追溯缺口', async () => {
  vi.useFakeTimers();
  let reads = 0;
  await act(async () => setup(url => {
    if (!url.pathname.endsWith('/messages')) return;
    const before = url.searchParams.get('before');
    if (before === 'gap') return reply({ messages: [message('middle', '缺口中的消息')], before: 'old' });
    if (before === 'old') return reply({ messages: [message('initial', '原有消息')], before: null });
    reads++;
    return reads === 1 ? reply({ messages: [message('initial', '原有消息')], before: null }) : reply({ messages: [message('new', '新窗口消息')], before: 'gap' });
  }));
  expect(screen.getByText('原有消息')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByText('新窗口消息')).toBeInTheDocument();
  expect(screen.queryByText('原有消息')).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '加载更早消息' })));
  expect(screen.getByText('缺口中的消息')).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '加载更早消息' })));
  expect(screen.getByText('原有消息')).toBeInTheDocument();
});

it('空的轮询头页清除旧消息和旧历史游标', async () => {
  vi.useFakeTimers();
  let reads = 0;
  await act(async () => setup(url => {
    if (url.pathname.endsWith('/messages')) return ++reads === 1 ? reply({ messages: [message('old', '已失效消息')], before: 'stale' }) : reply({ messages: [], before: null });
  }));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.queryByText('已失效消息')).toBeNull();
  expect(screen.queryByRole('button', { name: '加载更早消息' })).toBeNull();
  expect(screen.getByText('暂无消息，发送文字开始聊天。')).toBeInTheDocument();
});

it('账号切换清除列表与历史并暂停读取，重新连接前不展示新账号内容', async () => {
  vi.useFakeTimers();
  localStorage.setItem('codex-mobile:dots-unconfirmed', JSON.stringify([{ requestId: 'unconfirmed', backendId: 'one', dotId: 'a', deviceName: 'Mac', dotName: '旧 Dot', text: '旧账号未确认文字', state: 'unknown' }]));
  let changed = false;
  let reads = 0;
  await act(async () => setup(url => {
    if (changed && url.pathname.endsWith('/list')) return reply({ dots: [{ id: 'next', name: '新账号 Dot' }], nextCursor: null });
    if (url.pathname.endsWith('/messages')) {
      if (url.searchParams.get('dotId') === 'next') return reply({ messages: [], before: null });
      reads++;
      return changed ? reply({ code: 'DOTS_ACCOUNT_CHANGED', error: '账号已切换' }, 409) : reply({ messages: [message('old', '旧账号历史')], before: 'old' });
    }
  }));
  expect(screen.getByText('旧账号历史')).toBeInTheDocument();
  changed = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.queryByText('旧账号历史')).toBeNull();
  expect(screen.queryByRole('textbox', { name: '消息' })).toBeNull();
  expect(screen.queryByRole('button', { name: '助理' })).toBeNull();
  expect(screen.queryByText(/旧账号未确认文字/)).toBeNull();
  expect(screen.getByText('unconfirmed')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(reads).toBe(2);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试连接' })));
  expect(screen.getByRole('region', { name: '新账号 Dot 消息' })).toBeInTheDocument();
});

it('发送遇到账号变化时保留核对编号并关闭当前聊天', async () => {
  setup(url => url.pathname.endsWith('/send') ? reply({ code: 'DOTS_ACCOUNT_CHANGED', error: '账号已切换' }, 409) : undefined);
  await screen.findByRole('textbox', { name: '消息' });
  await screen.findByText('最新消息');
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '不能串账号的内容' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText('账号已切换，请重启启动器后重新连接 Dots。');
  expect(screen.queryByRole('textbox', { name: '消息' })).toBeNull();
  expect(screen.queryByText('最新消息')).toBeNull();
  expect(screen.queryByText(/不能串账号的内容/)).toBeNull();
  expect(screen.getByText(/请求 ID：/)).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('codex-mobile:dots-unconfirmed') || '[]')).toHaveLength(1);
});


it('网关重启后身份指纹不匹配或旧记录无指纹时只显示请求编号', async () => {
  localStorage.setItem('codex-mobile:dots-unconfirmed', JSON.stringify([
    { requestId: 'old-account-request', backendId: 'one', identityKey: 'previous-account', dotName: '旧私密名称', deviceName: 'Mac', text: '旧私密内容', state: 'unknown' },
    { requestId: 'legacy-request', backendId: 'one', dotName: '遗留私密名称', deviceName: 'Mac', text: '遗留私密内容', state: 'unknown' },
    { requestId: 'current-request', backendId: 'one', identityKey: 'identity-one', dotName: '当前名称', deviceName: 'Mac', text: '当前可核对文字', state: 'unknown' },
  ]));
  setup();
  await screen.findByRole('textbox', { name: '消息' });
  expect(screen.getByText('old-account-request')).toBeInTheDocument();
  expect(screen.getByText('legacy-request')).toBeInTheDocument();
  expect(screen.queryByText(/旧私密内容|旧私密名称|遗留私密内容|遗留私密名称/)).toBeNull();
  expect(screen.getByText(/当前可核对文字/)).toBeInTheDocument();
});

it('状态接口账号变化时提示重启启动器并不读取列表', async () => {
  let lists = 0;
  setup(url => {
    if (url.pathname.endsWith('/status')) return reply({ code: 'DOTS_ACCOUNT_CHANGED', error: '账号已切换' }, 409);
    if (url.pathname.endsWith('/list')) lists++;
  });
  await screen.findByText(/重启启动器/);
  expect(lists).toBe(0);
  expect(screen.queryByRole('button', { name: '助理' })).toBeNull();
});

it('进入后自动打开首个可用 Dot，设备与会话收进选择面板', async () => {
  setup();
  await screen.findByText('最新消息');
  expect(screen.getByRole('textbox', { name: '消息' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByRole('button', { name: '返回 Codex' }).querySelector('svg')).not.toBeNull();
  expect(screen.getByRole('button', { name: '发送' }).querySelector('svg')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '切换 Dot 或设备' }));
  expect(screen.getByRole('dialog', { name: '选择 Dot' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '研究' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await screen.findByRole('region', { name: '研究 消息' });
});

it('没有可用 Dot 时提供重试和切换设备，不显示可发送输入框', async () => {
  setup(url => url.pathname.endsWith('/list') ? reply({ dots: [], nextCursor: null }) : undefined);
  await screen.findByText('未找到可用 Dot');
  expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '切换设备' })).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: '消息' })).toBeNull();
});

it('自动打开有房间且未暂停的 Dot，正在发送不占用历史区展示请求编号', async () => {
  setup(url => {
    if (url.pathname.endsWith('/list')) return reply({ dots: [{ id: 'empty', name: '待初始化', roomId: null }, { id: 'ready', name: '可聊天', roomId: 'room' }], nextCursor: null });
    if (url.pathname.endsWith('/send')) return new Promise<Response>(() => {});
  });
  await screen.findByRole('region', { name: '可聊天 消息' });
  await screen.findByText('最新消息');
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '测试等待' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(screen.getByRole('button', { name: '发送中…' })).toBeDisabled();
  expect(screen.queryByText(/请求 ID：/)).toBeNull();
  expect(JSON.parse(localStorage.getItem('codex-mobile:dots-unconfirmed') || '[]')).toHaveLength(1);
});

it('只有一个 Dot 且已无下一页时展示静态标题', async () => {
  setup(url => url.pathname.endsWith('/list') ? reply({ dots: [{ id: 'a', name: '唯一 Dot' }], nextCursor: null }) : undefined);
  await screen.findByText('最新消息');
  expect(screen.getByText('唯一 Dot')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '切换 Dot 或设备' })).toBeNull();
  expect(screen.queryByRole('button', { name: '切换设备' })).toBeNull();
  expect(document.querySelector('.dots-title-line .chevron-icon')).toBeNull();
});

it('单 Dot 的多设备入口只展示设备选择，不再展示 Dot 列表', async () => {
  setup(url => url.pathname.endsWith('/list') ? reply({ dots: [{ id: 'a', name: '唯一 Dot' }], nextCursor: null }) : undefined,
    [...backends, { ...backends[0], id: 'two', name: 'Mac 2', baseUrl: 'http://second.test' }]);
  await screen.findByText('最新消息');
  expect(screen.queryByRole('button', { name: '切换 Dot 或设备' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '切换设备' }));
  expect(screen.getByRole('dialog', { name: '选择设备' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mac 2' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '唯一 Dot' })).toBeNull();
  expect(screen.queryByText('Dots 列表')).toBeNull();
});

it('首屏只有一个 Dot 但还有下一页时保留 Dot 选择与分页', async () => {
  setup(url => url.pathname.endsWith('/list') ? reply({ dots: [{ id: 'a', name: '首屏 Dot' }], nextCursor: 'more' }) : undefined);
  await screen.findByText('最新消息');
  fireEvent.click(screen.getByRole('button', { name: '切换 Dot 或设备' }));
  expect(screen.getByRole('button', { name: '首屏 Dot' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '加载更多 Dots' })).toBeInTheDocument();
});
