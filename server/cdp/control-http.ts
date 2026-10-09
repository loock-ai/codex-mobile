import type {IncomingMessage,ServerResponse} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {hostname} from 'node:os';
import {readComputerName} from '../computer-name.js';
import type {DesktopControlChannel} from './control-channel.js';
import {uploadToDesktop} from './control-upload.js';
import type {DotsAdapter} from '../dots/adapter.js';
import {createDotsHttp} from '../dots/http.js';

export function controlHttp(options:{channel:DesktopControlChannel;token:string;staticDir?:string;dots?:DotsAdapter}){
 const computerName=readComputerName();
 const dotsHttp=options.dots?createDotsHttp(options.dots):null;
 return async(req:IncomingMessage,res:ServerResponse)=>{
  try{
   const url=new URL(req.url??'/','http://localhost'),api=url.pathname.startsWith('/api/'),authorized=url.searchParams.get('token')===options.token;
   if(api&&authorized&&req.headers.origin){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','content-type,x-codex-file-name');res.setHeader('Access-Control-Allow-Credentials','true');}
   if(req.method==='OPTIONS'){res.writeHead(authorized?204:401);res.end();return;}
   if(api&&!authorized){res.writeHead(401);res.end();return;}
   if(url.pathname.startsWith('/api/dots/')){
    if(!dotsHttp){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'此连接尚未启用 Dots 适配',code:'DOTS_UNAVAILABLE'}));return;}
    const requestUrl=new URL(url);requestUrl.searchParams.delete('token');await dotsHttp(req,res,requestUrl);return;
   }
   if(req.method!=='GET'&&!(req.method==='POST'&&url.pathname==='/api/uploads/file')){res.writeHead(405);res.end();return;}
   if(api){
    res.setHeader('content-type','application/json; charset=utf-8');
    const hostId=url.searchParams.get('hostId')||'local';
    const remote=hostId==='local'?null:(await options.channel.hosts()).find(host=>host.hostId===hostId);
    if(hostId!=='local'&&!remote){res.writeHead(404);res.end(JSON.stringify({error:'桌面没有该远程主机'}));return;}
    if(url.pathname==='/api/uploads/file'){await uploadToDesktop(req,res,options.channel,hostId);return;}
    if(url.pathname==='/api/status')res.end(JSON.stringify({...options.channel.status(),capabilities:{...options.channel.status().capabilities,dots:!!options.dots}}));
    else if(url.pathname==='/api/desktop/hosts'){const name=await computerName;res.end(JSON.stringify({data:(await options.channel.hosts()).map(host=>host.hostId==='local'?{...host,displayName:name}:host)}));}
    else if(url.pathname==='/api/host')res.end(JSON.stringify({hostId:hostname()+'-desktop-control'+(remote?':'+hostId:''),displayName:remote?.displayName??await computerName,hostname:hostname(),gatewayVersion:'0.2.0',appServerReady:options.channel.status().connected,backend:'desktop-control'}));
    else if(url.pathname==='/api/projects'){
     const projects=new Set<string>(),seen=new Set<string>();let cursor:string|null=null;
     for(let count=0;;count++){
      if(count>=1000)throw new Error('项目分页超过限制');
      const result=await options.channel.request(hostId,'project/list',{limit:100,cursor});
      for(const project of result.data??[])for(const root of project.roots??[])if(typeof root.path==='string')projects.add(root.path);
      cursor=result.nextCursor??null;if(!cursor)break;if(seen.has(cursor))throw new Error('项目分页游标重复');seen.add(cursor);
     }
     res.end(JSON.stringify({projects:[...projects]}));
    }else{res.writeHead(501);res.end(JSON.stringify({error:'桌面通道尚不支持此功能'}));}return;
   }
   if(!options.staticDir){res.writeHead(404);res.end();return;}
   const root=resolve(options.staticDir);let file=resolve(root,'.'+decodeURIComponent(url.pathname));
   if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
   if(!(await stat(file).catch(()=>null))?.isFile())file=resolve(root,'index.html');
   const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
   const body=await readFile(file);res.setHeader('content-type',mime[extname(file)]??'application/octet-stream');res.end(body);
  }catch(error){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:error instanceof Error?error.message:String(error),code:(error as {code?:string})?.code}));}
 };
}
