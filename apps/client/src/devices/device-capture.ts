import type { DeviceCaptureResult, DeviceInfo } from '@ruimte/contracts';
import i18next from 'i18next';
import { createViewAction, placeViewOnCanvasAction } from '@/actions/client-actions';
import { base64Of } from '@/base64';
import { recordingKey, useDevices } from '@/devices/state';
import { downloadBlob } from '@/download';
import { canvasInReach } from '@/state/canvas-target';
import { useDocument } from '@/state/document';
import { deviceClientFor } from '@/transport/connections';
import { machineAnswers } from '@/transport/features';
import { readMachineFile } from '@/transport/machine-url';
import { windowWorkspace } from '@/transport/window';

const SCREENSHOT_MAX_BYTES = 64 * 1024 * 1024;
const RECORDING_MAX_BYTES = 1024 * 1024 * 1024;
// What one `device.importCapture` frame carries once in base64, which is the size of a device's live frame.
const IMPORT_MAX_BYTES = 8 * 1024 * 1024;

type Device = Pick<DeviceInfo, 'backendId' | 'platform' | 'deviceId' | 'name'>;

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/*
 * The name a capture is saved under, the way a Mac names a screenshot. It is a file name and not text
 * on screen, so it keeps one order that sorts and no character a file system refuses.
 */
function captureFileName(deviceName: string, at: Date, extension: 'png' | 'mp4'): string {
    const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
    const time = `${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`;
    return `${deviceName.replace(/[/\\:]/g, '-')} ${day} at ${time}.${extension}`;
}

/* A capture's file is new and never changes, so its path alone pins the version. */
async function readCapture(endpointId: string, path: string, maxBytes: number, type: string): Promise<Blob> {
    return new Blob([await readMachineFile(endpointId, { path, mtime: 0, size: 0 }, maxBytes)], { type });
}

function requireClient(endpointId: string) {
    const client = deviceClientFor(endpointId);
    if (!client) {
        throw new Error(i18next.t('machines:connection.unknownMachine'));
    }
    return client;
}

export async function copyScreenshot(endpointId: string, device: Device): Promise<void> {
    const client = requireClient(endpointId);
    // The clipboard takes a promise, so the page's permission to write it holds while the machine answers.
    const blob = client.capture(device).then((capture) => readCapture(endpointId, capture.path, SCREENSHOT_MAX_BYTES, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function saveScreenshot(endpointId: string, device: Device, now: () => Date = () => new Date()): Promise<void> {
    const capture = await requireClient(endpointId).capture(device);
    downloadBlob(await readCapture(endpointId, capture.path, SCREENSHOT_MAX_BYTES, 'image/png'), captureFileName(device.name, now(), 'png'));
}

/* False when no canvas is in reach to put it on. */
export async function placeScreenshotOnCanvas(endpointId: string, device: Device): Promise<boolean> {
    // Chosen before the view is made, since the new view opens over the focused cell.
    const target = canvasInReach(useDocument.getState());
    if (target === null) {
        return false;
    }
    const capture = await requireClient(endpointId).capture(device);
    const path = await onWorkspaceMachine(endpointId, device, capture);
    const id = await createViewAction('file', { path, name: captureFileName(device.name, new Date(), 'png') });
    if (id !== null) {
        placeViewOnCanvasAction(id, target.id);
    }
    return true;
}

/*
 * The path of the capture kept on the machine of the open project, which is where a file view reads, and
 * where no sweep of passing captures reaches it. A device of another machine took it there.
 */
async function onWorkspaceMachine(endpointId: string, device: Device, capture: DeviceCaptureResult): Promise<string> {
    const workspace = windowWorkspace();
    if (workspace === null) {
        return capture.path;
    }
    const { transport } = workspace.connection;
    if (!machineAnswers(transport.connection, 'device.importCapture')) {
        if (workspace.connection.endpointId === endpointId) {
            return capture.path;
        }
        throw new Error(i18next.t('machines:device.tools.capture.placeUnsupported'));
    }
    const bytes = new Uint8Array(await readMachineFile(endpointId, { path: capture.path, mtime: 0, size: 0 }, IMPORT_MAX_BYTES));
    if (bytes.byteLength > IMPORT_MAX_BYTES) {
        throw new Error(i18next.t('machines:device.tools.capture.placeTooLarge'));
    }
    const kept = await transport.request('device.importCapture', { deviceId: device.deviceId, data: base64Of(bytes) });
    return kept.path;
}

export async function startRecording(endpointId: string, device: Device, now: () => number = Date.now): Promise<void> {
    await requireClient(endpointId).record(device, 'start');
    useDevices.getState().markRecording(recordingKey(endpointId, device), now());
}

/* Ends the recording and hands the video to the browser's download at once. */
export async function stopRecording(endpointId: string, device: Device): Promise<void> {
    const result = await requireClient(endpointId)
        .record(device, 'stop')
        .finally(() => useDevices.getState().markRecording(recordingKey(endpointId, device), null));
    if (result.path !== undefined) {
        downloadBlob(await readCapture(endpointId, result.path, RECORDING_MAX_BYTES, 'video/mp4'), captureFileName(device.name, new Date(), 'mp4'));
    }
}
