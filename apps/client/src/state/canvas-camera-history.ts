import { noteJump, noteMove, settle, step } from '@/canvas/camera-history';
import { historyOf, setHistory } from '@/state/camera-history';
import type { CanvasState } from '@/state/canvas';
import { zoomNodeTargetOf, type CanvasGet, type CanvasSet } from '@/state/canvas-model';

/* The clock of the camera's bursts; a test swaps it so no assertion waits on real time. */
let now = (): number => performance.now();

export function setCameraClock(clock: () => number): void {
    now = clock;
}

// Above zero while the camera moves for a reason that is not the person's: a view loading, a size arriving.
let quiet = 0;

function quietly(action: () => void): void {
    quiet++;
    try {
        action();
    } finally {
        quiet--;
    }
}

export function cameraHistoryStep(state: CanvasState, direction: -1 | 1): ReturnType<typeof step> {
    const { viewId, camera, nodes } = state;

    return viewId === null ? null : step(historyOf(viewId), direction, camera, (id) => nodes[id] !== undefined);
}

/* The camera's jumps and bursts, recorded per view around the actions that move it. */
export function withCameraHistory(base: Omit<CanvasState, 'stepCamera'>, set: CanvasSet, get: CanvasGet): CanvasState {
    /* Records the camera a jump left and where it landed; `target` names the node it landed on, if any. */
    const jumping =
        <TArgs extends unknown[]>(action: (...args: TArgs) => void, target: (state: CanvasState, args: TArgs) => string | null) =>
        (...args: TArgs): void => {
            const { camera: from, viewId } = get();
            action(...args);
            if (viewId !== null && quiet === 0) {
                const state = get();
                setHistory(viewId, noteJump(historyOf(viewId), from, state.camera, target(state, args)));
            }
        };
    /* A pan or zoom joins the burst it belongs to. */
    const moving =
        <TArgs extends unknown[]>(action: (...args: TArgs) => void) =>
        (...args: TArgs): void => {
            const { camera: from, viewId } = get();
            action(...args);
            if (viewId !== null && quiet === 0 && get().camera !== from) {
                setHistory(viewId, noteMove(historyOf(viewId), from, now()));
            }
        };

    return {
        ...base,
        // A camera that waited for its first size lands without being a jump.
        setViewport: (viewport) => quietly(() => base.setViewport(viewport)),
        loadView: (view, local) => quietly(() => base.loadView(view, local)),
        fitAll: jumping(base.fitAll, () => null),
        zoomToSelection: jumping(base.zoomToSelection, () => null),
        goToNode: jumping(base.goToNode, (_state, [id]) => id),
        zoomToNode: jumping(base.zoomToNode, (state, [id]) => id ?? zoomNodeTargetOf(state)),
        // A card beside a node is no place the history can go back to, its node is.
        selectNeighbor: jumping(base.selectNeighbor, (state) =>
            state.navigationId === null ? null : (state.derivedCards[state.navigationId]?.owner ?? state.navigationId)
        ),
        panBy: moving(base.panBy),
        zoomAt: moving(base.zoomAt),
        zoomTo: moving(base.zoomTo),
        setPanning: (panning) => {
            base.setPanning(panning);
            const { viewId, camera } = get();
            if (!panning && viewId !== null) {
                setHistory(viewId, settle(historyOf(viewId), camera));
            }
        },
        stepCamera: (direction) => {
            const state = get();
            const { viewId } = state;
            if (viewId === null) {
                return false;
            }
            const result = cameraHistoryStep(state, direction);
            if (result === null) {
                return false;
            }
            setHistory(viewId, result.history);
            set({ camera: result.to.camera, pendingCamera: null });
            return true;
        }
    };
}
