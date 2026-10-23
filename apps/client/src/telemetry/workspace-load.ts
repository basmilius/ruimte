import { workspaceLoadMetric, type PageMetric } from './metrics';
import { recordPageMetric } from './report';

/*
 * `workspace.load`: from the moment a window starts opening a project (`enterWorkspace`, a cold start's included) to
 * the first frame the workspace drew. A workspace that shows without an open of its own, such as a rename, measures
 * nothing, and of two opens in a row only the last one counts, since it is the one that drew.
 */
export interface WorkspaceLoadClock {
    now(): number;
    nextFrame(run: () => void): void;
}

const SYSTEM_CLOCK: WorkspaceLoadClock = {
    now: () => performance.now(),
    nextFrame: (run) => requestAnimationFrame(() => run())
};

let openedAt: number | null = null;
let clock: WorkspaceLoadClock = SYSTEM_CLOCK;
let record: (metric: PageMetric) => void = recordPageMetric;

export function workspaceOpening(): void {
    openedAt = clock.now();
}

/* Called once the workspace mounted; the measurement ends at the frame after it, when it is on screen. */
export function workspaceShown(): void {
    const started = openedAt;
    if (started === null) {
        return;
    }
    openedAt = null;
    clock.nextFrame(() => record(workspaceLoadMetric(clock.now() - started)));
}

/* For a test: where the measurement goes and what it reads the time from; the returned function puts both back. */
export function measureWorkspaceLoadWith(next: { record: (metric: PageMetric) => void; clock: WorkspaceLoadClock }): () => void {
    record = next.record;
    clock = next.clock;
    return () => {
        record = recordPageMetric;
        clock = SYSTEM_CLOCK;
        openedAt = null;
    };
}
