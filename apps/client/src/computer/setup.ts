import type { ComputerGrant, ComputerUseStatus } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';

/* Where computer use on one machine stands, in the order the settings walk a person through it. */
export type ComputerSetupPhase =
    // The machine has not answered yet.
    | 'unknown'
    | 'macOnly'
    // A Mac without the helper app, such as a daemon from npm.
    | 'unavailable'
    | 'off'
    // On, but the helper has not reported its grants yet.
    | 'starting'
    | 'grants'
    | 'ready';

export type GrantState = 'granted' | 'missing' | 'unknown';

export interface ComputerSetup {
    phase: ComputerSetupPhase;
    accessibility: GrantState;
    screenRecording: GrantState;
}

export const COMPUTER_GRANTS: readonly ComputerGrant[] = ['accessibility', 'screenRecording'];

/* The panes of Privacy & Security, the same ones the desktop shell lets through (`isSystemSettingsPane`). */
export const SYSTEM_SETTINGS_PANES: Readonly<Record<ComputerGrant, string>> = {
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
};

const grantState = (granted: boolean | null): GrantState => (granted === null ? 'unknown' : granted ? 'granted' : 'missing');

/* `platform` is the daemon's, null until it said; `status` is null until it answered `computer.status`. */
export const computerSetupOf = (status: ComputerUseStatus | null, platform: string | null): ComputerSetup => {
    const accessibility = grantState(status?.accessibility ?? null);
    const screenRecording = grantState(status?.screenRecording ?? null);
    const at = (phase: ComputerSetupPhase): ComputerSetup => ({ phase, accessibility, screenRecording });
    if (platform !== null && platform !== 'darwin') {
        return at('macOnly');
    }
    if (status === null) {
        return at('unknown');
    }
    if (!status.present) {
        return at('unavailable');
    }
    if (!status.enabled) {
        return at('off');
    }
    if (accessibility === 'unknown' && screenRecording === 'unknown') {
        return at('starting');
    }
    return at(accessibility === 'granted' && screenRecording === 'granted' ? 'ready' : 'grants');
};

/* The switch means something only on a Mac that has the helper. */
export const canSwitch = (setup: ComputerSetup): boolean => setup.phase !== 'unknown' && setup.phase !== 'macOnly' && setup.phase !== 'unavailable';

/* Whether the grants are shown at all: only once computer use is on. */
export const showsGrants = (setup: ComputerSetup): boolean => setup.phase === 'starting' || setup.phase === 'grants' || setup.phase === 'ready';

/*
 * What to ask the machine when the person comes back from System Settings. Accessibility shows up in
 * a running helper; Screen Recording only in one started after the grant, so that takes a restart.
 */
export const recheckOf = (setup: ComputerSetup): 'restart' | 'status' | null => {
    if (setup.phase !== 'grants' && setup.phase !== 'starting') {
        return null;
    }
    return setup.screenRecording === 'missing' ? 'restart' : 'status';
};

/* System Settings opens only on the Mac this window runs on, through a shell that can open it. */
export const opensSystemSettings = (endpointId: string, platform: string | null, shellOpens: boolean): boolean =>
    shellOpens && endpointId === LOCAL_ENDPOINT_ID && platform === 'darwin';
