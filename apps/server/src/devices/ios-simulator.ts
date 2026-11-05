import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    DevicePermissionSchema,
    type DeviceAction,
    type DeviceButton,
    type DeviceInfo,
    type DevicePermission,
    type DeviceSettings,
    type DeviceTextSize,
    type DeviceToggleSetting,
    type DeviceTool
} from '@ruimte/contracts';
import { z } from 'zod';
import { collect, type CommandResult } from './command.ts';
import { DeviceError } from './device-error.ts';
import { requireExtension, requireMedia } from './device-paths.ts';
import { simulatorTree, type DeviceTree } from './device-tree.ts';
import { DeviceHelperSource, type DeviceHelperLauncher } from './helper-source.ts';
import { KEY_LEFT_COMMAND, KEY_V, PASTE_SETTLE_MS, typeInRuns, type DeviceBackend, type DeviceKeyboard, type DeviceSource } from './manager.ts';
import { DeviceRecordings } from './recordings.ts';
import { serveSimFile } from './serve-sim.ts';
import type { SimulatorCamera } from './simulator-camera.ts';
import { realPanelMonitor, SimulatorFold, type PanelMonitorFactory } from './simulator-fold.ts';
import type { SimulatorTreeReader } from './simulator-tree.ts';

export type SimctlRunner = (arguments_: string[], stdin?: string) => Promise<CommandResult>;

const SimctlDeviceSchema = z.object({
    udid: z.string().min(1),
    isAvailable: z.boolean(),
    state: z.string(),
    name: z.string().min(1),
    deviceTypeIdentifier: z.string().optional()
});

/* The one simulator with a hinge; whether this Xcode can fold it, the helper says when asked. */
const FOLDABLE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo';

const SimctlListSchema = z.object({ devices: z.record(z.string(), z.array(SimctlDeviceSchema)) });

function runtimeName(identifier: string): string {
    const value = identifier.replace('com.apple.CoreSimulator.SimRuntime.', '');
    const match = /^(.*)-(\d+)-(\d+)$/.exec(value);
    return match ? `${match[1]} ${match[2]}.${match[3]}` : value;
}

function stateOf(state: string): DeviceInfo['state'] {
    if (state === 'Booted') {
        return 'booted';
    }
    return state === 'Shutdown' ? 'shutdown' : 'transitioning';
}

async function defaultRunner(arguments_: string[], stdin?: string): Promise<CommandResult> {
    // simctl reads and writes the pasteboard in the locale's encoding, and a daemon under launchd has none, which turns ü into √º.
    const utf8 = stdin !== undefined || arguments_[0] === 'pbpaste';
    const process = Bun.spawn(['xcrun', 'simctl', ...arguments_], {
        stdin: stdin === undefined ? 'ignore' : 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env: utf8 ? { ...Bun.env, LC_ALL: 'en_US.UTF-8' } : undefined
    });
    const fed = stdin !== undefined && process.stdin ? Promise.all([process.stdin.write(stdin), process.stdin.end()]) : null;
    const [result] = await Promise.all([collect(process), fed]);
    return result;
}

// todo(Bas): announce volumeUp, volumeDown, power and playPause, which the helper presses already, once side-buttons.device.integration.test.ts passed on a simulator.
const IOS_BUTTONS: DeviceButton[] = ['home', 'swipeHome', 'appSwitcher', 'lock', 'siri'];

/* What a simulator announces; each tool joins once its action does something. */
const IOS_SIMULATOR_TOOLS: DeviceTool[] = [
    'openUrl',
    'launchApp',
    'terminateApp',
    'appearance',
    'textSize',
    'liquidGlass',
    'colorFilter',
    'reduceMotion',
    'increaseContrast',
    'reduceTransparency',
    'showBorders',
    'voiceOver',
    'location',
    'clearLocation',
    'permissions',
    'push',
    'capture',
    'record',
    'clipboard',
    'erase',
    'statusBar',
    'battery',
    'biometrics',
    'shake',
    'installApp',
    'addMedia'
];

