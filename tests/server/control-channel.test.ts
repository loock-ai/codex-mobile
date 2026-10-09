// @vitest-environment node
import {it,expect} from 'vitest';
import {DesktopControlChannel,type ControlTransport} from '../../server/cdp/control-channel.js';
class Transport implements ControlTransport {
 messages:any[]=[]; listener:(message:any)=>void=()=>{};
 async connect(){} async close(){} async send(message:any){this.messages.push(message);}
 subscribe(listener:(message:any)=>void){this.listener=listener;return()=>{this.listener=()=>{}};}
 emit(message:any){this.listener(message);}
}
it('只关联自己的请求结果，结构化通知保留身份，握手不重新 initialize 桌面',async()=>{
 const t=new Transport(),c=new DesktopControlChannel(t);await c.connect();const events:any[]=[];c.subscribe(e=>events.push(e));
 const a=c.request('local','project/list',{limit:100}),b=c.request('local','thread/list',{});
 await new Promise(r=>setTimeout(r,0));
 const [x,y]=t.messages;expect(x.request.id).not.toBe(y.request.id);
 t.emit({type:'mcp-response',hostId:'local',message:{id:'desktop-other',result:{bad:true}}});
 t.emit({type:'mcp-notification',hostId:'local',method:'item/agentMessage/delta',params:{threadId:'t',turnId:'turn',itemId:'item',delta:'中文'}});
 t.emit({type:'mcp-response',hostId:'local',message:{id:y.request.id,result:{data:['t']}}});
 t.emit({type:'mcp-response',hostId:'local',message:{id:x.request.id,result:{data:['p']}}});
 expect(await a).toEqual({data:['p']});expect(await b).toEqual({data:['t']});expect(events[0].params.delta).toBe('中文');
 expect(t.messages.every(m=>m.request.method!=='initialize')).toBe(true);await c.close();
});
it('服务器审批保留原 id，仅提交一次，桌面解决后拒绝回答',async()=>{
 const t=new Transport(),c=new DesktopControlChannel(t);await c.connect();
 t.emit({type:'mcp-request',hostId:'local',request:{id:7,method:'item/commandExecution/requestApproval',params:{threadId:'t',turnId:'turn'}}});
 const approval=c.pendingApprovals()[0];await c.respond(approval.id!,{decision:'accept'});
 expect(t.messages[0]).toMatchObject({type:'mcp-response',hostId:'local',threadId:'t',response:{id:7,result:{decision:'accept'}}});
 await expect(c.respond(approval.id!,{decision:'accept'})).rejects.toThrow('审批');
 t.emit({type:'mcp-request',hostId:'local',request:{id:8,method:'item/fileChange/requestApproval',params:{threadId:'t'}}});
 const stale=c.pendingApprovals().find(e=>e.method==='item/fileChange/requestApproval')!;
 t.emit({type:'mcp-notification',hostId:'local',method:'serverRequest/resolved',params:{threadId:'t',requestId:8}});
 await expect(c.respond(stale.id!,{decision:'accept'})).rejects.toThrow('审批');await c.close();
});
it('写入超时结果未知且不重发；断线拒绝等待中的请求',async()=>{
 const t=new Transport(),c=new DesktopControlChannel(t);await c.connect();
 await expect(c.request('local','turn/start',{threadId:'t',input:[{type:'text',text:'hello'}]},10)).rejects.toMatchObject({code:'ACTION_WRITE_UNKNOWN'});
 expect(t.messages).toHaveLength(1);
 const read=c.request('local','thread/list',{});const rejected=expect(read).rejects.toMatchObject({code:'CHANNEL_LOST'});
 t.emit({type:'control-lost',reason:'页面重载'});await rejected;await c.close();
});
it('丢失连接后要求新通道实例，不能报告假重连成功',async()=>{
 const transport=new Transport(),channel=new DesktopControlChannel(transport);await channel.connect();transport.emit({type:'control-lost',reason:'reload'});
 await expect(channel.connect()).rejects.toMatchObject({code:'CHANNEL_LOST'});expect(channel.status().connected).toBe(false);await channel.close();
});
it('审批 bridge 悬挂时断线立即结束调用且不重发',async()=>{
 const transport=new Transport(),channel=new DesktopControlChannel(transport);await channel.connect();
 transport.emit({type:'mcp-request',hostId:'local',request:{id:9,method:'item/fileChange/requestApproval',params:{threadId:'t'}}});
 transport.send=async()=>new Promise(()=>{});const attempt=channel.respond(channel.pendingApprovals()[0].id!,{decision:'decline'});
 const rejected=expect(attempt).rejects.toMatchObject({code:'ACTION_WRITE_UNKNOWN'});transport.emit({type:'control-lost',reason:'reload'});await rejected;await channel.close();
});
it('写入响应过大必须报告结果未知，不能提示重新发送',async()=>{
 const t=new Transport(),c=new DesktopControlChannel(t);await c.connect();const request=c.request('local','turn/start',{threadId:'t',input:[]});
 const rejected=expect(request).rejects.toMatchObject({code:'ACTION_WRITE_UNKNOWN'});
 t.emit({type:'mcp-response',hostId:'local',message:{id:t.messages[0].request.id,error:{code:'RESPONSE_TOO_LARGE',message:'too big'}}});await rejected;await c.close();
});
it('历史响应标记接收当时的事件顺序，而不受同批后续事件影响',async()=>{
 const t=new Transport(),c=new DesktopControlChannel(t);await c.connect();const result=c.request('local','thread/items/list',{threadId:'t'});
 t.emit({type:'mcp-notification',hostId:'local',method:'item/agentMessage/delta',params:{threadId:'t',delta:'before'}});
 t.emit({type:'mcp-response',hostId:'local',message:{id:t.messages[0].request.id,result:{data:[]}}});
 t.emit({type:'mcp-notification',hostId:'local',method:'item/agentMessage/delta',params:{threadId:'t',delta:'after'}});
 expect((await result).__desktopSnapshotSequence).toBe(1);expect(c.status().sequence).toBe(2);await c.close();
});
