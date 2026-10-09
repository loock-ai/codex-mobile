import {isOpaqueId,upstreamId} from './identifiers.js';
import { DotsError, type DesktopHttpTransport, type DotMessage, type DotProfile } from './types.js';

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}; }
function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function identifier(value: unknown, name: string): string {
  if (!isOpaqueId(value)) throw new DotsError('DOTS_INVALID_INPUT', `${name} 无效`, 400);
  return value;
}
function cursor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f]/.test(value)) throw new DotsError('DOTS_INVALID_INPUT', '分页游标无效', 400);
  return value;
}
function profile(value: unknown, trustedPrimary=false): DotProfile | null {
  const p = record(value);
  const id=upstreamId(p.id);if(id===null)return null;
  const roomId=upstreamId(p.messaging_room_id);
  const legacyRoom=p.aeon_kind==null && roomId!==null;
  if(!trustedPrimary&&p.aeon_kind!=='orbit'&&!legacyRoom)return null;
  return { id, name:string(p.display_name) || string(p.name) || id, roomId,
    ...(typeof (p.active_root_thread_id??p.thread_id) === 'string' ? {threadId:(p.active_root_thread_id??p.thread_id) as string} : {}),
    ...(typeof p.is_paused === 'boolean' ? {paused:p.is_paused} : {}),
  };
}
function hidden(value: RecordValue): boolean {
  const m = record(value.metadata);
  return value.channel === 'analysis' || m.hidden === true || m.is_hidden === true;
}
function contentText(value: unknown): string {
  const c = record(value);
  if (c.content_type !== undefined && c.content_type !== 'text' && c.content_type !== 'multimodal_text') return '';
  if (typeof c.text === 'string') return c.text;
  return Array.isArray(c.parts) ? c.parts.flatMap(part => typeof part === 'string' ? [part] : typeof record(part).text === 'string' ? [record(part).text as string] : []).join('\n') : '';
}
function roomMembers(room: RecordValue): Map<string, RecordValue> {
  const snapshots = new Map<string, RecordValue>();
  for (const value of Array.isArray(room.member_profile_snapshots) ? room.member_profile_snapshots : []) {
    const snapshot = record(value);
    const id=upstreamId(snapshot.account_user_id);if(id!==null)snapshots.set(id,snapshot);
  }
  const members = new Map<string, RecordValue>();
  for (const value of Array.isArray(room.members) ? room.members : []) {
    const member = record(value);
    const id=upstreamId(member.account_user_id);if(id===null)continue;
    const snapshot = snapshots.get(id);
    // 快照仅补足仍在当前房间中的成员；显式 null 也应覆盖旧身份。
    members.set(id, {...snapshot, ...member, name:string(member.name) || string(snapshot?.name)});
  }
  return members;
}
function message(value: unknown, members: ReadonlyMap<string, RecordValue> = new Map(), ownReceipt=false): DotMessage | null {
  const m = record(value);
  const id=upstreamId(m.id);if(id===null||hidden(m))return null;
  const sender=upstreamId(m.account_user_id);const member=sender!==null?members.get(sender):undefined;
  const role: DotMessage['role'] = ownReceipt ? 'user' : Array.isArray(m.raw_messages) ? 'assistant' : member ? upstreamId(member.aeon_id)!==null ? 'assistant' : 'user' : 'system';
  const deleted = m.deleted_at != null || m.deleted === true;
  let text = '';
  if (!deleted) {
    if (ownReceipt) text = contentText(m.content);
    else if (Array.isArray(m.raw_messages)) text = m.raw_messages.flatMap(raw => {
      const r = record(raw);
      return record(r.author).role === 'assistant' && !hidden(r) && r.deleted_at == null ? [contentText(r.content)] : [];
    }).filter(Boolean).join('\n');
    else {
      if (record(m.content).type === 'message_error') return null;
      text = contentText(m.content) || string(m.preview) || '';
    }
    if (!text) return null;
  }
  return {id,role,text,createdAt:string(m.created_at) ?? '',...(string(m.request_id) ? {requestId:m.request_id as string} : {}),...(deleted ? {deleted:true} : {})};
}

