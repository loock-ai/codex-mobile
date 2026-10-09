// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {resolveManagedLaunch} from '../../server/app-server-manager.js';
it('菜单栏环境缺少 node PATH 时，Node 版 Codex 包装器使用自带运行时',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'launcher-wrapper-')),script=join(dir,'codex');
 await writeFile(script,'#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n',{mode:0o700});
 const launch=await resolveManagedLaunch(script,['app-server','--listen','ws://127.0.0.1:19901'],true);
 const {stdout}=await promisify(execFile)(launch.executable,launch.args,{env:{...process.env,...launch.environment,PATH:'/usr/bin:/bin'}});
 expect(JSON.parse(stdout)).toEqual(['app-server','--listen','ws://127.0.0.1:19901']);
});
