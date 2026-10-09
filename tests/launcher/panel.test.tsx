import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import { LauncherPanel } from '../../launcher/Panel';
import {defaultConfig} from '../../server/launcher/config';
afterEach(cleanup);
it('可视化面板切换原模式并保存配置，启动后显示连接和审批状态',async()=>{
 let status:any={config:defaultConfig(),running:false,phase:'未启动',error:'',clients:0,approvals:0,thread:'',accessUrl:null,logs:[]};
 const api:any={getStatus:async()=>status,saveConfig:vi.fn(async(c:any)=>{status={...status,config:c};return status}),start:async()=>{status={...status,running:true,phase:'已启动',clients:1,approvals:2};return status},openMobile:async()=>{},stop:async()=>status,subscribe:()=>()=>{},desktopStatus:async()=>null};
 render(<LauncherPanel api={api}/>);
 await screen.findByRole('button',{name:'设置'});fireEvent.click(screen.getByRole('button',{name:'设置'}));await screen.findByLabelText('连接模式');fireEvent.change(screen.getByLabelText('连接模式'),{target:{value:'managed'}});
 fireEvent.click(screen.getByRole('button',{name:'保存配置'}));await waitFor(()=>expect(api.saveConfig).toHaveBeenCalledWith(expect.objectContaining({mode:'managed'})));
 fireEvent.click(screen.getByRole('button',{name:'连接'}));fireEvent.click(screen.getByRole('button',{name:'启动并打开 Web'}));await screen.findByText('已启动');expect(screen.getByText('1 台设备')).toBeTruthy();
});
it('只有主按钮操作才启动并打开 Web，已启动时直接打开且可单独停止',async()=>{
 let status:any={config:defaultConfig(),running:false,phase:'未启动',error:'',clients:0,approvals:0,thread:'',accessUrl:null,logs:[]};
 const actions:string[]=[];
 const api:any={getStatus:async()=>status,subscribe:()=>()=>{},start:async()=>{actions.push('start');status={...status,running:true,phase:'已启动'};return status;},openMobile:async()=>{actions.push('open');},stop:async()=>{actions.push('stop');status={...status,running:false,phase:'未启动'};return status;}};
 render(<LauncherPanel api={api}/>);
 const start=await screen.findByRole('button',{name:'启动并打开 Web'});expect(actions).toEqual([]);
 fireEvent.click(start);await screen.findByRole('button',{name:'打开 Web'});expect(actions).toEqual(['start','open']);
 fireEvent.click(screen.getByRole('button',{name:'打开 Web'}));await waitFor(()=>expect(actions).toEqual(['start','open','open']));
 fireEvent.click(screen.getByRole('button',{name:'停止连接'}));await screen.findByRole('button',{name:'启动并打开 Web'});expect(actions).toEqual(['start','open','open','stop']);
});
it('启动失败时不打开 Web，并显示连接原因',async()=>{
 const status:any={config:defaultConfig(),running:false,phase:'未启动',error:'',clients:0,approvals:0,thread:'',accessUrl:null,logs:[]};
 const openMobile=vi.fn();
 render(<LauncherPanel api={{getStatus:async()=>status,subscribe:()=>()=>{},start:async()=>{throw new Error('受控连接未就绪');},openMobile} as any}/>);
 fireEvent.click(await screen.findByRole('button',{name:'启动并打开 Web'}));
 expect((await screen.findByRole('alert')).textContent).toBe('受控连接未就绪');expect(openMobile).not.toHaveBeenCalled();
});
it('结构化输入审批保留请求类型并引导到 Web，不生成二选一按钮',async()=>{
 const status:any={config:defaultConfig(),running:true,phase:'已启动',error:'',clients:0,approvals:1,thread:'',accessUrl:null,logs:[]};
 const openMobile=vi.fn(async()=>{}),approve=vi.fn();
 const api:any={getStatus:async()=>status,subscribe:()=>()=>{},openMobile,approve,desktopStatus:async()=>({approvals:[{id:'approval-1',method:'item/tool/requestUserInput',params:{threadId:'thread-1',questions:[{id:'choice',header:'环境',question:'选择环境'}]}}]})};
 render(<LauncherPanel api={api}/>);fireEvent.click(await screen.findByRole('button',{name:'审批1'}));
 await screen.findByText('item/tool/requestUserInput');expect(screen.getByText('会话：thread-1')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'在 Web 中处理审批'}));await waitFor(()=>expect(openMobile).toHaveBeenCalledOnce());expect(approve).not.toHaveBeenCalled();
});
it('路由错误显示可读原因，保留完整堆栈给诊断层',async()=>{
 const status:any={config:defaultConfig(),running:true,phase:'已启动',error:'page.evaluate: Error: 桌面路由尚未就绪\n    at desktopRoute (eval at evaluate)',clients:0,approvals:0,thread:'',accessUrl:null,logs:[]};
 const api:any={getStatus:async()=>status,subscribe:()=>()=>{}};
 render(<LauncherPanel api={api}/>);const alert=await screen.findByRole('alert');expect(alert.textContent).toBe('桌面路由尚未就绪');
});
it('二维码默认收起，点击展开并可收回，重启直接交给启动器',async()=>{
 const status:any={config:defaultConfig(),running:true,phase:'已启动',error:'',clients:1,approvals:0,thread:'',accessUrl:'http://127.0.0.1:19877/?token=fixture',logs:[]};
 const restart=vi.fn(async()=>status);
 render(<LauncherPanel api={{getStatus:async()=>status,subscribe:()=>()=>{},restart} as any}/>);
 const toggle=await screen.findByRole('button',{name:'展开二维码'});
 expect(screen.queryByRole('img',{name:'手机连接二维码'})).toBeNull();
 expect(toggle.getAttribute('aria-expanded')).toBe('false');fireEvent.click(toggle);
 await screen.findByRole('img',{name:'手机连接二维码'});
 fireEvent.click(screen.getByRole('button',{name:'收起二维码'}));expect(screen.queryByRole('img',{name:'手机连接二维码'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'强制重启 ChatGPT'}));await waitFor(()=>expect(restart).toHaveBeenCalledOnce());
});
