import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type {
    DeviceAction,
    DeviceButton,
    DeviceColorFilter,
    DeviceInfo,
    DevicePermission,
    DeviceSettings,
    DeviceTextSize,
    DeviceTool
} from '@ruimte/contracts';
import { locateAndroidSdk, type AndroidSdk } from './android-sdk.ts';
import { DeviceError, type DeviceBackend, type DeviceSource } from './manager.ts';
import type { CommandResult } from './scrcpy-source.ts';

export type AndroidRunner = (command: string, arguments_: string[]) => Promise<CommandResult>;

/* The same for a command whose output is bytes, such as a png from `exec-out`, which a text decoder would mangle. */
export type AndroidBytesRunner = (command: string, arguments_: string[]) => Promise<{ exitCode: number; stdout: Uint8Array; stderr: string }>;

export interface EmulatorProcess {
    readonly exited: Promise<number>;
    output(): string;
}

export type EmulatorLauncher = (emulator: string, arguments_: string[], avd: string) => EmulatorProcess;

export interface AvdInfo {
    name: string;
    displayName: string;
    apiLevel: string | null;
}

export interface AndroidBackendOptions {
    locate?: () => AndroidSdk | null;
    run?: AndroidRunner;
    runBytes?: AndroidBytesRunner;
    launch?: EmulatorLauncher;
    readAvds?: (avdHome: string) => Promise<AvdInfo[]>;
    /* Null when this machine has no screen server to push, which leaves a device listed but not viewable. */
    createSource?: ((adb: string, serial: string) => DeviceSource) | null;
    sleep?: (ms: number) => Promise<void>;
}

interface AdbEntry {
    serial: string;
    state: string;
    model: string | null;
}

interface Probe {
    booted: boolean;
    model: string;
    apiLevel: string;
    talkBack: boolean;
}

interface Booting {
    serial: string;
    process: EmulatorProcess;
}

const BUTTONS: DeviceButton[] = ['back', 'home', 'appSwitcher', 'lock', 'siri'];
const BASE_TOOLS: DeviceTool[] = [
    'openUrl',
    'launchApp',
    'terminateApp',
    'appearance',
    'textSize',
    'colorFilter',
    'reduceMotion',
    'increaseContrast',
    'showBorders',
    'permissions'
];

const TALKBACK_PACKAGE = 'com.google.android.marvin.talkback';
const TALKBACK_SERVICE = `${TALKBACK_PACKAGE}/${TALKBACK_PACKAGE}.TalkBackService`;

const FONT_SCALES: Record<DeviceTextSize, number> = { small: 0.85, default: 1, large: 1.15, 'extra-large': 1.3 };

const DALTONIZER: Record<Exclude<DeviceColorFilter, 'none'>, string> = { grayscale: '0', 'red-green': '11', 'green-red': '12', 'blue-yellow': '13' };

const ANIMATION_SCALES = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'];

/* The runtime permissions that stand for each permission a person picks, by the API level that introduced them. */
const permissionsFor = (permission: DevicePermission, apiLevel: number): string[] => {
    const mediaSplit = apiLevel >= 33;
    switch (permission) {
        case 'camera':
            return ['android.permission.CAMERA'];
        case 'microphone':
            return ['android.permission.RECORD_AUDIO'];
        case 'photos':
            return mediaSplit ? ['android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO'] : ['android.permission.READ_EXTERNAL_STORAGE'];
        case 'media-library':
            return mediaSplit ? ['android.permission.READ_MEDIA_AUDIO'] : ['android.permission.READ_EXTERNAL_STORAGE'];
        case 'contacts':
            return ['android.permission.READ_CONTACTS', 'android.permission.WRITE_CONTACTS'];
        case 'calendar':
            return ['android.permission.READ_CALENDAR', 'android.permission.WRITE_CALENDAR'];
        case 'location':
            return ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'];
        case 'motion':
            return ['android.permission.ACTIVITY_RECOGNITION'];
        case 'reminders':
        case 'faceid':
            return [];
    }
};

const PERMISSIONS: DevicePermission[] = ['camera', 'microphone', 'photos', 'contacts', 'calendar', 'location', 'motion', 'media-library'];

const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

