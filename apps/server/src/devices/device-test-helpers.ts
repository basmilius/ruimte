import type { DeviceAction, DeviceInfo, DeviceInput, DeviceSettings, LiveStreamFrame } from '@ruimte/contracts';
import type { DeviceTree, DeviceTreeNode } from './device-tree.ts';
import type { DeviceBackend, DeviceKeyboard, DeviceSource } from './manager.ts';
import { DeviceRecordings, type RecordingProcess } from './recordings.ts';

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
    const joined = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return joined;
}

/* The first bytes of a png of this size: the signature and a header chunk, which is all a size is read from. */
export function pngOf(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
}

export const SIMULATOR: DeviceInfo = {
    deviceId: 'sim-1',
    backendId: 'simctl',
    platform: 'ios',
    kind: 'simulator',
    name: 'iPhone 18 Pro',
    runtime: 'iOS 27.0',
    state: 'booted',
    capabilities: {
        boot: true,
        shutdown: true,
        stream: true,
        input: true,
        screenshot: true,
        buttons: ['home', 'swipeHome', 'appSwitcher', 'lock', 'siri'],
        tools: [
            'launchApp',
            'openUrl',
            'terminateApp',
            'appearance',
            'textSize',
            'statusBar',
            'battery',
            'location',
            'clearLocation',
            'permissions',
            'push',
            'biometrics',
            'clipboard',
            'record',
            'installApp',
            'addMedia'
        ]
    }
};

/* A source that only counts: how often it ran and what reached it. */
class RecordingSource implements DeviceSource {
    starts = 0;
    stops = 0;
    readonly inputs: DeviceInput[] = [];
    readonly chords: number[][] = [];
    readonly pasted: string[] = [];

    start(_publish: (frame: LiveStreamFrame) => void): Promise<void> {
        this.starts += 1;
        return Promise.resolve();
    }

    stop(): Promise<void> {
        this.stops += 1;
        return Promise.resolve();
    }

    input(input: DeviceInput): void {
        if (this.starts === this.stops) {
            throw new Error('input reached a source that is not running');
        }
        this.inputs.push(input);
    }

    keys(usages: readonly number[]): void {
        if (this.starts === this.stops) {
            throw new Error('keys reached a source that is not running');
        }
        this.chords.push([...usages]);
    }

    paste(text: string): Promise<void> {
        if (this.starts === this.stops) {
            return Promise.reject(new Error('a paste reached a source that is not running'));
        }
        this.pasted.push(text);
        return Promise.resolve();
    }
}

/* One device behind a backend a test steers: its state, its shot and the actions it was asked for. */
export class RecordingBackend implements DeviceBackend {
    readonly id: string;
    readonly platform: DeviceInfo['platform'];
    readonly source = new RecordingSource();
    readonly actions: DeviceAction[] = [];
    readonly typed: string[] = [];
    info: DeviceInfo;
    shot = pngOf(1206, 2622);
    lists = 0;
    /* The devices it was asked to start, each of which then runs. */
    readonly boots: string[] = [];
    clipboard = '';
    readonly recordings: Array<{ file: string; stopped: boolean }> = [];

    constructor(info: DeviceInfo = SIMULATOR) {
        this.info = info;
        this.id = info.backendId;
        this.platform = info.platform;
    }

    list(): Promise<DeviceInfo[]> {
        this.lists += 1;
        return Promise.resolve([this.info]);
    }

    boot(deviceId: string): Promise<DeviceInfo> {
        this.boots.push(deviceId);
        this.info = { ...this.info, state: 'booted' };

        return Promise.resolve(this.info);
    }

    createSource(): DeviceSource {
        return this.source;
    }

    screenshot(): Promise<Uint8Array> {
        return Promise.resolve(this.shot);
    }

    /* Types the way a simulator does: a paste chord through the session for each text. */
    async type(_deviceId: string, text: string, keyboard: () => Promise<DeviceKeyboard>): Promise<void> {
        this.typed.push(text);
        await (await keyboard()).keys([0xe3, 0x19]);
    }

