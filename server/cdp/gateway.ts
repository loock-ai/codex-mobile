import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { hostname } from 'node:os';
import WebSocket,{WebSocketServer} from 'ws';
import { DesktopProtocol,type DesktopAdapter,type BridgeMessage } from './protocol.js';
import { assertGatewaySecurity } from '../app-server-manager.js';

export async function createBridgeGateway(options:{port:number;host:string;token:string;staticDir:string|null;adapter:DesktopAdapter;onStatus?:(status:{clients:number;error:string;approvals:number;thread:string})=>void}) {
 assertGatewaySecurity(options.host,options.token);if(!options.token)throw new Error('CDP 网关必须配置访问口令');
 const clients=new Set<WebSocket>();let lastError='',approvalCount=0,thread='';let closing=false;
 const send=(socket:WebSocket,message:BridgeMessage)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));};
 const report=()=>options.onStatus?.({clients:clients.size,error:lastError,approvals:approvalCount,thread});
 const protocol=new DesktopProtocol(options.adapter,message=>{for(const c of clients)send(c,message);});
 const authorized=(url:URL,cookie?:string)=>url.searchParams.get('token')===options.token||cookie?.split(';').some(c=>c.trim()==='codex_mobile_token='+encodeURIComponent(options.token));
 const server=createServer(async(req,res)=>{
  const u=new URL(req.url??'/','http://localhost');
  const api=u.pathname.startsWith('/api/');
  if(api&&u.searchParams.get('token')===options.token&&req.headers.origin){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','content-type');}
  if(req.method==='OPTIONS'){res.statusCode=authorized(u,req.headers.cookie)?204:401;res.end();return;}
  if(api&&!authorized(u,req.headers.cookie)){res.writeHead(401);res.end('Unauthorized');return;}
  if(u.searchParams.get('token')===options.token)res.setHeader('Set-Cookie',`codex_mobile_token=${encodeURIComponent(options.token)}; Path=/; HttpOnly; SameSite=Strict`);
  if(api){
   res.setHeader('content-type','application/json; charset=utf-8');
   if(u.pathname==='/api/host')res.end(JSON.stringify({hostId:hostname()+'-desktop',displayName:'ChatGPT 桌面',hostname:hostname(),gatewayVersion:'0.2.0',appServerReady:!lastError,backend:'desktop-cdp',capabilities:{text:true,approvals:true,attachments:false,realtime:false}}));
   else if(u.pathname==='/api/status')res.end(JSON.stringify({mode:'cdp',appServerReady:!lastError,clients:clients.size,approvals:approvalCount,thread,error:lastError}));
   else if(u.pathname==='/api/projects')res.end(JSON.stringify({projects:[]}));
   else{res.statusCode=501;res.end(JSON.stringify({error:'CDP 模式不支持此功能，请在桌面操作'}));}
   return;
  }
  if(!options.staticDir){res.writeHead(404);res.end();return;}
  try {
   const root=resolve(options.staticDir);let file=resolve(root,'.'+decodeURIComponent(u.pathname));
   if(file!==root&&!file.startsWith(root+sep))throw new Error('path');
   if(u.pathname==='/'||!(await stat(file).catch(()=>null))?.isFile())file=resolve(root,'index.html');
   const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
   res.setHeader('content-type',mime[extname(file)]??'application/octet-stream');res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
 });
 const wss=new WebSocketServer({noServer:true,maxPayload:256*1024});
 server.on('upgrade',(req,socket,head)=>{
  const u=new URL(req.url??'/','http://localhost');
  if(u.pathname!=='/ws'||!authorized(u,req.headers.cookie)){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
  if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host&&u.searchParams.get('token')!==options.token){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}}catch{socket.destroy();return;}}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
 });
 wss.on('connection',socket=>{
  clients.add(socket);report();let initialized=false;
  socket.on('close',()=>{clients.delete(socket);report();});socket.on('error',()=>{});
  socket.on('message',async data=>{
   let msg:BridgeMessage;try{msg=JSON.parse(String(data));}catch{send(socket,{error:{code:-32700,message:'无效 JSON'}});return;}
   if(!msg||typeof msg!=='object')return;
   try{
    if(msg.method){
     if(msg.method==='initialized')return;
     if(!initialized&&msg.method!=='initialize')throw new Error('请先初始化连接');
     if(msg.id===undefined)return;
     const result=await protocol.request(msg.method,msg.params);if(msg.method==='initialize')initialized=true;
     send(socket,{id:msg.id,result});if(msg.method==='initialize')for(const approval of protocol.pendingApprovals())send(socket,approval);
    }else if(msg.id!==undefined&&initialized){await protocol.respond(msg.id,msg.result);}
   }catch(error){const message=error instanceof Error?error.message:String(error);if(msg.method)send(socket,{id:msg.id,error:{code:-32000,message}});else send(socket,{method:'desktop/error',params:{message}});}
  });
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port,options.host,()=>{server.off('error',reject);resolve();});});
 let polling=false;let activePoll:Promise<void>=Promise.resolve();
 const poll=async()=>{if(polling||closing)return;polling=true;try{await protocol.poll();const s=await options.adapter.snapshot();lastError='';approvalCount=s.approvals.length;thread=s.title;}catch(error){lastError=error instanceof Error?error.message:String(error);}finally{polling=false;report();}};
 const tick=()=>{if(!polling&&!closing)activePoll=poll();};const timer=setInterval(tick,350);timer.unref();tick();
 return {port:(server.address() as {port:number}).port,protocol,async close(){closing=true;clearInterval(timer);await activePoll;for(const c of clients)c.terminate();await new Promise<void>(r=>wss.close(()=>r()));await new Promise<void>(r=>server.close(()=>r()));await protocol.close();}};
}
