import type { HostRef } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import type { SessionSink } from '../wire.ts';

interface Watched {
    projectId: string;
    // Absent for a client that shows the project's issues as a list.
    ref?: HostRef;
}

function keyOf(watched: Watched): string {
    return watched.ref === undefined ? watched.projectId : `${watched.projectId}\n${watched.ref}`;
}

/*
 * What each client asked to hear of with `host.watch`: a project's hosts, or one issue or change of it. It only keeps
 * who watches what and tells them to read again. Nothing here asks a host on a clock; what does so reads `watched` to
 * know what anyone looks at, and calls `changed`.
 */
export class HostWatches {
    private readonly sinks = new ClientSinks((clientId) => this.watching.delete(clientId));
    private readonly watching = new Map<string, Map<string, Watched>>();

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    watch(clientId: string, watched: Watched): void {
        const own = this.watching.get(clientId) ?? new Map<string, Watched>();

        own.set(keyOf(watched), watched);
        this.watching.set(clientId, own);
    }

    unwatch(clientId: string, watched: Watched): void {
        this.watching.get(clientId)?.delete(keyOf(watched));
    }

    /* Everything some client watches now, each once. */
    watched(): Watched[] {
        const all = new Map<string, Watched>();

        for (const own of this.watching.values()) {
            for (const [key, watched] of own) {
                all.set(key, watched);
            }
        }

        return [...all.values()];
    }

    /* Tells who watches to read again: everyone on the project when its providers changed, or who watches one issue or change of it. */
    changed(projectId: string, ref?: HostRef): void {
        for (const [clientId, own] of this.watching) {
            const hears = ref === undefined ? [...own.values()].some((watched) => watched.projectId === projectId) : own.has(keyOf({ projectId, ref }));

            if (hears) {
                this.sinks.to(clientId, { event: 'host.changed', payload: ref === undefined ? { projectId } : { projectId, ref } });
            }
        }
    }
}
