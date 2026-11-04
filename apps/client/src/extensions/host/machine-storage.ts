import { messageOf } from '@adecore/ui';
import { useSyncExternalStore } from 'react';
import { extensionRequest } from '@/extensions/machine-request';
import { TransportError, type Transport } from '@/transport';

type StorageLink = Pick<Transport, 'request' | 'connection' | 'subscribeStatus' | 'on'>;

interface Entry {
    value: unknown;
    // What the machine last said it holds, which a write it refused goes back to.
    confirmed: unknown;
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

// No machine, or one from before the extension API: it keeps what it had, or the initial value, as for a key never written.
function unreachable(e: unknown): boolean {
    return e instanceof TransportError && (e.code === 'unavailable' || e.code === 'not-connected');
}

/*
 * The first reader asks the machine, and again each time the connection opens, since what it said before may have
 * failed or changed meanwhile. A write from anywhere else, another window or `server/`, comes as
 * `extension.storageChanged`. The last reader lets the value go, so a surface drawn later reads it fresh.
 */
function subscribe(link: StorageLink, full: string, id: string, key: string, report: (text: string) => void, listener: () => void): () => void {
    let entry = entries.get(full);

    if (entry === undefined) {
        const created: Entry = { value: undefined, confirmed: undefined, readers: 0, writes: 0, listeners: new Set(), stop: () => undefined };
        const read = (): void => {
            const writes = created.writes;

            void extensionRequest(link, 'extension.storageGet', { id, key }).then(
                ({ value }) => {
                    if (entries.get(full) === created && created.writes === writes) {
                        created.value = value;
                        created.confirmed = value;
                        changed(created);
                    }
                },
                (e: unknown) => {
                    // An answer it could not read is no empty key: it says so, and shows what it had.
                    if (!unreachable(e)) {
                        report(`storage ${key}: ${messageOf(e)}`);
                    }
                }
            );
        };
        const stopStatus = link.subscribeStatus((status) => {
            if (status === 'open') {
                read();
            }
        });
        const stopChanges = link.on('extension.storageChanged', (change) => {
            if (change.id === id && change.key === key && entries.get(full) === created) {
                created.value = change.value;
                created.confirmed = change.value;
                created.writes += 1;
                changed(created);
            }
        });

        created.stop = () => {
            stopStatus();
            stopChanges();
        };
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
 * computer, which reads nothing here. A write shows at once; one the machine refuses goes back to what the machine
 * holds, and `report` says why.
 */
export function useMachineStorage<Value>(
    link: StorageLink,
    endpointId: string,
    id: string,
    key: string | null,
    initial: Value,
    report: (text: string) => void
): [Value, (next: Value) => void] {
    const full = key === null ? null : entryKey(endpointId, id, key);
    const value = useSyncExternalStore(
        (listener) => (full === null || key === null ? () => undefined : subscribe(link, full, id, key, report, listener)),
        () => (full === null ? undefined : entries.get(full)?.value)
    );

    return [
        value === undefined ? initial : (value as Value),
        (next) => {
            if (full === null || key === null) {
                return;
            }

            const entry = entries.get(full);
            const writes = entry === undefined ? 0 : ++entry.writes;

            if (entry !== undefined) {
                entry.value = next;
                changed(entry);
            }

            void extensionRequest(link, 'extension.storageSet', { id, key, value: next }).then(
                () => {
                    if (entry !== undefined) {
                        entry.confirmed = next;
                    }
                },
                (e: unknown) => {
                    if (entry !== undefined && entries.get(full) === entry && entry.writes === writes) {
                        entry.value = entry.confirmed;
                        changed(entry);
                    }

                    report(`storage ${key}: ${messageOf(e)}`);
                }
            );
        }
    ];
}
