import i18next from 'i18next';
import { create } from 'zustand';
import type { BackgroundServiceBridge, BackgroundServiceState, MachineStopPreview } from '@/desktop/bridge';

interface MachineUpdatePrompt {
    title: string;
    description: string;
}

/* The question asked again from the rail, with what runs on the machine at that moment. */
interface MachineUpdateAgain {
    work: number | null;
}

/* Null while nobody asked the question again. Kept per window, since the rail that asks is the window's own. */
export const useMachineUpdateAgain = create<{ again: MachineUpdateAgain | null }>(() => ({ again: null }));

function endsWhat(work: number | null): string {
    return work === null ? i18next.t('shell:machineUpdate.endsUnknown') : i18next.t('shell:machineUpdate.ends', { count: work });
}

/*
 * The question after an update, while the service still runs the older build because work was
 * running on it. Asked once by itself: "When idle" answers it for this session, and after that only
 * `again` asks it. A shell without the two answers on its bridge never gets asked something it
 * cannot carry out.
 */
export function machineUpdatePrompt(
    state: BackgroundServiceState | null,
    bridge: Pick<BackgroundServiceBridge, 'restartNow' | 'restartWhenIdle'>,
    again: MachineUpdateAgain | null = null
): MachineUpdatePrompt | null {
    const pending = state?.pendingRestart ?? null;
    if (pending === null || !bridge.restartNow || !bridge.restartWhenIdle) {
        return null;
    }

    if (pending.answered && again === null) {
        return null;
    }

    const work = again === null ? pending.work : again.work;

    return { title: i18next.t('shell:machineUpdate.title'), description: i18next.t('shell:machineUpdate.description', { ends: endsWhat(work) }) };
}

export type MachineUpdateAnswer = 'restart-now' | 'when-idle';

/* Anything but the restart button (the other button, Escape, a click beside the dialog) leaves the machine running. */
export function machineUpdateAnswer(action: 'restart' | 'idle' | 'dismiss'): MachineUpdateAnswer {
    return action === 'restart' ? 'restart-now' : 'when-idle';
}

/* The line in This machine while the older build keeps running, which is where "Restart now" stays reachable. */
export function pendingRestartLine(state: BackgroundServiceState): string | null {
    return state.pendingRestart ? i18next.t('shell:machineUpdate.pendingLine') : null;
}

/* Whether the rail keeps its mark: "When idle" was picked and the older build still runs. */
export function showsPendingRestart(state: BackgroundServiceState | null, bridge: Pick<BackgroundServiceBridge, 'restartNow' | 'restartWhenIdle'>): boolean {
    return state?.pendingRestart?.answered === true && bridge.restartNow !== undefined && bridge.restartWhenIdle !== undefined;
}

/* What a restart ends now. Null when the machine cannot say, rather than the count from the start of the session. */
function workNow(preview: MachineStopPreview | null): number | null {
    return preview?.work ? preview.work.terminals + preview.work.agents : null;
}

/* Opens the question once more, after asking the machine what runs on it now. */
export async function askMachineUpdateAgain(stopPreview: (() => Promise<MachineStopPreview>) | undefined): Promise<void> {
    const preview = stopPreview ? await stopPreview().catch(() => null) : null;
    useMachineUpdateAgain.setState({ again: { work: workNow(preview) } });
}
