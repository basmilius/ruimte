import { useSyncExternalStore } from 'react';
import type { TFunction } from 'i18next';
import type { PetMood } from '@/pets/pet-state';
import type { CanvasNode } from '@/state/canvas';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/* What an untitled node with a pet reads as; a chat is the rest, since only these kinds have one. */
const KIND_LABELS: Partial<Record<CanvasNode['kind'], 'kinds.design' | 'kinds.terminal'>> = { design: 'kinds.design', terminal: 'kinds.terminal' };

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

/* Whether a person asked for reduced motion, read again when they change it, so the figures stop or move at once. */
export function usePrefersStill(): boolean {
    return useSyncExternalStore(followMotion, prefersStill, () => false);
}

/*
 * What a pet's button says: where it leads, and that it waits on you when it does. On a canvas a press
 * goes to the node; in a view of its own, where a person already is, it hands the keyboard over (`focus`).
 */
export function petLabel(t: TFunction<'canvas'>, node: { kind: CanvasNode['kind']; title?: string }, mood: PetMood, press: 'goTo' | 'focus' = 'goTo'): string {
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
