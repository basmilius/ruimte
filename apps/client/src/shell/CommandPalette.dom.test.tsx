import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { contribute } from '@/extensions/registry';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
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
