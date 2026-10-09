import {DesktopControlClient} from '../npm-dist/server/cdp/control-client.js';

const base=process.env.DESKTOP_CONTROL_URL||'ws://127.0.0.1:19878/ws';
const url=new URL(base);
if(!process.env.CODEX_MOBILE_TOKEN)throw new Error('请设置 CODEX_MOBILE_TOKEN');
url.searchParams.set('token',process.env.CODEX_MOBILE_TOKEN);
const client=new DesktopControlClient(url.href);
try{
 console.log('通道',await client.connect(process.env.DESKTOP_CONTROL_HOST_ID||'local'));
 const projects=await client.request('project/list',{limit:100});
 console.log('项目第一页',JSON.stringify(projects,null,2));
 const threads=await client.request('thread/list',{limit:20,archived:false,sortKey:'recency_at',useStateDbOnly:true});
 console.log('会话第一页',JSON.stringify(threads,null,2));
 // 默认只读；只有明确传入 --thread ID --send TEXT 时才发送。
 const args=process.argv.slice(2),threadIndex=args.indexOf('--thread'),sendIndex=args.indexOf('--send');
 if(sendIndex>=0){
  const threadId=threadIndex>=0?args[threadIndex+1]:null,text=args[sendIndex+1];if(!threadId||!text)throw new Error('发送需要 --thread ID --send TEXT');
  console.log('会话',await client.request('thread/read',{threadId,includeTurns:false}));
  console.log('历史回合第一页',await client.request('thread/turns/list',{threadId,limit:5,itemsView:'summary',sortDirection:'desc'}));
  await client.request('desktop/subscribe',{threadIds:[threadId]});
  let timer,expectedTurnId,finish;const completedTurns=new Set();
  const completed=new Promise((resolve,reject)=>{finish=resolve;timer=setTimeout(()=>reject(new Error('等待完成超时；不会重发，请回读会话')),120000);client.subscribe(event=>{console.log('事件',JSON.stringify(event));if(event.hostId===(process.env.DESKTOP_CONTROL_HOST_ID||'local')&&event.params?.threadId===threadId&&event.method==='turn/completed'){completedTurns.add(event.params.turn.id);if(expectedTurnId===event.params.turn.id)resolve();}});});
  // 先挂接失败处理，避免发送失败后留下未处理的超时 Promise。
  completed.catch(()=>{});
  try{const submitted=await client.request('turn/start',{threadId,input:[{type:'text',text}]});console.log('提交',submitted);expectedTurnId=submitted.turn?.id;if(!expectedTurnId)throw new Error('发送结果缺少 turn id，不能关联完成事件');if(completedTurns.has(expectedTurnId)||submitted.turn.status==='completed')finish();await completed;}finally{clearTimeout(timer);}
 }
}finally{client.close();}
