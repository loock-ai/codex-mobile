import { resolve } from 'node:path';
import { CdpDesktopAdapter } from './adapter.js';
import { createBridgeGateway } from './gateway.js';
import { writeRuntimeAccess } from '../runtime-access.js';
export async function startDesktopBridge() {
 const adapter=new CdpDesktopAdapter(process.env.CODEX_MOBILE_CDP_URL||'http://127.0.0.1:9222');await adapter.connect();
 const gateway=await createBridgeGateway({host:process.env.HOST||'127.0.0.1',port:Number(process.env.PORT||19877),token:process.env.CODEX_MOBILE_TOKEN||'',staticDir:process.env.CODEX_MOBILE_STATIC_DIR||resolve('dist'),adapter});
 await writeRuntimeAccess(process.env.CODEX_MOBILE_RUNTIME_FILE,{port:gateway.port,token:process.env.CODEX_MOBILE_TOKEN||''});
 console.log(`CDP 手机桥接已启动，端口 ${gateway.port}`);
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>void gateway.close().then(()=>process.exit(0)));
 return gateway;
}
