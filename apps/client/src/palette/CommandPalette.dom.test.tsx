import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { contribute } from '@/state/extension-registry';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

let page: Mounted;
let workspace: FakeWorkspace | null = null;

function field(): HTMLInputElement | null {
    return document.querySelector('input[role="combobox"]');
}

function rows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

function highlighted(): HTMLElement | undefined {
    return rows().find((row) => row.hasAttribute('data-highlighted'));
}

/* Compared as booleans: Bun 1.4.2 on macOS passes `toBe` for two different happy-dom elements. */
function expectFieldHoldsTheKeys(row: HTMLElement): void {
    expect(document.activeElement === field()).toBe(true);
    expect(field()!.getAttribute('aria-activedescendant')).toBe(row.id);
    expect(highlighted() === row).toBe(true);
}

async function type(text: string): Promise<void> {
    await act(async () => {
        const input = field()!;
        // React tracks the value it set, so the browser's own setter is what makes the change show.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
        // A typed key carries an `inputType`; without one Base UI reads the change as autofill.
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    });
}

function labels(): string[] {
    return rows().map((row) => row.textContent ?? '');
}

function groupLabels(): string[] {
    return [...document.querySelectorAll('[role="group"]')].map((group) => {
        const id = group.getAttribute('aria-labelledby');

        return (id === null ? null : document.getElementById(id)?.textContent) ?? '';
    });
}

async function openPalette(open: () => void, ready: () => boolean): Promise<void> {
    page = mount();
    await page.renderApp();
    await act(async () => open());
    await until(() => field() !== null && document.activeElement === field() && ready());
}

afterEach(async () => {
    await act(async () => useUi.getState().setPaletteOpen(false));
    await page.unmount();
    await act(async () => workspace?.close());
    workspace = null;
});

describe('the command palette with an extension', () => {
    test('shows what a source finds for words no row holds, and pressing it runs it', async () => {
        const ran: string[] = [];
        const remove = contribute('paletteSources', {
            id: 'poc/numbers',
            title: 'POC',
            search: async (query) => [{ id: query, title: 'From the source', run: () => ran.push(query) }]
        });

        try {
            await openPalette(
                () => useUi.getState().setPaletteOpen(true),
                () => rows().length > 0
            );
            await type('zzzqqq');
            await until(() => labels().some((label) => label.includes('From the source')));
            await pressKey(field()!, 'Enter');

            expect(ran).toEqual(['zzzqqq']);
        } finally {
            remove();
        }
    });

    test('puts what a source finds under a label of its own, apart from the actions', async () => {
        const removes = [
            contribute('paletteSources', {
                id: 'poc/issues',
                title: 'POC',
                search: async () => [{ id: 'issue', title: 'An issue', run: () => undefined }]
            }),
            contribute('commands', { id: 'extension:poc/command', title: 'Command wwyy', run: () => undefined })
        ];

        try {
            await openPalette(
                () => useUi.getState().setPaletteOpen(true),
                () => rows().length > 0
            );
            await type('wwyy');
            await until(() => labels().some((label) => label.includes('An issue')) && labels().some((label) => label.includes('Command wwyy')));

            expect(groupLabels()).toEqual(['From extensions', 'Actions']);
        } finally {
            removes.forEach((remove) => remove());
        }
    });

    test('lists a command an extension adds while it is open, leaves out an action that says it cannot run, and says when a command fails', async () => {
        const failures: string[] = [];
        const removes = [
            contribute('slotEntries', {
                id: 'poc/blocked',
                kind: 'action',
                title: 'Blocked qqzz',
                slots: { commandPalette: () => ({ disabled: 'Not now' }) },
                run: () => undefined
            })
        ];

        try {
            await openPalette(
                () => useUi.getState().setPaletteOpen(true),
                () => rows().length > 0
            );
            await act(async () => {
                removes.push(
                    contribute('commands', {
                        id: 'extension:poc/late',
                        title: 'Late qqzz',
                        run: () => {
                            throw new Error('It broke');
                        },
                        onFailure: (text) => failures.push(text)
                    })
                );
            });
            await type('qqzz');
            await until(() => labels().some((label) => label.includes('Late qqzz')));

            expect(labels().some((label) => label.includes('Blocked qqzz'))).toBe(false);

            await pressKey(field()!, 'Enter');
            await until(() => failures.length === 1);

            expect(failures).toEqual(['It broke']);
            expect(useToasts.getState().toasts.some((toast) => toast.title === 'Late qqzz' && toast.description === 'It broke')).toBe(true);
        } finally {
            removes.forEach((remove) => remove());
        }
    });
});

