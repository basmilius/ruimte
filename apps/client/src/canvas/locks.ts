import i18next from 'i18next';
import type { Locks } from '@/state/canvas';

/* The four locks in the order the dock and the settings dialog list them. */
export const LOCK_KEYS: readonly (keyof Locks)[] = ['pan', 'zoom', 'move', 'resize'];

/* The words are asked for when a row draws, not held: this module is imported before i18next has
   any, so a label taken here would stay in whichever language loaded first. */
export const lockLabel = (key: keyof Locks): string => i18next.t(`canvas:locks.${key}.label`);

/* What the lock stops, under its own name. */
export const lockHint = (key: keyof Locks): string => i18next.t(`canvas:locks.${key}.hint`);
