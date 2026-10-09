import {useEffect,useMemo,useState,useRef} from 'react';
import type {BackendConfig,DesktopHost} from './types';
import {displayedHostIds,normalizeDesktopHosts} from './host-selection';
import {t} from '../i18n';
export type {DesktopHost} from './types';

export async function fetchDesktopHosts(backend:BackendConfig, signal?:AbortSignal):Promise<DesktopHost[]|null> {
 const controller=new AbortController();
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const timer=setTimeout(abort,6000);
 try {
  const url=new URL('/api/desktop/hosts',backend.baseUrl);url.searchParams.set('token',backend.token);
  const response=await fetch(url,{signal:controller.signal});
  if(response.status===404)return null;
  if(!response.ok)throw new Error(t('远程主机列表加载失败（{status}）',{status:response.status}));
  const value=await response.json();if(!Array.isArray(value.data))throw new Error(t('远程主机列表无效'));
  return normalizeDesktopHosts([{hostId:'local',displayName:t('本机')},...value.data]);
 } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export function expandDesktopBackends(backends:BackendConfig[],hosts:Record<string,DesktopHost[]>):BackendConfig[]{
 return backends.flatMap(parent=>{
  const available=parent.desktopHosts??hosts[parent.id]??[];
  const selected=new Set(displayedHostIds(parent,available));
  return [{...parent,enabled:parent.enabled&&selected.has('local')},...!parent.enabled?[]:available.filter(host=>host.hostId!=='local'&&selected.has(host.hostId)).map(host=>({
   ...parent,id:`${parent.id}:desktop:${host.hostId}`,name:host.displayName,desktopHostId:host.hostId,parentBackendId:parent.id,
   hostId:`${parent.hostId??parent.id}:desktop:${host.hostId}`,remoteProjects:false,
  }))];
 });
}
export function useDesktopBackends(backends:BackendConfig[],refreshVersion:number,onDiscovered?:(backend:BackendConfig,hosts:DesktopHost[])=>void){
 const [hosts,setHosts]=useState<Record<string,DesktopHost[]>>({}),[error,setError]=useState('');
 const callback=useRef(onDiscovered);callback.current=onDiscovered;
 // 展示勾选变化不重建正在执行的主机发现请求。
 const discoveryKey=JSON.stringify(backends.filter(b=>b.enabled).map(b=>[b.id,b.baseUrl,b.token]));
 const backendsRef=useRef(backends);backendsRef.current=backends;
 const signatures=useRef(new Map<string,string>());
 useEffect(()=>{
  const targets=backendsRef.current.filter(b=>b.enabled);
  const nextSignatures=new Map(targets.map(b=>[b.id,JSON.stringify([b.baseUrl,b.token])])),previousSignatures=signatures.current;
  signatures.current=nextSignatures;
  const controller=new AbortController();let current=true;
  setHosts(existing=>Object.fromEntries(Object.entries(existing).filter(([id])=>nextSignatures.has(id)&&nextSignatures.get(id)===previousSignatures.get(id))));setError('');
  for(const backend of targets){
   void fetchDesktopHosts(backend,controller.signal)
    .then(data=>{if(current&&data){setHosts(existing=>({...existing,[backend.id]:data}));callback.current?.(backend,data);}})
    .catch(reason=>{if(current&&(backend.desktopHosts||backend.remoteProjects||backend.hostId?.includes('-desktop-control')))setError(`${backend.name}: ${reason instanceof Error?reason.message:t('远程项目加载失败')}`);});
  }
  return()=>{current=false;controller.abort();};
 },[discoveryKey,refreshVersion]);
 return {backends:useMemo(()=>expandDesktopBackends(backends,hosts),[backends,hosts]),hosts,error};
}
