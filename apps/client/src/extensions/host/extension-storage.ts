import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { storedJson, storedText } from '@/state/stored-json';

const PREFIX = 'ruimte.extension.';
const listeners = new Set<() => void>();

export function settingKey(id: string, key: string): string {
    return `${PREFIX}${id}.setting.${key}`;
}

/* False when the browser refused it, so the caller can say the value was not kept. */
export function writeExtensionStorage(key: string, value: unknown): boolean {
    const kept = storedJson(key, z.unknown()).write(value);

    for (const listener of listeners) {
        listener();
    }

    return kept;
}

/* `storage` fires in every window but the writer, so a key another window wrote is read again here too. */
function fromOtherWindows(event: StorageEvent): void {
    if (event.key === null || event.key.startsWith(PREFIX)) {
        for (const listener of listeners) {
            listener();
        }
    }
}

export function subscribeStorage(listener: () => void): () => void {
    if (listeners.size === 0) {
        window.addEventListener('storage', fromOtherWindows);
    }

    listeners.add(listener);

    return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
            window.removeEventListener('storage', fromOtherWindows);
        }
    };
}

export function useExtensionStorage<Value>(key: string, initial: Value): Value {
    const stored = useSyncExternalStore(subscribeStorage, () => storedText(key).read());

    return stored === null ? initial : (JSON.parse(stored) as Value);
}
