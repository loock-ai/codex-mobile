// @vitest-environment node
import {afterEach,it,expect,vi} from 'vitest';
import {desktopRoute} from '../../server/cdp/adapter.js';
afterEach(()=>vi.unstubAllGlobals());
const root=(fiber:unknown)=>vi.stubGlobal('window',{__codexRoot:{_internalRoot:{current:fiber}}});
it('使用外层 Router LocationContext，不把组件自己的 location 当作当前页面',()=>{
 root({memoizedProps:{value:{location:{pathname:'/local/current'},navigationType:'POP'}},child:{memoizedProps:{location:{pathname:'/settings'}},sibling:{memoizedProps:{location:{pathname:'/local/cached'}}}}});
 expect(desktopRoute()).toBe('/local/current');
});
it('外层 Router 的身份优先于嵌套 Route 覆盖',()=>{
 root({memoizedProps:{value:{location:{pathname:'/dots/current'},navigationType:'PUSH'}},child:{memoizedProps:{value:{location:{pathname:'/o/embedded'},navigationType:'POP'}}}});
 expect(desktopRoute()).toBe('/dots/current');
});
it('同一层存在两个冲突的 Router 时拒绝操作',()=>{
 root({child:{memoizedProps:{value:{location:{pathname:'/local/a'},navigationType:'POP'}},sibling:{memoizedProps:{value:{location:{pathname:'/local/b'},navigationType:'POP'}}}}});
 expect(()=>desktopRoute()).toThrow('多个');
});
it('缺少 React 根时说明需要等待页面初始化',()=>{
 vi.stubGlobal('window',{});expect(()=>desktopRoute()).toThrow('初始化');
});
it('保留单一路由的受控页面兼容',()=>{
 root({memoizedProps:{location:{pathname:'/local/fixture'}}});expect(desktopRoute()).toBe('/local/fixture');
});
