import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { startShowViewWatch } from '@/project/show-view-watch';
import { useDocument } from '@/state/document';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const previousFollow = useSettings.getState().agentsShowViews;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let stopWatch: () => void;

function buttonNamed(label: string): HTMLElement | null {
    return ([...document.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.trim() === label) ?? null;
}

function onScreen(text: string): boolean {
    return document.body.textContent?.includes(text) === true;
}

/* An agent's `view open`, the way the machine passes it on to the clients with the project open. */
function agentOpens(viewId: string): void {
    act(() => machine.emit('project.showView', { projectId: 'project-atlas', viewId, by: 'term-1' }));
}

beforeEach(async () => {
    localStorage.clear();
    useToasts.setState({ toasts: [] });
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [emptyCanvas(), emptyCanvas('board', 'Board')] }, { activeViewId: 'main', views: {} });
    stopWatch = startShowViewWatch();
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    stopWatch();
    workspace.close();
    useToasts.setState({ toasts: [] });
    useSettings.setState({ agentsShowViews: previousFollow });
});

describe('a view an agent opens', () => {
    test('with switching on, the window shows it and a toast leads back', async () => {
        useSettings.setState({ agentsShowViews: true });
        agentOpens('board');
        await until(() => onScreen('An agent showed Board where you were working'));
        expect(useDocument.getState().activeViewId).toBe('board');

        await clickOn(buttonNamed('Back'));

        expect(useDocument.getState().activeViewId).toBe('main');
        expect(onScreen('An agent showed Board where you were working')).toBe(false);
    });

    test('with switching off, nothing moves and the toast offers to go there', async () => {
        useSettings.setState({ agentsShowViews: false });
        agentOpens('board');
        await until(() => onScreen('An agent asked you to look at Board'));
        expect(useDocument.getState().activeViewId).toBe('main');

        await clickOn(buttonNamed('Go there'));

        expect(useDocument.getState().activeViewId).toBe('board');
        expect(onScreen('An agent asked you to look at Board')).toBe(false);
    });

    test('a second request replaces the toast of the first', async () => {
        useSettings.setState({ agentsShowViews: false });
        agentOpens('board');
        await until(() => onScreen('An agent asked you to look at Board'));
        agentOpens('main');

        await until(() => onScreen('An agent pointed at Main, already in view'));

        expect(onScreen('An agent asked you to look at Board')).toBe(false);
        expect(buttonNamed('Go there')).toBeNull();
    });
});
