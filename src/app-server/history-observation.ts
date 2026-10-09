import {applyTurnStarted,applyCompletedTurn,applyTurnItem,applyTurnDiff,applyFileChangePatch} from '../ui/conversation';
type RecordValue=Record<string,any>;
interface HistoryEvent {method?:string;params?:unknown;sequence?:number}
export interface HistoryObservation {threadId:string;events:HistoryEvent[];items:Map<string,number>;turns:Map<string,number>;baseSequence:number;counter:number}
const itemKey=(turnId:string,itemId:string)=>JSON.stringify([turnId,itemId]);
export const createHistoryObservation=(threadId:string):HistoryObservation=>({threadId,events:[],items:new Map(),turns:new Map(),baseSequence:0,counter:0});
export function isHistoryEvent(method:string){return method==='turn/started'||method==='turn/completed'||method==='turn/diff/updated'||method==='item/started'||method==='item/completed'||/^item\/.*(?:delta|Delta|patchUpdated)$/.test(method);}
export function observeHistoryEvent(observation:HistoryObservation|null,message:HistoryEvent){
 const p=(message.params??{}) as RecordValue;
 if(!observation||p.threadId!==observation.threadId||!isHistoryEvent(message.method??''))return;
 observation.events.push({...message,sequence:message.sequence??++observation.counter});
}
export function observingHistoryClient(client:{backend?:string;request(method:string,params:unknown,options?:{timeoutMs?:number}):Promise<any>},observation:HistoryObservation|null){
 return {backend:client.backend,request:async(method:string,params:unknown,options?:{timeoutMs?:number})=>{
  const result=await client.request(method,params,options),sequence=result?.__desktopSnapshotSequence;
  if(observation&&typeof sequence==='number'){
   if(method==='thread/turns/list'){observation.baseSequence=sequence;for(const turn of result.data??[])observation.turns.set(turn.id,sequence);}
   if(method==='thread/items/list'){const turnId=(params as RecordValue).turnId;for(const entry of result.data??[])observation.items.set(itemKey(turnId,(entry.item??entry).id),sequence);}
  }
  return result;
 }};
}
/** 从快照对应的原始接收顺序补放事件，避免队列批量交付把增量重复追加。 */
export function mergeObservedHistory(snapshot:RecordValue,live:RecordValue|null,observation:HistoryObservation|null):RecordValue{
 if(!observation||observation.threadId!==snapshot.id||live&&live.id!==snapshot.id)return snapshot;
 let result=structuredClone(snapshot);
 for(const event of observation.events){
  const p=(event.params??{}) as RecordValue,method=event.method??'',sequence=event.sequence??0,turnId=p.turnId??p.turn?.id,itemId=p.itemId??p.item?.id;
  const turnCut=observation.turns.get(turnId)??observation.baseSequence;
  const itemCut=(id:string)=>observation.items.get(itemKey(turnId,id))??turnCut;
  if(method==='turn/started'||method==='turn/completed'){
   if(sequence>turnCut){const turn={...p.turn,items:(p.turn.items??[]).filter((item:RecordValue)=>sequence>itemCut(item.id))};result=method==='turn/started'?applyTurnStarted(result,{...p,turn}):applyCompletedTurn(result,{...p,turn});}
   continue;
  }
  if(method==='turn/diff/updated'){const original=(snapshot.turns??[]).find((turn:RecordValue)=>turn.id===turnId);if(sequence>turnCut||!Object.prototype.hasOwnProperty.call(original??{},'liveDiff'))result=applyTurnDiff(result,p);continue;}
  if(!itemId||sequence<=itemCut(itemId))continue;
  if(method==='item/started'||method==='item/completed'){const previousStatus=result.turns?.find((turn:RecordValue)=>turn.id===turnId)?.status;result=applyTurnItem(result,p);if(['completed','failed','interrupted'].includes(previousStatus)){const turn=result.turns?.find((entry:RecordValue)=>entry.id===turnId);if(turn)turn.status=previousStatus;}continue;}
  if(method==='item/fileChange/patchUpdated'){result=applyFileChangePatch(result,p);continue;}
  if(typeof p.delta==='string'){
   let turn=result.turns?.find((entry:RecordValue)=>entry.id===turnId);
   if(!turn){result=applyTurnStarted(result,{threadId:snapshot.id,turn:{id:turnId,status:'inProgress',items:[]}});turn=result.turns.find((entry:RecordValue)=>entry.id===turnId);}
   let item=turn.items?.find((entry:RecordValue)=>entry.id===itemId);
   if(!item){item={id:itemId,type:method.includes('commandExecution')?'commandExecution':method.includes('fileChange')?'fileChange':method.includes('reasoning')?'reasoning':'agentMessage'};(turn.items??=[]).push(item);}
   const field=method.includes('commandExecution')||method.includes('fileChange')?'aggregatedOutput':'text';item[field]=`${item[field]??''}${p.delta}`;
  }
 }
 return result;
}
