import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceInfo, ProjectContent, ProjectEdge, ProjectNode } from '@ruimte/contracts';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import { DeviceDriver } from '../devices/agent-driver.ts';
import { RecordingBackend, SIMULATOR, pngOf } from '../devices/device-test-helpers.ts';
import { DeviceManager } from '../devices/manager.ts';
import { refusalBody } from '../refusal.ts';
import { VerbRefusal, type CanvasHost, type Noun } from './verb.ts';
import { VERBS, verbNamed } from './verbs.ts';

const noun = verbNamed('device') as Noun;

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

const content = (): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        { kind: 'canvas', id: 'main', name: 'Canvas', nodes, texts: [], edges, layouts: [] },
        { kind: 'canvas', id: 'other', name: 'Other', nodes: [{ ...PHONE, id: 'phone-2' }], texts: [], edges: [], layouts: [] }
    ]
});

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-device-verb-'));
    backend = new RecordingBackend();
    backend.shot = pngOf(1000, 2000);
    nodes = [{ id: 'chat-1', kind: 'chat', title: 'Tester', x: 0, y: 0, w: 560, h: 360 }, PHONE];
    edges = [{ id: 'edge-1', from: 'phone-1', to: 'chat-1' }];
    host = hostWith([backend]);
});

const hostWith = (backends: RecordingBackend[]): CanvasHost =>
    ({
        locate: (id: string) => (id === 'chat-1' ? { projectId: 'p1', folder: '/tmp/p1', canvasId: 'main' } : null),
        read: async () => content(),
        devices: new DeviceDriver({ home, manager: new DeviceManager(backends), timers: new ManualTimers(), sleep: async () => undefined })
    }) as unknown as CanvasHost;

/* A second device node beside the phone, linked to the caller, pointing at this device. */
const linkedTo = (info: DeviceInfo): RecordingBackend => {
    const other = new RecordingBackend(info);
    other.shot = pngOf(1080, 2400);
    nodes = [...nodes, { ...PHONE, id: 'other-1', device: { platform: info.platform, kind: info.kind, name: info.name, runtime: info.runtime } }];
    edges = [...edges, { id: 'edge-2', from: 'chat-1', to: 'other-1' }];
    host = hostWith([backend, other]);
    return other;
};

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

/* What the CLI prints: the lines of an answer, or the refusal with its advice. */
const run = async (argv: string[]): Promise<string[]> => {
    try {
        return await noun.run(argv, { caller: 'chat-1', host });
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return refusalBody(error.code, error.message, error.lines).split('\n');
        }
        throw error;
    }
};

