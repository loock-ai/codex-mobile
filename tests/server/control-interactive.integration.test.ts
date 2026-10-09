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

it.skipIf(process.env.RUN_CDP_FIXTURE!=='1')('CDP补读主机非阻塞问题，任务继续输出且可引导，回答回到同一请求',async()=>{
 const profile=await mkdtemp(join(tmpdir(),'desktop-interactive-'));
 const env:NodeJS.ProcessEnv={...process.env,CDP_FIXTURE_PORT:'19337',CDP_FIXTURE_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[resolve('tests/fixtures/control-desktop.cjs')],{env,stdio:'ignore'});
 let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined,gateway:Awaited<ReturnType<typeof createControlGateway>>|undefined;
 try{
  for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:19337',{timeout:1000});if(browser.contexts()[0].pages().some(p=>p.url()==='about:blank')&&browser.contexts()[0].pages().some(p=>p.url()==='app://-/index.html'))break;await browser.close();browser=undefined;}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!browser)throw new Error('fixture unavailable');
  gateway=await createControlGateway({channel:new DesktopControlChannel(new CdpControlTransport('http://127.0.0.1:19337')),host:'127.0.0.1',port:0,token:'interactive-fixture',staticDir:resolve('dist')});
  const phone=browser.contexts()[0].pages().find(p=>p.url()==='about:blank')!;
  await phone.setViewportSize({width:390,height:844});await phone.goto(`http://127.0.0.1:${gateway.port}/?token=interactive-fixture`);
  await phone.getByText('受控会话',{exact:true}).first().click({timeout:10000});await phone.getByText('历史输入',{exact:true}).waitFor();
  await phone.getByRole('textbox',{name:'向 Codex 提问'}).fill('运行中问题测试');await phone.getByRole('button',{name:'发送',exact:true}).click();
  const question=phone.getByRole('region',{name:'Codex 有个问题'});await question.waitFor({timeout:10000});
  expect(await phone.getByRole('dialog').count()).toBe(0);await phone.getByText('任务继续执行',{exact:true}).waitFor();
  await phone.getByRole('textbox',{name:'向 Codex 提问'}).fill('补充引导');await phone.getByRole('button',{name:'引导',exact:true}).click();
  await phone.getByText('任务继续执行；已收到引导',{exact:true}).waitFor();
  const desktop=browser.contexts()[0].pages().find(p=>p.url()==='app://-/index.html')!;
  const events=await desktop.evaluate(()=>(window as any).received);
  expect(events.find((e:any)=>e.method==='fixture/steered')).toMatchObject({hostId:'local',params:{threadId:'fixture-thread',expectedTurnId:'fixture-live',input:[{type:'text',text:'补充引导'}]}});
  await question.getByRole('button',{name:'收起问题'}).click();await question.getByRole('button',{name:'展开问题'}).click();
  await question.getByRole('combobox',{name:'希望哪种格式？'}).selectOption({label:'简短'});
  await phone.screenshot({path:'/tmp/codex-nonblocking-question.png'});
  await question.getByRole('button',{name:'提交回答',exact:true}).click();await question.waitFor({state:'hidden',timeout:10000});
  expect(await desktop.evaluate(()=>(window as any).electronBridge.fixtureQuestionAnswers())).toEqual([{host:'local',thread:'fixture-thread',id:'host-question',result:{answers:{format:{answers:['简短']}}}}]);
  await phone.getByRole('button',{name:'停止',exact:true}).click();
 }finally{await gateway?.close();await browser?.close();child.kill('SIGTERM');await new Promise<void>(r=>{if(child.exitCode!==null)r();else child.once('exit',()=>r());});await rm(profile,{recursive:true,force:true});}
},40000);
