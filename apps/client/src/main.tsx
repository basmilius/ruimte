import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { initI18n } from '@/i18n';
import { startAgentNotifications } from '@/shell/notifications';
import { startAttentionWatch } from '@/state/attention';
import { startSnoozeClock } from '@/state/snooze';
import { startSessionLifecycle } from '@/terminal/lifecycle';
import { startServerInfo } from '@/transport/server-info';
import { startPing } from '@/transport/ping';
import { startEndpointWatch } from '@/endpoint/watch';
import { startProcessWarnings } from '@/processes/watch';
import { startTaskWatch } from '@/tasks/watch';
import { startComputerWatch } from '@/computer/watch';
import { startPlanPanelWatch } from '@/plan/plan-panel-watch';
import { startProjectList } from '@/project/list';
import { startPageHolds } from '@/browser/page-hold';
import { startShowViewWatch } from '@/project/show-view-watch';
import { bootWindow } from '@/project/open';
import { startConnections } from '@/transport/connections';
import { startPulsarAccount } from '@/pulsar/account';
import { startLinkRequest } from '@/pulsar/link-request';
import { startAutoRegistration } from '@/pulsar/auto-register-watch';
import { startRemovalWatch } from '@/pulsar/removal-watch';
import { pool } from '@/transport';
import { startWakeReconnect } from '@/transport/wake';
import { desktop } from '@/desktop/bridge';
import { startKeepAwake } from '@/state/keep-awake';
import { startLastSeen } from '@/state/last-seen-watch';
import { startInputModality } from '@/ui/modality';
import { refuseStrayDrops } from '@/canvas/drop';
import { useTheme } from '@/state/theme';
import { exposeTerminalTestHooks } from '@/terminal/registry';
import { reloadOnStaleChunk } from '@/stale-chunks';
import { prefetcher } from '@/ui/prefetch';
import '@/state/theme';
import '@/state/settings';
import '@fontsource-variable/geist';
import '@xterm/xterm/css/xterm.css';
import '@/styles.css';

/* The desktop app carries its own chunks, so one failing there is no deploy, and a reload would only drop every page. */
if (!desktop()) {
    reloadOnStaleChunk({
        target: window,
        // Reached per call, since touching `sessionStorage` throws where a browser blocks storage.
        storage: { getItem: (key) => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) },
        reload: () => window.location.reload(),
        // The entry chunk's address carries the hash of the build.
        build: import.meta.url,
        prefetching: () => prefetcher.busy
    });
}
startSessionLifecycle();
startSnoozeClock();
startAgentNotifications();
startAttentionWatch();
startServerInfo();
startPing();
startEndpointWatch();
startProcessWarnings();
startTaskWatch();
startComputerWatch();
startPlanPanelWatch();
startConnections();
startProjectList();
/* After the cached lists are in, so the switch screen can name the project it is opening. */
void bootWindow();
startShowViewWatch();
startPageHolds();
startInputModality();
startKeepAwake();
/* Before the account, since a `/link` address must leave the address bar and wait for whoever signs in. */
startLinkRequest();
void startPulsarAccount();
startAutoRegistration();
startRemovalWatch();
startWakeReconnect(pool);
startLastSeen();
refuseStrayDrops(document);
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

/* The words come first. A screen drawn before its language is in is a screen in the wrong one,
   and swapping it under a person is worse than the moment it takes to load. */
await initI18n();

createRoot(document.getElementById('root')!).render(<App />);