export class DotsAdapter {
  private readonly ledger = new Map<string, {dotId:string;text:string;result:Promise<{message:DotMessage}>}>();
  private readonly maxRequests: number;
  private lastDiscovery:RecordValue|null=null;
  private lastMessageMapping:RecordValue|null=null;
  diagnostics(){return {lastDiscovery:this.lastDiscovery,lastMessageMapping:this.lastMessageMapping};}
  constructor(private readonly transport: DesktopHttpTransport, options: {maxRequests?:number} = {}) {
    this.maxRequests = options.maxRequests ?? 1000;
    if (!Number.isInteger(this.maxRequests) || this.maxRequests < 1) throw new Error('maxRequests 必须为正整数');
  }
  async status() {
    const status = await this.transport.status();
    return {...status,mode:'polling' as const,capabilities:{messages:status.available,history:status.available,attachments:false as const,approvals:false as const}};
  }
  private async read(path: string, requireItems=true): Promise<RecordValue> {
    let response;
    try { response = await this.transport.request({method:'GET',path}); }
    catch (error) { if(error instanceof DotsError&&error.code==='DOTS_ACCOUNT_CHANGED')throw error;throw new DotsError('DOTS_READ_FAILED', '读取 Dots 失败，请检查桌面连接'); }
    if (response.status < 200 || response.status >= 300) throw new DotsError('DOTS_READ_FAILED', `读取 Dots 失败（${response.status}）`, response.status >= 400 && response.status < 500 ? response.status : 502);
    const data = record(response.body);
    if (requireItems && !Array.isArray(data.items)) throw new DotsError('DOTS_INVALID_RESPONSE', '桌面返回了无法识别的数据');
    return data;
  }
  async list(after?: string) {
    const params = new URLSearchParams({limit:'25',include_room_preview:'false'});
    const page = cursor(after); if (page) params.set('cursor',page);
    const data = await this.read(`/tbo?${params}`);
    const items=data.items as unknown[];
    const dots=items.map(item=>profile(item)).filter((p):p is DotProfile => p!==null);
    const diagnostic:RecordValue={at:new Date().toISOString(),received:items.length,invalidIds:items.filter(item=>upstreamId(record(item).id)===null).length,kindCounts:items.reduce<Record<string,number>>((counts,item)=>{const value=record(item).aeon_kind;const key=value==null?'missing':typeof value==='string'&&/^[a-z][a-z0-9_-]{0,39}$/.test(value)?value:'other';counts[key]=(Object.hasOwn(counts,key)?counts[key]:0)+1;return counts;},{}),itemFields:[...new Set(items.flatMap(item=>Object.keys(record(item))))].filter(key=>/^[a-zA-Z0-9_]{1,40}$/.test(key)).slice(0,40),legacyWithRoom:items.filter(item=>record(item).aeon_kind==null&&typeof record(item).messaging_room_id==='string').length,acceptedFromList:dots.length,primary:'not-requested',returned:dots.length};
    this.lastDiscovery=diagnostic;
    if(!page){
      try{
        const primary=await this.read('/tbo/primary',false),selection=record(primary.selection);
        diagnostic.primary=selection.available===true?'available':'unavailable';
        if(selection.available===true){
          const raw=record(primary.profile);
          const candidate=profile({...raw,id:raw.id??selection.tbo_id??selection.aeon_id,messaging_room_id:raw.messaging_room_id??selection.messaging_room_id,name:raw.name??'Dot'},true);
          if(candidate){
            const index=dots.findIndex(dot=>dot.id===candidate.id);
            if(index>=0){const existing=dots[index];dots[index]={...existing,...candidate,roomId:candidate.roomId??existing.roomId,name:string(raw.display_name)||string(raw.name)||existing.name,...candidate.threadId?{threadId:candidate.threadId}:existing.threadId?{threadId:existing.threadId}:{}};}
            else dots.unshift(candidate);
          }
          else diagnostic.primary='unrecognized-profile';
        }
      }catch(error){
        diagnostic.primary='failed';diagnostic.errorCode=error instanceof DotsError?error.code:'DOTS_READ_FAILED';
        if(!(error instanceof DotsError&&[404,405,501].includes(error.status)))throw error;
        diagnostic.primary='unsupported';
      }
    }
    diagnostic.returned=dots.length;diagnostic.withRoom=dots.filter(dot=>dot.roomId!==null).length;
    return {dots,nextCursor:cursor(data.cursor) ?? null};
  }
  private async room(dotId: string): Promise<string> {
    identifier(dotId,'Dot ID');
    let next: string | undefined;
    const visited = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const data = await this.list(next);
      const dot = data.dots.find(p=>p.id===dotId);
      if (dot) {
        if (!dot.roomId) throw new DotsError('DOTS_ROOM_UNINITIALIZED', '此 Dot 的消息房间尚未初始化，请先在桌面打开对话', 409);
        return identifier(dot.roomId,'消息房间 ID');
      }
      if (!data.nextCursor) throw new DotsError('DOTS_NOT_FOUND', '未找到此 Dot',404);
      if (visited.has(data.nextCursor)) break;
      visited.add(data.nextCursor); next=data.nextCursor;
    }
    throw new DotsError('DOTS_PAGINATION_FAILED', 'Dot 列表分页异常，无法确认消息房间');
  }
  async messages(dotId: string, before?: string) {
    const page = cursor(before), roomId = await this.room(dotId);
    const params = new URLSearchParams({limit:'20'}); if (page) params.set('before',page);
    const room = await this.read(`/messaging/rooms/${encodeURIComponent(roomId)}`, false);
    const members = roomMembers(room);
    const dots = [...members.values()].filter(member=>upstreamId(member.aeon_id)!==null);
    const dotName = string((dots.find(member=>upstreamId(member.aeon_id)===dotId) ?? dots[0])?.name)?.trim();
    const data = await this.read(`/messaging/rooms/${encodeURIComponent(roomId)}/messages?${params}`);
    const items = data.items as unknown[];
    const messages=items.map(item=>message(item,members)).filter((m):m is DotMessage=>m!==null);
    this.lastMessageMapping={at:new Date().toISOString(),received:items.length,members:members.size,dotMembers:dots.length,roles:{user:messages.filter(m=>m.role==='user').length,assistant:messages.filter(m=>m.role==='assistant').length,system:messages.filter(m=>m.role==='system').length}};
    return {roomId,...(dotName ? {dotName} : {}),messages,before:cursor(data.prev_cursor) ?? (data.prev_cursor === null ? null : upstreamId(record(items[0]).id))};
  }
  async send(input: {dotId:string;text:string;requestId:string}): Promise<{message:DotMessage}> {
    const dotId = identifier(input?.dotId,'Dot ID'), requestId = identifier(input?.requestId,'请求 ID');
    const text = input.text;
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text,'utf8') > 60000) throw new DotsError('DOTS_INVALID_INPUT', '消息不能为空且不能超过 60000 字节',400);
    const existing = this.ledger.get(requestId);
    if (existing) {
      if (existing.dotId !== dotId || existing.text !== text) throw new DotsError('DOTS_REQUEST_CONFLICT', '同一请求 ID 不能用于不同消息',409);
      return existing.result;
    }
    if (this.ledger.size >= this.maxRequests) throw new DotsError('DOTS_LEDGER_FULL', '发送记录已满，请先核对已有投递状态；本次未发送',503);
    const result = this.submit(dotId,text,requestId);
    this.ledger.set(requestId,{dotId,text,result});
    return result;
  }
  private async submit(dotId:string,text:string,requestId:string): Promise<{message:DotMessage}> {
    const roomId = await this.room(dotId);
    let response;
    try { response = await this.transport.request({method:'POST',path:`/messaging/rooms/${encodeURIComponent(roomId)}/messages`,body:{content:{text},request_id:requestId,idempotency_token:requestId}}); }
    catch (error) {
      // 只有传输明确保证尚未派发的错误可视为安全失败。
      if(error instanceof DotsError && error.code==='DOTS_ACCOUNT_CHANGED')throw error;
      if (error instanceof DotsError && error.code === 'DOTS_UNAVAILABLE') throw new DotsError('DOTS_UNAVAILABLE','桌面服务不可用，本次未发送',503);
      throw new DotsError('DOTS_WRITE_UNKNOWN','消息投递结果未知，请刷新对话核对，不要重复发送');
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 408) throw new DotsError('DOTS_WRITE_REJECTED', `消息被拒绝（${response.status}），本次未发送`,response.status);
    if (response.status < 200 || response.status >= 300) throw new DotsError('DOTS_WRITE_UNKNOWN','消息投递结果未知，请刷新对话核对，不要重复发送');
    const sent = message(response.body, undefined, true);
    if (!sent || (sent.requestId !== undefined && sent.requestId !== requestId)) throw new DotsError('DOTS_WRITE_UNKNOWN','消息已提交但无法确认回执，请刷新对话核对，不要重复发送');
    return {message:sent};
  }
  async close() { await this.transport.close(); }
}
