import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withNodeAsView, type ProjectView } from '@ruimte/contracts';
import { moveDesignFolders, settleDesignFolders, takenDesignFolders } from './design-folders.ts';

let project: string;

beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'ruimte-designs-'));
});

afterEach(async () => {
    await rm(project, { recursive: true, force: true });
});

const design = (id: string, path: string): ProjectView => ({ kind: 'design', id, name: id, node: {}, path });

const canvasWith = (path: string): ProjectView => ({
    kind: 'canvas',
    id: 'main',
    name: 'Canvas',
    nodes: [{ id: 'board', kind: 'design', title: 'Board', x: 0, y: 0, w: 480, h: 640, path }],
    texts: [],
    edges: [],
    layouts: []
});

async function page(folder: string, text: string): Promise<void> {
    await mkdir(join(project, folder), { recursive: true });
    await writeFile(join(project, folder, 'Onboarding.html'), text);
}

async function pageIn(folder: string): Promise<string> {
    return readFile(join(project, folder, 'Onboarding.html'), 'utf8');
}

describe('the folder of a design a write moves to the other side', () => {
    test('moves whole into .ruimte/designs when shared, and back under private when it is not', async () => {
        await page('.ruimte/private/designs/onboarding', 'one');
        const views = [design('d1', 'onboarding')];

        expect(await moveDesignFolders(project, { views, shared: [] }, { views, shared: ['d1'] })).toEqual([]);
        expect(await pageIn('.ruimte/designs/onboarding')).toBe('one');

        expect(await moveDesignFolders(project, { views, shared: ['d1'] }, { views, shared: [] })).toEqual([]);
        expect(await pageIn('.ruimte/private/designs/onboarding')).toBe('one');
    });

    test('moves a design node with its canvas, and again when it leaves a shared canvas for a view of its own', async () => {
        await page('.ruimte/private/designs/pricing', 'board');
        const canvas = [canvasWith('pricing')];

        expect(await moveDesignFolders(project, { views: canvas, shared: [] }, { views: canvas, shared: ['main'] })).toEqual([]);
        expect(await pageIn('.ruimte/designs/pricing')).toBe('board');

        const promoted = withNodeAsView(canvas, 'board')!.views;
        expect(await moveDesignFolders(project, { views: canvas, shared: ['main'] }, { views: promoted, shared: ['main'] })).toEqual([]);
        expect(await pageIn('.ruimte/private/designs/pricing')).toBe('board');
    });

    test('leaves both folders when one is already on the other side, and says which design it could not move', async () => {
        await page('.ruimte/private/designs/onboarding', 'mine');
        await page('.ruimte/designs/onboarding', 'theirs');
        const views = [design('d1', 'onboarding')];

        expect(await moveDesignFolders(project, { views, shared: [] }, { views, shared: ['d1'] })).toEqual(['d1']);
        expect(await pageIn('.ruimte/private/designs/onboarding')).toBe('mine');
        expect(await pageIn('.ruimte/designs/onboarding')).toBe('theirs');
    });

    test('touches no design that stayed on its side, nor one in a folder of the project it named itself', async () => {
        await page('.ruimte/private/designs/kept', 'kept');
        await page('designs/legacy', 'legacy');
        const views = [design('d1', 'kept'), design('d2', 'designs/legacy')];

        expect(await moveDesignFolders(project, { views, shared: [] }, { views, shared: ['d2'] })).toEqual([]);
        expect(await pageIn('.ruimte/private/designs/kept')).toBe('kept');
        expect(await pageIn('designs/legacy')).toBe('legacy');
    });

    test('moves nothing for a node whose name is no folder of its own', async () => {
        await page('.ruimte/private/designs/mine', 'mine');
        const canvas = [canvasWith('.')];

        expect(await moveDesignFolders(project, { views: canvas, shared: [] }, { views: canvas, shared: ['main'] })).toEqual([]);
        expect(await settleDesignFolders(project, { views: canvas, shared: ['main'] })).toEqual([]);
        expect(await takenDesignFolders(project, { views: canvas, shared: [] }, { views: canvas, shared: ['main'] })).toEqual([]);
        expect(await pageIn('.ruimte/private/designs/mine')).toBe('mine');
    });
});

describe('a folder a design would move onto', () => {
    test('names the design whose new side already has a folder of its name, before anything moves', async () => {
        await page('.ruimte/designs/onboarding', 'theirs');
        const views = [design('d1', 'onboarding'), design('d2', 'pricing')];

        expect(await takenDesignFolders(project, { views, shared: [] }, { views, shared: ['d1', 'd2'] })).toEqual([
            { id: 'd1', name: 'd1', from: '.ruimte/private/designs/onboarding', to: '.ruimte/designs/onboarding' }
        ]);
        expect(await takenDesignFolders(project, { views, shared: [] }, { views, shared: [] })).toEqual([]);
    });
});

