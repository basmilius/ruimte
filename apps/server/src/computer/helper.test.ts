import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeHelper, tempHome } from './computer-test-helpers.ts';
import { answerWithinMs, ComputerHelper, HelperFailure, locateHelperApp } from './helper.ts';
import { DoctorResultSchema, StateResultSchema } from './helper-protocol.ts';

const helperOver = async (fake: FakeHelper, launches: string[] = [], appPath: string | null = '/Apps/Helper.app') =>
    new ComputerHelper({
        home: await tempHome(),
        appPath,
        transport: fake,
        launch: async (path, home) => {
            launches.push(`${path} ${home}`);
            fake.running = true;
        },
        sleep: async () => undefined,
        startWaitMs: 500
    });

const failureOf = async (work: Promise<unknown>): Promise<HelperFailure> => {
    try {
        await work;
    } catch (error) {
        return error as HelperFailure;
    }
    throw new Error('no failure');
};

describe('the helper', () => {
    test('gets the time a wait waits for on top of the time any request has to answer in', () => {
        expect(answerWithinMs({ command: 'click' })).toBe(20_000);
        expect(answerWithinMs({ command: 'wait', timeout: 110 })).toBe(130_000);
    });

    test('is started once when its socket is closed, and signs every request with the local secret', async () => {
        const fake = new FakeHelper();
        fake.running = false;
        const launches: string[] = [];
        const helper = await helperOver(fake, launches);
        const doctor = await helper.request({ command: 'doctor', prompt: false }, DoctorResultSchema);
        expect(doctor.ready).toBe(true);
        expect(launches).toHaveLength(1);
        expect(fake.requests.every((request) => request.secret === 'secret')).toBe(true);
    });

    test('is only asked, never started, by ask and quit', async () => {
        const fake = new FakeHelper();
        fake.running = false;
        const launches: string[] = [];
        const helper = await helperOver(fake, launches);
        expect(await helper.ask({ command: 'doctor' }, DoctorResultSchema)).toBeNull();
        await helper.quit();
        expect(launches).toEqual([]);
    });

    test('names a helper that serves another home, and a reply it cannot read', async () => {
        const fake = new FakeHelper();
        const helper = await helperOver(fake);
        fake.error = 'refused: the request does not carry the local secret of /other';
        expect((await failureOf(helper.request({ command: 'state', app: '1' }, StateResultSchema))).code).toBe('helper-busy');
        fake.error = null;
        expect((await failureOf(helper.request({ command: 'click', app: '1' }, StateResultSchema))).code).toBe('helper-invalid');
    });

    test('says so on a machine without one', async () => {
        const helper = await helperOver(new FakeHelper(), [], null);
        expect(helper.present).toBe(false);
        expect((await failureOf(helper.request({ command: 'apps' }, DoctorResultSchema))).code).toBe('unavailable');
    });

    test('gives up on a helper that never opens its socket', async () => {
        const fake = new FakeHelper();
        fake.running = false;
        const helper = new ComputerHelper({
            home: await tempHome(),
            appPath: '/Apps/Helper.app',
            transport: fake,
            launch: async () => undefined,
            sleep: async () => undefined,
            startWaitMs: 300
        });
        expect((await failureOf(helper.request({ command: 'apps' }, DoctorResultSchema))).code).toBe('helper-unreachable');
    });
});

describe('quitting the helper for a fresh launch', () => {
    test('waits while it still answers, and returns once its socket is closed', async () => {
        const fake = new FakeHelper();
        fake.lingerAfterQuit = 3;
        const helper = await helperOver(fake);
        await helper.quitAndWait();
        expect(fake.running).toBe(false);
        expect(fake.requests.map((request) => request.command)).toEqual(['quit', 'doctor', 'doctor', 'doctor']);
    });

    test('gives up on a helper that keeps answering', async () => {
        const fake = new FakeHelper();
        fake.lingerAfterQuit = 1_000;
        const helper = await helperOver(fake);
        expect((await failureOf(helper.quitAndWait())).code).toBe('helper-unreachable');
    });
});

describe('where the helper is', () => {
    test('beside the packaged daemon, in a checkout, and nowhere off macOS', async () => {
        const root = await mkdtemp(join(tmpdir(), 'ruimte-helper-'));
        const packaged = join(root, 'Ruimte.app', 'Contents');
        await mkdir(join(packaged, 'Helpers', 'Ruimte Computer Use.app'), { recursive: true });
        const execPath = join(packaged, 'Resources', 'bin', 'ruimte');
        expect(locateHelperApp({ platform: 'darwin', compiled: true, execPath, sourceDir: '/nowhere' })).toBe(
            join(packaged, 'Helpers', 'Ruimte Computer Use.app')
        );
        expect(locateHelperApp({ platform: 'linux', compiled: true, execPath, sourceDir: '/nowhere' })).toBeNull();

        await mkdir(join(root, 'apps', 'computer-use', 'dist', 'Ruimte Computer Use Dev.app'), { recursive: true });
        const sourceDir = join(root, 'apps', 'server', 'src');
        expect(locateHelperApp({ platform: 'darwin', compiled: false, execPath: '/usr/bin/bun', sourceDir })).toBe(
            join(root, 'apps', 'computer-use', 'dist', 'Ruimte Computer Use Dev.app')
        );
    });
});
