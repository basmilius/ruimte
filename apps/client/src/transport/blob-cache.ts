export interface BlobState {
    url: string | null;
    failure: string | null;
}

export interface BlobLease {
    current(): BlobState;
    subscribe(listener: () => void): () => void;
    /* Loads again when the last load failed; a load that worked or is under way is left alone. */
    retry(): void;
    release(): void;
}

export interface BlobCacheOptions {
    /* What the blobs nobody draws may add up to before the least recently used go. */
    maxIdleBytes: number;
    createUrl?(blob: Blob): string;
    revokeUrl?(url: string): void;
}

interface Entry {
    readonly key: string;
    readonly load: () => Promise<Blob>;
    users: number;
    blob: Blob | null;
    url: string | null;
    failure: string | null;
    loading: boolean;
    // Bumped per load, so a load that was overtaken by a retry cannot land on the entry.
    generation: number;
    lastUsed: number;
    readonly listeners: Set<() => void>;
}

const NOTHING: BlobState = { url: null, failure: null };

/*
 * Blob URLs for bytes that came over a direct connection, one per key. A URL lives exactly as long as
 * someone draws it: the first user creates it and the last one revokes it. The blob behind it stays a
 * while longer, so a row that scrolls out of a list and back does not fetch its picture again, but
 * only as long as the blobs nobody draws fit in `maxIdleBytes`. What is on screen is never evicted.
 *
 * The key names a version of the bytes (an attachment id, an icon version, a file's mtime and size),
 * the way the HTTP URL does, so a file that changed is a new key and the old one just goes idle.
 */
export class BlobCache {
    private readonly options: BlobCacheOptions;
    private readonly entries = new Map<string, Entry>();
    private clock = 0;

    constructor(options: BlobCacheOptions) {
        this.options = options;
    }

    acquire(key: string, load: () => Promise<Blob>): BlobLease {
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { key, load, users: 0, blob: null, url: null, failure: null, loading: false, generation: 0, lastUsed: 0, listeners: new Set() };
            this.entries.set(key, entry);
            this.start(entry);
        }
        entry.users += 1;
        if (entry.blob && entry.url === null) {
            entry.url = this.createUrl(entry.blob);
        }
        return this.leaseOf(entry);
    }

    /* Bytes of the blobs nobody holds a lease on; for tests. */
    idleBytes(): number {
        let total = 0;
        for (const entry of this.entries.values()) {
            if (entry.users === 0 && entry.blob) {
                total += entry.blob.size;
            }
        }
        return total;
    }

    has(key: string): boolean {
        return this.entries.has(key);
    }

    private leaseOf(entry: Entry): BlobLease {
        const mine = new Set<() => void>();
        let released = false;
        return {
            current: () => (released ? NOTHING : { url: entry.url, failure: entry.failure }),
            subscribe: (listener) => {
                if (released) {
                    return () => undefined;
                }
                mine.add(listener);
                entry.listeners.add(listener);
                return () => {
                    mine.delete(listener);
                    entry.listeners.delete(listener);
                };
            },
            retry: () => {
                if (!released && entry.failure !== null && !entry.loading && this.entries.get(entry.key) === entry) {
                    this.start(entry);
                }
            },
            release: () => {
                if (released) {
                    return;
                }
                released = true;
                for (const listener of mine) {
                    entry.listeners.delete(listener);
                }
                this.release(entry);
            }
        };
    }

    private start(entry: Entry): void {
        entry.generation += 1;
        const generation = entry.generation;
        entry.loading = true;
        entry.failure = null;
        this.notify(entry);
        entry.load().then(
            (blob) => {
                if (entry.generation !== generation || this.entries.get(entry.key) !== entry) {
                    return;
                }
                entry.loading = false;
                entry.blob = blob;
                if (entry.users > 0) {
                    entry.url = this.createUrl(blob);
                } else {
                    // Everyone left while it loaded; it counts as idle from now, not from when they left.
                    entry.lastUsed = ++this.clock;
                }
                this.notify(entry);
                this.evict();
            },
            (e: unknown) => {
                if (entry.generation !== generation || this.entries.get(entry.key) !== entry) {
                    return;
                }
                entry.loading = false;
                entry.failure = e instanceof Error ? e.message : String(e);
                if (entry.users === 0) {
                    this.entries.delete(entry.key);
                }
                this.notify(entry);
            }
        );
    }

    private release(entry: Entry): void {
        entry.users -= 1;
        if (entry.users > 0) {
            return;
        }
        if (entry.url !== null) {
            if (this.options.revokeUrl) {
                this.options.revokeUrl(entry.url);
            } else {
                URL.revokeObjectURL(entry.url);
            }
            entry.url = null;
        }
        entry.lastUsed = ++this.clock;
        // A failure is not worth remembering, so the next user tries again; a load under way finishes and goes idle.
        if (entry.failure !== null) {
            this.entries.delete(entry.key);
            return;
        }
        this.evict();
    }

    private evict(): void {
        let idle = this.idleBytes();
        if (idle <= this.options.maxIdleBytes) {
            return;
        }
        const candidates = [...this.entries.values()].filter((entry) => entry.users === 0 && entry.blob).sort((a, b) => a.lastUsed - b.lastUsed);
        for (const entry of candidates) {
            if (idle <= this.options.maxIdleBytes) {
                return;
            }
            this.entries.delete(entry.key);
            idle -= entry.blob!.size;
        }
    }

    private createUrl(blob: Blob): string {
        return this.options.createUrl?.(blob) ?? URL.createObjectURL(blob);
    }

    private notify(entry: Entry): void {
        for (const listener of [...entry.listeners]) {
            listener();
        }
    }
}