describe('a folder a move left on the other side', () => {
    const journal = join('.ruimte', 'private', 'design-moves.json');

    async function journaled(moves: { id: string; from: string; to: string }[]): Promise<void> {
        await mkdir(join(project, '.ruimte', 'private'), { recursive: true });
        await writeFile(join(project, journal), JSON.stringify({ moves }));
    }

    async function journalExists(): Promise<boolean> {
        return (await stat(join(project, journal)).catch(() => null)) !== null;
    }

    test('goes back to where the document puts its design when the daemon stopped between the write and the rename', async () => {
        await page('.ruimte/private/designs/onboarding', 'one');
        await journaled([{ id: 'd1', from: '.ruimte/private/designs/onboarding', to: '.ruimte/designs/onboarding' }]);
        const views = [design('d1', 'onboarding')];

        expect(await settleDesignFolders(project, { views, shared: ['d1'] })).toEqual(['d1']);
        expect(await pageIn('.ruimte/designs/onboarding')).toBe('one');
        expect(await journalExists()).toBe(false);
        expect(await settleDesignFolders(project, { views, shared: ['d1'] })).toEqual([]);
    });

    test("never takes a folder no move of this daemon left, such as a teammate's shared one", async () => {
        await page('.ruimte/designs/site', 'theirs');
        const views = [design('d1', 'site')];

        expect(await settleDesignFolders(project, { views, shared: [] })).toEqual([]);
        expect(await pageIn('.ruimte/designs/site')).toBe('theirs');
        expect(await stat(join(project, '.ruimte/private/designs/site')).catch(() => null)).toBeNull();
    });

    test('ignores a journaled move that names folders other than the two sides of its design', async () => {
        await page('elsewhere', 'mine');
        await journaled([{ id: 'd1', from: 'elsewhere', to: '.ruimte/designs/onboarding' }]);
        const views = [design('d1', 'onboarding')];

        expect(await settleDesignFolders(project, { views, shared: ['d1'] })).toEqual([]);
        expect(await pageIn('elsewhere')).toBe('mine');
        expect(await journalExists()).toBe(false);
    });

    test('stays when another design calls it its own', async () => {
        await page('.ruimte/designs/pricing', 'theirs');
        await journaled([{ id: 'd3', from: '.ruimte/designs/pricing', to: '.ruimte/private/designs/pricing' }]);
        const views = [design('d2', 'pricing'), design('d3', 'pricing')];

        expect(await settleDesignFolders(project, { views, shared: ['d2'] })).toEqual([]);
        expect(await pageIn('.ruimte/designs/pricing')).toBe('theirs');
    });

    test('takes in what a chat in a turn still wrote to the old folder, keeping both sides of a clash, so the next move goes through', async () => {
        await page('.ruimte/private/designs/onboarding', 'moved');
        const views = [design('d1', 'onboarding')];
        const atWork = (): boolean => true;

        expect(await moveDesignFolders(project, { views, shared: [] }, { views, shared: ['d1'] }, atWork)).toEqual([]);
        expect(await journalExists()).toBe(true);

        // The CLI was told the old folder when its turn began and writes there until the next one.
        await page('.ruimte/private/designs/onboarding', 'written after the move');
        await writeFile(join(project, '.ruimte/private/designs/onboarding', 'Pricing.html'), 'new');

        expect(await settleDesignFolders(project, { views, shared: ['d1'] }, atWork)).toEqual(['d1']);
        expect(await journalExists()).toBe(true);
        expect(await settleDesignFolders(project, { views, shared: ['d1'] })).toEqual([]);
        expect(await journalExists()).toBe(false);

        const shared = '.ruimte/designs/onboarding';
        expect(await pageIn(shared)).toBe('moved');
        expect(await readFile(join(project, shared, 'Onboarding (left behind).html'), 'utf8')).toBe('written after the move');
        expect(await readFile(join(project, shared, 'Pricing.html'), 'utf8')).toBe('new');
        expect(await stat(join(project, '.ruimte/private/designs/onboarding')).catch(() => null)).toBeNull();

        expect(await moveDesignFolders(project, { views, shared: ['d1'] }, { views, shared: [] })).toEqual([]);
        expect(await pageIn('.ruimte/private/designs/onboarding')).toBe('moved');
        expect(await journalExists()).toBe(false);
    });

    test('drops a copy left behind with the same bytes rather than keeping it twice', async () => {
        await page('.ruimte/designs/onboarding', 'same');
        await page('.ruimte/private/designs/onboarding', 'same');
        await journaled([{ id: 'd1', from: '.ruimte/private/designs/onboarding', to: '.ruimte/designs/onboarding' }]);
        const views = [design('d1', 'onboarding')];

        expect(await settleDesignFolders(project, { views, shared: ['d1'] })).toEqual(['d1']);
        expect(await readdir(join(project, '.ruimte/designs/onboarding'))).toEqual(['Onboarding.html']);
        expect(await stat(join(project, '.ruimte/private/designs/onboarding')).catch(() => null)).toBeNull();
    });
});
