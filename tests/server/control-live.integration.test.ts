// @vitest-environment node
import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright-core';
import {DesktopControlChannel} from '../../server/cdp/control-channel.js';
import {CdpControlTransport} from '../../server/cdp/control-transport.js';
import {createControlGateway} from '../../server/cdp/control-gateway.js';
import {DesktopControlClient} from '../../server/cdp/control-client.js';

it.skipIf(process.env.RUN_CDP_FIXTURE!=='1')('程序 WebSocket 经真实 CDP/preload/main IPC 获取列表分页、历史、收发审批并同步受控桌面',async()=>{
 const profile=await mkdtemp(join(tmpdir(),'desktop-control-fixture-'));
 const env:NodeJS.ProcessEnv={...process.env,CDP_FIXTURE_PORT:'19334',CDP_FIXTURE_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[resolve('tests/fixtures/control-desktop.cjs')],{env,stdio:'ignore'});
 let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined;
 let gateway:Awaited<ReturnType<typeof createControlGateway>>|undefined;
 let client:DesktopControlClient|undefined,other:DesktopControlClient|undefined;
 try{
  for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:19334');if(browser.contexts()[0].pages().some(p=>p.url()==='app://-/index.html'))break;await browser.close();browser=undefined;}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!browser)throw new Error('fixture startup timed out');
  const channel=new DesktopControlChannel(new CdpControlTransport('http://127.0.0.1:19334'));
  gateway=await createControlGateway({channel,host:'127.0.0.1',port:0,token:'fixture-control-secret'});
  expect((await fetch(`http://127.0.0.1:${gateway.port}/api/status`)).status).toBe(401);
  const url=`ws://127.0.0.1:${gateway.port}/ws?token=fixture-control-secret`;
  client=new DesktopControlClient(url);other=new DesktopControlClient(url);
  const handshake=await client.connect();await other.connect();expect(handshake.backend).toBe('desktop-control');
  const a=await client.request('project/list',{limit:100});const b=await client.request('project/list',{cursor:a.nextCursor});expect([...a.data,...b.data].map(p=>p.id)).toEqual(['p1','p2']);
  expect(a.nextCursor).toBe('page2');expect(b.nextCursor).toBeNull();
  const project=await client.request('project/read',{projectId:a.data[0].id});
  expect(project.project).toMatchObject({id:'p1',name:'项目一',roots:[{path:'/fixture'}]});
  expect((await other.request('thread/list',{})).data[0].id).toBe('fixture-thread');
  expect((await client.request('thread/turns/list',{threadId:'fixture-thread'})).data[0].id).toBe('fixture-turn');
  expect((await client.request('thread/items/list',{threadId:'fixture-thread',turnId:'fixture-turn'})).data[0].content[0].text).toBe('历史输入');
  const events:any[]=[],otherEvents:any[]=[];client.subscribe(e=>events.push(e));other.subscribe(e=>otherEvents.push(e));
  await client.request('desktop/subscribe',{threadIds:['fixture-thread']});
  await client.request('turn/start',{threadId:'fixture-thread',input:[{type:'text',text:'程序发送'}]});
  for(let i=0;i<80&&!events.some(e=>e.id);i++)await new Promise(r=>setTimeout(r,50));
  expect(events.some(e=>e.method==='item/agentMessage/delta'&&e.params.delta==='结构化回复')).toBe(true);
  const approval=events.find(e=>e.id);expect(approval.method).toBe('item/commandExecution/requestApproval');
  await expect(other.request('desktop/approval/respond',{approvalId:approval.id,result:{decision:'decline'}})).rejects.toMatchObject({code:'APPROVAL_EXPIRED'});
  await client.request('desktop/approval/respond',{approvalId:approval.id,result:{decision:'decline'}});
  for(let i=0;i<40&&!events.some(e=>e.method==='serverRequest/resolved');i++)await new Promise(r=>setTimeout(r,50));
  expect(events.some(e=>e.method==='serverRequest/resolved')).toBe(true);
  await expect(client.request('desktop/approval/respond',{approvalId:approval.id,result:{decision:'decline'}})).rejects.toMatchObject({code:'APPROVAL_EXPIRED'});
  expect(otherEvents).toHaveLength(0);
  const page=browser.contexts()[0].pages().find(p=>p.url()==='app://-/index.html')!;
  expect(await page.locator('main').textContent()).toBe('程序发送结构化回复');
  expect(await page.evaluate(()=>(window as any).received.some((e:any)=>e.method==='turn/completed'))).toBe(true);
 }finally{client?.close();other?.close();await gateway?.close();await browser?.close();child.kill('SIGTERM');await new Promise<void>(r=>{if(child.exitCode!==null)r();else child.once('exit',()=>r());});await rm(profile,{recursive:true,force:true});}
},30000);
