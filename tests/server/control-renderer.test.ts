// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {installControlListener} from '../../server/cdp/control-transport.js';
it('附加监听保留原界面消费者，清理后不再收集事件',()=>{
 (window as any).electronBridge={sendMessageFromView:async()=>{},getAppVersion:()=> 'fixture'};
 let consumed=0;const consumer=()=>{consumed++};window.addEventListener('message',consumer);
 installControlListener('__testControl');
 window.dispatchEvent(new MessageEvent('message',{data:{type:'mcp-notification',hostId:'local',method:'turn/completed',params:{threadId:'t'}}}));
 expect(consumed).toBe(1);expect((window as any).__testControl.queue).toHaveLength(1);
 (window as any).__testControl.dispose();expect((window as any).__testControl).toBeUndefined();window.removeEventListener('message',consumer);
});
it('重组分块消息但不重复 ACK，也不拦截原始桌面消费者',()=>{
 let acked=false;(window as any).electronBridge={sendMessageFromView:async()=>{},acknowledgeChunkedMessage:()=>{acked=true}};
 installControlListener('__testChunk');const chunk=(kind:string,sequence:number,tokens?:unknown[])=>window.dispatchEvent(new MessageEvent('message',{data:{marker:'codex-host-chunked-message-v1',kind,transferId:'x',sequence,tokens}}));
 chunk('start',0);chunk('chunk',1,[{type:'object-start'},{type:'key',value:'type'},{type:'value',value:'mcp-notification'},{type:'key',value:'hostId'},{type:'value',value:'local'},{type:'key',value:'method'},{type:'string-start',target:'value'},{type:'string-chunk',value:'turn/'},{type:'string-chunk',value:'completed'},{type:'string-end'},{type:'container-end'}]);chunk('end',2);
 expect((window as any).__testChunk.lost).toBe(false);expect((window as any).__testChunk.queue[0].method).toBe('turn/completed');expect(acked).toBe(false);(window as any).__testChunk.dispose();
});
it('分块序号缺失时停止通道而不输出残缺事件',()=>{
 (window as any).electronBridge={sendMessageFromView:async()=>{}};installControlListener('__testGap');
 for(const m of [{kind:'start',sequence:0},{kind:'end',sequence:2}])window.dispatchEvent(new MessageEvent('message',{data:{marker:'codex-host-chunked-message-v1',transferId:'x',...m}}));
 expect((window as any).__testGap.lost).toBe(true);expect((window as any).__testGap.queue[0].type).toBe('control-lost');(window as any).__testGap.dispose();
});
it('桌面自己的大响应不应撑爆手机通道',()=>{
 (window as any).electronBridge={sendMessageFromView:async()=>{}};installControlListener('__foreign');
 const send=(kind:string,sequence:number,tokens?:any[])=>window.dispatchEvent(new MessageEvent('message',{data:{marker:'codex-host-chunked-message-v1',transferId:'x',kind,sequence,tokens}}));
 send('start',0);send('chunk',1,[{type:'object-start'},{type:'key',value:'type'},{type:'value',value:'mcp-response'},{type:'key',value:'message'},{type:'object-start'},{type:'key',value:'id'},{type:'value',value:'native-window-request'},{type:'key',value:'result'},{type:'value',value:'x'.repeat(9*1024*1024)},{type:'container-end'},{type:'container-end'}]);send('end',2);
 expect((window as any).__foreign.lost).toBe(false);expect((window as any).__foreign.queue).toEqual([]);(window as any).__foreign.dispose();
});
it('自身历史响应超过旧8MiB限制仍能重组，单次超限只使该请求失败',()=>{
 (window as any).electronBridge={sendMessageFromView:async()=>{}};installControlListener('__large');const state=(window as any).__large;
 const send=(id:string,size:number)=>{state.requests.set(id,Date.now()+120000);const dispatch=(kind:string,sequence:number,tokens?:any[])=>window.dispatchEvent(new MessageEvent('message',{data:{marker:'codex-host-chunked-message-v1',transferId:id,kind,sequence,tokens}}));dispatch('start',0);dispatch('chunk',1,[{type:'object-start'},{type:'key',value:'type'},{type:'value',value:'mcp-response'},{type:'key',value:'hostId'},{type:'value',value:'local'},{type:'key',value:'message'},{type:'object-start'},{type:'key',value:'id'},{type:'value',value:id},{type:'key',value:'result'},{type:'value',value:'x'.repeat(size)},{type:'container-end'},{type:'container-end'}]);dispatch('end',2);};
 send('ours',9*1024*1024);expect(state.queue[0].message.result.length).toBe(9*1024*1024);send('too-large',33*1024*1024);expect(state.queue[1].message.error.code).toBe('RESPONSE_TOO_LARGE');expect(state.lost).toBe(false);state.dispose();
});
