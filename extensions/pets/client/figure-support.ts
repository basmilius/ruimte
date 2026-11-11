import { useSyncExternalStore } from 'react';
import type { PetMood } from './pet-state';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/* What an untitled node with a pet reads as; a chat is the rest, since only these kinds have one. */
const KIND_LABELS: Readonly<Record<string, 'kinds.design' | 'kinds.terminal'>> = { design: 'kinds.design', terminal: 'kinds.terminal' };

/* `t` of `useLocale`. */
export type Words = (key: string, values?: Record<string, string | number>) => string;

function prefersStill(): boolean {
    return typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches;
}

function followMotion(onChange: () => void): () => void {
    if (typeof matchMedia !== 'function') {
        return () => {};
    }
    const query = matchMedia(REDUCED_MOTION);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

export function usePrefersStill(): boolean {
    return useSyncExternalStore(followMotion, prefersStill, () => false);
}

/*
 * What a pet's button says: where it leads, and that it waits on you when it does. On a canvas a press
 * goes to the node; in a view of its own, where a person already is, it hands the keyboard over (`focus`).
 */
export function petLabel(t: Words, node: { kind: string; title?: string | undefined }, mood: PetMood, press: 'goTo' | 'focus' = 'goTo'): string {
    // A node a person never named reads as its kind, so the label always says which node it leads to.
    const title = node.title?.trim() || t(KIND_LABELS[node.kind] ?? 'kinds.chat');

    if (mood === 'waiting' || mood === 'snoozed') {
        return t('pets.waiting', { title });
    }

    if (press === 'goTo') {
        return t('pets.goTo', { title });
    }

    return t(node.kind === 'terminal' ? 'pets.typeIn' : 'pets.writeTo', { title });
}
