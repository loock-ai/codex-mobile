import {randomUUID} from 'node:crypto';
import {chromium,type Browser,type Page} from 'playwright-core';
import {validateCdpUrl} from './dom.js';
import type {ControlTransport} from './control-channel.js';

export function readDesktopHosts(){
 const bridge=(window as any).electronBridge;
 if(typeof bridge?.getSharedObjectSnapshotValue!=='function')throw new Error('当前桌面不提供远程主机状态');
 const hosts=[{hostId:'local',displayName:'本机'}],seen=new Set(['local']);
 for(const key of ['remote_ssh_connections','remote_control_connections','remote_wsl_connections']){
  const entries=bridge.getSharedObjectSnapshotValue(key);
  if(!Array.isArray(entries))continue;
  for(const entry of entries){if(typeof entry?.hostId!=='string'||!entry.hostId||entry.autoConnect===false||seen.has(entry.hostId))continue;seen.add(entry.hostId);hosts.push({hostId:entry.hostId,displayName:typeof entry.displayName==='string'?entry.displayName:entry.hostId});}
 }
 return hosts;
}

/** 安装旁路监听器，不改变原 renderer 的消费/ACK 路径。 */
export function installControlListener(key:string){
 const w=window as any;
 if(typeof w.electronBridge?.sendMessageFromView!=='function')throw new Error('桌面未暴露 electronBridge.sendMessageFromView');
 if(w[key])throw new Error('监听器已存在');
 const state={queue:[] as any[],requests:new Map<string,number>(),lost:false,listener:(event:MessageEvent)=>{},dispose:()=>{}};
 let transfer:any=null;
 const decode=(message:any)=>{
  if(typeof message.transferId!=='string'||!Number.isSafeInteger(message.sequence))throw new Error('无效分块身份');
  if(message.kind==='start'){transfer={id:message.transferId,next:message.sequence+1,stack:[] as any[],hasRoot:false,root:undefined,strings:null,target:null,bytes:0,tokens:0,drop:false};return null;}
  const t=transfer;if(!t||t.id!==message.transferId||t.next!==message.sequence)throw new Error('分块序号缺失');t.next++;
  if(t.drop){if(message.kind==='end')transfer=null;return null;}
  const setKey=(key:string)=>{const parent=t.stack.at(-1);if(!parent||parent.array||parent.key!==null)throw new Error('无效分块键');parent.key=key;};
  const save=(value:any)=>{const parent=t.stack.at(-1);if(!parent){if(t.hasRoot)throw new Error('重复根值');t.root=value;t.hasRoot=true;}else if(parent.array)parent.value.push(value);else{if(parent.key===null)throw new Error('缺少分块键');Object.defineProperty(parent.value,parent.key,{value,enumerable:true,writable:true,configurable:true});parent.key=null;}};
  if(message.kind==='end'){if(!t.hasRoot||t.stack.length||t.strings!==null)throw new Error('分块消息未完成');transfer=null;return t.root;}
  if(message.kind!=='chunk'||!Array.isArray(message.tokens))throw new Error('无效分块类型');
  for(const token of message.tokens){
   const root=t.root;
   if(root?.type&&!['mcp-response','mcp-notification','mcp-request'].includes(root.type)||root?.type==='mcp-response'&&root.message?.id!==undefined&&!state.requests.has(String(root.message.id))){t.drop=true;t.root=null;t.stack=[];t.strings=null;break;}
   if(!token||typeof token!=='object')throw new Error('无效分块 token');
   t.bytes+=typeof token.value==='string'?token.value.length*2:32;
   if(++t.tokens>1000000||t.stack.length>128||t.bytes>64*1024*1024){
    if(root?.type==='mcp-response'&&root.message?.id!==undefined){state.queue.push({type:'mcp-response',hostId:root.hostId,message:{id:root.message.id,error:{code:'RESPONSE_TOO_LARGE',message:'响应过大，请减小历史分页'}}});state.requests.delete(String(root.message.id));t.drop=true;t.root=null;t.stack=[];t.strings=null;break;}
    throw new Error('分块消息超过资源限制');
   }
   switch(token.type){
    case 'array-start':case 'object-start':{const array=token.type==='array-start',value=array?[]:{};save(value);t.stack.push({array,value,key:null});break;}
    case 'container-end':{const top=t.stack.pop();if(!top||top.key!==null)throw new Error('无效容器结束');break;}
    case 'key':if(typeof token.value!=='string')throw new Error('无效键');setKey(token.value);break;
    case 'value':if(token.value!==undefined&&token.value!==null&&!['string','number','boolean'].includes(typeof token.value))throw new Error('无效值');save(token.value);break;
    case 'string-start':if(t.strings!==null||!['key','value'].includes(token.target))throw new Error('无效字符串开始');t.strings=[];t.target=token.target;break;
    case 'string-chunk':if(t.strings===null||typeof token.value!=='string')throw new Error('无效字符串片段');t.strings.push(token.value);break;
    case 'string-end':if(t.strings===null)throw new Error('无效字符串结束');if(t.target==='key')setKey(t.strings.join(''));else save(t.strings.join(''));t.strings=null;t.target=null;break;
    default:throw new Error('未知分块 token');
   }
  }
  return null;
 };
 state.listener=(event:MessageEvent)=>{
  if(state.lost)return;
  let m=event.data;if(!m||typeof m!=='object')return;
  if(m.marker==='codex-host-chunked-message-v1'){
   try{m=decode(m);if(!m)return;}catch(error){state.lost=true;transfer=null;state.queue=[{type:'control-lost',reason:`分块消息不可恢复：${String(error)}`}];return;}
  }
  if(!['mcp-response','mcp-notification','mcp-request'].includes(m.type))return;
  if(m.type==='mcp-response'){if(!state.requests.has(String(m.message?.id)))return;state.requests.delete(String(m.message.id));}
  if(state.queue.length>=1000){state.lost=true;state.queue=[{type:'control-lost',reason:'事件队列溢出，需要重新取快照'}];return;}
  state.queue.push(m);
 };
 state.dispose=()=>{transfer=null;window.removeEventListener('message',state.listener);delete w[key];};
 window.addEventListener('message',state.listener);w[key]=state;
 return {bridge:true,appVersion:w.electronBridge.getAppVersion?.()??null};
}
export class CdpControlTransport implements ControlTransport {
 private browser:Browser|null=null;private page:Page|null=null;private key=`__desktopControl_${randomUUID().replaceAll('-','')}`;
 private listeners=new Set<(message:any)=>void>();private timer?:ReturnType<typeof setInterval>;private draining:Promise<void>|null=null;private stopped=false;
 constructor(private endpoint:string){validateCdpUrl(endpoint);}
 subscribe(listener:(message:any)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private deliver(m:any){for(const listener of this.listeners)listener(m);}
 async connect(){
  this.browser=await chromium.connectOverCDP(validateCdpUrl(this.endpoint),{timeout:5000});
  try{
   const pages=this.browser.contexts().flatMap(c=>c.pages()).filter(p=>/^app:\/\/-\/index\.html(?:\?|$)/.test(p.url())&&!p.url().includes('initialRoute='));
   if(pages.length!==1)throw new Error('无法唯一识别桌面主窗口');
   this.page=pages[0];await this.page.evaluate(installControlListener,this.key);
   const lost=()=>this.lose('桌面页面重载或窗口关闭');this.page.on('close',lost);this.page.on('framenavigated',frame=>{if(frame===this.page?.mainFrame())lost();});
   this.browser.on('disconnected',()=>this.lose('CDP 连接中断'));
   this.timer=setInterval(()=>{if(!this.draining&&!this.stopped){this.draining=this.drain().finally(()=>{this.draining=null;});}},50);this.timer.unref();
  }catch(e){await this.browser.close();this.browser=null;throw e;}
 }
 private lose(reason:string){if(this.stopped)return;this.stopped=true;clearInterval(this.timer);this.deliver({type:'control-lost',reason});}
 private async drain(){try{const messages=await this.page!.evaluate(key=>{const state=(window as any)[key];if(!state)throw new Error('监听器已丢失');return state.queue.splice(0);},this.key);for(const m of messages){if(m.type==='control-lost'){this.lose(m.reason);break;}this.deliver(m);}}catch(error){this.lose(String(error));}}
 async send(message:unknown){if(this.stopped||!this.page)throw new Error('桌面传输未连接');await this.page.evaluate(async({key,message})=>{const w=window as any,state=w[key],m=message as any;if(!state||state.lost)throw new Error('监听器不可用');if(m.type==='mcp-request'){for(const [id,expires]of state.requests)if(expires<Date.now())state.requests.delete(id);if(state.requests.size>=2048)throw new Error('等待中的请求过多');state.requests.set(String(m.request.id),Date.now()+120000);}await w.electronBridge.sendMessageFromView(message);},{key:this.key,message});}
 async readHosts(){if(this.stopped||!this.page)throw new Error('桌面传输未连接');return this.page.evaluate(readDesktopHosts);}
 async close(){this.stopped=true;clearInterval(this.timer);await this.draining;if(this.page&&!this.page.isClosed())await this.page.evaluate(key=>(window as any)[key]?.dispose(),this.key).catch(()=>{});await this.browser?.close();this.page=null;this.browser=null;this.listeners.clear();}
}
