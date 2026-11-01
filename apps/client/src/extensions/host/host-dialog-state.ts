import type { ComponentType } from 'react';
import { create } from 'zustand';

export interface DialogRequest {
    title: string;
    body?: string;
    danger?: boolean;
    field?: { placeholder?: string; initial?: string };
    choices?: readonly string[];
    answer(value: string | null): void;
}

export const useHostDialog = create<{ request: DialogRequest | null }>(() => ({ request: null }));

/* One question at a time: a second waits for the first, as a person can only answer one. */
let queue: Promise<unknown> = Promise.resolve();

export function askHost(request: Omit<DialogRequest, 'answer'>): Promise<string | null> {
    const asked = queue.then(
        () =>
            new Promise<string | null>((resolve) => {
                useHostDialog.setState({
                    request: {
                        ...request,
                        answer: (value) => {
                            useHostDialog.setState({ request: null });
                            resolve(value);
                        }
                    }
                });
            })
    );

    queue = asked;

    return asked;
}

export interface OpenOverlay {
    key: number;
    title: string;
    size: 'sm' | undefined;
    component: ComponentType<{ params: unknown; close: (result?: unknown) => void }>;
    params: unknown;
    close(result?: unknown): void;
}

export const useOverlays = create<{ open: readonly OpenOverlay[] }>(() => ({ open: [] }));

let nextOverlay = 1;

/* Answers what the overlay closed with, or null when a person dismissed it. Several may stand on each other. */
export function openOverlay(overlay: Pick<OpenOverlay, 'title' | 'size' | 'component' | 'params'>): {
    result: Promise<unknown>;
    close(result?: unknown): void;
} {
    const key = nextOverlay;

    nextOverlay += 1;

    let close = (_result?: unknown): void => undefined;
    const result = new Promise<unknown>((resolve) => {
        close = (value) => {
            useOverlays.setState(({ open }) => ({ open: open.filter((each) => each.key !== key) }));
            resolve(value ?? null);
        };
    });

    useOverlays.setState(({ open }) => ({ open: [...open, { ...overlay, key, close }] }));

    return { result, close };
}
