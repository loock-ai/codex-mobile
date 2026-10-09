import { createHash, randomUUID } from 'node:crypto';
export interface DesktopMessage { id: string; role: 'user'|'assistant'; text: string }
export interface DesktopApproval { id:string; text:string; options:{id:string;label:string;decision?:'accept'|'decline'}[] }
export interface DesktopThread {id:string;title:string;mode:'codex'|'dots'}
export interface DesktopSnapshot {threadId:string;title:string;mode:'codex'|'dots';busy:boolean;draft:string;messages:DesktopMessage[];approvals:DesktopApproval[];threads:DesktopThread[]}
export interface DesktopAdapter {
 snapshot():Promise<DesktopSnapshot>;open(id:string):Promise<void>;send(id:string,text:string):Promise<void>;stop(id:string):Promise<void>;approve(id:string,choice:string):Promise<void>;close():Promise<void>;
}
export type BridgeMessage={id?:string|number;method?:string;params?:any;result?:any;error?:{code:number;message:string}};
export class DesktopProtocol {
 private previous:DesktopSnapshot|null=null;
 private pending=new Map<string,{threadId:string;approval:DesktopApproval}>();
 private turnIds=new Map<string,string>();
 private attempted=new Set<string>();
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private adapter:DesktopAdapter,private emit:(message:BridgeMessage)=>void) {}
 private exclusive<T>(work:()=>Promise<T>):Promise<T> {const next=this.queue.then(work,work);this.queue=next.catch(()=>{});return next;}
 private turnId(threadId:string) {let id=this.turnIds.get(threadId);if(!id){id='desktop-'+randomUUID();this.turnIds.set(threadId,id);}return id;}
 private thread(s:DesktopSnapshot) {
  const turns:any[]=[];let turn:any=null;
  for(const m of s.messages) {
   if(m.role==='user'||!turn){turn={id:'history-'+m.id,status:'completed',items:[]};turns.push(turn);}
   turn.items.push(m.role==='user'?{id:m.id,type:'userMessage',content:[{type:'text',text:m.text}]}:{id:m.id,type:'agentMessage',text:m.text});
  }
  if(s.busy&&turn){turn.id=this.turnId(s.threadId);turn.status='inProgress';}
  return {id:s.threadId,name:s.title,preview:s.title,cwd:'',source:s.mode,createdAt:0,updatedAt:0,status:{type:s.busy?'active':'idle'},turns};
 }
 private async current(id?:string) {const s=await this.adapter.snapshot();if(id&&s.threadId!==id)throw new Error('桌面会话已切换，请重新打开目标会话');return s;}
 pendingApprovals():BridgeMessage[]{return [...this.pending].map(([id,p])=>({id,method:"item/commandExecution/requestApproval",params:{threadId:p.threadId,turnId:this.turnId(p.threadId),itemId:p.approval.id,reason:p.approval.text,desktopApproval:p.approval}}));}
 request(method:string,params:any={}):Promise<any> {return this.exclusive(async()=>{
  const p=params??{};
  switch(method){
   case 'initialize':return {userAgent:'codex-mobile-desktop-cdp',backend:'desktop-cdp',capabilities:{text:true,approvals:true,attachments:false,realtime:false,history:'visible'}};
   case 'model/list':return {data:[],nextCursor:null};
   case 'permissionProfile/list':return {data:[],nextCursor:null};
   case 'config/read':return {config:{}};
   case 'account/rateLimits/read':return {};
   case 'thread/unsubscribe':return {};
   case 'thread/list':{const s=await this.current();const rows=[...s.threads];if(!rows.some(t=>t.id===s.threadId))rows.unshift({id:s.threadId,title:s.title,mode:s.mode});return {data:rows.map(t=>({id:t.id,name:t.title,preview:t.title,cwd:'',source:t.mode,createdAt:0,updatedAt:0,status:{type:t.id===s.threadId&&s.busy?'active':'idle'}})),nextCursor:null};}
   case 'thread/start':{const s=await this.current();if(s.mode!=='dots')await this.adapter.open('codex:new');const fresh=await this.current();return {thread:this.thread(fresh),model:null};}
   case 'thread/resume':{await this.adapter.open(p.threadId);const s=await this.current(p.threadId);return {thread:this.thread(s),initialTurnsPage:{data:[...this.thread(s).turns].reverse(),nextCursor:null},model:null};}
   case 'thread/read':return {thread:this.thread(await this.current(p.threadId))};
   case 'thread/turns/list':return {data:[...this.thread(await this.current(p.threadId)).turns].reverse(),nextCursor:null};
   case 'turn/start':{
    const s=await this.current(p.threadId);
    if(s.draft.trim())throw new Error('桌面已有未发送草稿，请先处理');
    if(s.busy)throw new Error('桌面任务正在运行，请等待完成');
    if(!Array.isArray(p.input)||p.input.some((i:any)=>i.type!=='text'))throw new Error('CDP 首版仅支持文本消息');
    const text=p.input.map((i:any)=>i.text).join('\n');if(!text.trim())throw new Error('消息不能为空');
    this.previous=s;const id='desktop-'+randomUUID();this.turnIds.set(s.threadId,id);
    await this.adapter.send(s.threadId,text);
    const fresh=await this.current();if(fresh.threadId!==s.threadId){this.turnIds.set(fresh.threadId,id);this.emit({method:'desktop/thread/changed',params:{threadId:fresh.threadId,thread:this.thread(fresh)}});}
    const latest=this.thread(fresh).turns.at(-1);const turn={id,status:fresh.busy?'inProgress':'completed',items:latest?.items??[]};this.emit({method:'turn/started',params:{threadId:fresh.threadId,turn}});if(!fresh.busy)this.emit({method:'turn/completed',params:{threadId:fresh.threadId,turn}});this.previous=structuredClone(fresh);return {turn};
   }
   case 'turn/interrupt':await this.current(p.threadId);await this.adapter.stop(p.threadId);return {};
   case 'desktop/status':return this.current();
   default:throw new Error(`CDP 桌面桥接不支持 ${method}，请在桌面操作`);
  }
 });}
 respond(id:string|number,result:any):Promise<void>{return this.exclusive(async()=>{
  const key=String(id),pending=this.pending.get(key);if(!pending)throw new Error('审批已失效或已经处理');
  const s=await this.current(pending.threadId);const a=s.approvals.find(a=>a.id===pending.approval.id);
  if(!a||JSON.stringify(a)!==JSON.stringify(pending.approval)) {this.pending.delete(key);this.emit({method:'desktop/approval/resolved',params:{id:key}});throw new Error('审批已失效，请刷新');}
  const choice=result?.desktopChoice??a.options.find(o=>o.decision===result?.decision)?.id;
  if(!choice||!a.options.some(o=>o.id===choice))throw new Error('请选择桌面提供的审批选项');
  this.pending.delete(key);this.attempted.add(key); // 一旦交给桌面，不允许自动重放。
  this.emit({method:'desktop/approval/resolved',params:{id:key}});
  await this.adapter.approve(a.id,choice);
  const fresh=await this.current(pending.threadId);
  if(fresh.approvals.some(x=>x.id===a.id))throw new Error('审批提交后尚未确认，请在桌面核对');
  this.emit({method:'desktop/approval/resolved',params:{id:key}});
 });}
 poll():Promise<void>{return this.exclusive(async()=>{
  const s=await this.current(),old=this.previous;
  if(old&&old.threadId!==s.threadId){this.emit({method:'desktop/thread/changed',params:{threadId:s.threadId,thread:this.thread(s)}});}
  const same=old?.threadId===s.threadId;
  const turnId=this.turnId(s.threadId);
  if(s.busy&&(!same||!old?.busy))this.emit({method:'turn/started',params:{threadId:s.threadId,turn:{id:turnId,status:'inProgress',items:[]}}});
  if(old&&same) {
   for(const m of s.messages){const prev=old.messages.find(x=>x.id===m.id);if(prev?.text===m.text)continue;
    const item=m.role==='user'?{id:m.id,type:'userMessage',content:[{type:'text',text:m.text}]}:{id:m.id,type:'agentMessage',text:m.text};
    if(m.role==='assistant'&&prev&&m.text.startsWith(prev.text))this.emit({method:'item/agentMessage/delta',params:{threadId:s.threadId,turnId,itemId:m.id,delta:m.text.slice(prev.text.length)}});
    else this.emit({method:'item/started',params:{threadId:s.threadId,turnId,item}});
   }
   if(old.busy&&!s.busy){const t=this.thread(s).turns.at(-1)??{items:[]};this.emit({method:'turn/completed',params:{threadId:s.threadId,turn:{...t,id:turnId,status:'completed'}}});this.turnIds.delete(s.threadId);}
  }
  for(const [id,pending] of this.pending) if(pending.threadId!==s.threadId||!s.approvals.some(a=>a.id===pending.approval.id)){this.pending.delete(id);this.emit({method:'desktop/approval/resolved',params:{id}});}
  for(const a of s.approvals){if([...this.pending.values()].some(p=>p.approval.id===a.id&&p.threadId===s.threadId))continue;
   const id='approval-'+createHash('sha256').update(s.threadId+':'+a.id).digest('hex').slice(0,20);if(this.attempted.has(id))continue;this.pending.set(id,{threadId:s.threadId,approval:a});
   this.emit({id,method:'item/commandExecution/requestApproval',params:{threadId:s.threadId,turnId,itemId:a.id,reason:a.text,desktopApproval:a}});
  }
  if(old&&JSON.stringify(old)!==JSON.stringify(s))this.emit({method:'desktop/thread/snapshot',params:{threadId:s.threadId,thread:this.thread(s)}});
  this.previous=structuredClone(s);
 });}
 async close(){await this.queue;await this.adapter.close();}
}
