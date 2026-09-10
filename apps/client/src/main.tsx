import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { startAgentNotifications } from '@/shell/notifications';
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
startAgentNotifications();
startServerInfo();
startPing();
startContextSync();
startEndpointSelection();
startInputModality();
/* The shell dresses its native chrome and every page it hosts in the theme the client is in. The
   background travels with it, so `styles.css` stays the only place the token is written down. */
const reportTheme = (): void => {
    const { theme, resolved } = useTheme.getState();
    desktop()?.setTheme?.({
        resolved,
        followsSystem: theme === 'system',
        background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    });
};
reportTheme();
useTheme.subscribe((state, previous) => {
    if (state.resolved !== previous.resolved || state.theme !== previous.theme) {
        reportTheme();
    }
});
if (import.meta.env.DEV) {
    exposeTerminalTestHooks();
}

createRoot(document.getElementById('root')!).render(<App />);
