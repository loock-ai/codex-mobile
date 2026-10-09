import {t} from '../i18n';
export function resolveRemotePath(source:string,cwd:string|null):string{
 if(/^(data:|https?:)/i.test(source))return source;
 if(source.startsWith('/')||/^[A-Za-z]:[\\/]/.test(source))return source;
 if(source.startsWith('file:'))return decodeURIComponent(new URL(source).pathname).replace(/^\/([A-Za-z]:)/,'$1');
 if(!cwd)throw new Error(t('缺少会话目录，无法读取相对路径'));
 const windows=/^[A-Za-z]:[\\/]/.test(cwd),base=cwd.replaceAll('\\','/');
 const url=new URL(source,'file://'+(windows?'/':'')+base.split('/').map(encodeURIComponent).join('/').replace(/\/?$/,'/'));
 const path=decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/,'$1');return windows?path.replaceAll('/','\\'):path;
}
