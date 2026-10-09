// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {readDesktopHosts} from '../../server/cdp/control-transport.js';
it('读取远程主机共享状态，保留标识和名称而不暴露连接凭据',()=>{
 (window as any).electronBridge={getSharedObjectSnapshotValue:(key:string)=>key==='remote_ssh_connections'?[{hostId:'remote-ssh-discovered:macmini',displayName:'macmini',autoConnect:true,identity:'private-key-path'},{hostId:'disabled',autoConnect:false}]:[]};
 expect(readDesktopHosts()).toEqual([{hostId:'local',displayName:'本机'},{hostId:'remote-ssh-discovered:macmini',displayName:'macmini'}]);
});