const FIRST_EMULATOR_PORT = 5554;
const LAST_EMULATOR_PORT = 5682;
const EMULATOR_SERIAL = /^emulator-(\d+)$/;

/* One argument for the device's `sh`, which is what `adb shell` hands a command line to. */
export const shellQuote = (argument: string): string => (/^[A-Za-z0-9_./:=@%+-]+$/.test(argument) ? argument : `'${argument.replaceAll("'", "'\\''")}'`);

/* `input text` reads %s as a space and nothing else specially, so a literal %s goes in two calls that split it. */
const textCommands = (part: string): string[] => {
    const pieces = part.split('%s');
    return pieces
        .map((piece, index) => `${index > 0 ? 's' : ''}${piece}${index < pieces.length - 1 ? '%' : ''}`)
        .filter((piece) => piece !== '')
        .map((piece) => `input text ${shellQuote(piece.replaceAll(' ', '%s'))}`);
};

/* The device shell line that types this text, a newline as Enter and a tab as Tab; `input` knows no character past ASCII. */
export const typingScript = (text: string): string => {
    const normalized = text.replace(/\r\n?/g, '\n');
    if (!/^[\x20-\x7e\n\t]*$/.test(normalized)) {
        throw new DeviceError(
            'device-input-unavailable',
            'Android takes only plain ASCII text from Ruimte: letters, digits, punctuation, spaces, newlines and tabs'
        );
    }
    return normalized
        .split(/(\n|\t)/)
        .flatMap((part) => (part === '\n' ? ['input keyevent 66'] : part === '\t' ? ['input keyevent 61'] : textCommands(part)))
        .join(' && ');
};

export const parseAdbDevices = (output: string): AdbEntry[] =>
    output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('List of devices') && !line.startsWith('*'))
        .flatMap((line) => {
            const match = /^(\S+)\s+(.+)$/.exec(line);
            if (!match) {
                return [];
            }
            const rest = match[2]!;
            // A state is one word, or a sentence such as `no permissions (...)` before the `key:value` pairs.
            const state = rest.startsWith('no permissions') ? 'no-permissions' : rest.split(/\s+/)[0]!;
            const model = /\bmodel:(\S+)/.exec(rest)?.[1]?.replaceAll('_', ' ') ?? null;
            return [{ serial: match[1]!, state, model }];
        });

const parseIni = (text: string): Record<string, string> =>
    Object.fromEntries(
        text.split('\n').flatMap((line) => {
            const index = line.indexOf('=');
            return index > 0 ? [[line.slice(0, index).trim(), line.slice(index + 1).trim()]] : [];
        })
    );

/* An API level from `android-35` in a target or a system image folder; a preview names itself instead. */
const apiLevelOf = (config: Record<string, string>): string | null => {
    for (const value of [config['image.sysdir.1'], config.target]) {
        const match = value ? /android-([^/]+)/.exec(value) : null;
        if (match) {
            return match[1]!;
        }
    }
    return null;
};

export const readAvdFolder = async (avdHome: string): Promise<AvdInfo[]> => {
    let entries: string[];
    try {
        entries = await readdir(avdHome);
    } catch {
        return [];
    }
    const avds = await Promise.all(
        entries
            .filter((entry) => entry.endsWith('.ini'))
            .map(async (entry): Promise<AvdInfo | null> => {
                const name = entry.slice(0, -'.ini'.length);
                try {
                    const pointer = parseIni(await readFile(join(avdHome, entry), 'utf8'));
                    const folder = pointer.path && isAbsolute(pointer.path) ? pointer.path : join(avdHome, `${name}.avd`);
                    const config = parseIni(await readFile(join(folder, 'config.ini'), 'utf8').catch(() => ''));
                    return {
                        name,
                        displayName: config['avd.ini.displayname'] || name.replaceAll('_', ' '),
                        apiLevel: apiLevelOf(config) ?? apiLevelOf(pointer)
                    };
                } catch {
                    return null;
                }
            })
    );
    return avds.filter((avd): avd is AvdInfo => avd !== null);
};

const defaultRunner: AndroidRunner = async (command, arguments_) => {
    const child = Bun.spawn([command, ...arguments_], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exitCode, stdout, stderr };
};

const defaultBytesRunner: AndroidBytesRunner = async (command, arguments_) => {
    const child = Bun.spawn([command, ...arguments_], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).bytes(), new Response(child.stderr).text()]);
    return { exitCode, stdout, stderr };
};

