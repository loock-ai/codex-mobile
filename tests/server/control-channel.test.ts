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
it('turn/steer保留远程主机和expectedTurnId，拒绝与未知投递区分',async()=>{
 const t=new Transport(),c=new DesktopControlChannel(t);await c.connect();
 const result=c.request('remote','turn/steer',{threadId:'t',expectedTurnId:'running',input:[{type:'text',text:'调整方向'}]});
 const rejected=expect(result).rejects.toMatchObject({code:'UPSTREAM_ERROR'});
 expect(t.messages[0]).toMatchObject({hostId:'remote',request:{method:'turn/steer',params:{expectedTurnId:'running'}}});
 t.emit({type:'mcp-response',hostId:'remote',message:{id:t.messages[0].request.id,error:{code:-1,message:'turn mismatch'}}});await rejected;
 await expect(c.request('remote','turn/steer',{threadId:'t',expectedTurnId:'running',input:[]},5)).rejects.toMatchObject({code:'ACTION_WRITE_UNKNOWN'});await c.close();
});
class QuestionTransport extends Transport {
 snapshots:any[]=[];answers:any[]=[];failure?:Error;
 async readUserQuestions(_targets:any[]){return this.snapshots;}
 async respondUserQuestion(hostId:string,request:any,result:unknown){if(this.failure)throw this.failure;this.answers.push({hostId,request,result});}
}
const question=(id:number,threadId='t')=>({id,method:'item/tool/requestUserInput',params:{threadId,questions:[{id:'q',question:'方向？',isBlocking:false}]}});
it('权威问题快照与wire按host及原始id合并，回答转交管理器',async()=>{
 const t=new QuestionTransport(),c=new DesktopControlChannel(t);await c.connect();const events:any[]=[];c.subscribe(e=>events.push(e));
 t.emit({type:'mcp-request',hostId:'local',request:question(7)});const original=c.pendingApprovals()[0].id;
 t.snapshots=[{hostId:'local',threadId:'t',requests:[question(7),{id:8,method:'item/fileChange/requestApproval',params:{threadId:'t'}}]},{hostId:'remote',threadId:'t',requests:[question(7)]}];
 await c.refreshUserQuestions([{hostId:'local',threadId:'t'},{hostId:'remote',threadId:'t'}]);
 expect(c.pendingApprovals()).toHaveLength(2);expect(c.pendingApprovals()[0].id).toBe(original);
 await c.respond(original!,{answers:{q:{answers:['继续']}}});expect(t.answers[0]).toMatchObject({hostId:'local',request:{id:7}});expect(t.messages).toHaveLength(0);
 expect(c.status().capabilities).toMatchObject({steering:true,userInputSnapshot:true,approvalSnapshot:false});await c.close();
});
it('仅完整权威快照可移除问题，暂不可用不误取消，远端同id保留',async()=>{
 const t=new QuestionTransport(),c=new DesktopControlChannel(t);await c.connect();const events:any[]=[];c.subscribe(e=>events.push(e));
 const targets=[{hostId:'local',threadId:'t'},{hostId:'remote',threadId:'t'}];
 t.snapshots=targets.map(target=>({...target,requests:[question(1)]}));await c.refreshUserQuestions(targets);
 t.snapshots=[{hostId:'local',threadId:'t'}];await c.refreshUserQuestions(targets);expect(c.pendingApprovals()).toHaveLength(2);
 t.snapshots=[{hostId:'local',threadId:'t',requests:[]}];await c.refreshUserQuestions(targets);
 expect(c.pendingApprovals().map(a=>a.hostId)).toEqual(['remote']);expect(events.filter(e=>e.method==='desktop/approval/resolved')).toHaveLength(1);await c.close();
});
it('取消目标后异步旧快照不能复活问题且不重叠读取',async()=>{
 const t=new QuestionTransport(),c=new DesktopControlChannel(t);await c.connect();let finish!:(x:any[])=>void,reads=0;
 t.readUserQuestions=async()=>{reads++;return new Promise(resolve=>{finish=resolve;});};
 const first=c.refreshUserQuestions([{hostId:'local',threadId:'t'}]);
 const empty=c.refreshUserQuestions([]);finish([{hostId:'local',threadId:'t',requests:[question(1)]}]);await Promise.all([first,empty]);
 expect(reads).toBe(1);expect(c.pendingApprovals()).toHaveLength(0);await c.close();
});
it('管理器明确未派发可手动重试，未知投递不可重发，过期请求清除',async()=>{
 const {ControlError}=await import('../../server/cdp/control-channel.js');
 const t=new QuestionTransport(),c=new DesktopControlChannel(t);await c.connect();t.snapshots=[{hostId:'local',threadId:'t',requests:[question(1),question(2),question(3)]}];await c.refreshUserQuestions([{hostId:'local',threadId:'t'}]);
 const [a,b,d]=c.pendingApprovals();t.failure=new ControlError('HOST_UNAVAILABLE','not sent');await expect(c.respond(a.id!,{answers:{}})).rejects.toMatchObject({code:'HOST_UNAVAILABLE'});expect(c.pendingApprovals().some(q=>q.id===a.id)).toBe(true);
 t.failure=undefined;await c.respond(a.id!,{answers:{}});expect(t.answers).toHaveLength(1);
 t.failure=new Error('network');await expect(c.respond(b.id!,{answers:{}})).rejects.toMatchObject({code:'ACTION_WRITE_UNKNOWN'});await expect(c.respond(b.id!,{answers:{}})).rejects.toMatchObject({code:'APPROVAL_EXPIRED'});
 t.failure=new ControlError('APPROVAL_EXPIRED','gone');await expect(c.respond(d.id!,{answers:{}})).rejects.toMatchObject({code:'APPROVAL_EXPIRED'});expect(c.pendingApprovals()).toHaveLength(0);await c.close();
});
it('快照读取期间到达的wire问题不会被旧空快照移除',async()=>{
 const t=new QuestionTransport(),c=new DesktopControlChannel(t);await c.connect();let finish!:(x:any[])=>void;
 t.readUserQuestions=async()=>new Promise(resolve=>{finish=resolve;});const refresh=c.refreshUserQuestions([{hostId:'local',threadId:'t'}]);
 t.emit({type:'mcp-request',hostId:'local',request:question(9)});finish([{hostId:'local',threadId:'t',requests:[]}]);await refresh;
 expect(c.pendingApprovals()).toHaveLength(1);await c.close();
});
it('已由桌面解决的问题不会被读取中的旧快照复活',async()=>{
 const t=new QuestionTransport(),c=new DesktopControlChannel(t);await c.connect();let finish!:(x:any[])=>void;
 t.readUserQuestions=async()=>new Promise(resolve=>{finish=resolve;});const refresh=c.refreshUserQuestions([{hostId:'local',threadId:'t'}]);
 t.emit({type:'mcp-notification',hostId:'local',method:'serverRequest/resolved',params:{requestId:9,threadId:'t'}});
 finish([{hostId:'local',threadId:'t',requests:[question(9)]}]);await refresh;
 expect(c.pendingApprovals()).toHaveLength(0);await c.close();
});
it('同一原生问题内容变化时撤销旧审批并发布新ID，旧答案不可提交',async()=>{
 const t=new QuestionTransport(),c=new DesktopControlChannel(t);await c.connect();const events:any[]=[];c.subscribe(e=>events.push(e));const targets=[{hostId:'local',threadId:'t'}];
 t.snapshots=[{...targets[0],requests:[question(1)]}];await c.refreshUserQuestions(targets);const old=c.pendingApprovals()[0];
 const changed=question(1);changed.params.questions[0].question='新方向？';t.snapshots=[{...targets[0],requests:[changed]}];await c.refreshUserQuestions(targets);
 const next=c.pendingApprovals()[0];expect(next.id).not.toBe(old.id);expect(next.params.questions[0].question).toBe('新方向？');expect(events.slice(-2).map(e=>e.method)).toEqual(['desktop/approval/resolved','item/tool/requestUserInput']);
 await expect(c.respond(old.id!,{answers:{}})).rejects.toMatchObject({code:'APPROVAL_EXPIRED'});expect(t.answers).toHaveLength(0);await c.close();
});
it('同主机不同会话相同原生id独立合并与撤销',async()=>{
 const t=new QuestionTransport(),c=new DesktopControlChannel(t);await c.connect();const targets=[{hostId:'local',threadId:'a'},{hostId:'local',threadId:'b'}];
 for(const target of targets)t.emit({type:'mcp-request',hostId:'local',request:question(1,target.threadId)});
 expect(c.pendingApprovals()).toHaveLength(2);const ids=c.pendingApprovals().map(e=>e.id);
 t.snapshots=targets.map(target=>({...target,requests:[question(1,target.threadId)]}));await c.refreshUserQuestions(targets);expect(c.pendingApprovals().map(e=>e.id)).toEqual(ids);
 t.emit({type:'mcp-notification',hostId:'local',method:'serverRequest/resolved',params:{requestId:1,threadId:'a'}});
 expect(c.pendingApprovals()).toHaveLength(1);expect(c.pendingApprovals()[0].params.threadId).toBe('b');await c.respond(ids[1]!,{answers:{}});expect(t.answers[0].request.params.threadId).toBe('b');await c.close();
});
it('一个会话的resolved tombstone不屏蔽另一个会话的同id问题',async()=>{
 const t=new QuestionTransport(),c=new DesktopControlChannel(t);await c.connect();let finish!:(x:any[])=>void;t.readUserQuestions=async()=>new Promise(resolve=>{finish=resolve;});
 const targets=[{hostId:'local',threadId:'a'},{hostId:'local',threadId:'b'}],refresh=c.refreshUserQuestions(targets);
 t.emit({type:'mcp-notification',hostId:'local',method:'serverRequest/resolved',params:{requestId:1,threadId:'a'}});
 finish(targets.map(target=>({...target,requests:[question(1,target.threadId)]})));await refresh;
 expect(c.pendingApprovals().map(e=>e.params.threadId)).toEqual(['b']);await c.close();
});
