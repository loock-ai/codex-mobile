const {app,BrowserWindow,protocol}=require('electron');
app.setPath('userData',process.env.CDP_FIXTURE_PROFILE);
app.commandLine.appendSwitch('remote-debugging-port',process.env.CDP_FIXTURE_PORT);
app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const windows=[];
app.whenReady().then(()=>{
 protocol.handle('app',()=>new Response(`<!doctype html><html><head><meta charset="UTF-8"><title>CDP 受控验证</title><style>[data-message-author-role]{white-space:pre-wrap}</style></head><body><h1>测试会话</h1><div data-app-action-sidebar-thread-id="local:fixture" data-app-action-sidebar-thread-title="测试会话"></div><main id="messages"></main><textarea aria-label="输入消息"></textarea><button aria-label="发送" onclick="send()">发送</button><button id="stop" aria-label="停止" hidden onclick="this.hidden=true">停止</button><section id="approval" data-approval-id="fixture-approval" hidden><p>允许受控测试操作？</p><button onclick="document.getElementById('approval').hidden=true">允许一次</button><button onclick="document.getElementById('approval').hidden=true">拒绝</button></section><script>
 window.__codexRoot={_internalRoot:{current:{memoizedProps:{value:{location:{pathname:'/local/fixture'},navigationType:'POP'}},child:{memoizedProps:{location:{pathname:'/settings/cached'}}},sibling:null}}};
 let counter=0,dots=false;
 window.setDots=()=>{dots=true;document.getElementById('messages').replaceChildren();window.__codexRoot._internalRoot.current.memoizedProps.value.location.pathname='/o/fixture-dot';const a=document.getElementById('approval');a.hidden=true;a.removeAttribute('data-approval-id');a.__reactFiber$fixture={memoizedProps:{roomId:'fixture-room',request:{request_id:'dot-approval',thread_id:'dot-thread',turn_id:'dot-turn'}},return:null};};
 function message(role,text){const e=document.createElement(dots?'article':'div');e.setAttribute('data-message-id','m'+(++counter));let body=e;if(dots){e.className='message-row '+(role==='user'?'self':'assistant');body=document.createElement('div');body.className='message-text';e.append(body);}else e.setAttribute('data-message-author-role',role);body.textContent=text;document.getElementById('messages').append(e);return body;}
 function send(){const editor=document.querySelector('textarea'),text=editor.value;editor.value='';message('user',text);const answer=message('assistant','');document.getElementById('stop').hidden=false;setTimeout(()=>answer.textContent='受控',100);setTimeout(()=>{answer.textContent='受控回复完成';document.getElementById('stop').hidden=true;document.getElementById('approval').hidden=false},500);}
 </script></body></html>`,{headers:{'content-type':'text/html; charset=utf-8'}}));
 const window=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});window.loadURL('app://-/index.html');windows.push(window);
 const phone=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});phone.loadURL('about:blank');windows.push(phone);
});
