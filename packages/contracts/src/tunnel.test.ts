import { describe, expect, test } from 'bun:test';
import { TunnelAddPayloadSchema, TunnelRowSchema, TunnelUpdatePayloadSchema } from './tunnel.ts';

const ROW = { id: 'a', kind: 'dev', hostname: 'passly.bmnw.nl', port: 443, enabled: true, comeBack: false } as const;

describe('the origin of a tunnel row', () => {
    test('is optional on a row, and carries https, a host header and the certificate settings', () => {
        const origin = { https: true, hostHeader: 'passly.test:443', noTlsVerify: true, serverName: 'passly.test' };

        expect(TunnelRowSchema.parse(ROW)).toEqual(ROW);
        expect(TunnelRowSchema.parse({ ...ROW, origin }).origin).toEqual(origin);
    });

    test('travels on add and update, with a new port on update', () => {
        expect(TunnelAddPayloadSchema.parse({ kind: 'dev', zone: 'z', label: 'passly', port: 80, origin: { hostHeader: 'passly.test' } }).origin).toEqual({
            hostHeader: 'passly.test'
        });
        expect(TunnelUpdatePayloadSchema.parse({ id: 'a', port: 8443, origin: {} })).toEqual({ id: 'a', port: 8443, origin: {} });
    });

    test('refuses an empty or overlong host header', () => {
        expect(TunnelRowSchema.safeParse({ ...ROW, origin: { hostHeader: '' } }).success).toBe(false);
        expect(TunnelRowSchema.safeParse({ ...ROW, origin: { hostHeader: 'a'.repeat(260) } }).success).toBe(false);
    });
});
