import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { startAgentProjectWatch, useAgentFolderAsk } from '@/project/agent-project-watch';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const ASKED = 'An agent asks to open /work/fresh as a project. It opens in this window.';

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

/* An agent's `project_open` of a folder without a project, the way the machine passes it on to the clients with its project open. */
function agentAsks(fromProjectId = 'project-atlas'): void {
    act(() => machine.emit('project.askOpen', { folder: '/work/fresh', fromProjectId, by: 'term-1' }));
}

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [emptyCanvas()] }, { activeViewId: 'main', views: {} });
    stopWatch = startAgentProjectWatch();
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    stopWatch();
    workspace.close();
    useAgentFolderAsk.setState({ ask: null });
});

describe('a folder an agent asks to open as a project', () => {
    test('opens as the person opens a folder once they confirm', async () => {
        agentAsks();
        await until(() => onScreen(ASKED));

        expect(machine.requests('project.open').filter((payload) => payload.folder !== undefined)).toEqual([]);

        await clickOn(buttonNamed('Open'));

        await until(() => machine.requests('project.open').some((payload) => payload.folder === '/work/fresh'));
        expect(onScreen(ASKED)).toBe(false);
    });

    test('opens nothing when the person cancels', async () => {
        agentAsks();
        await until(() => onScreen(ASKED));

        await clickOn(buttonNamed('Cancel'));

        expect(onScreen(ASKED)).toBe(false);
        expect(machine.requests('project.open').filter((payload) => payload.folder !== undefined)).toEqual([]);
    });

    test('asks nothing in a window on another project', async () => {
        agentAsks('project-other');

        expect(useAgentFolderAsk.getState().ask).toBeNull();
        expect(onScreen(ASKED)).toBe(false);
    });
});
