import { afterEach, expect, it, vi } from 'vitest';
import { sendSteeringInput, restoreSteeringDraft } from '../../src/features/conversation/steer-request';
const backend = { id:'local',name:'Mac',baseUrl:'http://device.test',token:'secret',enabled:true,order:0 };
afterEach(() => vi.unstubAllGlobals());
it('结构化桌面引导上传图片和文件后使用localImage及精确turn/client ID', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url:string,init:RequestInit) => new Response(JSON.stringify({ path:'/uploaded/'+decodeURIComponent((init.headers as Record<string,string>)['x-codex-file-name']),name:'asset',size:1,type:'image/png' }),{status:200})));
  const request = vi.fn().mockResolvedValue({});
  await sendSteeringInput({backend,client:{backend:'desktop-control',request},threadId:'thread',turnId:'turn',clientUserMessageId:'client-id',text:'看这张图',images:[{id:'image',name:'picture.png',type:'image/png',url:'data:image/png;base64,YQ==',size:1}],files:[new File(['a'],'notes.txt')],isCurrent:()=>true});
  expect(request).toHaveBeenCalledWith('turn/steer',expect.objectContaining({threadId:'thread',expectedTurnId:'turn',clientUserMessageId:'client-id',input:expect.arrayContaining([{type:'localImage',path:'/uploaded/picture.png'}])}));
  expect(JSON.stringify(request.mock.calls)).not.toContain('data:image');
});
it('上传失败或已切换会话时不提交引导，明确失败可恢复草稿而未知不可恢复', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:500})));
  const request=vi.fn();
  const input={backend,client:{backend:'desktop-control',request},threadId:'t',turnId:'turn',clientUserMessageId:'c',text:'a',images:[],files:[new File(['a'],'a.txt')],isCurrent:()=>true};
  await expect(sendSteeringInput(input)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  await expect(sendSteeringInput({...input,files:[],isCurrent:()=>false})).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  expect(restoreSteeringDraft(new Error('rejected'))).toBe(true);
  expect(restoreSteeringDraft({code:'ACTION_WRITE_UNKNOWN'})).toBe(false);
});
