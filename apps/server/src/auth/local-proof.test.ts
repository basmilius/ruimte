import { describe, expect, test } from 'bun:test';
import { isLocalProof, MACHINE_PROOF_PATH } from '@ruimte/contracts';
import { handleLocalProofRequest } from './local-proof.ts';

const ask = (init: RequestInit): Promise<Response> =>
    handleLocalProofRequest(new Request(`http://127.0.0.1:4210${MACHINE_PROOF_PATH}`, init), { localSecret: 'the-local-secret', port: 4210 });

describe('handleLocalProofRequest', () => {
    test('answers a nonce with the HMAC the shell checks, and never with the secret', async () => {
        const nonce = 'a-nonce-of-the-shell-0123456789';
        const response = await ask({ method: 'POST', body: JSON.stringify({ nonce }) });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(await isLocalProof(body, 'the-local-secret', 4210, nonce)).toBe(true);
        expect(JSON.stringify(body)).not.toContain('the-local-secret');
    });

    test('refuses anything but a POST with a nonce', async () => {
        expect((await ask({ method: 'GET' })).status).toBe(405);
        expect((await ask({ method: 'POST', body: '{}' })).status).toBe(400);
        expect((await ask({ method: 'POST', body: JSON.stringify({ nonce: 'short' }) })).status).toBe(400);
    });
});
