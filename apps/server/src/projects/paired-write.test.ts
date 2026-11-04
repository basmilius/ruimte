import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileExists } from '@adecore/agents';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { PairedWriteRaced, PairedWriteStuck, recoverPaired, writePaired } from './paired-write.ts';
import { PROJECT_WRITE_IO, type ProjectWriteIO } from './project-write.ts';

let root: string;
let intent: string;
let first: string;
let second: string;

function failingOn(call: number): ProjectWriteIO {
    let calls = 0;
    return {
        remove: PROJECT_WRITE_IO.remove,
        write: async (...args) => {
            calls += 1;
            if (calls === call) {
                throw new Error('Injected write failure');
            }
            await PROJECT_WRITE_IO.write(...args);
        }
    };
}

const newHome = tempHomes('ruimte-paired-write-');

beforeEach(async () => {
    root = await newHome();
    await mkdir(join(root, 'private'));
    intent = join(root, 'private', 'pending.json');
    first = join(root, 'shared.json');
    second = join(root, 'private', 'own.json');
    await writeFile(first, 'shared-0');
    await writeFile(second, 'own-0');
});

describe('paired write', () => {
    const files = () => [
        { path: first, before: 'shared-0', after: 'shared-1' },
        { path: second, before: 'own-0', after: 'own-1' }
    ];

    test('writes both files and leaves no intent', async () => {
        await writePaired(intent, files());

        expect(await readFile(first, 'utf8')).toBe('shared-1');
        expect(await readFile(second, 'utf8')).toBe('own-1');
        expect(await fileExists(intent)).toBe(false);
    });

    test('a failure before the intent landed leaves both files as they were', async () => {
        await expect(writePaired(intent, files(), failingOn(1))).rejects.toThrow('Injected write failure');

        expect(await recoverPaired(intent, { root, paths: [first, second] })).toBe('none');
        expect([await readFile(first, 'utf8'), await readFile(second, 'utf8')]).toEqual(['shared-0', 'own-0']);
    });

    test.each([2, 3])('a write that fails on call %i recovers to one whole version', async (call) => {
        await expect(writePaired(intent, files(), failingOn(call))).rejects.toThrow('Injected write failure');

        const outcome = await recoverPaired(intent, { root, paths: [first, second] });

        const state = [await readFile(first, 'utf8'), await readFile(second, 'utf8')];
        expect(outcome).toBe('recovered');
        expect(state).toEqual(['shared-1', 'own-1']);
        expect(await fileExists(intent)).toBe(false);
    });

    test('an edit after the intent leaves recovery stuck and the files alone', async () => {
        await expect(writePaired(intent, files(), failingOn(3))).rejects.toThrow();
        await writeFile(first, 'edited by hand');

        await expect(recoverPaired(intent, { root, paths: [first, second] })).rejects.toBeInstanceOf(PairedWriteStuck);

        expect(await readFile(first, 'utf8')).toBe('edited by hand');
        expect(await readFile(second, 'utf8')).toBe('own-0');
    });

    test('a file that moved before the first write refuses the save and removes the intent', async () => {
        await writeFile(second, 'pulled');

        await expect(writePaired(intent, files())).rejects.toBeInstanceOf(PairedWriteRaced);

        expect(await readFile(first, 'utf8')).toBe('shared-0');
        expect(await fileExists(intent)).toBe(false);
    });

    test('an after of null leaves that file alone', async () => {
        await writePaired(intent, [
            { path: first, before: 'shared-0', after: null },
            { path: second, before: 'own-0', after: 'own-1' }
        ]);

        expect(await readFile(first, 'utf8')).toBe('shared-0');
        expect(await readFile(second, 'utf8')).toBe('own-1');
    });
});
