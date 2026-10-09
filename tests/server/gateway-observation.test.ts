// @vitest-environment node
import {it,expect} from 'vitest';import WebSocket,{WebSocketServer} from 'ws';
import {createGateway} from '../../server/gateway.js';
it('原网关向启动器报告实际手机连接数',async()=>{
 const upstream=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise<void>(r=>upstream.once('listening',r));
 const counts:number[]=[];const gateway=await createGateway({port:0,host:'127.0.0.1',mode:'external',staticDir:null,upstreamUrl:`ws://127.0.0.1:${(upstream.address() as any).port}`,accessToken:'token',onClientCount:(n:number)=>counts.push(n)} as any);
 try {const ws=new WebSocket(`ws://127.0.0.1:${gateway.port}/ws?token=token`);await new Promise<void>(r=>ws.once('open',r));expect(counts).toContain(1);ws.close();for(let i=0;i<20&&!counts.includes(0);i++)await new Promise(r=>setTimeout(r,10));expect(counts.at(-1)).toBe(0);}finally{await gateway.close();await new Promise<void>(r=>upstream.close(()=>r()));}
});
