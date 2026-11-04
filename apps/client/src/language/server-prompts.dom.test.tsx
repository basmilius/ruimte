import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { installDesktop, removeDesktop, buttonWithText, everything } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const PROJECT_ID = 'project-atlas';

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('language.messageAnswer', () => ({}));
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    removeDesktop();
    await page.unmount();
    workspace.close();
});

describe('what a language server asks of a person', () => {
    test('shows a question with its answers and sends the one that was pressed', async () => {
        await act(async () => {
            machine.emit('language.message', {
                projectId: PROJECT_ID,
                messageId: 'm1',
                server: 'typescript',
                title: 'typescript',
                type: 3,
                message: 'Use the workspace version of TypeScript?',
                actions: ['Allow', 'Never']
            });
        });
        await until(() => buttonWithText('Never') !== null);

        expect(everything()).toContain('Use the workspace version of TypeScript?');

        await clickOn(buttonWithText('Never'));

        expect(machine.requests('language.messageAnswer')).toEqual([{ projectId: PROJECT_ID, messageId: 'm1', action: 'Never' }]);
    });

    test('offers a web address and opens it only when Open is pressed', async () => {
        const opened: string[] = [];
        installDesktop({
            openExternal: async (url: string) => {
                opened.push(url);
            }
        });
        await act(async () => {
            machine.emit('language.show', { projectId: PROJECT_ID, server: 'typescript', title: 'typescript', url: 'https://example.com/guide' });
        });
        await until(() => buttonWithText('Open') !== null);

        expect(opened).toEqual([]);

        await clickOn(buttonWithText('Open'));

        expect(opened).toEqual(['https://example.com/guide']);
    });
});