/*
 * Starts an emulator in its own session with its output in a file, so it outlives a daemon restart and
 * a closed pipe cannot take it down, while a start that fails still says why.
 */
const defaultLaunch: EmulatorLauncher = (emulator, arguments_, avd) => {
    const log = join(tmpdir(), `ruimte-emulator-${avd}.log`);
    const descriptor = openSync(log, 'w');
    const child = spawn(emulator, arguments_, { detached: true, stdio: ['ignore', descriptor, descriptor] });
    closeSync(descriptor);
    child.unref();
    const exited = new Promise<number>((resolve) => {
        child.once('exit', (code) => resolve(code ?? 1));
        child.once('error', () => resolve(127));
    });
    return {
        exited,
        output: () => {
            try {
                return readFileSync(log, 'utf8').slice(-4096);
            } catch {
                return '';
            }
        }
    };
};

/*
 * Android emulators and phones through adb. An emulator is known by its AVD name whether it runs or
 * not, so a view keeps its device across a boot; a phone is known by its serial. The list is read every
 * second while a device surface is open, so what a device answers once is kept until adb loses it.
 */
export class AndroidBackend implements DeviceBackend {
    readonly id = 'android';
    readonly platform = 'android' as const;
    private readonly locate: () => AndroidSdk | null;
    private readonly run: AndroidRunner;
    private readonly runBytes: AndroidBytesRunner;
    private readonly launch: EmulatorLauncher;
    private readonly readAvds: (avdHome: string) => Promise<AvdInfo[]>;
    private readonly createStreamSource: ((adb: string, serial: string) => DeviceSource) | null;
    private readonly sleep: (ms: number) => Promise<void>;
    private located: AndroidSdk | null = null;
    private readonly avdNames = new Map<string, string>();
    private readonly probes = new Map<string, Probe>();
    private readonly booting = new Map<string, Booting>();
    private readonly serials = new Map<string, string>();

    constructor(options: AndroidBackendOptions = {}) {
        this.locate = options.locate ?? (() => locateAndroidSdk());
        this.run = options.run ?? defaultRunner;
        this.runBytes = options.runBytes ?? defaultBytesRunner;
        this.launch = options.launch ?? defaultLaunch;
        this.readAvds = options.readAvds ?? readAvdFolder;
        this.createStreamSource = options.createSource ?? null;
        this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
    }

    async list(): Promise<DeviceInfo[]> {
        const sdk = this.sdk();
        const connected = await this.connected(sdk);
        const avds = await this.readAvds(sdk.avdHome);
        const devices: DeviceInfo[] = [];
        const running = new Map<string, AdbEntry>();
        this.serials.clear();

        for (const entry of connected) {
            if (!EMULATOR_SERIAL.test(entry.serial)) {
                devices.push(await this.physical(sdk, entry));
                continue;
            }
            const name = await this.avdName(sdk, entry.serial);
            if (name !== null) {
                running.set(name, entry);
            }
        }
        for (const [name, booting] of this.booting) {
            if (!running.has(name)) {
                running.set(name, { serial: booting.serial, state: 'starting', model: null });
            }
        }
        const known = new Set(avds.map((avd) => avd.name));
        for (const name of running.keys()) {
            if (!known.has(name)) {
                avds.push({ name, displayName: name.replaceAll('_', ' '), apiLevel: null });
            }
        }
        for (const avd of avds) {
            devices.push(await this.emulator(sdk, avd, running.get(avd.name) ?? null));
        }
        return devices;
    }

