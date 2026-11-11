import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BYTES_CHUNK_MAX, DESIGN_PAGE_MAX_BYTES, DESIGN_PAGE_SENT_MAX_BYTES, injectVisualBootstrap, type ProjectView } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { HeldDesignPages } from '../fs/held-design-pages.ts';
import { bytesArea } from './bytes.ts';
import { designArea } from './design.ts';
import { askOnce, HOME_WITHOUT_STATE } from './test-helpers.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const VIEWS: ProjectView[] = [{ kind: 'design', id: 'onboarding', name: 'Onboarding', node: {}, path: 'onboarding' }];

let root: string;
let project: string;
let folder: string;
let pages: HeldDesignPages;
let dispatcher: Dispatcher;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-design-page-')));
    project = join(root, 'repo');
    folder = join(project, '.ruimte', 'private', 'designs', 'onboarding');
    await mkdir(join(folder, 'assets'), { recursive: true });
    pages = new HeldDesignPages();
    dispatcher = new Dispatcher();
    designArea({
        projectOf: async (clientId, projectId) => (clientId === 'client' && projectId === 'project' ? { folder: project, views: VIEWS, shared: [] } : null),
        pages
    }).handlers?.(dispatcher);
    bytesArea({
        sources: {
            attachment: async () => null,
            projectIcon: async () => null,
            file: async () => null,
            designPage: (clientId, pageId) => pages.bytesOf(clientId, pageId),
            designPageSent: (clientId, pageId, offset, length) => pages.sent(clientId, pageId, offset, length)
        },
        machineHome: HOME_WITHOUT_STATE
    }).handlers?.(dispatcher);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

function ask(file: string, clientId = 'client', designId = 'onboarding', bootstrap?: boolean) {
    return askOnce(dispatcher, { id: clientId }, 'design.page', { projectId: 'project', designId, file, bootstrap });
}

/* One piece of a held page as a client asks for it over `bytes.read`. */
async function readPiece(pageId: string, offset: number, clientId = 'client') {
    return askOnce(dispatcher, { id: clientId }, 'bytes.read', { resource: { kind: 'designPage', pageId }, offset, length: BYTES_CHUNK_MAX });
}

/* The held page read back the way a client reads it, piece by piece. */
async function readHeld(pageId: string, size: number, clientId = 'client'): Promise<string> {
    const parts: Buffer[] = [];

    for (let offset = 0; offset < size || offset === 0; offset += BYTES_CHUNK_MAX) {
        const frame = await readPiece(pageId, offset, clientId);

        expect(frame).toMatchObject({ ok: true });
        parts.push(Buffer.from((frame as { result: { data: string } }).result.data, 'base64'));
    }

    return new TextDecoder().decode(Buffer.concat(parts));
}

function isHeld(pageId: string, clientId = 'client'): boolean {
    return pages.bytesOf(clientId, pageId) !== null;
}

