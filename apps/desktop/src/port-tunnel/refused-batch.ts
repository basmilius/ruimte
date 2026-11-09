/* The least time between two messages about the refused requests of one page, so a page that asks for thousands tells the window once. */
const BATCH_MS = 500;

interface Batch {
    count: number;
    url: string;
}

/* Counts the requests a tunnel's session refused per page and reports them in steps rather than one by one. */
export class RefusedBatch {
    private readonly report: (guestId: number, url: string, count: number) => void;
    private readonly after: (ms: number, fire: () => void) => void;
    private readonly waiting = new Map<number, Batch>();

    constructor(report: (guestId: number, url: string, count: number) => void, after: (ms: number, fire: () => void) => void) {
        this.report = report;
        this.after = after;
    }

    add(guestId: number, url: string): void {
        const batch = this.waiting.get(guestId);

        if (batch !== undefined) {
            batch.count += 1;
            batch.url = url;

            return;
        }

        this.waiting.set(guestId, { count: 1, url });
        this.after(BATCH_MS, () => {
            const done = this.waiting.get(guestId);

            this.waiting.delete(guestId);

            if (done !== undefined) {
                this.report(guestId, done.url, done.count);
            }
        });
    }
}