    async boot(deviceId: string): Promise<DeviceInfo> {
        const current = await this.find(deviceId);
        if (current.kind !== 'simulator') {
            throw new DeviceError('device-action-unavailable', 'A phone cannot be started by Ruimte');
        }
        if (current.state !== 'shutdown') {
            return current;
        }
        const sdk = this.sdk();
        if (sdk.emulator === null) {
            throw new DeviceError('emulator-unavailable', 'The Android emulator is not installed in the Android SDK');
        }
        const used = new Set([...this.avdNames.keys(), ...[...this.booting.values()].map((booting) => booting.serial)]);
        let port = FIRST_EMULATOR_PORT;
        while (used.has(`emulator-${port}`) && port < LAST_EMULATOR_PORT) {
            port += 2;
        }
        const serial = `emulator-${port}`;
        const process = this.launch(sdk.emulator, ['-avd', deviceId, '-port', String(port), '-no-window', '-no-boot-anim'], deviceId);
        const booting: Booting = { serial, process };
        this.booting.set(deviceId, booting);
        this.avdNames.set(serial, deviceId);
        let exitCode: number | null = null;
        void process.exited.then((code) => {
            exitCode = code;
            if (this.booting.get(deviceId) === booting) {
                this.booting.delete(deviceId);
            }
        });
        // A start that cannot work (no hardware acceleration, a broken image) ends within seconds; report that instead of a start that never finishes.
        for (let attempt = 0; attempt < 30; attempt += 1) {
            if (exitCode !== null) {
                this.avdNames.delete(serial);
                const detail = process
                    .output()
                    .split('\n')
                    .filter((line) => /error|fatal|panic/i.test(line))
                    .slice(-3)
                    .join('\n')
                    .trim();
                throw new DeviceError('emulator-failed', detail || `The emulator stopped while starting (exit code ${exitCode})`);
            }
            if ((await this.connected(sdk)).some((entry) => entry.serial === serial)) {
                break;
            }
            await this.sleep(500);
        }
        return this.find(deviceId);
    }

    async shutdown(deviceId: string): Promise<DeviceInfo> {
        const current = await this.find(deviceId);
        if (current.kind !== 'simulator') {
            throw new DeviceError('device-action-unavailable', 'A phone cannot be shut down by Ruimte');
        }
        const serial = this.serials.get(deviceId);
        if (current.state === 'shutdown' || serial === undefined) {
            return current;
        }
        const sdk = this.sdk();
        await this.adb(sdk, ['-s', serial, 'emu', 'kill']);
        this.booting.delete(deviceId);
        for (let attempt = 0; attempt < 20; attempt += 1) {
            if (!(await this.connected(sdk)).some((entry) => entry.serial === serial)) {
                break;
            }
            await this.sleep(500);
        }
        return this.find(deviceId);
    }

    async detail(deviceId: string): Promise<DeviceSettings> {
        const { serial, probe } = await this.booted(deviceId);
        const sections = (
            await this.shell(
                serial,
                [
                    'cmd uimode night',
                    'settings get system font_scale',
                    ...ANIMATION_SCALES.map((setting) => `settings get global ${setting}`),
                    'settings get secure high_text_contrast_enabled',
                    'settings get secure accessibility_display_daltonizer_enabled',
                    'settings get secure accessibility_display_daltonizer',
                    'getprop debug.layout',
                    'settings get secure enabled_accessibility_services'
                ].join('; echo @@; ')
            )
        )
            .split(/^@@$/m)
            .map((section) => section.trim());
        const [
            night = '',
            fontScale = '',
            windowScale = '',
            transitionScale = '',
            animatorScale = '',
            contrast = '',
            filterOn = '',
            filter = '',
            layout = '',
            services = ''
        ] = sections;
        const scale = Number.parseFloat(fontScale);
        const animationOff = [windowScale, transitionScale, animatorScale].every((value) => value !== 'null' && Number.parseFloat(value) === 0);
        const appearance = /Night mode: yes/.test(night) ? 'dark' : /Night mode: no/.test(night) ? 'light' : undefined;
        return {
            ...(appearance ? { appearance } : {}),
            textSize: nearestTextSize(Number.isFinite(scale) ? scale : 1),
            reduceMotion: animationOff,
            increaseContrast: contrast === '1',
            colorFilter: colorFilterOf(filterOn, filter),
            showBorders: layout === 'true',
            ...(probe.talkBack ? { voiceOver: services.split(':').includes(TALKBACK_SERVICE) } : {})
        };
    }

