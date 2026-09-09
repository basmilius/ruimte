import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { startNeedsYouNotifications } from '@/shell/notifications';
import { startSessionLifecycle } from '@/terminal/lifecycle';
import { exposeTerminalTestHooks } from '@/terminal/registry';
import '@/state/theme';
import '@xterm/xterm/css/xterm.css';
import '@/styles.css';

startSessionLifecycle();
startNeedsYouNotifications();
if (import.meta.env.DEV) {
    exposeTerminalTestHooks();
}

createRoot(document.getElementById('root')!).render(<App />);
