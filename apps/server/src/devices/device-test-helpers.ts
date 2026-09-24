import type { DeviceAction, DeviceInfo, DeviceInput, DeviceSettings, LiveStreamFrame } from '@ruimte/contracts';
import type { DeviceBackend, DeviceKeyboard, DeviceSource } from './manager.ts';

/* The first bytes of a png of this size: the signature and a header chunk, which is all a size is read from. */
export const pngOf = (width: number, height: number): Uint8Array => {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
};

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
        tools: ['launchApp']
    }
};

/* A source that only counts: how often it ran and what reached it. */
export class RecordingSource implements DeviceSource {
    starts = 0;
    stops = 0;
    readonly inputs: DeviceInput[] = [];
    readonly chords: number[][] = [];

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

    constructor(info: DeviceInfo = SIMULATOR) {
        this.info = info;
        this.id = info.backendId;
        this.platform = info.platform;
    }

    list(): Promise<DeviceInfo[]> {
        this.lists += 1;
        return Promise.resolve([this.info]);
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
        await (
            await keyboard()
        )([0xe3, 0x19]);
    }

    action(_deviceId: string, action: DeviceAction): Promise<DeviceSettings> {
        this.actions.push(action);
        return Promise.resolve({});
    }
}