/* The status bar of a marketing shot. */
const CLEAN_STATUS_BAR = [
    '--time',
    '9:41',
    '--dataNetwork',
    'wifi',
    '--wifiMode',
    'active',
    '--wifiBars',
    '3',
    '--cellularMode',
    'active',
    '--cellularBars',
    '4',
    '--batteryState',
    'charged',
    '--batteryLevel',
    '100'
];

/*
 * The Darwin notifications the simulator's biometric stand-in listens to. Not a documented API: they
 * were seen working on Xcode 27, which a device test of Bas still has to confirm.
 */
const BIOMETRIC_ENROLLMENT = 'com.apple.BiometricKit.enrollmentChanged';
const BIOMETRIC_MATCH: Record<'face' | 'finger', Record<'match' | 'nomatch', string>> = {
    face: { match: 'com.apple.BiometricKit_Sim.pearl.match', nomatch: 'com.apple.BiometricKit_Sim.pearl.nomatch' },
    finger: { match: 'com.apple.BiometricKit_Sim.fingerTouch.match', nomatch: 'com.apple.BiometricKit_Sim.fingerTouch.nomatch' }
};
const SHAKE = 'com.apple.UIKit.SimulatorShake';

/* A recording a person forgot keeps going no longer than this, so it cannot fill the disk. */
const RECORDING_LIMIT_MS = 10 * 60 * 1000;

const IOS_TEXT_SIZES: Record<DeviceTextSize, string> = {
    small: 'small',
    default: 'large',
    large: 'extra-extra-large',
    'extra-large': 'accessibility-large'
};

const IOS_TOGGLE_OPTIONS: Partial<Record<DeviceToggleSetting, string>> = {
    reduceMotion: 'reduce-motion',
    reduceTransparency: 'reduce-transparency',
    showBorders: 'show-borders',
    voiceOver: 'voiceover'
};

const IOS_PERMISSION_SERVICES: Record<DevicePermission, string> = {
    camera: 'camera',
    microphone: 'microphone',
    photos: 'photos',
    contacts: 'contacts',
    calendar: 'calendar',
    reminders: 'reminders',
    location: 'location',
    motion: 'motion',
    'media-library': 'media-library',
    faceid: 'faceid'
};

/* The capture of a foldable simulator, which follows its panel for as long as it runs. */
class FoldingSource extends DeviceHelperSource {
    private readonly fold: SimulatorFold;

    constructor(deviceId: string, launch: DeviceHelperLauncher, fold: SimulatorFold) {
        super(deviceId, launch);
        this.fold = fold;
    }

    override async start(publish: Parameters<DeviceHelperSource['start']>[0]): Promise<void> {
        await super.start(publish);
        this.fold.attach(this);
    }

    override async stop(): Promise<void> {
        this.fold.detach();
        await super.stop();
    }
}

/* The native helper of a simulator someone has open, which the tools that go through its HID need. */
function helperOf(session: DeviceSource | null): DeviceHelperSource {
    if (!(session instanceof DeviceHelperSource)) {
        throw new DeviceError('device-not-open', 'Open the simulator before using this tool');
    }
    return session;
}

function textSizeFromIos(category: string): DeviceTextSize {
    const exact = (Object.entries(IOS_TEXT_SIZES) as Array<[DeviceTextSize, string]>).find(([, value]) => value === category);
    if (exact) {
        return exact[0];
    }
    if (category.startsWith('accessibility')) {
        return 'extra-large';
    }
    if (category.includes('extra')) {
        return 'large';
    }
    return ['extra-small', 'small', 'medium'].includes(category) ? 'small' : 'default';
}

function axHelperPath(): string | null {
    return serveSimFile('serve-sim-ax-settings', 'simax');
}

/* The settings the accessibility helper reports, or none for an answer it cannot read. */
function axSettingsOf(output: string | undefined): Record<string, string> {
    if (!output) {
        return {};
    }
    try {
        return z.record(z.string(), z.string()).parse(JSON.parse(output));
    } catch {
        return {};
    }
}

