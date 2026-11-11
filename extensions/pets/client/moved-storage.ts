import { storage, type Json } from '@ruimte/extension/client';

/* A blob of the app that held some fields of the extension before it had a key of its own. */
export interface SharedBefore {
    key: string;
    fields: readonly string[];
}

/* Before `ruimte.pets`, the pets' settings were fields of the app's settings, as `petSettingsFrom` reads them. */
export const PETS_IN_APP_SETTINGS: SharedBefore = {
    key: 'ruimte.settings',
    fields: ['pets', 'petsPlace', 'petsSets', 'petsSprite', 'petsVisitor', 'petsSubagents', 'petsInViews', 'petsByAgent', 'petsBeam']
};

/*
 * Moves what pets kept under a key of their own, before they ran on the extension API, into the extension's storage
 * once, so a person keeps what they set and added. A key already moved, or none to move, is left as it is. Without
 * that key, `shared` names the blob it was carved out of; its fields are copied, and the blob is never written.
 */
export function movedFromBefore(legacyKey: string, key: string, shared?: SharedBefore): void {
    if (storage.get(key) !== undefined || typeof localStorage === 'undefined') {
        return;
    }

    try {
        const text = localStorage.getItem(legacyKey);

        if (text === null) {
            if (shared !== undefined) {
                copiedFrom(shared, key);
            }

            return;
        }

        if (storage.set(key, JSON.parse(text) as Json).ok) {
            localStorage.removeItem(legacyKey);
        }
    } catch {
        // A key that does not read as JSON, or storage the browser refuses, leaves nothing to move.
    }
}

function copiedFrom(shared: SharedBefore, key: string): void {
    const text = localStorage.getItem(shared.key);

    if (text === null) {
        return;
    }

    const blob: unknown = JSON.parse(text);

    if (typeof blob !== 'object' || blob === null || Array.isArray(blob)) {
        return;
    }

    const fields = Object.entries(blob).filter(([field]) => shared.fields.includes(field));

    if (fields.length > 0) {
        storage.set(key, Object.fromEntries(fields) as Json);
    }
}