describe('ruimte-context device', () => {
    test('is a noun of help with every action', () => {
        expect(VERBS).toContain(noun);
        expect(noun.actions.map((action) => action.word)).toEqual(['state', 'shot', 'tap', 'swipe', 'button', 'type', 'launch']);
    });

    test('says which device the node holds and what works on it', async () => {
        expect(await run(['state', 'phone-1'])).toEqual([
            'device\tphone-1\tiPhone 18 Pro\tios\tsimulator\tiOS 27.0',
            'state\tbooted',
            'screen\tunknown',
            'buttons\thome swipeHome appSwitcher lock siri',
            'can\tshot\tyes',
            'can\tinput\tyes',
            'can\ttype\tyes',
            'can\tlaunch\tyes'
        ]);
        await run(['shot', 'phone-1']);
        expect(await run(['state', 'phone-1'])).toContain('screen\t1000x2000');
    });

    test('says a device this machine does not have is missing, and touches nothing', async () => {
        backend.info = { ...SIMULATOR, name: 'iPhone 12' };
        expect((await run(['state', 'phone-1'])).slice(0, 3)).toEqual([
            'device\tphone-1\tiPhone 18 Pro\tios\tsimulator\tiOS 27.0',
            'state\tmissing',
            'screen\tunknown'
        ]);
        expect((await run(['shot', 'phone-1']))[0]).toStartWith('refused\tdevice-missing\t');
    });

    test('writes a shot and prints its path and size, then taps in its pixels', async () => {
        const [line] = await run(['shot', 'phone-1']);
        expect(line).toMatch(new RegExp(`^shot\\t${join(home, 'screenshots')}/phone-1-\\d+\\.png\\t1000x2000\\t`));
        expect(await run(['tap', 'phone-1', '--at', '500,500'])).toEqual([
            'done\ttap\tphone-1\tiPhone 18 Pro',
            'next\truimte-context device shot <id>\tshows what it did'
        ]);
        expect(backend.source.inputs[0]).toEqual({ kind: 'pointer', phase: 'down', x: 0.5, y: 0.25 });
    });

    test('swipes, presses a button the device announces and opens an app', async () => {
        await run(['shot', 'phone-1']);
        expect((await run(['swipe', 'phone-1', '--from', '500,1800', '--to', '500,200']))[0]).toBe('done\tswipe\tphone-1\tiPhone 18 Pro');
        expect(backend.source.inputs.at(-1)).toEqual({ kind: 'pointer', phase: 'up', x: 0.5, y: 0.1 });
        expect((await run(['button', 'phone-1', '--name', 'home']))[0]).toBe('done\tbutton\tphone-1\tiPhone 18 Pro');
        expect(backend.source.inputs.at(-1)).toEqual({ kind: 'button', button: 'home' });
        expect((await run(['launch', 'phone-1', '--app', 'com.example.app']))[0]).toBe('done\tlaunch\tphone-1\tiPhone 18 Pro');
        expect(backend.actions).toMatchObject([{ action: 'launchApp', appId: 'com.example.app' }]);
    });

    test('types into whatever has the focus, and needs the text', async () => {
        expect((await run(['type', 'phone-1', '--text', 'Grüße\nnext']))[0]).toBe('done\ttype\tphone-1\tiPhone 18 Pro');
        expect(backend.typed).toEqual(['Grüße\nnext']);
        expect((await run(['type', 'phone-1']))[0]).toBe('refused\tbad-arguments\t--text needs the text to type');
    });

    test('refuses a button the device does not announce, with the ones it does', async () => {
        expect(await run(['button', 'phone-1', '--name', 'back'])).toEqual([
            'refused\tunknown-button\tiPhone 18 Pro has no back button',
            'button\thome',
            'button\tswipeHome',
            'button\tappSwitcher',
            'button\tlock',
            'button\tsiri'
        ]);
    });

    test('refuses a tap before any shot and a pixel written the wrong way', async () => {
        expect((await run(['tap', 'phone-1', '--at', '10,10']))[0]).toStartWith('refused\tno-shot\t');
        expect((await run(['tap', 'phone-1', '--at', '10']))[0]).toStartWith('refused\tbad-arguments\t--at takes a pixel of the last shot as x,y');
        expect((await run(['tap', 'phone-1']))[0]).toBe('refused\tbad-arguments\t--at needs a pixel of the last shot, as x,y');
    });

    test('only a line lets the caller operate a device, and a refusal offers the ones it has', async () => {
        edges = [];
        expect(await run(['tap', 'phone-1', '--at', '1,1'])).toEqual([
            'refused\tnot-linked\tNo line runs between you and phone-1, and that line is what lets you operate its device',
            'see\truimte-context link new --to phone-1\tdraws it',
            'note\tNo device node is linked to you; ruimte-context link new --to <id> draws the line to one on your canvas'
        ]);
        expect((await run(['shot', 'phone-2']))[1]).toBe('note\tphone-2 stands on other and you on main, and a line only runs between two nodes of one canvas');
        edges = [{ id: 'edge-1', from: 'chat-1', to: 'phone-1' }];
        expect(await run(['state', 'nothing'])).toEqual([
            'refused\tunknown-node\tnothing is not a node of this project',
            'device\tphone-1\tPhone\tiPhone 18 Pro'
        ]);
        expect((await run(['state', 'chat-1']))[0]).toBe('refused\tnot-a-device\tchat-1 is a chat node, and only a device node has a device to operate');
    });

    test('refuses a device that is not running, and never starts it', async () => {
        backend.info = { ...SIMULATOR, state: 'shutdown' };
        expect(await run(['tap', 'phone-1', '--at', '1,1'])).toEqual([
            'refused\tdevice-not-booted\tiPhone 18 Pro is not running',
            'note\tAn agent never starts a device: ask the person to start it from its node, then call again'
        ]);
        expect(backend.source.starts).toBe(0);
    });

    test('refuses a node that points at no device yet', async () => {
        nodes = [nodes[0]!, { ...PHONE, device: undefined }];
        expect((await run(['state', 'phone-1']))[0]).toBe('refused\tno-device\tphone-1 points at no device yet; a person picks one on the node');
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
        expect((await run(['shot', 'other-1']))[0]).toContain('\t1080x2400\t');
        expect((await run(['button', 'other-1', '--name', 'back']))[0]).toBe('done\tbutton\tother-1\tPixel 9 Pro API 35');
        expect((await run(['tap', 'other-1', '--at', '540,1200']))[0]).toBe('done\ttap\tother-1\tPixel 9 Pro API 35');
        expect(pixel.source.inputs).toEqual([
            { kind: 'button', button: 'back' },
            { kind: 'pointer', phase: 'down', x: 0.5, y: 0.5 },
            { kind: 'pointer', phase: 'up', x: 0.5, y: 0.5 }
        ]);
        expect((await run(['launch', 'other-1', '--app', 'com.example.app']))[0]).toBe('done\tlaunch\tother-1\tPixel 9 Pro API 35');
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
        expect(await run(['state', 'other-1'])).toContain('can\tlaunch\tno');
        await run(['shot', 'other-1']);
        expect((await run(['tap', 'other-1', '--at', '10,10']))[0]).toBe('done\ttap\tother-1\tTest iPhone');
        expect(phone.source.inputs).toHaveLength(2);
        expect(await run(['launch', 'other-1', '--app', 'com.example.app'])).toEqual([
            'refused\tdevice-action-unavailable\tRuimte cannot open an app on Test iPhone'
        ]);
    });
});
