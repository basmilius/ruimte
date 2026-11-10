import { windowFrames, type FrameClock } from '@/surface/canvas/pan-batch';

interface FrameRun {
    request(): void;
    dispose(): void;
}

/*
 * Runs `run` at most once per frame. The first request of a frame runs at the end of its task, not in
 * the next frame: the camera moves inside a frame callback, and a page placed a frame later would trail
 * its node. A request after that in the same frame waits for the next one.
 */
export function oncePerFrame(run: () => void, clock: FrameClock = windowFrames, microtask: (callback: () => void) => void = queueMicrotask): FrameRun {
    let queued = false;
    let deferred: number | null = null;
    let reset: number | null = null;
    let ranThisFrame = false;
    let disposed = false;

    const fire = (): void => {
        if (disposed) {
            return;
        }
        ranThisFrame = true;
        reset ??= clock.request(() => {
            reset = null;
            ranThisFrame = false;
        });
        run();
    };

    return {
        request() {
            if (disposed || queued || deferred !== null) {
                return;
            }
            if (ranThisFrame) {
                deferred = clock.request(() => {
                    deferred = null;
                    fire();
                });
                return;
            }
            queued = true;
            microtask(() => {
                queued = false;
                fire();
            });
        },
        dispose() {
            disposed = true;
            for (const handle of [deferred, reset]) {
                if (handle !== null) {
                    clock.cancel(handle);
                }
            }
            deferred = null;
            reset = null;
        }
    };
}
