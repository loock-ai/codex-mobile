import {createServer} from 'node:http';
import WebSocket,{WebSocketServer} from 'ws';
import {assertGatewaySecurity} from '../app-server-manager.js';
import {ControlError,type DesktopControlChannel,type ControlEvent} from './control-channel.js';
import {controlHttp} from './control-http.js';

export interface ControlGatewayStatus {clients:number;approvals:number;connected:boolean;error:string}
export async function createControlGateway(options:{channel:DesktopControlChannel;host:string;port:number;token:string;staticDir?:string;onStatus?:(status:ControlGatewayStatus)=>void}){
 assertGatewaySecurity(options.host,options.token);if(!options.token)throw new Error('控制通道必须配置访问口令');
 await options.channel.connect();
 const clients=new Map<WebSocket,{initialized:boolean;active:boolean;hostId:string;threads:Set<string>|null;delivered:Set<string|number>}>();
 let error='';
 const statusChanged=()=>options.onStatus?.({clients:clients.size,approvals:options.channel.pendingApprovals().length,connected:options.channel.status().connected,error});
 const send=(socket:WebSocket,message:unknown)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));};
 const authorized=(url:URL)=>url.searchParams.get('token')===options.token;
 const server=createServer(controlHttp(options));
 const wss=new WebSocketServer({noServer:true,maxPayload:256*1024});
 server.on('upgrade',(req,socket,head)=>{const url=new URL(req.url??'/','http://localhost');if(url.pathname!=='/ws'||!authorized(url)){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}wss.handleUpgrade(req,socket,head,socket=>wss.emit('connection',socket));});
 const matches=(state:{active:boolean;hostId:string;threads:Set<string>|null},event:ControlEvent)=>{if(event.method==='desktop/disconnected')return true;const threadId=event.params?.threadId??event.params?.thread?.id;if(event.id!==undefined&&!threadId&&state.threads!==null)return false;return state.active&&(!event.hostId||event.hostId===state.hostId)&&(!threadId||state.threads===null||state.threads.has(threadId));};
 const unsubscribe=options.channel.subscribe(event=>{if(event.method==='desktop/disconnected')error=event.params?.reason??'桌面连接中断';statusChanged();for(const [socket,state]of clients){if(!state.initialized||!matches(state,event))continue;if(event.id!==undefined)state.delivered.add(event.id);if(event.method==='desktop/approval/resolved')state.delivered.delete(event.params.id);send(socket,event);}});
 wss.on('connection',socket=>{
  const state={initialized:false,active:false,hostId:'local',threads:new Set<string>() as Set<string>|null,delivered:new Set<string|number>()};clients.set(socket,state);statusChanged();
  socket.on('close',()=>{clients.delete(socket);statusChanged();});socket.on('error',()=>{});
  socket.on('message',async raw=>{
   let message:any;try{message=JSON.parse(String(raw));}catch{send(socket,{error:{code:-32700,message:'无效 JSON'}});return;}
   if(!message||typeof message!=='object'||Array.isArray(message)){send(socket,{error:{code:-32600,message:'无效请求'}});return;}
   const reply=(result:unknown)=>send(socket,{id:message.id,result});
   try{
    if(message.method==='initialized')return;
    if(!state.initialized&&message.method!=='initialize')throw new ControlError('NOT_INITIALIZED','请先 initialize');
    if(!['string','number'].includes(typeof message.id))throw new ControlError('INVALID_PARAMS','必须提供请求 id');
    const p=message.params??{};if(typeof p!=='object'||Array.isArray(p))throw new ControlError('INVALID_PARAMS','params 必须是对象');
    if(message.method==='initialize'){
     if(state.initialized)throw new ControlError('ALREADY_INITIALIZED','连接已初始化');
     if(p.hostId!==undefined&&(typeof p.hostId!=='string'||!p.hostId))throw new ControlError('INVALID_PARAMS','hostId 必须是非空字符串');
     if(p.hostId&&p.hostId!=='local'&&!(await options.channel.hosts()).some(host=>host.hostId===p.hostId))throw new ControlError('HOST_UNAVAILABLE','桌面没有该远程主机');
     state.hostId=p.hostId??'local';state.initialized=true;reply({userAgent:'codex-mobile-desktop-control',backend:'desktop-control',...options.channel.status()});return;
    }
    if(message.method==='desktop/status'){reply(options.channel.status());return;}
    if(message.method==='desktop/subscribe'){
     if(p.threadIds!==null&&(!Array.isArray(p.threadIds)||p.threadIds.some((id:unknown)=>typeof id!=='string')))throw new ControlError('INVALID_PARAMS','threadIds 必须是字符串数组，或 null 表示全部');
     state.active=true;state.delivered.clear();state.threads=p.threadIds===null?null:new Set(p.threadIds);reply({subscribed:true});for(const event of options.channel.pendingApprovals())if(matches(state,event)){state.delivered.add(event.id!);send(socket,event);}return;
    }
    if(message.method==='desktop/unsubscribe'){state.active=false;state.threads=new Set();state.delivered.clear();reply({});return;}
    if(message.method==='desktop/approval/respond'||!message.method){
     const id=message.method?p.approvalId:message.id,result=message.method?p.result:message.result;
     if(!state.delivered.has(id))throw new ControlError('APPROVAL_EXPIRED','当前客户端没有该审批');
     try{await options.channel.respond(id,result);}finally{statusChanged();}state.delivered.delete(id);if(message.method)reply({submitted:true,confirmed:false});else send(socket,{method:'desktop/approval/submitted',params:{id}});return;
    }
    const result=await options.channel.request(state.hostId,message.method,p);
    reply(result);
   }catch(error){send(socket,{id:message.id,error:{code:-32000,message:error instanceof Error?error.message:String(error),data:{code:error instanceof ControlError?error.code:'INTERNAL_ERROR'}}});}
  });
 });
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port,options.host,()=>{server.off('error',reject);resolve();});});}catch(e){unsubscribe();await options.channel.close();throw e;}
 let closed=false;
 statusChanged();
 return {port:(server.address() as {port:number}).port,channel:options.channel,async close(){if(closed)return;closed=true;unsubscribe();for(const socket of clients.keys())socket.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));await options.channel.close();statusChanged();}};
}
