/*
 * One writer at a time: the next piece of work starts once the one before it settled, whether that
 * one kept its promise or not, and every caller hears its own result. Two changes in a row never
 * read the same file and drop one of them.
 */
export class Serializer {
    private chain: Promise<unknown> = Promise.resolve();

    run<T>(work: () => Promise<T>): Promise<T> {
        const next = this.chain.then(work, work);
        this.chain = next.catch(() => undefined);
        return next;
    }

    /* Resolves once what is queued has settled, without adding work of its own. */
    idle(): Promise<void> {
        return this.chain.then(
            () => undefined,
            () => undefined
        );
    }
}

/* The same per key, for a store whose records are written one by one and never wait on each other. */
export class KeyedSerializer {
    private readonly chains = new Map<string, Promise<unknown>>();

    run<T>(key: string, work: () => Promise<T>): Promise<T> {
        const previous = this.chains.get(key) ?? Promise.resolve();
        const next = previous.then(work, work);
        const settled = next.catch(() => undefined);
        this.chains.set(key, settled);
        // A key whose chain ran out leaves nothing behind, or the map grows with every id ever written.
        void settled.then(() => {
            if (this.chains.get(key) === settled) {
                this.chains.delete(key);
            }
        });
        return next;
    }
}
