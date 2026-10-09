import type { DesktopSnapshot } from './protocol.js';
export function validateCdpUrl(address:string) {
 const u=new URL(address);
 if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))throw new Error('CDP 必须使用无凭据的本机 HTTP 地址');
 return u.origin;
}
/** 此函数会序列化到 renderer；不能引用模块外部变量。 */
export function parseDesktopDocument(doc:Document,loc:Location):DesktopSnapshot {
 const path=loc.hash.startsWith('#/')?loc.hash.slice(1):loc.pathname;
 if(/^\/(dots|o)\/(home|new|claim-email|approve)\/?$/i.test(path))throw new Error('当前页面不是 Dots 会话，请在桌面打开已有会话');
 const m=path.match(/^\/(local|threads|dots|o)\/([^/?#]+)\/?$/)??(path==='/'?['','local','new']:null);
 if(!m)throw new Error('当前页面不是可识别的 Codex 或 Dots 会话，请在桌面打开会话');
 if(path==='/'&&!doc.querySelector('[aria-label*=\"Codex\"]'))throw new Error('请先在桌面选择 Codex 模式');
 const mode=['dots','o'].includes(m[1])?'dots':'codex',threadId=mode+':'+decodeURIComponent(m[2]);
 const text=(e:Element)=>((e as HTMLElement).innerText??e.textContent??'').trim();
 const visible=(e:Element)=>{for(let node:Element|null=e;node;node=node.parentElement){const style=doc.defaultView?.getComputedStyle(node);if(node.hasAttribute('hidden')||node.hasAttribute('inert')||node.getAttribute('aria-hidden')==='true'||style?.display==='none'||style?.visibility==='hidden'||style?.visibility==='collapse')return false;}return true;};
 const editors=[...doc.querySelectorAll('[contenteditable="true"][role="textbox"],textarea,[data-thread-find-composer] [contenteditable="true"]')].filter(visible);
 if(editors.length>1)throw new Error('桌面输入框存在歧义，请关闭额外输入面板');
 const draft=editors[0]?((editors[0] as HTMLTextAreaElement).value??text(editors[0])):'';
 const messages=[...doc.querySelectorAll('[data-message-author-role][data-message-id]')].filter(visible).filter(e=>['user','assistant'].includes(e.getAttribute('data-message-author-role')??'')).map(e=>({id:e.getAttribute('data-message-id')!,role:e.getAttribute('data-message-author-role') as 'user'|'assistant',text:text(e)}));
 // 当前安装版把消息放在 React turn props 中；仅读取已渲染的 turn。
 const seen=new Set(messages.map(m=>m.id));
 // 安装版 Dots 的 messaging-room 使用 article.message-row，回执不属于消息正文。
 if(mode==='dots')for(const row of doc.querySelectorAll('article.message-row[data-message-id]')) {
  if(!visible(row))continue;const id=row.getAttribute('data-message-id')!;
  const role=row.classList.contains('self')?'user':row.classList.contains('assistant')?'assistant':null;
  const body=row.querySelector('.message-text');if(!role||!body||seen.has(id))continue;
  messages.push({id,role,text:text(body)});seen.add(id);
 }
 for(const element of doc.querySelectorAll('[data-turn-key]')) {
  const key=Object.keys(element).find(k=>k.startsWith('__reactFiber$'));
  let fiber=key?(element as any)[key]:null;
  for(let depth=0;fiber&&depth<30;depth++,fiber=fiber.return) {
   const turn=fiber.memoizedProps?.turn;
   if(!turn||!Array.isArray(turn.items))continue;
   for(const raw of turn.items) {
    const item=raw.item??raw,type=String(item.type??'');
    const role=['userMessage','user-message','user_message'].includes(type)?'user':['agentMessage','assistant-message','agent_message','assistant_message'].includes(type)?'assistant':null;
    if(!role||typeof item.id!=='string'||seen.has(item.id))continue;
    const body=typeof item.text==='string'?item.text:Array.isArray(item.content)?item.content.filter((x:any)=>x.type==='text'||x.type==='input_text'||x.type==='output_text').map((x:any)=>x.text??'').join('\n'):'';
    if(!body)continue;messages.push({id:item.id,role,text:body});seen.add(item.id);
   }
   break;
  }
 }
 // 每次重新识别组件请求；清理桥接生成的属性，避免 React 重用节点后残留过期身份。
 for(const area of doc.querySelectorAll('[data-cdp-generated-approval]')) {area.removeAttribute('data-approval-id');area.removeAttribute('data-cdp-generated-approval');}
 // 普通对话框不属于审批。仅为明确带 requestId/request 的渲染组件建立定位标识。
 for(const button of doc.querySelectorAll('button')) {
  if(!/^(允许|批准|拒绝|取消|allow|approve|accept|deny|decline|reject|cancel)/i.test(button.getAttribute('aria-label')||text(button)))continue;
  let area:Element|null=button.parentElement;
  for(let depth=0;area&&depth<6;depth++,area=area.parentElement) {
   const fiberKey=Object.keys(area).find(k=>k.startsWith('__reactFiber$'));let fiber=fiberKey?(area as any)[fiberKey]:null;
   for(let j=0;fiber&&j<8;j++,fiber=fiber.return) {
    const props=fiber.memoizedProps;
    const request=props?.request;
    const requestId=typeof props?.requestId==='string'&&request?props.requestId:mode==='dots'&&typeof props?.roomId==='string'&&typeof request?.request_id==='string'&&typeof request?.thread_id==='string'?'dots:'+JSON.stringify([props.roomId,request.thread_id,request.turn_id??null,request.request_id]):null;
    if(requestId&&area.querySelectorAll('button').length>=2) {area.setAttribute('data-approval-id',requestId);area.setAttribute('data-cdp-generated-approval','true');area=null;break;}
   }
   if(!area)break;
  }
 }
 const approvals=[...doc.querySelectorAll('[data-desktop-approval],[data-testid="approval-request"],[data-approval-id]')].filter(visible).map((e,index)=>{
  const options=[...e.querySelectorAll('button')].filter(b=>!b.disabled&&visible(b)).map((b,i)=>{const label=b.getAttribute('aria-label')||text(b);const decision=/^(拒绝|不允许|deny|decline|reject)(\b|$)/i.test(label)?'decline' as const:/^(允许一次|允许|批准|allow once|allow|approve|accept)(\b|$)/i.test(label)?'accept' as const:undefined;return {id:String(i),label,...decision?{decision}:{}};});
  return {id:e.getAttribute('data-approval-id')||'approval-'+index+'-'+text(e),text:text(e),options};
 }).filter(a=>a.options.length);
 const sidebarThreads=[...doc.querySelectorAll('[data-app-action-sidebar-thread-id]')].filter(visible).filter(e=>e.getAttribute('data-app-action-sidebar-thread-host-id')===null||e.getAttribute('data-app-action-sidebar-thread-host-id')==='local').map(e=>{const raw=e.getAttribute('data-app-action-sidebar-thread-id')!;const kind=e.getAttribute('data-app-action-sidebar-thread-kind');const mode=kind==='dot'?'dots' as const:'codex' as const;return {id:mode+':'+raw.replace(/^local:/,''),title:e.getAttribute('data-app-action-sidebar-thread-title')||text(e),mode};});
 const threads=[...sidebarThreads,...[...doc.querySelectorAll('a[href]')].filter(visible).flatMap(e=>{const href=e.getAttribute('href')??'',r=href.match(/^\/(local|threads|dots|o)\/([^/?#]+)\/?$/);return r&&!(['dots','o'].includes(r[1])&&['home','new','approve','claim-email'].includes(r[2].toLowerCase()))?[{id:(['dots','o'].includes(r[1])?'dots:':'codex:')+decodeURIComponent(r[2]),title:text(e),mode:['dots','o'].includes(r[1])?'dots' as const:'codex' as const}]:[];})];
 const busy=(mode==='dots'&&[...doc.querySelectorAll('.typing-indicator[data-visible="true"]')].some(visible))||[...doc.querySelectorAll('button')].filter(visible).some(b=>/^(停止|停止生成|停止任务|stop|stop generating|stop task)$/i.test(b.getAttribute('aria-label')||text(b)));
 return {threadId,title:doc.querySelector('[data-app-action-sidebar-thread-selected=\"true\"]')?.getAttribute('data-app-action-sidebar-thread-title')||text(doc.querySelector('h1')??doc.querySelector('h2')??doc.querySelector('title')??doc.body),mode,busy,draft,messages,approvals,threads:[...new Map(threads.map(t=>[t.id,t])).values()]};
}
