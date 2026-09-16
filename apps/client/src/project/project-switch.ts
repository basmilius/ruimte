import { createStore, type StoreApi } from 'zustand';
import type { ProjectSummary } from '@ruimte/contracts';

/* Long enough that a switch on a machine that is already connected never flashes a screen, short enough that a wait is never silent. */
export const REVEAL_DELAY_MS = 300;

/* What a switch is on its way to, with whatever the cached list knew about it to name it on screen. */
export interface SwitchTarget {
    endpointId: string;
    /* The project from the cached list, or null for a folder, a new project, or a project the list does not have. */
    summary: ProjectSummary | null;
    folder: string | null;
    /* What a new project is to be called. */
    name: string | null;
}

export type SwitchState =
    | { kind: 'idle' }
    /* `visible` turns on after `REVEAL_DELAY_MS`; before that the screen draws nothing. */
    | { kind: 'connecting' | 'opening' | 'returning'; target: SwitchTarget; visible: boolean }
    | { kind: 'failed'; target: SwitchTarget; reason: string };

export type SwitchOutcome = 'done' | 'failed' | 'cancelled' | 'replaced';

export interface SwitchContext {
    /* Aborts when the person cancels or another switch takes over; the run stops at its next step. */
    signal: AbortSignal;
    /* The machine answered, and what is left is opening the project on it. */
    opening(): void;
}

/* One try at a switch. `back` undoes whatever `steps` moved, and knows best what that was. */
export interface SwitchRun {
    steps(context: SwitchContext): Promise<void>;
    back(): Promise<void>;
}

export interface SwitchClock {
    schedule(run: () => void, ms: number): () => void;
}

const REAL_CLOCK: SwitchClock = {
    schedule: (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
    }
};

const IDLE: SwitchState = { kind: 'idle' };

interface Entry {
    target: SwitchTarget;
    make: () => SwitchRun;
    run: SwitchRun;
    controller: AbortController;
    cancelReveal: () => void;
}

/*
 * What the window says while it moves to another project: connecting to its machine,
 * opening it, going back after a cancel, or why it failed. One switch at a time; a second pick takes
 * over from the first without going back, since the person already said where they want to be.
 */
export class ProjectSwitch {
    readonly store: StoreApi<SwitchState> = createStore<SwitchState>(() => IDLE);
    private readonly clock: SwitchClock;
    private entry: Entry | null = null;

    constructor(clock: SwitchClock = REAL_CLOCK) {
        this.clock = clock;
    }

    get state(): SwitchState {
        return this.store.getState();
    }

    /* `make` builds a fresh run, so a retry starts from the same plan rather than from where the failed one stopped. */
    start(target: SwitchTarget, make: () => SwitchRun): Promise<SwitchOutcome> {
        const before = this.entry;
        if (before) {
            before.cancelReveal();
            before.controller.abort('replaced');
        }
        const entry: Entry = { target, make, run: make(), controller: new AbortController(), cancelReveal: () => undefined };
        this.entry = entry;
        this.set({ kind: 'connecting', target, visible: false });
        entry.cancelReveal = this.clock.schedule(() => {
            const state = this.state;
            if (this.entry === entry && state.kind !== 'idle' && state.kind !== 'failed') {
                this.set({ ...state, visible: true });
            }
        }, REVEAL_DELAY_MS);
        return this.execute(entry);
    }

    /* Stops waiting. Nothing moved while connecting, so that is over at once; after that the run is let finish and undone. */
    cancel(): void {
        const { entry, state } = this;
        if (entry === null || (state.kind !== 'connecting' && state.kind !== 'opening')) {
            return;
        }
        if (state.kind === 'connecting') {
            entry.cancelReveal();
            this.set(IDLE);
        } else {
            this.set({ kind: 'returning', target: state.target, visible: state.visible });
        }
        entry.controller.abort('back');
    }

    retry(): Promise<SwitchOutcome> | null {
        const { entry, state } = this;
        return entry !== null && state.kind === 'failed' ? this.start(entry.target, entry.make) : null;
    }

    /* The way back from a failure: undo what the run moved, then leave the screen to what is open. */
    async back(): Promise<void> {
        const { entry, state } = this;
        if (entry === null || state.kind !== 'failed') {
            return;
        }
        this.set({ kind: 'returning', target: state.target, visible: true });
        await entry.run.back().catch(() => undefined);
        this.finish(entry);
    }

    private async execute(entry: Entry): Promise<SwitchOutcome> {
        const { signal } = entry.controller;
        let failure: string | null = null;
        try {
            await entry.run.steps({
                signal,
                opening: () => {
                    const state = this.state;
                    if (this.entry === entry && state.kind === 'connecting') {
                        this.set({ ...state, kind: 'opening' });
                    }
                }
            });
        } catch (e) {
            failure = e instanceof Error ? e.message : 'That could not be opened';
        }
        if (signal.aborted) {
            // A pick made while this one was going back owns the screen now, and going back would undo it.
            if (signal.reason === 'replaced' || this.entry !== entry) {
                return 'replaced';
            }
            // Only after the run stopped: what it had on the wire would otherwise land on top of the way back.
            await entry.run.back().catch(() => undefined);
            this.finish(entry);
            return 'cancelled';
        }
        entry.cancelReveal();
        if (failure !== null) {
            this.set({ kind: 'failed', target: entry.target, reason: failure });
            return 'failed';
        }
        this.finish(entry);
        return 'done';
    }

    private finish(entry: Entry): void {
        if (this.entry !== entry) {
            return;
        }
        entry.cancelReveal();
        this.entry = null;
        this.set(IDLE);
    }

    private set(state: SwitchState): void {
        this.store.setState(state, true);
    }
}
