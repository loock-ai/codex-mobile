import {DesktopControlChannel} from './control-channel.js';
import {CdpControlTransport} from './control-transport.js';
import {createControlGateway} from './control-gateway.js';
import {resolve} from 'node:path';

export async function startDesktopControl(){
 const port=Number(process.env.PORT||19878);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口必须为 1–65535');
 const token=process.env.CODEX_MOBILE_TOKEN||'';
 if(!token)throw new Error('请配置 CODEX_MOBILE_TOKEN');
 const channel=new DesktopControlChannel(new CdpControlTransport(process.env.CODEX_MOBILE_CDP_URL||'http://127.0.0.1:9333'));
 const gateway=await createControlGateway({channel,host:process.env.HOST||'127.0.0.1',port,token,staticDir:process.env.CODEX_MOBILE_STATIC_DIR||resolve('dist')});
 console.log(`桌面程序控制通道已启动，端口 ${gateway.port}，WebSocket 路径 /ws`);
 console.log('当前仅支持 Codex；接入前已有审批的快照尚未支持。实际桌面契约及界面同步需单独验收。');
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void gateway.close().then(()=>process.exit(0)));
 return gateway;
}
