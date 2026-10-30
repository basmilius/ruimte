import { emptyCameraHistory, type CameraHistory } from '@/canvas/camera-history';

/*
 * Per view and in memory only: a canvas store is dropped when its view leaves the grid, and the way
 * back must outlive that. It never reaches the project files and does not survive a reload.
 */
const histories = new Map<string, CameraHistory>();
const listeners = new Set<() => void>();

export function subscribeCameraHistories(listener: () => void): () => void {
    listeners.add(listener);

    return () => listeners.delete(listener);
}

export function historyOf(viewId: string): CameraHistory {
    return histories.get(viewId) ?? emptyCameraHistory();
}

export function setHistory(viewId: string, history: CameraHistory): void {
    histories.set(viewId, history);

    for (const listener of [...listeners]) {
        listener();
    }
}

/* A project that unloads takes its views with it. */
export function forgetCameraHistories(): void {
    histories.clear();

    for (const listener of [...listeners]) {
        listener();
    }
}
