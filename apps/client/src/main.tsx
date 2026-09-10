import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { startNeedsYouNotifications } from '@/shell/notifications';
import { startSessionLifecycle } from '@/terminal/lifecycle';
import { startServerInfo } from '@/transport/server-info';
import { startPing } from '@/transport/ping';
import { startContextSync } from '@/context/sync';
import { startEndpointSelection } from '@/endpoint';
import { desktop } from '@/desktop/bridge';
import { startInputModality } from '@/ui/modality';
import { useTheme } from '@/state/theme';
import '@/project';
import { exposeTerminalTestHooks } from '@/terminal/registry';
import '@/state/theme';
import '@/state/settings';
import '@fontsource-variable/geist';
import '@xterm/xterm/css/xterm.css';
import '@/styles.css';

startSessionLifecycle();
startNeedsYouNotifications();
startServerInfo();
startPing();
startContextSync();
startEndpointSelection();
startInputModality();
// The native window controls on Windows and Linux take their colors from the client's theme.
desktop()?.setTitleBarTheme(useTheme.getState().resolved === 'dark');
useTheme.subscribe((state, previous) => {
    if (state.resolved !== previous.resolved) {
        desktop()?.setTitleBarTheme(state.resolved === 'dark');
    }
});
if (import.meta.env.DEV) {
    exposeTerminalTestHooks();
}

createRoot(document.getElementById('root')!).render(<App />);
