import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { storedJson, storedText } from '@/state/stored-json';

const listeners = new Set<() => void>();

export function settingKey(id: string, key: string): string {
    return `ruimte.extension.${id}.setting.${key}`;
}

export function writeExtensionStorage(key: string, value: unknown): void {
    storedJson(key, z.unknown()).write(value);

    for (const listener of listeners) {
        listener();
    }
}

export function subscribeStorage(listener: () => void): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

export function useExtensionStorage<Value>(key: string, initial: Value): Value {
    const stored = useSyncExternalStore(subscribeStorage, () => storedText(key).read());

    return stored === null ? initial : (JSON.parse(stored) as Value);
}
