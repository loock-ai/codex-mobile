import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DotsAdapter } from './adapter.js';
import { DotsError } from './types.js';

const MAX_BODY = 64 * 1024;
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve,reject)=>{
    const chunks: Buffer[]=[];
    let length=0, rejected=false;
    req.on('data',(chunk:Buffer)=>{
      length+=chunk.length;
      if(length > MAX_BODY) {
        if(!rejected) {rejected=true;chunks.length=0;reject(new DotsError('DOTS_BODY_TOO_LARGE','请求正文不能超过 64 KiB',413));}
        return;
      }
      chunks.push(chunk);
    });
    req.on('end',()=>{
      if(rejected)return;
      try {resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
      catch {reject(new DotsError('DOTS_INVALID_INPUT','请求正文必须是有效 JSON',400));}
    });
    req.on('aborted',()=>reject(new DotsError('DOTS_INVALID_INPUT','请求已中断',400)));
    req.on('error',()=>reject(new DotsError('DOTS_INVALID_INPUT','读取请求失败',400)));
  });
}
function query(url: URL, allowed: string[]) {
  const seen=new Set<string>();
  for(const key of url.searchParams.keys()) {
    if(!allowed.includes(key) || seen.has(key)) throw new DotsError('DOTS_INVALID_INPUT','不支持的或重复的查询参数',400);
    seen.add(key);
  }
}
/** 调用方须先完成网关口令鉴权；此处只提供白名单业务路由。 */
export function createDotsHttp(adapter: DotsAdapter) {
  return async (req: IncomingMessage,res: ServerResponse,url: URL): Promise<void> => {
    try {
      const routes: Record<string,string>={'/api/dots/diagnostics':'GET','/api/dots/status':'GET','/api/dots/list':'GET','/api/dots/messages':'GET','/api/dots/send':'POST'};
      const method=routes[url.pathname];
      if(!method) throw new DotsError('DOTS_NOT_FOUND','未找到此 Dots 接口',404);
      if(req.method!==method) {res.setHeader('Allow',method);throw new DotsError('DOTS_METHOD_NOT_ALLOWED','此接口不支持该请求方法',405);}
      let result: unknown;
      switch(url.pathname) {
        case '/api/dots/diagnostics': query(url,[]);result=adapter.diagnostics();break;
        case '/api/dots/status': {query(url,[]);const state=await adapter.status();if(state.code==='DOTS_ACCOUNT_CHANGED')throw new DotsError(state.code,state.error??'桌面账号已变化',409);result=state;break;}
        case '/api/dots/list': query(url,['cursor']);result=await adapter.list(url.searchParams.get('cursor')??undefined);break;
        case '/api/dots/messages': query(url,['dotId','before']);result=await adapter.messages(url.searchParams.get('dotId')??'',url.searchParams.get('before')??undefined);break;
        case '/api/dots/send': {
          query(url,[]);
          const value=await readBody(req);
          if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!['dotId','text','requestId'].includes(key))) throw new DotsError('DOTS_INVALID_INPUT','仅接受 dotId、text 和 requestId',400);
          result=await adapter.send(value as {dotId:string;text:string;requestId:string});break;
        }
      }
      json(res,200,result);
    } catch(error) {
      if(res.destroyed || res.headersSent) return;
      const failure=error instanceof DotsError?error:new DotsError('DOTS_INTERNAL_ERROR','Dots 服务暂时不可用');
      json(res,failure.status,{error:failure.message,code:failure.code});
    }
  };
}
