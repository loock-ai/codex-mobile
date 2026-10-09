import {randomUUID} from 'node:crypto';
import {extname} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {DesktopControlChannel} from './control-channel.js';
export const MAX_DESKTOP_UPLOAD_BYTES=20*1024*1024;
export async function uploadToDesktop(request:IncomingMessage,response:ServerResponse,channel:DesktopControlChannel,hostId:string){
 const max=MAX_DESKTOP_UPLOAD_BYTES;
 const tooLarge=()=>{response.writeHead(413);response.end(JSON.stringify({error:'附件超过大小限制',maxBytes:max}));};
 if(Number(request.headers['content-length'])>max){tooLarge();request.resume();return;}
 const buffers:Buffer[]=[];let size=0;
 for await(const data of request){const part=Buffer.isBuffer(data)?data:Buffer.from(data);size+=part.length;if(size>max){tooLarge();return;}buffers.push(part);}
 if(!size){response.writeHead(400);response.end(JSON.stringify({error:'附件为空'}));return;}
 let name=String(request.headers['x-codex-file-name']??'attachment');try{name=decodeURIComponent(name);}catch{}
 name=name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,240)||'attachment';
 const suffix=extname(name).replace(/[^.a-zA-Z0-9]/g,'').slice(0,16),directory='/tmp/codex-mobile-uploads';
 const path=`${directory}/${randomUUID()}${suffix}`,type=String(request.headers['content-type']??'application/octet-stream').split(';')[0];
 await channel.request(hostId,'fs/createDirectory',{path:directory,recursive:true});
 await channel.request(hostId,'fs/writeFile',{path,dataBase64:Buffer.concat(buffers).toString('base64')});
 response.writeHead(201);response.end(JSON.stringify({path,name,type,size}));
}
