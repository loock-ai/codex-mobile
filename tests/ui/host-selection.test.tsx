import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,within,cleanup} from '@testing-library/react';
import {useState} from 'react';
import {BackendManagerSheet} from '../../src/features/backends/BackendManagerSheet';
import {createDefaultBackendRegistry} from '../../src/backends/registry';
afterEach(cleanup);
const hosts=[{hostId:'local',displayName:'本机'},{hostId:'mini',displayName:'Mac mini'},{hostId:'cindy',displayName:'Cindy'}];
const probe=async()=>({hostId:'gateway',displayName:'电脑',hostname:'mac',gatewayVersion:'1',appServerReady:true,backend:'desktop-control'});
it('测试后先选择主机，确认才保存；二级开关与再次测试保留同一选择',async()=>{
 const saved=vi.fn();
 function Harness(){const [registry,setRegistry]=useState(createDefaultBackendRegistry('http://desktop.local','secret'));return <BackendManagerSheet open registry={registry} summaries={{}} onChange={next=>{setRegistry(next);saved(next);}} onClose={()=>{}} probe={probe} discoverHosts={async()=>hosts}/>;}
 render(<Harness/>);
 fireEvent.click(screen.getByRole('button',{name:/编辑 /}));fireEvent.click(screen.getByRole('button',{name:'测试并保存'}));
 const picker=await screen.findByRole('dialog',{name:'选择展示的主机'});
 expect(saved).not.toHaveBeenCalled();expect(within(picker).getAllByRole('checkbox')).toHaveLength(3);
 fireEvent.click(within(picker).getByRole('checkbox',{name:'显示 Mac mini'}));fireEvent.click(within(picker).getByRole('button',{name:'保存选择'}));
 await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));expect(saved.mock.calls[0][0].backends[0].visibleHostIds).toEqual(['local','mini']);
 fireEvent.click(screen.getByRole('checkbox',{name:'显示 本机'}));expect(saved.mock.calls.at(-1)![0].backends[0].visibleHostIds).toEqual(['mini']);
 fireEvent.click(screen.getByRole('button',{name:/编辑 /}));fireEvent.click(screen.getByRole('button',{name:'测试并保存'}));
 const again=await screen.findByRole('dialog',{name:'选择展示的主机'});
 expect((within(again).getByRole('checkbox',{name:'显示 Mac mini'}) as HTMLInputElement).checked).toBe(true);expect((within(again).getByRole('checkbox',{name:'显示 本机'}) as HTMLInputElement).checked).toBe(false);
 fireEvent.click(within(again).getByRole('checkbox',{name:'显示 Cindy'}));fireEvent.click(within(again).getByRole('button',{name:'取消'}));expect(saved).toHaveBeenCalledTimes(2);
});
it('关闭测试中的弹窗后，迟到探测结果不能保存或重新打开选择',async()=>{
 const registry=createDefaultBackendRegistry('http://desktop.local','secret'),saved=vi.fn();
 let finish!:(value:Awaited<ReturnType<typeof probe>>)=>void;
 const pending=()=>new Promise<Awaited<ReturnType<typeof probe>>>(resolve=>{finish=resolve;});
 const view=render(<BackendManagerSheet open registry={registry} summaries={{}} onChange={saved} onClose={()=>{}} probe={pending} discoverHosts={async()=>hosts}/>);
 fireEvent.click(screen.getByRole('button',{name:/编辑 /}));fireEvent.click(screen.getByRole('button',{name:'测试并保存'}));
 view.rerender(<BackendManagerSheet open={false} registry={registry} summaries={{}} onChange={saved} onClose={()=>{}} probe={pending} discoverHosts={async()=>hosts}/>);
 finish(await probe());await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(saved).not.toHaveBeenCalled();
});
