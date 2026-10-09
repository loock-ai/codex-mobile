import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { BackendConfig } from '../../backends/types';
import { ActionSheet } from '../../ui/ActionSheet';
import { Chevron } from '../../ui/icons';
import { MarkdownMessage } from '../../ui/conversation';
import { createRequestId, dotsRequest, DotsError, mergeMessages, type Dot, type DotMessage, type DotsList, type DotsMessages, type DotsStatus } from './api';
import { t, useI18n } from '../../i18n';
import './dots.css';

type Receipt = { requestId: string; dotName: string; deviceName: string; backendId?: string; dotId?: string; identityKey?: string; hiddenContent?: boolean; text: string; state: 'pending' | 'unknown' };
const RECEIPTS_KEY = 'codex-mobile:dots-unconfirmed';
function readReceipts(): Receipt[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item): item is Receipt => item && ['requestId', 'dotName', 'deviceName', 'text'].every(key => typeof item[key] === 'string')) : [];
  } catch { return []; }
}
type ReceiptActions = {
  onTrack: (receipt: Receipt) => boolean;
  onUnknown: (requestId: string) => void;
  onResolved: (requestId: string) => void;
};
const errorText = (error: unknown) => error instanceof Error ? error.message : t('请求失败，请重试');

export function DotsPage({ backends, onBack }: { backends: BackendConfig[]; onBack: () => void }) {
  useI18n();
  const devices = backends.filter(backend => backend.enabled && !backend.parentBackendId && !backend.desktopHostId);
  const [selected, setSelected] = useState(devices[0]?.id || '');
  const [identity, setIdentity] = useState<{ backendId: string; key?: string } | null>(null);
  const onIdentity = useCallback((backendId: string, key?: string) => {
    setIdentity(previous => previous?.backendId === backendId && previous.key === key ? previous : { backendId, key });
  }, []);
  const backend = devices.find(device => device.id === selected) || devices[0];
  const [receipts, setReceipts] = useState<Receipt[]>(() => readReceipts().map(receipt => ({ ...receipt, state: 'unknown' })));
  const updateReceipts = useCallback((change: (previous: Receipt[]) => Receipt[]) => {
    const next = change(readReceipts());
    // Save before dispatch so reload/unmount cannot erase the reconciliation ID.
    try { localStorage.setItem(RECEIPTS_KEY, JSON.stringify(next)); } catch { return false; }
    setReceipts(next);
    return true;
  }, []);
  const onTrack = useCallback((receipt: Receipt) => updateReceipts(previous => [...previous.filter(item => item.requestId !== receipt.requestId), receipt]), [updateReceipts]);
  const onUnknown = useCallback((requestId: string) => updateReceipts(previous => previous.map(item => item.requestId === requestId ? { ...item, state: 'unknown' } : item)), [updateReceipts]);
  const onAccountInvalidated = useCallback((backendId: string) => updateReceipts(previous => previous.map(item => item.backendId === backendId ? { ...item, hiddenContent: true } : item)), [updateReceipts]);
  const onResolved = useCallback((requestId: string) => updateReceipts(previous => previous.filter(item => item.requestId !== requestId)), [updateReceipts]);
  const unresolved = receipts.filter(receipt => receipt.state !== 'pending');
  const notices = unresolved.length > 0 && <div className="dots-notices">{unresolved.map(receipt => <div className="dots-warning" role="alert" key={receipt.requestId}>
    <strong>{receipt.state === 'pending' ? t('正在等待投递结果…') : t('投递结果未知，请先核对消息，避免重复发送。')}</strong>
    <div>{receipt.hiddenContent || !receipt.identityKey || receipt.backendId !== backend?.id || receipt.backendId !== identity?.backendId || receipt.identityKey !== identity?.key ? t("身份尚未匹配，消息内容已隐藏。") : <>{receipt.deviceName} · {receipt.dotName}：{receipt.text}</>}</div>
    <div>{t("请求 ID：")}<code>{receipt.requestId}</code></div>
    {receipt.state !== 'pending' && <button onClick={() => onResolved(receipt.requestId)}>{t("已核对")}</button>}
  </div>)}</div>;
  return <main className="dots-page">
    {backend ? <DeviceDots key={`${backend.id}:${backend.baseUrl}:${backend.token}`} backend={backend} devices={devices} onDeviceChange={setSelected} onBack={onBack} notices={notices} onUnknown={onUnknown} onTrack={onTrack} onResolved={onResolved} onAccountInvalidated={onAccountInvalidated} onIdentity={onIdentity} /> : <>
      <header className="dots-header"><button className="dots-icon-button" aria-label={t('返回 Codex')} onClick={onBack}><Chevron direction="left" /></button><h1>Dots</h1></header>
      {notices}<div className="dots-empty-state"><h2>{t('连接你的设备')}</h2><p>{t('请先在 Codex 中配置并启用设备。')}</p><button className="dots-primary-button" onClick={onBack}>{t('返回 Codex')}</button></div>
    </>}
  </main>;
}

