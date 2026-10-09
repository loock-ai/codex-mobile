// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DesktopProtocol, type DesktopSnapshot, type DesktopAdapter } from '../../server/cdp/protocol.js';

function fixture() {
  let state: DesktopSnapshot = {threadId:'codex:a', title:'测试', mode:'codex', busy:false,draft:'',messages:[],approvals:[],threads:[{id:'codex:a',title:'测试',mode:'codex'}]};
  const actions: string[] = [];
  const adapter: DesktopAdapter = {
    snapshot: async () => structuredClone(state),
    open: async (id) => { state.threadId=id; },
    send: async (_id,text) => {actions.push(text);state.messages.push({id:'u1',role:'user',text}); state.busy=true;},
    stop: async () => { state.busy=false; },
    approve: async (id,choice) => { actions.push(id+':'+choice);state.approvals=[]; },
    close: async () => {},
  };
  const events: any[]=[];
  const protocol=new DesktopProtocol(adapter, (event)=>events.push(event));
  return {protocol,events,actions,state};
}

describe('CDP 手机协议兼容层', () => {
 it('初始化标明 CDP 来源，恢复相同桌面线程',async()=>{
  const f=fixture(); expect(await f.protocol.request('initialize',{})).toMatchObject({backend:'desktop-cdp'});
  expect(await f.protocol.request('thread/list',{})).toMatchObject({data:[{id:'codex:a'}]});
  expect(await f.protocol.request('thread/resume',{threadId:'codex:a'})).toMatchObject({thread:{id:'codex:a'},initialTurnsPage:{data:[]}});
  await expect(f.protocol.request('fs/readFile',{})).rejects.toThrow('不支持');
 });
 it('发送文本并同步桌面消息和完成事件，不重放',async()=>{
  const f=fixture(); await f.protocol.poll();
  const result:any=await f.protocol.request('turn/start',{threadId:'codex:a',input:[{type:'text',text:'你好\n世界'}]});
  expect(result.turn.status).toBe('inProgress'); expect(f.actions).toEqual(['你好\n世界']);
  f.state.messages.push({id:'a1',role:'assistant',text:'答'});await f.protocol.poll();
  f.state.messages[1].text='答案';await f.protocol.poll();
  f.state.busy=false;await f.protocol.poll();
  expect(f.events.some(e=>e.method==='item/agentMessage/delta' && e.params.delta==='案')).toBe(true);
  expect(f.events.some(e=>e.method==='turn/completed')).toBe(true);
 });
 it('已有草稿、会话切换或附件时拒绝发送',async()=>{
  const f=fixture(); f.state.draft='桌面草稿';
  await expect(f.protocol.request('turn/start',{threadId:'codex:a',input:[{type:'text',text:'x'}]})).rejects.toThrow('草稿');
  f.state.draft='';f.state.threadId='dots:b';
  await expect(f.protocol.request('turn/start',{threadId:'codex:a',input:[{type:'text',text:'x'}]})).rejects.toThrow('切换');
  f.state.threadId='codex:a';
  await expect(f.protocol.request('turn/start',{threadId:'codex:a',input:[{type:'image',url:'x'}]})).rejects.toThrow('文本');
  expect(f.actions).toEqual([]);
 });
 it('审批保留原始选项，过期或重复响应不执行',async()=>{
  const f=fixture();f.state.approvals=[{id:'p1',text:'读取本地文件？',options:[{id:'allow',label:'允许一次',decision:'accept'},{id:'deny',label:'拒绝',decision:'decline'}]}];
  await f.protocol.poll();const req=f.events.find(e=>e.method==='item/commandExecution/requestApproval');
  expect(req.params.desktopApproval.options[0].label).toBe('允许一次');
  await f.protocol.respond(req.id,{decision:'decline'});expect(f.actions).toEqual(['p1:deny']);
  await expect(f.protocol.respond(req.id,{decision:'accept'})).rejects.toThrow('失效');
 });
 it('发现 Dots 使用独立身份，审批消失发出撤销通知',async()=>{
  const f=fixture();f.state.threadId='dots:b';f.state.mode='dots';f.state.title='Dot';
  f.state.approvals=[{id:'p2',text:'确认？',options:[{id:'yes',label:'确认'}]}];
  await f.protocol.poll();f.state.approvals=[];await f.protocol.poll();
  expect(f.events.some(e=>e.method==='desktop/approval/resolved')).toBe(true);
  expect((await f.protocol.request('thread/read',{threadId:'dots:b'}) as any).thread.id).toBe('dots:b');
 });
});

it('重连可以读取未处理审批，未知审批写入不重新派发',async()=>{
 const f=fixture();f.state.approvals=[{id:'p3',text:'确认操作',options:[{id:'yes',label:'允许',decision:'accept'}]}];await f.protocol.poll();
 const req=f.protocol.pendingApprovals()[0];expect(req.params.desktopApproval.id).toBe('p3');
 await f.protocol.respond(req.id!,{desktopChoice:'yes'});expect(f.protocol.pendingApprovals()).toHaveLength(0);
});

it('新聊天使用桌面当前输入框，不创建 app-server 会话',async()=>{
 const f=fixture();f.state.threadId='codex:new';f.state.messages=[];
 expect(await f.protocol.request('thread/start',{})).toMatchObject({thread:{id:'codex:new'}});
});

it('发送确认前已完成的快速回复也发完成事件，手机不会卡 busy',async()=>{
 const f=fixture();(f.state as any).messages=[];
 const adapter:DesktopAdapter={snapshot:async()=>structuredClone(f.state),open:async()=>{},send:async()=>{f.state.messages=[{id:'u',role:'user',text:'ping'},{id:'a',role:'assistant',text:'pong'}];f.state.busy=false},stop:async()=>{},approve:async()=>{},close:async()=>{}};
 const events:any[]=[];const p=new DesktopProtocol(adapter,e=>events.push(e));
 await p.request('turn/start',{threadId:'codex:a',input:[{type:'text',text:'ping'}]});await p.poll();
 expect(events.some(e=>e.method==='turn/completed')).toBe(true);
});

it('抢在下一轮询前处理过期审批也会撤销手机弹层',async()=>{
 const f=fixture();f.state.approvals=[{id:'p4',text:'操作？',options:[{id:'yes',label:'允许',decision:'accept'}]}];await f.protocol.poll();const req=f.protocol.pendingApprovals()[0];f.state.approvals=[];
 await expect(f.protocol.respond(req.id!,{decision:'accept'})).rejects.toThrow('失效');
 expect(f.events.some(e=>e.method==='desktop/approval/resolved'&&e.params.id===req.id)).toBe(true);
});
