/*
 * Which clients have which project open. A project is let go of, and closed, when the last hold on
 * it goes: two clients on the same project must not undo each other's watcher, and a person closing
 * a project on a laptop must not end the sessions another client is still looking at.
 *
 * A hold lives as long as the socket does. A client that drops off the network lets go, which only
 * costs the file watcher; the sessions of a project keep running until someone closes it on purpose.
 */
export class ProjectHolds {
    private readonly byClient = new Map<string, Set<string>>();

    add(clientId: string, projectId: string): void {
        const held = this.byClient.get(clientId);
        if (held) {
            held.add(projectId);
            return;
        }
        this.byClient.set(clientId, new Set([projectId]));
    }

    /* True when this was the last hold, which is what makes the caller act on the project itself. */
    remove(clientId: string, projectId: string): boolean {
        this.byClient.get(clientId)?.delete(projectId);
        return this.holders(projectId) === 0;
    }

    /* The socket went. Answers the projects nobody holds any more, for the caller to let go of. */
    dropClient(clientId: string): string[] {
        const held = this.byClient.get(clientId);
        this.byClient.delete(clientId);
        return [...(held ?? [])].filter((projectId) => this.holders(projectId) === 0);
    }

    has(clientId: string, projectId: string): boolean {
        return this.byClient.get(clientId)?.has(projectId) === true;
    }

    holders(projectId: string): number {
        let count = 0;
        for (const held of this.byClient.values()) {
            if (held.has(projectId)) {
                count += 1;
            }
        }
        return count;
    }

    /* Everyone but this client, which is what a confirmation asks before it says anything ends. */
    others(clientId: string, projectId: string): number {
        let count = 0;
        for (const [candidate, held] of this.byClient) {
            if (candidate !== clientId && held.has(projectId)) {
                count += 1;
            }
        }
        return count;
    }
}
