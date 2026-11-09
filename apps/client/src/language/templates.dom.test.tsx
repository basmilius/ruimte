import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { keyOf as eventOf } from '@adecore/editor-react/testing';
import { typeInto } from '@adecore/editor/testing';
import { isApplePlatform, type Shortcut } from '@adecore/ui';
import { act } from 'react';
import { useTemplateRequest } from '@/language/template-request';
import { keyOf } from '@/surface/shortcut-overrides';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { languageCommandRows } from './language-commands';

const MOD = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };
const VIEW = { kind: 'file', id: 'run-view', name: 'run.ts', path: 'run.ts' };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let text = '';

function input(): HTMLTextAreaElement | null {
    return page.host.querySelector('textarea');
}

function rows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
}

async function press(chord: Shortcut): Promise<void> {
    await act(async () => {
        input()!.dispatchEvent(new KeyboardEvent('keydown', { ...eventOf(chord), bubbles: true, cancelable: true }));
    });
}

async function savedText(): Promise<string | undefined> {
    await pressKey(input()!, 's', MOD);

    return machine.requests('fs.write').at(-1)?.text;
}

async function openEditor(): Promise<void> {
    await page.renderApp();
    await until(() => input() !== null);
    await act(async () => input()!.focus());
}

beforeEach(async () => {
    text = '';
    machine = new FakeMachine();
    machine.answer('fs.read', () => ({ kind: 'text', text, encoding: 'utf-8', size: text.length, mtime: 1, language: 'typescript' }) as never);
    machine.answer('fs.write', ({ text: written }) => ({ size: written.length, mtime: 2 }));
    machine.answer('template.list', () => ({
        personal: {
            revision: 1,
            live: [{ id: 'mine', key: 'hi', body: 'hello($0);', languages: ['typescript'] }],
            postfix: [],
            disabled: [],
            settings: {}
        },
        project: null
    }));
    workspace = await openFakeWorkspace(machine, { views: [VIEW] } as never, { activeViewId: VIEW.id, views: {} });
    page = mount();
});

afterEach(async () => {
    // The store outlives the page, and the next file would open on this form.
    useTemplateRequest.getState().setRequest(null);
    await page.unmount();
    workspace.close();
});

describe('templates in an editor no language server serves', () => {
    test('a built-in key expands on Tab', async () => {
        await openEditor();
        await act(async () => {
            typeInto(window, input()!, 'log');
        });
        await pressKey(input()!, 'Tab');

        expect(await savedText()).toBe('console.log();\n');
    });

    test('a template of the person expands on Tab once the machine has listed it', async () => {
        await openEditor();
        await until(() => machine.requests('template.list').length > 0);
        await act(async () => {
            typeInto(window, input()!, 'hi');
        });
        await pressKey(input()!, 'Tab');

        expect(await savedText()).toBe('hello();\n');
    });

    test('Insert Live Template lists the templates and inserts the one picked', async () => {
        await openEditor();
        await press(keyOf('insertLiveTemplate')!);
        await until(() => rows().some((row) => row.textContent?.includes('hi')));
        expect(rows().some((row) => row.textContent?.includes('log'))).toBe(true);

        const index = rows().findIndex((row) => row.textContent?.includes('hi'));
        for (let i = 0; i < index; i++) {
            await pressKey(input()!, 'ArrowDown');
        }
        await pressKey(input()!, 'Enter');

        expect(await savedText()).toBe('hello();\n');
    });

    test('Surround With lists the constructs and wraps the selection in the one a digit names', async () => {
        text = 'run();';
        await openEditor();
        await pressKey(input()!, 'a', MOD);
        await press(keyOf('surroundWith')!);
        await until(() => rows().length > 0);
        expect(rows()[0]!.textContent).toContain('if');

        await pressKey(input()!, '1');

        expect(await savedText()).toContain('if (');
        expect((await savedText())!).toContain('run();');
    });
});

describe('Save as Live Template', () => {
    test('opens the template form with the selection as its text', async () => {
        text = 'run();';
        await openEditor();
        await pressKey(input()!, 'a', MOD);

        languageCommandRows()
            .find((row) => row.id === 'save-as-live-template')!
            .run();

        await until(() => document.querySelector('[role="dialog"] textarea') !== null);
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Add live template');
        expect(document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!.value).toBe('run();');
    });
});
