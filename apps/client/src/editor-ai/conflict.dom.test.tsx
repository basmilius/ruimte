import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { typeInto } from '@adecore/editor/testing';
import { isApplePlatform } from '@adecore/ui';
import { act } from 'react';
import { textDrafts } from '@/state/text-drafts';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const MOD = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };
const ENDPOINT_ID = 'fake-machine';
const VIEW = { kind: 'file', id: 'greet-view', name: 'greet.ts', path: 'greet.ts' };
const PATH = '/work/atlas/greet.ts';
const TEXT = 'const greeting = "hi";\nexport { greeting };\n';
const THEIRS = 'const greeting = "hello";\nexport { greeting };\n';

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let disk: { text: string; mtime: number };

function input(): HTMLTextAreaElement | null {
    return page.host.querySelector('textarea');
}

function button(label: string): HTMLButtonElement | null {
    return [...page.host.querySelectorAll('button')].find((element) => element.textContent?.trim() === label) ?? null;
}

/* A person types at the start of the file, and before it is saved another program rewrites the same line. */
async function changeOnBothSides(): Promise<void> {
    await page.renderApp();
    await until(() => input() !== null);
    await act(async () => input()!.focus());
    // The editor puts the caret back where the last one on this file left it.
    await pressKey(input()!, 'Home', MOD);
    await act(async () => {
        typeInto(window, input()!, '// ');
    });
    disk = { text: THEIRS, mtime: 2 };
    await act(async () => machine.emit('fs.changed', { root: '/work/atlas', paths: ['/work/atlas'], changedPaths: [PATH] }));
    await until(() => button('Keep yours') !== null);
}

beforeEach(async () => {
    disk = { text: TEXT, mtime: 1 };
    machine = new FakeMachine();
    machine.answer(
        'fs.read',
        () => ({ kind: 'text', text: disk.text, encoding: 'utf-8', size: disk.text.length, mtime: disk.mtime, language: 'typescript' }) as never
    );
    machine.answer('fs.write', ({ text }) => ({ size: text.length, mtime: 3 }));
    workspace = await openFakeWorkspace(machine, { views: [VIEW] } as never, { activeViewId: VIEW.id, views: {} });
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    // An unsaved draft outlives the window that drew it, and the next test opens the same file.
    textDrafts.discard(ENDPOINT_ID, PATH);
});

describe('a file that moved on disk under unsaved text', () => {
    test('shows both sides of the line they both changed, and writes nothing on its own', async () => {
        await changeOnBothSides();

        expect(page.host.textContent).toContain('Another program');
        expect(button('Keep theirs')).not.toBeNull();
        expect(button('Keep both')).not.toBeNull();
        expect(machine.requests('fs.write')).toEqual([]);
    });

    test('keeping theirs takes the other line, which leaves nothing to write', async () => {
        await changeOnBothSides();

        await clickOn(button('Keep theirs'));
        await until(() => button('Keep yours') === null);

        expect(input()!.value).toBe(THEIRS);
        expect(machine.requests('fs.write')).toEqual([]);
    });

    test('keeping yours holds the typed line and writes it over the new version', async () => {
        await changeOnBothSides();

        await clickOn(button('Keep yours'));
        await until(() => machine.requests('fs.write').length > 0);

        expect(input()!.value).toBe(`// ${TEXT}`);
        expect(button('Keep yours')).toBeNull();
        expect(machine.requests('fs.write')).toEqual([expect.objectContaining({ path: PATH, text: `// ${TEXT}` })]);
    });
});
