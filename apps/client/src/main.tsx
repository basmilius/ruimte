import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { startAgentNotifications } from '@/shell/notifications';
import { startAttentionWatch } from '@/state/attention';
import { startSessionLifecycle } from '@/terminal/lifecycle';
import { startServerInfo } from '@/transport/server-info';
import { startPing } from '@/transport/ping';
import { startEndpointSelection } from '@/endpoint';
import { startEndpointWatch } from '@/endpoint/watch';
import { startProcessWarnings } from '@/processes/watch';
import { startProjectList } from '@/project/list';
import { startShowViewWatch } from '@/project/show-view-watch';
import { restoreLastEndpoint } from '@/project/open';
import { startConnections } from '@/transport/connections';
import { startPulsarAccount } from '@/pulsar/account';
import { desktop } from '@/desktop/bridge';
import { startKeepAwake } from '@/state/keep-awake';
import { startInputModality } from '@/ui/modality';
import { useTheme } from '@/state/theme';
import { exposeTerminalTestHooks } from '@/terminal/registry';
import '@/state/theme';
import '@/state/settings';
import '@fontsource-variable/geist';
import '@xterm/xterm/css/xterm.css';
import '@/styles.css';

startSessionLifecycle();
startAgentNotifications();
startAttentionWatch();
startServerInfo();
startPing();
/* Before anything opens a socket: the machine the work was left on decides which daemon boots. */
restoreLastEndpoint();
startEndpointSelection();
startEndpointWatch();
startProcessWarnings();
startConnections();
startProjectList();
startShowViewWatch();
startInputModality();
startKeepAwake();
void startPulsarAccount();
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
