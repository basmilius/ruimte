import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { DeviceInfo, ProjectContent, ProjectEdge, ProjectNode } from '@ruimte/contracts';
import type { CanvasHost } from '../canvas/host.ts';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import { DEVICE_READY_WAIT_MS, DeviceDriver } from '../devices/agent-driver.ts';
import { DeviceControl } from '../devices/control.ts';
import { ReadingBackend, RecordingBackend, SIMULATOR, pngOf } from '../devices/device-test-helpers.ts';
import { DeviceManager } from '../devices/manager.ts';
import { deviceToolkit } from './device-tools.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';

const PHONE: ProjectNode = {
    id: 'phone-1',
    kind: 'device',
    title: 'Phone',
    x: 700,
    y: 0,
    w: 400,
    h: 800,
    device: { platform: 'ios', kind: 'simulator', name: SIMULATOR.name, runtime: SIMULATOR.runtime }
};

let home: string;
let backend: RecordingBackend;
let nodes: ProjectNode[];
let edges: ProjectEdge[];
let host: CanvasHost;
let bound: Set<string>;
let projectFolder = '/tmp/p1';

function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            { kind: 'canvas', id: 'main', name: 'Canvas', nodes, texts: [], edges, layouts: [] },
            { kind: 'canvas', id: 'other', name: 'Other', nodes: [{ ...PHONE, id: 'phone-2' }], texts: [], edges: [], layouts: [] }
        ]
    };
}

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-device-tools-'));
    bound = new Set();
    backend = new RecordingBackend();
    backend.shot = pngOf(1000, 2000);
    nodes = [{ id: 'chat-1', kind: 'chat', title: 'Tester', x: 0, y: 0, w: 560, h: 360 }, PHONE];
    edges = [{ id: 'edge-1', from: 'phone-1', to: 'chat-1' }];
    host = hostWith([backend]);
});

function hostWith(backends: RecordingBackend[]): CanvasHost {
    return {
        projects: {
            locate: (id: string) => (id.startsWith('chat-') ? { projectId: 'p1', folder: projectFolder, canvasId: 'main' } : null),
            read: async () => content(),
            machineOfNode: (nodeId: string) => (bound.has(nodeId) ? 'machine-b' : null)
        },
        checkouts: { paths: async () => [] },
        devices: driverWith(backends)
    } as unknown as CanvasHost;
}

/* The system's temporary folder holds every folder of these tests, so it stands in for none unless a test names one. */
function driverWith(backends: RecordingBackend[], options: Partial<ConstructorParameters<typeof DeviceDriver>[0]> = {}): DeviceDriver {
    return new DeviceDriver({
        home,
        manager: new DeviceManager(backends),
        timers: new ManualTimers(),
        sleep: async () => undefined,
        tempFolders: [],
        ...options
    });
}

/* A second device node beside the phone, linked to the caller, pointing at this device. */
function linkedTo(info: DeviceInfo): RecordingBackend {
    const other = new RecordingBackend(info);
    other.shot = pngOf(1080, 2400);
    nodes = [...nodes, { ...PHONE, id: 'other-1', device: { platform: info.platform, kind: info.kind, name: info.name, runtime: info.runtime } }];
    edges = [...edges, { id: 'edge-2', from: 'chat-1', to: 'other-1' }];
    host = hostWith([backend, other]);
    return other;
}

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

async function run(tool: string, input: Record<string, unknown>, caller = 'chat-1'): Promise<string[]> {
    return (await toolAnswer(tool, input, toolCall(caller, host))).lines;
}

