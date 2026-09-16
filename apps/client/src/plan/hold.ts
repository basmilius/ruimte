import { useEffect, useState, useSyncExternalStore } from 'react';

/* Runs a callback after a delay and hands back what cancels it. */
export type Schedule = (callback: () => void, ms: number) => () => void;

const browserSchedule: Schedule = (callback, ms) => {
    const timer = window.setTimeout(callback, ms);
    return () => window.clearTimeout(timer);
};

/*
 * A value that shows up at once and lets go only after it stayed away for `holdMs`. An agent marks
 * one step done a moment before it marks the next active, and a chat's status blinks between turns;
 * without the hold, whatever draws them would blink along.
 */
export class Hold<T> {
    private shown: T | null = null;
    private cancel: (() => void) | null = null;
    private readonly listeners = new Set<() => void>();

    private readonly holdMs: number;
    private readonly equals: (a: T, b: T) => boolean;
    private readonly schedule: Schedule;

    /**
     * @param holdMs How long an absent value keeps showing the last one.
     * @param equals Whether two values draw the same, so an equal one notifies nobody.
     * @param schedule The timer, injected so a test runs it by hand.
     */
    constructor(holdMs: number, equals: (a: T, b: T) => boolean, schedule: Schedule) {
        this.holdMs = holdMs;
        this.equals = equals;
        this.schedule = schedule;
    }

    /** What to draw: the live value, or the last one while it is held. */
    get(): T | null {
        return this.shown;
    }

    /** Takes the live value; `null` means it is absent. */
    set(value: T | null): void {
        if (value !== null) {
            this.stopTimer();
            this.show(value);
            return;
        }
        if (this.shown === null || this.cancel !== null) {
            return;
        }
        this.cancel = this.schedule(() => {
            this.cancel = null;
            this.show(null);
        }, this.holdMs);
    }

    /** Listens for a change of what to draw, and returns what stops listening. */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Drops a pending release; a later `set` starts over. */
    dispose(): void {
        this.stopTimer();
    }

    /** Stores the value to draw and tells listeners only when it draws differently. */
    private show(value: T | null): void {
        const same = value === null || this.shown === null ? value === this.shown : this.equals(value, this.shown);
        this.shown = value;
        if (!same) {
            this.listeners.forEach((listener) => listener());
        }
    }

    /** Cancels the release timer, if one runs. */
    private stopTimer(): void {
        this.cancel?.();
        this.cancel = null;
    }
}

/**
 * `value`, or the last value that was not `null` until it has been `null` for `holdMs`.
 *
 * @param value The live value; `null` when absent.
 * @param equals Whether two values draw the same.
 * @param holdMs How long an absent value keeps showing the last one.
 */
export function useHeld<T>(value: T | null, equals: (a: T, b: T) => boolean, holdMs: number): T | null {
    const [hold] = useState(() => new Hold<T>(holdMs, equals, browserSchedule));
    const held = useSyncExternalStore(
        (listener) => hold.subscribe(listener),
        () => hold.get()
    );

    useEffect(() => {
        hold.set(value);
    });

    useEffect(() => () => hold.dispose(), [hold]);

    // The hold only learns the value in an effect, and a value that just arrived is drawn in this render already.
    return value ?? held;
}