export class IosSimulatorBackend implements DeviceBackend {
    readonly id = 'simctl';
    readonly platform = 'ios' as const;
    readonly kinds = ['simulator'] as const;
    private readonly run: SimctlRunner;
    private readonly launch: DeviceHelperLauncher | null;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly treeReader: ((udid: string) => SimulatorTreeReader) | null;
    private readonly readers = new Map<string, SimulatorTreeReader>();
    private readonly recordings: DeviceRecordings;
    /* What simctl cannot read back, as this daemon last set it; unknown again after a restart. */
    private readonly statusBars = new Map<string, DeviceSettings['statusBar']>();
    private readonly batteries = new Map<string, NonNullable<DeviceSettings['battery']>>();
    private readonly enrolled = new Map<string, boolean>();
    private readonly foldable = new Set<string>();
    private readonly folds = new Map<string, SimulatorFold>();
    private readonly panelMonitor: PanelMonitorFactory;
    private readonly camera: SimulatorCamera | null;

    constructor(
        run: SimctlRunner = defaultRunner,
        launch: DeviceHelperLauncher | null = null,
        sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
        treeReader: ((udid: string) => SimulatorTreeReader) | null = null,
        recordings: DeviceRecordings = new DeviceRecordings(),
        panelMonitor: PanelMonitorFactory = realPanelMonitor,
        camera: SimulatorCamera | null = null
    ) {
        this.camera = camera;
        this.run = run;
        this.launch = launch;
        this.sleep = sleep;
        this.treeReader = treeReader;
        this.recordings = recordings;
        this.panelMonitor = panelMonitor;
    }

    async list(): Promise<DeviceInfo[]> {
        const result = await this.command(['list', 'devices', 'available', '--json']);
        let byRuntime: z.infer<typeof SimctlListSchema>['devices'];
        try {
            byRuntime = SimctlListSchema.parse(JSON.parse(result.stdout)).devices;
        } catch {
            throw new DeviceError('invalid-simctl-output', 'simctl returned a device list Ruimte could not read');
        }
        const listed = Object.entries(byRuntime).flatMap(([runtime, devices]) =>
            devices.filter((device) => device.isAvailable && runtime.includes('.iOS-')).map((device) => ({ runtime, device }))
        );
        this.foldable.clear();
        for (const { device } of listed) {
            if (device.deviceTypeIdentifier === FOLDABLE_TYPE) {
                this.foldable.add(device.udid);
            }
        }
        return listed.map(({ runtime, device }) => ({
            deviceId: device.udid,
            backendId: this.id,
            platform: this.platform,
            kind: 'simulator' as const,
            name: device.name,
            runtime: runtimeName(runtime),
            state: stateOf(device.state),
            capabilities: {
                boot: true,
                shutdown: true,
                stream: this.launch !== null,
                input: this.launch !== null,
                screenshot: true,
                buttons: IOS_BUTTONS,
                tools: [
                    ...IOS_SIMULATOR_TOOLS,
                    ...(this.launch === null ? [] : (['keyboard', 'memoryWarning'] as const)),
                    ...(this.launch !== null && this.foldable.has(device.udid) ? (['fold'] as const) : []),
                    ...(this.camera?.available ? (['camera'] as const) : [])
                ],
                permissions: [...DevicePermissionSchema.options]
            }
        }));
    }

    async boot(deviceId: string): Promise<DeviceInfo> {
        const current = await this.find(deviceId);
        if (current.state === 'booted') {
            return current;
        }
        await this.command(['boot', deviceId]);
        return this.find(deviceId);
    }

    /* simctl lists a simulator as booted while it still shows the boot screen; `bootstatus` returns once its boot finished. */
    async ready(deviceId: string): Promise<DeviceInfo> {
        await this.command(['bootstatus', deviceId]);
        return this.find(deviceId);
    }

    async shutdown(deviceId: string): Promise<DeviceInfo> {
        const current = await this.find(deviceId);
        if (current.state === 'shutdown') {
            return current;
        }
        this.recordings.drop(deviceId);
        this.camera?.stop(deviceId);
        await this.command(['shutdown', deviceId]);
        return this.find(deviceId);
    }