describe('device tools', () => {
    test('has no tool that erases, stops, restarts or folds a device or sets its camera, which only a person does', () => {
        const names = deviceToolkit.tools.map((tool) => tool.name);

        for (const word of ['erase', 'boot', 'shutdown', 'stop', 'restart', 'fold', 'hinge', 'camera']) {
            expect(names.some((name) => name.includes(word))).toBe(false);
        }
        expect(names).toEqual([
            'device_list',
            'device_start',
            'device_state',
            'device_shot',
            'device_input',
            'device_app',
            'device_set',
            'device_open',
            'device_permission',
            'device_push',
            'device_biometric',
            'device_clipboard',
            'device_record',
            'device_install',
            'device_media'
        ]);
    });

    test('an input takes only the fields of its action', async () => {
        expect(await run('device_input', { action: 'button', device: 'phone-1', name: 'home', at: '1,1' })).toEqual([
            'refused\tbad-arguments\tdevice_input button takes no at',
            'fields\taction\tdevice\tname'
        ]);
        expect((await run('device_input', { action: 'swipe', device: 'phone-1', from: '1,1' }))[0]).toBe(
            'refused\tbad-arguments\tto needs a pixel of the last shot, as x,y'
        );
        expect(backend.source.inputs).toEqual([]);
    });

    test('says which device the node holds, by its device id, and what works on it', async () => {
        expect(await run('device_state', { device: 'phone-1' })).toEqual([
            'device\tsim-1\tiPhone 18 Pro\tios\tsimulator\tiOS 27.0',
            'state\tbooted',
            'power\tnone',
            'screen\tunknown until device_shot',
            'buttons\thome swipeHome appSwitcher lock siri',
            'can\tshot\tyes',
            'can\tinput\tyes',
            'can\ttype\tyes',
            'can\tlaunch\tyes',
            'can\ttree\tno'
        ]);
        await run('device_shot', { device: 'phone-1' });
        expect(await run('device_state', { device: 'phone-1' })).toContain('screen\t1000x2000');
    });

    test('refuses a device node that runs on another machine, and touches nothing', async () => {
        bound.add('phone-1');
        expect((await run('device_state', { device: 'phone-1' }))[0]).toStartWith('refused\tnode-on-other-machine\t');
        expect((await run('device_shot', { device: 'phone-1' }))[0]).toStartWith('refused\tnode-on-other-machine\t');
        expect(backend.lists).toBe(0);
        expect(backend.actions).toEqual([]);
    });

    test('refuses work another machine gave, over a line on its hidden canvas or from a task it gave, and touches nothing', async () => {
        const hidden = content();
        const main = hidden.views[0]!;
        host = {
            ...host,
            projects: { ...host.projects, read: async () => ({ ...hidden, views: [{ ...main, hidden: true }, ...hidden.views.slice(1)] }) }
        } as CanvasHost;
        expect((await run('device_shot', { device: 'phone-1' }))[0]).toStartWith('refused\tpeer-no-device\t');

        host = { ...hostWith([backend]), untrusted: { node: () => true, inFolder: () => false, fromPeer: (id: string) => id === 'chat-1' } } as CanvasHost;
        expect((await run('device_state', { device: 'phone-1' }))[0]).toStartWith('refused\tpeer-no-device\t');
        expect(backend.actions).toEqual([]);
    });

    test('says a device this machine does not have is missing, and touches nothing', async () => {
        backend.info = { ...SIMULATOR, name: 'iPhone 12' };
        expect((await run('device_state', { device: 'phone-1' })).slice(0, 4)).toEqual([
            'device\tphone-1\tiPhone 18 Pro\tios\tsimulator\tiOS 27.0',
            'state\tmissing',
            'power\tnone',
            'screen\tunknown'
        ]);
        expect((await run('device_shot', { device: 'phone-1' }))[0]).toStartWith('refused\tdevice-missing\t');
    });

    test("says a phone's own battery, a simulated one as such, and unknown when the phone cannot say", async () => {
        const phone = linkedTo({
            ...SIMULATOR,
            backendId: 'android',
            platform: 'android',
            kind: 'physical',
            name: 'Pixel 9',
            runtime: 'API 36',
            deviceId: 'R5CT'
        });
        const answers = [{ level: 14, plugged: false, charging: false }, { level: 50, plugged: true, charging: true, simulated: true }, null];
        Object.assign(phone, { power: async () => answers.shift() ?? null });
        const powerOf = async (): Promise<string | undefined> => (await run('device_state', { device: 'other-1' })).find((line) => line.startsWith('power\t'));

        expect(await powerOf()).toBe('power\t14%\tbattery\tnot-charging');
        expect(await powerOf()).toBe('power\t50%\tplugged\tcharging\tsimulated');
        expect(await powerOf()).toBe('power\tunknown');
    });

    test('writes a shot and prints its path and size, then taps in its pixels', async () => {
        const [line] = await run('device_shot', { device: 'phone-1' });
        const [kind, path, size] = line!.split('\t');
        expect([kind, dirname(path!), size]).toEqual(['shot', join(home, 'screenshots'), '1000x2000']);
        expect(basename(path!)).toMatch(/^phone-1-\d+\.png$/);
        expect(await run('device_input', { action: 'tap', device: 'phone-1', at: '500,500' })).toEqual([
            'done\ttap\tphone-1\tiPhone 18 Pro',
            'next\tdevice_shot\tshows what it did'
        ]);
        expect(backend.source.inputs[0]).toEqual({ kind: 'pointer', phase: 'down', x: 0.5, y: 0.25 });
    });

    test('swipes, presses a button the device announces and opens an app', async () => {
        await run('device_shot', { device: 'phone-1' });
        expect((await run('device_input', { action: 'swipe', device: 'phone-1', from: '500,1800', to: '500,200' }))[0]).toBe(
            'done\tswipe\tphone-1\tiPhone 18 Pro'
        );
        expect(backend.source.inputs.at(-1)).toEqual({ kind: 'pointer', phase: 'up', x: 0.5, y: 0.1 });
        expect((await run('device_input', { action: 'button', device: 'phone-1', name: 'home' }))[0]).toBe('done\tbutton\tphone-1\tiPhone 18 Pro');
        expect(backend.source.inputs.at(-1)).toEqual({ kind: 'button', button: 'home' });
        expect((await run('device_app', { action: 'launch', device: 'phone-1', app: 'com.example.app' }))[0]).toBe('done\tlaunch\tphone-1\tiPhone 18 Pro');
        expect(backend.actions).toMatchObject([{ action: 'launchApp', appId: 'com.example.app' }]);
    });

    test('types into whatever has the focus, and needs the text', async () => {
        expect((await run('device_input', { action: 'type', device: 'phone-1', text: 'Grüße\nnext' }))[0]).toBe('done\ttype\tphone-1\tiPhone 18 Pro');
        expect(backend.typed).toEqual(['Grüße\nnext']);
        expect((await run('device_input', { action: 'type', device: 'phone-1' }))[0]).toBe('refused\tbad-arguments\ttext needs the text to type');
    });

    test('refuses a button the device does not announce, with the ones it does', async () => {
        expect(await run('device_input', { action: 'button', device: 'phone-1', name: 'back' })).toEqual([
            'refused\tunknown-button\tiPhone 18 Pro has no back button',
            'button\thome',
            'button\tswipeHome',
            'button\tappSwitcher',
            'button\tlock',
            'button\tsiri'
        ]);
    });

    test('refuses a tap before any shot and a pixel written the wrong way', async () => {
        expect((await run('device_input', { action: 'tap', device: 'phone-1', at: '10,10' }))[0]).toStartWith('refused\tno-shot\t');
        expect((await run('device_input', { action: 'tap', device: 'phone-1', at: '10' }))[0]).toStartWith(
            'refused\tbad-arguments\tat takes a pixel of the last shot as x,y'
        );
        expect((await run('device_input', { action: 'tap', device: 'phone-1' }))[0]).toBe(
            'refused\tbad-arguments\tA tap takes either an element of the last state or a pixel of the last shot as x and y'
        );
    });

    test('operates a device by the id device list gives it, or by any device node of the project, with no line', async () => {
        edges = [];
        expect(await run('device_list', {})).toEqual(['device\tsim-1\tiPhone 18 Pro\tios\tsimulator\tiOS 27.0\tbooted']);
        await run('device_shot', { device: 'sim-1' });
        expect((await run('device_input', { action: 'tap', device: 'sim-1', at: '1,1' }))[0]).toBe('done\ttap\tsim-1\tiPhone 18 Pro');
        expect((await run('device_input', { action: 'tap', device: 'phone-2', at: '1,1' }))[0]).toBe('done\ttap\tphone-2\tiPhone 18 Pro');
        expect(backend.source.inputs).toHaveLength(4);
    });

    test('refuses an id that is neither a device of this machine nor a device node, offering the devices it has', async () => {
        expect(await run('device_state', { device: 'nothing' })).toEqual([
            'refused\tunknown-device\tnothing is not a device of this machine right now',
            'device\tsim-1\tiPhone 18 Pro\tios\tsimulator\tiOS 27.0\tbooted'
        ]);
        expect((await run('device_state', { device: 'chat-1' }))[0]).toBe(
            'refused\tnot-a-device\tchat-1 is a chat node, and only a device node has a device to operate'
        );
    });

    test('refuses a device that is not running, and points at device_start', async () => {
        backend.info = { ...SIMULATOR, state: 'shutdown' };
        expect(await run('device_input', { action: 'tap', device: 'sim-1', at: '1,1' })).toEqual([
            'refused\tdevice-not-booted\tiPhone 18 Pro is not running',
            'see\tdevice_start\tstarts it, then call again'
        ]);
        expect(backend.boots).toEqual([]);
    });

    test('starts a simulator the way the side panel does, and only claims one that already runs', async () => {
        backend.info = { ...SIMULATOR, state: 'shutdown' };
        expect(await run('device_start', { device: 'sim-1' })).toEqual([
            'started\tsim-1\tiPhone 18 Pro\tbooted',
            'next\tdevice_state\twhat the device can do now'
        ]);
        expect(backend.boots).toEqual(['sim-1']);
        expect((await run('device_start', { device: 'phone-1' }))[0]).toBe('started\tphone-1\tiPhone 18 Pro\tbooted');
        expect(backend.boots).toEqual(['sim-1']);
    });

    test('answers a start once the device can be operated, also one that already says booted, and says when it is still starting', async () => {
        const timers = new ManualTimers();
        const waits: string[] = [];
        let finish: () => void = () => undefined;
        const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
        host = { ...host, devices: driverWith([backend], { timers }) } as CanvasHost;
        backend.info = { ...SIMULATOR, state: 'shutdown' };
        Object.assign(backend, {
            ready: (deviceId: string) => {
                waits.push(deviceId);

                return new Promise<DeviceInfo>((resolve) => {
                    finish = () => resolve(backend.info);
                });
            }
        });

        const first = run('device_start', { device: 'sim-1' });
        await settle();
        finish();
        expect(await first).toEqual(['started\tsim-1\tiPhone 18 Pro\tbooted', 'next\tdevice_state\twhat the device can do now']);

        const second = run('device_start', { device: 'sim-1' });
        await settle();
        timers.advance(DEVICE_READY_WAIT_MS);
        expect(await second).toEqual([
            'started\tsim-1\tiPhone 18 Pro\tstarting',
            'next\tdevice_start\tit is still starting; call it again to wait until it can be operated'
        ]);
        expect(waits).toEqual(['sim-1', 'sim-1']);
        expect(backend.boots).toEqual(['sim-1']);
    });

    test('refuses to start a phone, or a device this machine cannot start', async () => {
        const phone = linkedTo({
            ...SIMULATOR,
            deviceId: 'coredevice-1',
            backendId: 'coredevice',
            kind: 'physical',
            name: 'Test iPhone',
            runtime: 'iOS 27.2',
            state: 'shutdown',
            capabilities: { boot: false, shutdown: false, stream: true, input: true, screenshot: true }
        });
        expect(await run('device_start', { device: 'coredevice-1' })).toEqual([
            'refused\tdevice-not-startable\tTest iPhone is a phone, and Ruimte starts only a simulator or an emulator',
            'note\tAsk the person to turn it on and unlock it, then call again'
        ]);
        backend.info = { ...SIMULATOR, state: 'shutdown', capabilities: { ...SIMULATOR.capabilities, boot: false } };
        expect((await run('device_start', { device: 'sim-1' }))[0]).toBe('refused\tdevice-not-startable\tRuimte cannot start iPhone 18 Pro on this machine');
        expect([...phone.boots, ...backend.boots]).toEqual([]);
    });

    test('holds a device for the first agent until its terminal or chat ends, and tells another nothing of it', async () => {
        await run('device_shot', { device: 'sim-1' });
        expect(await run('device_input', { action: 'tap', device: 'sim-1', at: '1,1' }, 'chat-2')).toEqual([
            'refused\tdevice-in-use\tAnother agent operates iPhone 18 Pro right now, and a device takes one agent at a time',
            'note\tPick another device with device_list, or wait until that agent is done and call again'
        ]);
        expect((await run('device_start', { device: 'phone-1' }, 'chat-2'))[0]).toStartWith('refused\tdevice-in-use\t');
        expect((await run('device_list', {}, 'chat-2'))[0]).toStartWith('device\tsim-1\t');
        expect(backend.source.inputs).toEqual([]);

        (host.devices as DeviceDriver).nodeClosed('chat-1');
        expect((await run('device_shot', { device: 'sim-1' }, 'chat-2'))[0]).toStartWith('shot\t');
        expect((await run('device_shot', { device: 'sim-1' }))[0]).toStartWith('refused\tdevice-in-use\t');
    });

    test('refuses a node that points at no device yet', async () => {
        nodes = [nodes[0]!, { ...PHONE, device: undefined }];
        expect((await run('device_state', { device: 'phone-1' }))[0]).toBe(
            'refused\tno-device\tphone-1 points at no device yet; a person picks one on the node'
        );
    });

    test('drives an Android emulator the same way, with the buttons it announces', async () => {
        const pixel = linkedTo({
            ...SIMULATOR,
            deviceId: 'Pixel_9_Pro_API_35',
            backendId: 'android',
            platform: 'android',
            name: 'Pixel 9 Pro API 35',
            runtime: 'API 35',
            capabilities: { ...SIMULATOR.capabilities, buttons: ['back', 'home', 'appSwitcher', 'lock', 'siri'] }
        });
        expect((await run('device_shot', { device: 'other-1' }))[0]).toContain('\t1080x2400\t');
        expect((await run('device_input', { action: 'button', device: 'other-1', name: 'back' }))[0]).toBe('done\tbutton\tother-1\tPixel 9 Pro API 35');
        expect((await run('device_input', { action: 'tap', device: 'other-1', at: '540,1200' }))[0]).toBe('done\ttap\tother-1\tPixel 9 Pro API 35');
        expect(pixel.source.inputs).toEqual([
            { kind: 'button', button: 'back' },
            { kind: 'pointer', phase: 'down', x: 0.5, y: 0.5 },
            { kind: 'pointer', phase: 'up', x: 0.5, y: 0.5 }
        ]);
        expect((await run('device_app', { action: 'launch', device: 'other-1', app: 'com.example.app' }))[0]).toBe('done\tlaunch\tother-1\tPixel 9 Pro API 35');
        expect(backend.source.inputs).toEqual([]);
    });

    test('taps a phone through its live stream, and refuses to open an app it has no tools for', async () => {
        const phone = linkedTo({
            ...SIMULATOR,
            deviceId: 'coredevice-1',
            backendId: 'coredevice',
            kind: 'physical',
            name: 'Test iPhone',
            runtime: 'iOS 27.2',
            capabilities: { boot: false, shutdown: false, stream: true, input: true, screenshot: true }
        });
        expect(await run('device_state', { device: 'other-1' })).toContain('can\tlaunch\tno');
        await run('device_shot', { device: 'other-1' });
        expect((await run('device_input', { action: 'tap', device: 'other-1', at: '10,10' }))[0]).toBe('done\ttap\tother-1\tTest iPhone');
        expect(phone.source.inputs).toHaveLength(2);
        expect(await run('device_app', { action: 'launch', device: 'other-1', app: 'com.example.app' })).toEqual([
            'refused\tdevice-action-unavailable\tRuimte cannot open an app on Test iPhone'
        ]);
    });
});

