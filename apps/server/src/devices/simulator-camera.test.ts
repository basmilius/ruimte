import { describe, expect, test } from 'bun:test';
import { SimulatorCamera, type CameraHost } from './simulator-camera.ts';

const FILES = { helper: '/opt/ruimte/native/serve-sim-camera-helper', injector: '/opt/ruimte/native/libSimCameraInjector.dylib' };

interface Fake {
    camera: SimulatorCamera;
    spawned: string[][];
    killed: number;
    sent: Array<Record<string, string>>;
    simctl: Array<{ arguments_: string[]; env: Record<string, string> }>;
    /* `hang` takes the command and never answers, as a stuck helper does. */
    answer: { send: boolean | 'hang'; listening: boolean };
    timers: Array<() => void>;
}

function fakeCamera(files: CameraHost['files'] = FILES): Fake {
    const fake: Fake = {
        camera: undefined as unknown as SimulatorCamera,
        spawned: [],
        killed: 0,
        sent: [],
        simctl: [],
        answer: { send: true, listening: true },
        timers: []
    };
    const host: CameraHost = {
        files,
        spawn: (helper, arguments_) => {
            fake.spawned.push([helper, ...arguments_]);
            return { kill: () => (fake.killed += 1) };
        },
        listening: async () => fake.answer.listening,
        send: (_socket, command) => {
            fake.sent.push(command);
            const answer = fake.answer.send;
            return answer === 'hang' ? new Promise<boolean>(() => undefined) : Promise.resolve(answer);
        }
    };
    fake.camera = new SimulatorCamera(
        '/Users/bas/.ruimte',
        host,
        async (arguments_, env) => {
            fake.simctl.push({ arguments_, env });
            return { exitCode: 0, stderr: '' };
        },
        (_ms, run) => {
            fake.timers.push(run);
            return () => {
                fake.timers = fake.timers.filter((candidate) => candidate !== run);
            };
        }
    );
    return fake;
}

