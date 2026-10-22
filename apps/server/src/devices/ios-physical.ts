import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { DeviceAction, DeviceInfo, DevicePower, DeviceSettings } from '@ruimte/contracts';
import { requireExtension } from './device-paths.ts';
import { DeviceError, type DeviceBackend, type DeviceSource } from './manager.ts';
import {
    capturePhysicalFrame,
    capturePhysicalScreenshot,
    PhysicalScreenshotSource,
    type PhysicalFrameCapture,
    type PhysicalScreenshot
} from './physical-screenshot-source.ts';
import type { PhysicalStreamSourceFactory } from './physical-stream-source.ts';

interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export type DevicectlRunner = (arguments_: string[]) => Promise<CommandResult>;

const PhysicalDeviceSchema = z.object({
    identifier: z.string().min(1),
    properties: z.object({
        connection: z
            .object({
                pairingState: z.string().optional()
            })
            .optional(),
        hardware: z.object({
            platform: z.string(),
            reality: z.string().optional(),
            udid: z.string().min(1).optional(),
            marketingName: z.string().optional()
        }),
        software: z
            .object({
                osVersionNumber: z.object({ stringValue: z.string().min(1) }).optional()
            })
            .optional(),
        state: z.object({
            bootState: z.string().optional(),
            name: z.string().min(1).optional(),
            developerModeStatus: z
                .object({
                    enabled: z.object({ mode: z.number() }).optional()
                })
                .optional()
        })
    })
});

const PhysicalDeviceListSchema = z.object({ result: z.object({ devices: z.array(PhysicalDeviceSchema) }) });

/* The line the bridge's `battery` prints, from lockdown's battery domain. */
const BridgeBatterySchema = z.object({ level: z.number().int().min(0).max(100), charging: z.boolean(), plugged: z.boolean() });

/* Asks the phone with this hardware udid for its battery and answers the bridge's JSON line; throws when it could not. */
export type PhysicalBatteryReader = (udid: string) => Promise<string>;

// The bridge gives up after its own timeout; this only ends a bridge that hangs past it.
const BATTERY_BRIDGE_TIMEOUT_SECONDS = 10;
const BATTERY_KILL_MS = 15_000;

