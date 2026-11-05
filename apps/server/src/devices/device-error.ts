import { CodedError } from '@adecore/agents';

/* Every code a device failure reaches a client with, the helper's own among them. */
export const DEVICE_ERROR_CODES = [
    'device-action-unavailable',
    'device-capture-failed',
    'device-capture-unavailable',
    'device-input-unavailable',
    'device-not-booted',
    'device-not-found',
    'device-not-open',
    'device-tools-unavailable',
    'platform-unavailable',
    'invalid-devicectl-output',
    'invalid-simctl-output',
    'devicectl-failed',
    'devicectl-unavailable',
    'simctl-failed',
    'simctl-unavailable',
    'device-helper-exited',
    'device-helper-failed',
    'device-helper-native',
    'device-helper-protocol',
    'device-helper-running',
    'device-helper-unavailable',
    'device-not-streaming',
    'device-tree-failed',
    'device-tree-unavailable',
    'device-format-unsupported',
    'adb-unavailable',
    'adb-failed',
    'invalid-adb-output',
    'emulator-unavailable',
    'emulator-failed',
    'scrcpy-unavailable',
    'scrcpy-failed',
    'scrcpy-protocol',
    'device-path-refused',
    'device-recording',
    'device-not-recording',
    'device-must-be-shut-down'
] as const;

type DeviceErrorCode = (typeof DEVICE_ERROR_CODES)[number];

export function isDeviceErrorCode(code: string): code is DeviceErrorCode {
    return (DEVICE_ERROR_CODES as readonly string[]).includes(code);
}

export class DeviceError extends CodedError<DeviceErrorCode> {}
