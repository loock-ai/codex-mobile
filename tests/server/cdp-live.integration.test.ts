// @vitest-environment node
import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {CdpDesktopAdapter} from '../../server/cdp/adapter.js';
import {DesktopProtocol} from '../../server/cdp/protocol.js';
import {createBridgeGateway} from '../../server/cdp/gateway.js';
import {chromium} from 'playwright-core';

it.skipIf(process.env.RUN_CDP_FIXTURE!=='1')('真实 Electron/CDP 受控页面完成文本输入、流式回读和审批，不接触 ChatGPT 账号',async()=>{
 const electron=resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
 const profile=await mkdtemp(join(tmpdir(),'desktop-cdp-fixture-'));
 const env:NodeJS.ProcessEnv={...process.env,CDP_FIXTURE_PORT:'19333',CDP_FIXTURE_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electron,[resolve('tests/fixtures/desktop.cjs')],{env,stdio:'ignore'});
 const adapter=new CdpDesktopAdapter('http://127.0.0.1:19333');
 const events:any[]=[];const p=new DesktopProtocol(adapter,e=>events.push(e));
 try {
  for(let i=0;i<100;i++){try{await adapter.connect();await adapter.snapshot();break;}catch{await new Promise(r=>setTimeout(r,100));}}
  expect((await adapter.snapshot()).threadId).toBe('codex:fixture');
  await p.poll();await p.request('turn/start',{threadId:'codex:fixture',input:[{type:'text',text:'中文\n多行文本'}]});
  for(let i=0;i<20;i++){await p.poll();if(events.some(e=>e.method==='turn/completed'))break;await new Promise(r=>setTimeout(r,100));}
  const s=await adapter.snapshot();expect(s.messages[0].text).toBe('中文\n多行文本');expect(s.messages[1].text).toBe('受控回复完成');expect(events.some(e=>e.method==='turn/completed')).toBe(true);
  const approval=p.pendingApprovals()[0];expect(approval.params.desktopApproval.text).toContain('受控测试操作');
  await p.respond(approval.id!,{desktopChoice:'1'});expect((await adapter.snapshot()).approvals).toHaveLength(0);
  const gateway=await createBridgeGateway({port:0,host:'127.0.0.1',token:'fixture-only-test-token',staticDir:resolve('dist'),adapter});
  const uiBrowser=await chromium.connectOverCDP('http://127.0.0.1:19333');
  try {
   const phone=uiBrowser.contexts()[0].pages().find(page=>page.url()==='about:blank');if(!phone)throw new Error('Missing fixture phone window');await phone.setViewportSize({width:390,height:780});
   await phone.goto(`http://127.0.0.1:${gateway.port}/?token=fixture-only-test-token`);
   await phone.getByText('测试会话',{exact:true}).first().click({timeout:8000});
   await phone.getByRole('textbox',{name:'向 Codex 提问'}).fill('手机端验证');await phone.getByRole('button',{name:'发送',exact:true}).click();
   await phone.getByText('受控回复完成',{exact:true}).last().waitFor({timeout:8000});
   await phone.getByRole('button',{name:'拒绝',exact:true}).click({timeout:8000});
   await phone.getByRole('button',{name:'拒绝',exact:true}).waitFor({state:'hidden'});
   await phone.screenshot({path:resolve('docs/assets/launcher/mobile-fixture.png')});
   expect((await adapter.snapshot()).messages.some(m=>m.text==='手机端验证')).toBe(true);
   await phone.close();
   const desktop=uiBrowser.contexts()[0].pages().find(page=>page.url()==='app://-/index.html');if(!desktop)throw new Error('Missing fixture desktop');
   await desktop.evaluate(()=> (window as any).setDots());
   await p.poll();await p.request('turn/start',{threadId:'dots:fixture-dot',input:[{type:'text',text:'Dot 手机协议验证'}]});
   for(let i=0;i<20;i++){await p.poll();if((await adapter.snapshot()).approvals.length)break;await new Promise(r=>setTimeout(r,100));}
   const dot=await adapter.snapshot();expect(dot.messages.map(m=>m.text)).toEqual(['Dot 手机协议验证','受控回复完成']);expect(dot.mode).toBe('dots');
   const dotApproval=p.pendingApprovals()[0];expect(dotApproval.params.desktopApproval.id).toContain('dot-approval');
   await p.respond(dotApproval.id!,{desktopChoice:'1'});expect((await adapter.snapshot()).approvals).toHaveLength(0);
  } finally {await uiBrowser.close();await gateway.close();}

 }finally{await adapter.close();child.kill('SIGTERM');}
},30000);
