import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homeFolder } from '@ruimte/service/home';
import { pngOf } from './devices/device-test-helpers.ts';
import { keepCapture, pngSize, sweepDeviceCaptures, sweepScreenshots, writeCapture } from './shots.ts';
import { tempHomes } from './temp-home-test-helpers.ts';

describe('pngSize', () => {
    test('reads the size from the header chunk of a png', () => {
        expect(pngSize(pngOf(1206, 2622))).toEqual({ width: 1206, height: 2622 });
    });

    test('answers null for anything that is not a png', () => {
        expect(pngSize(new Uint8Array(40))).toBeNull();
        expect(pngSize(pngOf(1, 1).subarray(0, 20))).toBeNull();
        expect(pngSize(new TextEncoder().encode('\u0089PNG\r\n\u001a\n    JUNK00000000'))).toBeNull();
    });
});

describe('captures', () => {
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    let home: string;

    const newHome = tempHomes('ruimte-shots-');

    beforeEach(async () => {
        home = await newHome();
    });

    test('a capture goes after a week, one placed on a canvas stays', async () => {
        const passing = await writeCapture(home, 'phone', pngOf(1, 1), 1_000);
        const placed = await keepCapture(home, 'phone', pngOf(1, 1), 1_000);
        await writeCapture(home, 'phone', pngOf(1, 1), 1_000 + WEEK_MS + 1);
        expect(existsSync(passing)).toBe(false);
        expect(existsSync(placed)).toBe(true);
    });

    test('maintenance takes an expired capture without a new one, never a placed one or a file that is not ours', async () => {
        const passing = await writeCapture(home, 'phone', pngOf(1, 1), 1_000);
        const recent = await writeCapture(home, 'phone', pngOf(1, 1), 1_000 + WEEK_MS);
        const placed = await keepCapture(home, 'phone', pngOf(1, 1), 1_000);
        const foreign = join(homeFolder(home, 'deviceCaptures'), 'notes.png');
        await writeFile(foreign, '');
        const reclaimed = await sweepDeviceCaptures(home, 1_000 + WEEK_MS + 1);

        expect(reclaimed).toEqual({ files: 1, bytes: pngOf(1, 1).byteLength });
        expect(existsSync(passing)).toBe(false);
        expect(existsSync(recent)).toBe(true);
        expect(existsSync(placed)).toBe(true);
        expect(existsSync(foreign)).toBe(true);
    });

    test('maintenance takes a screenshot past a day, stops once aborted, and answers nothing for a missing folder', async () => {
        const DAY_MS = 24 * 60 * 60 * 1000;

        expect(await sweepScreenshots(home, DAY_MS)).toEqual({ files: 0, bytes: 0 });

        const folder = join(home, 'screenshots');
        await mkdir(folder);
        await writeFile(join(folder, 'agent-1000.png'), 'old');
        await writeFile(join(folder, `agent-${DAY_MS}.png`), 'new');
        const aborted = new AbortController();
        aborted.abort();

        expect(await sweepScreenshots(home, DAY_MS + 1_001, aborted.signal)).toEqual({ files: 0, bytes: 0 });
        expect(await sweepScreenshots(home, DAY_MS + 1_001)).toEqual({ files: 1, bytes: 3 });
        expect(await readdir(folder)).toEqual([`agent-${DAY_MS}.png`]);
    });
});
