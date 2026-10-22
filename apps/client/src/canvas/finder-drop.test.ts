import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { finderPaths } from '@/canvas/finder-drop';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';

const globals = globalThis as { window?: unknown };
const previousWindow = globals.window;

interface FakeItem {
    path: string;
    directory: boolean;
}

/* A drag out of the file manager: the shell names each file, and the entry says whether it is a folder. */
function dragOf(...items: FakeItem[]): DataTransfer {
    return {
        items: items.map((item) => ({
            kind: 'file',
            getAsFile: () => ({ name: item.path }),
            webkitGetAsEntry: () => ({ isDirectory: item.directory })
        }))
    } as unknown as DataTransfer;
}

function serve(reachability: 'loopback' | 'lan'): void {
    useServers.setState({ byEndpoint: { machine: { platform: 'darwin', reachability, label: 'Build server' } as never } });
}

function bridge(): void {
    globals.window = { ruimteDesktop: { platform: 'darwin', pathForFile: (file: { name: string }) => file.name } };
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
});

afterEach(() => {
    globals.window = previousWindow;
    useServers.setState({ byEndpoint: {} });
});

describe('finderPaths', () => {
    test('a canvas leaves a folder out, as it always has', () => {
        bridge();
        serve('loopback');

        expect(finderPaths(dragOf({ path: '/work/a.png', directory: false }, { path: '/work/dir', directory: true }), 'machine')).toEqual(['/work/a.png']);
    });

    test('a terminal keeps a folder, since it can change into it', () => {
        bridge();
        serve('loopback');

        const paths = finderPaths(dragOf({ path: '/work/a.png', directory: false }, { path: '/work/dir', directory: true }), 'machine', { folders: true });
        expect(paths).toEqual(['/work/a.png', '/work/dir']);
    });

    test('a project on another machine types nothing and says so in the words of a terminal', () => {
        bridge();
        serve('lan');

        expect(finderPaths(dragOf({ path: '/work/a.png', directory: false }), 'machine', { folders: true, refusal: 'terminal' })).toEqual([]);
        const [toast] = useToasts.getState().toasts;
        expect(toast?.title).toBe('This project runs on Build server');
        expect(toast?.description).toBe('It cannot read files from Finder. Type or paste a path on that machine.');
    });

    test('a window without the desktop shell types nothing and says to type the path', () => {
        globals.window = {};
        serve('loopback');

        expect(finderPaths(dragOf({ path: '/work/a.png', directory: false }), 'machine', { refusal: 'terminal' })).toEqual([]);
        expect(useToasts.getState().toasts[0]?.description).toBe('Type or paste the path.');
    });

    test('a canvas keeps the words about the Files panel', () => {
        globals.window = {};
        serve('loopback');

        finderPaths(dragOf({ path: '/work/a.png', directory: false }), 'machine');
        expect(useToasts.getState().toasts[0]?.description).toBe('Open it from the Files panel.');
    });
});
