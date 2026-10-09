export interface DesktopHttpRequest {method:'GET'|'POST';path:string;body?:unknown}
export interface DesktopHttpTransport {
 status():Promise<{available:boolean;error?:string;code?:string;identityKey?:string}>;
 request(request:DesktopHttpRequest):Promise<{status:number;body:unknown}>;
 close():Promise<void>;
}
export interface DotProfile {id:string;name:string;roomId:string|null;threadId?:string;paused?:boolean}
export interface DotAttachment {id:string;name:string;type:string;size:number}
export const DOTS_MAX_FILE_BYTES=20*1024*1024;
export const DOTS_MAX_ATTACHMENTS=4;
export interface DotMessage {id:string;role:'user'|'assistant'|'system';text:string;createdAt:string;requestId?:string;deleted?:boolean;attachments?:DotAttachment[]}
export class DotsError extends Error {constructor(public code:string,message:string,public status=502){super(message);}}
