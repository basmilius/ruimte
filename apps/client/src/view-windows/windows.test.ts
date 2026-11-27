import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectDocument, ProjectLocal, ProjectSummary } from '@ruimte/contracts';
import { auxWindowKey } from '@ruimte/desktop-bridge';
import { localIdOf, readClientLocal, writeClientLocal } from '@/clients/project/client-local';
import { commandPlace } from '@/commands/behavior';
import type { DesktopBridge } from '@/desktop/bridge';
import { viewIdsIn } from '@/layout/split';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { setAuxWindowId } from '@/state/window-target';
import { startAuxWindow } from './aux-window';
import { windowDragType } from './drag';
import { startMainWindow } from './main-window';
import type { WindowMessage } from './messages';
import { usePendingViews } from './pending-views';
import { readAuxViews, writeAuxViews } from './registry';
import { endFollowing, moveToNewWindow, startFollowing } from './windows';

const PROJECT = 'local:p1';

function view(id: string): ProjectCanvasView {
    return { kind: 'canvas', id, name: id, nodes: [], texts: [], edges: [], layouts: [] };
}

function document(ids: readonly string[]): ProjectDocument {
    return { version: 3, rev: 1, name: 'p', color: '#000', views: ids.map(view) };
}

function side(...ids: string[]): ProjectLocal {
    return {
        activeViewId: ids[0] ?? null,
        views: {},
        layout: { columns: ids.map((viewId) => ({ size: 1 / ids.length, cells: [{ viewId, size: 1 }] })), focus: { column: 0, cell: 0 } }
    };
}

function standing(): string[] {
    const { layout } = useDocument.getState();

    return layout === null ? [] : viewIdsIn(layout);
}

/* The storage every window of the app shares, in memory. */
function memory(): Storage {
    const map = new Map<string, string>();

    return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => void map.set(key, value),
        removeItem: (key: string) => void map.delete(key)
    } as Storage;
}

interface FakeShell {
    alive: string[];
    opened: unknown[][];
    drags: unknown[][];
    posted: { to: string; message: WindowMessage }[];
    bridge: Partial<DesktopBridge>;
    changed(): void;
    closed(key: string): void;
    message(from: string, message: WindowMessage): void;
}

/* A shell that keeps the windows named in `alive` and hands every message on. */
function fakeShell(alive: string[]): FakeShell {
    const listeners = { changed: [] as (() => void)[], closed: [] as ((key: string) => void)[], message: [] as ((from: string, text: string) => void)[] };
    const listen =
        <Listener>(list: Listener[]) =>
        (listener: Listener): (() => void) => {
            list.push(listener);

            return () => void list.splice(list.indexOf(listener), 1);
        };
    const shell: FakeShell = {
        alive,
        opened: [],
        drags: [],
        posted: [],
        bridge: {
            auxWindows: async () => [...shell.alive],
            onAuxWindows: listen(listeners.changed),
            onAuxWindowClosed: listen(listeners.closed),
            onWindowMessage: listen(listeners.message),
            openWindow: (...args) => void shell.opened.push(args),
            viewDrag: async (...args) => {
                shell.drags.push(args);

                return true;
            },
            postToWindow: async (to, text) => {
                shell.posted.push({ to, message: JSON.parse(text) as WindowMessage });

                return true;
            }
        },
        changed: () => listeners.changed.forEach((listener) => listener()),
        closed: (key) => listeners.closed.forEach((listener) => listener(key)),
        message: (from, message) => listeners.message.forEach((listener) => listener(from, JSON.stringify(message)))
    };

    return shell;
}

