import { describe, expect, test } from 'bun:test';
import type { FsEntry } from '@ruimte/contracts';
import { TransportError } from '@/transport-api/transport';
import {
    arrangePages,
    changeReaches,
    designFiles,
    designReadFailed,
    designScope,
    layoutPoint,
    listingAfter,
    listingOf,
    pageName,
    pagesByChange,
    scopedListingAfter,
    strokesBox
} from './design-page';

function entry(name: string, kind: FsEntry['kind'] = 'file'): FsEntry {
    return { name, path: `/repo/designs/onboarding/${name}`, kind, size: 1, mtime: 0, hidden: false, ignored: false };
}

describe('the pages of a design', () => {
    test('are the HTML files of its folder in the order a person reads names, without folders or other files', () => {
        const entries = [
            entry('Pricing.html'),
            entry('assets', 'directory'),
            entry('Onboarding v10.html'),
            entry('Onboarding v2.html'),
            entry('notes.md'),
            entry('Old.HTM')
        ];

        expect(designFiles(entries)).toEqual(['Old.HTM', 'Onboarding v2.html', 'Onboarding v10.html', 'Pricing.html']);
    });

    test('stand beside a design node the most recently changed first, and by name when changed at once', () => {
        const at = (name: string, mtime: number): FsEntry => ({ ...entry(name), mtime });
        const entries = [at('1a Calm.html', 100), at('2a Dense.html', 300), at('assets', 50), at('1b Bold.html', 100), at('notes.md', 900)];

        expect(pagesByChange(entries)).toEqual(['2a Dense.html', '1a Calm.html', '1b Bold.html']);
    });

    test('go by their file name without the extension', () => {
        expect(pageName('Skills website.html')).toBe('Skills website');
        expect(pageName('Old.HTM')).toBe('Old');
        expect(pageName('notes.html.bak')).toBe('notes.html.bak');
    });
});

describe('a drawing over the stage', () => {
    test('is cut to its strokes with room around them, and never past the edge of the layer', () => {
        expect(strokesBox([], { width: 800, height: 600 })).toBeNull();
        expect(
            strokesBox(
                [
                    [
                        { x: 100, y: 100 },
                        { x: 200, y: 150 }
                    ],
                    [{ x: 790, y: 10 }]
                ],
                { width: 800, height: 600 }
            )
        ).toEqual({ x: 76, y: 0, width: 724, height: 174 });
    });

    test('takes a pointer on a zoomed card in the pixels the card lays out in', () => {
        // A card of 400 by 300 on a canvas at half its size.
        expect(layoutPoint({ x: 150, y: 100 }, { left: 50, top: 25, width: 200, height: 150 }, { width: 400, height: 300 })).toEqual({ x: 200, y: 150 });
        expect(layoutPoint({ x: 70, y: 40 }, { left: 50, top: 25, width: 400, height: 300 }, { width: 400, height: 300 })).toEqual({ x: 20, y: 15 });
    });
});

describe('a change the machine reports', () => {
    const folder = '/repo/.ruimte/private/designs/pricing';

    test('reaches a design folder in it or under it, and from a parent only while the folder is not there yet', () => {
        expect(changeReaches(folder, folder, true)).toBe(true);
        expect(changeReaches(`${folder}/assets`, folder, true)).toBe(true);
        // A save of the project writes `.ruimte/private/project.json`.
        expect(changeReaches('/repo/.ruimte/private', folder, true)).toBe(false);
        expect(changeReaches('/repo/.ruimte/private', folder, false)).toBe(true);
        expect(changeReaches('/repo/src', folder, false)).toBe(false);
    });
});

describe('the order of the cards of a design node', () => {
    test('follows the pages while none is open, and holds with a new page on top while one is', () => {
        expect(arrangePages(['b', 'a'], ['a', 'c', 'b'], false)).toEqual(['a', 'c', 'b']);
        expect(arrangePages(null, ['a', 'b'], true)).toEqual(['a', 'b']);
        expect(arrangePages(['b', 'a', 'gone'], ['a', 'c', 'b'], true)).toEqual(['c', 'b', 'a']);
    });
});

describe('the listing of a design folder', () => {
    const pages = [entry('Pricing.html')];

    test('reads a folder that is not there as a design without pages, by the code of the error', () => {
        expect(designReadFailed(new TransportError('not-found', 'Not here'))).toEqual({ kind: 'missing' });
        expect(designReadFailed(new TransportError('not-found', 'Anything at all'))).toEqual({ kind: 'missing' });
    });

    test('reads any other error as a failed read, whatever its message says', () => {
        expect(designReadFailed(new TransportError('not-readable', 'That folder cannot be read'))).toEqual({
            kind: 'failed',
            reason: 'That folder cannot be read'
        });
        expect(designReadFailed(new TransportError('timeout', 'That folder is not there'))).toEqual({ kind: 'failed', reason: 'That folder is not there' });
        expect(designReadFailed(new Error('The line dropped'))).toEqual({ kind: 'failed', reason: 'The line dropped' });
        expect(designReadFailed('odd')).toEqual({ kind: 'failed', reason: 'odd' });
    });

    test('takes the entries of a read that listed them and clears an earlier failure', () => {
        expect(listingAfter({ entries: null, problem: 'Broke' }, { kind: 'listed', entries: pages })).toEqual({ entries: pages, problem: null });
    });

    test('drops its entries for a folder that is not there', () => {
        expect(listingAfter({ entries: pages, problem: null }, { kind: 'missing' })).toEqual({ entries: null, problem: null });
    });

    test('keeps the entries it had when a read fails, and says why', () => {
        expect(listingAfter({ entries: pages, problem: null }, { kind: 'failed', reason: 'Broke' })).toEqual({ entries: pages, problem: 'Broke' });
        expect(listingAfter({ entries: null, problem: null }, { kind: 'failed', reason: 'Broke' })).toEqual({ entries: null, problem: 'Broke' });
    });

    test('keeps the entries of a failed read only for the folder it read before', () => {
        const scope = designScope('machine', '/work/a');
        const before = scopedListingAfter(null, scope, { kind: 'listed', entries: pages });

        expect(scopedListingAfter(before, scope, { kind: 'failed', reason: 'Broke' }).listing).toEqual({ entries: pages, problem: 'Broke' });
        expect(scopedListingAfter(before, designScope('machine', '/work/b'), { kind: 'failed', reason: 'Broke' }).listing).toEqual({
            entries: null,
            problem: 'Broke'
        });
        expect(scopedListingAfter(before, designScope('other', '/work/a'), { kind: 'failed', reason: 'Broke' }).listing).toEqual({
            entries: null,
            problem: 'Broke'
        });
    });

    test('has no listing for another folder than the one it was read from', () => {
        const before = scopedListingAfter(null, designScope('machine', '/work/a'), { kind: 'listed', entries: pages });

        expect(listingOf(before, designScope('machine', '/work/a'))).toEqual({ entries: pages, problem: null });
        expect(listingOf(before, designScope('machine', '/work/b'))).toBeNull();
        expect(listingOf(null, designScope('machine', '/work/a'))).toBeNull();
    });
});