describe('the camera of a simulator', () => {
    test('starts the helper on the picture, grants the camera and launches the app with the library', async () => {
        const fake = fakeCamera();
        await fake.camera.set('C0FFEE', 'com.example.scan', 'placeholder');

        const [spawned] = fake.spawned;
        expect(spawned?.slice(0, 2)).toEqual([FILES.helper, '--shm']);
        const shm = spawned?.[2] ?? '';
        expect(shm).toMatch(/^\/ruimte-cam-[0-9a-f]{8}$/);
        expect(spawned?.slice(3)).toEqual(['--socket', expect.stringMatching(/^\/tmp\/ruimte-cam-[0-9a-f]{12}\.sock$/), '--source', 'placeholder']);
        expect(fake.simctl).toEqual([
            { arguments_: ['privacy', 'C0FFEE', 'grant', 'camera', 'com.example.scan'], env: {} },
            { arguments_: ['terminate', 'C0FFEE', 'com.example.scan'], env: {} },
            {
                arguments_: ['launch', 'C0FFEE', 'com.example.scan'],
                env: { SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: FILES.injector, SIMCTL_CHILD_SIMCAM_SHM_NAME: shm }
            }
        ]);
    });

    test('switches a running helper to a file without launching the app again, and tells a video from a picture', async () => {
        const fake = fakeCamera();
        await fake.camera.set('C0FFEE', 'com.example.scan', 'placeholder');
        fake.simctl.length = 0;

        await fake.camera.set('C0FFEE', 'com.example.scan', 'file', '/Users/bas/Code/app/qr.png');
        await fake.camera.set('C0FFEE', 'com.example.scan', 'file', '/Users/bas/Code/app/walk.mov');

        expect(fake.spawned).toHaveLength(1);
        expect(fake.sent).toEqual([
            { action: 'switch', source: 'image', arg: '/Users/bas/Code/app/qr.png' },
            { action: 'switch', source: 'video', arg: '/Users/bas/Code/app/walk.mov' }
        ]);
        expect(fake.simctl).toEqual([]);
    });

    test('launches a second app with the library once', async () => {
        const fake = fakeCamera();
        await fake.camera.set('C0FFEE', 'com.example.scan', 'placeholder');
        fake.simctl.length = 0;
        await fake.camera.set('C0FFEE', 'com.example.other', 'placeholder');

        expect(fake.simctl.map((call) => call.arguments_[0])).toEqual(['privacy', 'terminate', 'launch']);
        expect(fake.simctl.at(-1)?.arguments_).toEqual(['launch', 'C0FFEE', 'com.example.other']);
    });

    test('starts the helper and the app again when the helper went away', async () => {
        const fake = fakeCamera();
        await fake.camera.set('C0FFEE', 'com.example.scan', 'placeholder');
        fake.answer.send = false;
        fake.simctl.length = 0;

        await fake.camera.set('C0FFEE', 'com.example.scan', 'placeholder');

        expect(fake.killed).toBe(1);
        expect(fake.spawned).toHaveLength(2);
        expect(fake.simctl.map((call) => call.arguments_[0])).toEqual(['privacy', 'terminate', 'launch']);
    });

    test('starts the helper again when it takes the switch and never answers', async () => {
        const fake = fakeCamera();
        await fake.camera.set('C0FFEE', 'com.example.scan', 'placeholder');
        fake.answer.send = 'hang';

        const switching = fake.camera.set('C0FFEE', 'com.example.scan', 'placeholder');
        await Promise.resolve();
        expect(fake.timers).toHaveLength(1);
        fake.timers[0]!();
        await switching;

        expect(fake.killed).toBe(1);
        expect(fake.spawned).toHaveLength(2);
    });

    test('off stops the helper and launches the app without the library', async () => {
        const fake = fakeCamera();
        await fake.camera.set('C0FFEE', 'com.example.scan', 'placeholder');
        fake.simctl.length = 0;

        await fake.camera.set('C0FFEE', 'com.example.scan', 'off');

        expect(fake.killed).toBe(1);
        expect(fake.simctl).toEqual([
            { arguments_: ['terminate', 'C0FFEE', 'com.example.scan'], env: {} },
            { arguments_: ['launch', 'C0FFEE', 'com.example.scan'], env: {} }
        ]);
    });

    test('refuses a file it cannot show, a file without a path, a helper that never listens and a build without one', async () => {
        const fake = fakeCamera();
        await expect(fake.camera.set('C0FFEE', 'com.example.scan', 'file', '/Users/bas/Code/app/notes.txt')).rejects.toMatchObject({
            code: 'device-path-refused'
        });
        await expect(fake.camera.set('C0FFEE', 'com.example.scan', 'file')).rejects.toMatchObject({ code: 'device-path-refused' });

        fake.answer.listening = false;
        await expect(fake.camera.set('C0FFEE', 'com.example.scan', 'placeholder')).rejects.toMatchObject({ code: 'device-helper-failed' });
        expect(fake.killed).toBe(1);

        const without = fakeCamera(null);
        expect(without.camera.available).toBe(false);
        await expect(without.camera.set('C0FFEE', 'com.example.scan', 'placeholder')).rejects.toMatchObject({ code: 'device-helper-unavailable' });
    });

    test('a development daemon and an installed one never share a helper', async () => {
        const first = fakeCamera();
        await first.camera.set('C0FFEE', 'com.example.scan', 'placeholder');
        const second = fakeCamera();
        const other = new SimulatorCamera(
            '/Users/bas/.ruimte-dev',
            {
                files: FILES,
                spawn: (helper, arguments_) => {
                    second.spawned.push([helper, ...arguments_]);
                    return { kill: () => undefined };
                },
                listening: async () => true,
                send: async () => true
            },
            async () => ({ exitCode: 0, stderr: '' })
        );
        await other.set('C0FFEE', 'com.example.scan', 'placeholder');

        expect(second.spawned[0]?.[2]).not.toBe(first.spawned[0]?.[2]);
        expect(second.spawned[0]?.[4]).not.toBe(first.spawned[0]?.[4]);
    });

    test('stops every helper at once, for a daemon that stops', async () => {
        const fake = fakeCamera();
        await fake.camera.set('C0FFEE', 'com.example.scan', 'placeholder');
        await fake.camera.set('BEEF', 'com.example.scan', 'placeholder');

        fake.camera.stopAll();

        expect(fake.killed).toBe(2);
    });
});
