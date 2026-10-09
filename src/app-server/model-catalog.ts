import {t} from '../i18n';
export async function loadDesktopModels(client:{request(method:string,params:unknown):Promise<any>}):Promise<{data:Record<string,any>[]}>{
 const models=new Map<string,Record<string,any>>(),seen=new Set<string>();let cursor:string|null=null;
 for(let page=0;;page++){
  if(page>=100)throw new Error(t('模型列表分页超过限制'));
  const result=await client.request('model/list',{limit:100,includeHidden:false,cursor});
  if(!Array.isArray(result.data))throw new Error(t('模型列表响应无效'));
  for(const model of result.data){const id=model?.model??model?.id;if(typeof id==='string'&&id)models.set(id,{...model,model:id});}
  cursor=result.nextCursor??null;if(!cursor)break;if(seen.has(cursor))throw new Error(t('模型列表游标重复'));seen.add(cursor);
 }
 return {data:[...models.values()]};
}
