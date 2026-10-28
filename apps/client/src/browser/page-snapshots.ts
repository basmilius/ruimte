import { browserRegistry } from '@/browser/registry';
import { create } from 'zustand';
import { endpointKey, useEndpointId } from '@/state/keys';

/*
 * The last picture of every page past the render distance, and whether it is past it. Only the parking
 * layer decides `far` (`WebviewParking.tsx`) and the plate only reads it, so the host and the plate
 * never disagree about which of the two a person sees.
 *
 * A hidden guest cannot be photographed: Chromium never answers `capturePage` for it, with or without
 * `stayHidden`. So a page is photographed while it is still drawn, on its way out, and a page that is
 * already far is drawn again for the moment it takes, transparent (`revealing`), and hidden after.
 */
export interface PageSnapshot {
    far: boolean;
    imageUrl: string | null;
    takenAt: number | null;
    /* New on every turn between near and far and never used twice, so a picture that comes back too late,
       even for an earlier page under the same key, is thrown away. */
    generation: number;
    /* While above zero the page stays drawn, transparent once far, so the shell can photograph it. */
    revealing: number;
    /* Which entry under this key this is, so a picture of a page that closed never touches the next one. */
    life: number;
}

interface PageSnapshotStore {
    byKey: Record<string, PageSnapshot>;
}

export const usePageSnapshots = create<PageSnapshotStore>(() => ({ byKey: {} }));

/* Whether the page of this node is past the render distance, as the parking layer decided it. */
export function usePageFar(id: string): boolean {
    const key = endpointKey(useEndpointId(), id);
    return usePageSnapshots((s) => s.byKey[key]?.far === true);
}

const EMPTY: PageSnapshot = { far: false, imageUrl: null, takenAt: null, generation: 0, revealing: 0, life: 0 };

/* How long a page waits for its picture before it lets go of the screen anyway, counted from the moment it was asked to go. */
export const HIDE_DEADLINE_MS = 300;
/* Pictures taken at once over every page, so zooming out over thirty pages is no spike of thirty. */
export const MAX_CAPTURES = 2;

export interface SnapshotDeps {
    capture(key: string): Promise<Uint8Array | null>;
    /* The picture at most `width` pixels wide, in a format that keeps it small. */
    shrink(png: Uint8Array, width: number): Promise<Blob | null>;
    createUrl(blob: Blob): string;
    revokeUrl(url: string): void;
    setTimer(run: () => void, ms: number): unknown;
    clearTimer(timer: unknown): void;
    now(): number;
    /* Resolves once a page the layer just drew again is on screen and can be photographed. */
    drawn(): Promise<void>;
}

interface Job {
    key: string;
    generation: number;
    width: number;
}

interface Leaving {
    generation: number;
    timer: unknown;
}

export class PageSnapshots {
    private readonly deps: SnapshotDeps;
    private readonly leaving = new Map<string, Leaving>();
    private readonly widths = new Map<string, number>();
    private readonly busy = new Set<string>();
    private queue: Job[] = [];
    private running = 0;
    private generations = 0;
    private lives = 0;
    /* Asked again before a page goes: what made it go may have passed while its picture was taken. */
    private stillFar: (key: string) => boolean = () => true;

    constructor(deps: SnapshotDeps) {
        this.deps = deps;
    }

    judge(stillFar: (key: string) => boolean): void {
        this.stillFar = stillFar;
    }

    of(key: string): PageSnapshot {
        return usePageSnapshots.getState().byKey[key] ?? EMPTY;
    }

    /* Whether the page is far or on its way there, which is what the pause before going no longer applies to. */
    goingFar(key: string): boolean {
        return this.of(key).far || this.leaving.has(key);
    }

    /*
     * Where a page the layer would draw stands, given whether the distance wants it gone. Answers
     * whether its host is hidden now. A page asked to go is photographed first and goes once the
     * picture is in or the deadline passed, whichever comes first.
     */
    settle(key: string, wantsFar: boolean, width: number): boolean {
        this.widths.set(key, width);
        const current = this.of(key);
        if (!wantsFar) {
            if (current.far || this.leaving.has(key)) {
                this.endLeaving(key);
                this.patch(key, { far: false, generation: ++this.generations });
            }
            return false;
        }
        if (current.far) {
            return true;
        }
        if (!this.leaving.has(key)) {
            const generation = ++this.generations;
            this.patch(key, { generation });
            const timer = this.deps.setTimer(() => {
                // A picture already under way is of a drawn page and in within tens of milliseconds; hiding the
                // page under it would leave the shell waiting for good, so that picture ends the wait instead.
                if (!this.busy.has(key)) {
                    this.go(key, generation);
                }
            }, HIDE_DEADLINE_MS);
            this.leaving.set(key, { generation, timer });
            this.enqueue({ key, generation, width });
        }
        return false;
    }

    /* A far page that loaded something new, such as a page an agent drives: its plate takes the new picture. */
    refresh(key: string): void {
        const current = this.of(key);
        const width = this.widths.get(key);
        if (current.far && width !== undefined) {
            this.enqueue({ key, generation: current.generation, width });
        }
    }

