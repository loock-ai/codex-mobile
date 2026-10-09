import {randomUUID} from 'node:crypto';
export interface ControlTransport {
 readHosts?():Promise<DesktopHost[]>;
 connect():Promise<void>;send(message:unknown):Promise<void>;subscribe(listener:(message:any)=>void):()=>void;close():Promise<void>;
}
export class DesktopControlChannel {
 readonly sessionId=randomUUID();
 private sequence=0;private connected=false;private disposed=false;private attemptedConnection=false;private lost=false;private unsubscribe?:()=>void;
 private listeners=new Set<(event:ControlEvent)=>void>();
 private pending=new Map<string,{hostId:string;method:string;write:boolean;resolve:(value:any)=>void;reject:(error:unknown)=>void;timer:ReturnType<typeof setTimeout>}>();
 private approvals=new Map<string,{hostId:string;request:any;submitted:boolean}>();
 private approvalAttempts=new Map<string,{reject:(error:unknown)=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private transport:ControlTransport){}
 async hosts(){if(!this.connected)throw new ControlError('CHANNEL_LOST','桌面通道未连接');return this.transport.readHosts?this.transport.readHosts():[{hostId:'local',displayName:'本机'}];}
 async connect(){if(this.disposed)throw new Error('通道已关闭');if(this.connected)return;if(this.attemptedConnection)throw new ControlError('CHANNEL_LOST','请关闭旧通道并创建新实例，以恢复快照和订阅');this.attemptedConnection=true;this.unsubscribe=this.transport.subscribe(m=>this.receive(m));try{await this.transport.connect();if(this.lost)throw new ControlError('CHANNEL_LOST','连接期间通道已失效');this.connected=true;}catch(e){this.unsubscribe();await this.transport.close();throw e;}}
 subscribe(listener:(event:ControlEvent)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 status(){return {connected:this.connected,channelSessionId:this.sessionId,sequence:this.sequence,capabilities:{structured:true,approvalSnapshot:false,chunkedMessages:true,dots:false}};}
 private emit(event:Omit<ControlEvent,'sequence'|'channelSessionId'>){const value={...event,sequence:++this.sequence,channelSessionId:this.sessionId};for(const listener of this.listeners){try{listener(value);}catch{/* 消费者错误不影响其他消费者 */}}}
 private receive(message:any){
  if(message?.type==='control-lost'){this.lose(message.reason??'桌面连接中断');return;}
  if(typeof message?.hostId!=='string')return;
  if(message.type==='mcp-response'){
   const reply=message.message,p=reply&&this.pending.get(String(reply.id));if(!p||p.hostId!==message.hostId)return;
   clearTimeout(p.timer);this.pending.delete(String(reply.id));
   if(reply.error){const large=reply.error.code==='RESPONSE_TOO_LARGE';p.reject(new ControlError(large?(p.write?'ACTION_WRITE_UNKNOWN':'RESPONSE_TOO_LARGE'):'UPSTREAM_ERROR',large&&p.write?'写入已提交但响应过大，请核对会话，不要重复发送':reply.error.message??'桌面请求失败',reply.error));}
   else p.resolve(['thread/turns/list','thread/items/list'].includes(p.method)&&reply.result&&typeof reply.result==='object'?{...reply.result,__desktopSnapshotSequence:this.sequence}:reply.result);return;
  }
  if(message.type==='mcp-notification'&&typeof message.method==='string'){
   if(message.method==='serverRequest/resolved')for(const [id,a]of this.approvals)if(a.hostId===message.hostId&&a.request.id===message.params?.requestId){this.approvals.delete(id);this.emit({hostId:a.hostId,method:'desktop/approval/resolved',params:{id,threadId:a.request.params?.threadId}});}
   this.emit({hostId:message.hostId,method:message.method,params:message.params});return;
  }
  if(message.type==='mcp-request'&&typeof message.request?.method==='string'&&approvalMethods.has(message.request.method)&&['string','number'].includes(typeof message.request.id)){
   const key=JSON.stringify([message.hostId,message.request.id]);if([...this.approvals.values()].some(a=>JSON.stringify([a.hostId,a.request.id])===key))return;
   const id=`control-approval:${randomUUID()}`;this.approvals.set(id,{hostId:message.hostId,request:message.request,submitted:false});this.emit({id,hostId:message.hostId,method:message.request.method,params:message.request.params});
  }
 }
 async request(hostId:string,method:string,params:unknown={},timeoutMs=15000):Promise<any>{
  if(!this.connected)throw new ControlError('CHANNEL_LOST','桌面通道未连接');
  if(!hostId||typeof hostId!=='string'||!methods.has(method))throw new ControlError('UNSUPPORTED_METHOD',`不支持 ${method}`);
  if(!params||typeof params!=='object'||Array.isArray(params))throw new ControlError('INVALID_PARAMS','params 必须是对象');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new ControlError('INVALID_PARAMS','超时必须为 1–120000 毫秒');
  const id=`mobile-control:${this.sessionId}:${randomUUID()}`,write=writeMethods.has(method);
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{if(!this.pending.delete(id))return;reject(new ControlError(write?'ACTION_WRITE_UNKNOWN':'REQUEST_TIMEOUT',write?'已提交但未确认，不会重发':'读取请求超时'));},timeoutMs);
   this.pending.set(id,{hostId,method,write,resolve,reject,timer});
   void this.transport.send({type:'mcp-request',hostId,request:{id,method,params}}).catch(error=>{const p=this.pending.get(id);if(!p)return;clearTimeout(timer);this.pending.delete(id);reject(new ControlError(write?'ACTION_WRITE_UNKNOWN':'CHANNEL_LOST',String(error)));});
  });
 }
 pendingApprovals():ControlEvent[]{return [...this.approvals].filter(([,a])=>!a.submitted).map(([id,a])=>({id,hostId:a.hostId,method:a.request.method,params:a.request.params,channelSessionId:this.sessionId,sequence:this.sequence}));}
 async respond(id:string|number,result:unknown,timeoutMs=15000){
  const a=this.approvals.get(String(id));if(!this.connected||!a||a.submitted)throw new ControlError('APPROVAL_EXPIRED','审批已失效或已提交');
  if(!result||typeof result!=='object'||Array.isArray(result))throw new ControlError('INVALID_PARAMS','审批回答必须是对象');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new ControlError('INVALID_PARAMS','无效审批超时');
  a.submitted=true;
  const key=String(id);
  return new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{this.approvalAttempts.delete(key);reject(new ControlError('ACTION_WRITE_UNKNOWN','审批提交超时，不会重发'));},timeoutMs);
   this.approvalAttempts.set(key,{reject,timer});
   void this.transport.send({type:'mcp-response',hostId:a.hostId,...typeof a.request.params?.threadId==='string'?{threadId:a.request.params.threadId}:{},response:{id:a.request.id,result}}).then(()=>{if(!this.approvalAttempts.delete(key))return;clearTimeout(timer);resolve();},error=>{if(!this.approvalAttempts.delete(key))return;clearTimeout(timer);reject(new ControlError('ACTION_WRITE_UNKNOWN',`审批提交结果未知，不会重发：${String(error)}`));});
  });
 }
 private lose(reason:string){this.connected=false;this.lost=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new ControlError(p.write?'ACTION_WRITE_UNKNOWN':'CHANNEL_LOST',reason));}for(const attempt of this.approvalAttempts.values()){clearTimeout(attempt.timer);attempt.reject(new ControlError('ACTION_WRITE_UNKNOWN',reason));}this.approvalAttempts.clear();this.pending.clear();this.approvals.clear();this.emit({method:'desktop/disconnected',params:{reason}});}
 async close(){if(this.disposed)return;this.disposed=true;this.lose('通道已关闭');this.unsubscribe?.();await this.transport.close();this.listeners.clear();}
}
export interface ControlEvent {id?:string|number;hostId?:string;method:string;params:any;channelSessionId:string;sequence:number}
export class ControlError extends Error {constructor(public code:string,message:string,public details?:unknown){super(message);}}
export const methods=new Set(['model/list','permissionProfile/list','fs/readFile','fs/createDirectory','fs/writeFile','project/list','project/read','thread/list','thread/read','thread/search','thread/turns/list','thread/items/list','thread/start','thread/resume','turn/start','turn/interrupt']);
export interface DesktopHost {hostId:string;displayName:string}
const writeMethods=new Set(['thread/start','thread/resume','turn/start','turn/interrupt','fs/createDirectory','fs/writeFile']);
const approvalMethods=new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput','item/tool/requestOptionPicker','mcpServer/elicitation/request']);
