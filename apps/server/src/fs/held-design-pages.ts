import { randomUUID } from 'node:crypto';

// A client asks for one page at a time; a few more cover a stage and an export at once without holding pages nobody reads.
const PAGES_PER_CLIENT = 4;

interface HeldPage {
    clientId: string;
    bytes: Uint8Array;
    sent: number;
}

/*
 * The design pages built for `design.page`, held until their bytes went out over `bytes.read`. A page is
 * too large for one frame, and building it again for every piece would read the whole folder each time.
 * The id is the only way to a page, so it is random. A client that asks for more than a few lets go of
 * its oldest, and one that leaves lets go of all of them; nothing else waits on a clock.
 */
export class HeldDesignPages {
    private readonly pages = new Map<string, HeldPage>();

    hold(clientId: string, html: string): { pageId: string; size: number } {
        const own = [...this.pages].filter(([, page]) => page.clientId === clientId);

        for (const [pageId] of own.slice(0, Math.max(0, own.length - PAGES_PER_CLIENT + 1))) {
            this.pages.delete(pageId);
        }

        const pageId = randomUUID();
        const bytes = new TextEncoder().encode(html);
        this.pages.set(pageId, { clientId, bytes, sent: 0 });

        return { pageId, size: bytes.length };
    }

    bytesOf(pageId: string): Uint8Array | null {
        return this.pages.get(pageId)?.bytes ?? null;
    }

    /* A piece went out; once every byte did, the page goes. Pieces arrive out of order, so it counts bytes rather than waiting for the last offset. */
    sent(pageId: string, length: number): void {
        const page = this.pages.get(pageId);

        if (page === undefined) {
            return;
        }

        page.sent += length;

        if (page.sent >= page.bytes.length) {
            this.pages.delete(pageId);
        }
    }

    detachAll(clientId: string): void {
        for (const [pageId, page] of this.pages) {
            if (page.clientId === clientId) {
                this.pages.delete(pageId);
            }
        }
    }
}
