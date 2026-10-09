// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { DotsAdapter } from '../../server/dots/adapter.js';
import { createDotsHttp } from '../../server/dots/http.js';
import type { DesktopHttpRequest } from '../../server/dots/types.js';
const servers: Server[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})));});
async function fixture(){
  const requests:DesktopHttpRequest[]=[];
  const adapter=new DotsAdapter({status:async()=>({available:true}),close:async()=>{},request:async r=>{
    requests.push(r);return {status:200,body:r.path.startsWith('/tbo')?{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'}]}:r.method==='POST'?{id:'sent',account_user_id:'u',content:{text:'hi'}}:{items:[],prev_cursor:null}};
  }});
  const handle=createDotsHttp(adapter),server=createServer((req,res)=>{void handle(req,res,new URL(req.url!,'http://localhost'));});servers.push(server);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const addr=server.address();if(typeof addr!=='object'||!addr)throw Error('no port');
  return {base:`http://127.0.0.1:${addr.port}`,requests};
}
describe('Dots HTTP boundary',()=>{
  it('serves only fixed read routes and body-validated send',async()=>{
    const {base,requests}=await fixture();
    expect((await (await fetch(`${base}/api/dots/status`)).json()).mode).toBe('polling');
    expect((await (await fetch(`${base}/api/dots/list`)).json()).dots[0].id).toBe('dot');
    expect((await (await fetch(`${base}/api/dots/messages?dotId=dot`)).json()).roomId).toBe('room');
    const response=await fetch(`${base}/api/dots/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dotId:'dot',text:'hi',requestId:'one'})});
    expect(response.status).toBe(200);expect((await response.json()).message.id).toBe('sent');expect(requests.filter(r=>r.method==='POST')).toHaveLength(1);
  });
  it('rejects unknown operations, wrong methods, extra query/body fields and malformed JSON',async()=>{
    const {base,requests}=await fixture();
    expect((await fetch(`${base}/api/dots/fetch?url=https://evil`)).status).toBe(404);
    expect((await fetch(`${base}/api/dots/send`)).status).toBe(405);
    expect((await fetch(`${base}/api/dots/list?url=https://evil`)).status).toBe(400);
    expect((await fetch(`${base}/api/dots/messages?dotId=dot&dotId=other`)).status).toBe(400);
    for(const body of ['{',JSON.stringify({dotId:'dot',text:'hi',requestId:'r',roomId:'other'}),'null']){
      expect((await fetch(`${base}/api/dots/send`,{method:'POST',body})).status).toBe(400);
    }
    expect(requests).toHaveLength(0);
  });
  it('returns 413 for oversized bodies without sending upstream',async()=>{
    const {base,requests}=await fixture();
    const response=await fetch(`${base}/api/dots/send`,{method:'POST',body:JSON.stringify({dotId:'dot',requestId:'r',text:'x'.repeat(65536)})});
    expect(response.status).toBe(413);expect((await response.json()).code).toBe('DOTS_BODY_TOO_LARGE');expect(requests).toHaveLength(0);
  });
});