type ChatState = 'loading' | 'ready' | 'error';

function DeviceDots({ backend, devices, onDeviceChange, onBack, notices, onUnknown, onTrack, onResolved, onAccountInvalidated, onIdentity }: { backend: BackendConfig; devices: BackendConfig[]; onDeviceChange: (id: string) => void; onBack: () => void; notices: ReactNode; onAccountInvalidated: (backendId: string) => void; onIdentity: (backendId: string, key?: string) => void } & ReceiptActions) {
  const [dots, setDots] = useState<Dot[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chatState, setChatState] = useState<ChatState>('loading');
  const [status, setStatus] = useState<DotsStatus | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Dot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  const loading = useRef(false);
  const accountChanged = useCallback(() => {
    lifetime.current?.abort();
    lifetime.current = new AbortController();
    loading.current = false;
    setBusy(false); setDots([]); setSelected(null); setCursor(null); setStatus(null);
    setError(t('账号已切换，请重启启动器后重新连接 Dots。'));
    onIdentity(backend.id);
    onAccountInvalidated(backend.id);
  }, [backend.id, onAccountInvalidated, onIdentity]);
  const load = useCallback(async (next?: string) => {
    if (loading.current || !lifetime.current) return;
    const signal = lifetime.current.signal;
    loading.current = true; setBusy(true); setError('');
    try {
      if (!next) {
        onIdentity(backend.id);
        const result = await dotsRequest<DotsStatus>(backend, 'status', signal);
        if (signal.aborted) return;
        setStatus(result);
        onIdentity(backend.id, result.available ? result.identityKey : undefined);
        if (!result.available || result.capabilities?.messages === false) return;
      }
      const result = await dotsRequest<DotsList>(backend, `list${next ? `?cursor=${encodeURIComponent(next)}` : ''}`, signal);
      if (signal.aborted) return;
      setDots(previous => [...new Map([...(next ? previous : []), ...result.dots].map(dot => [dot.id, dot])).values()]);
      setCursor(result.nextCursor);
      setSelected(previous => previous || result.dots.find(dot => !dot.paused && dot.roomId !== null) || result.dots[0] || null);
    } catch (reason) {
      if (!signal.aborted) {
        if (reason instanceof DotsError && reason.code === 'DOTS_ACCOUNT_CHANGED') accountChanged();
        else setError(errorText(reason));
      }
    }
    finally { if (!signal.aborted) { loading.current = false; setBusy(false); } }
  }, [backend, accountChanged, onIdentity]);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller; loading.current = false;
    void load();
    return () => { controller.abort(); lifetime.current?.abort(); };
  }, [load]);
  const updateDotName=useCallback((id:string,name:string)=>{
    if(!name.trim())return;
    setSelected(current=>current?.id===id&&current.name!==name?{...current,name}:current);
    setDots(current=>current.map(dot=>dot.id===id&&dot.name!==name?{...dot,name}:dot));
  },[]);
  const unavailable = status && (!status.available || status.capabilities?.messages === false);
  const connection = error || chatState === 'error' ? t('连接中断') : busy || !status ? t('正在连接…') : unavailable ? t('暂不可用') : selected && chatState === 'loading' ? t('正在读取消息…') : t('已连接');
  const singleDot = dots.length === 1 && !cursor;
  const titleContent = <>
    <span className="dots-title-line"><span>{selected?.name || 'Dots'}</span>{!singleDot && <Chevron direction="down" />}</span>
    <span className="dots-connection"><i className={error || chatState === 'error' ? 'is-error' : status?.available ? 'is-online' : ''} aria-hidden="true" />{backend.name}<span className="dots-connection-divider" aria-hidden="true" />{connection}</span>
  </>;
  return <>
    <header className="dots-header">
      <button className="dots-icon-button" type="button" aria-label={t('返回 Codex')} onClick={onBack}><Chevron direction="left" /></button>
      {singleDot ? <div className="dots-title-static">{titleContent}</div> : <button className="dots-title-button" type="button" aria-label={t('切换 Dot 或设备')} aria-expanded={pickerOpen} onClick={() => setPickerOpen(true)}>{titleContent}</button>}
      {singleDot && devices.length > 1 ? <button className="dots-icon-button" type="button" aria-label={t('切换设备')} aria-expanded={pickerOpen} onClick={() => setPickerOpen(true)}>
        <svg className="dots-device-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 21h8M12 16v5" /></svg>
      </button> : <span className="dots-header-spacer" aria-hidden="true" />}
    </header>
    {notices}
    {error && <div className="dots-warning" role="alert">{error}<button onClick={() => void load(cursor || undefined)}>{t('重试连接')}</button></div>}
    {unavailable && <div className="dots-empty-state" role="status"><h2>{t('暂时无法连接 Dots')}</h2><p>{status.error || t('当前设备暂不支持 Dots 消息。')}</p><button className="dots-primary-button" disabled={busy} onClick={() => void load()}>{t('重新检查')}</button></div>}
    {!selected && !unavailable && !error && <div className="dots-empty-state">
      {busy ? <><span className="dots-loading" aria-hidden="true" /><p role="status">{t('正在连接…')}</p></> : <>
        <svg className="dots-empty-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M39 23a15 15 0 0 1-15 15H12l-7 5V23A19 19 0 0 1 24 4a15 15 0 0 1 15 19Z" /><path d="M15 20h16M15 27h10" /></svg>
        <h2>{t('未找到可用 Dot')}</h2><p>{t('当前设备还未返回可聊天的 Dot。请重新加载，或切换设备查看。')}</p>
        <div className="dots-empty-actions"><button className="dots-primary-button" onClick={() => void load(cursor || undefined)}>{t('重新加载')}</button><button className="dots-text-button" onClick={() => setPickerOpen(true)}>{t('切换设备')}</button></div>
      </>}
    </div>}
    {selected && !unavailable && <DotChat key={selected.id} backend={backend} dot={selected} identityKey={status?.identityKey} history={status?.capabilities?.history !== false} onState={setChatState} onName={updateDotName} onUnknown={onUnknown} onTrack={onTrack} onResolved={onResolved} onAccountChanged={accountChanged} />}
    <ActionSheet open={pickerOpen} title={singleDot ? t('选择设备') : t('选择 Dot')} ariaLabel={singleDot ? t('选择设备') : t('选择 Dot')} className="dots-picker" onClose={() => setPickerOpen(false)} showHandle>
      <div className="dots-picker-label">{t('设备')}</div>
      <div className="dots-device-tabs" role="group" aria-label={t('Dots 设备')}>{devices.map(device => <button key={device.id} type="button" aria-pressed={device.id === backend.id} onClick={() => { if (device.id !== backend.id) onDeviceChange(device.id); }}>{device.name}</button>)}</div>
      {!singleDot && <><div className="dots-picker-label">{t('Dots 列表')}</div>
      <div className="dots-choices">{dots.map(dot => <button key={dot.id} type="button" aria-label={dot.name || t('未命名 Dot')} aria-pressed={selected?.id === dot.id} onClick={() => { if (selected?.id !== dot.id) setChatState('loading'); setSelected(dot); setPickerOpen(false); }}>
        <span className="dots-choice-avatar" aria-hidden="true">{(dot.name || 'D').slice(0, 1)}</span><span className="dots-choice-name">{dot.name || t('未命名 Dot')}{dot.paused && <small>{t('（已暂停）')}</small>}</span><span className="dots-choice-check" aria-hidden="true">{selected?.id === dot.id ? '✓' : ''}</span>
      </button>)}</div></>}
      {dots.length === 0 && <p className="dots-picker-empty">{busy ? t('正在连接…') : t('未找到可用 Dot')}</p>}
      {cursor && <button className="dots-history" disabled={busy} onClick={() => void load(cursor)}>{t('加载更多 Dots')}</button>}
    </ActionSheet>
  </>;
}