export function createPhysicalBatteryReader(helper: string): PhysicalBatteryReader | null {
    if (!existsSync(helper)) {
        return null;
    }
    return async (udid) => {
        const process = Bun.spawn([helper, 'battery', '--udid', udid, '--timeout', String(BATTERY_BRIDGE_TIMEOUT_SECONDS)], {
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: BATTERY_KILL_MS
        });
        const [exitCode, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
        if (exitCode !== 0) {
            throw new Error(stderr.trim() || 'The phone did not say its battery');
        }
        return stdout;
    };
}

async function defaultRunner(arguments_: string[]): Promise<CommandResult> {
    const process = Bun.spawn(['xcrun', 'devicectl', ...arguments_], { stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    return { exitCode, stdout, stderr };
}

export class IosPhysicalBackend implements DeviceBackend {
    readonly id = 'coredevice';
    readonly platform = 'ios' as const;
    readonly kinds = ['physical'] as const;
    private readonly captureFrame: PhysicalFrameCapture;
    private readonly createLiveSource: PhysicalStreamSourceFactory | null;
    private readonly photograph: PhysicalScreenshot;
    private readonly udids = new Map<string, string>();
    private readonly run: DevicectlRunner;
    private readonly readBattery: PhysicalBatteryReader | null;

    constructor(
        run: DevicectlRunner = defaultRunner,
        capture: PhysicalFrameCapture = capturePhysicalFrame,
        createLiveSource: PhysicalStreamSourceFactory | null = null,
        photograph: PhysicalScreenshot = capturePhysicalScreenshot,
        readBattery: PhysicalBatteryReader | null = null
    ) {
        this.run = run;
        this.captureFrame = capture;
        this.createLiveSource = createLiveSource;
        this.photograph = photograph;
        this.readBattery = readBattery;
    }

    /* Null without the bridge, for a phone the last list did not hold, and for an answer that is not the bridge's line. */
    async power(deviceId: string): Promise<DevicePower | null> {
        const udid = this.udids.get(deviceId);
        if (this.readBattery === null || udid === undefined) {
            return null;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(await this.readBattery(udid));
        } catch {
            return null;
        }
        const battery = BridgeBatterySchema.safeParse(parsed);
        return battery.success ? battery.data : null;
    }

    async list(): Promise<DeviceInfo[]> {
        const result = await this.command([
            'list',
            'devices',
            '--filter',
            "properties.hardware.platform = 'iOS' AND properties.hardware.reality = 'physical'",
            '--json-output',
            '-',
            '--omit-deprecated-fields-in-json',
            '--quiet',
            '--timeout',
            '10'
        ]);
        let json: unknown;
        try {
            json = JSON.parse(result.stdout);
        } catch {
            throw new DeviceError('invalid-devicectl-output', 'devicectl returned a device list Ruimte could not read');
        }
        const parsed = PhysicalDeviceListSchema.safeParse(json);
        if (!parsed.success) {
            throw new DeviceError('invalid-devicectl-output', 'devicectl returned a device list Ruimte could not read');
        }
        this.udids.clear();
        return parsed.data.result.devices.map(({ identifier, properties }) => {
            if (properties.hardware.udid) {
                this.udids.set(identifier, properties.hardware.udid);
            }
            const paired = properties.connection?.pairingState === 'paired';
            const developerMode = properties.state.developerModeStatus?.enabled?.mode === 1;
            return {
                deviceId: identifier,
                backendId: this.id,
                platform: this.platform,
                kind: 'physical' as const,
                name: properties.state.name ?? properties.hardware.marketingName ?? 'iOS Device',
                runtime: properties.software?.osVersionNumber?.stringValue ? `iOS ${properties.software.osVersionNumber.stringValue}` : 'iOS',
                state: paired && properties.state.bootState === 'booted' ? ('booted' as const) : ('shutdown' as const),
                capabilities: {
                    boot: false,
                    shutdown: false,
                    stream: paired && developerMode,
                    input: paired && developerMode && this.createLiveSource !== null,
                    screenshot: paired && developerMode,
                    tools: paired && developerMode ? ['capture', 'installApp'] : []
                }
            };
        });
    }

    createSource(deviceId: string): DeviceSource {
        const udid = this.udids.get(deviceId);
        if (udid && this.createLiveSource) {
            return this.createLiveSource(deviceId, udid);
        }
        return new PhysicalScreenshotSource(deviceId, this.captureFrame);
    }

    screenshot(deviceId: string): Promise<Uint8Array> {
        return this.photograph(deviceId);
    }

    /* A phone has no settings Ruimte reads; its tools only act. */
    detail(): Promise<DeviceSettings> {
        return Promise.resolve({});
    }

    /* An iPhone installs an app and does nothing else Ruimte asks. */
    async action(deviceId: string, action: DeviceAction): Promise<DeviceSettings> {
        if (action.action !== 'installApp') {
            throw new DeviceError('device-action-unavailable', 'An iPhone takes no other tool from Ruimte');
        }
        requireExtension(action.path, ['.app', '.ipa'], 'an .app or an .ipa signed for it');
        await this.command(['device', 'install', 'app', '--device', deviceId, action.path]);
        return {};
    }

    private async command(arguments_: string[]): Promise<CommandResult> {
        let result: CommandResult;
        try {
            result = await this.run(arguments_);
        } catch {
            throw new DeviceError('devicectl-unavailable', 'Xcode and devicectl are required for physical iOS devices');
        }
        if (result.exitCode !== 0) {
            throw new DeviceError('devicectl-failed', result.stderr.trim() || 'devicectl failed');
        }
        return result;
    }
}
