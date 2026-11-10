import { messageOf } from '@adecore/ui';
import { isCanvasView, type RoutineEntry } from '@ruimte/contracts';
import i18next from 'i18next';
import { createNodeAction } from '@/action-port/person-actions';
import { showView } from '@/project/views';
import { refreshRoutines } from '@/routines/routine-list';
import { canvasSettled } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { leaveRoutines } from '@/state/routines-stage';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport';

function failed(e: unknown): void {
    useToasts.getState().show({ kind: 'error', title: messageOf(e, i18next.t('routines:actions.failed')) });
}

/* Starts a run now, the way the stage and the node both offer it. Resolves the run's id, or null when nothing started. */
export async function runRoutineNow(endpointId: string, entry: RoutineEntry): Promise<string | null> {
    try {
        const answer = await machineTransport(endpointId).request('routine.runNow', { projectId: entry.projectId, routineId: entry.routine.id });
        if (answer.outcome === 'started') {
            refreshRoutines(endpointId);
            return answer.runId ?? null;
        }
        useToasts.getState().show({ kind: 'error', title: i18next.t(answer.outcome === 'held' ? 'routines:actions.runHeld' : 'routines:actions.runBusy') });
    } catch (e) {
        failed(e);
    }
    return null;
}

export function setRoutinePaused(endpointId: string, entry: RoutineEntry, paused: boolean): void {
    machineTransport(endpointId)
        .request(paused ? 'routine.pause' : 'routine.resume', { projectId: entry.projectId, routineId: entry.routine.id })
        .then(() => refreshRoutines(endpointId))
        .catch(failed);
}

function routineCanvasId(): string | null {
    const { views, activeViewId } = useDocument.getState();
    const canvases = views.filter((view) => isCanvasView(view) && view.hidden !== true);
    return (canvases.find((view) => view.id === activeViewId) ?? canvases[0])?.id ?? null;
}

export async function showRoutineOnCanvas(entry: RoutineEntry): Promise<void> {
    const viewId = routineCanvasId();
    if (viewId === null) {
        return;
    }
    leaveRoutines();
    showView(viewId);
    if (!(await canvasSettled(viewId))) {
        return;
    }
    await createNodeAction('routine', { viewId, routine: entry.routine.id, title: entry.routine.title });
}
