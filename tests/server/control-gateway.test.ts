// @vitest-environment node
import {it,expect} from 'vitest';
import {DesktopControlChannel,type ControlTransport} from '../../server/cdp/control-channel.js';
import {createControlGateway} from '../../server/cdp/control-gateway.js';
import {DesktopControlClient} from '../../server/cdp/control-client.js';
class Transport implements ControlTransport{
 listener:(m:any)=>void=()=>{};answers:any[]=[];
 async connect(){}async close(){}subscribe(l:(m:any)=>void){this.listener=l;return()=>{this.listener=()=>{}};}
 async send(m:any){if(m.type==='mcp-response'){this.answers.push(m);return;}setTimeout(()=>this.listener({type:'mcp-response',hostId:m.hostId,message:{id:m.request.id,result:m.request.method==='thread/start'?{thread:{id:'new-thread'}}:{data:['t']}}}),20);}
}
it('启动器收到客户端数量、待审批数量和断连状态，且可读取原始审批',async()=>{
 const transport=new Transport(),channel=new DesktopControlChannel(transport),states:any[]=[];
 const gateway=await createControlGateway({channel,host:'127.0.0.1',port:0,token:'fixture-token',onStatus:s=>states.push(s)});
 const client=new DesktopControlClient(`ws://127.0.0.1:${gateway.port}/ws?token=fixture-token`);
 try{
  expect(states.at(-1)).toMatchObject({clients:0,approvals:0,connected:true,error:''});
  expect(gateway.channel).toBe(channel);
  await client.connect();expect(states.at(-1)).toMatchObject({clients:1});
  const received:any[]=[];client.subscribe(e=>received.push(e));await client.request('desktop/subscribe',{threadIds:['a']});
  transport.listener({type:'mcp-request',hostId:'local',request:{id:1,method:'item/tool/requestUserInput',params:{threadId:'a',questions:[]}}});
  await expect.poll(()=>received.length).toBe(1);expect(states.at(-1)).toMatchObject({approvals:1});
  expect(gateway.channel.pendingApprovals()[0]).toMatchObject({method:'item/tool/requestUserInput'});
  await client.request('desktop/approval/respond',{approvalId:received[0].id,result:{answers:{}}});expect(states.at(-1)).toMatchObject({approvals:0});
  transport.listener({type:'mcp-request',hostId:'local',request:{id:2,method:'item/fileChange/requestApproval',params:{threadId:'a'}}});
  expect(states.at(-1)).toMatchObject({approvals:1});
  transport.listener({type:'control-lost',reason:'受控桌面已断开'});expect(states.at(-1)).toMatchObject({approvals:0,connected:false,error:'受控桌面已断开'});
  client.close();await expect.poll(()=>states.at(-1).clients).toBe(0);
 }finally{client.close();await gateway.close();}
});
it('切换订阅后原会话审批不再有回答权限',async()=>{
 const transport=new Transport(),channel=new DesktopControlChannel(transport),gateway=await createControlGateway({channel,host:'127.0.0.1',port:0,token:'fixture-token'});
 const client=new DesktopControlClient(`ws://127.0.0.1:${gateway.port}/ws?token=fixture-token`);
 try{await client.connect();transport.listener({type:'mcp-request',hostId:'local',request:{id:1,method:'item/fileChange/requestApproval',params:{threadId:'a'}}});
 const received:any[]=[];client.subscribe(e=>received.push(e));await client.request('desktop/subscribe',{threadIds:['a']});
 for(let i=0;i<20&&!received.length;i++)await new Promise(r=>setTimeout(r,5));
 await client.request('desktop/subscribe',{threadIds:['b']});
 await expect(client.request('desktop/approval/respond',{approvalId:received[0].id,result:{decision:'decline'}})).rejects.toMatchObject({code:'APPROVAL_EXPIRED'});
 expect(transport.answers).toHaveLength(0);
 }finally{client.close();await gateway.close();}
});
it('SDK 旧 socket 的迟到关闭事件不影响新连接请求',async()=>{
 const transport=new Transport(),gateway=await createControlGateway({channel:new DesktopControlChannel(transport),host:'127.0.0.1',port:0,token:'fixture-token'});
 const client=new DesktopControlClient(`ws://127.0.0.1:${gateway.port}/ws?token=fixture-token`);
 try{await client.connect();const old=(client as any).socket;client.close();await client.connect();const result=client.request('thread/list',{});old.emit('close');expect(await result).toEqual({data:['t']});}
 finally{client.close();await gateway.close();}
});
it('取消订阅后不再收到没有 threadId 的目录事件',async()=>{
 const transport=new Transport(),gateway=await createControlGateway({channel:new DesktopControlChannel(transport),host:'127.0.0.1',port:0,token:'fixture-token'});
 const client=new DesktopControlClient(`ws://127.0.0.1:${gateway.port}/ws?token=fixture-token`),events:any[]=[];
 try{await client.connect();client.subscribe(e=>events.push(e));await client.request('desktop/subscribe',{threadIds:[]});await client.request('desktop/unsubscribe',{});transport.listener({type:'mcp-notification',hostId:'local',method:'project/changed',params:{projectId:'p'}});await new Promise(r=>setTimeout(r,20));expect(events).toHaveLength(0);}
 finally{client.close();await gateway.close();}
});
it('创建请求的迟到结果不会恢复已取消的订阅',async()=>{
 const transport=new Transport(),gateway=await createControlGateway({channel:new DesktopControlChannel(transport),host:'127.0.0.1',port:0,token:'fixture-token'});
 const client=new DesktopControlClient(`ws://127.0.0.1:${gateway.port}/ws?token=fixture-token`),events:any[]=[];
 try{await client.connect();client.subscribe(e=>events.push(e));const started=client.request('thread/start',{});await client.request('desktop/unsubscribe',{});await started;transport.listener({type:'mcp-notification',hostId:'local',method:'item/agentMessage/delta',params:{threadId:'new-thread',delta:'must not deliver'}});await new Promise(r=>setTimeout(r,20));expect(events).toHaveLength(0);}
 finally{client.close();await gateway.close();}
});
it('后台发送不能改变客户端明确选择的会话订阅',async()=>{
 const transport=new Transport(),gateway=await createControlGateway({channel:new DesktopControlChannel(transport),host:'127.0.0.1',port:0,token:'fixture-token'});
 const client=new DesktopControlClient(`ws://127.0.0.1:${gateway.port}/ws?token=fixture-token`),events:any[]=[];
 try{await client.connect();client.subscribe(e=>events.push(e));await client.request('desktop/subscribe',{threadIds:['b']});await client.request('turn/start',{threadId:'a',input:[{type:'text',text:'background'}]});transport.listener({type:'mcp-notification',hostId:'local',method:'item/agentMessage/delta',params:{threadId:'a',delta:'must not deliver'}});await new Promise(r=>setTimeout(r,20));expect(events).toHaveLength(0);}
 finally{client.close();await gateway.close();}
});
