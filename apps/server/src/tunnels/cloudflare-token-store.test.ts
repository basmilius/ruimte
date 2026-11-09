import { describe, expect, test } from 'bun:test';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { FileTokenStore } from './cloudflare-token-store.ts';

const homeOf = tempHomes('ruimte-token-');

describe('the token file', () => {
    test('keeps the token in a file of its own and reads it back', async () => {
        const home = await homeOf();
        const store = new FileTokenStore(home);

        expect(store.read()).toBeNull();

        await store.write('cf-api-token-0123456789');

        expect(new FileTokenStore(home).read()).toBe('cf-api-token-0123456789');
        expect(await Bun.file(join(home, 'tunnels', 'cloudflare-token')).text()).toBe('cf-api-token-0123456789');
    });

    test.skipIf(process.platform === 'win32')('is 0600 in a 0700 folder', async () => {
        const home = await homeOf();

        await new FileTokenStore(home).write('cf-api-token-0123456789');

        expect((await stat(join(home, 'tunnels', 'cloudflare-token'))).mode & 0o777).toBe(0o600);
        expect((await stat(join(home, 'tunnels'))).mode & 0o777).toBe(0o700);
    });

    test('forgets the token on clear, and reads an empty file as none', async () => {
        const home = await homeOf();
        const store = new FileTokenStore(home);

        await store.write('cf-api-token-0123456789');
        await store.clear();

        expect(store.read()).toBeNull();

        await mkdir(join(home, 'tunnels'), { recursive: true });
        await writeFile(join(home, 'tunnels', 'cloudflare-token'), '\n');

        expect(store.read()).toBeNull();
    });
});
