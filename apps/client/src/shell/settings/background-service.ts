import i18next from 'i18next';
import type { BackgroundServiceState } from '@/desktop/bridge';

/* What the Background section of This machine shows, from what the shell says about its service. */
export interface BackgroundServiceRow {
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

export const backgroundServiceRow = (state: BackgroundServiceState): BackgroundServiceRow => {
    if (state.support !== 'supported') {
        return {
            toggle: null,
            unavailable: i18next.t(`settings:backgroundService.unavailable.${state.support}`),
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
};
