import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export function desktopProcessIds(output:string,executable:string){
 return output.split('\n').flatMap(line=>{
  const match=/^\s*(\d+)\s+(.+)$/.exec(line);
  if(!match||match[2].trim()!==executable)return [];
  const pid=Number(match[1]);return pid>1&&pid!==process.pid?[pid]:[];
 });
}
/** 只终止配置安装包的主进程，避免按名称匹配其他应用或服务。 */
export async function forceStopDesktop(executable:string){
 const read=async()=>desktopProcessIds((await exec('/bin/ps',['-axo','pid=,comm='],{timeout:3000})).stdout,executable);
 for(const pid of await read()){
  try{process.kill(pid,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
 }
 const end=Date.now()+10000;
 while((await read()).length){if(Date.now()>=end)throw new Error('ChatGPT 主进程尚未退出，请重试');await new Promise(resolve=>setTimeout(resolve,100));}
}
