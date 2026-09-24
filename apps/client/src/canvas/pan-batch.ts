export interface FrameClock {
    request(callback: () => void): number;
    cancel(handle: number): void;
}

const windowFrames: FrameClock = {
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (handle) => window.cancelAnimationFrame(handle)
};

export interface PanBatch {
    add(dx: number, dy: number): void;
    /* Applies what is waiting now, so a zoom that follows starts from the camera the pan left. */
    flush(): void;
}

/* A trackpad sends more wheel events than the screen draws frames, and every pan re-renders the
   canvas; one move per frame shows the same. */
export const createPanBatch = (apply: (dx: number, dy: number) => void, clock: FrameClock = windowFrames): PanBatch => {
    let pendingX = 0;
    let pendingY = 0;
    let frame: number | null = null;

    const flush = (): void => {
        if (frame !== null) {
            clock.cancel(frame);
            frame = null;
        }
        if (pendingX === 0 && pendingY === 0) {
            return;
        }
        const dx = pendingX;
        const dy = pendingY;
        pendingX = 0;
        pendingY = 0;
        apply(dx, dy);
    };

    return {
        add(dx, dy) {
            pendingX += dx;
            pendingY += dy;
            if (frame === null) {
                frame = clock.request(() => {
                    frame = null;
                    flush();
                });
            }
        },
        flush
    };
};
