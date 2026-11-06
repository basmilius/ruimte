import i18next, { type TFunction } from 'i18next';
import type { BackgroundServiceState, MachineStopPreview } from '@/desktop/bridge';

/* What the Background section of This machine shows, from what the shell says about its service. */
interface BackgroundServiceRow {
    /* The switch, or null where there is no service and `unavailable` says why. */
    toggle: { checked: boolean } | null;
    unavailable: string | null;
    /* What happens at the next quit when the switch and the daemon that runs do not agree yet. */
    pending: string | null;
    failure: string | null;
    /* Stopping only means something while the service runs the machine. */
    canStop: boolean;
    /* Linux with the switch on and services that end with the session. */
    offerLinger: boolean;
    lingerOn: boolean;
}

export function backgroundServiceRow(state: BackgroundServiceState): BackgroundServiceRow {
    if (state.support !== 'supported' || state.commandLineService === true) {
        return {
            toggle: null,
            unavailable: i18next.t(`settings:backgroundService.unavailable.${state.support === 'supported' ? 'commandLine' : state.support}`),
            pending: null,
            failure: state.failure,
            canStop: false,
            offerLinger: false,
            lingerOn: false
        };
    }
    let pending: string | null = null;
    if (state.keepRunning && state.owner === 'app') {
        pending = i18next.t('settings:backgroundService.pending.takeOver');
    } else if (!state.keepRunning && state.owner === 'service') {
        pending = i18next.t('settings:backgroundService.pending.handBack');
    }
    return {
        toggle: { checked: state.keepRunning },
        unavailable: null,
        pending,
        failure: state.failure,
        canStop: state.owner === 'service',
        offerLinger: state.keepRunning && state.linger === false,
        lingerOn: state.keepRunning && state.linger === true
    };
}

const STOP = 'settings:backgroundService.confirmStopRunning';

/* The sentences of the question before the app stops running a machine; null is the preview that has not answered yet. */
export function stopRunningLines(preview: MachineStopPreview | null, t: TFunction = i18next.t): string[] {
    if (preview === null) {
        return [t(`${STOP}.checking`)];
    }
    if (preview.commandLine) {
        return [t(`${STOP}.commandLine`)];
    }
    const lines: string[] = [];
    if (preview.work !== null) {
        const { agents, terminals } = preview.work;
        if (agents > 0 && terminals > 0) {
            const both = t(`${STOP}.both`, { agents: t(`${STOP}.agentCount`, { count: agents }), terminals: t(`${STOP}.terminalCount`, { count: terminals }) });
            lines.push(both.charAt(0).toUpperCase() + both.slice(1));
        } else if (agents > 0) {
            lines.push(t(`${STOP}.agents`, { count: agents }));
        } else if (terminals > 0) {
            lines.push(t(`${STOP}.terminals`, { count: terminals }));
        } else {
            lines.push(t(`${STOP}.nothing`));
        }
    }
    // An empty home is a machine that could not say where it keeps its data.
    lines.push(preview.home === '' ? t(`${STOP}.dataAnywhere`) : t(`${STOP}.data`, { home: preview.home }));
    return lines;
}
