import { describe, expect, test } from 'bun:test';
import { LAN_DOOR_PATH, LanDoorSchema, lanDoorUrl } from './index.ts';

describe('the LAN door', () => {
    test('is a port and the addresses it listens on', () => {
        expect(LanDoorSchema.safeParse({ port: 4210, addresses: ['192.168.1.4'] }).success).toBe(true);
        expect(LanDoorSchema.safeParse({ port: 0, addresses: [] }).success).toBe(false);
        expect(LanDoorSchema.safeParse({ port: 65_536, addresses: [] }).success).toBe(false);
        expect(LanDoorSchema.safeParse({ port: 4210, addresses: [''] }).success).toBe(false);
        expect(LanDoorSchema.safeParse({ port: 4210, addresses: Array.from({ length: 17 }, () => '10.0.0.1') }).success).toBe(false);
    });

    test('is dialed at its path, an IPv6 address in brackets', () => {
        expect(lanDoorUrl('192.168.1.4', 4210)).toBe(`ws://192.168.1.4:4210${LAN_DOOR_PATH}`);
        expect(lanDoorUrl('fe80::1', 4210)).toBe(`ws://[fe80::1]:4210${LAN_DOOR_PATH}`);
    });
});
