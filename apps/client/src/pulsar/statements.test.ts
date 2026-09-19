import { describe, expect, test } from 'bun:test';
import { accessRequestMessage, type AccessRequestPayload } from '@ruimte/pulsar';
import { createClientKeyLoader, type KeyStore } from '@/endpoint/client-key';
import { verifySignature } from '@ruimte/pulsar/verify-web';
import { requestSignalAccess } from './statements';

const memoryStore = (): KeyStore => {
    let held: CryptoKeyPair | null = null;
    return { read: async () => held, write: async (pair) => void (held = pair) };
};

describe('requestSignalAccess', () => {
    test('asks with a fresh nonce signed by this client key, and carries the statement with the label', async () => {
        const key = (await createClientKeyLoader(memoryStore())())!;
        const asked: AccessRequestPayload[] = [];
        const request = async (payload: AccessRequestPayload) => {
            asked.push(payload);
            return {
                machineId: payload.machineId,
                clientPublicKey: payload.clientPublicKey,
                nonce: payload.nonce,
                issuedAt: 1,
                expiresAt: 2,
                signature: 's'.repeat(86)
            };
        };
        const first = await requestSignalAccess('machine-1', key, 'Ruimte on macOS', request);
        await requestSignalAccess('machine-1', key, 'Ruimte on macOS', request);

        expect(first).toEqual({ statement: expect.objectContaining({ machineId: 'machine-1', clientPublicKey: key.publicKey }), label: 'Ruimte on macOS' });
        expect(asked[0]!.nonce).toMatch(/^[A-Za-z0-9_-]{24}$/);
        expect(asked[1]!.nonce).not.toBe(asked[0]!.nonce);
        expect(await verifySignature(key.publicKey, accessRequestMessage('machine-1', key.publicKey, asked[0]!.nonce), asked[0]!.signature)).toBe(true);
    });

    test('a statement for another machine, key or nonce than the one asked for is not carried', async () => {
        const key = (await createClientKeyLoader(memoryStore())())!;
        for (const patch of [{ machineId: 'machine-2' }, { clientPublicKey: 'B'.repeat(43) }, { nonce: 'n'.repeat(24) }]) {
            const request = async (payload: AccessRequestPayload) => ({ ...payload, issuedAt: 1, expiresAt: 2, signature: 's'.repeat(86), ...patch });
            expect(requestSignalAccess('machine-1', key, 'x', request)).rejects.toThrow('for something else');
        }
    });
});
