import type {DesktopHttpRequest} from './types.js';
import {DotsError} from './types.js';
import {isOpaqueId} from './identifiers.js';
export function validateDotsRequest(request:DesktopHttpRequest){
 const bad=()=>new DotsError('DOTS_INVALID_PATH','不支持的 Dots 接口',400);
 if(!request.path.startsWith('/')||request.path.startsWith('//'))throw bad();
 let url:URL;try{url=new URL(request.path,'https://dots.invalid');}catch{throw bad();}
 if(url.origin!=='https://dots.invalid'||url.hash)throw bad();
 // Reject normalized traversal instead of allowing URL parsing to change the target.
 if(url.pathname!==request.path.split('?')[0])throw bad();
 const catalog=url.pathname==='/tbo'||url.pathname==='/tbo/primary';
 const match=/^\/messaging\/rooms\/([^/]+)(\/messages)?$/.exec(url.pathname);
 if(!catalog&&!match)throw bad();
 if(match){
  let id:string;try{id=decodeURIComponent(match[1]);}catch{throw bad();}
  if(!isOpaqueId(id)||encodeURIComponent(id)!==match[1])throw bad();
 }
 if(request.method!=='GET'&&!(request.method==='POST'&&match?.[2]==='/messages'&&!url.search))throw new DotsError('DOTS_INVALID_METHOD','不支持的 Dots 操作',400);
}
