import { describe, expect, test } from 'bun:test';
import { concatBytes } from './device-test-helpers.ts';
import { DEVICE_HELPER_MAGIC, DeviceHelperDecoder, encodeDeviceHelperMessage } from './helper-protocol.ts';
import { runDeviceHelper, type DeviceNativeAddon } from './native-helper.ts';

describe('runDeviceHelper', () => {
    test('streams MJPEG frames and translates protocol input into native HID calls', async () => {
        const calls: unknown[][] = [];
        const output: Uint8Array[] = [];
        const addon = {
            SimHID: class {
                constructor(deviceId: string, duoHidPath: string) {
                    calls.push(['hid', deviceId, duoHidPath]);
                }

                async touch(...arguments_: unknown[]): Promise<void> {
                    calls.push(['touch', ...arguments_]);
                }

                async multiTouch(...arguments_: unknown[]): Promise<void> {
                    calls.push(['multiTouch', ...arguments_]);
                }

                async scroll(...arguments_: unknown[]): Promise<void> {
                    calls.push(['scroll', ...arguments_]);
                }

                async button(button: string): Promise<void> {
                    calls.push(['button', button]);
                }

                async orientation(orientation: number): Promise<boolean> {
                    calls.push(['orientation', orientation]);
                    return true;
                }

                async key(type: 'down' | 'up', usage: number): Promise<void> {
                    calls.push(['key', type, usage]);
                }

                async buttonHid(...arguments_: unknown[]): Promise<void> {
                    calls.push(['buttonHid', ...arguments_]);
                }

                async memoryWarning(): Promise<void> {
                    calls.push(['memoryWarning']);
                }

                async softwareKeyboard(): Promise<void> {
                    calls.push(['softwareKeyboard']);
                }

                async isFoldable(): Promise<boolean> {
                    return false;
                }

                async pose(...arguments_: unknown[]): Promise<boolean> {
                    calls.push(['pose', ...arguments_]);
                    return true;
                }

                async hinge(degrees: number): Promise<boolean> {
                    calls.push(['hinge', degrees]);
                    return true;
                }

                async close(): Promise<void> {
                    calls.push(['close']);
                }
            },
            SimCapture: class {
                private frame: ((data: Uint8Array, width: number, height: number, flags: number) => Promise<void>) | null = null;

                constructor(deviceId: string) {
                    calls.push(['capture', deviceId]);
                }

                async subscribe(codec: number, frame: (data: Uint8Array, width: number, height: number, flags: number) => Promise<void>): Promise<() => void> {
                    calls.push(['subscribe', codec]);
                    this.frame = frame;
                    return () => calls.push(['unsubscribe']);
                }

                async start(): Promise<void> {
                    calls.push(['start']);
                    await this.frame?.(new Uint8Array([0xff, 0xd8, 0xff]), 1179, 2556, 0);
                }

                async stop(): Promise<void> {
                    calls.push(['stop']);
                }

                async setPreferredScreenSize(width: number, height: number): Promise<void> {
                    calls.push(['setPreferredScreenSize', width, height]);
                }
            }
        } satisfies DeviceNativeAddon;
        const input = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    concatBytes(
                        DEVICE_HELPER_MAGIC,
                        encodeDeviceHelperMessage({ type: 'input', input: { kind: 'pointer', phase: 'down', x: 0.25, y: 0.75, edge: 'bottom' } }),
                        encodeDeviceHelperMessage({
                            type: 'input',
                            input: { kind: 'multiPointer', phase: 'move', first: { x: 0.2, y: 0.5 }, second: { x: 0.8, y: 0.5 } }
                        }),
                        encodeDeviceHelperMessage({ type: 'input', input: { kind: 'scroll', deltaX: 12, deltaY: -30, x: 0.4, y: 0.6 } }),
                        encodeDeviceHelperMessage({ type: 'input', input: { kind: 'button', button: 'appSwitcher' } }),
                        encodeDeviceHelperMessage({ type: 'input', input: { kind: 'rotate', direction: 'left' } }),
                        encodeDeviceHelperMessage({ type: 'keys', usages: [0xe3, 0x19] }),
                        encodeDeviceHelperMessage({ type: 'input', input: { kind: 'key', phase: 'down', usage: 0x04 } }),
                        encodeDeviceHelperMessage({ type: 'input', input: { kind: 'button', button: 'volumeUp' } }),
                        encodeDeviceHelperMessage({ type: 'call', id: 7, call: { method: 'memoryWarning' } }),
                        encodeDeviceHelperMessage({ type: 'call', id: 8, call: { method: 'pose', name: 'book', fromDegrees: 180 } }),
                        encodeDeviceHelperMessage({ type: 'stop' })
                    )
                );
                controller.close();
            }
        });

        expect(await runDeviceHelper('phone-1', { addon, duoHidPath: '/native/serve-sim-duo-hid', input, write: (bytes) => output.push(bytes.slice()) })).toBe(
            0
        );
        expect(new DeviceHelperDecoder().push(concatBytes(...output))).toEqual([
            { type: 'ready', width: 1179, height: 2556 },
            { type: 'frame', frame: { sequence: 0, width: 1179, height: 2556, data: new Uint8Array([0xff, 0xd8, 0xff]) } },
            { type: 'reply', id: 7, ok: true },
            { type: 'reply', id: 8, ok: true, value: true }
        ]);
        expect(calls).toEqual([
            ['hid', 'phone-1', '/native/serve-sim-duo-hid'],
            ['capture', 'phone-1'],
            ['subscribe', 0],
            ['start'],
            ['touch', 'begin', 0.25, 0.75, 1179, 2556, 3],
            ['multiTouch', 'move', 0.2, 0.5, 0.8, 0.5, 1179, 2556],
            ['scroll', 12, -30, 0.4, 0.6, 1179, 2556],
            ['button', 'app_switcher'],
            ['orientation', 4],
            ['key', 'down', 0xe3],
            ['key', 'down', 0x19],
            ['key', 'up', 0x19],
            ['key', 'up', 0xe3],
            ['key', 'down', 0x04],
            ['buttonHid', 0x0c, 0xe9, 'press'],
            ['memoryWarning'],
            ['pose', 'book', 180],
            ['unsubscribe'],
            ['stop']
        ]);
    });

    test('reports native startup failures over the binary protocol', async () => {
        const output: Uint8Array[] = [];
        const addon = {
            SimHID: class {
                touch = async (): Promise<void> => undefined;
                multiTouch = async (): Promise<void> => undefined;
                scroll = async (): Promise<void> => undefined;
                button = async (): Promise<void> => undefined;
                orientation = async (): Promise<boolean> => true;
                key = async (): Promise<void> => undefined;
                buttonHid = async (): Promise<void> => undefined;
                memoryWarning = async (): Promise<void> => undefined;
                softwareKeyboard = async (): Promise<void> => undefined;
                isFoldable = async (): Promise<boolean> => false;
                pose = async (): Promise<boolean> => true;
                hinge = async (): Promise<boolean> => true;
                close = async (): Promise<void> => undefined;
            },
            SimCapture: class {
                subscribe = async (): Promise<() => void> => () => undefined;
                start = async (): Promise<void> => {
                    throw new Error('CoreSimulator capture unavailable');
                };
                stop = async (): Promise<void> => undefined;
                setPreferredScreenSize = async (): Promise<void> => undefined;
            }
        } satisfies DeviceNativeAddon;

        expect(
            await runDeviceHelper('phone-1', {
                addon,
                input: new ReadableStream(),
                write: (bytes) => output.push(bytes.slice())
            })
        ).toBe(1);
        expect(new DeviceHelperDecoder().push(concatBytes(...output))).toEqual([
            { type: 'error', code: 'device-helper-native', message: 'CoreSimulator capture unavailable' }
        ]);
    });
});
