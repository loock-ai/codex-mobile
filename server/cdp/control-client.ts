import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {ControlError,type ControlEvent} from './control-channel.js';

/** Node 程序调用接口；断线和超时从不自动重发。 */
export class DesktopControlClient {
 private socket:WebSocket|null=null;private pending=new Map<string,{resolve:(result:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;write:boolean}>();
 private listeners=new Set<(event:ControlEvent)=>void>();
 constructor(private url:string){}
 async connect(hostId='local'){
  if(this.socket)throw new Error('客户端已创建连接');const socket=new WebSocket(this.url);this.socket=socket;
  socket.on('message',raw=>{if(this.socket!==socket)return;let message:any;try{message=JSON.parse(String(raw));}catch{return;}if(message.method){for(const listener of this.listeners){try{listener(message);}catch{}}return;}const pending=this.pending.get(String(message.id));if(!pending)return;clearTimeout(pending.timer);this.pending.delete(String(message.id));message.error?pending.reject(new ControlError(message.error.data?.code??'REMOTE_ERROR',message.error.message)):pending.resolve(message.result);});
  socket.on('close',()=>{if(this.socket===socket)this.rejectPending('连接已断开');});socket.on('error',()=>{});
  await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});return this.request('initialize',{hostId});
 }
 subscribe(listener:(event:ControlEvent)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 async request(method:string,params:unknown={},timeoutMs=20000):Promise<any>{
  if(this.socket?.readyState!==WebSocket.OPEN)throw new ControlError('CHANNEL_LOST','客户端未连接');
  const id=randomUUID(),write=['thread/start','thread/resume','turn/start','turn/interrupt','desktop/approval/respond'].includes(method);
  const socket=this.socket;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new ControlError(write?'ACTION_WRITE_UNKNOWN':'REQUEST_TIMEOUT','请求超时，不会自动重发'));},timeoutMs);this.pending.set(id,{resolve,reject,timer,write});socket.send(JSON.stringify({id,method,params}),error=>{if(error&&this.socket===socket)this.rejectPending(error.message);});});
 }
 private rejectPending(reason:string){for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new ControlError(pending.write?'ACTION_WRITE_UNKNOWN':'CHANNEL_LOST',reason));}this.pending.clear();}
 close(){this.rejectPending('客户端关闭');const socket=this.socket;this.socket=null;socket?.close();this.listeners.clear();}
}
