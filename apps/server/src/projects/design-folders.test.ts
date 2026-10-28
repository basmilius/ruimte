import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectView } from '@ruimte/contracts';
import { moveDesignFolders } from './design-folders.ts';

let project: string;

beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'ruimte-designs-'));
});

afterEach(async () => {
    await rm(project, { recursive: true, force: true });
});

const design = (id: string, path: string): ProjectView => ({ kind: 'design', id, name: id, node: {}, path });

async function page(folder: string, text: string): Promise<void> {
    await mkdir(join(project, folder), { recursive: true });
    await writeFile(join(project, folder, 'Onboarding.html'), text);
}

describe('the folder of a design a save shares or takes back', () => {
    test('moves whole into .ruimte/designs when shared, and back under private when it is not', async () => {
        await page('.ruimte/private/designs/onboarding', 'one');

        expect(await moveDesignFolders(project, [design('d1', 'onboarding')], ['d1'], ['d1'])).toEqual([]);
        expect(await readFile(join(project, '.ruimte/designs/onboarding/Onboarding.html'), 'utf8')).toBe('one');

        expect(await moveDesignFolders(project, [design('d1', 'onboarding')], ['d1'], [])).toEqual([]);
        expect(await readFile(join(project, '.ruimte/private/designs/onboarding/Onboarding.html'), 'utf8')).toBe('one');
    });

    test('leaves both folders when one is already on the other side, and says which design it could not move', async () => {
        await page('.ruimte/private/designs/onboarding', 'mine');
        await page('.ruimte/designs/onboarding', 'theirs');

        expect(await moveDesignFolders(project, [design('d1', 'onboarding')], ['d1'], ['d1'])).toEqual(['d1']);
        expect(await readFile(join(project, '.ruimte/private/designs/onboarding/Onboarding.html'), 'utf8')).toBe('mine');
        expect(await readFile(join(project, '.ruimte/designs/onboarding/Onboarding.html'), 'utf8')).toBe('theirs');
    });

    test('touches no design that did not change sides, nor one in a folder of the project it named itself', async () => {
        await page('.ruimte/private/designs/kept', 'kept');
        await page('designs/legacy', 'legacy');

        expect(await moveDesignFolders(project, [design('d1', 'kept'), design('d2', 'designs/legacy')], ['d2'], ['d1', 'd2'])).toEqual([]);
        expect(await readFile(join(project, '.ruimte/private/designs/kept/Onboarding.html'), 'utf8')).toBe('kept');
        expect(await readFile(join(project, 'designs/legacy/Onboarding.html'), 'utf8')).toBe('legacy');
    });
});