    async detail(deviceId: string): Promise<DeviceSettings> {
        const read = async (arguments_: string[]): Promise<string | undefined> => {
            try {
                return (await this.command(arguments_)).stdout.trim().toLowerCase();
            } catch {
                return undefined;
            }
        };
        const helper = axHelperPath();
        const [appearance, contentSize, contrast, axOutput] = await Promise.all([
            read(['ui', deviceId, 'appearance']),
            read(['ui', deviceId, 'content_size']),
            read(['ui', deviceId, 'increase_contrast']),
            helper ? read(['spawn', deviceId, helper, 'status']) : undefined
        ]);
        const ax = axSettingsOf(axOutput);
        const onOff = (value: string | undefined): boolean | undefined => (value === 'on' ? true : value === 'off' ? false : undefined);
        const reduceMotion = onOff(ax['reduce-motion']);
        const reduceTransparency = onOff(ax['reduce-transparency']);
        const showBorders = onOff(ax['show-borders']);
        const voiceOver = onOff(ax.voiceover);
        const colorFilter = ['none', 'grayscale', 'red-green', 'green-red', 'blue-yellow'].includes(ax['color-filter'] ?? '')
            ? (ax['color-filter'] as DeviceSettings['colorFilter'])
            : undefined;
        return {
            ...(appearance === 'light' || appearance === 'dark' ? { appearance } : {}),
            ...(contentSize ? { textSize: textSizeFromIos(contentSize) } : {}),
            ...(contrast ? { increaseContrast: contrast === 'enabled' } : {}),
            ...(reduceMotion === undefined ? {} : { reduceMotion }),
            ...(reduceTransparency === undefined ? {} : { reduceTransparency }),
            ...(showBorders === undefined ? {} : { showBorders }),
            ...(voiceOver === undefined ? {} : { voiceOver }),
            ...(ax['liquid-glass'] === 'clear' || ax['liquid-glass'] === 'tinted' ? { liquidGlass: ax['liquid-glass'] } : {}),
            ...(colorFilter === undefined ? {} : { colorFilter }),
            ...this.remembered(deviceId),
            ...(this.folds.get(deviceId)?.settings() ?? {}),
            ...this.recordings.settingsOf(deviceId)
        };
    }

    private remembered(deviceId: string): DeviceSettings {
        const statusBar = this.statusBars.get(deviceId);
        const battery = this.batteries.get(deviceId);
        const enrolled = this.enrolled.get(deviceId);
        return {
            ...(statusBar === undefined ? {} : { statusBar }),
            ...(battery === undefined ? {} : { battery }),
            ...(enrolled === undefined ? {} : { biometricEnrolled: enrolled })
        };
    }

