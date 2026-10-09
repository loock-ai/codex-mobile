import {parseDesktopDocument} from './dom.js';
export type DesktopAction = {kind:'write';threadId:string;text:string}|{kind:'submit';threadId:string;text:string}|{kind:'open';threadId:string;target:string}|{kind:'approve';threadId:string;approvalId:string;choice:string}|{kind:'stop';threadId:string};
/** 与读取身份在同一次 renderer 执行内写入/点击，不在中间 await。 */
export function applyDesktopAction(doc:Document,loc:Location,action:DesktopAction, read:typeof parseDesktopDocument=parseDesktopDocument) {
 const s=read(doc,loc);
 if(s.threadId!==action.threadId)throw new Error('桌面会话已切换，操作已取消');
 const visible=(e:Element)=>{for(let p:Element|null=e;p;p=p.parentElement){const style=doc.defaultView?.getComputedStyle(p);if(p.hasAttribute('hidden')||p.hasAttribute('inert')||p.getAttribute('aria-hidden')==='true'||style?.display==='none'||style?.visibility==='hidden')return false;}return true;};
 const unique=<T extends Element>(elements:T[],label:string)=>{const visibleElements=elements.filter(visible);if(visibleElements.length!==1)throw new Error(`${label}不存在或存在歧义`);return visibleElements[0];};
 const label=(e:Element)=>e.getAttribute('aria-label')||((e as HTMLElement).innerText??e.textContent??'').trim();
 const buttons=[...doc.querySelectorAll<HTMLButtonElement>('button')];
 if(action.kind==='write'){
  if(s.busy||s.draft.trim())throw new Error('桌面有任务或草稿，不能填写消息');
  const editor=unique([...doc.querySelectorAll<HTMLElement>('[contenteditable="true"][role="textbox"],textarea')],'输入框');editor.focus();
  if(editor.tagName==='TEXTAREA'){
   const setter=Object.getOwnPropertyDescriptor(doc.defaultView!.HTMLTextAreaElement.prototype,'value')!.set!;setter.call(editor,action.text);editor.dispatchEvent(new doc.defaultView!.Event('input',{bubbles:true}));
  }else{
   const selection=doc.getSelection(),range=doc.createRange();range.selectNodeContents(editor);selection?.removeAllRanges();selection?.addRange(range);
   if(!doc.execCommand('insertText',false,action.text))throw new Error('桌面输入框不支持原生文本输入');
  }
  return;
 }
 if(action.kind==='submit'){
  if(s.busy||s.draft!==action.text)throw new Error('桌面草稿或运行状态已变化，未提交');
  const button=unique(buttons.filter(b=>/^(发送|发送消息|提交|Send|Send message|Submit)$/i.test(label(b))),'发送按钮');if(button.disabled)throw new Error('发送按钮不可用');button.click();return;
 }
 if(action.kind==='stop'){
  const button=unique(buttons.filter(b=>/^(停止|停止生成|停止任务|Stop|Stop generating|Stop task)$/i.test(label(b))),'停止按钮');if(button.disabled)throw new Error('停止按钮不可用');button.click();return;
 }
 if(action.kind==='open'){
  if(s.busy||s.draft.trim()||s.approvals.length)throw new Error('桌面有任务、草稿或审批，不能切换');
  if(action.target===s.threadId)return;
  if(action.target==='codex:new'){
   if(s.mode!=='codex')throw new Error('请在桌面选择 Codex 模式');unique(buttons.filter(b=>/^(新聊天|New chat)$/i.test(label(b))),'新聊天按钮').click();return;
  }
  const target=s.threads.find(t=>t.id===action.target);if(!target)throw new Error('会话不在桌面已加载列表');
  const raw=action.target.slice(action.target.indexOf(':')+1);
  const rows=[...doc.querySelectorAll<HTMLElement>('[data-app-action-sidebar-thread-id]')].filter(e=>{const id=e.getAttribute('data-app-action-sidebar-thread-id');return (id===raw||id==='local:'+raw)&&(e.getAttribute('data-app-action-sidebar-thread-host-id')??'local')==='local';});
  unique(rows,'会话入口').click();return;
 }
 const a=s.approvals.find(a=>a.id===action.approvalId);if(!a)throw new Error('审批已失效');
 const option=a.options.find(o=>o.id===action.choice);if(!option)throw new Error('审批选项已失效');
 const area=unique([...doc.querySelectorAll('[data-approval-id]')].filter(e=>e.getAttribute('data-approval-id')===a.id),'审批区域');
 const button=unique([...area.querySelectorAll<HTMLButtonElement>('button')].filter(b=>!b.disabled&&label(b)===option.label),'审批选项');button.click();
}