describe('device tools on a device with a tree', () => {
    let reading: ReadingBackend;

    beforeEach(() => {
        reading = new ReadingBackend();
        backend = reading;
        host = hostWith([reading]);
    });

    test('prints the elements under the state, numbered, in pixels of the screen', async () => {
        const lines = await run('device_state', { device: 'phone-1' });
        expect(lines.slice(lines.indexOf('can\ttree\tyes'))).toEqual([
            'can\ttree\tyes',
            'elements\t7\t1000x2000',
            'tree\t[0] Application "Settings" (0,0 1000x2000)',
            'tree\t  [1] Heading "Settings" (40,300 460x100)',
            'tree\t  [2] Group (0,400 1000x1600)',
            'tree\t    [3] Button "General" id="com.example.general" (40,500 920x130)',
            'tree\t    [4] Button "Wi-Fi" value="Home network" (40,630 920x130)',
            'tree\t    [5] Button "Privacy" (40,2100 920x130) offscreen',
            'tree\t  [6] Button "Done" (800,100 160x80) disabled'
        ]);
    });

    test('finds the elements that hold a text, with what they sit in and the numbers they have', async () => {
        const lines = await run('device_state', { device: 'phone-1', find: 'general' });
        expect(lines.slice(lines.indexOf('elements\t7\t1000x2000'))).toEqual([
            'elements\t7\t1000x2000',
            'matches\t1',
            'tree\t[0] Application "Settings" (0,0 1000x2000)',
            'tree\t  [2] Group (0,400 1000x1600)',
            'tree\t    [3] Button "General" id="com.example.general" (40,500 920x130)'
        ]);
    });

    test('quotes text on one line and cuts a long one', async () => {
        const long = 'x'.repeat(250);
        reading.screen = { ...reading.screen, root: { ...reading.screen.root, label: 'Say "hi"\tnow\nplease', value: long, children: [] } };
        const lines = await run('device_state', { device: 'phone-1' });
        expect(lines.at(-1)).toBe(`tree\t[0] Application "Say \\"hi\\"\\tnow\\nplease" value="${'x'.repeat(200)}…"(cut: 250 chars) (0,0 1000x2000)`);
    });

    test('taps an element of the last state without a shot, and refuses a stale one or two targets at once', async () => {
        expect((await run('device_input', { action: 'tap', device: 'phone-1', element: 3 }))[0]).toStartWith('refused\tstale-element\t');
        await run('device_state', { device: 'phone-1' });
        expect(await run('device_input', { action: 'tap', device: 'phone-1', element: 3 })).toEqual([
            'done\ttap\tphone-1\tiPhone 18 Pro',
            'next\tdevice_shot\tshows what it did'
        ]);
        expect(backend.source.inputs[0]).toEqual({ kind: 'pointer', phase: 'down', x: 0.5, y: 565 / 2000 });
        expect((await run('device_input', { action: 'tap', device: 'phone-1', element: 9 }))[0]).toStartWith('refused\tunknown-element\t');
        expect((await run('device_input', { action: 'tap', device: 'phone-1', element: 'two' }))[0]).toStartWith(
            'refused\tbad-arguments\telement takes the number in brackets'
        );
        expect((await run('device_input', { action: 'tap', device: 'phone-1', element: 3, at: '1,1' }))[0]).toStartWith(
            'refused\tbad-arguments\tA tap takes either'
        );
    });

    test('still prints the state when the tree will not come, and says why', async () => {
        reading.failure = new Error('The simulator did not answer within 15 s');
        const lines = await run('device_state', { device: 'phone-1' });
        expect(lines.slice(-2)).toEqual(['can\ttree\tyes', 'tree\tnone\tThe simulator did not answer within 15 s']);
    });
});