    async action(deviceId: string, action: DeviceAction, session: DeviceSource | null = null): Promise<DeviceSettings> {
        if (action.action === 'erase') {
            await this.erase(deviceId);
            return {};
        }
        switch (action.action) {
            case 'setStatusBar':
                if (action.value === 'clean') {
                    await this.command(['status_bar', deviceId, 'override', ...CLEAN_STATUS_BAR]);
                } else {
                    await this.command(['status_bar', deviceId, 'clear']);
                    this.batteries.delete(deviceId);
                }
                this.statusBars.set(deviceId, action.value);
                break;
            case 'setBattery':
                await this.command([
                    'status_bar',
                    deviceId,
                    'override',
                    '--batteryLevel',
                    String(action.level),
                    '--batteryState',
                    action.charging ? 'charging' : 'discharging'
                ]);
                this.batteries.set(deviceId, { level: action.level, charging: action.charging });
                break;
            case 'resetBattery':
                // A clear takes every override, so a clean status bar is put back after it.
                await this.command(['status_bar', deviceId, 'clear']);
                if (this.statusBars.get(deviceId) === 'clean') {
                    await this.command(['status_bar', deviceId, 'override', ...CLEAN_STATUS_BAR]);
                }
                this.batteries.delete(deviceId);
                break;
            case 'biometric':
                if (action.event === 'enroll' || action.event === 'unenroll') {
                    const enrolled = action.event === 'enroll';
                    await this.notify(deviceId, ['-s', BIOMETRIC_ENROLLMENT, enrolled ? '1' : '0']);
                    await this.notify(deviceId, ['-p', BIOMETRIC_ENROLLMENT]);
                    this.enrolled.set(deviceId, enrolled);
                } else {
                    await this.notify(deviceId, ['-p', BIOMETRIC_MATCH[action.sensor][action.event]]);
                }
                break;
            case 'shake':
                await this.notify(deviceId, ['-p', SHAKE]);
                break;
            case 'memoryWarning':
                await helperOf(session).call({ method: 'memoryWarning' });
                break;
            case 'setFold':
                await this.foldOf(deviceId).pose(helperOf(session), action.value);
                break;
            case 'setHinge':
                await this.foldOf(deviceId).setHinge(helperOf(session), action.degrees);
                break;
            case 'setAllPermissions':
                await this.command(['privacy', deviceId, action.decision, 'all', action.appId]);
                break;
            case 'setCamera':
                if (this.camera === null) {
                    throw new DeviceError('device-action-unavailable', 'This machine has no camera helper for simulators');
                }
                await this.camera.set(deviceId, action.appId, action.source, action.path);
                break;
            case 'installApp':
                requireExtension(action.path, ['.app'], 'an .app built for the simulator; an .ipa is for an iPhone');
                await this.command(['install', deviceId, action.path]);
                break;
            case 'addMedia':
                requireMedia(action.paths);
                await this.command(['addmedia', deviceId, ...action.paths]);
                break;
            case 'setAppearance':
                await this.command(['ui', deviceId, 'appearance', action.value]);
                break;
            case 'setTextSize':
                await this.command(['ui', deviceId, 'content_size', IOS_TEXT_SIZES[action.value]]);
                break;
            case 'setToggle':
                if (action.setting === 'increaseContrast') {
                    await this.command(['ui', deviceId, 'increase_contrast', action.value ? 'enabled' : 'disabled']);
                } else {
                    const option = IOS_TOGGLE_OPTIONS[action.setting];
                    if (!option) {
                        throw new DeviceError('device-action-unavailable', 'This setting is not available for iOS simulators');
                    }
                    await this.ax(deviceId, ['set', option, action.value ? 'on' : 'off']);
                }
                break;
            case 'setLiquidGlass':
                await this.ax(deviceId, ['set', 'liquid-glass', action.value]);
                break;
            case 'setColorFilter':
                await this.ax(deviceId, ['set', 'color-filter', action.value]);
                break;
            case 'setLocation':
                await this.command(['location', deviceId, 'set', `${action.latitude},${action.longitude}`]);
                break;
            case 'clearLocation':
                await this.command(['location', deviceId, 'clear']);
                break;
            case 'setPermission':
                await this.command(['privacy', deviceId, action.decision, IOS_PERMISSION_SERVICES[action.permission], action.appId]);
                break;
            case 'openUrl':
                await this.command(['openurl', deviceId, action.url]);
                break;
            case 'launchApp':
                await this.command(['launch', deviceId, action.appId]);
                break;
            case 'terminateApp':
                await this.command(['terminate', deviceId, action.appId]);
                break;
            case 'sendPush':
                await this.command(['push', deviceId, action.appId, '-'], JSON.stringify({ aps: { alert: action.payload } }));
                break;
            default:
                throw new DeviceError('device-action-unavailable', 'This tool is not available for iOS simulators');
        }
        return this.detail(deviceId);
    }

    /* simctl erases only a simulator that is shut down, and the person's client shuts it down first. */
    private async erase(deviceId: string): Promise<void> {
        if ((await this.find(deviceId)).state !== 'shutdown') {
            throw new DeviceError('device-must-be-shut-down', 'Shut the simulator down before erasing it');
        }
        this.recordings.drop(deviceId);
        this.camera?.stop(deviceId);
        await this.command(['erase', deviceId]);
    }

    createSource(deviceId: string): DeviceHelperSource {
        if (this.launch === null) {
            throw new DeviceError('device-capture-unavailable', 'The native iOS simulator helper is not installed');
        }
        return this.foldable.has(deviceId) ? new FoldingSource(deviceId, this.launch, this.foldOf(deviceId)) : new DeviceHelperSource(deviceId, this.launch);
    }

