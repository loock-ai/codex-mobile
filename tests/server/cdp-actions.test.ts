// @vitest-environment node
import {it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {applyDesktopAction} from '../../server/cdp/actions.js';
it('输入前检查会话和草稿，不覆盖已切换会话的内容',()=>{
 const d=new JSDOM('<textarea>B 的原有草稿</textarea>',{url:'https://desktop.invalid/local/b'});
 expect(()=>applyDesktopAction(d.window.document as any,d.window.location as any,{kind:'write',threadId:'codex:a',text:'给 A 的消息'})).toThrow('切换');
 expect(d.window.document.querySelector('textarea')!.value).toBe('B 的原有草稿');
});
it('相同文案的新审批不能代替已经过期的旧审批',()=>{
 const d=new JSDOM('<section data-approval-id="new"><p>确认操作？</p><button>允许一次</button><button>拒绝</button></section>',{url:'https://desktop.invalid/local/a'});let count=0;
 d.window.document.querySelector('button')!.addEventListener('click',()=>count++);
 expect(()=>applyDesktopAction(d.window.document as any,d.window.location as any,{kind:'approve',threadId:'codex:a',approvalId:'old',choice:'0'})).toThrow('失效');expect(count).toBe(0);
});
it('不可识别页面不导航到其他线程',()=>{
 const d=new JSDOM('<button>新聊天</button>',{url:'https://desktop.invalid/settings'});let count=0;d.window.document.querySelector('button')!.addEventListener('click',()=>count++);
 expect(()=>applyDesktopAction(d.window.document as any,d.window.location as any,{kind:'open',threadId:'codex:a',target:'codex:new'})).toThrow('会话');expect(count).toBe(0);
});