describe('the command palette keeps the keyboard in its field', () => {
    beforeEach(async () => {
        await openPalette(
            () => useUi.getState().setPaletteOpen(true),
            () => rows().length > 2
        );
    });

    test('the rows stay out of the tab order', () => {
        expect(rows().every((row) => row.tabIndex === -1)).toBe(true);
    });

    test('the arrow keys move the highlight and the field keeps the focus', async () => {
        expectFieldHoldsTheKeys(rows()[0]!);
        await pressKey(field()!, 'ArrowDown');
        expectFieldHoldsTheKeys(rows()[1]!);
        await pressKey(field()!, 'ArrowDown');
        expectFieldHoldsTheKeys(rows()[2]!);
        await pressKey(field()!, 'ArrowUp');
        expectFieldHoldsTheKeys(rows()[1]!);
    });

    test('hovering a row highlights it and the field keeps the focus', async () => {
        const row = rows()[2]!;
        await act(async () => {
            // On WebKit, which happy-dom passes Base UI's check for, a move without movement is no hover.
            row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 1 }));
        });
        expectFieldHoldsTheKeys(row);
    });

    test('pressing a row does not take the focus out of the field', async () => {
        const pressed = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        await act(async () => {
            rows()[1]!.dispatchEvent(pressed);
        });
        expect(pressed.defaultPrevented).toBe(true);
        expect(document.activeElement === field()).toBe(true);
    });

    test('a row that gets the focus anyway hands it back to the field', async () => {
        await pressKey(field()!, 'ArrowDown');
        const row = highlighted()!;
        await act(async () => row.focus());
        expectFieldHoldsTheKeys(row);
    });

    test('what is typed lands in the field and filters the list', async () => {
        const before = rows().length;
        await pressKey(field()!, 'ArrowDown');
        await type('open folder');
        await until(() => rows().length < before);
        expect(field()!.value).toBe('open folder');
        expect(rows().length).toBeGreaterThan(0);
        expect(rows().every((row) => row.textContent!.toLowerCase().includes('open folder'))).toBe(true);
        expectFieldHoldsTheKeys(rows()[0]!);
    });
});

