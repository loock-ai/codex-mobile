import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
await build({configFile:false,root:resolve('launcher'),base:'./',plugins:[react()],build:{outDir:resolve('launcher-ui'),emptyOutDir:true}});
