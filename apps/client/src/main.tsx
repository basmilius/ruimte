import { ChatHostProvider, onLazyOpenError as onChatLazyOpenError } from '@adecore/agents-react';
import { onLazyOpenError, prefetcher, syncAnimations } from '@adecore/ui';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { startPageHolds } from '@/browser/page-hold';
import { refuseStrayDrops } from '@/canvas/drop';
import { CHAT_HOST, configureChat } from '@/chat/host';
import { startComputerWatch } from '@/computer/watch';
import { desktop } from '@/desktop/bridge';
import { watchDesktopUsage } from '@/desktop/usage';
import { startDeviceOperatedWatch } from '@/devices/operated';
import { startEndpointWatch } from '@/endpoint/watch';
import { applyStoredExtensionTheme } from '@/extensions/themes';
import { connectFormat } from '@/format/source';
import { initI18n } from '@/i18n';
import { startOnboarding } from '@/onboarding/open';
import { startPlanPanelWatch } from '@/plan/plan-panel-watch';
import { startProcessWarnings } from '@/processes/watch';
import { startAgentProjectWatch } from '@/project/agent-project-watch';
import { startFileReadPreparation } from '@/project/file-read-preparation';
import { startProjectList } from '@/project/list';
import { bootWindow } from '@/project/open';
import { startShowViewWatch } from '@/project/show-view-watch';
import { startWindowTabs } from '@/project/window-tabs';
import { startProposalWatch } from '@/proposals/watch';
import { startPulsarAccount } from '@/pulsar/account';
import { startAutoRegistration } from '@/pulsar/auto-register-watch';
import { startLinkRequest } from '@/pulsar/link-request';
import { startRemovalWatch } from '@/pulsar/removal-watch';
import { startSecretWatch } from '@/secrets/watch';
import { startAgentNotifications } from '@/shell/notifications';
import { reloadOnStaleChunk } from '@/stale-chunks';
import { startAgentIntegrationsPrompt } from '@/state/agent-integrations';
import { startAttentionWatch } from '@/state/attention';
import { defaultDocumentStore } from '@/state/document';
import { useFiles } from '@/state/files';
import { folderWatches } from '@/state/fs-watch';
import { startKeepAwake, startKeepAwakeMove } from '@/state/keep-awake';
import { startLastSeen } from '@/state/last-seen-watch';
import { usePalette } from '@/state/palette';
import { defaultProjectStore } from '@/state/project';
import { startRemoteStatusWatch } from '@/state/remote-status';
import { startSharedStorage } from '@/state/shared-storage';
import { startSnoozeClock } from '@/state/snooze';
import { useTheme } from '@/state/theme';
import { startWaitingSinceWatch } from '@/state/waiting';
import { startTaskWatch } from '@/tasks/watch';
import { reportCaught, startTelemetry } from '@/telemetry/report';
import { startSessionLifecycle } from '@/terminal/lifecycle';
import { exposeTerminalTestHooks } from '@/terminal/registry';
import { pool } from '@/transport';
import { startConnections } from '@/transport/connections';
import { startPing } from '@/transport/ping';
import { startProviderDetection } from '@/transport/provider-detection';
import { startServerInfo } from '@/transport/server-info';
import { startStartupReport } from '@/transport/startup-report';
import { startWakeReconnect } from '@/transport/wake';
import '@/state/theme';
import '@/state/settings';
import '@fontsource-variable/fira-code';
import '@fontsource-variable/geist';
import '@fontsource-variable/ibm-plex-sans';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@/styles.css';

startTelemetry();
// Before anything that writes a date or a number, so none of it is written in the default region first.
connectFormat();
configureChat();

/* The desktop app carries its own chunks, so one failing there is no deploy, and a reload would only drop every page. */
if (!desktop()) {
    reloadOnStaleChunk({
        target: window,
        // Reached per call, since touching `sessionStorage` throws where a browser blocks storage.
        storage: { getItem: (key) => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) },
        reload: () => window.location.reload(),
        // The entry chunk's address carries the hash of the build.
        build: import.meta.url,
        prefetching: () => prefetcher.busy,
        // The chat's surfaces load through `agents-react`'s own `lazyNamed`, so it reports apart.
        failedOpens: [onLazyOpenError, onChatLazyOpenError]
    });
}
/* First, so a window that opens beside another follows what that one changes from the start. */
startSharedStorage();
startSessionLifecycle();
startSnoozeClock();
startWaitingSinceWatch();
startAgentNotifications();
startAttentionWatch();
startServerInfo();
startPing();
startEndpointWatch();
startStartupReport();
watchDesktopUsage();
startProcessWarnings();
startTaskWatch();
startRemoteStatusWatch();
startComputerWatch();
startSecretWatch();
startProposalWatch();
startDeviceOperatedWatch();
startPlanPanelWatch();
startFileReadPreparation(defaultProjectStore, defaultDocumentStore, folderWatches, useFiles);
startConnections();
startProjectList();
startWindowTabs();
/* After the cached lists are in, so the switch screen can name the project it is opening. */
void bootWindow();
startShowViewWatch();
startAgentProjectWatch();
startPageHolds();
syncAnimations(['status-pulse']);
startKeepAwake();
startKeepAwakeMove();
/* Before the account, since a `/link` address must leave the address bar and wait for whoever signs in. */
startLinkRequest();
void startPulsarAccount();
startAutoRegistration();
startRemovalWatch();
startOnboarding();
startAgentIntegrationsPrompt();
startWakeReconnect(pool);
startProviderDetection();
startLastSeen();
refuseStrayDrops(document);
/* The background travels with the theme, so `styles.css` stays the only place the token is written down. */
function reportTheme(): void {
    const { theme, resolved } = useTheme.getState();
    desktop()?.setTheme?.({
        resolved,
        followsSystem: theme === 'system',
        background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    });
}
reportTheme();
useTheme.subscribe((state, previous) => {
    if (state.resolved !== previous.resolved || state.theme !== previous.theme) {
        reportTheme();
    }
});
// A palette that changes the ground changes it behind the page too, once it is picked: a preview stays in
// this page, since the shell would give its ground to every window.
usePalette.subscribe((state, previous) => {
    if (state.revision !== previous.revision && !state.previewing) {
        reportTheme();
    }
});
if (import.meta.env.DEV) {
    exposeTerminalTestHooks();
}

/* The words come first: a screen drawn before its language is in would swap under a person. */
await initI18n();

applyStoredExtensionTheme();

createRoot(document.getElementById('root')!, { onCaughtError: reportCaught }).render(
    <ChatHostProvider host={CHAT_HOST}>
        <App />
    </ChatHostProvider>
);
