import type { Area } from '../area.ts';
import type { DeviceControl } from '../devices/control.ts';
import { DeviceError } from '../devices/device-error.ts';
import type { DeviceWatch } from '../devices/device-watch.ts';
import { type DeviceManager } from '../devices/manager.ts';
import type { Dispatcher } from '../dispatcher.ts';
import { captureFile, keepCapture, pngSize, writeCapture } from '../shots.ts';
import { streamingGate } from '../streams/streaming-gate.ts';

export interface DeviceDeps {
    devices: DeviceManager;
    control: DeviceControl;
    watch: DeviceWatch;
    streamingAllowed(): boolean;
    home: string;
}

export function deviceArea(deps: DeviceDeps): Area {
    const { devices, control, watch } = deps;

    return {
        name: 'device',
        sources: [devices, control, watch],
        holders: [devices],
        handlers: (dispatcher) => {
            registerRequests(dispatcher, deps);
            registerControlRequests(dispatcher, control);
            registerWatchRequests(dispatcher, watch);
        },
        stop: [
            { phase: 'end', label: 'Stopping device control', run: () => control.stop() },
            { phase: 'end', label: 'Stopping the device watch', run: () => watch.stop() },
            { phase: 'end', label: 'Closing devices', run: () => devices.closeAll() }
        ]
    };
}

function registerRequests(dispatcher: Dispatcher, { devices, streamingAllowed, home }: DeviceDeps): void {
    const requireStreaming = streamingGate(streamingAllowed);

    dispatcher.register('device.list', () => {
        requireStreaming();
        return devices.survey();
    });
    dispatcher.register(
        'device.boot',
        (payload) => {
            requireStreaming();
            return devices.boot(payload.backendId, payload.platform, payload.deviceId);
        },
        { count: ['actions.device', 'devices.started'] }
    );
    dispatcher.register(
        'device.shutdown',
        (payload) => {
            requireStreaming();
            return devices.shutdown(payload.backendId, payload.platform, payload.deviceId);
        },
        { count: ['actions.device'] }
    );
    dispatcher.register('device.open', (payload, client) => {
        requireStreaming();
        return devices.open(payload.backendId, payload.platform, payload.deviceId, client.id, payload.stream, payload.formats, payload.binary);
    });
    // Detach lets a client clean up after the policy changed, so it stays open.
    dispatcher.register('device.detach', (payload, client) => {
        devices.detach(payload.backendId, payload.deviceId, client.id);
        return {};
    });
    dispatcher.register('device.input', async (payload, client) => {
        requireStreaming();
        await devices.input(payload.backendId, payload.deviceId, client.id, payload.input);
        return {};
    });
    dispatcher.register('device.detail', async (payload) => {
        requireStreaming();
        return { ...payload, settings: await devices.detail(payload.backendId, payload.platform, payload.deviceId) };
    });
    dispatcher.register('device.power', async (payload) => {
        requireStreaming();
        return { power: await devices.power(payload.backendId, payload.platform, payload.deviceId) };
    });
    dispatcher.register(
        'device.action',
        async (payload) => {
            requireStreaming();
            return {
                backendId: payload.backendId,
                platform: payload.platform,
                deviceId: payload.deviceId,
                settings: await devices.action(payload)
            };
        },
        { count: ['actions.device'] }
    );
    dispatcher.register(
        'device.capture',
        async (payload) => {
            requireStreaming();
            const image = await devices.capture(payload.backendId, payload.platform, payload.deviceId);
            const size = pngSize(image);
            if (size === null) {
                throw new DeviceError('device-capture-failed', 'The device answered with a picture that is not a png');
            }
            return { path: await writeCapture(home, payload.deviceId, image), ...size };
        },
        { count: ['actions.device'] }
    );
    // Not held to the streaming policy: the picture comes in, nothing of this machine's devices goes out.
    dispatcher.register('device.importCapture', async (payload) => {
        const image = new Uint8Array(Buffer.from(payload.data, 'base64'));
        const size = pngSize(image);
        if (size === null) {
            throw new DeviceError('device-capture-failed', 'The capture to keep is not a png');
        }
        return { path: await keepCapture(home, payload.deviceId, image), ...size };
    });
    dispatcher.register(
        'device.clipboard',
        async (payload, client) => {
            requireStreaming();
            return { text: await devices.clipboard(payload.backendId, payload.platform, payload.deviceId, client.id, payload.text, payload.paste) };
        },
        { count: ['actions.device'] }
    );
    dispatcher.register(
        'device.record',
        async (payload) => {
            requireStreaming();
            if (payload.mode === 'start') {
                await devices.startRecording(payload.backendId, payload.platform, payload.deviceId, await captureFile(home, payload.deviceId, 'mp4'));
                return { recording: true };
            }
            return { recording: false, path: await devices.stopRecording(payload.backendId, payload.platform, payload.deviceId) };
        },
        { count: ['actions.device'] }
    );
}

/* Not held to the streaming policy either: the event carries nothing of a device, only that the list changed. */
function registerWatchRequests(dispatcher: Dispatcher, watch: DeviceWatch): void {
    dispatcher.register('device.watch', (_payload, client) => {
        // A channel that went while this was on its way would leave a watch nobody hears.
        if (client.closed !== true) {
            watch.watch(client.id);
        }
        return {};
    });
    dispatcher.register('device.unwatch', (_payload, client) => {
        watch.unwatch(client.id);
        return {};
    });
}

/* Not held to the streaming policy: they carry no picture, and a person pauses an agent from wherever they are. */
function registerControlRequests(dispatcher: Dispatcher, control: DeviceControl): void {
    dispatcher.register('device.operations', () => ({ devices: control.list() }));
    dispatcher.register('device.control', (payload) => control.control(payload, payload.mode));
}
