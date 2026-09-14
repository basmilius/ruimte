interface Bucket {
    tokens: number;
    updatedAt: number;
}

/*
 * A token bucket per key (an address or a public key): `capacity` at once, refilled evenly over
 * `windowMs`. The buckets that are full again are pruned, so a key that stopped talking costs nothing.
 */
export class RateLimiter {
    private readonly buckets = new Map<string, Bucket>();
    private readonly capacity: number;
    private readonly msPerToken: number;
    private readonly now: () => number;

    constructor(capacity: number, windowMs: number, now: () => number = Date.now) {
        this.capacity = capacity;
        this.msPerToken = windowMs / capacity;
        this.now = now;
    }

    /* Takes a token: 0 when there was one, otherwise how many milliseconds until there is. */
    take(key: string): number {
        const now = this.now();
        const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
        bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.updatedAt) / this.msPerToken);
        bucket.updatedAt = now;
        this.buckets.set(key, bucket);
        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return 0;
        }
        return Math.ceil((1 - bucket.tokens) * this.msPerToken);
    }

    prune(): void {
        const now = this.now();
        for (const [key, bucket] of this.buckets) {
            if (bucket.tokens + (now - bucket.updatedAt) / this.msPerToken >= this.capacity) {
                this.buckets.delete(key);
            }
        }
    }

    get size(): number {
        return this.buckets.size;
    }
}
