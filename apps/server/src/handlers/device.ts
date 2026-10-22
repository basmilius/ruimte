import type { DeviceControl } from '../devices/control.ts';
import { DeviceError, type DeviceManager } from '../devices/manager.ts';
import type { Dispatcher } from '../dispatcher.ts';
import { captureFile, keepCapture, pngSize, writeCapture } from '../shots.ts';
import { streamingGate } from './streaming.ts';

export function registerDeviceHandlers(dispatcher: Dispatcher, devices: DeviceManager, streamingAllowed: () => boolean, home: string): void {
    const requireStreaming = streamingGate(streamingAllowed);

    dispatcher.register('device.list', () => {
        requireStreaming();
        return devices.survey();
    });
    dispatcher.register('device.boot', (payload) => {
        requireStreaming();
        return devices.boot(payload.backendId, payload.platform, payload.deviceId);
    });
    dispatcher.register('device.shutdown', (payload) => {
        requireStreaming();
        return devices.shutdown(payload.backendId, payload.platform, payload.deviceId);
    });
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
    dispatcher.register('device.action', async (payload) => {
        requireStreaming();
        return {
            backendId: payload.backendId,
            platform: payload.platform,
            deviceId: payload.deviceId,
            settings: await devices.action(payload)
        };
    });
    dispatcher.register('device.capture', async (payload) => {
        requireStreaming();
        const image = await devices.capture(payload.backendId, payload.platform, payload.deviceId);
        const size = pngSize(image);
        if (size === null) {
            throw new DeviceError('device-capture-failed', 'The device answered with a picture that is not a png');
        }
        return { path: await writeCapture(home, payload.deviceId, image), ...size };
    });
    // Not held to the streaming policy: the picture comes in, nothing of this machine's devices goes out.
    dispatcher.register('device.importCapture', async (payload) => {
        const image = new Uint8Array(Buffer.from(payload.data, 'base64'));
        const size = pngSize(image);
        if (size === null) {
            throw new DeviceError('device-capture-failed', 'The capture to keep is not a png');
        }
        return { path: await keepCapture(home, payload.deviceId, image), ...size };
    });
    dispatcher.register('device.clipboard', async (payload, client) => {
        requireStreaming();
        return { text: await devices.clipboard(payload.backendId, payload.platform, payload.deviceId, client.id, payload.text, payload.paste) };
    });
    dispatcher.register('device.record', async (payload) => {
        requireStreaming();
        if (payload.mode === 'start') {
            await devices.startRecording(payload.backendId, payload.platform, payload.deviceId, await captureFile(home, payload.deviceId, 'mp4'));
            return { recording: true };
        }
        return { recording: false, path: await devices.stopRecording(payload.backendId, payload.platform, payload.deviceId) };
    });
}

/* Not held to the streaming policy: they carry no picture, and a person pauses an agent from wherever they are. */
export function registerDeviceControlHandlers(dispatcher: Dispatcher, control: DeviceControl): void {
    dispatcher.register('device.operations', () => ({ devices: control.list() }));
    dispatcher.register('device.control', (payload) => control.control(payload, payload.mode));
}