    action(_deviceId: string, action: DeviceAction): Promise<DeviceSettings> {
        this.actions.push(action);
        return Promise.resolve({});
    }

    readClipboard(): Promise<string> {
        return Promise.resolve(this.clipboard);
    }

    writeClipboard(_deviceId: string, text: string): Promise<void> {
        this.clipboard = text;
        return Promise.resolve();
    }

    startRecording(_deviceId: string, file: string): Promise<void> {
        this.recordings.push({ file, stopped: false });
        return Promise.resolve();
    }

    stopRecording(): Promise<string> {
        const recording = this.recordings.at(-1)!;
        recording.stopped = true;
        return Promise.resolve(recording.file);
    }
}

function node(role: string, label: string | null, frame: [number, number, number, number], children: DeviceTreeNode[] = []): DeviceTreeNode {
    return {
        role,
        subrole: null,
        label,
        value: null,
        identifier: null,
        frame: { x: frame[0], y: frame[1], width: frame[2], height: frame[3] },
        enabled: true,
        children
    };
}

/* A screen of 1000x2000 pixels: an app with a heading, a list holding two rows and a row scrolled off the bottom, and a disabled button. */
export const SAMPLE_TREE: DeviceTree = {
    screen: { width: 1000, height: 2000 },
    truncated: false,
    root: node(
        'Application',
        'Settings',
        [0, 0, 1000, 2000],
        [
            node('Heading', 'Settings', [40, 300, 460, 100]),
            node(
                'Group',
                null,
                [0, 400, 1000, 1600],
                [
                    { ...node('Button', 'General', [40, 500, 920, 130]), identifier: 'com.example.general' },
                    { ...node('Button', 'Wi-Fi', [40, 630, 920, 130]), value: 'Home network' },
                    node('Button', 'Privacy', [40, 2100, 920, 130])
                ]
            ),
            { ...node('Button', 'Done', [800, 100, 160, 80]), enabled: false }
        ]
    )
};

/* A device whose backend reads a tree as well, and remembers which readers it was told to end. */
export class ReadingBackend extends RecordingBackend {
    screen: DeviceTree = SAMPLE_TREE;
    failure: Error | null = null;
    reads = 0;
    readonly closed: string[] = [];

    tree(): Promise<DeviceTree> {
        this.reads += 1;
        return this.failure === null ? Promise.resolve(this.screen) : Promise.reject(this.failure);
    }

    closeTree(deviceId: string): void {
        this.closed.push(deviceId);
    }
}

/* Recorders and a clock a test runs by hand: a recorder exits when it is interrupted, a limit passes when the test says. */
export class FakeRecorder {
    readonly commands: string[][] = [];
    readonly signals: string[] = [];
    readonly timers: Array<{ ms: number; run: () => void; cancelled: boolean }> = [];
    /* Off leaves an interrupted recorder running, as a recorder that hangs does. */
    exitOnInterrupt = true;
    private readonly exits: Array<(code: number) => void> = [];

    launch = (command: readonly string[]): RecordingProcess => {
        this.commands.push([...command]);
        let exit: (code: number) => void = () => undefined;
        const exited = new Promise<number>((resolve) => {
            exit = resolve;
        });
        this.exits.push(exit);
        return {
            exited,
            interrupt: () => {
                this.signals.push('SIGINT');
                if (this.exitOnInterrupt) {
                    exit(0);
                }
            },
            kill: () => {
                this.signals.push('SIGKILL');
                exit(137);
            }
        };
    };

    timer = (ms: number, run: () => void): (() => void) => {
        const entry = { ms, run, cancelled: false };
        this.timers.push(entry);
        return () => {
            entry.cancelled = true;
        };
    };

    recordings(): DeviceRecordings {
        return new DeviceRecordings(this.launch, this.timer);
    }

    finish(index: number): void {
        this.exits[index]?.(0);
    }

    pass(ms: number): void {
        for (const entry of this.timers.filter((candidate) => candidate.ms === ms && !candidate.cancelled)) {
            entry.cancelled = true;
            entry.run();
        }
    }
}
