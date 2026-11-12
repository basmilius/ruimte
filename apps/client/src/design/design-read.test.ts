import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { BYTES_CHUNK_MAX } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { TransportError } from '@/transport-api/transport';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { standaloneDesignPage } from './design-read';

// The bound of `HeldDesignPages` (apps/server/src/fs/held-design-pages.ts): past it a client's oldest page goes.
const HELD_PAGES = 8;

// Three pieces each, so a page stays held across several reads while the others are built.
const PAGE = `<!doctype html>${'x'.repeat(2 * BYTES_CHUNK_MAX + 1)}`;
const PIECES = Math.ceil(PAGE.length / BYTES_CHUNK_MAX);

let machine: FakeMachine;
let disconnect: () => void;

// Builds the machine finished; it answers them at once.
let builtPages: Array<() => void>;

// Pieces asked for, in the order they came; a slow link carries one at a time.
let pieces: Array<() => void>;

function settle(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

function answerLater<T>(queue: Array<() => void>, answer: () => T): Promise<T> {
    return new Promise((resolve, reject) => {
        queue.push(() => {
            try {
                resolve(answer());
            } catch (error) {
                reject(error);
            }
        });
    });
}

/* A machine that holds a client's built pages as the daemon does: the oldest goes past the bound, and a page read whole goes. */
function holdLikeTheDaemon(): void {
    const held = new Map<string, Set<number>>();
    let built = 0;

    machine.answer('design.page', () =>
        answerLater(builtPages, () => {
            built += 1;
            const pageId = `page-${built}`;
            held.set(pageId, new Set());

            for (const oldest of held.keys()) {
                if (held.size <= HELD_PAGES) {
                    break;
                }

                held.delete(oldest);
            }

            return { kind: 'page' as const, pageId, size: PAGE.length };
        })
    );
    machine.answer('bytes.read', ({ resource, offset, length }) =>
        answerLater(pieces, () => {
            const pageId = resource.kind === 'designPage' ? resource.pageId : '';
            const sent = held.get(pageId);

            if (sent === undefined) {
                throw new TransportError('not-found', 'Not a design page this machine holds');
            }

            sent.add(offset);

            if (sent.size >= PIECES) {
                held.delete(pageId);
            }

            return { mime: 'text/html; charset=utf-8', size: PAGE.length, version: pageId, offset, data: btoa(PAGE.slice(offset, offset + length)) };
        })
    );
}

beforeEach(() => {
    builtPages = [];
    pieces = [];
    machine = new FakeMachine();
    disconnect = connectFakeMachine(machine);
    holdLikeTheDaemon();
});

afterEach(() => {
    disconnect();
});

describe('the pages of a canvas built on the machine', () => {
    test('all arrive, each built once, when more load at once than the machine holds over a link slower than its builds', async () => {
        const loads = Array.from({ length: 10 }, (_, i) =>
            standaloneDesignPage(LOCAL_ENDPOINT_ID, { projectId: 'atlas', designId: `design-${i}`, folder: `/work/atlas/designs/${i}` }, 'index.html').then(
                (html) => html === PAGE,
                (error: unknown) => String(error)
            )
        );

        await settle();

        while (builtPages.length > 0 || pieces.length > 0) {
            for (const answer of builtPages.splice(0)) {
                answer();
            }

            pieces.shift()?.();
            await settle();
        }

        expect(await Promise.all(loads)).toEqual(Array.from({ length: 10 }, () => true));
        expect(machine.requests('design.page')).toHaveLength(10);
    });
});