    async action(deviceId: string, action: DeviceAction): Promise<DeviceSettings> {
        const { serial, probe, emulator } = await this.booted(deviceId);
        switch (action.action) {
            case 'setAppearance':
                await this.shell(serial, `cmd uimode night ${action.value === 'dark' ? 'yes' : 'no'}`);
                break;
            case 'setTextSize':
                await this.shell(serial, `settings put system font_scale ${FONT_SCALES[action.value]}`);
                break;
            case 'setToggle':
                await this.toggle(serial, probe, action.setting, action.value);
                break;
            case 'setColorFilter':
                await this.shell(
                    serial,
                    action.value === 'none'
                        ? 'settings put secure accessibility_display_daltonizer_enabled 0'
                        : `settings put secure accessibility_display_daltonizer ${DALTONIZER[action.value]}; settings put secure accessibility_display_daltonizer_enabled 1`
                );
                break;
            case 'setLocation':
                if (!emulator) {
                    throw new DeviceError('device-action-unavailable', 'A phone takes a simulated location only from an app');
                }
                // The emulator console takes longitude first.
                await this.adb(this.sdk(), ['-s', serial, 'emu', 'geo', 'fix', String(action.longitude), String(action.latitude)]);
                break;
            case 'setPermission':
                await this.permission(serial, probe, requirePackage(action.appId), action.permission, action.decision);
                break;
            case 'openUrl': {
                const output = await this.shell(serial, `am start -a android.intent.action.VIEW -d ${shellQuote(action.url)}`);
                const failure = /^Error: .*$/m.exec(output);
                if (failure) {
                    throw new DeviceError('adb-failed', failure[0]);
                }
                break;
            }
            case 'launchApp':
                await this.shell(serial, `monkey -p ${shellQuote(requirePackage(action.appId))} -c android.intent.category.LAUNCHER 1`).catch(() => {
                    throw new DeviceError('adb-failed', `${action.appId} has no app to open on this device`);
                });
                break;
            case 'terminateApp':
                await this.shell(serial, `am force-stop ${shellQuote(requirePackage(action.appId))}`);
                break;
            case 'setLiquidGlass':
            case 'clearLocation':
            case 'sendPush':
                throw new DeviceError('device-action-unavailable', 'This tool does not exist on Android');
        }
        return this.detail(deviceId);
    }

    async screenshot(deviceId: string): Promise<Uint8Array> {
        const { serial } = await this.booted(deviceId);
        let result: Awaited<ReturnType<AndroidBytesRunner>>;
        try {
            result = await this.runBytes(this.sdk().adb, ['-s', serial, 'exec-out', 'screencap', '-p']);
        } catch {
            throw new DeviceError('adb-unavailable', 'adb could not be started');
        }
        if (result.exitCode !== 0 || result.stdout.byteLength === 0) {
            throw new DeviceError('device-capture-failed', result.stderr.trim() || 'adb could not capture the device screen');
        }
        return result.stdout;
    }

    async type(deviceId: string, text: string): Promise<void> {
        const script = typingScript(text);
        const { serial } = await this.booted(deviceId);
        await this.shell(serial, script);
    }

    createSource(deviceId: string): DeviceSource {
        const serial = this.serials.get(deviceId);
        if (serial === undefined) {
            throw new DeviceError('device-not-booted', 'Start the device before opening it');
        }
        if (this.createStreamSource === null) {
            throw new DeviceError('scrcpy-unavailable', 'The Android screen server is not installed beside Ruimte');
        }
        return this.createStreamSource(this.sdk().adb, serial);
    }

    private sdk(): AndroidSdk {
        this.located ??= this.locate();
        if (this.located === null) {
            throw new DeviceError('adb-unavailable', 'The Android SDK was not found on this machine');
        }
        return this.located;
    }

    private async connected(sdk: AndroidSdk): Promise<AdbEntry[]> {
        const entries = parseAdbDevices((await this.adb(sdk, ['devices', '-l'])).stdout);
        const present = new Set(entries.filter((entry) => entry.state === 'device').map((entry) => entry.serial));
        for (const serial of [...this.probes.keys()]) {
            if (!present.has(serial)) {
                this.probes.delete(serial);
            }
        }
        const listed = new Set(entries.map((entry) => entry.serial));
        const starting = new Set([...this.booting.values()].map((booting) => booting.serial));
        for (const serial of [...this.avdNames.keys()]) {
            if (!listed.has(serial) && !starting.has(serial)) {
                this.avdNames.delete(serial);
            }
        }
        return entries;
    }

