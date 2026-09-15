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

const UNAVAILABLE: Record<Exclude<BackgroundServiceState['support'], 'supported'>, string> = {
    dev: 'The dev app always runs a machine of its own and stops it when it quits.',
    windows: 'Not available on Windows yet, so this machine stops when Ruimte quits.',
    appimage: 'Not available for the AppImage, which is gone once Ruimte quits. Install the deb or rpm package to keep this machine running.'
};

export const backgroundServiceRow = (state: BackgroundServiceState): BackgroundServiceRow => {
    if (state.support !== 'supported') {
        return {
            toggle: null,
            unavailable: UNAVAILABLE[state.support],
            pending: null,
            failure: state.failure,
            canStop: false,
            offerLinger: false,
            lingerOn: false
        };
    }
    let pending: string | null = null;
    if (state.keepRunning && state.owner === 'app') {
        pending = 'Ruimte runs this machine itself right now. It keeps running from the next time Ruimte quits.';
    } else if (!state.keepRunning && state.owner === 'service') {
        pending = 'This machine stops when Ruimte quits, and Ruimte runs it itself from the next start.';
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
