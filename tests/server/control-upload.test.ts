// @vitest-environment node
import {it,expect} from 'vitest';
import {DesktopControlChannel,type ControlTransport} from '../../server/cdp/control-channel.js';
import {createControlGateway} from '../../server/cdp/control-gateway.js';
import {DesktopControlClient} from '../../server/cdp/control-client.js';
class Files implements ControlTransport{
 listener:(m:any)=>void=()=>{};saved=new Map<string,string>();
 async connect(){}async close(){}async readHosts(){return [{hostId:'local',displayName:'local'},{hostId:'remote',displayName:'remote'}];}
 subscribe(l:(m:any)=>void){this.listener=l;return()=>{};}
 async send(m:any){const {id,method,params}=m.request;let result:any={};if(method==='fs/writeFile')this.saved.set(m.hostId+params.path,params.dataBase64);if(method==='fs/readFile')result={dataBase64:this.saved.get(m.hostId+params.path)};this.listener({type:'mcp-response',hostId:m.hostId,message:{id,result}});}
}
it('附件上传到指定桌面主机，文件读取走同一主机，WS不开放任意写文件',async()=>{
 const transport=new Files(),gateway=await createControlGateway({channel:new DesktopControlChannel(transport),host:'127.0.0.1',port:0,token:'fixture-secret'});
 const client=new DesktopControlClient(`ws://127.0.0.1:${gateway.port}/ws?token=fixture-secret`);
 try{
  const root=`http://127.0.0.1:${gateway.port}`;
  const metadata=await(await fetch(root+'/api/host?token=fixture-secret')).json();
  const hosts=await(await fetch(root+'/api/desktop/hosts?token=fixture-secret')).json();
  expect(metadata.displayName.length).toBeGreaterThan(0);
  expect(hosts.data).toEqual([{hostId:'local',displayName:metadata.displayName},{hostId:'remote',displayName:'remote'}]);
  const response=await fetch(`http://127.0.0.1:${gateway.port}/api/uploads/file?token=fixture-secret&hostId=remote`,{method:'POST',headers:{'content-type':'text/plain','x-codex-file-name':encodeURIComponent('../../报告.txt')},body:'upload content'});
  expect(response.status).toBe(201);const uploaded=await response.json();expect(uploaded.path).toMatch(/^\/tmp\/codex-mobile-uploads\/[a-f0-9-]+\.txt$/);expect(transport.saved.has('remote'+uploaded.path)).toBe(true);expect(transport.saved.has('local'+uploaded.path)).toBe(false);
  await client.connect('remote');expect((await client.request('fs/readFile',{path:uploaded.path})).dataBase64).toBe(Buffer.from('upload content').toString('base64'));
  await expect(client.request('fs/writeFile',{path:'/outside',dataBase64:''})).rejects.toMatchObject({code:'UNSUPPORTED_METHOD'});
 }finally{client.close();await gateway.close();}
});
