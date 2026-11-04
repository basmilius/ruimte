import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { PackageStore } from './package-store.ts';
import type { RunCommand } from './runtime.ts';

let root = '';

const newHome = tempHomes('ruimte-package-store-');

beforeEach(async () => {
    root = await newHome();
});

const runtime = { command: '/ruimte', args: [], env: {} };
const dependencies = { 'vscode-langservers-extracted': '4.10.0' };
const entries = ['vscode-langservers-extracted/bin/vscode-css-language-server'];

/* Plays `bun install`: leaves every entry in the node_modules of its cwd. */
function installing(calls: string[] = []): RunCommand {
    return async (spec, onLine) => {
        calls.push(spec.cwd);
        onLine('bun install v1');

        for (const entry of entries) {
            const file = join(spec.cwd, 'node_modules', entry);

            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, 'content');
        }

        return 0;
    };
}

function storeOf(run: RunCommand, now = () => 1000): PackageStore {
    return new PackageStore({ root, runtime, run, now, platform: 'darwin', arch: 'arm64' });
}

describe('package store', () => {
    it('names a set by what it pins and the platform, whatever the order and the kind', () => {
        const store = storeOf(installing());
        const other = new PackageStore({ root, runtime, run: installing(), now: () => 0, platform: 'linux', arch: 'arm64' });

        expect(store.setIdOf({ a: '1', b: '2' })).toBe(store.setIdOf({ b: '2', a: '1' }));
        expect(store.setIdOf({ a: '1' })).not.toBe(store.setIdOf({ a: '2' }));
        expect(store.setIdOf({ a: '1' })).not.toBe(other.setIdOf({ a: '1' }));
        expect(store.setIdOf({ a: '1' })).toMatch(/^[0-9a-f]{16}$/);
    });

    it('builds a set once and hands the same one to the next caller', async () => {
        const calls: string[] = [];
        const lines: string[] = [];
        const store = storeOf(installing(calls));
        const first = await store.ensure(dependencies, entries, (line) => lines.push(line));
        const second = await store.ensure(dependencies, entries, () => undefined);

        expect(calls).toHaveLength(1);
        expect(second.folder).toBe(first.folder);
        expect(first.folder).toBe(join(root, 'packages', first.setId));
        expect(lines).toEqual(['Installing vscode-langservers-extracted@4.10.0', 'bun install v1']);
        expect(JSON.parse(await readFile(join(first.folder, 'package.json'), 'utf8'))).toEqual({
            name: 'ruimte-language-packages',
            private: true,
            dependencies
        });
        expect(await store.readRecord(first.setId)).toEqual({
            format: 1,
            dependencies,
            platform: 'darwin',
            arch: 'arm64',
            installedAt: 1000,
            files: 1,
            bytes: 7
        });
        expect(await readdir(join(root, 'packages', '.staging'))).toEqual([]);
    });

    it('builds a set once for callers that ask at the same time', async () => {
        const calls: string[] = [];
        const store = storeOf(installing(calls));
        const leases = await Promise.all([store.ensure(dependencies, entries, () => undefined), store.ensure(dependencies, entries, () => undefined)]);

        expect(calls).toHaveLength(1);
        expect(leases[0]!.setId).toBe(leases[1]!.setId);
    });

    it('builds again when the set lacks an entry a caller needs', async () => {
        const calls: string[] = [];
        const store = storeOf(installing(calls));
        const lease = await store.ensure(dependencies, entries, () => undefined);
        const more = ['vscode-langservers-extracted/bin/other'];

        await expect(store.ensure(dependencies, more, () => undefined)).rejects.toThrow('did not leave');
        expect(calls).toHaveLength(2);
        // The set that was there is replaced only when the new one is whole, so it stays for the first caller.
        expect(await store.readRecord(lease.setId)).not.toBeNull();
    });

    it('leaves nothing but staging when the install fails, and recover clears it', async () => {
        const store = storeOf(async (spec) => {
            await mkdir(join(spec.cwd, 'node_modules'), { recursive: true });

            return 1;
        });

        await expect(store.ensure(dependencies, entries, () => undefined)).rejects.toThrow('exited with code 1');
        expect(await readdir(join(root, 'packages'))).not.toContain(store.setIdOf(dependencies));

        // A crash leaves the staging folder behind, which the build's own cleanup never got to remove.
        await mkdir(join(root, 'packages', '.staging', 'left-over', 'node_modules'), { recursive: true });
        await store.recover();

        expect(await readdir(join(root, 'packages')).catch(() => [])).toEqual([]);
    });

    it('uses the set another run published first and discards its own staging', async () => {
        const id = storeOf(installing()).setIdOf(dependencies);
        const store = storeOf(async (spec, onLine) => {
            // The winner publishes while this build is still installing.
            const winner = join(root, 'packages', id);

            await installing()({ ...spec, cwd: winner }, onLine);
            await writeFile(join(winner, 'set.json'), '{"format":1}\n');

            return installing()(spec, onLine);
        });
        const lease = await store.ensure(dependencies, entries, () => undefined);

        expect(lease.setId).toBe(id);
        expect(JSON.parse(await readFile(join(lease.folder, 'set.json'), 'utf8'))).toEqual({ format: 1 });
        expect(await readdir(join(root, 'packages', '.staging'))).toEqual([]);
    });

    it('removes only the sets nobody refers to or leases', async () => {
        const store = storeOf(installing());
        const kept = await store.ensure({ a: '1' }, entries, () => undefined);
        const used = await store.ensure({ a: '2' }, entries, () => undefined);
        const unused = await store.ensure({ a: '3' }, entries, () => undefined);

        used.release();
        unused.release();

        expect(await store.collect(async () => null)).toEqual([]);
        expect(await store.collect(async () => new Set([used.setId]))).toEqual([unused.setId]);
        expect(await readdir(join(root, 'packages'))).toEqual(expect.arrayContaining([kept.setId, used.setId]));
        expect(await readdir(join(root, 'packages'))).not.toContain(unused.setId);

        kept.release();
        expect(await store.collect(async () => new Set())).toEqual([used.setId, kept.setId].sort());
    });

    it('keeps a set whose lease was released while the collection read what refers to it', async () => {
        const store = storeOf(installing());
        const lease = await store.ensure(dependencies, entries, () => undefined);

        // The install links the set and releases its lease after the references were read, which the collection must not take for an unused set.
        const removed = await store.collect(async () => {
            lease.release();

            return new Set();
        });

        expect(removed).toEqual([]);
        expect(await readdir(join(root, 'packages'))).toContain(lease.setId);
    });

    it('keeps a set that is moved aside by hand out of the way of the next build', async () => {
        const calls: string[] = [];
        const store = storeOf(installing(calls));
        const lease = await store.ensure(dependencies, entries, () => undefined);

        lease.release();
        await rename(lease.folder, `${lease.folder}.moved`);
        await store.ensure(dependencies, entries, () => undefined);

        expect(calls).toHaveLength(2);
    });
});