    private async avdName(sdk: AndroidSdk, serial: string): Promise<string | null> {
        const known = this.avdNames.get(serial);
        if (known !== undefined) {
            return known;
        }
        const result = await this.run(sdk.adb, ['-s', serial, 'emu', 'avd', 'name']).catch(() => null);
        const name = result?.exitCode === 0 ? result.stdout.split('\n')[0]!.trim() : '';
        if (name === '' || name === 'OK' || name.startsWith('KO')) {
            return null;
        }
        this.avdNames.set(serial, name);
        return name;
    }

    /* What a device says about itself, asked in one shell and kept once it finished booting. */
    private async probe(sdk: AndroidSdk, serial: string): Promise<Probe | null> {
        const known = this.probes.get(serial);
        if (known) {
            return known;
        }
        const result = await this.run(sdk.adb, [
            '-s',
            serial,
            'shell',
            `getprop sys.boot_completed; getprop ro.product.model; getprop ro.build.version.sdk; pm path ${TALKBACK_PACKAGE} 2>/dev/null`
        ]).catch(() => null);
        if (result === null) {
            return null;
        }
        const lines = result.stdout.split('\n').map((line) => line.trim());
        const probe: Probe = {
            booted: lines[0] === '1',
            model: lines[1] ?? '',
            apiLevel: lines[2] ?? '',
            talkBack: lines.slice(3).some((line) => line.startsWith('package:'))
        };
        if (probe.booted) {
            this.probes.set(serial, probe);
        }
        return probe;
    }

    private async emulator(sdk: AndroidSdk, avd: AvdInfo, entry: AdbEntry | null): Promise<DeviceInfo> {
        let state: DeviceInfo['state'] = 'shutdown';
        let probe: Probe | null = null;
        if (entry !== null) {
            this.serials.set(avd.name, entry.serial);
            probe = entry.state === 'device' ? await this.probe(sdk, entry.serial) : null;
            state = probe?.booted ? 'booted' : 'transitioning';
        }
        const apiLevel = avd.apiLevel ?? (probe?.apiLevel || null);
        const streaming = this.createStreamSource !== null;
        return {
            deviceId: avd.name,
            backendId: this.id,
            platform: this.platform,
            kind: 'simulator',
            name: avd.displayName,
            runtime: apiLevel ? `API ${apiLevel}` : 'Android',
            state,
            capabilities: {
                boot: sdk.emulator !== null,
                shutdown: true,
                stream: streaming,
                input: streaming,
                screenshot: true,
                buttons: BUTTONS,
                tools: [...BASE_TOOLS, ...(probe?.talkBack ? (['voiceOver'] as const) : []), 'location'],
                permissions: PERMISSIONS
            }
        };
    }

    private async physical(sdk: AndroidSdk, entry: AdbEntry): Promise<DeviceInfo> {
        const probe = entry.state === 'device' ? await this.probe(sdk, entry.serial) : null;
        const ready = probe?.booted === true;
        if (ready) {
            this.serials.set(entry.serial, entry.serial);
        }
        const streaming = ready && this.createStreamSource !== null;
        return {
            deviceId: entry.serial,
            backendId: this.id,
            platform: this.platform,
            kind: 'physical',
            name: probe?.model || entry.model || 'Android device',
            runtime: probe?.apiLevel ? `API ${probe.apiLevel}` : 'Android',
            state: ready ? 'booted' : entry.state === 'device' ? 'transitioning' : 'shutdown',
            ...(entry.state === 'device' ? {} : { reason: entry.state }),
            capabilities: {
                boot: false,
                shutdown: false,
                stream: streaming,
                input: streaming,
                screenshot: ready,
                buttons: BUTTONS,
                tools: [...BASE_TOOLS, ...(probe?.talkBack ? (['voiceOver'] as const) : [])],
                permissions: PERMISSIONS
            }
        };
    }

    private async booted(deviceId: string): Promise<{ serial: string; probe: Probe; emulator: boolean }> {
        if (!this.serials.has(deviceId)) {
            await this.find(deviceId);
        }
        const serial = this.serials.get(deviceId);
        const probe = serial === undefined ? undefined : this.probes.get(serial);
        if (serial === undefined || probe === undefined) {
            throw new DeviceError('device-not-booted', 'Start the device before using its tools');
        }
        return { serial, probe, emulator: EMULATOR_SERIAL.test(serial) };
    }

