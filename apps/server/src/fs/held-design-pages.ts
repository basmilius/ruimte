import { randomUUID } from 'node:crypto';
import { DESIGN_PAGE_SENT_MAX_BYTES } from '@ruimte/contracts';

// Room for the design nodes of a canvas that build at once, each as large as a page gets; a read that stopped halfway holds no more than this.
const HELD_BYTES_PER_CLIENT = 4 * DESIGN_PAGE_SENT_MAX_BYTES;

// Small pages weigh next to nothing against the byte bound, so their number has a bound of its own.
const HELD_PAGES_PER_CLIENT = 8;

// A client reads a page in a few large pieces. One that reads it in scattered bytes would grow the record of what went out without end.
const SENT_RANGES_PER_PAGE = 256;

interface HeldPage {
    clientId: string;
    bytes: Uint8Array;

    /* The byte ranges that went out, sorted and merged, each `[start, end)`. */
    sent: Array<[number, number]>;
}

/*
 * The design pages built for `design.page`, held until their bytes went out over `bytes.read`. A page is
 * too large for one frame, and building it again for every piece would read the whole folder each time.
 * A page is read only by the client it was built for, and its id is random. A client that holds more than
 * the bound lets go of its oldest, and one that leaves lets go of all of them; nothing else waits on a clock.
 */
export class HeldDesignPages {
    private readonly pages = new Map<string, HeldPage>();

    hold(clientId: string, html: string): { pageId: string; size: number } {
        const bytes = new TextEncoder().encode(html);
        const own = [...this.pages].filter(([, page]) => page.clientId === clientId);
        let weight = own.reduce((total, [, page]) => total + page.bytes.length, bytes.length);
        let count = own.length + 1;

        // A page larger than the bound is still held, alone.
        for (const [pageId, page] of own) {
            if (weight <= HELD_BYTES_PER_CLIENT && count <= HELD_PAGES_PER_CLIENT) {
                break;
            }

            this.pages.delete(pageId);
            weight -= page.bytes.length;
            count -= 1;
        }

        const pageId = randomUUID();
        this.pages.set(pageId, { clientId, bytes, sent: [] });

        return { pageId, size: bytes.length };
    }

    bytesOf(clientId: string, pageId: string): Uint8Array | null {
        const page = this.pages.get(pageId);

        return page?.clientId === clientId ? page.bytes : null;
    }

    /* A piece went out; once the pieces cover every byte, the page goes. They arrive out of order and a retry reads one again. */
    sent(clientId: string, pageId: string, offset: number, length: number): void {
        const page = this.pages.get(pageId);

        if (page?.clientId !== clientId) {
            return;
        }

        page.sent = mergeRange(page.sent, [offset, offset + length]);
        const [first, ...gaps] = page.sent;

        const whole = first !== undefined && gaps.length === 0 && first[0] === 0 && first[1] >= page.bytes.length;

        if (whole || page.sent.length > SENT_RANGES_PER_PAGE) {
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

function mergeRange(ranges: ReadonlyArray<[number, number]>, added: [number, number]): Array<[number, number]> {
    const merged: Array<[number, number]> = [];

    for (const range of [...ranges, added].sort((one, other) => one[0] - other[0])) {
        const last = merged.at(-1);

        if (last !== undefined && range[0] <= last[1]) {
            last[1] = Math.max(last[1], range[1]);
        } else {
            merged.push([range[0], range[1]]);
        }
    }

    return merged;
}