function addMachine(id: string, label: string): void {
    useEndpoints.getState().add({
        id,
        label,
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
}

describe('browsing the folders of a machine', () => {
    const FOLDERS: Record<string, string[]> = { '~/': ['alpha', 'beta', 'gamma'], '~/gamma/': ['x', 'y', 'z'] };
    let disconnect: () => void;

    beforeEach(async () => {
        const machine = new FakeMachine();
        machine.answer('fs.browse', ({ partialPath }) => ({
            parentPath: partialPath,
            exists: true,
            entries: (FOLDERS[partialPath] ?? []).map((name) => ({ name, fullPath: `${partialPath}${name}`, hasCanvas: false }))
        }));
        addMachine('machine-b', 'MacBook Pro');
        disconnect = connectFakeMachine(machine, 'machine-b');
        useEndpoints.getState().setActive('machine-b');
        await openPalette(
            () => useUi.getState().openFolderBrowser(),
            () => labels().join() === 'alpha,beta,gamma'
        );
    });

    afterEach(() => {
        disconnect();
        useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
        useEndpoints.getState().remove('machine-b');
    });

    test('Enter steps into the highlighted folder with its first row highlighted, the field says where, and the palette stays open', async () => {
        await pressKey(field()!, 'ArrowDown');
        await pressKey(field()!, 'ArrowDown');
        expect(highlighted()?.textContent).toBe('gamma');
        await pressKey(field()!, 'Enter');
        await until(() => labels().join() === '..,x,y,z');
        expect(field()!.value).toBe('~/gamma/');
        expectFieldHoldsTheKeys(rows()[0]!);
    });
});

describe('browsing the folders of a Windows machine', () => {
    const HOME = 'C:\\Users\\bas';
    const FOLDERS: Record<string, string[]> = {
        '~\\': ['Documents', 'Projects'],
        'C:\\Users\\bas\\': ['Documents', 'Projects'],
        'C:\\': ['Users', 'Windows'],
        'D:\\Work\\': ['alpha', 'beta']
    };
    const asked: string[] = [];
    let disconnect: () => void;

    beforeEach(async () => {
        asked.length = 0;
        const machine = new FakeMachine();
        machine.answer('fs.browse', ({ partialPath }) => {
            asked.push(partialPath);
            const home = partialPath.startsWith('~');
            const parentPath = home ? HOME : partialPath.replace(/\\$/, '') || partialPath;
            return {
                parentPath: parentPath.endsWith(':') ? `${parentPath}\\` : parentPath,
                exists: partialPath !== 'Z:\\Gone\\',
                entries: (FOLDERS[partialPath] ?? []).map((name) => ({
                    name,
                    fullPath: `${home ? HOME : partialPath.replace(/\\$/, '')}\\${name}`,
                    hasCanvas: false
                }))
            };
        });
        addMachine('machine-w', 'Office PC');
        useServers.getState().setInfo('machine-w', { platform: 'win32', home: 'C:\\ProgramData\\Ruimte', version: '1.0.0', model: null });
        disconnect = connectFakeMachine(machine, 'machine-w');
        useEndpoints.getState().setActive('machine-w');
    });

    afterEach(() => {
        disconnect();
        useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
        useEndpoints.getState().remove('machine-w');
        useServers.getState().forget('machine-w');
    });

    test('the placeholder gives an example in the style of the machine', async () => {
        await openPalette(
            () => useUi.getState().setPaletteOpen(true),
            () => field() !== null
        );
        expect(field()!.placeholder).toContain('C:\\Projects');
    });

    test('a typed drive letter and separator browses that drive, and a bare drive letter stays a search', async () => {
        await openPalette(
            () => useUi.getState().setPaletteOpen(true),
            () => field() !== null
        );
        await type('C:');
        expect(asked).toEqual([]);
        await type('C:\\');
        await until(() => labels().join() === 'Users,Windows');
        expect(asked).toContain('C:\\');
    });

    const keepStartFolder = (startFolder: string): void =>
        useServers.getState().setIdentity('machine-w', { label: 'Office PC', nameSource: 'default', icon: null, agentsDeleteAnyView: false, startFolder });

    test('browsing opens in the start folder of the machine', async () => {
        keepStartFolder('D:\\Work');
        await openPalette(
            () => useUi.getState().openFolderBrowser(),
            () => labels().join() === '..,alpha,beta'
        );
        expect(field()!.value).toBe('D:\\Work\\');
    });

    test('browsing opens in the home folder when the start folder is gone', async () => {
        keepStartFolder('Z:\\Gone');
        await openPalette(
            () => useUi.getState().openFolderBrowser(),
            () => labels().join() === '..,Documents,Projects'
        );
        expect(field()!.value).toBe('C:\\Users\\bas\\');
    });

    test('browsing opens at the absolute home folder rather than a tilde', async () => {
        await openPalette(
            () => useUi.getState().openFolderBrowser(),
            () => labels().join() === '..,Documents,Projects'
        );
        expect(asked[0]).toBe('~\\');
        expect(field()!.value).toBe('C:\\Users\\bas\\');
        expect(field()!.placeholder).toContain('C:\\Projects\\my-app');
    });
});

describe('a Windows path typed with forward slashes', () => {
    let disconnect: () => void;

    beforeEach(() => {
        const machine = new FakeMachine();
        machine.answer('fs.browse', ({ partialPath }) => {
            const folder = partialPath === 'C:/' || partialPath === 'C:/Projects';

            return {
                parentPath: 'C:\\',
                exists: folder,
                entries: [{ name: 'Projects', fullPath: 'C:\\Projects', hasCanvas: false }]
            };
        });
        addMachine('machine-w', 'Office PC');
        useServers.getState().setInfo('machine-w', { platform: 'win32', home: 'C:\\ProgramData\\Ruimte', version: '1.0.0', model: null });
        disconnect = connectFakeMachine(machine, 'machine-w');
        useEndpoints.getState().setActive('machine-w');
    });

    afterEach(() => {
        disconnect();
        useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
        useEndpoints.getState().remove('machine-w');
        useServers.getState().forget('machine-w');
    });

    test('an existing folder is opened and not offered for creation', async () => {
        await openPalette(
            () => useUi.getState().setPaletteOpen(true),
            () => field() !== null
        );
        await type('C:/Projects');
        await until(() => labels().includes('Projects'));

        expect(page.host.ownerDocument.body.textContent).not.toContain('Create and open');
        expect(page.host.ownerDocument.body.textContent).not.toContain('Enter creates the folder');
    });

    test('a folder that is not there is still offered for creation', async () => {
        await openPalette(
            () => useUi.getState().setPaletteOpen(true),
            () => field() !== null
        );
        await type('C:/Projectz');
        await until(() => document.body.textContent?.includes('Create and open') === true);
    });
});

describe('choosing a machine to browse', () => {
    beforeEach(async () => {
        addMachine('machine-b', 'MacBook Pro');
        addMachine('machine-c', 'Studio');
        useEndpoints.getState().setActive('machine-c');
        await openPalette(
            () => useUi.getState().openFolderBrowser(),
            () => rows().length === 2
        );
    });

    afterEach(() => {
        useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
        useEndpoints.getState().remove('machine-b');
        useEndpoints.getState().remove('machine-c');
    });

    test('opens on the machine the app is pointed at, first in the list', () => {
        expect(labels()[0]).toStartWith('Studio');
        expect(labels()[1]).toStartWith('MacBook Pro');
        expectFieldHoldsTheKeys(rows()[0]!);
    });
});

describe('the command catalog stays current while its query changes', () => {
    beforeEach(async () => {
        const machine = new FakeMachine();
        machine.answer('fs.read', ({ path }) => ({
            kind: 'text' as const,
            text: path.endsWith('alpha.txt') ? 'Alpha file content' : 'Beta file content',
            encoding: 'utf-8' as const,
            size: 18,
            mtime: 1
        }));
        workspace = await openFakeWorkspace(
            machine,
            {
                views: [
                    { id: 'alpha', kind: 'file', name: 'Open alpha', path: 'alpha.txt' },
                    { id: 'beta', kind: 'file', name: 'Open beta', path: 'beta.txt' }
                ]
            },
            { activeViewId: null, views: {} }
        );
        await openPalette(
            () => useUi.getState().setPaletteOpen(true),
            () => labels()[0]?.startsWith('Open alpha') === true
        );
    });

    test('arrows cross from views into actions and filtering selects the current first result', async () => {
        await type('open');
        await pressKey(field()!, 'ArrowDown');
        expect(highlighted()?.textContent).toStartWith('Open beta');
        await pressKey(field()!, 'ArrowDown');
        expect(highlighted()?.textContent).toStartWith('Open folder as project');
        expectFieldHoldsTheKeys(highlighted()!);
        await type('alpha');
        expect(highlighted()?.textContent).toStartWith('Open alpha');
        await pressKey(field()!, 'Enter');
        await until(() => page.host.textContent?.includes('Alpha file content') === true);
    });

    test('a rename updates the catalog under the current query and keeps the renamed view runnable', async () => {
        await type('beta');
        expect(highlighted()?.textContent).toStartWith('Open beta');
        await act(async () => useDocument.getState().renameView('beta', 'Gamma document'));
        expect(labels().some((label) => label.startsWith('Open beta'))).toBe(false);
        await type('gamma');
        expect(highlighted()?.textContent).toStartWith('Gamma document');
        await pressKey(field()!, 'Enter');
        await until(() => page.host.textContent?.includes('Beta file content') === true);
    });
});

describe('the order of the actions', () => {
    const actions = (): string[] => {
        const group = [...document.querySelectorAll('[role="group"]')].find((candidate) => {
            const id = candidate.getAttribute('aria-labelledby');

            return id !== null && document.getElementById(id)?.textContent === 'Actions';
        });

        return [...(group?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].map((row) => row.textContent ?? '');
    };
    const startingWith = (prefixes: readonly string[]): string[] =>
        actions().flatMap((label) => prefixes.filter((prefix) => label.startsWith(prefix)).slice(0, 1));

    beforeEach(async () => {
        workspace = await openFakeWorkspace(
            new FakeMachine(),
            { views: [{ kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] }] },
            { activeViewId: 'main', views: {} }
        );
        await openPalette(
            () => useUi.getState().setPaletteOpen(true),
            () => actions().length > 0
        );
    });

    test('an empty palette offers its few actions in the order main gave them', () => {
        expect(startingWith(['Open folder as project', 'Find in files', 'New canvas view', 'New terminal', 'New chat', 'Usage', 'Settings'])).toEqual([
            'Open folder as project',
            'Find in files',
            'New canvas view',
            'New terminal',
            'New chat',
            'Usage',
            'Settings'
        ]);
    });

    test('a query keeps the hand order of the rows it finds', async () => {
        const panels = [
            'Toggle sidebar',
            'Toggle output panel',
            'Toggle files panel',
            'Toggle databases panel',
            'Toggle git panel',
            'Toggle problems panel',
            'Toggle processes panel'
        ];

        await type('toggle');
        await until(() => actions().some((label) => label.startsWith('Toggle processes panel')));

        expect(startingWith(panels)).toEqual(panels);

        await type('zoom');
        await until(() => actions().some((label) => label.startsWith('Zoom to 100%')));

        expect(startingWith(['Zoom to fit', 'Zoom to selection', 'Zoom to 100%'])).toEqual(['Zoom to fit', 'Zoom to selection', 'Zoom to 100%']);
    });
});
