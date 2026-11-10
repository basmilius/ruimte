import { useEffect, useState, useSyncExternalStore } from 'react';

export type Schedule = (callback: () => void, ms: number) => () => void;

function browserSchedule(callback: () => void, ms: number): () => void {
    const timer = window.setTimeout(callback, ms);
    return () => window.clearTimeout(timer);
}

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
    private readonly equals: (left: T, right: T) => boolean;
    private readonly schedule: Schedule;

    /**
     * @param holdMs How long an absent value keeps showing the last one.
     * @param equals Whether two values draw the same, so an equal one notifies nobody.
     * @param schedule The timer, injected so a test runs it by hand.
     */
    constructor(holdMs: number, equals: (left: T, right: T) => boolean, schedule: Schedule) {
        this.holdMs = holdMs;
        this.equals = equals;
        this.schedule = schedule;
    }

    get(): T | null {
        return this.shown;
    }

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

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    dispose(): void {
        this.stopTimer();
    }

    private show(value: T | null): void {
        const same = value === null || this.shown === null ? value === this.shown : this.equals(value, this.shown);
        this.shown = value;
        if (!same) {
            this.listeners.forEach((listener) => listener());
        }
    }

    private stopTimer(): void {
        this.cancel?.();
        this.cancel = null;
    }
}

export function useHeld<T>(value: T | null, equals: (left: T, right: T) => boolean, holdMs: number): T | null {
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
