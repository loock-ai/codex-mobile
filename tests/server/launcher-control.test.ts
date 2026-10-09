// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LauncherController} from '../../server/launcher/controller.js';
import {defaultConfig,saveConfig} from '../../server/launcher/config.js';
import {DesktopControlClient} from '../../server/cdp/control-client.js';

// 仅替换桌面传输；启动器、结构化通道、HTTP 和 WebSocket 网关均使用真实代码。
const fixture=vi.hoisted(()=>({listener:(_message:any)=>{},endpoint:'',closed:false}));
vi.mock('node:os',async importOriginal=>({...await importOriginal<typeof import('node:os')>(),networkInterfaces:()=>({})}));
vi.mock('../../server/cdp/control-transport.js',()=>({CdpControlTransport:class {
 constructor(endpoint:string){fixture.endpoint=endpoint;}
 async connect(){}async close(){fixture.closed=true;}
 subscribe(listener:(message:any)=>void){fixture.listener=listener;return()=>{fixture.listener=()=>{}};}
 async send(message:any){fixture.listener({type:'mcp-response',hostId:message.hostId,message:{id:message.request.id,result:{data:[{id:'project-1',roots:[{path:'/fixture'}]}],nextCursor:null}}});}
}}));
vi.mock('../../server/cdp/adapter.js',()=>({CdpDesktopAdapter:class {async connect(){throw new Error('旧 DOM 桥接不支持结构化通道');}async close(){}}}));

it('CDP 启动器提供现有 Web 和 desktop-control API，并同步连接及审批状态',async()=>{
 const root=await mkdtemp(join(tmpdir(),'launcher-control-gateway-'));
 const debug=createServer((_req,res)=>res.end(JSON.stringify({webSocketDebuggerUrl:'ws://fixture'})));
 const portServer=createServer();
 await new Promise<void>(r=>debug.listen(0,'127.0.0.1',r));
 await new Promise<void>(r=>portServer.listen(0,'127.0.0.1',r));
 const cdpPort=(debug.address() as any).port,gatewayPort=(portServer.address() as any).port;
 await new Promise<void>(r=>portServer.close(()=>r()));
 const config={...defaultConfig(),host:'127.0.0.1' as const,cdpPort,gatewayPort};
 await mkdir(join(root,'dist'));await writeFile(join(root,'dist/index.html'),'<main>existing-web-fixture</main>');
 await saveConfig(join(root,'config.json'),config);
 const controller=new LauncherController(join(root,'config.json'),root);
 let client:DesktopControlClient|undefined;
 try{
  await controller.initialize();expect(controller.status().running).toBe(false);
  const status=await controller.start();expect(status.running).toBe(true);
  expect(fixture.endpoint).toBe(`http://127.0.0.1:${cdpPort}`);
  const url=new URL(status.accessUrl!);expect(await(await fetch(url)).text()).toContain('existing-web-fixture');
  url.pathname='/api/host';expect(await(await fetch(url)).json()).toMatchObject({backend:'desktop-control',appServerReady:true});
  url.pathname='/api/projects';expect(await(await fetch(url)).json()).toEqual({projects:['/fixture']});
  url.protocol='ws:';url.pathname='/ws';client=new DesktopControlClient(url.href);await client.connect();
  expect(controller.status().clients).toBe(1);
  fixture.listener({type:'mcp-request',hostId:'local',request:{id:1,method:'item/tool/requestUserInput',params:{threadId:'t',questions:[]}}});
  expect(controller.status().approvals).toBe(1);
  expect(await controller.desktopStatus()).toMatchObject({connected:true,approvals:[{method:'item/tool/requestUserInput',params:{threadId:'t'}}]});
  await expect(controller.approve('approval-id','accept')).rejects.toThrow('Web');
  fixture.listener({type:'control-lost',reason:'受控连接中断'});expect(controller.status()).toMatchObject({approvals:0,error:'受控连接中断'});
 }finally{
  client?.close();await controller.stop();await new Promise<void>(r=>debug.close(()=>r()));await rm(root,{recursive:true,force:true});
 }
 expect(fixture.closed).toBe(true);expect(controller.status()).toMatchObject({running:false,clients:0,approvals:0});
});

it('没有局域网地址时仍提供本机 Web 地址',async()=>{
 const root=await mkdtemp(join(tmpdir(),'launcher-offline-web-'));
 const controller=new LauncherController(join(root,'config.json'),root,{start:async()=>({port:19901,close:async()=>{}})});
 try{
  await controller.initialize();const status=await controller.start();
  expect(status.accessUrl).not.toBeNull();
  const url=new URL(status.accessUrl!);expect(url.origin).toBe('http://127.0.0.1:19901');expect(url.searchParams.get('token')).toBe(status.config.token);
 }finally{await controller.stop();await rm(root,{recursive:true,force:true});}
});
