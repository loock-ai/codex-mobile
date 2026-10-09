import type { BackendConfig } from '../../backends/types';
import { uploadConversationAttachments } from '../../backends/file-upload';
import { buildTurnInput, type DraftImage } from '../../ui/attachments';
import { buildTurnSteerParams } from '../../app-server/turn-steering';
import { t } from '../../i18n';
export interface SteeringInput {backend:BackendConfig;client:{backend:string;request:(method:string,params:unknown)=>Promise<unknown>};threadId:string;turnId:string;clientUserMessageId:string;text:string;images:DraftImage[];files:File[];isCurrent:()=>boolean}
export async function sendSteeringInput({backend,client,threadId,turnId,clientUserMessageId,text,images,files,isCurrent}:SteeringInput):Promise<unknown> {
  if (!isCurrent()) throw new Error(t('会话已切换，引导请求已取消'));
  const desktop = client.backend === 'desktop-control';
  const uploads = await uploadConversationAttachments(backend,images,files,desktop);
  if (!isCurrent()) throw new Error(t('会话已切换，引导请求已取消'));
  const input = desktop ? [...buildTurnInput(text,[],uploads.files),...uploads.imagePaths.map(path=>({type:'localImage',path}))] : buildTurnInput(text,images,uploads.files);
  return client.request('turn/steer',buildTurnSteerParams({threadId,turnId,input,clientUserMessageId}));
}
export function restoreSteeringDraft(reason:unknown) { return (reason as {code?:string})?.code !== 'ACTION_WRITE_UNKNOWN'; }
