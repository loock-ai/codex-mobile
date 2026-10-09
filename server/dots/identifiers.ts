/** Official IDs are opaque values; validate bounds, not a guessed UUID alphabet. */
export function isOpaqueId(value:unknown): value is string {
 if(typeof value!=='string'||!value.trim()||value.length>512||value==='.'||value==='..'||/(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(value)||/[\u0000-\u001f\u007f]/.test(value))return false;
 try{encodeURIComponent(value);return true;}catch{return false;}
}
/** JSON numeric IDs are normalized only at the trusted upstream boundary. */
export function upstreamId(value:unknown):string|null {
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return String(value);
 return isOpaqueId(value)?value:null;
}
