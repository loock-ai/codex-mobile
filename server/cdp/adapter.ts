import { chromium,type Browser,type Page } from 'playwright-core';
import { parseDesktopDocument,validateCdpUrl } from './dom.js';
import {applyDesktopAction,type DesktopAction} from './actions.js';
import type {DesktopAdapter,DesktopSnapshot} from './protocol.js';
/** Electron MemoryRouter 的只读路由投影，不调用 React 内部动作。 */
export function desktopRoute() {
 const current=(window as any).__codexRoot?._internalRoot?.current;
 if(!current)throw new Error('桌面页面尚未初始化，请等待 ChatGPT 加载完成后打开会话');
 const queue=[{fiber:current,depth:0}],paths=new Set<string>(),routers:{path:string;depth:number}[]=[];
 for(let i=0;i<queue.length&&i<30000;i++) {
  const {fiber:f,depth}=queue[i];if(!f)continue;
  const props=f.memoizedProps,value=props?.value;
  // React Router 的 LocationContext.Provider 是页面身份来源；普通组件的 location 可指向缓存或嵌入页。
  if(['POP','PUSH','REPLACE'].includes(value?.navigationType)&&typeof value?.location?.pathname==='string')routers.push({path:value.location.pathname,depth});
  for(const location of [props?.location,value?.location])if(typeof location?.pathname==='string')paths.add(location.pathname);
  if(f.child)queue.push({fiber:f.child,depth:depth+1});
  if(f.sibling)queue.push({fiber:f.sibling,depth});
 }
 if(routers.length) {
  const depth=Math.min(...routers.map(r=>r.depth)),active=new Set(routers.filter(r=>r.depth===depth).map(r=>r.path));
  if(active.size===1)return [...active][0];
  throw new Error('桌面有多个同层 Router，无法确认当前会话：'+[...active].slice(0,4).join('、'));
 }
 // 兼容只有一个路由属性的旧版/受控页面；含糊时仍然拒绝写入。
 if(paths.size===1)return [...paths][0];
 if(!paths.size)throw new Error('桌面路由尚未就绪，请在 ChatGPT 中打开 Codex 或 Your dot 会话');
 throw new Error('桌面路由存在多个候选，当前版本需要进一步适配：'+[...paths].slice(0,4).join('、'));
}
export class CdpDesktopAdapter implements DesktopAdapter {
 private browser:Browser|null=null;
 constructor(private endpoint:string){validateCdpUrl(endpoint);}
 async connect(){if(!this.browser?.isConnected())this.browser=await chromium.connectOverCDP(validateCdpUrl(this.endpoint),{timeout:5000});}
 private async page():Promise<Page>{await this.connect();const pages=this.browser!.contexts().flatMap(c=>c.pages()).filter(p=>/^app:\/\/-\/index\.html(?:\?|$)/.test(p.url())&&!p.url().includes('initialRoute='));if(pages.length!==1)throw new Error('无法唯一识别 ChatGPT 主窗口，请保留一个主窗口');return pages[0];}
 private snapshotPage(p:Page):Promise<DesktopSnapshot>{return p.evaluate(`(${parseDesktopDocument.toString()})(document,{pathname:(${desktopRoute.toString()})(),hash:''})`);}
 async snapshot(){return this.snapshotPage(await this.page());}
 private action(p:Page,action:DesktopAction){return p.evaluate(`(()=>{const parseDesktopDocument=${parseDesktopDocument.toString()};return (${applyDesktopAction.toString()})(document,{pathname:(${desktopRoute.toString()})(),hash:''},${JSON.stringify(action)},parseDesktopDocument);})()`);}
 async open(id:string){const p=await this.page();const current=await this.snapshotPage(p);if(current.threadId===id)return;await this.action(p,{kind:'open',threadId:current.threadId,target:id});const end=Date.now()+5000;while(Date.now()<end){if((await this.snapshotPage(p)).threadId===id)return;await new Promise(r=>setTimeout(r,100));}throw new Error('桌面未打开目标会话');}
 async send(id:string,text:string){
  const p=await this.page();await this.action(p,{kind:'write',threadId:id,text});await this.action(p,{kind:'submit',threadId:id,text});
  const deadline=Date.now()+5000;while(Date.now()<deadline){const s=await this.snapshotPage(p);if((s.threadId===id||(id==='codex:new'&&s.mode==='codex'))&&s.draft===''&&(s.busy||s.messages.some(m=>m.role==='user'&&m.text===text)))return;await new Promise(r=>setTimeout(r,150));}
  throw new Error('发送已提交但结果未确认，请在桌面核对；不会自动重发');
 }
 async stop(id:string){const p=await this.page();await this.action(p,{kind:'stop',threadId:id});}
 async approve(id:string,choice:string){const p=await this.page();const s=await this.snapshotPage(p);await this.action(p,{kind:'approve',threadId:s.threadId,approvalId:id,choice});}
 async close(){await this.browser?.close();this.browser=null;}
}