describe('a page of a design', () => {
    test('is built with the files and pages it names and held until every byte went out', async () => {
        await writeFile(join(folder, 'index.html'), '<link rel="stylesheet" href="style.css"><img src="assets/me.png"><iframe src="two.html"></iframe>');
        await writeFile(join(folder, 'style.css'), 'h1{color:red}');
        await writeFile(join(folder, 'two.html'), '<p>two</p>');
        await writeFile(join(folder, 'assets', 'me.png'), PNG);

        const frame = await ask('index.html');

        expect(frame).toMatchObject({ ok: true, result: { kind: 'page' } });
        const { pageId, size } = (frame as { result: { pageId: string; size: number } }).result;
        const html = await readHeld(pageId, size);

        expect(html).toContain(`src="data:image/png;base64,${PNG.toString('base64')}"`);
        expect(html).toContain('data:text/html;charset=utf-8,%3Cp%3Etwo%3C/p%3E');
        // The frame applies no stylesheet typed as a download.
        expect(html).toContain(`href="data:text/css;base64,${Buffer.from('h1{color:red}').toString('base64')}"`);
        expect(isHeld(pageId)).toBe(false);
    });

    test('that is not there, too large or not text says so for the client to word', async () => {
        await writeFile(join(folder, 'large.html'), 'x'.repeat(DESIGN_PAGE_MAX_BYTES + 1));
        await writeFile(join(folder, 'binary.html'), Buffer.from([0x3c, 0x00, 0x01, 0x02]));

        expect(await ask('gone.html')).toMatchObject({ ok: true, result: { kind: 'missing', name: 'gone.html' } });
        expect(await ask('large.html')).toMatchObject({
            ok: true,
            result: { kind: 'too-large', name: 'large.html', size: DESIGN_PAGE_MAX_BYTES + 1, limit: DESIGN_PAGE_MAX_BYTES }
        });
        expect(await ask('binary.html')).toMatchObject({ ok: true, result: { kind: 'not-text', name: 'binary.html' } });
    });

    test('is never read outside its folder, by a path or through a symlink', async () => {
        await writeFile(join(project, 'secret.html'), '<p>secret</p>');
        await writeFile(join(project, 'secret.png'), PNG);
        await symlink(join(project, 'secret.html'), join(folder, 'linked.html'));
        await symlink(join(project, 'secret.png'), join(folder, 'assets', 'linked.png'));
        await writeFile(join(folder, 'index.html'), '<img src="assets/linked.png"><iframe src="linked.html"></iframe>');

        for (const file of ['../secret.html', '../../../../secret.html', join(project, 'secret.html'), 'assets\\..\\..\\secret.html', 'notes.txt']) {
            expect(await ask(file)).toMatchObject({ ok: false, error: { code: 'outside-design' } });
        }

        expect(await ask('linked.html')).toMatchObject({ ok: true, result: { kind: 'missing' } });

        const frame = await ask('index.html');
        const { pageId, size } = (frame as { result: { pageId: string; size: number } }).result;

        expect(await readHeld(pageId, size)).toBe('<img src="assets/linked.png"><iframe src="linked.html"></iframe>');
    });

    test('is not read when its folder leads out of the project', async () => {
        const elsewhere = join(root, 'elsewhere');
        await mkdir(elsewhere);
        await writeFile(join(elsewhere, 'index.html'), '<p>elsewhere</p>');
        await rm(folder, { recursive: true });
        await symlink(elsewhere, folder);

        expect(await ask('index.html')).toMatchObject({ ok: true, result: { kind: 'missing', name: 'index.html' } });
    });

    test('carries the bootstrap of a visual only for a client that asks for it', async () => {
        const written = '<!doctype html><html><head><title>One</title></head><body><p>one</p></body></html>';
        await writeFile(join(folder, 'index.html'), written);

        const plain = (await ask('index.html')) as { result: { pageId: string; size: number } };
        const drawn = (await ask('index.html', 'client', 'onboarding', true)) as { result: { pageId: string; size: number } };

        expect(await readHeld(plain.result.pageId, plain.result.size)).toBe(written);
        expect(await readHeld(drawn.result.pageId, drawn.result.size)).toBe(injectVisualBootstrap(written));
    });

    test('at the content limit is read whole with the bootstrap of a visual in its head', async () => {
        const written = `<html><head></head><body>${'x'.repeat(DESIGN_PAGE_MAX_BYTES - 39)}</body></html>`;
        await writeFile(join(folder, 'index.html'), written);

        expect(Buffer.byteLength(written)).toBe(DESIGN_PAGE_MAX_BYTES);

        const drawn = (await ask('index.html', 'client', 'onboarding', true)) as { result: { pageId: string; size: number } };

        expect(drawn.result.size).toBeGreaterThan(DESIGN_PAGE_MAX_BYTES);
        expect(drawn.result.size).toBeLessThanOrEqual(DESIGN_PAGE_SENT_MAX_BYTES);
        expect(await readHeld(drawn.result.pageId, drawn.result.size)).toBe(injectVisualBootstrap(written));
    });

    test('is only for a client that has the project open, and only of a design of it', async () => {
        await writeFile(join(folder, 'index.html'), '<p>one</p>');

        expect(await ask('index.html', 'stranger')).toMatchObject({ ok: false, error: { code: 'outside-project' } });
        expect(await ask('index.html', 'client', 'canvas')).toMatchObject({ ok: false, error: { code: 'not-a-design' } });
    });
});

describe('the pages held for a client', () => {
    test('are read and let go only by that client', async () => {
        const held = pages.hold('client', '<p>mine</p>');

        expect(await readPiece(held.pageId, 0, 'other')).toMatchObject({ ok: false, error: { code: 'not-found' } });
        expect(isHeld(held.pageId)).toBe(true);
        expect(await readHeld(held.pageId, held.size)).toBe('<p>mine</p>');
    });

    test('stay until every piece went out, also when one was read twice', async () => {
        const held = pages.hold('client', 'x'.repeat(BYTES_CHUNK_MAX * 2));

        await readPiece(held.pageId, 0);
        await readPiece(held.pageId, 0);

        expect(isHeld(held.pageId)).toBe(true);

        await readPiece(held.pageId, BYTES_CHUNK_MAX);

        expect(isHeld(held.pageId)).toBe(false);
    });

    test('go when the client leaves', () => {
        const own = ['1', '2', '3', '4', '5'].map((text) => pages.hold('client', `<p>${text}</p>`));
        const elsewhere = pages.hold('other', '<p>other</p>');

        expect(own.every((page) => isHeld(page.pageId))).toBe(true);

        pages.detachAll('client');

        expect(own.some((page) => isHeld(page.pageId))).toBe(false);
        expect(isHeld(elsewhere.pageId, 'other')).toBe(true);
    });

    test('weigh no more than four of the largest pages, the oldest going first', () => {
        const largest = 'x'.repeat(DESIGN_PAGE_MAX_BYTES);
        const [first, second, , fourth] = [1, 2, 3, 4].map(() => pages.hold('client', largest));
        const elsewhere = pages.hold('other', largest);

        expect(isHeld(first!.pageId)).toBe(true);

        const fifth = pages.hold('client', largest);

        expect(isHeld(first!.pageId)).toBe(false);
        expect(isHeld(second!.pageId)).toBe(true);
        expect(isHeld(fourth!.pageId)).toBe(true);
        expect(isHeld(fifth.pageId)).toBe(true);
        expect(isHeld(elsewhere.pageId, 'other')).toBe(true);
    });

    test('number no more than a few, however small, the oldest going first', () => {
        const held = Array.from({ length: 12 }, () => pages.hold('client', ''));

        expect(held.filter((page) => isHeld(page.pageId)).length).toBe(8);
        expect(isHeld(held[0]!.pageId)).toBe(false);
        expect(isHeld(held[11]!.pageId)).toBe(true);
    });

    test('go when read in scattered bytes rather than pieces', () => {
        const held = pages.hold('client', 'x'.repeat(4096));

        for (let offset = 0; offset < 4096 && isHeld(held.pageId); offset += 2) {
            pages.sent('client', held.pageId, offset, 1);
        }

        expect(isHeld(held.pageId)).toBe(false);
    });
});
