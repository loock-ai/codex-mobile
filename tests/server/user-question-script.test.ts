// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { respondUserQuestionScript } from '../../server/cdp/user-question-script.js';

const request={id:'q',method:'item/tool/requestUserInput',params:{threadId:'thread',questions:[{id:'format',question:'格式？'}]}};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function invoke(manager:unknown,timeoutMs=100,open?:()=>Promise<unknown>){
 const script=respondUserQuestionScript.replace('await import(new URL(contract.module,location.href).href)','fixtureModule');
 const execute=runInNewContext(`(${script})`,{window:{electronBridge:{getAppVersion:()=> 'fixture'}},fixtureModule:{services:{appServerManagers:{open:open??(async()=>({status:'ready',manager}))}}},setTimeout,clearTimeout});
 return execute({contract:{version:'fixture',servicesExport:'services'},hostId:'local',request,result:{answers:{format:{answers:['简短']}}},timeoutMs});
}
describe('原生问题回答的提交边界',()=>{
 it('匹配当前问题后只提交一次',async()=>{let writes=0;expect(await invoke({getConversation:()=>({requests:[request]}),replyWithUserInputResponse:()=>{writes++;}})).toMatchObject({status:'submitted'});expect(writes).toBe(1);});
 it('问题内容变化不提交旧答案',async()=>{let writes=0;expect(await invoke({getConversation:()=>({requests:[{...request,params:{...request.params,questions:[{id:'format',question:'更改后的问题'}]}}]}),replyWithUserInputResponse:()=>{writes++;}})).toMatchObject({status:'expired'});expect(writes).toBe(0);});
 it('主机连接超时后到达也不能提交',async()=>{let reads=0,writes=0;const manager={getConversation:()=>{reads++;return {requests:[request]};},replyWithUserInputResponse:()=>{writes++;}};expect(await invoke(manager,5,async()=>{await delay(40);return {status:'ready',manager};})).toMatchObject({status:'unavailable'});await delay(60);expect({reads,writes}).toEqual({reads:0,writes:0});});
 it('会话读取超时后到达也不能提交',async()=>{let writes=0;expect(await invoke({getConversation:async()=>{await delay(40);return {requests:[request]};},replyWithUserInputResponse:()=>{writes++;}},5)).toMatchObject({status:'unavailable'});await delay(60);expect(writes).toBe(0);});
 it('提交后等待超时返回未知而不是可重试失败',async()=>{let writes=0;expect(await invoke({getConversation:()=>({requests:[request]}),replyWithUserInputResponse:async()=>{writes++;await delay(40);}},5)).toMatchObject({status:'unknown'});await delay(60);expect(writes).toBe(1);});
});
