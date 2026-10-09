export interface DesktopHttpRequest {method:'GET'|'POST';path:string;body?:unknown}
export interface DesktopHttpTransport {
 status():Promise<{available:boolean;error?:string;code?:string;identityKey?:string}>;
 request(request:DesktopHttpRequest):Promise<{status:number;body:unknown}>;
 close():Promise<void>;
}
export interface DotProfile {id:string;name:string;roomId:string|null;threadId?:string;paused?:boolean}
export interface DotMessage {id:string;role:'user'|'assistant'|'system';text:string;createdAt:string;requestId?:string;deleted?:boolean}
export class DotsError extends Error {constructor(public code:string,message:string,public status=502){super(message);}}
