import { z } from 'zod';
import type { DeviceInfo } from '@ruimte/contracts';
import { DeviceError, type DeviceBackend, type DeviceSource } from './manager.ts';
import { capturePhysicalFrame, PhysicalScreenshotSource, type PhysicalFrameCapture } from './physical-screenshot-source.ts';
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

const defaultRunner: DevicectlRunner = async (arguments_) => {
    const process = Bun.spawn(['xcrun', 'devicectl', ...arguments_], { stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    return { exitCode, stdout, stderr };
};

export class IosPhysicalBackend implements DeviceBackend {
    readonly id = 'coredevice';
    readonly platform = 'ios' as const;
    readonly kinds = ['physical'] as const;
    private readonly capture: PhysicalFrameCapture;
    private readonly createLiveSource: PhysicalStreamSourceFactory | null;
    private readonly udids = new Map<string, string>();
    private readonly run: DevicectlRunner;

    constructor(
        run: DevicectlRunner = defaultRunner,
        capture: PhysicalFrameCapture = capturePhysicalFrame,
        createLiveSource: PhysicalStreamSourceFactory | null = null
    ) {
        this.run = run;
        this.capture = capture;
        this.createLiveSource = createLiveSource;
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
                    screenshot: paired && developerMode
                }
            };
        });
    }

    createSource(deviceId: string): DeviceSource {
        const udid = this.udids.get(deviceId);
        if (udid && this.createLiveSource) {
            return this.createLiveSource(deviceId, udid);
        }
        return new PhysicalScreenshotSource(deviceId, this.capture);
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
