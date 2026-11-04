import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { typeInto } from '@adecore/editor/testing';
import { act } from 'react';
import { isApplePlatform } from '@/desktop/bridge';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const MOD = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };
const VIEW = { kind: 'file', id: 'greet-view', name: 'greet.ts', path: 'greet.ts' };
const SERVER_EDIT = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '// organized\n' };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let version = 1;

function input(): HTMLTextAreaElement | null {
    return page.host.querySelector('textarea');
}

function methods(): string[] {
    return machine.requests('language.request').map((request) => request.method);
}

async function typeA(): Promise<void> {
    await page.renderApp();
    await until(() => input() !== null);
    await act(async () => input()!.focus());
    await until(() => machine.requests('language.document.open').length > 0);
    await act(async () => {
        typeInto(window, input()!, 'a');
    });
}

beforeEach(async () => {
    version = 1;
    machine = new FakeMachine();
    machine.answer('fs.read', () => ({ kind: 'text', text: '', encoding: 'utf-8', size: 0, mtime: 1, language: 'typescript' }) as never);
    machine.answer('fs.write', ({ text }) => ({ size: text.length, mtime: 2 }));
    machine.answer('language.document.open', () => ({
        version,
        servers: ['typescript'],
        providers: { 'textDocument/willSaveWaitUntil': {} }
    }));
    machine.answer('language.document.change', () => ({ version: ++version }));
    machine.answer('language.willSave', () => ({}));
    machine.answer('language.request', ({ method }) => ({
        result: method === 'textDocument/willSaveWaitUntil' ? [SERVER_EDIT] : null,
        server: 'typescript',
        version
    }));
    workspace = await openFakeWorkspace(machine, { views: [VIEW] } as never, { activeViewId: VIEW.id, views: {} });
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('saving a file a language server serves', () => {
    test('writes the text with the edits a server wanted, after telling it a save was coming', async () => {
        await typeA();
        await pressKey(input()!, 's', MOD);
        await until(() => machine.requests('fs.write').length > 0);

        expect(machine.requests('fs.write').at(-1)?.text).toBe('// organized\na\n');
        expect(machine.requests('language.willSave').at(-1)).toMatchObject({ path: 'greet.ts', reason: 1 });

        const order = machine.sent.map((request) => request.type);

        expect(order.lastIndexOf('language.willSave')).toBeLessThan(order.lastIndexOf('fs.write'));
    });

    test('only announces the save when the editor loses focus, and asks for no edits', async () => {
        await typeA();
        await act(async () => input()!.blur());
        await until(() => machine.requests('fs.write').length > 0);

        expect(machine.requests('fs.write').at(-1)?.text).toBe('a\n');
        expect(machine.requests('language.willSave').at(-1)).toMatchObject({ path: 'greet.ts', reason: 3 });
        expect(methods()).not.toContain('textDocument/willSaveWaitUntil');
    });
});
