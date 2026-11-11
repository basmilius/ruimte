import { storage, type Json } from '@ruimte/extension/client';

/*
 * Moves what pets kept under a key of their own, before they ran on the extension API, into the extension's storage
 * once, so a person keeps what they set and added. A key already moved, or none to move, is left as it is.
 */
export function movedFromBefore(legacyKey: string, key: string): void {
    if (storage.get(key) !== undefined || typeof localStorage === 'undefined') {
        return;
    }

    try {
        const text = localStorage.getItem(legacyKey);

        if (text === null) {
            return;
        }

        if (storage.set(key, JSON.parse(text) as Json).ok) {
            localStorage.removeItem(legacyKey);
        }
    } catch {
        // A key that does not read as JSON, or storage the browser refuses, leaves nothing to move.
    }
}
