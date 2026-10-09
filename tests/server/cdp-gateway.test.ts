// @vitest-environment node
import {it,expect} from 'vitest';
import WebSocket from 'ws';
import { createBridgeGateway } from '../../server/cdp/gateway.js';
import type { DesktopAdapter } from '../../server/cdp/protocol.js';
it('真实网关拒绝无口令、复用手机 initialize 与列表且关闭不退出桌面',async()=>{
 let closed=0;
 const adapter:DesktopAdapter={snapshot:async()=>({threadId:'codex:t',title:'测试',mode:'codex',busy:false,draft:'',messages:[],approvals:[],threads:[]}),open:async()=>{},send:async()=>{},stop:async()=>{},approve:async()=>{},close:async()=>{closed++}};
 const gateway=await createBridgeGateway({port:0,host:'127.0.0.1',token:'test-secret-long-token',staticDir:null,adapter});
 try {
  expect((await fetch(`http://127.0.0.1:${gateway.port}/api/host`)).status).toBe(401);
  const info=await(await fetch(`http://127.0.0.1:${gateway.port}/api/host?token=test-secret-long-token`)).json();
  expect(info.backend).toBe('desktop-cdp');
  const ws=new WebSocket(`ws://127.0.0.1:${gateway.port}/ws?token=test-secret-long-token`);
  await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  const response=new Promise<any>(resolve=>ws.on('message',data=>{const msg=JSON.parse(String(data));if(msg.id===1)resolve(msg)}));
  ws.send(JSON.stringify({id:1,method:'initialize',params:{}}));expect((await response).result.backend).toBe('desktop-cdp');
  ws.close();
  expect((await fetch(`http://127.0.0.1:${gateway.port}/api/uploads/file?token=test-secret-long-token`,{method:'POST'})).status).toBe(501);
 }finally{await gateway.close();}
 expect(closed).toBe(1);
});

it('原前端跨设备携带显式口令可访问',async()=>{
 const adapter:DesktopAdapter={snapshot:async()=>({threadId:'codex:t',title:'测试',mode:'codex',busy:false,draft:'',messages:[],approvals:[],threads:[]}),open:async()=>{},send:async()=>{},stop:async()=>{},approve:async()=>{},close:async()=>{}};
 const gateway=await createBridgeGateway({port:0,host:'127.0.0.1',token:'test-secret-long-token',staticDir:null,adapter});
 try {
  const r=await fetch(`http://127.0.0.1:${gateway.port}/api/host?token=test-secret-long-token`,{headers:{Origin:'http://phone-ui.local'}});
  expect(r.headers.get('access-control-allow-origin')).toBe('http://phone-ui.local');
 }finally{await gateway.close();}
});
