import {it,expect,vi} from 'vitest';
import {renderHook,waitFor} from '@testing-library/react';
import {expandDesktopBackends,useDesktopBackends} from '../../src/backends/desktop-hosts';
import {createDefaultBackendRegistry,saveBackendRegistry,loadBackendRegistry} from '../../src/backends/registry';
it('远程项目按设备持久化，运行时分离同网关同会话ID的主机',()=>{
 const registry=createDefaultBackendRegistry('http://desktop.local','secret');registry.backends[0].remoteProjects=true;
 saveBackendRegistry(localStorage,registry);const loaded=loadBackendRegistry(localStorage,'http://desktop.local');
 expect(loaded.backends[0].remoteProjects).toBe(true);
 const hosts={'current-origin':[{hostId:'local',displayName:'本机'},{hostId:'remote-ssh-discovered:macmini',displayName:'macmini'}]};
 const runtime=expandDesktopBackends(loaded.backends,hosts);expect(runtime).toHaveLength(2);expect(runtime[1].desktopHostId).toBe('remote-ssh-discovered:macmini');expect(runtime[1].id).not.toBe(runtime[0].id);
 expect(loaded.backends).toHaveLength(1);loaded.backends[0].remoteProjects=false;expect(expandDesktopBackends(loaded.backends,hosts)).toHaveLength(1);
});
it('刷新期间保留远程设备，避免卸载会话和丢失草稿',async()=>{
 const parents=createDefaultBackendRegistry('http://desktop.local','secret').backends;parents[0].remoteProjects=true;let calls=0;
 vi.stubGlobal('fetch',()=>{calls++;return calls===1?Promise.resolve({ok:true,json:async()=>({data:[{hostId:'remote',displayName:'remote'}]})}):new Promise(()=>{});});
 const view=renderHook(({refresh})=>useDesktopBackends(parents,refresh),{initialProps:{refresh:0}});
 try{await waitFor(()=>expect(view.result.current.backends).toHaveLength(2));view.rerender({refresh:1});await waitFor(()=>expect(calls).toBe(2));expect(view.result.current.backends).toHaveLength(2);}finally{view.unmount();vi.unstubAllGlobals();}
});
