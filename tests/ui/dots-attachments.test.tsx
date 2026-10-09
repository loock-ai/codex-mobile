import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DotsPage } from '../../src/features/dots/DotsPage';
const backend = { id: 'one', name: 'Mac', baseUrl: 'http://device.test', token: 'secret', enabled: true, order: 0 };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function setup(handler?: (url: URL, init: RequestInit) => Response | Promise<Response> | undefined, attachments = true) {
  vi.stubGlobal('fetch', vi.fn((input: string, init: RequestInit) => {
    const url = new URL(input);
    const custom = handler?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url.pathname.endsWith('/status')) return Promise.resolve(reply({ available: true, identityKey: 'account', capabilities: { messages: true, history: true, attachments } }));
    if (url.pathname.endsWith('/list')) return Promise.resolve(reply({ dots: [{ id: 'a', name: '助理' }, { id: 'b', name: '研究' }], nextCursor: null }));
    return Promise.resolve(reply({ messages: [], before: null }));
  }));
  return render(<DotsPage backends={[backend]} onBack={() => {}} />);
}
const select = (...files: File[]) => fireEvent.change(screen.getByLabelText('选择文件或图片'), { target: { files } });
beforeEach(() => { localStorage.clear(); vi.stubGlobal('URL', URL); URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('附件先用原始文件上传，再用上传编号发送附件-only，复用消息与输入样式', async () => {
  const file = new File(['image'], '截图.png', { type: 'image/png' });
  let sent: unknown;
  setup((url, init) => {
    if (url.pathname.endsWith('/upload')) {
      expect(url.searchParams.get('dotId')).toBe('a'); expect(url.searchParams.get('token')).toBe('secret');
      expect(init.body).toBe(file); expect(init.headers).toMatchObject({ 'Content-Type': 'image/png', 'x-codex-file-name': encodeURIComponent('截图.png') });
      expect(localStorage.getItem('codex-mobile:dots-unconfirmed')).toBeNull();
      return reply({ attachment: { id: 'upload-1', name: file.name, type: file.type, size: file.size } });
    }
    if (url.pathname.endsWith('/send')) {
      sent = JSON.parse(String(init.body));
      expect(JSON.parse(localStorage.getItem('codex-mobile:dots-unconfirmed')!)[0].text).toContain('截图.png');
      return reply({ message: { id: 'sent', role: 'user', text: '', createdAt: '2026-10-09', attachments: [{ id: 'upload-1', name: file.name, type: file.type, size: file.size }] } });
    }
  });
  await screen.findByRole('textbox', { name: '消息' });
  select(file); expect(screen.getByAltText('待发送 截图.png')).toHaveAttribute('src', 'blob:preview');
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText('截图.png');
  expect(sent).toMatchObject({ dotId: 'a', text: '', attachmentIds: ['upload-1'] });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  expect(document.querySelector('.conversation-scroll .conversation-scroll-content .user-bubble')).not.toBeNull();
  expect(document.querySelector('.composer .add-button')).not.toBeNull();
  expect(screen.queryByAltText('待发送 截图.png')).toBeNull();
});
it('上传失败保留附件且不发送、不创建待核对记录', async () => {
  let sends = 0;
  setup(url => { if (url.pathname.endsWith('/upload')) return reply({ error: '上传失败' }, 503); if (url.pathname.endsWith('/send')) sends++; });
  await screen.findByRole('textbox', { name: '消息' }); select(new File(['x'], '资料.txt'));
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '发送' })); await screen.findByText('上传失败');
  expect(screen.getByText('资料.txt')).toBeInTheDocument(); expect(sends).toBe(0); expect(localStorage.getItem('codex-mobile:dots-unconfirmed')).toBeNull();
});
it('发送结果未知清空附件并保留含附件名的核对记录', async () => {
  setup(url => { if (url.pathname.endsWith('/upload')) return reply({ attachment: { id: 'upload-1' } }); if (url.pathname.endsWith('/send')) return Promise.reject(new TypeError('offline')); });
  await screen.findByRole('textbox', { name: '消息' }); select(new File(['x'], '资料.txt'));
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '发送' })); await screen.findByText(/投递结果未知/);
  expect(screen.queryByRole('button', { name: '移除 资料.txt' })).toBeNull(); expect(JSON.parse(localStorage.getItem('codex-mobile:dots-unconfirmed')!)[0].text).toContain('资料.txt');
});
it('切换Dot中止上传，迟到响应不能发送旧附件', async () => {
  let finish!: (response: Response) => void; let signal!: AbortSignal; let sends = 0;
  setup((url, init) => { if (url.pathname.endsWith('/upload')) { signal = init.signal as AbortSignal; return new Promise(resolve => { finish = resolve; }); } if (url.pathname.endsWith('/send')) sends++; });
  await screen.findByRole('textbox', { name: '消息' }); select(new File(['x'], '资料.txt'));
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '发送' })); await waitFor(() => expect(finish).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: '切换 Dot 或设备' })); fireEvent.click(screen.getByRole('button', { name: '研究' }));
  expect(signal.aborted).toBe(true); await act(async () => finish(reply({ attachment: { id: 'old' } })));
  expect(sends).toBe(0); expect(localStorage.getItem('codex-mobile:dots-unconfirmed')).toBeNull();
});
it('限制数量和大小，移除及卸载释放图片预览', async () => {
  const view = setup(); await screen.findByRole('textbox', { name: '消息' });
  select(...Array.from({ length: 5 }, (_, i) => new File(['x'], `${i}.txt`))); await screen.findByText(/最多.*4/);
  expect(screen.queryByRole('button', { name: '移除 0.txt' })).toBeNull();
  const large = new File(['x'], '大文件.txt'); Object.defineProperty(large, 'size', { value: 20 * 1024 * 1024 + 1 }); select(large); await screen.findByText(/20 MiB/);
  select(new File(['x'], '图片.png', { type: 'image/png' })); fireEvent.click(screen.getByRole('button', { name: '移除 图片.png' })); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  select(new File(['x'], '另一张.png', { type: 'image/png' })); view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it('缺少附件能力禁用附件入口并给出说明', async () => {
  setup(undefined, false); await screen.findByRole('textbox', { name: '消息' });
  expect(screen.getByRole('button', { name: '添加附件' })).toBeDisabled(); expect(screen.getByText(/当前设备不支持附件/)).toBeInTheDocument();
});
it('键盘缩小可见视口时输入区域随可见高度布局', async () => {
  const viewport = new EventTarget() as EventTarget & { height: number };
  viewport.height = 700; vi.stubGlobal('visualViewport', viewport);
  setup(); await screen.findByRole('textbox', { name: '消息' });
  expect(document.querySelector('main')).toHaveStyle({ height: '700px' });
  viewport.height = 380; act(() => viewport.dispatchEvent(new Event('resize')));
  expect(document.querySelector('main')).toHaveStyle({ height: '380px' });
});
it('上传账号切换关闭聊天，迟到上传无法继续发送', async () => {
  let sends = 0;
  setup(url => { if (url.pathname.endsWith('/upload')) return reply({ code: 'DOTS_ACCOUNT_CHANGED', error: '账号已切换' }, 409); if (url.pathname.endsWith('/send')) sends++; });
  await screen.findByRole('textbox', { name: '消息' }); select(new File(['x'], '旧账号.txt'));
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '发送' })); await screen.findByText(/重启启动器/);
  expect(sends).toBe(0); expect(screen.queryByRole('textbox', { name: '消息' })).toBeNull(); expect(localStorage.getItem('codex-mobile:dots-unconfirmed')).toBe('[]');
});
it('切换设备中止上传并释放预览，旧响应不在新设备发送', async () => {
  let finish!: (response: Response) => void; let signal!: AbortSignal; let sends = 0;
  setup((url, init) => { if (url.pathname.endsWith('/upload')) { signal = init.signal as AbortSignal; return new Promise(resolve => { finish = resolve; }); } if (url.pathname.endsWith('/send')) sends++; });
  cleanup(); render(<DotsPage backends={[backend, { ...backend, id: 'two', name: 'Mac 2', baseUrl: 'http://second.test' }]} onBack={() => {}} />);
  await screen.findByRole('textbox', { name: '消息' }); select(new File(['x'], '图片.png', { type: 'image/png' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '发送' })); await waitFor(() => expect(finish).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: '切换 Dot 或设备' })); fireEvent.click(screen.getByRole('button', { name: 'Mac 2' }));
  expect(signal.aborted).toBe(true); await act(async () => finish(reply({ attachment: { id: 'old' } })));
  expect(sends).toBe(0); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
});
it('卸载清理可见视口监听器', async () => {
  const viewport = new EventTarget() as EventTarget & { height: number }; viewport.height = 700;
  const remove = vi.spyOn(viewport, 'removeEventListener'); vi.stubGlobal('visualViewport', viewport);
  const view = setup(); await screen.findByRole('textbox', { name: '消息' }); view.unmount();
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
});
it('附件按钮采用普通全角加号，用户Markdown采用普通气泡排版', async () => {
  setup(url => url.pathname.endsWith('/messages') ? reply({ messages: [{ id: 'user', role: 'user', text: '第一段\n\n第二段', createdAt: '2026-10-09' }], before: null }) : undefined);
  await screen.findByText('第一段');
  expect(screen.getByRole('button', { name: '添加附件' })).toHaveTextContent('＋');
  expect(document.querySelector('.user-bubble .user-markdown')).not.toBeNull();
});
