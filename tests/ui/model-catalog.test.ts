import {it,expect} from 'vitest';
import {loadDesktopModels,loadDesktopPermissions} from '../../src/app-server/model-catalog';
it('桌面模型完整分页并去重，保留模型能力',async()=>{
 const client={request:async(_method:string,p:any)=>p.cursor?{data:[{model:'pro',defaultReasoningEffort:'high'}],nextCursor:null}:{data:[{model:'base'},{model:'pro'}],nextCursor:'next'}};
 const result=await loadDesktopModels(client);expect(result.data.map(x=>x.model)).toEqual(['base','pro']);
});
it('模型分页游标重复时明确失败',async()=>{
 await expect(loadDesktopModels({request:async()=>({data:[],nextCursor:'repeat'})})).rejects.toThrow();
});

it('权限分页每页使用当前会话目录',async()=>{
 const calls:any[]=[];
 const result=await loadDesktopPermissions({request:async(method,p:any)=>{calls.push({method,...p});return p.cursor?{data:[{id:':read-only',allowed:true}]}:{data:[{id:':workspace',allowed:true}],nextCursor:'next'};}},'/remote/project');
 expect(result.data).toHaveLength(2);expect(calls.map(p=>p.cwd)).toEqual(['/remote/project','/remote/project']);expect(calls[1].cursor).toBe('next');
});
