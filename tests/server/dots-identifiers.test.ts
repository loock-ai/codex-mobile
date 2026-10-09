// @vitest-environment node
import {it,expect} from 'vitest';
import {DotsAdapter} from '../../server/dots/adapter.js';
import {validateDotsRequest} from '../../server/dots/paths.js';
import type {DesktopHttpRequest} from '../../server/dots/types.js';
it.each(['tbo:opaque.part=1','gid://openai/Dot/42',12345])('官方ID作为不透明标识保留，房间路径编码：%s',async id=>{
 const calls:DesktopHttpRequest[]=[];
 const a=new DotsAdapter({status:async()=>({available:true}),close:async()=>{},request:async r=>{
  calls.push(r);return {status:200,body:r.path==='/tbo/primary'?{selection:null}:r.path.startsWith('/tbo?')?{items:[{id,display_name:'Dot',aeon_kind:'orbit',messaging_room_id:'room:opaque.part=1'}]}:{items:[],prev_cursor:null}};
 }});
 expect((await a.list()).dots[0]).toMatchObject({id:String(id),roomId:'room:opaque.part=1'});
 await a.messages(String(id));expect(calls.at(-1)?.path).toContain('/rooms/room%3Aopaque.part%3D1/messages');
 validateDotsRequest(calls.at(-1)!);
});
it('只允许固定接口和编码后的单个房间参数，拒绝地址越界',()=>{
 for(const path of ['https://evil.test/tbo','//evil.test/tbo','/messaging/rooms/../messages','/messaging/rooms/a/messages/extra','/messaging/rooms/%ZZ/messages','/messaging/rooms/%2e%2e/messages'])expect(()=>validateDotsRequest({method:'GET',path})).toThrow();
 expect(()=>validateDotsRequest({method:'POST',path:'/tbo/primary'})).toThrow();
 expect(()=>validateDotsRequest({method:'POST',path:'/messaging/rooms/room%3Atest'})).toThrow();
 expect(()=>validateDotsRequest({method:'GET',path:'/messaging/rooms/room%3Atest'})).not.toThrow();
 expect(()=>validateDotsRequest({method:'GET',path:'/messaging/rooms/room%3Atest/messages?before=page%3A2'})).not.toThrow();
});