function DotChat({ backend, dot, history, onUnknown, onTrack, onResolved, onAccountChanged, identityKey, onState, onName }: { backend: BackendConfig; onState: (state: ChatState) => void; onName: (id:string,name:string)=>void; dot: Dot; history: boolean; identityKey?: string; onAccountChanged: () => void } & ReceiptActions) {
  const [messages, setMessages] = useState<DotMessage[]>([]);
  const currentMessages = useRef<DotMessage[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const reading = useRef(false);
  const writing = useRef(false);
  const initialized = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = '24px';
    input.current.style.height = `${Math.min(input.current.scrollHeight || 24, 120)}px`;
  }, [draft]);
  const read = useCallback(async (older?: string) => {
    if (reading.current || !lifetime.current || document.hidden) return;
    const signal = lifetime.current.signal;
    reading.current = true; setLoading(true);
    const element = scroll.current;
    const previousHeight = element?.scrollHeight || 0;
    const followBottom = element ? element.scrollHeight - element.scrollTop - element.clientHeight < 100 : true;
    try {
      const result = await dotsRequest<DotsMessages>(backend, `messages?dotId=${encodeURIComponent(dot.id)}${older ? `&before=${encodeURIComponent(older)}` : ''}`, signal);
      if (signal.aborted) return;
      if(result.dotName)onName(dot.id,result.dotName);
      const knownIds = new Set(currentMessages.current.map(message => message.id));
      // A disjoint head means messages arrived outside the visible window while away.
      // Restart pagination at that head instead of presenting a silently gapped timeline.
      const resetWindow = !older && initialized.current && !result.messages.some(message => knownIds.has(message.id));
      currentMessages.current = mergeMessages(resetWindow ? [] : currentMessages.current, result.messages);
      setMessages(currentMessages.current);
      if (!initialized.current || older || resetWindow) setBefore(result.before);
      initialized.current = true; setReady(true); setError(''); onState('ready');
      requestAnimationFrame(() => {
        if (signal.aborted || !element) return;
        if (older) element.scrollTop += element.scrollHeight - previousHeight;
        else if (followBottom) element.scrollTop = element.scrollHeight;
      });
    } catch (reason) {
      if (!signal.aborted) {
        if (reason instanceof DotsError && reason.code === 'DOTS_ACCOUNT_CHANGED') { lifetime.current?.abort(); onAccountChanged(); }
        else { setError(errorText(reason)); onState('error'); }
      }
    }
    finally { if (!signal.aborted) { reading.current = false; setLoading(false); } }
  }, [backend, dot.id, onAccountChanged, onState, onName]);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller; reading.current = false;
    void read();
    const timer = setInterval(() => { if (!document.hidden) void read(); }, 3000);
    const visible = () => { if (!document.hidden) void read(); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [read]);
  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || writing.current || !lifetime.current) return;
    const signal = lifetime.current.signal;
    const requestId = createRequestId();
    if (!onTrack({ requestId, dotName: dot.name, deviceName: backend.name, backendId: backend.id, dotId: dot.id, identityKey, text, state: 'pending' })) {
      setSendError(t('无法保存待核对记录，本次未发送。请检查浏览器存储。'));
      return;
    }
    writing.current = true; setSending(true); setSendError('');
    try {
      const result = await dotsRequest<{ message: DotMessage }>(backend, 'send', signal, { dotId: dot.id, text, requestId });
      if (signal.aborted) { onUnknown(requestId); return; }
      onResolved(requestId);
      currentMessages.current = mergeMessages(currentMessages.current, [result.message]);
      setMessages(currentMessages.current); setDraft('');
      requestAnimationFrame(() => { if (!signal.aborted && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; });
    } catch (reason) {
      if (reason instanceof DotsError && reason.code === 'DOTS_ACCOUNT_CHANGED') {
        onUnknown(requestId);
        if (!signal.aborted) { lifetime.current?.abort(); onAccountChanged(); }
        return;
      }
      const unknown = !(reason instanceof DotsError) || reason.code === 'DOTS_WRITE_UNKNOWN' || reason.status === 0 || (reason.status >= 500 && !['DOTS_UNAVAILABLE', 'DOTS_LEDGER_FULL', 'DOTS_READ_FAILED', 'DOTS_INVALID_RESPONSE', 'DOTS_PAGINATION_FAILED'].includes(reason.code));
      if (unknown) {
        onUnknown(requestId);
        if (!signal.aborted) setDraft('');
      } else { onResolved(requestId); if (!signal.aborted) setSendError(errorText(reason)); }
    } finally { if (!signal.aborted) { writing.current = false; setSending(false); } }
  }
  return <section className="dots-chat" aria-label={t("{name} 消息", { name: dot.name })}>
    {error && <div className="dots-warning" role="alert">{error}<button disabled={loading} onClick={() => void read()}>{t('重试读取')}</button></div>}
    <div className="dots-messages" ref={scroll} aria-busy={!ready && loading}>
      {history && before && <button className="dots-history" disabled={loading} onClick={() => void read(before)}>{t('加载更早消息')}</button>}
      {!ready && loading && <div className="dots-reading" role="status"><span className="dots-loading" aria-hidden="true" />{t('正在读取消息…')}</div>}
      {ready && !messages.some(message => !message.deleted) && <div className="dots-chat-empty"><h2>{t("想聊点什么？")}</h2><p>{t('暂无消息，发送文字开始聊天。')}</p></div>}
      {messages.filter(message => !message.deleted).map(message => <article className={`dots-message dots-message-${message.role}`} key={message.id} aria-label={message.role === 'user' ? t('你') : message.role === 'system' ? t('系统') : dot.name}>
        <MarkdownMessage text={message.text} renderImage={(_source, alt) => <span>{t("[图片：{alt}]", { alt: alt || t('请在桌面查看') })}</span>} />
      </article>)}
    </div>
    {sendError && <div role="alert" className="dots-warning">{sendError}</div>}
    <form className="dots-composer" onSubmit={event => void send(event)}>
      <textarea ref={input} aria-label={t("消息")} placeholder={t("发送消息")} rows={1} value={draft} disabled={sending} onChange={event => setDraft(event.target.value)} />
      <button className="dots-send-button" type="submit" aria-label={sending ? t('发送中…') : t('发送')} disabled={!ready || !draft.trim() || sending}>
        {sending ? <span className="dots-loading" aria-hidden="true" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>}
      </button>
    </form>
  </section>;
}
