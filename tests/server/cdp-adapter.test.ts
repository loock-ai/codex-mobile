// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { parseDesktopDocument, validateCdpUrl } from '../../server/cdp/dom.js';
import { JSDOM } from 'jsdom';
function parse(html:string,route='/local/abc') {const d=new JSDOM(html,{url:'https://desktop.invalid'+route});return parseDesktopDocument(d.window.document as any,d.window.location as any);}
describe('桌面 DOM 识别',()=>{
 it('只允许本机调试地址',()=>{
  expect(validateCdpUrl('http://127.0.0.1:9222')).toBe('http://127.0.0.1:9222');
  expect(()=>validateCdpUrl('http://example.com:9222')).toThrow();
  expect(()=>validateCdpUrl('http://user:pass@localhost:9222')).toThrow();
 });
 it('识别线程、消息、草稿与 Dots 路由',()=>{
  const s=parse('<h1>测试线程</h1><div data-message-id="u" data-message-author-role="user">问题</div><div data-message-id="a" data-message-author-role="assistant">答案</div><div contenteditable="true" role="textbox">草稿</div>');
  expect(s.threadId).toBe('codex:abc');expect(s.messages).toEqual([{id:'u',role:'user',text:'问题'},{id:'a',role:'assistant',text:'答案'}]);expect(s.draft).toBe('草稿');
  expect(parse('<h1>Dot</h1>','/dots/room-a').threadId).toBe('dots:room-a');
 });
 it('无明确线程或重复输入框时拒绝写能力',()=>{
  expect(()=>parse('<div contenteditable="true"></div>','/settings')).toThrow('会话');
  expect(()=>parse('<div role="textbox" contenteditable="true"></div><div role="textbox" contenteditable="true"></div>')).toThrow('输入框');
 });
 it('仅识别明确审批区域，保存按钮原文，不把普通对话框当审批',()=>{
  const s=parse('<div role="dialog"><h2>设置</h2><button>保存</button></div><div data-desktop-approval><p>允许运行命令？</p><button>允许一次</button><button>拒绝</button></div>');
  expect(s.approvals).toHaveLength(1);expect(s.approvals[0].options.map(x=>x.label)).toEqual(['允许一次','拒绝']);
 });
});

it('读取桌面版侧栏的线程数据属性，识别当前选择',()=>{
 const s=parse('<div data-app-action-sidebar-thread-id="local:abc" data-app-action-sidebar-thread-title="真实线程" data-app-action-sidebar-thread-kind="local" data-app-action-sidebar-thread-selected="true"></div><div role="textbox" contenteditable="true"></div>');
 expect(s.threads).toEqual([{id:'codex:abc',title:'真实线程',mode:'codex'}]);
});

it('从实际桌面的渲染 turn props 提取消息，避免把工具输出当回复',()=>{
 const d=new JSDOM('<div data-turn-key="turn1"></div><div contenteditable="true" role="textbox"></div>',{url:'https://desktop.invalid/local/abc'});
 const node:any=d.window.document.querySelector('[data-turn-key]');
 node.__reactFiber$fixture={memoizedProps:{turn:{id:'turn1',items:[{id:'u1',type:'userMessage',content:[{type:'text',text:'问题'}]},{id:'a1',type:'agentMessage',text:'答案'},{id:'cmd',type:'commandExecution',aggregatedOutput:'不应成为回复'}]}},return:null};
 expect(parseDesktopDocument(d.window.document as any,d.window.location as any).messages).toEqual([{id:'u1',role:'user',text:'问题'},{id:'a1',role:'assistant',text:'答案'}]);
});

it('实际审批组件带 requestId 才能识别普通按钮为审批',()=>{
 const d=new JSDOM('<section><p>允许读取文件？</p><button>允许一次</button><button>拒绝</button></section>',{url:'https://desktop.invalid/local/abc'});
 const node:any=d.window.document.querySelector('section');node.__reactFiber$fixture={memoizedProps:{requestId:'real-request',request:{type:'command'}},return:null};
 const s=parseDesktopDocument(d.window.document as any,d.window.location as any);
 expect(s.approvals).toHaveLength(1);expect(s.approvals[0].id).toBe('real-request');
});

it('识别安装版 Dots 消息行、路由别名和 typing 状态，排除回执与附件按钮',()=>{
 const html='<article class="message-row self" data-message-id="u"><div class="message-text">问题</div><div>已送达</div><button data-message-id="attachment">下载</button></article><article class="message-row assistant" data-message-id="a"><div class="message-text">Dot 回复</div><div>昨天</div></article><div class="typing-indicator" data-visible="true"></div><textarea></textarea>';
 for(const route of ['/dots/room-a','/o/room-a']){
  const s=parse(html,route);expect(s.threadId).toBe('dots:room-a');expect(s.busy).toBe(true);
  expect(s.messages).toEqual([{id:'u',role:'user',text:'问题'},{id:'a',role:'assistant',text:'Dot 回复'}]);
 }
 expect(parse(html.replace('data-visible="true"','data-visible="false"'),'/dots/room-a').busy).toBe(false);
});
it('Dots 首页、新建和邮箱审批路由不被当作会话',()=>{
 for(const route of ['/dots/home','/dots/new','/dots/approve','/dots/claim-email','/o/new','/o/approve','/o/claim-email'])expect(()=>parse('<textarea></textarea>',route)).toThrow('会话');
});
it('Dots 审批身份包含 room、thread 与 snake_case request ID',()=>{
 const d=new JSDOM('<section><p>运行操作？</p><button>允许一次</button><button>拒绝</button></section>',{url:'https://desktop.invalid/dots/dot-a'});
 const node:any=d.window.document.querySelector('section');node.__reactFiber$fixture={memoizedProps:{roomId:'room-a',request:{request_id:'r1',thread_id:'t1',turn_id:'turn1'}},return:null};
 const s=parseDesktopDocument(d.window.document as any,d.window.location as any);expect(s.approvals[0]?.id).toBe('dots:'+JSON.stringify(['room-a','t1','turn1','r1']));
});

it('React 审批已消失时清理桥接注入的定位属性',()=>{
 const d=new JSDOM('<section><p>读取文件？</p><button>允许一次</button><button>拒绝</button></section>',{url:'https://desktop.invalid/dots/dot-a'});
 const node:any=d.window.document.querySelector('section');node.__reactFiber$fixture={memoizedProps:{roomId:'room-a',request:{request_id:'r1',thread_id:'t1'}},return:null};
 expect(parseDesktopDocument(d.window.document as any,d.window.location as any).approvals).toHaveLength(1);
 node.__reactFiber$fixture.memoizedProps={};
 expect(parseDesktopDocument(d.window.document as any,d.window.location as any).approvals).toHaveLength(0);
});

it('CSS 隐藏的备用编辑器不会被当作第二个输入框或草稿',()=>{
 const s=parse('<div style="display:none"><textarea>隐藏备用草稿</textarea></div><div style="visibility:hidden"><textarea>隐藏面板</textarea></div><textarea>当前草稿</textarea>');
 expect(s.draft).toBe('当前草稿');
});
it('CSS 隐藏的审批、typing 和消息不属于当前可见页面',()=>{
 const s=parse('<div style="display:none"><section data-approval-id="old"><button>允许一次</button><button>拒绝</button></section><div class="typing-indicator" data-visible="true"></div><article class="message-row assistant" data-message-id="old-msg"><div class="message-text">旧回复</div></article></div><textarea></textarea>','/dots/current');
 expect(s.approvals).toHaveLength(0);expect(s.messages).toHaveLength(0);expect(s.busy).toBe(false);
});
