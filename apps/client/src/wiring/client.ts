import { onLazyOpenError as onChatLazyOpenError } from '@adecore/agents-react';
import { onLazyOpenError, prefetcher, syncAnimations } from '@adecore/ui';
import { startAgentNotifications } from '@/attention/notifications';
import { startPageHolds } from '@/browser/page-hold';
import { startProjectList } from '@/clients/project/list';
import { exposeTerminalTestHooks } from '@/clients/terminal/registry';
import { startComputerWatch } from '@/computer/watch';
import { startAgentIntegrationsPrompt } from '@/controllers/agent-integrations';
import { startKeepAwake, startKeepAwakeMove } from '@/controllers/keep-awake';
import { startLastSeen } from '@/controllers/last-seen-watch';
import { startRemoteStatusWatch } from '@/controllers/remote-status';
import { desktop } from '@/desktop/bridge';
import { startDeviceOperatedWatch } from '@/devices/operated';
import { connectFormat } from '@/format/source';
import { startOnboarding } from '@/onboarding/open';
import { startPlanPanelWatch } from '@/plan/plan-panel-watch';
import { startProcessWarnings } from '@/processes/watch';
import { bootWindow } from '@/project/open';
import { startShowViewWatch } from '@/project/show-view-watch';
import { startWindowTabs } from '@/project/window-tabs';
import { startProposalWatch } from '@/proposals/watch';
import { startPulsarAccount } from '@/pulsar/account';
import { startLinkRequest } from '@/pulsar/link-request';
import { startSecretWatch } from '@/secrets/watch';
import { startSharedStorage } from '@/shared-storage';
import { watchDesktopUsage } from '@/shell/command-usage';
import { reloadOnStaleChunk } from '@/stale-chunks';
import { startAttentionWatch } from '@/state/attention';
import { usePalette } from '@/state/palette';
import { startSnoozeClock } from '@/state/snooze';
import { useTheme } from '@/state/theme';
import { startWaitingSinceWatch } from '@/state/waiting';
import { refuseStrayDrops } from '@/surface/canvas/drop';
import { startTaskWatch } from '@/tasks/watch';
import { startTelemetry } from '@/telemetry/report';
import { pool } from '@/transport';
import { startPing } from '@/transport/ping';
import { startProviderDetection } from '@/transport/provider-detection';
import { startStartupReport } from '@/transport/startup-report';
import { startWakeReconnect } from '@/transport/wake';
import { configureClient } from '@/wiring/client-config';
import { installClientHooks, type ClientHooks } from '@/wiring/client-hooks';
import { startAutoRegistration } from '@/workspace/auto-register-watch';
import { startConnections } from '@/workspace/connections';
import { startRemovalWatch } from '@/workspace/removal-watch';
import { startServerInfo } from '@/workspace/server-info';
import { startSessionLifecycle } from '@/workspace/session-lifecycle';
import { startEndpointWatch } from '@/workspace/watch';

/* One thing the client starts, with the reason it stands where it does in the order. */
interface Step {
    readonly name: string;
    start(): (() => void) | Promise<unknown> | null | void;
}

function reportTheme(): void {
    const { theme, resolved } = useTheme.getState();
    desktop()?.setTheme?.({
        resolved,
        followsSystem: theme === 'system',
        background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    });
}

/* The background travels with the theme, so `styles.css` stays the only place the token is written down. */
function followThemeInShell(): () => void {
    reportTheme();
    const offTheme = useTheme.subscribe((state, previous) => {
        if (state.resolved !== previous.resolved || state.theme !== previous.theme) {
            reportTheme();
        }
    });
    // A palette that changes the ground changes it behind the page too, once it is picked: a preview stays in
    // this page, since the shell would give its ground to every window.
    const offPalette = usePalette.subscribe((state, previous) => {
        if (state.revision !== previous.revision && !state.previewing) {
            reportTheme();
        }
    });

    return () => {
        offTheme();
        offPalette();
    };
}

