import {useEffect,useMemo,useState,useRef} from 'react';
import type {BackendConfig} from './types';
import {t} from '../i18n';
export interface DesktopHost {hostId:string;displayName:string}
export function expandDesktopBackends(backends:BackendConfig[],hosts:Record<string,DesktopHost[]>):BackendConfig[]{
 return backends.flatMap(parent=>[parent,...!parent.enabled||!parent.remoteProjects?[]:(hosts[parent.id]??[]).filter(host=>host.hostId!=='local').map(host=>({
  ...parent,id:`${parent.id}:desktop:${host.hostId}`,name:host.displayName,desktopHostId:host.hostId,parentBackendId:parent.id,
  hostId:`${parent.hostId??parent.id}:desktop:${host.hostId}`,remoteProjects:false,
 }))]);
}
export function useDesktopBackends(backends:BackendConfig[],refreshVersion:number){
 const [hosts,setHosts]=useState<Record<string,DesktopHost[]>>({}),[error,setError]=useState('');
 const signatures=useRef(new Map<string,string>());
 useEffect(()=>{
  const nextSignatures=new Map(backends.filter(b=>b.enabled&&b.remoteProjects).map(b=>[b.id,JSON.stringify([b.baseUrl,b.token])])),previousSignatures=signatures.current;
  signatures.current=nextSignatures;
  const controller=new AbortController();let current=true;setHosts(existing=>Object.fromEntries(Object.entries(existing).filter(([id])=>nextSignatures.has(id)&&nextSignatures.get(id)===previousSignatures.get(id))));setError('');
  const timers:ReturnType<typeof setTimeout>[]=[];
  for(const backend of backends.filter(b=>b.enabled&&b.remoteProjects)){
   const url=new URL('/api/desktop/hosts',backend.baseUrl);url.searchParams.set('token',backend.token);
   const requestController=new AbortController();controller.signal.addEventListener('abort',()=>requestController.abort(),{once:true});
   const timer=setTimeout(()=>requestController.abort(),6000);timers.push(timer);
   void fetch(url,{signal:requestController.signal}).then(async response=>{if(!response.ok)throw new Error(t('此设备暂不支持远程项目'));const value=await response.json();if(!Array.isArray(value.data))throw new Error(t('远程主机列表无效'));const seen=new Set<string>();return value.data.filter((h:DesktopHost)=>typeof h?.hostId==='string'&&typeof h.displayName==='string'&&!seen.has(h.hostId)&&!!seen.add(h.hostId));})
    .then(data=>{if(current)setHosts(existing=>({...existing,[backend.id]:data}));})
    .catch(reason=>{if(current)setError(`${backend.name}: ${reason instanceof Error?reason.message:t('远程项目加载失败')}`);})
    .finally(()=>clearTimeout(timer));
  }
  return()=>{current=false;controller.abort();timers.forEach(clearTimeout);};
 },[backends,refreshVersion]);
 return {backends:useMemo(()=>expandDesktopBackends(backends,hosts),[backends,hosts]),error};
}
