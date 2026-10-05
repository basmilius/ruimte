import { useCallback, useSyncExternalStore } from 'react';
import type { CustomLanguageServer, CustomLanguageServerInput, LanguageCustomCheckResult } from '@ruimte/contracts';
import type { Transport } from '@/transport/transport';

/*
 * The language servers a person added on a machine, which are the machine's and not a project's.
 * `null` until the machine has answered. Only a person's Save and Remove change them; the machine says
 * so to every client, so two windows show the same list.
 */
export class CustomServersTracker {
    private readonly transport: Transport;
    private readonly listeners = new Set<() => void>();
    private readonly subscriptions: Array<() => void> = [];
    private snapshot: readonly CustomLanguageServer[] | null = null;
    private linkWasDown: boolean;

    constructor(transport: Transport) {
        this.transport = transport;
        this.linkWasDown = transport.status !== 'open';
        this.subscriptions.push(
            transport.on('language.custom.changed', (event) => this.set(event.servers)),
            transport.subscribeStatus((status) => {
                if (status !== 'open') {
                    this.linkWasDown = true;
                } else if (this.linkWasDown) {
                    this.linkWasDown = false;
                    void this.refresh().catch(() => undefined);
                }
            })
        );
    }

    getSnapshot(): readonly CustomLanguageServer[] | null {
        return this.snapshot;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    async refresh(): Promise<void> {
        this.set((await this.transport.request('language.custom.list', {})).servers);
    }

    /* Saving approves starting exactly this command on the machine. A refusal says why, and nothing changes. */
    async save(server: CustomLanguageServerInput): Promise<CustomLanguageServer> {
        const { server: saved } = await this.transport.request('language.custom.save', { server });
        this.set(
            this.snapshot?.some((candidate) => candidate.id === saved.id)
                ? this.snapshot.map((c) => (c.id === saved.id ? saved : c))
                : [...(this.snapshot ?? []), saved]
        );
        return saved;
    }

    async remove(id: string): Promise<void> {
        await this.transport.request('language.custom.remove', { id });
        this.set((this.snapshot ?? []).filter((candidate) => candidate.id !== id));
    }

    check(command: string): Promise<LanguageCustomCheckResult> {
        return this.transport.request('language.custom.check', { command });
    }

    dispose(): void {
        for (const unsubscribe of this.subscriptions.splice(0)) {
            unsubscribe();
        }
        this.listeners.clear();
    }

    private set(servers: readonly CustomLanguageServer[]): void {
        this.snapshot = servers;
        for (const listener of this.listeners) {
            listener();
        }
    }
}

export function useCustomServers(tracker: CustomServersTracker): readonly CustomLanguageServer[] | null {
    const subscribe = useCallback((listener: () => void) => tracker.subscribe(listener), [tracker]);
    return useSyncExternalStore(subscribe, () => tracker.getSnapshot());
}