/* The desktop app carries its own chunks, so one failing there is no deploy, and a reload would only drop every page. */
function reloadOnStaleChunks(): void {
    if (desktop()) {
        return;
    }
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

/*
 * The order is the one the client needs, not alphabetical: each step names why it is where it is. The
 * hooks come first, so nothing below runs an action or opens a machine before they are installed.
 */
const STEPS: readonly Step[] = [
    { name: 'telemetry', start: startTelemetry },
    // Before anything that writes a date or a number, so none of it is written in the default region first.
    { name: 'format', start: connectFormat },
    { name: 'staleChunks', start: reloadOnStaleChunks },
    // Before every other watcher, so a window that opens beside another follows what that one changes from the start.
    { name: 'sharedStorage', start: startSharedStorage },
    { name: 'sessionLifecycle', start: startSessionLifecycle },
    { name: 'snoozeClock', start: startSnoozeClock },
    { name: 'waitingSince', start: startWaitingSinceWatch },
    { name: 'agentNotifications', start: () => startAgentNotifications() },
    { name: 'attention', start: startAttentionWatch },
    { name: 'serverInfo', start: startServerInfo },
    { name: 'ping', start: startPing },
    { name: 'endpoints', start: startEndpointWatch },
    { name: 'startupReport', start: startStartupReport },
    { name: 'desktopUsage', start: watchDesktopUsage },
    { name: 'processWarnings', start: startProcessWarnings },
    { name: 'tasks', start: startTaskWatch },
    { name: 'remoteStatus', start: startRemoteStatusWatch },
    { name: 'computer', start: startComputerWatch },
    { name: 'secrets', start: startSecretWatch },
    { name: 'proposals', start: startProposalWatch },
    { name: 'deviceOperated', start: startDeviceOperatedWatch },
    { name: 'planPanel', start: startPlanPanelWatch },
    { name: 'connections', start: startConnections },
    { name: 'projectList', start: startProjectList },
    { name: 'windowTabs', start: startWindowTabs },
    // After the cached lists are in, so the switch screen can name the project it is opening.
    { name: 'bootWindow', start: bootWindow },
    { name: 'showView', start: startShowViewWatch },
    { name: 'pageHolds', start: startPageHolds },
    { name: 'animations', start: () => syncAnimations(['status-pulse']) },
    { name: 'keepAwake', start: () => startKeepAwake() },
    { name: 'keepAwakeMove', start: () => startKeepAwakeMove() },
    // Before the account, since a `/link` address must leave the address bar and wait for whoever signs in.
    { name: 'linkRequest', start: startLinkRequest },
    { name: 'pulsarAccount', start: startPulsarAccount },
    { name: 'autoRegistration', start: startAutoRegistration },
    { name: 'removal', start: startRemovalWatch },
    { name: 'onboarding', start: startOnboarding },
    { name: 'agentIntegrations', start: startAgentIntegrationsPrompt },
    { name: 'wakeReconnect', start: () => startWakeReconnect(pool) },
    { name: 'providerDetection', start: startProviderDetection },
    { name: 'lastSeen', start: startLastSeen },
    { name: 'strayDrops', start: () => refuseStrayDrops(document) },
    { name: 'shellTheme', start: followThemeInShell },
    { name: 'terminalTestHooks', start: () => (import.meta.env.DEV ? exposeTerminalTestHooks() : undefined) }
];

/* What the client started, for the code that draws the window and for whoever wants to stop it. */
export interface ClientWiring {
    readonly hooks: ClientHooks;
    stop(): void;
}

/* The one place the client's boot order lives; `main.tsx` calls it and renders. */
export function wireClient(): ClientWiring {
    const hooks = installClientHooks();
    configureClient();
    const stops: (() => void)[] = [];

    for (const step of STEPS) {
        const stop = step.start();

        if (typeof stop === 'function') {
            stops.push(stop);
        } else if (stop instanceof Promise) {
            void stop;
        }
    }

    return {
        hooks,
        stop: () => {
            for (const stop of stops.toReversed()) {
                stop();
            }
        }
    };
}
