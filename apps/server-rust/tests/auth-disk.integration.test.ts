import { expect, test } from 'bun:test';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { RpcFailure, startDaemon } from './wire-client';

test('failed auth persistence publishes no in-memory mutation and remains retryable', async () => {
    const daemon = await startDaemon();
    const client = await daemon.connect();
    const path = join(daemon.home, 'auth.json');
    const backup = `${path}.backup`;
    let blocked = false;
    const block = async (): Promise<void> => {
        await rename(path, backup);
        await mkdir(path);
        blocked = true;
    };
    const restore = async (): Promise<void> => {
        await rm(path, { recursive: true, force: true });
        await rename(backup, path);
        blocked = false;
    };
    const pair = (token: string, label: string) =>
        fetch(`${daemon.base}/auth/pair`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label, token })
        });

    try {
        const token = new URL((await client.call('auth.pairingToken', {})).url).hash.slice(1);
        expect((await pair(token, 'before')).status).toBe(200);
        const initial = (await client.call('auth.sessions', {})).sessions;
        expect(initial).toHaveLength(1);

        await block();
        await expect(client.call('auth.revoke', { id: initial[0].id })).rejects.toBeInstanceOf(RpcFailure);
        expect((await client.call('auth.sessions', {})).sessions).toHaveLength(1);
        await restore();
        await client.call('auth.revoke', { id: initial[0].id });
        expect((await client.call('auth.sessions', {})).sessions).toHaveLength(0);

        const fresh = new URL((await client.call('auth.pairingToken', {})).url).hash.slice(1);
        await block();
        expect((await pair(fresh, 'after')).status).toBe(500);
        expect((await client.call('auth.sessions', {})).sessions).toHaveLength(0);
        await restore();
        expect((await pair(fresh, 'after')).status).toBe(200);
        expect((await client.call('auth.sessions', {})).sessions).toHaveLength(1);
        expect(client.violations).toEqual([]);
    } finally {
        if (blocked) {
            await restore();
        }
        client.close();
        await daemon.stop();
    }
}, 30_000);
