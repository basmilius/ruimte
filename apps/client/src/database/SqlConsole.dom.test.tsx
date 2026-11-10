import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { typeInto } from '@adecore/editor/testing';
import { isApplePlatform } from '@adecore/ui';
import { act } from 'react';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const CONSOLE = '/work/atlas/.ruimte/private/consoles/local-db/console.sql';
const VIEW = { kind: 'file', id: 'console-view', name: 'console.sql', path: '.ruimte/private/consoles/local-db/console.sql' };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function input(): HTMLTextAreaElement | null {
    return page.host.querySelector('textarea');
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('fs.read', () => ({ kind: 'text', text: '', encoding: 'utf-8', size: 0, mtime: 1, language: 'sql' }) as never);
    machine.answer('fs.write', ({ text }) => ({ size: text.length, mtime: 2 }));
    workspace = await openFakeWorkspace(machine, { views: [VIEW] } as never, { activeViewId: VIEW.id, views: {} });
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the database console', () => {
    test('saving writes what was typed to its file', async () => {
        await page.renderApp();
        await until(() => input() !== null);
        await act(async () => {
            typeInto(window, input()!, 'select 1;');
        });
        expect(machine.requests('fs.write')).toEqual([]);
        await pressKey(input()!, 's', isApplePlatform() ? { metaKey: true } : { ctrlKey: true });
        // At once, and not after the pause the autosave waits for.
        expect(machine.requests('fs.write')).toEqual([{ path: CONSOLE, text: 'select 1;\n', expectedMtime: 1 }]);
    });
});
