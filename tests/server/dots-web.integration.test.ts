// @vitest-environment node
import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {dotsRequestScript,dotsStatusScript} from '../../server/dots/desktop-script.js';
import {CdpDesktopHttpTransport,DOTS_DESKTOP_CONTRACT} from '../../server/dots/desktop-transport.js';
import {DotsAdapter} from '../../server/dots/adapter.js';
import {DesktopControlChannel,type ControlTransport} from '../../server/cdp/control-channel.js';
import {createControlGateway} from '../../server/cdp/control-gateway.js';

class CodexFixture implements ControlTransport {
 listener:(message:unknown)=>void=()=>{};
 async connect(){}async close(){}
 subscribe(listener:(message:unknown)=>void){this.listener=listener;return()=>{};}
 async send(m:any){this.listener({type:'mcp-response',hostId:m.hostId,message:{id:m.request.id,result:{data:[],nextCursor:null}}});}
}
it.skipIf(process.env.RUN_CDP_FIXTURE!=='1')('手机独立Dots入口经现有宿主HTTP服务获取历史、发送、刷新接收与返回Codex',async()=>{
 const profile=await mkdtemp(join(tmpdir(),'dots-mobile-fixture-'));
 const env:NodeJS.ProcessEnv={...process.env,CDP_FIXTURE_PORT:'19336',CDP_FIXTURE_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[resolve('tests/fixtures/dots-desktop.cjs')],{env,stdio:'ignore'});
 let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined,gateway:Awaited<ReturnType<typeof createControlGateway>>|undefined;
 const transport=new CdpDesktopHttpTransport('http://127.0.0.1:19336');
 try{
  for(let i=0;i<100;i++){
   try{browser=await chromium.connectOverCDP('http://127.0.0.1:19336',{timeout:1000});if(browser.contexts()[0].pages().some(p=>p.url()==='app://-/index.html')&&browser.contexts()[0].pages().some(p=>p.url()==='about:blank'))break;await browser.close();browser=undefined;}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  if(!browser)throw new Error('Dots fixture startup failed');
  expect(await transport.status()).toMatchObject({available:true,identityKey:expect.any(String)});
  await expect(transport.request({method:'POST',path:'/tbo'})).rejects.toMatchObject({code:'DOTS_INVALID_METHOD'});
  await expect(transport.request({method:'GET',path:'https://example.com/'})).rejects.toMatchObject({code:'DOTS_INVALID_PATH'});
  const adapter=new DotsAdapter(transport);
  gateway=await createControlGateway({channel:new DesktopControlChannel(new CodexFixture()),host:'127.0.0.1',port:0,token:'dots-fixture-token',staticDir:resolve('dist'),dots:adapter});
  const root=`http://127.0.0.1:${gateway.port}`;
  expect((await fetch(root+'/api/dots/list')).status).toBe(401);
  expect((await fetch(root+'/api/dots/list?token=dots-fixture-token&url=https://example.com')).status).toBe(400);
  const phone=browser.contexts()[0].pages().find(p=>p.url()==='about:blank')!;
  await phone.setViewportSize({width:390,height:780});await phone.goto(root+'/?token=dots-fixture-token#dots');
  await phone.locator('.dots-title-static').waitFor({timeout:10000});
  await phone.getByText('历史问题',{exact:true}).waitFor();await phone.locator('.dots-message strong').filter({hasText:'Dots 历史回复'}).waitFor();
  await phone.getByRole('textbox',{name:'消息',exact:true}).fill('手机给 Dot 的消息');await phone.getByRole('button',{name:'发送',exact:true}).click();
  await phone.getByText('收到手机消息：手机给 Dot 的消息',{exact:true}).waitFor({timeout:12000});
  expect(await phone.locator('.dots-message-user').count()).toBe(2);
  expect(await phone.locator('.dots-message-assistant').count()).toBe(2);
  expect(await phone.locator('.dots-title-static').textContent()).toContain('测试 Dot');
  expect(await phone.getByRole('button',{name:'切换 Dot 或设备',exact:true}).count()).toBe(0);
  expect(await phone.locator('.dots-title-static .chevron-icon').count()).toBe(0);
  const desktop=browser.contexts()[0].pages().find(p=>p.url()==='app://-/index.html')!;
  const requests=await desktop.evaluate(()=>(window as any).electronBridge.fixtureInspect());
  const writes=requests.filter((r:any)=>r.method==='POST');expect(writes).toHaveLength(1);expect(writes[0].path).toBe('/messaging/rooms/room%3Adot-a.v1/messages');expect(writes[0].body.idempotency_token).toBe(writes[0].body.request_id);
  await expect(adapter.send({dotId:'tbo:dot-a.v1',text:'cancelled-host',requestId:'cancelled'})).rejects.toMatchObject({code:'DOTS_WRITE_UNKNOWN'});
  await expect(adapter.send({dotId:'tbo:dot-a.v1',text:'cancelled-host',requestId:'cancelled'})).rejects.toMatchObject({code:'DOTS_WRITE_UNKNOWN'});
  const after=await desktop.evaluate(()=>(window as any).electronBridge.fixtureInspect());
  expect(after.filter((r:any)=>r.body?.content?.text==='cancelled-host')).toHaveLength(1);
  await phone.getByRole('button',{name:'添加附件',exact:true}).waitFor();
  expect(await phone.getByRole('button',{name:'添加附件',exact:true}).evaluate(e=>getComputedStyle(e).fontSize)).toBe('32px');
  await phone.locator('input[type=file]').setInputFiles([
    {name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('真实附件内容')},
    {name:'pixel.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10,0,255])},
  ]);
  await phone.getByRole('button',{name:'发送',exact:true}).click();
  await phone.waitForFunction(()=>!document.querySelector('.draft-files')&&!document.querySelector('.draft-images'));
  const withFiles=await desktop.evaluate(()=>(window as any).electronBridge.fixtureInspect());
  const fileWrites=withFiles.filter((r:any)=>r.path.endsWith('/files'));
  expect(fileWrites).toHaveLength(2);
  expect(fileWrites[0].file).toMatchObject({name:'note.txt',mime_type:'text/plain',data:[...Buffer.from('真实附件内容')]});
  expect(fileWrites[1].file.data).toEqual([137,80,78,71,13,10,26,10,0,255]);
  const sentFiles=withFiles.filter((r:any)=>r.body?.content?.attachments?.length).at(-1);
  expect(sentFiles.body.content.attachments).toEqual([{type:'file',file_id:'file-0'},{type:'file',file_id:'file-1'}]);
  const scrolling=await phone.locator('.dots-messages').evaluate(element=>{
    element.scrollTop=0;const old=element.scrollTop;element.scrollTop=50;
    return {scrollbar:getComputedStyle(element).scrollbarWidth,webkit:getComputedStyle(element,'::-webkit-scrollbar').display,canScroll:element.scrollHeight>element.clientHeight,changed:element.scrollTop>old};
  });
  expect(scrolling).toMatchObject({scrollbar:'none',webkit:'none',canScroll:true,changed:true});
  expect(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
  await phone.locator('.dots-messages').evaluate(e=>e.scrollTop=e.scrollHeight);
  await phone.getByText('note.txt',{exact:true}).waitFor();
  await phone.screenshot({path:'/tmp/codex-dots-attachments.png'});
  await phone.screenshot({path:'/tmp/codex-dots-mobile-redesign.png'});
  const diagnostics=await(await fetch(root+'/api/dots/diagnostics?token=dots-fixture-token')).json();
  expect(diagnostics.lastMessageMapping.roles.user).toBeGreaterThanOrEqual(2);
  expect(diagnostics.lastDiscovery).toMatchObject({received:1,invalidIds:0,acceptedFromList:1,primary:'available',returned:1,withRoom:1});
  await phone.getByRole('textbox',{name:'消息',exact:true}).focus();
  const focus=await phone.getByRole('textbox',{name:'消息',exact:true}).evaluate(element=>{const style=getComputedStyle(element);return {outline:style.outlineStyle,border:style.borderTopWidth,shadow:style.boxShadow};});
  expect(focus).toEqual({outline:'none',border:'0px',shadow:'none'});
  await phone.screenshot({path:'/tmp/codex-dots-focused-single.png'});
  await phone.setViewportSize({width:390,height:480});
  await phone.getByRole('textbox',{name:'消息',exact:true}).focus();
  const composerBox=await phone.locator('.dots-composer').boundingBox();expect(composerBox!.y+composerBox!.height).toBeLessThanOrEqual(480);
  expect(await phone.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
  await phone.screenshot({path:'/tmp/codex-dots-keyboard-height.png'});
  await phone.setViewportSize({width:390,height:780});
  await phone.getByRole('button',{name:'返回 Codex',exact:true}).click();await phone.getByRole('button',{name:'打开会话列表',exact:true}).click();await phone.getByRole('button',{name:'Dots',exact:true}).click();await phone.locator('.dots-title-static').waitFor();
  await phone.route('**/api/dots/list?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({dots:[],nextCursor:null})}));
  await phone.reload();await phone.getByRole('heading',{name:'未找到可用 Dot',exact:true}).waitFor();
  await phone.setViewportSize({width:320,height:690});
  expect(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await phone.screenshot({path:'/tmp/codex-dots-empty-redesign.png'});
  await desktop.evaluate(()=>(window as any).electronBridge.fixtureHoldIdentity());
  const completed=await desktop.evaluate(()=>(window as any).fixtureIdentitySettled||0);
  await expect(desktop.evaluate(`(${dotsRequestScript})(${JSON.stringify({request:{method:'POST',path:'/messaging/rooms/room%3Adot-a.v1/messages',body:{content:{text:'must-not-dispatch'}}},contract:DOTS_DESKTOP_CONTRACT,limit:1024,identity:{accountId:'fixture-account',userId:'fixture-user'},timeoutMs:10})})`)).rejects.toThrow('timed out');
  await expect(desktop.evaluate(`(${dotsStatusScript})(${JSON.stringify({contract:DOTS_DESKTOP_CONTRACT,timeoutMs:10})})`)).rejects.toThrow('timed out');
  await desktop.evaluate(()=>(window as any).electronBridge.fixtureReleaseIdentity());
  await desktop.waitForFunction(n=>(window as any).fixtureIdentitySettled>=n+2,completed);
  expect((await desktop.evaluate(()=>(window as any).electronBridge.fixtureInspect())).filter((r:any)=>r.body?.content?.text==='must-not-dispatch')).toHaveLength(0);
  await desktop.evaluate(()=>(window as any).electronBridge.fixtureSwitchIdentity());
  await expect(adapter.messages('tbo:dot-a.v1')).rejects.toMatchObject({code:'DOTS_ACCOUNT_CHANGED'});
  await expect(adapter.send({dotId:'tbo:dot-a.v1',text:'no new account send',requestId:'changed'})).rejects.toMatchObject({code:'DOTS_ACCOUNT_CHANGED'});
  expect((await transport.status()).available).toBe(false);
  expect((await desktop.evaluate(()=>(window as any).electronBridge.fixtureInspect())).filter((r:any)=>r.method==='POST')).toHaveLength(5);
 }finally{await gateway?.close();await transport.close();await browser?.close();child.kill('SIGTERM');await new Promise<void>(r=>{if(child.exitCode!==null)r();else child.once('exit',()=>r());});await rm(profile,{recursive:true,force:true});}
},40000);
