import { beforeEach, describe, expect, test } from 'bun:test';
import { HIDE_DEADLINE_MS, MAX_CAPTURES, PageSnapshots, usePageSnapshots } from '@/browser/page-snapshots';

interface Pending {
    key: string;
    revealing: number;
    resolve(png: Uint8Array | null): void;
}

let captures: Pending[];
let timers: Map<number, { run: () => void; at: number }>;
let clock: number;
let revoked: string[];
let made: number;
let snapshots: PageSnapshots;

const PNG = new Uint8Array([1, 2, 3]);

function tick(ms: number): void {
    clock += ms;
    for (const [id, timer] of [...timers]) {
        if (timer.at <= clock) {
            timers.delete(id);
            timer.run();
        }
    }
}

/* Lets every promise the controller chains settle. */
async function settleAll(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

beforeEach(() => {
    usePageSnapshots.setState({ byKey: {} });
    captures = [];
    timers = new Map();
    clock = 0;
    revoked = [];
    made = 0;
    let nextTimer = 0;
    snapshots = new PageSnapshots({
        capture: (key) =>
            new Promise((resolve) => {
                captures.push({ key, revealing: usePageSnapshots.getState().byKey[key]?.revealing ?? 0, resolve });
            }),
        shrink: async () => new Blob(['webp']),
        createUrl: () => `blob:${++made}`,
        revokeUrl: (url) => revoked.push(url),
        setTimer: (run, ms) => {
            nextTimer += 1;
            timers.set(nextTimer, { run, at: clock + ms });
            return nextTimer;
        },
        clearTimer: (timer) => timers.delete(timer as number),
        now: () => clock,
        drawn: async () => undefined
    });
});

describe('a page on its way past the render distance', () => {
    test('is photographed while still drawn and goes once the picture is in', async () => {
        expect(snapshots.settle('a', true, 200)).toBe(false);
        expect(captures.map((capture) => [capture.key, capture.revealing])).toEqual([['a', 0]]);

        captures[0]!.resolve(PNG);
        await settleAll();
        expect(snapshots.of('a')).toMatchObject({ far: true, imageUrl: 'blob:1', takenAt: 0 });
        expect(snapshots.settle('a', true, 200)).toBe(true);
    });

    test('goes at the deadline when its picture is slow, and the late picture still lands', async () => {
        snapshots.settle('a', true, 200);
        tick(HIDE_DEADLINE_MS);
        expect(snapshots.of('a').far).toBe(true);

        captures[0]!.resolve(PNG);
        await settleAll();
        expect(snapshots.of('a').imageUrl).toBe('blob:1');
    });

    test('stays when the reason to go passed while its picture was taken', async () => {
        snapshots.judge(() => false);
        snapshots.settle('a', true, 200);
        captures[0]!.resolve(PNG);
        await settleAll();
        expect(snapshots.of('a').far).toBe(false);
    });

    test('throws away a picture that came back after the page came near again', async () => {
        snapshots.settle('a', true, 200);
        snapshots.settle('a', false, 200);
        captures[0]!.resolve(PNG);
        await settleAll();
        expect(snapshots.of('a')).toMatchObject({ far: false, imageUrl: null });
        tick(HIDE_DEADLINE_MS);
        expect(snapshots.of('a').far).toBe(false);
    });

    test('comes back at once, and the next time it goes it is photographed again', async () => {
        snapshots.settle('a', true, 200);
        captures[0]!.resolve(PNG);
        await settleAll();
        expect(snapshots.settle('a', false, 200)).toBe(false);
        expect(snapshots.of('a').far).toBe(false);

        snapshots.settle('a', true, 200);
        captures[1]!.resolve(PNG);
        await settleAll();
        expect(snapshots.of('a').imageUrl).toBe('blob:2');
        expect(revoked).toEqual(['blob:1']);
    });
});

describe('pictures over many pages', () => {
    test('are taken two at a time, and a page that waited too long is drawn again for its picture', async () => {
        for (const key of ['a', 'b', 'c']) {
            snapshots.settle(key, true, 200);
        }
        expect(captures.map((capture) => capture.key)).toEqual(['a', 'b']);
        expect(MAX_CAPTURES).toBe(2);

        // Every page goes at its deadline, the one still in line included.
        tick(HIDE_DEADLINE_MS);
        expect(['a', 'b', 'c'].map((key) => snapshots.of(key).far)).toEqual([true, true, true]);

        captures[0]!.resolve(PNG);
        await settleAll();
        expect(captures.map((capture) => [capture.key, capture.revealing])).toEqual([
            ['a', 0],
            ['b', 0],
            ['c', 1]
        ]);
        captures[2]!.resolve(PNG);
        await settleAll();
        expect(snapshots.of('c')).toMatchObject({ imageUrl: 'blob:2', revealing: 0 });
    });

    test('one at a time per page: a refresh waits for the picture in flight', async () => {
        snapshots.settle('a', true, 200);
        tick(HIDE_DEADLINE_MS);
        snapshots.refresh('a');
        expect(captures).toHaveLength(1);
        captures[0]!.resolve(PNG);
        await settleAll();
        expect(captures).toHaveLength(2);
        expect(captures[1]!.revealing).toBe(1);
    });
});

describe('a page that goes away', () => {
    test('lets go of its picture, and one that comes back for it later is ignored', async () => {
        snapshots.settle('a', true, 200);
        captures[0]!.resolve(PNG);
        await settleAll();
        snapshots.refresh('a');
        snapshots.keep([]);
        expect(revoked).toEqual(['blob:1']);
        expect(usePageSnapshots.getState().byKey.a).toBeUndefined();

        await settleAll();
        // The page went before it was drawn again, so nothing was asked of the shell.
        expect(captures).toHaveLength(1);
        expect(usePageSnapshots.getState().byKey.a).toBeUndefined();
        expect(made).toBe(1);
    });
});

describe('a picture an agent asks for', () => {
    test('of a near page is taken as it is, and of a far page while it is drawn again', async () => {
        void snapshots.photograph('a');
        expect(captures[0]!.revealing).toBe(0);
        captures[0]!.resolve(PNG);

        snapshots.settle('b', true, 200);
        tick(HIDE_DEADLINE_MS);
        const shot = snapshots.photograph('b');
        await settleAll();
        const reveal = captures.find((capture) => capture.key === 'b' && capture.revealing === 1);
        expect(reveal).toBeDefined();
        reveal!.resolve(PNG);
        expect(await shot).toBe(PNG);
        expect(snapshots.of('b').revealing).toBe(0);
    });
});
