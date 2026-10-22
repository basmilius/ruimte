import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { DeviceInfo, ProjectContent, ProjectEdge, ProjectNode } from '@ruimte/contracts';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import { DeviceDriver } from '../devices/agent-driver.ts';
import { DeviceControl } from '../devices/control.ts';
import { ReadingBackend, RecordingBackend, SIMULATOR, pngOf } from '../devices/device-test-helpers.ts';
import { DeviceManager } from '../devices/manager.ts';
import { refusalBody } from '@adecore/agents/context';
import { VerbRefusal, type CanvasHost, type Noun } from './verb.ts';
import { verbNamed } from './verbs.ts';

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
    home = await mkdtemp(join(tmpdir(), 'ruimte-device-verb-'));
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
            locate: (id: string) => (id === 'chat-1' ? { projectId: 'p1', folder: projectFolder, canvasId: 'main' } : null),
            read: async () => content(),
            machineOfNode: (nodeId: string) => (bound.has(nodeId) ? 'machine-b' : null)
        },
        checkouts: { paths: async () => [] },
        devices: new DeviceDriver({ home, manager: new DeviceManager(backends), timers: new ManualTimers(), sleep: async () => undefined })
    } as unknown as CanvasHost;
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

/* What the CLI prints: the lines of an answer, or the refusal with its advice. */
async function run(argv: string[]): Promise<string[]> {
    try {
        return await noun.run(argv, { caller: 'chat-1', host });
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return refusalBody(error.code, error.message, error.lines).split('\n');
        }
        throw error;
    }
}

