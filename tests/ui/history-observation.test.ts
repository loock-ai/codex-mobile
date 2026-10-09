import {it,expect} from 'vitest';
import {createHistoryObservation,observeHistoryEvent,mergeObservedHistory,isHistoryEvent,observingHistoryClient} from '../../src/app-server/history-observation';
it('活跃历史合并保留新消息和完成状态，不把旧缓存盖回快照',()=>{
 const obs=createHistoryObservation('thread');
 observeHistoryEvent(obs,{method:'item/agentMessage/delta',params:{threadId:'thread',turnId:'t',itemId:'a',delta:' new'}});
 observeHistoryEvent(obs,{method:'turn/completed',params:{threadId:'thread',turn:{id:'t',status:'completed'}}});
 const snapshot={id:'thread',turns:[{id:'t',status:'inProgress',items:[{id:'a',text:'hello'},{id:'b',text:'new snapshot'}]}]};
 const live={id:'thread',turns:[{id:'t',status:'completed',items:[{id:'a',text:'hello new'},{id:'b',text:'old cache'}]}]};
 const merged=mergeObservedHistory(snapshot,live,obs);expect(merged.turns[0].status).toBe('completed');expect(merged.turns[0].items.map((i:any)=>i.text)).toEqual(['hello new','new snapshot']);
 expect(isHistoryEvent('thread/tokenUsage/updated')).toBe(false);
});
it('只补放快照之后的增量，即使事件比RPC响应先送到Web，也不重复拼接',async()=>{
 const obs=createHistoryObservation('thread');
 observeHistoryEvent(obs,{sequence:4,method:'item/agentMessage/delta',params:{threadId:'thread',turnId:'t',itemId:'a',delta:'before'}});
 observeHistoryEvent(obs,{sequence:6,method:'item/agentMessage/delta',params:{threadId:'thread',turnId:'t',itemId:'a',delta:' after'}});
 observeHistoryEvent(obs,{sequence:7,method:'turn/diff/updated',params:{threadId:'thread',turnId:'t',diff:'new diff'}});
 const client=observingHistoryClient({request:async()=>({data:[{id:'a',type:'agentMessage',text:'before'}],__desktopSnapshotSequence:5})},obs);
 await client.request('thread/items/list',{threadId:'thread',turnId:'t'});
 obs.turns.set('t',3);
 const merged=mergeObservedHistory({id:'thread',turns:[{id:'t',status:'inProgress',items:[{id:'a',type:'agentMessage',text:'before'}]}]},{id:'thread',turns:[]},obs);
 expect(merged.turns[0].items[0].text).toBe('before after');expect(merged.turns[0].liveDiff).toBe('new diff');
});
it('快照缺少diff时保留已观察差异，item补放不能让终态重新运行',()=>{
 const obs=createHistoryObservation('thread');obs.turns.set('t',10);obs.items.set(JSON.stringify(['t','a']),5);
 observeHistoryEvent(obs,{sequence:6,method:'item/completed',params:{threadId:'thread',turnId:'t',item:{id:'a',type:'agentMessage',text:'done'}}});
 observeHistoryEvent(obs,{sequence:7,method:'turn/diff/updated',params:{threadId:'thread',turnId:'t',diff:'latest diff'}});
 const merged=mergeObservedHistory({id:'thread',turns:[{id:'t',status:'completed',items:[{id:'a',text:'old'}]}]},null,obs);
 expect(merged.turns[0].status).toBe('completed');expect(merged.turns[0].liveDiff).toBe('latest diff');expect(merged.turns[0].items[0].text).toBe('done');
});
