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

it.skipIf(process.env.RUN_CDP_FIXTURE!=='1')('现有 Web 经桌面结构化通道加载项目历史、发送、审批和停止',async()=>{
 const profile=await mkdtemp(join(tmpdir(),'web-desktop-control-'));
 const env:NodeJS.ProcessEnv={...process.env,CDP_FIXTURE_PORT:'19335',CDP_FIXTURE_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[resolve('tests/fixtures/control-desktop.cjs')],{env,stdio:'ignore'});
 let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined,gateway:Awaited<ReturnType<typeof createControlGateway>>|undefined;
 try{
  for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:19335');if(browser.contexts()[0].pages().some(p=>p.url()==='about:blank')&&browser.contexts()[0].pages().some(p=>p.url()==='app://-/index.html'))break;await browser.close();browser=undefined;}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!browser)throw new Error('fixture 启动失败');
  gateway=await createControlGateway({channel:new DesktopControlChannel(new CdpControlTransport('http://127.0.0.1:19335')),host:'127.0.0.1',port:0,token:'web-fixture-token',staticDir:resolve('dist')});
  const root=`http://127.0.0.1:${gateway.port}`;
  const host=await fetch(root+'/api/host?token=web-fixture-token',{headers:{Origin:'http://example.local'}});expect(host.headers.get('access-control-allow-origin')).toBe('http://example.local');expect((await host.json()).backend).toBe('desktop-control');
  expect(await(await fetch(root+'/api/projects?token=web-fixture-token')).json()).toEqual({projects:['/fixture']});
  const phone=browser.contexts()[0].pages().find(p=>p.url()==='about:blank')!;
  await phone.addInitScript(({origin})=>{
    const key='codex-mobile.backend-registry.v1';
    if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({version:1,selectedBackendId:'current-origin',backends:[{id:'current-origin',name:'Cached desktop',baseUrl:origin,token:'stale-fixture-token',enabled:true,order:0}]}));
  },{origin:root});
  await phone.setViewportSize({width:390,height:780});await phone.goto(root+'/?token=web-fixture-token');
  await phone.getByText('受控会话',{exact:true}).first().click({timeout:10000});
  await phone.getByText('历史输入',{exact:true}).waitFor({timeout:8000});
  await phone.getByRole('img',{name:'settings.png',exact:true}).waitFor({timeout:8000});
  await phone.waitForFunction(()=>Array.from(document.images).some(image=>image.alt==='settings.png'&&image.naturalWidth>0));
  expect(await phone.getByRole('button',{name:'选择审批与权限模式',exact:true}).textContent()).toContain('工作区访问');
  await phone.getByRole('button',{name:'选择审批与权限模式',exact:true}).click();await phone.getByRole('button',{name:/^只读/}).click();
  expect(await phone.getByRole('button',{name:'选择审批与权限模式',exact:true}).textContent()).toContain('只读');
  await phone.getByLabel('选择图片或视频').setInputFiles([{name:'upload.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZ8AAAAASUVORK5CYII=','base64')},{name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('fixture attachment')}]);
  await phone.getByRole('button',{name:'选择模型与思考强度',exact:true}).click();
  await phone.getByRole('button',{name:/^模型/}).click();await phone.getByRole('button',{name:/测试推理模型/}).click();
  await phone.getByRole('button',{name:'选择模型与思考强度',exact:true}).click();await phone.getByRole('button',{name:/^低/}).click();
  await phone.getByRole('textbox',{name:'向 Codex 提问'}).fill('Web 桌面对话');await phone.getByRole('button',{name:'发送',exact:true}).click();
  await phone.getByText('结构化回复',{exact:true}).waitFor({timeout:8000});
  await phone.getByRole('button',{name:'拒绝',exact:true}).click();await phone.getByRole('button',{name:'拒绝',exact:true}).waitFor({state:'hidden'});
  await phone.locator('.previous-messages-toggle').last().click();
  await phone.locator('.reasoning strong').filter({hasText:'Editing the documentation note'}).waitFor();
  const desktop=browser.contexts()[0].pages().find(p=>p.url()==='app://-/index.html')!;expect(await desktop.locator('main').textContent()).toContain('Web 桌面对话结构化回复');
  expect(await desktop.evaluate(()=>(window as any).received.filter((e:any)=>e.method==='fixture/submitted').at(-1))).toMatchObject({hostId:'local',params:{model:'fixture-pro',effort:'low',hasPermissions:true,permissions:':read-only',inputTypes:['text','text','localImage']}});
  await phone.getByRole('textbox',{name:'向 Codex 提问'}).fill('停止验证');await phone.getByRole('button',{name:'发送',exact:true}).click();
  await phone.getByRole('button',{name:'停止',exact:true}).click();await phone.getByRole('button',{name:'发送',exact:true}).waitFor({timeout:8000});
  expect(await desktop.evaluate(()=>(window as any).received.some((e:any)=>e.method==='turn/completed'&&e.params.turn.status==='interrupted'))).toBe(true);
  await phone.getByRole('button',{name:'打开会话列表',exact:true}).click();
  await phone.getByRole('button',{name:'聊天',exact:true}).click();
  await phone.getByRole('textbox',{name:'向 Codex 提问'}).fill('新建 Web 会话');await phone.getByRole('button',{name:'发送',exact:true}).click();
  await phone.getByText('结构化回复',{exact:true}).waitFor({timeout:8000});await phone.getByRole('button',{name:'拒绝',exact:true}).click();await phone.getByRole('button',{name:'拒绝',exact:true}).waitFor({state:'hidden'});
  expect(await desktop.evaluate(()=>(window as any).received.some((e:any)=>e.method==='turn/started'&&e.params.threadId==='fixture-created'))).toBe(true);
  expect(await desktop.evaluate(()=>(window as any).received.filter((e:any)=>e.method==='fixture/submitted').at(-1))).toMatchObject({params:{model:null,effort:null,hasPermissions:false}});
  await phone.getByRole('button',{name:'打开会话列表',exact:true}).click();await phone.getByRole('button',{name:'管理设备',exact:true}).click();await phone.getByRole('button',{name:/^编辑 /}).click();
  await phone.getByRole('button',{name:'测试并保存',exact:true}).click();
  await phone.getByRole('dialog',{name:'选择展示的主机'}).waitFor();
  if(process.env.HOST_SELECTION_SCREENSHOTS)await phone.screenshot({path:'/tmp/codex-host-picker.png'});
  expect(await phone.getByRole('checkbox',{name:'显示 macmini',exact:true}).isChecked()).toBe(false);
  await phone.getByRole('checkbox',{name:'显示 macmini',exact:true}).check();await phone.getByRole('button',{name:'保存选择',exact:true}).click();await phone.getByRole('button',{name:/^编辑 /}).waitFor();if(process.env.HOST_SELECTION_SCREENSHOTS)await phone.screenshot({path:'/tmp/codex-host-tree.png'});await phone.getByRole('button',{name:'关闭',exact:true}).click();
  await phone.getByText('远程会话',{exact:true}).click({timeout:10000});await phone.getByText('远程历史输入',{exact:true}).waitFor();
  await phone.getByRole('button',{name:'选择模型与思考强度',exact:true}).click();await phone.getByRole('button',{name:/^模型/}).click();await phone.getByRole('button',{name:/远程推理模型/}).click();
  await phone.getByRole('textbox',{name:'向 Codex 提问'}).fill('远程 Web 对话');await phone.getByRole('button',{name:'发送',exact:true}).click();
  await phone.locator('.backend-workspace:not([hidden])').getByText('结构化回复',{exact:true}).waitFor({timeout:8000});await phone.getByRole('button',{name:'拒绝',exact:true}).click();await phone.getByRole('button',{name:'拒绝',exact:true}).waitFor({state:'hidden'});
  expect(await desktop.evaluate(()=>(window as any).received.filter((e:any)=>e.method==='fixture/submitted').at(-1))).toMatchObject({hostId:'remote-ssh-discovered:macmini',params:{threadId:'fixture-thread',model:'remote-pro',hasPermissions:false}});
  await phone.getByRole('button',{name:'打开会话列表',exact:true}).click();await phone.getByRole('button',{name:'管理设备',exact:true}).click();
  await phone.getByRole('checkbox',{name:'显示 macmini',exact:true}).uncheck();
  await phone.getByRole('button',{name:'关闭',exact:true}).click();await phone.getByText('远程会话',{exact:true}).waitFor({state:'hidden'});
  await phone.getByRole('button',{name:'管理设备',exact:true}).click();await phone.getByRole('checkbox',{name:/^显示 .*（本机）$/}).uncheck();
  await phone.getByRole('button',{name:'关闭',exact:true}).click();await phone.getByText('没有展示的主机，请在设备管理中开启。',{exact:true}).waitFor();
  await phone.reload();await phone.getByText('没有展示的主机，请在设备管理中开启。',{exact:true}).waitFor();
  await phone.getByRole('button',{name:'管理设备',exact:true}).click();await phone.getByRole('checkbox',{name:/^显示 .*（本机）$/}).check();
  await phone.getByRole('button',{name:'关闭',exact:true}).click();
  expect(await phone.evaluate(()=>JSON.parse(localStorage.getItem('codex-mobile.backend-registry.v1')!).backends[0].visibleHostIds)).toEqual(['local']);
 }finally{await gateway?.close();await browser?.close();child.kill('SIGTERM');await new Promise<void>(r=>{if(child.exitCode!==null)r();else child.once('exit',()=>r());});await rm(profile,{recursive:true,force:true});}
},40000);
