import {createRoot} from 'react-dom/client';
import {LauncherPanel,type LauncherApi} from './Panel';
import './styles.css';
declare global {interface Window {launcher:LauncherApi}}
createRoot(document.getElementById('root')!).render(<LauncherPanel api={window.launcher}/>);
