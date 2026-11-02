import { useSyncExternalStore } from 'react';
import { extensionRequest } from '@/extensions/machine-request';
import type { Transport } from '@/transport';

interface Entry {
    value: unknown;
    readers: number;
    // Goes up with each write, so an answer to a read asked before it does not put the old value back.
    writes: number;
    listeners: Set<() => void>;
    stop: () => void;
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

/*
 * The first reader asks the machine, and again each time the connection opens, since what it said before may have
 * failed or changed meanwhile. The last one lets the value go, so a surface drawn later reads it fresh.
 */
function subscribe(
    transport: Pick<Transport, 'request' | 'connection' | 'subscribeStatus'>,
    full: string,
    id: string,
    key: string,
    listener: () => void
): () => void {
    let entry = entries.get(full);

    if (entry === undefined) {
        const created: Entry = { value: undefined, readers: 0, writes: 0, listeners: new Set(), stop: () => undefined };
        const read = (): void => {
            const writes = created.writes;

            void extensionRequest(transport, 'extension.storageGet', { id, key }).then(
                ({ value }) => {
                    if (entries.get(full) === created && created.writes === writes) {
                        created.value = value;
                        changed(created);
                    }
                },
                // Without a machine it keeps what it had, or the initial value, as for a key never written.
                () => undefined
            );
        };

        created.stop = transport.subscribeStatus((status) => {
            if (status === 'open') {
                read();
            }
        });
        entry = created;
        entries.set(full, created);
        read();
    }

    const held = entry;

    held.readers += 1;
    held.listeners.add(listener);

    return () => {
        held.listeners.delete(listener);
        held.readers -= 1;

        if (held.readers === 0 && entries.get(full) === held) {
            held.stop();
            entries.delete(full);
        }
    };
}

/*
 * A key an extension keeps on the machine in front, shared by every surface that reads it. Null for a key kept on this
 * computer, which reads nothing here.
 */
export function useMachineStorage<Value>(
    transport: Pick<Transport, 'request' | 'connection' | 'subscribeStatus'>,
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

            void extensionRequest(transport, 'extension.storageSet', { id, key, value: next }).catch(() => undefined);
        }
    ];
}
