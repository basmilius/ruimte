import { NodeActivityListSchema, type AgentStatus, type NodeActivity } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { JsonFileStore } from '../json-file-store.ts';
import type { SessionEvent, SessionSink } from '../wire.ts';

const MAX_ENTRIES = 5000;

interface NodeActivityStoreOptions {
    path?: string;
    now?: () => number;
    /* The project index's; a node in no project here has no activity. */
    locate?: (nodeId: string) => { projectId: string } | null;
}

function keyOf(projectId: string, nodeId: string): string {
    return JSON.stringify([projectId, nodeId]);
}

/*
 * A change a person would want to see: the agent started, waits, stopped, or finished a turn. Going
 * idle counts only after work, so a restored or freshly opened chat moves nothing. The first status
 * after a daemon start counts only when it asks for something, since the daemon was away for the rest.
 */
function isActivity(status: AgentStatus, previous: AgentStatus | undefined): boolean {
    if (status === previous) {
        return false;
    }

    if (previous === undefined) {
        return status === 'running' || status === 'needs-you';
    }

    return status !== 'idle' || previous === 'running' || previous === 'needs-you';
}

/*
 * When each node of this machine last changed for a person, shared by every client so they all list a
 * canvas in the same order. It lives under `$RUIMTE_HOME` and never in a project file: a click is one
 * person's, and writing it to `project.json` would save the project on every one.
 */
export class NodeActivityStore {
    private readonly entries = new Map<string, NodeActivity>();
    private readonly statuses = new Map<string, AgentStatus>();
    private readonly sinks = new ClientSinks();
    private readonly file: JsonFileStore<{ activity: NodeActivity[] }>;
    private readonly now: () => number;
    private readonly locate: (nodeId: string) => { projectId: string } | null;

    constructor(options: NodeActivityStoreOptions = {}) {
        this.file = new JsonFileStore(options.path, NodeActivityListSchema, 'node activity starts empty');
        this.now = options.now ?? Date.now;
        this.locate = options.locate ?? (() => null);

        for (const entry of this.file.read()?.activity ?? []) {
            this.entries.set(keyOf(entry.projectId, entry.nodeId), entry);
        }
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    list(): NodeActivity[] {
        return [...this.entries.values()];
    }

    /* A person opened the node. False when no project here has it. */
    touch(nodeId: string): boolean {
        const place = this.locate(nodeId);

        if (place === null) {
            return false;
        }

        this.record([{ projectId: place.projectId, nodeId, at: this.now() }]);

        return true;
    }

    noteStatus(nodeId: string, status: AgentStatus): void {
        const previous = this.statuses.get(nodeId);
        this.statuses.set(nodeId, status);
        const place = this.locate(nodeId);

        if (place === null || !isActivity(status, previous)) {
            return;
        }

        this.record([{ projectId: place.projectId, nodeId, at: this.now() }]);
    }

    /*
     * For `ProjectIndex.onPlaces`: a node that left takes its activity along, and one the store has not
     * seen starts now, so a new node is the most recent. A project seen for the first time has all its
     * nodes start at once, which leaves their order to the canvas.
     */
    places(projectId: string, ids: ReadonlySet<string>): void {
        let removed = false;

        for (const [key, entry] of this.entries) {
            if (entry.projectId === projectId && !ids.has(entry.nodeId)) {
                this.entries.delete(key);
                this.statuses.delete(entry.nodeId);
                removed = true;
            }
        }

        const now = this.now();
        const added = [...ids].filter((nodeId) => !this.entries.has(keyOf(projectId, nodeId))).map((nodeId) => ({ projectId, nodeId, at: now }));

        if (added.length > 0) {
            this.record(added);
        } else if (removed) {
            this.save();
        }
    }

    private record(changed: readonly NodeActivity[]): void {
        for (const entry of changed) {
            const key = keyOf(entry.projectId, entry.nodeId);
            // Moved to the end, so the oldest entries go first once the store is full.
            this.entries.delete(key);
            this.entries.set(key, entry);
        }

        for (const key of [...this.entries.keys()].slice(0, Math.max(0, this.entries.size - MAX_ENTRIES))) {
            this.entries.delete(key);
        }

        this.save();
        this.sinks.emit({ event: 'activity.changed', payload: { activity: changed.slice(-MAX_ENTRIES) } });
    }

    /* Fed from the same session and chat events as the push side. */
    consume(event: SessionEvent): void {
        if (event.event === 'session.status' && event.payload.agent) {
            this.noteStatus(event.payload.sessionId, event.payload.agent.status);
        } else if (event.event === 'chat.event' && event.payload.event.type === 'info') {
            this.noteStatus(event.payload.chatId, event.payload.event.info.status);
        }
    }

    private save(): void {
        this.file.write({ activity: this.list() });
    }
}