describe('ruimte-context device', () => {
    test('has no word that erases, starts, stops, restarts or folds a device or sets its camera, which only a person does', () => {
        const words = noun.actions.map((action) => action.word);

        for (const word of ['erase', 'boot', 'start', 'shutdown', 'stop', 'restart', 'fold', 'hinge', 'camera']) {
            expect(words).not.toContain(word);
        }
        expect(words).toEqual([
            'list',
            'state',
            'shot',
            'tap',
            'swipe',
            'button',
            'type',
            'launch',
            'set',
            'open',
            'permission',
            'push',
            'biometric',
            'clipboard',
            'record',
            'install',
            'media',
            'terminate'
        ]);
    });

    test('says which device the node holds and what works on it', async () => {
        expect(await run(['state', 'phone-1'])).toEqual([
            'device\tphone-1\tiPhone 18 Pro\tios\tsimulator\tiOS 27.0',
            'state\tbooted',
            'power\tnone',
            'screen\tunknown',
            'buttons\thome swipeHome appSwitcher lock siri',
            'can\tshot\tyes',
            'can\tinput\tyes',
            'can\ttype\tyes',
            'can\tlaunch\tyes',
            'can\ttree\tno'
        ]);
        await run(['shot', 'phone-1']);
        expect(await run(['state', 'phone-1'])).toContain('screen\t1000x2000');
    });

    test('refuses a device node that runs on another machine, and touches nothing', async () => {
        bound.add('phone-1');
        expect((await run(['state', 'phone-1']))[0]).toStartWith('refused\tnode-on-other-machine\t');
        expect((await run(['shot', 'phone-1']))[0]).toStartWith('refused\tnode-on-other-machine\t');
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
        expect((await run(['shot', 'phone-1']))[0]).toStartWith('refused\tpeer-no-device\t');

        host = { ...hostWith([backend]), untrusted: { node: () => true, inFolder: () => false, fromPeer: (id: string) => id === 'chat-1' } } as CanvasHost;
        expect((await run(['state', 'phone-1']))[0]).toStartWith('refused\tpeer-no-device\t');
        expect(backend.actions).toEqual([]);
    });

    test('says a device this machine does not have is missing, and touches nothing', async () => {
        backend.info = { ...SIMULATOR, name: 'iPhone 12' };
        expect((await run(['state', 'phone-1'])).slice(0, 4)).toEqual([
            'device\tphone-1\tiPhone 18 Pro\tios\tsimulator\tiOS 27.0',
            'state\tmissing',
            'power\tnone',
            'screen\tunknown'
        ]);
        expect((await run(['shot', 'phone-1']))[0]).toStartWith('refused\tdevice-missing\t');
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
        const powerOf = async (): Promise<string | undefined> => (await run(['state', 'other-1'])).find((line) => line.startsWith('power\t'));

        expect(await powerOf()).toBe('power\t14%\tbattery\tnot-charging');
        expect(await powerOf()).toBe('power\t50%\tplugged\tcharging\tsimulated');
        expect(await powerOf()).toBe('power\tunknown');
    });

    test('writes a shot and prints its path and size, then taps in its pixels', async () => {
        const [line] = await run(['shot', 'phone-1']);
        const [kind, path, size] = line!.split('\t');
        expect([kind, dirname(path!), size]).toEqual(['shot', join(home, 'screenshots'), '1000x2000']);
        expect(basename(path!)).toMatch(/^phone-1-\d+\.png$/);
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
        expect((await run(['tap', 'phone-1']))[0]).toBe(
            'refused\tbad-arguments\tA tap takes either an element of the last state or a pixel of the last shot as x and y'
        );
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

describe('ruimte-context device on a device with a tree', () => {
    let reading: ReadingBackend;

    beforeEach(() => {
        reading = new ReadingBackend();
        backend = reading;
        host = hostWith([reading]);
    });

    test('prints the elements under the state, numbered, in pixels of the screen', async () => {
        const lines = await run(['state', 'phone-1']);
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
        const lines = await run(['state', 'phone-1', '--find', 'general']);
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
        const lines = await run(['state', 'phone-1']);
        expect(lines.at(-1)).toBe(`tree\t[0] Application "Say \\"hi\\"\\tnow\\nplease" value="${'x'.repeat(200)}…"(cut: 250 chars) (0,0 1000x2000)`);
    });

    test('taps an element of the last state without a shot, and refuses a stale one or two targets at once', async () => {
        expect((await run(['tap', 'phone-1', '--element', '3']))[0]).toStartWith('refused\tstale-element\t');
        await run(['state', 'phone-1']);
        expect(await run(['tap', 'phone-1', '--element', '3'])).toEqual([
            'done\ttap\tphone-1\tiPhone 18 Pro',
            'next\truimte-context device shot <id>\tshows what it did'
        ]);
        expect(backend.source.inputs[0]).toEqual({ kind: 'pointer', phase: 'down', x: 0.5, y: 565 / 2000 });
        expect((await run(['tap', 'phone-1', '--element', '9']))[0]).toStartWith('refused\tunknown-element\t');
        expect((await run(['tap', 'phone-1', '--element', 'two']))[0]).toStartWith('refused\tbad-arguments\t--element takes the number in brackets');
        expect((await run(['tap', 'phone-1', '--element', '3', '--at', '1,1']))[0]).toStartWith('refused\tbad-arguments\tA tap takes either');
    });

    test('still prints the state when the tree will not come, and says why', async () => {
        reading.failure = new Error('The simulator did not answer within 15 s');
        const lines = await run(['state', 'phone-1']);
        expect(lines.slice(-2)).toEqual(['can\ttree\tyes', 'tree\tnone\tThe simulator did not answer within 15 s']);
    });

    test('tells what the tree does not hold, and that a shot is for that', async () => {
        const help = noun.actions.find((action) => action.word === 'state')!.detail.join('\n');
        expect(help).toContain('no web content, and of a long list only the rows on screen. Take a shot for those');
        expect(help).toContain('an iPhone has shots only');
    });
});

describe('ruimte-context device tools', () => {
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
            await run(['set', 'phone-1', '--appearance', 'dark', '--status-bar', 'clean', '--battery', '40', '--charging', '--location', '52.3676,4.9041'])
        ).toEqual(['done\tset\tphone-1\tiPhone 18 Pro', 'next\truimte-context device shot <id>\tshows what it did']);
        expect(backend.actions).toEqual([
            { ...target, action: 'setAppearance', value: 'dark' },
            { ...target, action: 'setStatusBar', value: 'clean' },
            { ...target, action: 'setBattery', level: 40, charging: true },
            { ...target, action: 'setLocation', latitude: 52.3676, longitude: 4.9041 }
        ]);
        await run(['set', 'phone-1', '--clear-location', '--text-size', 'large']);
        expect(backend.actions.slice(4)).toEqual([
            { ...target, action: 'setTextSize', value: 'large' },
            { ...target, action: 'clearLocation' }
        ]);
    });

    test('refuses a set with nothing to change, a location and its clearing at once, or charging without a level', async () => {
        expect((await run(['set', 'phone-1']))[0]).toStartWith('refused\tbad-arguments\tdevice set needs something to change');
        expect((await run(['set', 'phone-1', '--location', '1,2', '--clear-location']))[0]).toStartWith('refused\tbad-arguments\t');
        expect((await run(['set', 'phone-1', '--charging']))[0]).toStartWith('refused\tbad-arguments\t--charging goes with --battery');
        expect((await run(['set', 'phone-1', '--battery', '120']))[0]).toStartWith('refused\tbad-arguments\t--battery is between 0 and 100');
        expect((await run(['set', 'phone-1', '--location', 'Amsterdam']))[0]).toStartWith('refused\tbad-arguments\t--location takes a place as LAT,LON');
        expect(backend.actions).toEqual([]);
    });

    test('opens a link, changes one permission or all, sends a push, answers a biometric check and stops an app', async () => {
        await run(['open', 'phone-1', '--url', 'myapp://inbox']);
        await run(['permission', 'phone-1', '--app', 'com.example.app', '--grant', '--name', 'camera']);
        await run(['permission', 'phone-1', '--app', 'com.example.app', '--reset', '--all']);
        await run(['push', 'phone-1', '--app', 'com.example.app', '--payload', 'Build is green']);
        await run(['biometric', 'phone-1', '--match']);
        await run(['biometric', 'phone-1', '--enroll', '--sensor', 'finger']);
        await run(['terminate', 'phone-1', '--app', 'com.example.app']);

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
        expect((await run(['permission', 'phone-1', '--app', 'a.b', '--name', 'camera']))[0]).toStartWith(
            'refused\tbad-arguments\tdevice permission takes one of'
        );
        expect((await run(['permission', 'phone-1', '--app', 'a.b', '--grant']))[0]).toStartWith(
            'refused\tbad-arguments\tdevice permission takes one permission'
        );
        expect((await run(['permission', 'phone-1', '--app', 'a.b', '--grant', '--all', '--name', 'camera']))[0]).toStartWith('refused\tbad-arguments\t');
        expect((await run(['biometric', 'phone-1', '--match', '--nomatch']))[0]).toStartWith('refused\tbad-arguments\tdevice biometric takes one of');
        expect(backend.actions).toEqual([]);
    });

    test('writes the clipboard but never reads a simulator one, and records for the seconds asked into the captures of the machine', async () => {
        backend.clipboard = 'from the Mac';
        expect((await run(['clipboard', 'phone-1']))[0]).toStartWith('refused\tdevice-action-unavailable\t');
        expect(await run(['clipboard', 'phone-1', '--text', 'mine'])).toEqual(['clipboard\t"mine"']);
        expect(backend.clipboard).toBe('mine');

        const [line] = await run(['record', 'phone-1', '--seconds', '5']);
        const [kind, path] = line!.split('\t');
        expect([kind, dirname(path!)]).toEqual(['recording', join(home, 'device-captures')]);
        expect(basename(path!)).toMatch(/^phone-1-\d+\.mp4$/);
        expect(backend.recordings).toEqual([{ file: line!.split('\t')[1]!, stopped: true }]);
        expect((await run(['record', 'phone-1', '--seconds', '61']))[0]).toStartWith('refused\tbad-arguments\t--seconds is between 1 and 60');
    });

    test('installs an app and adds media from the project folder, and refuses a path outside it', async () => {
        await run(['install', 'phone-1', '--path', 'build/Atlas.app']);
        await run(['media', 'phone-1', '--path', 'shot.png', join(project, 'clip.mov')]);
        const real = await realpath(project);
        expect(backend.actions).toEqual([
            { ...target, action: 'installApp', path: join(real, 'build', 'Atlas.app') },
            { ...target, action: 'addMedia', paths: [join(real, 'shot.png'), join(real, 'clip.mov')] }
        ]);

        const outside = await mkdtemp(join(tmpdir(), 'ruimte-device-outside-'));
        try {
            await writeFile(join(outside, 'evil.apk'), 'apk');
            expect((await run(['install', 'phone-1', '--path', join(outside, 'evil.apk')]))[0]).toStartWith('refused\tdevice-path-refused\t');
            expect((await run(['media', 'phone-1', '--path', 'missing.png']))[0]).toStartWith('refused\tdevice-path-refused\t');
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
        expect(backend.actions).toHaveLength(2);
    });

    test('a tool the device does not announce is refused before it runs, and so is one without a line', async () => {
        backend.info = { ...SIMULATOR, capabilities: { ...SIMULATOR.capabilities, tools: ['launchApp'] } };
        expect((await run(['open', 'phone-1', '--url', 'https://ruimte.app']))[0]).toBe(
            'refused\tdevice-action-unavailable\tiPhone 18 Pro has no openUrl tool in Ruimte'
        );
        edges = [];
        expect((await run(['install', 'phone-1', '--path', 'build/Atlas.app']))[0]).toStartWith('refused\tnot-linked\t');
        expect(backend.actions).toEqual([]);
    });

    test('every tool waits while the person paused the agent', async () => {
        const control = new DeviceControl();
        host = {
            ...hostWith([backend]),
            devices: new DeviceDriver({ home, manager: new DeviceManager([backend]), timers: new ManualTimers(), sleep: async () => undefined, gate: control })
        } as CanvasHost;
        await run(['open', 'phone-1', '--url', 'https://ruimte.app']);
        control.control(SIMULATOR, 'pause');

        expect((await run(['set', 'phone-1', '--appearance', 'dark']))[0]).toStartWith('refused\tpaused\t');
        expect((await run(['clipboard', 'phone-1', '--text', 'mine']))[0]).toStartWith('refused\tpaused\t');
        expect(backend.actions).toHaveLength(1);
    });
});