describe('the tools of a device', () => {
    let project: string;

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), 'ruimte-device-project-'));
        await mkdir(join(project, 'build', 'Atlas.app'), { recursive: true });
        await writeFile(join(project, 'shot.png'), 'png');
        await writeFile(join(project, 'clip.mov'), 'mov');
        projectFolder = project;
        host = hostWith([backend]);
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    const target = { backendId: 'simctl', platform: 'ios', deviceId: SIMULATOR.deviceId } as const;

    test('sets up the device in one step, in the order a person would', async () => {
        expect(
            await run('device_set', { device: 'phone-1', appearance: 'dark', status_bar: 'clean', battery: 40, charging: true, location: '52.3676,4.9041' })
        ).toEqual(['done\tset\tphone-1\tiPhone 18 Pro', 'next\tdevice_shot\tshows what it did']);
        expect(backend.actions).toEqual([
            { ...target, action: 'setAppearance', value: 'dark' },
            { ...target, action: 'setStatusBar', value: 'clean' },
            { ...target, action: 'setBattery', level: 40, charging: true },
            { ...target, action: 'setLocation', latitude: 52.3676, longitude: 4.9041 }
        ]);
        await run('device_set', { device: 'phone-1', clear_location: true, text_size: 'large' });
        expect(backend.actions.slice(4)).toEqual([
            { ...target, action: 'setTextSize', value: 'large' },
            { ...target, action: 'clearLocation' }
        ]);
    });

    test('refuses a set with nothing to change, a location and its clearing at once, or charging without a level', async () => {
        expect((await run('device_set', { device: 'phone-1' }))[0]).toStartWith('refused\tbad-arguments\tdevice_set needs something to change');
        expect((await run('device_set', { device: 'phone-1', location: '1,2', clear_location: true }))[0]).toStartWith('refused\tbad-arguments\t');
        expect((await run('device_set', { device: 'phone-1', charging: true }))[0]).toStartWith('refused\tbad-arguments\tcharging goes with battery');
        expect((await run('device_set', { device: 'phone-1', battery: 120 }))[0]).toStartWith('refused\tbad-arguments\tbattery is between 0 and 100');
        expect((await run('device_set', { device: 'phone-1', location: 'Amsterdam' }))[0]).toStartWith(
            'refused\tbad-arguments\tlocation takes a place as LAT,LON'
        );
        expect(backend.actions).toEqual([]);
    });

    test('opens a link, changes one permission or all, sends a push, answers a biometric check and stops an app', async () => {
        await run('device_open', { device: 'phone-1', url: 'myapp://inbox' });
        await run('device_permission', { device: 'phone-1', app: 'com.example.app', grant: true, name: 'camera' });
        await run('device_permission', { device: 'phone-1', app: 'com.example.app', reset: true, all: true });
        await run('device_push', { device: 'phone-1', app: 'com.example.app', payload: 'Build is green' });
        await run('device_biometric', { device: 'phone-1', match: true });
        await run('device_biometric', { device: 'phone-1', enroll: true, sensor: 'finger' });
        await run('device_app', { action: 'terminate', device: 'phone-1', app: 'com.example.app' });

        expect(backend.actions).toEqual([
            { ...target, action: 'openUrl', url: 'myapp://inbox' },
            { ...target, action: 'setPermission', appId: 'com.example.app', permission: 'camera', decision: 'grant' },
            { ...target, action: 'setAllPermissions', appId: 'com.example.app', decision: 'reset' },
            { ...target, action: 'sendPush', appId: 'com.example.app', payload: 'Build is green' },
            { ...target, action: 'biometric', event: 'match', sensor: 'face' },
            { ...target, action: 'biometric', event: 'enroll', sensor: 'finger' },
            { ...target, action: 'terminateApp', appId: 'com.example.app' }
        ]);
    });

    test('refuses a permission without one decision or without one target, and a biometric check without one event', async () => {
        expect((await run('device_permission', { device: 'phone-1', app: 'a.b', name: 'camera' }))[0]).toStartWith(
            'refused\tbad-arguments\tdevice_permission takes one of'
        );
        expect((await run('device_permission', { device: 'phone-1', app: 'a.b', grant: true }))[0]).toStartWith(
            'refused\tbad-arguments\tdevice_permission takes one permission'
        );
        expect((await run('device_permission', { device: 'phone-1', app: 'a.b', grant: true, all: true, name: 'camera' }))[0]).toStartWith(
            'refused\tbad-arguments\t'
        );
        expect((await run('device_biometric', { device: 'phone-1', match: true, nomatch: true }))[0]).toStartWith(
            'refused\tbad-arguments\tdevice_biometric takes one of'
        );
        expect(backend.actions).toEqual([]);
    });

    test('writes the clipboard but never reads a simulator one, and records for the seconds asked into the captures of the machine', async () => {
        backend.clipboard = 'from the Mac';
        expect((await run('device_clipboard', { device: 'phone-1' }))[0]).toStartWith('refused\tdevice-action-unavailable\t');
        expect(await run('device_clipboard', { device: 'phone-1', text: 'mine' })).toEqual(['clipboard\t"mine"']);
        expect(backend.clipboard).toBe('mine');

        const [line] = await run('device_record', { device: 'phone-1', seconds: 5 });
        const [kind, path] = line!.split('\t');
        expect([kind, dirname(path!)]).toEqual(['recording', join(home, 'device-captures')]);
        expect(basename(path!)).toMatch(/^phone-1-\d+\.mp4$/);
        expect(backend.recordings).toEqual([{ file: line!.split('\t')[1]!, stopped: true }]);
        expect((await run('device_record', { device: 'phone-1', seconds: 61 }))[0]).toStartWith('refused\tbad-arguments\tseconds is between 1 and 60');
    });

    test('installs an app and adds media from the project folder, and refuses a path outside it', async () => {
        await run('device_install', { device: 'phone-1', path: 'build/Atlas.app' });
        await run('device_media', { device: 'phone-1', paths: ['shot.png', join(project, 'clip.mov')] });
        const real = await realpath(project);
        expect(backend.actions).toEqual([
            { ...target, action: 'installApp', path: join(real, 'build', 'Atlas.app') },
            { ...target, action: 'addMedia', paths: [join(real, 'shot.png'), join(real, 'clip.mov')] }
        ]);

        const outside = await mkdtemp(join(tmpdir(), 'ruimte-device-outside-'));
        try {
            await writeFile(join(outside, 'evil.apk'), 'apk');
            expect((await run('device_install', { device: 'phone-1', path: join(outside, 'evil.apk') }))[0]).toStartWith('refused\tdevice-path-refused\t');
            expect((await run('device_media', { device: 'phone-1', paths: ['missing.png'] }))[0]).toStartWith('refused\tdevice-path-refused\t');
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
        expect(backend.actions).toHaveLength(2);
    });

    test("takes a file from the chat's own folders and the system temp folder too", async () => {
        const temp = await mkdtemp(join(tmpdir(), 'ruimte-device-temp-'));
        try {
            const attachments = join(home, 'attachments', 'chat-1');
            const visuals = join(home, 'chats', 'chat-1.visuals');
            const another = join(home, 'attachments', 'chat-9');
            await mkdir(attachments, { recursive: true });
            await mkdir(visuals, { recursive: true });
            await mkdir(another, { recursive: true });
            await writeFile(join(another, 'x.png'), 'png');
            await writeFile(join(attachments, 'a.png'), 'png');
            await writeFile(join(visuals, 'b.png'), 'png');
            await writeFile(join(temp, 'c.png'), 'png');
            host = { ...hostWith([backend]), devices: driverWith([backend], { tempFolders: [temp] }) } as CanvasHost;

            expect(
                (await run('device_media', { device: 'phone-1', paths: [join(attachments, 'a.png'), join(visuals, 'b.png'), join(temp, 'c.png')] }))[0]
            ).toStartWith('done\tmedia\t');
            expect((await run('device_media', { device: 'phone-1', paths: [join(another, 'x.png')] }))[0]).toStartWith('refused\tdevice-path-refused\t');
            expect(backend.actions).toHaveLength(1);
        } finally {
            await rm(temp, { recursive: true, force: true });
        }
    });

    test('a tool the device does not announce is refused before it runs', async () => {
        backend.info = { ...SIMULATOR, capabilities: { ...SIMULATOR.capabilities, tools: ['launchApp'] } };
        expect((await run('device_open', { device: 'phone-1', url: 'https://ruimte.app' }))[0]).toBe(
            'refused\tdevice-action-unavailable\tiPhone 18 Pro has no openUrl tool in Ruimte'
        );
        expect(backend.actions).toEqual([]);
    });

    test('every tool waits while the person paused the agent', async () => {
        const control = new DeviceControl();
        host = { ...hostWith([backend]), devices: driverWith([backend], { gate: control }) } as CanvasHost;
        await run('device_open', { device: 'phone-1', url: 'https://ruimte.app' });
        control.control(SIMULATOR, 'pause');

        expect((await run('device_set', { device: 'phone-1', appearance: 'dark' }))[0]).toStartWith('refused\tpaused\t');
        expect((await run('device_clipboard', { device: 'phone-1', text: 'mine' }))[0]).toStartWith('refused\tpaused\t');
        expect(backend.actions).toHaveLength(1);
    });
});
