// Literal browser scripts avoid SSR rewriting of dynamic import.
export const readUserQuestionsScript=String.raw`async ({contract,targets,timeoutMs})=>{
 const bridge=window.electronBridge;
 if((bridge?.getSentryInitOptions?.()?.appVersion??bridge?.getAppVersion?.())!==contract.version)return [];
 const module=await import(new URL(contract.module,location.href).href);
 const owners=module[contract.servicesExport]?.appServerManagers;
 if(!owners)return [];
 return (await Promise.all(targets.map(async target=>{
  let opened,pendingOpen,pendingState,state,timer,finished=false;
  const dispose=value=>{try{value?.[Symbol.dispose]?.();}catch{}};
  try{
   const read=(async()=>{
    pendingOpen=owners.open(target.hostId);opened=await pendingOpen;
    if(finished)return null;
    if(opened?.status!=='ready'||!opened.manager)return null;
    pendingState=opened.manager.getConversation(target.threadId);state=await pendingState;
    if(finished||!Array.isArray(state?.requests))return null;
    const requests=state.requests.filter(request=>request?.method==='item/tool/requestUserInput'&&['string','number'].includes(typeof request.id)&&request.params?.threadId===target.threadId&&Array.isArray(request.params?.questions));
    if(requests.length>32||JSON.stringify(requests).length>256*1024)return null;
    return {...target,requests};
   })().finally(()=>{if(finished){dispose(state);dispose(pendingState);dispose(opened);dispose(pendingOpen);}});
   return await Promise.race([read,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]);
  }catch{return null;}finally{finished=true;clearTimeout(timer);dispose(state);dispose(pendingState);dispose(opened);dispose(pendingOpen);}
 }))).filter(Boolean);
}`;

export const respondUserQuestionScript=String.raw`async ({contract,hostId,request,result,timeoutMs})=>{
 const bridge=window.electronBridge;
 if((bridge?.getSentryInitOptions?.()?.appVersion??bridge?.getAppVersion?.())!==contract.version)return {status:'unavailable'};
 let module;try{module=await import(new URL(contract.module,location.href).href);}catch{return {status:'unavailable'};}
 const owners=module[contract.servicesExport]?.appServerManagers;
 if(!owners)return {status:'unavailable'};
 let opened,pendingOpen,pendingState,state,timer,finished=false,dispatched=false;
 const dispose=value=>{try{value?.[Symbol.dispose]?.();}catch{}};
 try{
  const action=(async()=>{
   pendingOpen=owners.open(hostId);opened=await pendingOpen;
   if(finished)return {status:'unavailable'};
   if(opened?.status!=='ready'||!opened.manager)return {status:'unavailable'};
   const manager=opened.manager;
   pendingState=manager.getConversation(request.params.threadId);state=await pendingState;
   if(finished)return {status:'unavailable'};
   if(!Array.isArray(state?.requests))return {status:'unavailable'};
   const current=state.requests.find(q=>q.id===request.id&&q.method==='item/tool/requestUserInput'&&q.params?.threadId===request.params.threadId);
   if(!current||JSON.stringify(current.params.questions)!==JSON.stringify(request.params.questions))return {status:'expired'};
   if(typeof manager.replyWithUserInputResponse!=='function')return {status:'unavailable'};
   const answers=result?.answers;
   if(!answers||typeof answers!=='object'||Array.isArray(answers))return {status:'invalid'};
   for(const [id,value]of Object.entries(answers))if(!current.params.questions.some(q=>q.id===id)||!Array.isArray(value?.answers)||value.answers.length>16||value.answers.some(a=>typeof a!=='string'||a.length>16000))return {status:'invalid'};
   if(finished)return {status:'unavailable'};
   dispatched=true;
   await manager.replyWithUserInputResponse(request.params.threadId,request.id,result);
   return {status:'submitted'};
  })().finally(()=>{if(finished){dispose(state);dispose(pendingState);dispose(opened);dispose(pendingOpen);}});
  return await Promise.race([action,new Promise(resolve=>{timer=setTimeout(()=>resolve({status:dispatched?'unknown':'unavailable'}),timeoutMs);})]);
 }catch{return {status:dispatched?'unknown':'unavailable'};}finally{finished=true;clearTimeout(timer);dispose(state);dispose(pendingState);dispose(opened);dispose(pendingOpen);}
}`;