    /*
     * A picture of the page for whoever asks, such as an agent; a far page is drawn for the moment it
     * takes. A near page is held drawn as well, since its own picture may send it far meanwhile.
     */
    photograph(key: string): Promise<Uint8Array | null> {
        return this.revealed(key);
    }

    /* The page is gone; its picture goes with it. */
    forget(key: string): void {
        this.endLeaving(key);
        this.widths.delete(key);
        this.queue = this.queue.filter((job) => job.key !== key);
        const current = usePageSnapshots.getState().byKey[key];
        if (current === undefined) {
            return;
        }
        if (current.imageUrl !== null) {
            this.deps.revokeUrl(current.imageUrl);
        }
        usePageSnapshots.setState((state) => {
            const { [key]: _gone, ...byKey } = state.byKey;
            return { byKey };
        });
    }

    /* Forgets every page that is no longer among `keys`. */
    keep(keys: readonly string[]): void {
        const kept = new Set(keys);
        // A page that closed before it ever went far has a width and no entry.
        for (const key of new Set([...Object.keys(usePageSnapshots.getState().byKey), ...this.widths.keys()])) {
            if (!kept.has(key)) {
                this.forget(key);
            }
        }
    }

    private go(key: string, generation: number): void {
        const leaving = this.leaving.get(key);
        if (leaving === undefined || leaving.generation !== generation) {
            return;
        }
        this.endLeaving(key);
        if (this.stillFar(key)) {
            this.patch(key, { far: true });
        }
    }

    private endLeaving(key: string): void {
        const leaving = this.leaving.get(key);
        if (leaving !== undefined) {
            this.deps.clearTimer(leaving.timer);
            this.leaving.delete(key);
        }
    }

    private enqueue(job: Job): void {
        // One picture per page at a time: a newer ask replaces one that has not started.
        this.queue = [...this.queue.filter((queued) => queued.key !== job.key), job];
        this.next();
    }

    private next(): void {
        while (this.running < MAX_CAPTURES) {
            const index = this.queue.findIndex((job) => !this.busy.has(job.key));
            if (index === -1) {
                return;
            }
            const [job] = this.queue.splice(index, 1);
            this.running += 1;
            this.busy.add(job!.key);
            void this.run(job!).finally(() => {
                this.running -= 1;
                this.busy.delete(job!.key);
                this.next();
            });
        }
    }

    private async run(job: Job): Promise<void> {
        if (this.of(job.key).generation !== job.generation) {
            return;
        }
        // A page that went while its picture waited in line is far by now, and only drawn again can it be taken.
        const png = this.of(job.key).far ? await this.revealed(job.key) : await this.deps.capture(job.key);
        const blob = png === null ? null : await this.deps.shrink(png, job.width).catch(() => null);
        const current = usePageSnapshots.getState().byKey[job.key];
        if (blob !== null && current !== undefined && current.generation === job.generation) {
            if (current.imageUrl !== null) {
                this.deps.revokeUrl(current.imageUrl);
            }
            this.patch(job.key, { imageUrl: this.deps.createUrl(blob), takenAt: this.deps.now() });
        }
        this.go(job.key, job.generation);
    }

    private async revealed(key: string): Promise<Uint8Array | null> {
        this.patch(key, { revealing: this.of(key).revealing + 1 });
        const { life, far } = this.of(key);
        const alive = (): boolean => usePageSnapshots.getState().byKey[key]?.life === life;
        try {
            if (far) {
                await this.deps.drawn();
            }
            // A page that went away while it was being drawn again has nothing left to photograph.
            return alive() ? await this.deps.capture(key) : null;
        } finally {
            if (alive()) {
                this.patch(key, { revealing: Math.max(0, this.of(key).revealing - 1) });
            }
        }
    }

    private patch(key: string, patch: Partial<PageSnapshot>): void {
        usePageSnapshots.setState((state) => ({
            byKey: { ...state.byKey, [key]: { ...(state.byKey[key] ?? { ...EMPTY, life: ++this.lives }), ...patch } }
        }));
    }
}

function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function shrinkToWebp(png: Uint8Array, width: number): Promise<Blob | null> {
    const bitmap = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
    try {
        const scale = Math.min(1, width / bitmap.width);
        const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
        const context = canvas.getContext('2d');
        if (context === null) {
            return null;
        }
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
    } finally {
        bitmap.close();
    }
}

export const pageSnapshots = new PageSnapshots({
    capture: (key) => browserRegistry.capture(key),
    shrink: shrinkToWebp,
    createUrl: (blob) => URL.createObjectURL(blob),
    revokeUrl: (url) => URL.revokeObjectURL(url),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
    // The layer draws the page again in the next frame, and the guest hands the shell a frame of its own after that.
    drawn: async () => {
        for (let i = 0; i < 3; i++) {
            await nextFrame();
        }
    }
});
