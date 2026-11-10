/*
 * Keeps a pass over a server's storage and a server start apart: a start waits while a pass holds the
 * gate, and a pass takes the gate one at a time. The gate never waits for a running server, since the
 * pass itself checks which storage a running server uses.
 */
export class StorageGate {
    private held: Promise<void> | null = null;

    async wait(): Promise<void> {
        while (this.held !== null) {
            await this.held;
        }
    }

    async hold<T>(work: () => Promise<T>): Promise<T> {
        // No await between the last check and taking the gate, or two holds would both pass.
        while (this.held !== null) {
            await this.held;
        }

        let release!: () => void;
        this.held = new Promise<void>((resolve) => {
            release = resolve;
        });

        try {
            return await work();
        } finally {
            this.held = null;
            release();
        }
    }
}