/* Lets what waits on the shell's answers run. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) {
        await Promise.resolve();
    }
}

const scope = globalThis as unknown as { window?: unknown; localStorage?: Storage };
const before = { window: scope.window, localStorage: scope.localStorage };
let stop: () => void = () => undefined;

function open(shell: FakeShell, ids: readonly string[], local: ProjectLocal): void {
    scope.window = { ruimteDesktop: shell.bridge, addEventListener: () => undefined, removeEventListener: () => undefined };
    useDocument.getState().load(document(ids), local);
    useProject.getState().setCurrent({ projectId: 'p1', name: 'P' } as ProjectSummary, 1, 'local');
}

beforeEach(() => {
    scope.localStorage = memory();
});

afterEach(() => {
    stop();
    stop = () => undefined;
    setAuxWindowId(undefined);
    usePendingViews.getState().set([]);
    useProject.getState().setCurrent(null, 0, null);
    scope.window = before.window;
    scope.localStorage = before.localStorage;
});

describe('the window that has the project', () => {
    test('leaves a view an auxiliary window has out of its grid, and brings that window to a person who asks for the view', async () => {
        const shell = fakeShell(['w1']);
        writeAuxViews(auxWindowKey(PROJECT, 'w1'), ['b']);
        open(shell, ['a', 'b'], side('a', 'b'));
        stop = startMainWindow();
        await settle();

        expect(standing()).toEqual(['a']);

        useDocument.getState().setActiveView('b');

        expect(standing()).toEqual(['a']);
        expect(shell.opened).toEqual([[auxWindowKey(PROJECT, 'w1')]]);
        expect(shell.posted).toEqual([{ to: auxWindowKey(PROJECT, 'w1'), message: { type: 'show', viewId: 'b' } }]);
    });

    test('opens nothing of an auxiliary window a person closed, whose views are its own to show again', async () => {
        const shell = fakeShell(['w1']);
        writeAuxViews(auxWindowKey(PROJECT, 'w1'), ['b']);
        writeClientLocal(localStorage, 'local', localIdOf('p1', 'w1'), side('b'));
        open(shell, ['a', 'b'], side('a'));
        stop = startMainWindow();
        await settle();
        shell.alive = [];
        shell.closed(auxWindowKey(PROJECT, 'w1'));

        expect(standing()).toEqual(['a']);
        expect(readClientLocal(localStorage, 'local', localIdOf('p1', 'w1'))).toBeNull();
        expect(readAuxViews()).toEqual({});

        useDocument.getState().setActiveView('b');

        expect(standing()).toEqual(['b']);
        expect(shell.opened).toEqual([]);
    });

    test('keeps what an auxiliary window of a project that is not on screen left, for the next time that project opens', async () => {
        const shell = fakeShell([]);
        writeClientLocal(localStorage, 'local', localIdOf('p2', 'w9'), side('x'));
        open(shell, ['a'], side('a'));
        stop = startMainWindow();
        await settle();
        shell.closed(auxWindowKey('local:p2', 'w9'));

        expect(standing()).toEqual(['a']);
        expect(readClientLocal(localStorage, 'local', localIdOf('p2', 'w9'))).not.toBeNull();
    });

    test('hands a view to a new auxiliary window once that window asks for it', async () => {
        const shell = fakeShell([]);
        open(shell, ['a', 'b'], side('a', 'b'));
        stop = startMainWindow();
        await settle();

        expect(await moveToNewWindow(['b'])).toBe(true);
        expect(standing()).toEqual(['a']);

        const key = String(shell.opened[0]?.[0]);
        shell.message(key, { type: 'ready' });

        expect(shell.posted).toEqual([{ to: key, message: { type: 'give', items: [{ kind: 'view', id: 'b' }], place: null } }]);
    });

    test('keeps a view while the window it is dragged into follows the pointer, and hands it over when the drag ends there', async () => {
        const shell = fakeShell([]);
        open(shell, ['a', 'b'], side('a', 'b'));
        stop = startMainWindow();
        await settle();
        startFollowing(['b'], [{ kind: 'view', id: 'b' }]);
        await settle();
        const key = String(shell.drags[0]?.[1]);

        expect(shell.drags).toEqual([['start', key, false]]);
        expect(standing()).toEqual(['a', 'b']);

        shell.message(key, { type: 'ready' });

        expect(shell.posted).toEqual([{ to: key, message: { type: 'wait', items: [{ kind: 'view', id: 'b' }] } }]);

        await endFollowing(true);

        expect(shell.drags.at(-1)).toEqual(['end', key, true]);
        expect(standing()).toEqual(['a']);
        expect(shell.posted.at(-1)).toEqual({ to: key, message: { type: 'give', items: [{ kind: 'view', id: 'b' }], place: null } });
    });

    test('keeps a view whose drag ended anywhere else, and has the window that followed it closed', async () => {
        const shell = fakeShell([]);
        open(shell, ['a', 'b'], side('a', 'b'));
        stop = startMainWindow();
        await settle();
        startFollowing(['b'], [{ kind: 'view', id: 'b' }]);
        await settle();
        await endFollowing(false);

        expect(shell.drags.at(-1)).toEqual(['end', String(shell.drags[0]?.[1]), false]);
        expect(standing()).toEqual(['a', 'b']);
        expect(shell.posted).toEqual([]);
    });

    test('puts a view an auxiliary window gave back in its grid, before the list of who has what says so', async () => {
        const shell = fakeShell(['w1']);
        writeAuxViews(auxWindowKey(PROJECT, 'w1'), ['b']);
        open(shell, ['a', 'b'], side('a'));
        stop = startMainWindow();
        await settle();
        shell.message(auxWindowKey(PROJECT, 'w1'), { type: 'give', items: [{ kind: 'view', id: 'b' }], place: null });

        expect(standing()).toEqual(['a', 'b']);
    });

    test('lets go of a view another window took out of a drag', async () => {
        const shell = fakeShell(['w1']);
        open(shell, ['a', 'b'], side('a', 'b'));
        stop = startMainWindow();
        await settle();
        shell.message(auxWindowKey(PROJECT, 'w1'), { type: 'took', ids: ['b'] });

        expect(standing()).toEqual(['a']);
    });

    test('answers no window of another project', async () => {
        const shell = fakeShell([]);
        open(shell, ['a', 'b'], side('a', 'b'));
        stop = startMainWindow();
        await settle();
        shell.message(auxWindowKey('local:p2', 'w1'), { type: 'took', ids: ['b'] });

        expect(standing()).toEqual(['a', 'b']);
    });
});

describe('an auxiliary window', () => {
    const own = auxWindowKey(PROJECT, 'w1');

    test('asks the windows of its project for its views, shows what it is given and says which views it has', async () => {
        const shell = fakeShell(['w1', 'w2']);
        setAuxWindowId('w1');
        open(shell, ['a', 'b'], { activeViewId: null, views: {}, emptyLayout: true });
        let closed = 0;
        stop = startAuxWindow({ close: () => (closed += 1) });
        await settle();

        expect(shell.posted).toEqual([
            { to: PROJECT, message: { type: 'ready' } },
            { to: auxWindowKey(PROJECT, 'w2'), message: { type: 'ready' } }
        ]);

        shell.message(PROJECT, { type: 'give', items: [{ kind: 'view', id: 'b' }], place: null });
        shell.message(auxWindowKey(PROJECT, 'w2'), { type: 'none' });

        expect(standing()).toEqual(['b']);
        expect(readAuxViews()).toEqual({ [own]: ['b'] });
        expect(closed).toBe(0);
    });

    test('shows the view of the drag that opened it at once, and names it as its own only once the drag gave it', async () => {
        const shell = fakeShell(['w1', 'w2']);
        setAuxWindowId('w1');
        open(shell, ['a', 'b'], { activeViewId: null, views: {}, emptyLayout: true });
        let closed = 0;
        stop = startAuxWindow({ close: () => (closed += 1) });
        await settle();
        shell.message(PROJECT, { type: 'wait', items: [{ kind: 'view', id: 'b' }] });
        shell.message(auxWindowKey(PROJECT, 'w2'), { type: 'none' });

        expect(closed).toBe(0);
        expect(standing()).toEqual(['b']);
        expect(readAuxViews()).toEqual({ [own]: [] });

        shell.message(PROJECT, { type: 'give', items: [{ kind: 'view', id: 'b' }], place: null });

        expect(standing()).toEqual(['b']);
        expect(readAuxViews()).toEqual({ [own]: ['b'] });
    });

    test('goes when no window has views for it', async () => {
        const shell = fakeShell(['w1']);
        setAuxWindowId('w1');
        open(shell, ['a'], { activeViewId: null, views: {}, emptyLayout: true });
        let closed = 0;
        stop = startAuxWindow({ close: () => (closed += 1) });
        await settle();
        shell.message(PROJECT, { type: 'none' });

        expect(closed).toBe(1);
    });

    test('goes with its last view, and is no longer named as having any', async () => {
        const shell = fakeShell(['w1']);
        setAuxWindowId('w1');
        open(shell, ['a', 'b'], side('b'));
        let closed = 0;
        stop = startAuxWindow({ close: () => (closed += 1) });
        await settle();

        expect(readAuxViews()).toEqual({ [own]: ['b'] });

        useDocument.getState().closeViewTab('b');

        expect(closed).toBe(1);
        expect(readAuxViews()).toEqual({});
    });

    test('shows no view it was not handed, and sends a person who asks for one to the window that has the project', async () => {
        const shell = fakeShell(['w1']);
        setAuxWindowId('w1');
        open(shell, ['a', 'b'], side('b'));
        stop = startAuxWindow({ close: () => undefined });
        await settle();
        useDocument.getState().setActiveView('a');

        expect(standing()).toEqual(['b']);
        expect(shell.opened).toEqual([[PROJECT, 'a']]);
    });

    test('runs the commands about its grid itself and leaves the ones about the project to the window that has it', async () => {
        const shell = fakeShell(['w1']);
        setAuxWindowId('w1');
        open(shell, ['a', 'b'], side('b'));
        stop = startAuxWindow({ close: () => undefined });
        await settle();

        expect(commandPlace('split-right')).toBe('here');
        expect(commandPlace('palette')).toBe('here');
        expect(commandPlace('usage')).toBe('relayed');
        expect(commandPlace('settings')).toBe('relayed');
        expect(commandPlace('sidebar')).toBe('dropped');
    });
});

describe('windowDragType', () => {
    test('names the project in lowercase, so a window of another project never takes the drag', () => {
        expect(windowDragType('local:P1')).toBe(windowDragType('local:P1').toLowerCase());
        expect(windowDragType('local:P1')).not.toBe(windowDragType('local:p1'));
    });
});