    private async toggle(serial: string, probe: Probe, setting: string, value: boolean): Promise<void> {
        switch (setting) {
            case 'reduceMotion':
                await this.shell(serial, ANIMATION_SCALES.map((scale) => `settings put global ${scale} ${value ? 0 : 1}`).join('; '));
                return;
            case 'increaseContrast':
                await this.shell(serial, `settings put secure high_text_contrast_enabled ${value ? 1 : 0}`);
                return;
            case 'showBorders':
                // Only screens drawn after this pick it up; Android offers no way to redraw the ones already open.
                await this.shell(serial, `setprop debug.layout ${value}`);
                return;
            case 'voiceOver': {
                if (!probe.talkBack) {
                    throw new DeviceError('device-action-unavailable', 'TalkBack is not installed on this device');
                }
                const current = (await this.shell(serial, 'settings get secure enabled_accessibility_services')).trim();
                const services = current === 'null' || current === '' ? [] : current.split(':').filter((service) => service !== TALKBACK_SERVICE);
                const next = value ? [...services, TALKBACK_SERVICE] : services;
                await this.shell(
                    serial,
                    next.length === 0
                        ? 'settings delete secure enabled_accessibility_services'
                        : `settings put secure enabled_accessibility_services ${shellQuote(next.join(':'))}; settings put secure accessibility_enabled 1`
                );
                return;
            }
            default:
                throw new DeviceError('device-action-unavailable', 'This setting does not exist on Android');
        }
    }

    private async permission(serial: string, probe: Probe, appId: string, permission: DevicePermission, decision: 'grant' | 'revoke' | 'reset'): Promise<void> {
        const names = permissionsFor(permission, Number.parseInt(probe.apiLevel, 10) || 0);
        if (names.length === 0) {
            throw new DeviceError('device-action-unavailable', 'This permission does not exist on Android');
        }
        // An app asks for some of the permissions behind a choice and not always all of them, so one that applies is enough.
        const failures: string[] = [];
        for (const name of names) {
            const command =
                decision === 'reset'
                    ? `pm revoke ${shellQuote(appId)} ${name}; pm clear-permission-flags ${shellQuote(appId)} ${name} user-set user-fixed`
                    : `pm ${decision} ${shellQuote(appId)} ${name}`;
            await this.shell(serial, command).catch((error: unknown) => failures.push(error instanceof Error ? error.message : String(error)));
        }
        if (failures.length === names.length) {
            throw new DeviceError('adb-failed', failures[0]!);
        }
    }

    private async shell(serial: string, script: string): Promise<string> {
        return (await this.adb(this.sdk(), ['-s', serial, 'shell', script])).stdout;
    }

    private async adb(sdk: AndroidSdk, arguments_: string[]): Promise<CommandResult> {
        let result: CommandResult;
        try {
            result = await this.run(sdk.adb, arguments_);
        } catch {
            this.located = null;
            throw new DeviceError('adb-unavailable', 'adb could not be started');
        }
        if (result.exitCode !== 0) {
            throw new DeviceError('adb-failed', result.stderr.trim() || result.stdout.trim() || 'adb failed');
        }
        return result;
    }

    private async find(deviceId: string): Promise<DeviceInfo> {
        const device = (await this.list()).find((candidate) => candidate.deviceId === deviceId);
        if (!device) {
            throw new DeviceError('device-not-found', 'The Android device is no longer available');
        }
        return device;
    }
}

const nearestTextSize = (scale: number): DeviceTextSize =>
    (Object.entries(FONT_SCALES) as Array<[DeviceTextSize, number]>).reduce((best, candidate) =>
        Math.abs(candidate[1] - scale) < Math.abs(best[1] - scale) ? candidate : best
    )[0];

const colorFilterOf = (enabled: string, value: string): DeviceColorFilter | undefined => {
    if (enabled !== '1') {
        return 'none';
    }
    const match = (Object.entries(DALTONIZER) as Array<[Exclude<DeviceColorFilter, 'none'>, string]>).find(([, code]) => code === value);
    return match?.[0];
};

const requirePackage = (appId: string): string => {
    if (!PACKAGE_NAME.test(appId)) {
        throw new DeviceError('device-action-unavailable', `${appId} is not an Android package name`);
    }
    return appId;
};
