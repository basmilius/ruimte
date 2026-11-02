import { useSyncExternalStore } from 'react';
import type { Transport } from '@/transport';

interface Entry {
    value: unknown;
    readers: number;
    // Goes up with each write, so an answer to a read asked before it does not put the old value back.
    writes: number;
    listeners: Set<() => void>;
}

/* What an extension keeps on a machine, one per machine, extension and key, so every surface that reads a key sees one value. */
const entries = new Map<string, Entry>();

function entryKey(endpointId: string, id: string, key: string): string {
    return JSON.stringify([endpointId, id, key]);
}

function changed(entry: Entry): void {
    for (const listener of entry.listeners) {
        listener();
    }
}

/* The first reader asks the machine, and the last one lets the value go, so a surface drawn later reads it fresh. */
function subscribe(transport: Pick<Transport, 'request'>, full: string, id: string, key: string, listener: () => void): () => void {
    let entry = entries.get(full);

    if (entry === undefined) {
        const created: Entry = { value: undefined, readers: 0, writes: 0, listeners: new Set() };

        entry = created;
        entries.set(full, created);
        void transport.request('extension.storageGet', { id, key }).then(
            ({ value }) => {
                if (entries.get(full) === created && created.writes === 0) {
                    created.value = value;
                    changed(created);
                }
            },
            // Without a machine it starts from the initial value, as for a key never written.
            () => undefined
        );
    }

    const held = entry;

    held.readers += 1;
    held.listeners.add(listener);

    return () => {
        held.listeners.delete(listener);
        held.readers -= 1;

        if (held.readers === 0 && entries.get(full) === held) {
            entries.delete(full);
        }
    };
}

/*
 * A key an extension keeps on the machine in front, shared by every surface that reads it. Null for a key kept on this
 * computer, which reads nothing here.
 */
export function useMachineStorage<Value>(
    transport: Pick<Transport, 'request'>,
    endpointId: string,
    id: string,
    key: string | null,
    initial: Value
): [Value, (next: Value) => void] {
    const full = key === null ? null : entryKey(endpointId, id, key);
    const value = useSyncExternalStore(
        (listener) => (full === null || key === null ? () => undefined : subscribe(transport, full, id, key, listener)),
        () => (full === null ? undefined : entries.get(full)?.value)
    );

    return [
        value === undefined ? initial : (value as Value),
        (next) => {
            if (full === null || key === null) {
                return;
            }

            const entry = entries.get(full);

            if (entry !== undefined) {
                entry.value = next;
                entry.writes += 1;
                changed(entry);
            }

            void transport.request('extension.storageSet', { id, key, value: next }).catch(() => undefined);
        }
    ];
}
