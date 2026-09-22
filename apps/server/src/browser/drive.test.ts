import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserDriveAction, BrowserInfo, BrowserPageState } from '@ruimte/contracts';
import { BrowserDriver, type DriveOutcome } from './drive.ts';

let home: string;
let ownPage: BrowserInfo | null;
let driven: BrowserDriveAction[];
let asked: BrowserDriveAction[];
let held: BrowserPageState | null;
let answer: DriveOutcome | null;

const infoOf = (browserId: string): BrowserInfo => ({
    browserId,
    url: 'https://example.com',
    title: 'Example',
    loading: false,
    canGoBack: true,
    canGoForward: false,
    error: null
});

const stateOf = (browserId: string): BrowserPageState => ({
    browserId,
    url: 'https://client.example',
    title: 'Client',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null
});

const driverOf = (): BrowserDriver =>
    new BrowserDriver(
        home,
        {
            drive: async (_browserId, action) => {
                driven.push(action);
                return ownPage;
            },
            capture: async () => (ownPage === null ? null : new Uint8Array([1, 2, 3]))
        },
        {
            drive: async (_browserId, action) => {
                asked.push(action);
                return answer;
            },
            state: () => held
        }
    );

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-drive-'));
    ownPage = null;
    driven = [];
    asked = [];
    held = null;
    answer = null;
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('BrowserDriver', () => {
    test('a page this machine runs itself is driven here, and no client is asked', async () => {
        ownPage = infoOf('page-1');
        expect(await driverOf().drive('page-1', { kind: 'back' })).toEqual({
            state: { browserId: 'page-1', url: 'https://example.com', title: 'Example', loading: false, canGoBack: true, canGoForward: false, error: null }
        });
        expect(driven).toEqual([{ kind: 'back' }]);
        expect(asked).toEqual([]);
    });

    test('a page a client holds is asked, and where it stands is the report it already sent', async () => {
        held = stateOf('page-1');
        expect((await driverOf().drive('page-1', { kind: 'state' }))?.state?.url).toBe('https://client.example');
        expect(asked).toEqual([]);

        answer = { state: stateOf('page-1') };
        await driverOf().drive('page-1', { kind: 'reload', ignoreCache: true });
        expect(asked).toEqual([{ kind: 'reload', ignoreCache: true }]);
    });

    test('a page nobody has open is a null, whichever kind of page the node would be', async () => {
        expect(await driverOf().drive('page-1', { kind: 'state' })).toBeNull();
        expect(await driverOf().drive('page-1', { kind: 'go', url: 'https://example.com' })).toBeNull();
        expect(await driverOf().shot('page-1')).toBeNull();
    });

    test('a shot is written under the machine folder, outside any project', async () => {
        ownPage = infoOf('page-1');
        const outcome = await driverOf().shot('page-1');
        expect(outcome?.path?.startsWith(join(home, 'screenshots'))).toBe(true);
        expect([...(await readFile(outcome!.path!))]).toEqual([1, 2, 3]);
    });

    test('yesterday’s shots are swept as a new one is written', async () => {
        const folder = join(home, 'screenshots');
        await mkdir(folder, { recursive: true });
        const old = join(folder, `page-1-${Date.now() - 48 * 60 * 60 * 1000}.png`);
        const recent = join(folder, `page-1-${Date.now() - 60_000}.png`);
        await writeFile(old, 'old');
        await writeFile(recent, 'recent');

        ownPage = infoOf('page-1');
        await driverOf().shot('page-1');
        const names = await readdir(folder);
        expect(names).not.toContain(old.split('/').at(-1)!);
        expect(names).toContain(recent.split('/').at(-1)!);
    });

    test('a client that holds the page but cannot photograph it says so instead of writing a file', async () => {
        answer = { state: stateOf('page-1'), error: 'This client could not photograph the page' };
        const outcome = await driverOf().shot('page-1');
        expect(outcome).toEqual({ path: null, state: stateOf('page-1'), error: 'This client could not photograph the page' });
        expect(await readdir(home)).toEqual([]);
    });
});
