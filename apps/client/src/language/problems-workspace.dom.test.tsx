import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { everything } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const PROJECT_ID = 'project-atlas';
const STATUS = {
    server: 'typescript',
    state: 'ready' as const,
    version: '5.0.0',
    documents: 0,
    capabilities: { diagnosticProvider: { workspaceDiagnostics: true } }
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function checkButton(): HTMLElement | null {
    return document.querySelector('button[aria-label="Check whole project"]');
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('language.status', () => ({ servers: [STATUS] }));
    machine.answer('language.workspaceProblems', () => ({ servers: ['typescript'], files: 1 }));
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'problems' }));
    await page.unmount();
    workspace.close();
});

async function openPanel(): Promise<void> {
    await act(async () => useUi.getState().setPanel({ open: true, kind: 'problems' }));
}

describe('the problems panel', () => {
    test('checks the whole project on a press and lists a file nobody has open', async () => {
        await openPanel();
        await until(() => checkButton() !== null);

        expect(everything()).toContain('No problems in open files.');

        await clickOn(checkButton());
        await act(async () => {
            machine.emit('language.diagnostics', {
                projectId: PROJECT_ID,
                path: 'src/closed.ts',
                server: 'typescript',
                diagnostics: [{ range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } }, severity: 1, message: 'Cannot find name nope' }]
            });
        });
        await until(() => everything().includes('Cannot find name nope'));

        expect(machine.requests('language.workspaceProblems')).toEqual([{ projectId: PROJECT_ID }]);
        expect(everything()).toContain('closed.ts');
    });

    test('says the project has none after a check that found nothing', async () => {
        await openPanel();
        await until(() => checkButton() !== null);
        await clickOn(checkButton());
        await until(() => everything().includes('No problems in the project.'));
    });

    test('offers no check while no server reports for the whole project', async () => {
        machine.answer('language.status', () => ({ servers: [{ ...STATUS, capabilities: {} }] }));
        await openPanel();
        await until(() => everything().includes('No problems in open files.'));

        expect(checkButton()).toBeNull();
    });
});
