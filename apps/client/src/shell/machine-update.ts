import i18next from 'i18next';
import type { BackgroundServiceBridge, BackgroundServiceState } from '@/desktop/bridge';

export interface MachineUpdatePrompt {
    title: string;
    description: string;
}

const endsWhat = (work: number | null): string =>
    work === null ? i18next.t('shell:machineUpdate.endsUnknown') : i18next.t('shell:machineUpdate.ends', { count: work });

/*
 * The question after an update, while the service still runs the older build because work was
 * running on it. Asked once: "When idle" answers it for this session, and a shell without the two
 * answers on its bridge never gets asked something it cannot carry out.
 */
export const machineUpdatePrompt = (
    state: BackgroundServiceState | null,
    bridge: Pick<BackgroundServiceBridge, 'restartNow' | 'restartWhenIdle'>
): MachineUpdatePrompt | null => {
    const pending = state?.pendingRestart ?? null;
    if (pending === null || pending.answered || !bridge.restartNow || !bridge.restartWhenIdle) {
        return null;
    }
    return { title: i18next.t('shell:machineUpdate.title'), description: i18next.t('shell:machineUpdate.description', { ends: endsWhat(pending.work) }) };
};

export type MachineUpdateAnswer = 'restart-now' | 'when-idle';

/* Anything but the restart button (the other button, Escape, a click beside the dialog) leaves the machine running. */
export const machineUpdateAnswer = (action: 'restart' | 'idle' | 'dismiss'): MachineUpdateAnswer => (action === 'restart' ? 'restart-now' : 'when-idle');

/* The line in This machine while the older build keeps running, which is where "Restart now" stays reachable. */
export const pendingRestartLine = (state: BackgroundServiceState): string | null =>
    state.pendingRestart ? i18next.t('shell:machineUpdate.pendingLine') : null;
