import {execFile} from 'node:child_process';
import {hostname,platform} from 'node:os';
import {promisify} from 'node:util';

export async function readComputerName():Promise<string> {
 if(platform()==='darwin') {
  try {
   const {stdout}=await promisify(execFile)('/usr/sbin/scutil',['--get','ComputerName'],{timeout:1500,maxBuffer:4096});
   if(stdout.trim())return stdout.trim();
  }catch{/* 系统没有友好名称时，使用网络主机名。 */}
 }
 return hostname();
}
