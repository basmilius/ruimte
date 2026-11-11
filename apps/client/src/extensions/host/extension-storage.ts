import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { storedJson, storedText } from '@/state/stored-json';

const PREFIX = 'ruimte.extension.';
const listeners = new Set<() => void>();
// The last text read of each key and what it held, so a value keeps its identity until another text is stored.
const parsed = new Map<string, { text: string; value: unknown }>();

export function settingKey(id: string, key: string): string {
    return `${PREFIX}${id}.setting.${key}`;
}

function announce(): void {
    for (const listener of listeners) {
        listener();
    }
}

/* False when the browser refused it, so the caller can say the value was not kept. */
export function writeExtensionStorage(key: string, value: unknown): boolean {
    const kept = storedJson(key, z.unknown()).write(value);

    announce();

    return kept;
}

export function removeExtensionStorage(key: string): void {
    storedText(key).remove();
    announce();
}

/* `storage` fires in every window but the writer, so a key another window wrote is read again here too. */
function fromOtherWindows(event: StorageEvent): void {
    if (event.key === null || event.key.startsWith(PREFIX)) {
        announce();
    }
}

export function subscribeStorage(listener: () => void): () => void {
    // Without a page there is no other window to hear, only this one's own writes.
    const page = typeof window === 'undefined' ? null : window;

    if (listeners.size === 0) {
        page?.addEventListener('storage', fromOtherWindows);
    }

    listeners.add(listener);

    return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
            page?.removeEventListener('storage', fromOtherWindows);
        }
    };
}

/* What a key holds now, or undefined for none: the same object for the same stored text. */
export function readExtensionStorage(key: string): unknown {
    const text = storedText(key).read();

    if (text === null) {
        parsed.delete(key);

        return undefined;
    }

    const known = parsed.get(key);

    if (known?.text === text) {
        return known.value;
    }

    const value: unknown = JSON.parse(text);

    parsed.set(key, { text, value });

    return value;
}

/* Calls back once the key holds another text, from this window or another. */
export function watchExtensionStorage(key: string, listener: () => void): () => void {
    let text = storedText(key).read();

    return subscribeStorage(() => {
        const next = storedText(key).read();

        if (next !== text) {
            text = next;
            listener();
        }
    });
}

export function useExtensionStorage<Value>(key: string, initial: Value): Value {
    const stored = useSyncExternalStore(subscribeStorage, () => readExtensionStorage(key));

    return stored === undefined ? initial : (stored as Value);
}
