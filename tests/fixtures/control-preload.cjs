const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('electronBridge',{sendMessageFromView:message=>ipcRenderer.invoke('codex_desktop:message-from-view',message),getAppVersion:()=> 'fixture-26.930.21537',getSharedObjectSnapshotValue:key=>key==='remote_ssh_connections'?[{hostId:'remote-ssh-discovered:macmini',displayName:'macmini',autoConnect:true}]:[]});
ipcRenderer.on('codex_desktop:message-for-view',(_event,message)=>window.dispatchEvent(new MessageEvent('message',{data:message})));
