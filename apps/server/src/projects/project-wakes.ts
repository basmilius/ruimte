/*
 * Keeps a wake from the outbox and the closing of its project apart. A wake counts from before it first looks
 * at the project, so closing waits for every wake that could still open a turn, and that turn ends with the
 * rest of the project's sessions.
 */
export class ProjectWakes {
    private readonly closing = new Set<string>();
    private readonly running = new Map<string, Set<Promise<void>>>();

    isClosing(projectId: string): boolean {
        return this.closing.has(projectId);
    }

    async run<T>(projectId: string, wake: () => Promise<T>): Promise<T> {
        const wakes = this.running.get(projectId) ?? new Set();
        const running = wake();
        const finished = running.then(
            () => undefined,
            () => undefined
        );

        this.running.set(projectId, wakes);
        wakes.add(finished);

        try {
            return await running;
        } finally {
            wakes.delete(finished);

            if (wakes.size === 0) {
                this.running.delete(projectId);
            }
        }
    }

    /* A wake that looks from here on finds the project closing; resolves once every wake that looked earlier ended. */
    async startClosing(projectId: string): Promise<void> {
        this.closing.add(projectId);
        await Promise.all(this.running.get(projectId) ?? []);
    }

    endClosing(projectId: string): void {
        this.closing.delete(projectId);
    }
}
