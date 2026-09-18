import { describe, expect, test } from 'bun:test';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';
import { DeviceInfoSchema, DeviceTargetPayloadSchema } from './device.ts';

describe('device contracts', () => {
    test('accepts a simulator identity and lifecycle state', () => {
        expect(
            DeviceInfoSchema.parse({
                deviceId: '8BCA442C-9449-42E4-846A-5E421C37BACE',
                backendId: 'simctl',
                platform: 'ios',
                kind: 'simulator',
                name: 'iPhone 18 Pro',
                runtime: 'iOS 27.0',
                state: 'shutdown',
                capabilities: { boot: true, shutdown: true, stream: true, input: true, screenshot: true }
            })
        ).toMatchObject({ platform: 'ios', state: 'shutdown' });
    });

    test('requires the platform on lifecycle requests', () => {
        expect(DeviceTargetPayloadSchema.safeParse({ deviceId: 'phone-1' }).success).toBe(false);
    });

    test('keeps pointer coordinates independent from the rendered view size', () => {
        expect(
            REQUEST_SCHEMAS['device.input'].payload.safeParse({
                platform: 'ios',
                backendId: 'simctl',
                deviceId: 'phone-1',
                input: { kind: 'pointer', phase: 'move', x: 0.25, y: 0.75 }
            }).success
        ).toBe(true);
        expect(
            REQUEST_SCHEMAS['device.input'].payload.safeParse({
                platform: 'ios',
                backendId: 'simctl',
                deviceId: 'phone-1',
                input: { kind: 'pointer', phase: 'move', x: 2, y: 0.75 }
            }).success
        ).toBe(false);
        expect(
            REQUEST_SCHEMAS['device.input'].payload.safeParse({
                platform: 'ios',
                backendId: 'simctl',
                deviceId: 'phone-1',
                input: { kind: 'pointer', phase: 'down', x: 0.5, y: 0.97, edge: 'bottom' }
            }).success
        ).toBe(true);
    });

    test('accepts scroll, multi-touch and system gestures with bounded coordinates', () => {
        const target = { platform: 'ios', backendId: 'simctl', deviceId: 'phone-1' } as const;
        expect(
            REQUEST_SCHEMAS['device.input'].payload.safeParse({
                ...target,
                input: { kind: 'scroll', deltaX: 14, deltaY: -32, x: 0.4, y: 0.6 }
            }).success
        ).toBe(true);
        expect(
            REQUEST_SCHEMAS['device.input'].payload.safeParse({
                ...target,
                input: { kind: 'multiPointer', phase: 'move', first: { x: 0.2, y: 0.5 }, second: { x: 0.8, y: 0.5 } }
            }).success
        ).toBe(true);
        expect(REQUEST_SCHEMAS['device.input'].payload.safeParse({ ...target, input: { kind: 'button', button: 'appSwitcher' } }).success).toBe(true);
        expect(
            REQUEST_SCHEMAS['device.input'].payload.safeParse({
                ...target,
                input: { kind: 'multiPointer', phase: 'move', first: { x: -0.1, y: 0.5 }, second: { x: 0.8, y: 0.5 } }
            }).success
        ).toBe(false);
    });

    test('supports HTTP and replaceable event streams', () => {
        expect(REQUEST_SCHEMAS['device.open'].payload.safeParse({ backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', stream: 'http' }).success).toBe(
            true
        );
        expect(REQUEST_SCHEMAS['device.open'].payload.safeParse({ backendId: 'simctl', platform: 'ios', deviceId: 'phone-1', stream: 'events' }).success).toBe(
            true
        );
        expect(
            EVENT_SCHEMAS['device.frame'].safeParse({
                deviceId: 'phone-1',
                backendId: 'simctl',
                platform: 'ios',
                sequence: 1,
                width: 1179,
                height: 2556,
                data: 'AQID'
            }).success
        ).toBe(true);
    });

    test('validates simulator settings and typed actions', () => {
        expect(
            REQUEST_SCHEMAS['device.action'].payload.safeParse({
                backendId: 'simctl',
                platform: 'ios',
                deviceId: 'phone-1',
                action: 'setLocation',
                latitude: 52.3676,
                longitude: 4.9041
            }).success
        ).toBe(true);
        expect(
            REQUEST_SCHEMAS['device.action'].payload.safeParse({
                backendId: 'simctl',
                platform: 'ios',
                deviceId: 'phone-1',
                action: 'setLocation',
                latitude: 120,
                longitude: 4.9041
            }).success
        ).toBe(false);
        expect(
            REQUEST_SCHEMAS['device.action'].payload.safeParse({
                backendId: 'simctl',
                platform: 'ios',
                deviceId: 'phone-1',
                action: 'setPermission',
                appId: 'com.example.app',
                permission: 'camera',
                decision: 'grant'
            }).success
        ).toBe(true);
    });
});
