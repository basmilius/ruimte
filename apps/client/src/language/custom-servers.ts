import type { CustomLanguageServer, CustomLanguageServerInput, LanguageCustomCheckResult } from '@ruimte/contracts';
import { useSyncExternalStore } from 'react';
import type { Transport } from '@/transport-api/transport';
import { SnapshotTracker, upsert } from './snapshot-tracker';

/*
 * The language servers a person added on a machine, which are the machine's and not a project's.
 * `null` until the machine has answered. Only a person's Save and Remove change them; the machine says
 * so to every client, so two windows show the same list.
 */
export class CustomServersTracker extends SnapshotTracker<readonly CustomLanguageServer[] | null> {
    constructor(transport: Transport) {
        super(transport, null);
        this.subscriptions.push(transport.on('language.custom.changed', (event) => this.replace(event.servers)));
    }

    async refresh(): Promise<void> {
        this.replace((await this.transport.request('language.custom.list', {})).servers);
    }

    /* Saving approves starting exactly this command on the machine. A refusal says why, and nothing changes. */
    async save(server: CustomLanguageServerInput): Promise<CustomLanguageServer> {
        const { server: saved } = await this.transport.request('language.custom.save', { server });
        this.replace(upsert(this.snapshot ?? [], saved, (candidate) => candidate.id === saved.id));
        return saved;
    }

    async remove(id: string): Promise<void> {
        await this.transport.request('language.custom.remove', { id });
        this.replace((this.snapshot ?? []).filter((candidate) => candidate.id !== id));
    }

    check(command: string): Promise<LanguageCustomCheckResult> {
        return this.transport.request('language.custom.check', { command });
    }
}

export function useCustomServers(tracker: CustomServersTracker): readonly CustomLanguageServer[] | null {
    const subscribe = (listener: () => void) => tracker.subscribe(listener);
    return useSyncExternalStore(subscribe, () => tracker.getSnapshot());
}