    private foldOf(deviceId: string): SimulatorFold {
        let fold = this.folds.get(deviceId);
        if (!fold) {
            fold = new SimulatorFold(deviceId, this.panelMonitor);
            this.folds.set(deviceId, fold);
        }
        return fold;
    }

    async screenshot(deviceId: string): Promise<Uint8Array> {
        const directory = await mkdtemp(join(tmpdir(), 'ruimte-simulator-shot-'));
        try {
            const path = join(directory, 'screen.png');
            await this.command(['io', deviceId, 'screenshot', '--type=png', path]);
            return new Uint8Array(await readFile(path));
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }

    async startRecording(deviceId: string, file: string): Promise<void> {
        this.recordings.start(deviceId, file, ['xcrun', 'simctl', 'io', deviceId, 'recordVideo', '--codec=h264', '--force', file], RECORDING_LIMIT_MS);
    }

    /* simctl writes the end of the video only on an interrupt, so a kill would leave an empty file. */
    stopRecording(deviceId: string): Promise<string> {
        return this.recordings.stop(deviceId, (process) => process.interrupt());
    }

    async readClipboard(deviceId: string): Promise<string> {
        return (await this.command(['pbpaste', deviceId])).stdout;
    }

    async writeClipboard(deviceId: string, text: string): Promise<void> {
        await this.command(['pbcopy', deviceId], text);
    }

    /* Read through the device bridge, which stays running for this simulator until `closeTree`. */
    async tree(deviceId: string): Promise<DeviceTree> {
        if (this.treeReader === null) {
            throw new DeviceError('device-tree-unavailable', "The device bridge that reads a simulator's accessibility is not installed on this machine");
        }
        let reader = this.readers.get(deviceId);
        if (!reader) {
            reader = this.treeReader(deviceId);
            this.readers.set(deviceId, reader);
        }
        return simulatorTree(await reader.read());
    }

    closeTree(deviceId: string): void {
        this.readers.get(deviceId)?.close();
        this.readers.delete(deviceId);
    }

    closeAll(): void {
        this.recordings.dropAll();
        this.camera?.stopAll();
        for (const deviceId of [...this.readers.keys()]) {
            this.closeTree(deviceId);
        }
    }

    /* Pastes the text in through the simulator's pasteboard, which it replaces. */
    async type(deviceId: string, text: string, keyboard: () => Promise<DeviceKeyboard>): Promise<void> {
        const session = await keyboard();
        await typeInRuns(
            text,
            (usage) => session.keys([usage]),
            async (run) => {
                await this.command(['pbcopy', deviceId], run);
                await session.keys([KEY_LEFT_COMMAND, KEY_V]);
                await this.sleep(PASTE_SETTLE_MS);
            }
        );
    }

    private async notify(deviceId: string, arguments_: string[]): Promise<void> {
        await this.command(['spawn', deviceId, 'notifyutil', ...arguments_]);
    }

    private async ax(deviceId: string, arguments_: string[]): Promise<void> {
        const helper = axHelperPath();
        if (!helper) {
            throw new DeviceError('device-action-unavailable', 'The simulator accessibility helper is not installed');
        }
        await this.command(['spawn', deviceId, helper, ...arguments_]);
    }

    private async command(arguments_: string[], stdin?: string): Promise<CommandResult> {
        let result: CommandResult;
        try {
            result = await this.run(arguments_, stdin);
        } catch {
            throw new DeviceError('simctl-unavailable', 'Xcode and simctl are required for iOS simulators');
        }
        if (result.exitCode !== 0) {
            throw new DeviceError('simctl-failed', result.stderr.trim() || 'simctl failed');
        }
        return result;
    }

    private async find(deviceId: string): Promise<DeviceInfo> {
        const device = (await this.list()).find((candidate) => candidate.deviceId === deviceId);
        if (!device) {
            throw new DeviceError('device-not-found', 'The iOS simulator is no longer available');
        }
        return device;
    }
}
